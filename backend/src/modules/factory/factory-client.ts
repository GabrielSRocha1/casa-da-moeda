import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { Program as AnchorProgram } from '@coral-xyz/anchor';
import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  type Commitment,
} from '@solana/web3.js';
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getOrCreateAssociatedTokenAccount,
} from '@solana/spl-token';
import { loadTreasuryKeypair } from '../p2p/custody/solana-dispatcher.js';
import type { Logger } from '../../shared/logger.js';

// @coral-xyz/anchor é CommonJS: sob ESM os named exports (BN, Program…) não são detectados.
// Carregamos os valores via require e usamos import type apenas para tipos.
const require = createRequire(import.meta.url);
const { AnchorProvider, BN, Program, Wallet } = require('@coral-xyz/anchor');

/** Sementes das PDAs — devem casar com os SEED_* do programa Rust. */
const SEED = {
  config: 'config',
  vault: 'entity_vault',
  ledger: 'ledger',
  mint: 'mint',
  solTreasury: 'sol_treasury',
  usdcTreasury: 'usdc_treasury',
  buyer: 'buyer',
} as const;

export type PaymentAsset = 'sol' | 'usdc';

export interface FactoryClientConfig {
  rpcUrl: string;
  cluster: 'mainnet' | 'devnet' | 'testnet';
  /** Keypair do comprador/pagador (hot wallet custodial). Mesmo formato da tesouraria. */
  buyerKeypairPath?: string;
  buyerSecretKey?: string;
  logger: Logger;
  commitment?: Commitment;
}

export interface BuyTokensInput {
  entityId: number | bigint | string;
  asset: PaymentAsset;
  /** Quantidade a pagar em unidades-base: lamports (SOL) ou micro-USDC (USDC). */
  amountIn: bigint | string | number;
  /** Proteção de slippage: mínimo de tokens a receber (unidades-base). 0 = sem proteção. */
  minTokensOut?: bigint | string | number;
  /** Deadline unix (segundos). 0 = sem deadline. */
  deadlineTs?: number;
  /** Só simula (não envia). Útil para validar a montagem da transação. */
  simulate?: boolean;
}

const EXPLORER_SUFFIX: Record<string, string> = { mainnet: '', devnet: '?cluster=devnet', testnet: '?cluster=testnet' };

/**
 * Cliente Anchor que chama as instruções do programa `mastter_factory` on-chain.
 * Hoje expõe `buyTokens` (compra custodial: o hot wallet do backend é o comprador).
 */
export class FactoryClient {
  readonly programId: PublicKey;
  private readonly conn: Connection;
  private readonly buyer: Keypair;
  private readonly program: AnchorProgram;
  private readonly commitment: Commitment;

  constructor(private readonly cfg: FactoryClientConfig) {
    this.commitment = cfg.commitment ?? 'confirmed';
    this.conn = new Connection(cfg.rpcUrl, this.commitment);
    this.buyer = loadTreasuryKeypair({ treasuryKeypairPath: cfg.buyerKeypairPath, treasurySecretKey: cfg.buyerSecretKey });
    const provider = new AnchorProvider(this.conn, new Wallet(this.buyer), { commitment: this.commitment });
    const idl = JSON.parse(readFileSync(new URL('./idl/mastter_factory.json', import.meta.url), 'utf8'));
    this.program = new Program(idl, provider);
    this.programId = this.program.programId;
  }

  get buyerAddress(): string {
    return this.buyer.publicKey.toBase58();
  }

  private pda(seeds: (Buffer | Uint8Array)[]): PublicKey {
    return PublicKey.findProgramAddressSync(seeds, this.programId)[0];
  }

  private get configPda(): PublicKey {
    return this.pda([Buffer.from(SEED.config)]);
  }

  private vaultPda(entityId: bigint): PublicKey {
    return this.pda([Buffer.from(SEED.vault), new BN(entityId.toString()).toArrayLike(Buffer, 'le', 8)]);
  }

  explorerUrl(sig: string): string {
    return `https://explorer.solana.com/tx/${sig}${EXPLORER_SUFFIX[this.cfg.cluster] ?? ''}`;
  }

  /** Lê a FactoryConfig on-chain (usdc_mint, revenue_wallet, contas de preço etc.). */
  async getConfig() {
    return (this.program.account as any).factoryConfig.fetch(this.configPda);
  }

  /** Lê um EntityVault pelo id. */
  async getVault(entityId: number | bigint | string) {
    return (this.program.account as any).entityVault.fetch(this.vaultPda(BigInt(entityId as any)));
  }

  async status() {
    let config: any = null;
    try {
      config = await this.getConfig();
    } catch {
      /* config ainda não inicializada */
    }
    return {
      programId: this.programId.toBase58(),
      cluster: this.cfg.cluster,
      rpcUrl: this.cfg.rpcUrl,
      buyer: this.buyerAddress,
      configInitialized: Boolean(config),
      usdcMint: config?.usdcMint?.toBase58() ?? null,
      revenueWallet: config?.revenueWallet?.toBase58() ?? null,
      paused: config?.paused ?? null,
    };
  }

  /**
   * Chama `buy_tokens` do programa: paga em SOL ou USDC e recebe o token da entidade.
   * Cria as contas de token do comprador sob demanda.
   */
  async buyTokens(input: BuyTokensInput): Promise<{ signature: string; explorer: string; buyer: string }> {
    const entityId = BigInt(input.entityId as any);
    const amountIn = new BN(input.amountIn.toString());
    const minTokensOut = new BN((input.minTokensOut ?? 0).toString());
    const deadlineTs = new BN((input.deadlineTs ?? 0).toString());
    if (amountIn.lten(0)) throw new Error('amountIn deve ser positivo.');

    const config = await this.getConfig();
    const user = this.buyer.publicKey;
    const vault = this.vaultPda(entityId);
    const ledger = this.pda([Buffer.from(SEED.ledger), vault.toBuffer()]);
    const mint = this.pda([Buffer.from(SEED.mint), vault.toBuffer()]);
    const solTreasury = this.pda([Buffer.from(SEED.solTreasury), vault.toBuffer()]);
    const usdcTreasury = this.pda([Buffer.from(SEED.usdcTreasury), vault.toBuffer()]);
    const buyerRecord = this.pda([Buffer.from(SEED.buyer), vault.toBuffer(), user.toBuffer()]);
    const usdcMint: PublicKey = config.usdcMint;
    const revenueWallet: PublicKey = config.revenueWallet;

    // Conta Token-2022 do comprador para o token da entidade (criada se preciso).
    const userTokenAccount = (
      await getOrCreateAssociatedTokenAccount(this.conn, this.buyer, mint, user, false, this.commitment, undefined, TOKEN_2022_PROGRAM_ID)
    ).address;

    let userUsdcAccount: PublicKey | null = null;
    let revenueUsdcAccount: PublicKey | null = null;
    if (input.asset === 'usdc') {
      userUsdcAccount = (await getOrCreateAssociatedTokenAccount(this.conn, this.buyer, usdcMint, user)).address;
      revenueUsdcAccount = (
        await getOrCreateAssociatedTokenAccount(this.conn, this.buyer, usdcMint, revenueWallet, true)
      ).address;
    }

    const assetArg = input.asset === 'sol' ? { sol: {} } : { usdc: {} };
    const accounts = {
      user,
      config: this.configPda,
      vault,
      ledger,
      mint,
      userTokenAccount,
      buyerRecord,
      solTreasury,
      usdcTreasury,
      usdcMint,
      userUsdcAccount,
      revenueWallet,
      revenueUsdcAccount,
      solPriceFeed: config.solPriceAccount,
      usdcPriceFeed: config.usdcPriceAccount,
      token2022Program: TOKEN_2022_PROGRAM_ID,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    };

    const builder = (this.program.methods as any)
      .buyTokens(assetArg, amountIn, minTokensOut, deadlineTs)
      .accountsStrict(accounts)
      .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 })]);

    if (input.simulate) {
      const sim = await builder.simulate();
      this.cfg.logger.info({ entityId: entityId.toString(), asset: input.asset, logs: sim?.raw?.slice(-5) }, 'buy_tokens simulado');
      return { signature: 'SIMULATED', explorer: '', buyer: this.buyerAddress };
    }

    const signature: string = await builder.rpc();
    this.cfg.logger.info(
      { entityId: entityId.toString(), asset: input.asset, amountIn: amountIn.toString(), signature, explorer: this.explorerUrl(signature) },
      'buy_tokens enviado on-chain',
    );
    return { signature, explorer: this.explorerUrl(signature), buyer: this.buyerAddress };
  }
}
