/**
 * Utilitários de teste (solana-bankrun): carregamento do programa como
 * upgradeable, mock de contas de preço Pyth (PriceUpdateV2), relógio e tokens.
 */
import * as anchor from "@coral-xyz/anchor";
import { BN, Program } from "@coral-xyz/anchor";
import {
  ComputeBudgetProgram,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  ACCOUNT_SIZE,
  MINT_SIZE,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createInitializeAccount3Instruction,
  createInitializeMint2Instruction,
  createMintToInstruction,
  unpackAccount,
  unpackMint,
} from "@solana/spl-token";
import { BankrunProvider } from "anchor-bankrun";
import { BanksClient, Clock, ProgramTestContext, start } from "solana-bankrun";
import * as fs from "fs";
import * as path from "path";

export const IDL = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../target/idl/mastter_factory.json"), "utf8")
);
export const PROGRAM_ID = new PublicKey(IDL.address);
export const BPF_UPGRADEABLE = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");

/** Programa de oráculo fictício usado SOMENTE nos testes (dono das contas de preço mock). */
export const MOCK_ORACLE_PROGRAM = Keypair.generate().publicKey;
export const SOL_FEED_ID = Buffer.alloc(32, 0xa1);
export const USDC_FEED_ID = Buffer.alloc(32, 0xb2);
export const PRICE_UPDATE_V2_DISC = Buffer.from([34, 241, 35, 99, 157, 126, 244, 205]);

export const SOL = { sol: {} };
export const USDC = { usdc: {} };
export const FEE_BPS = 119n;

export interface Env {
  context: ProgramTestContext;
  client: BanksClient;
  provider: BankrunProvider;
  program: Program<any>;
  admin: Keypair;
  programData: PublicKey;
  solPriceFeed: PublicKey;
  usdcPriceFeed: PublicKey;
}

export async function startEnv(): Promise<Env> {
  const elf = fs.readFileSync(path.join(__dirname, "../target/deploy/mastter_factory.so"));
  const [programData] = PublicKey.findProgramAddressSync([PROGRAM_ID.toBuffer()], BPF_UPGRADEABLE);

  // O programa é carregado como "upgradeable" para exercitar a checagem de
  // upgrade authority em initialize_factory. A authority é definida após o start
  // (precisamos do payer do contexto), reescrevendo o cabeçalho do ProgramData.
  const programAccountData = Buffer.concat([Buffer.from([2, 0, 0, 0]), programData.toBuffer()]);
  const header = Buffer.alloc(45);
  header.writeUInt32LE(3, 0); // ProgramData
  header.writeBigUInt64LE(0n, 4); // slot
  header.writeUInt8(1, 12); // Some(authority) — preenchida abaixo
  const programDataBytes = Buffer.concat([header, elf]);

  const context = await start(
    [],
    [
      {
        address: PROGRAM_ID,
        info: {
          lamports: LAMPORTS_PER_SOL,
          data: programAccountData,
          owner: BPF_UPGRADEABLE,
          executable: true,
        },
      },
      {
        address: programData,
        info: {
          lamports: 100 * LAMPORTS_PER_SOL,
          data: programDataBytes,
          owner: BPF_UPGRADEABLE,
          executable: false,
        },
      },
    ]
  );
  const admin = context.payer;
  admin.publicKey.toBuffer().copy(programDataBytes, 13);
  context.setAccount(programData, {
    lamports: 100 * LAMPORTS_PER_SOL,
    data: programDataBytes,
    owner: BPF_UPGRADEABLE,
    executable: false,
  });

  const provider = new BankrunProvider(context);
  anchor.setProvider(provider as any);
  const program = new Program(IDL as any, provider as any);

  return {
    context,
    client: context.banksClient,
    provider,
    program,
    admin,
    programData,
    solPriceFeed: Keypair.generate().publicKey,
    usdcPriceFeed: Keypair.generate().publicKey,
  };
}

// ---------------------------------------------------------------------------
// Transações
// ---------------------------------------------------------------------------
let nonce = 0;

export async function send(env: Env, ixs: TransactionInstruction[], signers: Keypair[], payer?: Keypair) {
  const feePayer = payer ?? env.admin;
  const tx = new Transaction();
  // Limite de CU variável: garante assinaturas únicas para transações idênticas.
  tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 + (nonce++ % 100_000) }));
  ixs.forEach((ix) => tx.add(ix));
  // Blockhash sempre atual: o fixo do início expira em execuções longas.
  const latest = await env.client.getLatestBlockhash();
  tx.recentBlockhash = latest ? latest[0] : env.context.lastBlockhash;
  tx.feePayer = feePayer.publicKey;
  const all = [feePayer, ...signers.filter((s) => !s.publicKey.equals(feePayer.publicKey))];
  tx.sign(...all);
  return env.client.tryProcessTransaction(tx);
}

/** Envia e exige sucesso; devolve os logs. */
export async function ok(env: Env, ixs: TransactionInstruction[], signers: Keypair[] = [], payer?: Keypair): Promise<string[]> {
  const res = await send(env, ixs, signers, payer);
  if (res.result) {
    throw new Error(`Transação falhou: ${res.result}\n${(res.meta?.logMessages ?? []).join("\n")}`);
  }
  return res.meta?.logMessages ?? [];
}

/** Envia e exige falha com o código de erro informado. */
export async function fails(
  env: Env,
  ixs: TransactionInstruction[],
  signers: Keypair[],
  expected: string,
  payer?: Keypair
): Promise<void> {
  const res = await send(env, ixs, signers, payer);
  if (!res.result) {
    throw new Error(`Esperava falha "${expected}", mas a transação foi aceita`);
  }
  const text = `${res.result}\n${(res.meta?.logMessages ?? []).join("\n")}`;
  if (!text.includes(expected)) {
    throw new Error(`Esperava erro "${expected}". Obtido:\n${text}`);
  }
}

export function parseEvents(env: Env, logs: string[]): { name: string; data: any }[] {
  const out: { name: string; data: any }[] = [];
  for (const l of logs) {
    if (l.startsWith("Program data: ")) {
      try {
        const ev = env.program.coder.events.decode(l.slice("Program data: ".length));
        if (ev) out.push(ev as any);
      } catch (_) {}
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Relógio e oráculo
// ---------------------------------------------------------------------------
export async function now(env: Env): Promise<bigint> {
  return (await env.client.getClock()).unixTimestamp;
}

export async function warpTo(env: Env, unixTs: bigint) {
  const c = await env.client.getClock();
  env.context.setClock(new Clock(c.slot, c.epochStartTimestamp, c.epoch, c.leaderScheduleEpoch, unixTs));
}

export interface PriceOpts {
  owner?: PublicKey;
  feedId?: Buffer;
  conf?: bigint;
  expo?: number;
  publishTime?: bigint;
  partial?: boolean;
  discriminator?: Buffer;
}

export function encodePriceUpdate(feedId: Buffer, price: bigint, o: PriceOpts, publishTime: bigint): Buffer {
  const verification = o.partial ? Buffer.from([0, 3]) : Buffer.from([1]);
  const msg = Buffer.alloc(32 + 8 + 8 + 4 + 8 + 8 + 8 + 8);
  feedId.copy(msg, 0);
  msg.writeBigInt64LE(price, 32);
  msg.writeBigUInt64LE(o.conf ?? 0n, 40);
  msg.writeInt32LE(o.expo ?? -8, 48);
  msg.writeBigInt64LE(publishTime, 52);
  msg.writeBigInt64LE(publishTime - 1n, 60);
  msg.writeBigInt64LE(price, 68);
  msg.writeBigUInt64LE(o.conf ?? 0n, 76);
  const slot = Buffer.alloc(8);
  return Buffer.concat([
    o.discriminator ?? PRICE_UPDATE_V2_DISC,
    Keypair.generate().publicKey.toBuffer(), // write_authority
    verification,
    msg,
    slot,
  ]);
}

export async function setPrice(env: Env, account: PublicKey, defaultFeed: Buffer, price: bigint, o: PriceOpts = {}) {
  const publishTime = o.publishTime ?? (await now(env));
  env.context.setAccount(account, {
    lamports: LAMPORTS_PER_SOL,
    data: encodePriceUpdate(o.feedId ?? defaultFeed, price, o, publishTime),
    owner: o.owner ?? MOCK_ORACLE_PROGRAM,
    executable: false,
  });
}

/** SOL = US$ 150,00 e USDC = US$ 1,00 (expo -8), publicados "agora". */
export async function refreshPrices(env: Env, solUsd = 150_00000000n, usdcUsd = 1_00000000n, conf = 0n) {
  await setPrice(env, env.solPriceFeed, SOL_FEED_ID, solUsd, { conf });
  await setPrice(env, env.usdcPriceFeed, USDC_FEED_ID, usdcUsd, { conf: conf === 0n ? 0n : conf / 150n });
}

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------
export async function fund(env: Env, to: PublicKey, sol: number) {
  await ok(env, [
    SystemProgram.transfer({ fromPubkey: env.admin.publicKey, toPubkey: to, lamports: BigInt(Math.round(sol * LAMPORTS_PER_SOL)) }),
  ]);
}

export async function createClassicMint(env: Env, decimals: number, authority: PublicKey): Promise<PublicKey> {
  const mint = Keypair.generate();
  const rent = await env.client.getRent();
  await ok(
    env,
    [
      SystemProgram.createAccount({
        fromPubkey: env.admin.publicKey,
        newAccountPubkey: mint.publicKey,
        lamports: Number(rent.minimumBalance(BigInt(MINT_SIZE))),
        space: MINT_SIZE,
        programId: TOKEN_PROGRAM_ID,
      }),
      createInitializeMint2Instruction(mint.publicKey, decimals, authority, null, TOKEN_PROGRAM_ID),
    ],
    [mint]
  );
  return mint.publicKey;
}

/** Cria uma conta de token (keypair) para `owner`, em qualquer um dos dois programas de token. */
export async function createTokenAccount(env: Env, mint: PublicKey, owner: PublicKey, programId = TOKEN_PROGRAM_ID): Promise<PublicKey> {
  const acc = Keypair.generate();
  const rent = await env.client.getRent();
  await ok(
    env,
    [
      SystemProgram.createAccount({
        fromPubkey: env.admin.publicKey,
        newAccountPubkey: acc.publicKey,
        lamports: Number(rent.minimumBalance(BigInt(ACCOUNT_SIZE))),
        space: ACCOUNT_SIZE,
        programId,
      }),
      createInitializeAccount3Instruction(acc.publicKey, mint, owner, programId),
    ],
    [acc]
  );
  return acc.publicKey;
}

export async function mintClassic(env: Env, mint: PublicKey, to: PublicKey, amount: bigint) {
  await ok(env, [createMintToInstruction(mint, to, env.admin.publicKey, amount, [], TOKEN_PROGRAM_ID)]);
}

export async function tokenBalance(env: Env, account: PublicKey, programId = TOKEN_PROGRAM_ID): Promise<bigint> {
  const info = await env.client.getAccount(account);
  if (!info) return 0n;
  return unpackAccount(account, { ...info, data: Buffer.from(info.data) } as any, programId).amount;
}

export async function mintInfo(env: Env, mint: PublicKey, programId = TOKEN_2022_PROGRAM_ID) {
  const info = await env.client.getAccount(mint);
  return unpackMint(mint, { ...info, data: Buffer.from(info!.data) } as any, programId);
}

export async function lamports(env: Env, account: PublicKey): Promise<bigint> {
  return await env.client.getBalance(account);
}

// ---------------------------------------------------------------------------
// PDAs
// ---------------------------------------------------------------------------
export function configPda(): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("config")], PROGRAM_ID)[0];
}

export interface EntityPdas {
  entityId: BN;
  vault: PublicKey;
  registry: PublicKey;
  ledger: PublicKey;
  mint: PublicKey;
  vesting: PublicKey;
  vestingEscrow: PublicKey;
  solTreasury: PublicKey;
  usdcTreasury: PublicKey;
}

export function entityPdas(entityId: number): EntityPdas {
  const id = new BN(entityId);
  const [vault] = PublicKey.findProgramAddressSync([Buffer.from("entity_vault"), id.toArrayLike(Buffer, "le", 8)], PROGRAM_ID);
  const sub = (seed: string) => PublicKey.findProgramAddressSync([Buffer.from(seed), vault.toBuffer()], PROGRAM_ID)[0];
  return {
    entityId: id,
    vault,
    registry: sub("registry"),
    ledger: sub("ledger"),
    mint: sub("mint"),
    vesting: sub("vesting"),
    vestingEscrow: sub("vesting_escrow"),
    solTreasury: sub("sol_treasury"),
    usdcTreasury: sub("usdc_treasury"),
  };
}

export function buyerPda(vault: PublicKey, user: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("buyer"), vault.toBuffer(), user.toBuffer()], PROGRAM_ID)[0];
}

export function profitPda(vault: PublicKey, referenceId: BN): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("profit"), vault.toBuffer(), referenceId.toArrayLike(Buffer, "le", 8)],
    PROGRAM_ID
  )[0];
}

// ---------------------------------------------------------------------------
// Espelho off-chain das fórmulas (BigInt) para conferência exata
// ---------------------------------------------------------------------------
export const fee = (amount: bigint, bps: bigint = FEE_BPS) => (amount * bps) / 10_000n;
const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;

export interface PriceBand {
  lo: bigint;
  hi: bigint;
}
/** Preços em nano-USD por unidade inteira. */
export const P = (usd: number, confUsd = 0): PriceBand => ({
  lo: BigInt(Math.round((usd - confUsd) * 1e9)),
  hi: BigInt(Math.round((usd + confUsd) * 1e9)),
});

export function quoteBuy(
  asset: "sol" | "usdc",
  amountIn: bigint,
  solBacking: bigint,
  usdcBacking: bigint,
  refSupply: bigint,
  sol: PriceBand = P(150),
  usdc: PriceBand = P(1)
) {
  const f = fee(amountIn);
  const net = amountIn - f;
  const payValue = asset === "sol" ? (net * sol.lo) / 10n ** 9n : (net * usdc.lo) / 10n ** 6n;
  const navHi = ceilDiv(solBacking * sol.hi, 10n ** 9n) + ceilDiv(usdcBacking * usdc.hi, 10n ** 6n);
  return { fee: f, net, tokens: (payValue * refSupply) / navHi };
}

export function quoteSell(
  asset: "sol" | "usdc",
  tokens: bigint,
  solBacking: bigint,
  usdcBacking: bigint,
  refSupply: bigint,
  sol: PriceBand = P(150),
  usdc: PriceBand = P(1)
) {
  const navLo = (solBacking * sol.lo) / 10n ** 9n + (usdcBacking * usdc.lo) / 10n ** 6n;
  const grossValue = (tokens * navLo) / refSupply;
  const gross = asset === "sol" ? (grossValue * 10n ** 9n) / sol.hi : (grossValue * 10n ** 6n) / usdc.hi;
  const f = fee(gross);
  return { gross, fee: f, net: gross - f };
}
