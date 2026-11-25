import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import type { Program as AnchorProgram } from '@coral-xyz/anchor';
import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  type Commitment,
} from '@solana/web3.js';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
} from '@solana/spl-token';
import { loadTreasuryKeypair } from '../p2p/custody/solana-dispatcher.js';
import type { Logger } from '../../shared/logger.js';

// @coral-xyz/anchor é CommonJS: sob ESM os named exports (BN, Program…) não são detectados.
const require = createRequire(import.meta.url);
const { AnchorProvider, BN, Program, Wallet } = require('@coral-xyz/anchor');

/** Sementes das PDAs — devem casar com os SEED_* do programa Rust (modelo casa_da_moeda). */
const SEED = {
  pool: 'pool',
  tokenVault: 'token_vault',
  quoteVault: 'quote_vault',
  deposit: 'deposit',
} as const;

export interface FactoryClientConfig {
  rpcUrl: string;
  cluster: 'mainnet' | 'devnet' | 'testnet';
  /** Hot wallet custodial que assina (authority/buyer/seller/depositor). Default: a tesouraria. */
  buyerKeypairPath?: string;
  buyerSecretKey?: string;
  /** Mint da moeda de cotação (USDC) usada ao criar novos pools. */
  quoteMint?: string;
  logger: Logger;
  commitment?: Commitment;
}

export interface InitializePoolInput {
  /** Mint da moeda de cotação (USDC). Default: cfg.quoteMint. */
  quoteMint?: string;
  tokenDecimals: number;
  /** Supply máximo em unidades-base (tokens inteiros × 10^decimais). */
  maxSupply: bigint | string | number;
  /** Preço inicial: unidades-base de quote por 1 token inteiro × 1e9. */
  initialPrice: bigint | string | number;
  buyFeeBps: number;
  sellFeeBps: number;
  simulate?: boolean;
}

export interface BuyInput {
  /** Mint do token (identifica o pool). */
  tokenMint: string;
  /** Quanto pagar em unidades-base da quote (ex.: micro-USDC). */
  quoteIn: bigint | string | number;
  /** Mínimo de tokens a receber (slippage). 0 = sem proteção. */
  minTokensOut?: bigint | string | number;
  simulate?: boolean;
}

export interface SellInput {
  tokenMint: string;
  /** Tokens a vender em unidades-base. */
  tokensIn: bigint | string | number;
  /** Mínimo de quote a receber (slippage). */
  minQuoteOut?: bigint | string | number;
  simulate?: boolean;
}

export interface InjectInput {
  tokenMint: string;
  /** Quanto injetar em unidades-base da quote. */
  amount: bigint | string | number;
  /** Referência única do depósito (idempotência). Qualquer string → 32 bytes (sha256). */
  reference: string;
  simulate?: boolean;
}

const EXPLORER_SUFFIX: Record<string, string> = { mainnet: '', devnet: '?cluster=devnet', testnet: '?cluster=testnet' };

export interface HoldersResult {
  mint: string;
  supply: string;
  decimals: number;
  count: number;
  holders: { address: string; amount: string; uiAmount: string | null; pct: number }[];
  rateLimited?: boolean;
}

/** Normaliza uma referência arbitrária para 32 bytes determinísticos. */
function toReference32(reference: string): Buffer {
  if (/^[0-9a-fA-F]{64}$/.test(reference)) return Buffer.from(reference, 'hex');
  return createHash('sha256').update(reference, 'utf8').digest();
}

/**
 * Cliente Anchor do programa `mastter_factory` (modelo Cofre de Cunhagem Evolutiva,
 * pool único por token). O hot wallet do backend assina como authority/comprador.
 */
export class FactoryClient {
  readonly programId: PublicKey;
  private readonly conn: Connection;
  private readonly signer: Keypair;
  private readonly program: AnchorProgram;
  private readonly commitment: Commitment;
  private readonly defaultQuoteMint: PublicKey | null;
  private readonly holdersCache = new Map<string, { at: number; data: HoldersResult }>();

  constructor(private readonly cfg: FactoryClientConfig) {
    this.commitment = cfg.commitment ?? 'confirmed';
    this.conn = new Connection(cfg.rpcUrl, this.commitment);
    this.signer = loadTreasuryKeypair({ treasuryKeypairPath: cfg.buyerKeypairPath, treasurySecretKey: cfg.buyerSecretKey });
    const provider = new AnchorProvider(this.conn, new Wallet(this.signer), { commitment: this.commitment });
    const idl = JSON.parse(readFileSync(new URL('./idl/mastter_factory.json', import.meta.url), 'utf8'));
    this.program = new Program(idl, provider);
    this.programId = this.program.programId;
    this.defaultQuoteMint = cfg.quoteMint ? new PublicKey(cfg.quoteMint) : null;
  }

  get signerAddress(): string {
    return this.signer.publicKey.toBase58();
  }

  private pda(seeds: (Buffer | Uint8Array)[]): PublicKey {
    return PublicKey.findProgramAddressSync(seeds, this.programId)[0];
  }

  private poolPda(tokenMint: PublicKey): PublicKey {
    return this.pda([Buffer.from(SEED.pool), tokenMint.toBuffer()]);
  }

  private vaults(pool: PublicKey): { tokenVault: PublicKey; quoteVault: PublicKey } {
    return {
      tokenVault: this.pda([Buffer.from(SEED.tokenVault), pool.toBuffer()]),
      quoteVault: this.pda([Buffer.from(SEED.quoteVault), pool.toBuffer()]),
    };
  }

  explorerUrl(sig: string): string {
    return `https://explorer.solana.com/tx/${sig}${EXPLORER_SUFFIX[this.cfg.cluster] ?? ''}`;
  }

  async status() {
    return {
      programId: this.programId.toBase58(),
      cluster: this.cfg.cluster,
      rpcUrl: this.cfg.rpcUrl,
      signer: this.signerAddress,
      defaultQuoteMint: this.defaultQuoteMint?.toBase58() ?? null,
    };
  }

  /** Lê o Pool on-chain pelo mint do token, incluindo os saldos reais dos cofres. */
  async getPool(tokenMint: string) {
    const mint = new PublicKey(tokenMint);
    const pool = this.poolPda(mint);
    const p: any = await (this.program.account as any).pool.fetch(pool);

    // Saldos reais on-chain: reserva (quote_vault), estoque (token_vault), supply do mint.
    let reserve = 0n;
    let inventory = 0n;
    let supply = 0n;
    try {
      const [qv, tv, sup] = await Promise.all([
        this.conn.getTokenAccountBalance(p.quoteVault).catch(() => null),
        this.conn.getTokenAccountBalance(p.tokenVault).catch(() => null),
        this.conn.getTokenSupply(p.tokenMint).catch(() => null),
      ]);
      reserve = qv ? BigInt(qv.value.amount) : 0n;
      inventory = tv ? BigInt(tv.value.amount) : 0n;
      supply = sup ? BigInt(sup.value.amount) : 0n;
    } catch {
      /* mantém zeros se o RPC falhar */
    }
    const circulating = supply > inventory ? supply - inventory : 0n;

    return {
      pool: pool.toBase58(),
      authority: p.authority.toBase58(),
      pendingAuthority: p.pendingAuthority.toBase58(),
      tokenMint: p.tokenMint.toBase58(),
      quoteMint: p.quoteMint.toBase58(),
      tokenVault: p.tokenVault.toBase58(),
      quoteVault: p.quoteVault.toBase58(),
      tokenDecimals: p.tokenDecimals,
      quoteDecimals: p.quoteDecimals,
      maxSupply: p.maxSupply.toString(),
      mintedTotal: p.mintedTotal.toString(),
      initialPrice: p.initialPrice.toString(),
      buyFeeBps: p.buyFeeBps,
      sellFeeBps: p.sellFeeBps,
      mintingCompleted: p.mintingCompleted,
      paused: p.paused,
      totalQuoteFromBuys: p.totalQuoteFromBuys.toString(),
      totalQuoteInjected: p.totalQuoteInjected.toString(),
      totalQuotePaidOnSells: p.totalQuotePaidOnSells.toString(),
      totalTokensBought: p.totalTokensBought.toString(),
      totalTokensSold: p.totalTokensSold.toString(),
      depositCount: p.depositCount.toString(),
      // saldos reais (unidades-base)
      reserve: reserve.toString(),
      inventory: inventory.toString(),
      supply: supply.toString(),
      circulating: circulating.toString(),
    };
  }

  /** Top holders reais de um mint (via getTokenLargestAccounts), com % sobre o supply.
   * Usa apenas 2 chamadas RPC (largest accounts + supply) para não estourar o rate limit
   * do RPC público. O `address` é a conta de token (não a carteira dona, que exigiria
   * uma chamada extra por conta). */
  async getHolders(mint: string, limit = 20): Promise<HoldersResult> {
    const m = new PublicKey(mint);
    const key = m.toBase58();
    const hit = this.holdersCache.get(key);
    if (hit && Date.now() - hit.at < 60_000) return hit.data;

    const once = () =>
      Promise.all([this.conn.getTokenLargestAccounts(m), this.conn.getTokenSupply(m).catch(() => null)]);

    let largest: Awaited<ReturnType<typeof this.conn.getTokenLargestAccounts>>;
    let supply: Awaited<ReturnType<typeof this.conn.getTokenSupply>> | null;
    try {
      [largest, supply] = await once();
    } catch {
      // RPC público costuma 429 nesse método: um retry curto e, se falhar, resposta vazia graciosa.
      await new Promise((r) => setTimeout(r, 900));
      try {
        [largest, supply] = await once();
      } catch {
        const data: HoldersResult = { mint: key, supply: '0', decimals: 0, count: 0, holders: [], rateLimited: true };
        this.holdersCache.set(key, { at: Date.now(), data });
        return data;
      }
    }

    const accts = largest.value.slice(0, Math.max(1, Math.min(50, limit)));
    const total = supply ? BigInt(supply.value.amount) : 0n;
    const decimals = supply ? supply.value.decimals : accts[0]?.decimals ?? 0;
    const holders = accts.map((a) => {
      const amt = BigInt(a.amount);
      const pct = total > 0n ? Number((amt * 1_000_000n) / total) / 10_000 : 0;
      return { address: a.address.toBase58(), amount: a.amount, uiAmount: a.uiAmountString ?? null, pct };
    });
    const data: HoldersResult = { mint: key, supply: total.toString(), decimals, count: holders.length, holders };
    this.holdersCache.set(key, { at: Date.now(), data });
    return data;
  }

  /** Cria um novo token (supply 0) e seu pool. Retorna o mint gerado. */
  async initializePool(input: InitializePoolInput): Promise<{ signature: string; explorer: string; tokenMint: string; pool: string }> {
    const quoteMint = input.quoteMint ? new PublicKey(input.quoteMint) : this.defaultQuoteMint;
    if (!quoteMint) throw new Error('quoteMint é obrigatório (configure FACTORY_QUOTE_MINT ou envie no corpo).');

    const mintKp = Keypair.generate();
    const tokenMint = mintKp.publicKey;
    const pool = this.poolPda(tokenMint);
    const { tokenVault, quoteVault } = this.vaults(pool);

    const params = {
      tokenDecimals: input.tokenDecimals,
      maxSupply: new BN(input.maxSupply.toString()),
      initialPrice: new BN(input.initialPrice.toString()),
      buyFeeBps: input.buyFeeBps,
      sellFeeBps: input.sellFeeBps,
    };

    const builder = (this.program.methods as any)
      .initializePool(params)
      .accountsStrict({
        authority: this.signer.publicKey,
        pool,
        tokenMint,
        quoteMint,
        tokenVault,
        quoteVault,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .signers([mintKp]);

    if (input.simulate) {
      await builder.simulate();
      return { signature: 'SIMULATED', explorer: '', tokenMint: tokenMint.toBase58(), pool: pool.toBase58() };
    }
    const signature: string = await builder.rpc();
    this.cfg.logger.info({ tokenMint: tokenMint.toBase58(), pool: pool.toBase58(), signature }, 'initialize_pool enviado on-chain');
    return { signature, explorer: this.explorerUrl(signature), tokenMint: tokenMint.toBase58(), pool: pool.toBase58() };
  }

  /** Compra tokens pagando em USDC (dinheiro entra, token sai). */
  async buy(input: BuyInput): Promise<{ signature: string; explorer: string; signer: string }> {
    const tokenMint = new PublicKey(input.tokenMint);
    const pool = this.poolPda(tokenMint);
    const p: any = await (this.program.account as any).pool.fetch(pool);
    const quoteMint: PublicKey = p.quoteMint;
    const { tokenVault, quoteVault } = this.vaults(pool);
    const buyer = this.signer.publicKey;

    const buyerQuoteAccount = (await getOrCreateAssociatedTokenAccount(this.conn, this.signer, quoteMint, buyer)).address;
    const buyerTokenAccount = getAssociatedTokenAddressSync(tokenMint, buyer, false, TOKEN_PROGRAM_ID);

    const builder = (this.program.methods as any)
      .buy(new BN(input.quoteIn.toString()), new BN((input.minTokensOut ?? 0).toString()))
      .accountsStrict({
        buyer,
        pool,
        tokenMint,
        quoteMint,
        tokenVault,
        quoteVault,
        buyerQuoteAccount,
        buyerTokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 })]);

    if (input.simulate) {
      await builder.simulate();
      return { signature: 'SIMULATED', explorer: '', signer: this.signerAddress };
    }
    const signature: string = await builder.rpc();
    this.cfg.logger.info({ tokenMint: input.tokenMint, quoteIn: input.quoteIn.toString(), signature }, 'buy enviado on-chain');
    return { signature, explorer: this.explorerUrl(signature), signer: this.signerAddress };
  }

  /** Vende tokens recebendo USDC (única saída de USDC do cofre). */
  async sell(input: SellInput): Promise<{ signature: string; explorer: string; signer: string }> {
    const tokenMint = new PublicKey(input.tokenMint);
    const pool = this.poolPda(tokenMint);
    const p: any = await (this.program.account as any).pool.fetch(pool);
    const quoteMint: PublicKey = p.quoteMint;
    const { tokenVault, quoteVault } = this.vaults(pool);
    const seller = this.signer.publicKey;

    const sellerTokenAccount = getAssociatedTokenAddressSync(tokenMint, seller, false, TOKEN_PROGRAM_ID);
    const sellerQuoteAccount = (await getOrCreateAssociatedTokenAccount(this.conn, this.signer, quoteMint, seller)).address;

    const builder = (this.program.methods as any)
      .sell(new BN(input.tokensIn.toString()), new BN((input.minQuoteOut ?? 0).toString()))
      .accountsStrict({
        seller,
        pool,
        tokenMint,
        quoteMint,
        tokenVault,
        quoteVault,
        sellerTokenAccount,
        sellerQuoteAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
      });

    if (input.simulate) {
      await builder.simulate();
      return { signature: 'SIMULATED', explorer: '', signer: this.signerAddress };
    }
    const signature: string = await builder.rpc();
    this.cfg.logger.info({ tokenMint: input.tokenMint, tokensIn: input.tokensIn.toString(), signature }, 'sell enviado on-chain');
    return { signature, explorer: this.explorerUrl(signature), signer: this.signerAddress };
  }

  /** Injeta USDC no cofre sem emitir tokens (idempotente por referência). */
  async injectQuote(input: InjectInput): Promise<{ signature: string; explorer: string; signer: string }> {
    const tokenMint = new PublicKey(input.tokenMint);
    const pool = this.poolPda(tokenMint);
    const p: any = await (this.program.account as any).pool.fetch(pool);
    const quoteMint: PublicKey = p.quoteMint;
    const { tokenVault, quoteVault } = this.vaults(pool);
    const depositor = this.signer.publicKey;
    const reference = toReference32(input.reference);
    const depositRecord = this.pda([Buffer.from(SEED.deposit), pool.toBuffer(), reference]);

    const depositorQuoteAccount = (await getOrCreateAssociatedTokenAccount(this.conn, this.signer, quoteMint, depositor)).address;

    const builder = (this.program.methods as any)
      .injectQuote(new BN(input.amount.toString()), Array.from(reference))
      .accountsStrict({
        depositor,
        pool,
        tokenMint,
        quoteMint,
        tokenVault,
        quoteVault,
        depositorQuoteAccount,
        depositRecord,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      });

    if (input.simulate) {
      await builder.simulate();
      return { signature: 'SIMULATED', explorer: '', signer: this.signerAddress };
    }
    const signature: string = await builder.rpc();
    this.cfg.logger.info({ tokenMint: input.tokenMint, amount: input.amount.toString(), signature }, 'inject_quote enviado on-chain');
    return { signature, explorer: this.explorerUrl(signature), signer: this.signerAddress };
  }

  /** Pausa/retoma compras e injeções (vendas nunca pausam). Só a authority do pool. */
  async setPaused(tokenMint: string, paused: boolean): Promise<{ signature: string; explorer: string }> {
    const mint = new PublicKey(tokenMint);
    const pool = this.poolPda(mint);
    const signature: string = await (this.program.methods as any)
      .setPaused(paused)
      .accountsStrict({ authority: this.signer.publicKey, pool })
      .rpc();
    this.cfg.logger.info({ tokenMint, paused, signature }, 'set_paused enviado on-chain');
    return { signature, explorer: this.explorerUrl(signature) };
  }
}
