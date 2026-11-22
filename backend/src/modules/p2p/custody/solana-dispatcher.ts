import { readFileSync } from 'node:fs';
import {
  Connection,
  Keypair,
  PublicKey,
  type Commitment,
} from '@solana/web3.js';
import {
  getMint,
  getOrCreateAssociatedTokenAccount,
  transferChecked,
} from '@solana/spl-token';
import bs58 from 'bs58';
import type { DispatchInput, DispatchResult, TokenDispatcher } from './token-dispatcher.js';
import type { Logger } from '../../../shared/logger.js';

export interface SolanaDispatcherConfig {
  rpcUrl: string;
  cluster: 'mainnet' | 'devnet' | 'testnet';
  /** Caminho do arquivo de keypair (array JSON do solana-keygen). */
  treasuryKeypairPath?: string;
  /** Secret key em base58 (alternativa ao arquivo). */
  treasurySecretKey?: string;
  /** Mapa SÍMBOLO → endereço do mint no cluster. */
  mints: Record<string, string>;
  /** Dispatcher usado para redes não-Solana (ex.: EVM) — mantém o fluxo existente. */
  fallback: TokenDispatcher;
  logger: Logger;
  commitment?: Commitment;
}

/** Lê a keypair da tesouraria de um arquivo (array JSON) ou de uma secret em base58. */
export function loadTreasuryKeypair(cfg: Pick<SolanaDispatcherConfig, 'treasuryKeypairPath' | 'treasurySecretKey'>): Keypair {
  if (cfg.treasuryKeypairPath) {
    const raw = readFileSync(cfg.treasuryKeypairPath, 'utf8').trim();
    const arr = JSON.parse(raw) as number[];
    return Keypair.fromSecretKey(Uint8Array.from(arr));
  }
  if (cfg.treasurySecretKey) {
    return Keypair.fromSecretKey(bs58.decode(cfg.treasurySecretKey.trim()));
  }
  throw new Error('Tesouraria ausente: defina SOLANA_TREASURY_KEYPAIR_PATH ou SOLANA_TREASURY_SECRET_KEY.');
}

/** Converte uma quantidade decimal (string) para as unidades-base inteiras do mint (trunca o excedente). */
export function toBaseUnits(amount: string, decimals: number): bigint {
  const trimmed = amount.trim();
  const parts = trimmed.split('.');
  if (parts.length > 2) throw new Error(`Quantidade de token inválida: "${amount}".`);
  const [intPart = '', fracPart = ''] = parts;
  const intClean = intPart.replace(/^\+/, '');
  if (!/^\d+$/.test(intClean || '0') || (fracPart && !/^\d+$/.test(fracPart))) {
    throw new Error(`Quantidade de token inválida: "${amount}".`);
  }
  const frac = (fracPart + '0'.repeat(decimals)).slice(0, decimals);
  return BigInt(intClean || '0') * 10n ** BigInt(decimals) + BigInt(frac || '0');
}

const EXPLORER: Record<string, string> = {
  mainnet: '',
  devnet: '?cluster=devnet',
  testnet: '?cluster=testnet',
};

/**
 * Dispatcher REAL: transfere SPL tokens on-chain da tesouraria para a carteira do usuário
 * na liquidação de uma ordem P2P. Redes não-Solana caem no `fallback`.
 */
export class SolanaTokenDispatcher implements TokenDispatcher {
  readonly name = 'SOLANA_DISPATCHER';
  private readonly conn: Connection;
  private readonly treasury: Keypair;
  private readonly mints: Map<string, PublicKey>;
  private readonly decimalsCache = new Map<string, number>();
  private readonly commitment: Commitment;

  constructor(private readonly cfg: SolanaDispatcherConfig) {
    this.commitment = cfg.commitment ?? 'confirmed';
    this.conn = new Connection(cfg.rpcUrl, this.commitment);
    this.treasury = loadTreasuryKeypair(cfg);
    this.mints = new Map(
      Object.entries(cfg.mints).map(([sym, mint]) => [sym.toUpperCase(), new PublicKey(mint)]),
    );
  }

  get treasuryAddress(): string {
    return this.treasury.publicKey.toBase58();
  }

  status() {
    return {
      dispatcher: this.name,
      cluster: this.cfg.cluster,
      rpcUrl: this.cfg.rpcUrl,
      treasury: this.treasuryAddress,
      mints: Object.fromEntries([...this.mints].map(([sym, m]) => [sym, m.toBase58()])),
    };
  }

  private explorerUrl(sig: string): string {
    return `https://explorer.solana.com/tx/${sig}${EXPLORER[this.cfg.cluster] ?? ''}`;
  }

  private async mintDecimals(mint: PublicKey): Promise<number> {
    const key = mint.toBase58();
    const cached = this.decimalsCache.get(key);
    if (cached !== undefined) return cached;
    const info = await getMint(this.conn, mint, this.commitment);
    this.decimalsCache.set(key, info.decimals);
    return info.decimals;
  }

  async send(input: DispatchInput): Promise<DispatchResult> {
    if (input.network !== 'solana') {
      // EVM e outras redes seguem pelo caminho existente (simulado/externo).
      return this.cfg.fallback.send(input);
    }

    const symbol = input.assetSymbol.toUpperCase();
    const mint = this.mints.get(symbol);
    if (!mint) {
      throw new Error(`Sem mint configurado para "${symbol}" no cluster ${this.cfg.cluster} (SOLANA_TOKEN_MINTS).`);
    }

    let recipient: PublicKey;
    try {
      recipient = new PublicKey(input.toAddress);
    } catch {
      throw new Error(`Endereço de destino inválido: "${input.toAddress}".`);
    }

    const decimals = await this.mintDecimals(mint);
    const amount = toBaseUnits(input.tokenAmount, decimals);
    if (amount <= 0n) throw new Error(`Quantidade a enviar deve ser positiva (recebido "${input.tokenAmount}").`);

    // ATA da tesouraria (origem) e do destinatário (criada sob demanda, paga pela tesouraria).
    const source = await getOrCreateAssociatedTokenAccount(this.conn, this.treasury, mint, this.treasury.publicKey);
    if (source.amount < amount) {
      throw new Error(`Saldo da tesouraria insuficiente para ${symbol}: tem ${source.amount}, precisa de ${amount}.`);
    }
    const dest = await getOrCreateAssociatedTokenAccount(this.conn, this.treasury, mint, recipient);

    const sig = await transferChecked(
      this.conn,
      this.treasury,
      source.address,
      mint,
      dest.address,
      this.treasury.publicKey,
      amount,
      decimals,
    );

    this.cfg.logger.info(
      { orderId: input.orderId, symbol, amount: amount.toString(), to: recipient.toBase58(), sig, explorer: this.explorerUrl(sig) },
      'Tokens enviados on-chain (dispatcher real)',
    );

    return { txHash: sig, network: 'solana', simulated: false };
  }
}
