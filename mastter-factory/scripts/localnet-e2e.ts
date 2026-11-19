/**
 * Teste de ponta a ponta contra um validador Solana real (solana-test-validator).
 * Cobre o que o bankrun não cobre: deploy pelo loader atualizável, ProgramData real,
 * limite de 1.232 bytes por transação e consumo de compute units.
 *
 * As contas de preço são simuladas (mesmo layout PriceUpdateV2) e carregadas no gênesis
 * pelo script scripts/localnet-e2e.sh. NÃO valida a leitura de uma conta real da Pyth.
 */
import * as anchor from "@coral-xyz/anchor";
import { BN } from "@coral-xyz/anchor";
import { ComputeBudgetProgram, Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, createAssociatedTokenAccountIdempotent, createMint, getAccount, getMint, mintTo, getExtensionData, ExtensionType } from "@solana/spl-token";
import { unpack as unpackMetadata } from "@solana/spl-token-metadata";
import { createHash } from "crypto";
import * as fs from "fs";
import * as path from "path";

const RPC = process.env.RPC_URL ?? "http://127.0.0.1:8899";
const cfg = JSON.parse(fs.readFileSync(process.env.E2E_CONFIG!, "utf8"));
const idl = JSON.parse(fs.readFileSync(path.join(__dirname, "../target/idl/mastter_factory.json"), "utf8"));
const admin = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(cfg.adminKeypair, "utf8"))));
const conn = new Connection(RPC, "confirmed");
const provider = new anchor.AnchorProvider(conn, new anchor.Wallet(admin), { commitment: "confirmed" });
const program: any = new anchor.Program(idl, provider);
const PID: PublicKey = program.programId;
const pda = (...seeds: (Buffer | Uint8Array)[]) => PublicKey.findProgramAddressSync(seeds, PID)[0];
const results: { step: string; bytes: number; cu: number }[] = [];
let failures = 0;
const check = (name: string, cond: boolean, detail = "") => { console.log(`${cond ? "  ok " : "  FALHOU"} ${name}${detail ? " — " + detail : ""}`); if (!cond) failures++; };

async function run(step: string, ix: TransactionInstruction, signers: Keypair[], payer: Keypair) {
  const tx = new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }), ix);
  tx.feePayer = payer.publicKey;
  tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
  const all = [payer, ...signers.filter((s) => !s.publicKey.equals(payer.publicKey))];
  tx.sign(...all);
  const raw = tx.serialize(); // lança se passar de 1.232 bytes
  const sig = await conn.sendRawTransaction(raw);
  const bh = await conn.getLatestBlockhash();
  const conf = await conn.confirmTransaction({ signature: sig, ...bh }, "confirmed");
  const info = await conn.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
  if (conf.value.err) throw new Error(`${step}: ${JSON.stringify(conf.value.err)}\n${info?.meta?.logMessages?.join("\n")}`);
  results.push({ step, bytes: raw.length, cu: info?.meta?.computeUnitsConsumed ?? -1 });
}

async function main() {
  const config = pda(Buffer.from("config"));
  const [programData] = PublicKey.findProgramAddressSync([PID.toBuffer()], new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111"));
  const revenue = Keypair.generate(), verum = Keypair.generate(), buyer = Keypair.generate();
  for (const k of [revenue, verum, buyer]) {
    const s = await conn.requestAirdrop(k.publicKey, 20 * LAMPORTS_PER_SOL);
    await conn.confirmTransaction({ signature: s, ...(await conn.getLatestBlockhash()) }, "confirmed");
  }
  const usdc = await createMint(conn, admin, admin.publicKey, null, 6);
  const ata = (owner: PublicKey) => createAssociatedTokenAccountIdempotent(conn, admin, usdc, owner);
  const adminUsdc = await ata(admin.publicKey), revUsdc = await ata(revenue.publicKey), buyerUsdc = await ata(buyer.publicKey);
  await mintTo(conn, admin, usdc, adminUsdc, admin, 1_000_000n * 10n ** 6n);
  await mintTo(conn, admin, usdc, buyerUsdc, admin, 100_000n * 10n ** 6n);

  console.log("Programa implantado:", PID.toBase58());
  const acc = await conn.getAccountInfo(PID);
  check("programa executável no validador", !!acc?.executable);

  await run("initialize_factory", await program.methods.initializeFactory({
    oracleProgram: new PublicKey(cfg.oracleProgram), solPriceAccount: new PublicKey(cfg.solPrice), usdcPriceAccount: new PublicKey(cfg.usdcPrice),
    solFeedId: [...Buffer.from(cfg.solFeedId, "hex")], usdcFeedId: [...Buffer.from(cfg.usdcFeedId, "hex")],
    maxPriceAgeSecs: new BN(600), maxConfBps: 100, opsUtcOffsetSecs: -10800,
  }).accountsStrict({ admin: admin.publicKey, config, program: PID, programData, usdcMint: usdc, revenueWallet: revenue.publicKey, systemProgram: SystemProgram.programId }).instruction(), [], admin);

  // Pior caso de tamanho: todas as Strings no limite máximo, com acentos (UTF-8 multibyte conta em bytes).
  const fill = (n: number) => "x".repeat(n);
  const id = new BN(1);
  const vault = pda(Buffer.from("entity_vault"), id.toArrayLike(Buffer, "le", 8));
  const sub = (s: string) => pda(Buffer.from(s), vault.toBuffer());
  const [registry, ledger, mint, vesting, escrow, solT, usdcT] = ["registry", "ledger", "mint", "vesting", "vesting_escrow", "sol_treasury", "usdc_treasury"].map(sub);
  await run("initialize_entity_vault (strings no máximo)", await program.methods.initializeEntityVault({
    tokenName: fill(32), tokenSymbol: fill(10), decimals: 6, entityId: id, contractNumber: new BN(2026001),
    companyName: fill(64), address: fill(128), phone: fill(24), country: fill(32), directorsNames: fill(160), payerName: fill(64),
    verumWalletAddress: verum.publicKey, initialPoolAmount: new BN(75_000_000_000), hardCap: new BN(25_000_000),
    minBuy: new BN(10_000_000), maxBuy: new BN("1000000000000"), maxWallet: new BN("2000000000000"), platformFee: 119,
    profitInjector: admin.publicKey, chargeFeeOnProfit: false,
  }).accountsStrict({ admin: admin.publicKey, config, vault, registry, ledger, verumWallet: verum.publicKey, systemProgram: SystemProgram.programId }).instruction(), [], admin);

  const imgHash = createHash("sha256").update("imagem de teste").digest();
  await run("activate_entity_vault (URI de 200 bytes)", await program.methods.activateEntityVault("https://" + fill(192), [...imgHash])
    .accountsStrict({ admin: admin.publicKey, funder: admin.publicKey, config, vault, ledger, mint, vesting, vestingEscrow: escrow, solTreasury: solT, usdcTreasury: usdcT, usdcMint: usdc, funderUsdcAccount: adminUsdc, token2022Program: TOKEN_2022_PROGRAM_ID, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId }).instruction(), [], admin);

  const m = await getMint(conn, mint, "confirmed", TOKEN_2022_PROGRAM_ID);
  const md = unpackMetadata(getExtensionData(ExtensionType.TokenMetadata, m.tlvData)!);
  check("mint Token-2022 criado na rede", m.supply === 7_500_000n * 10n ** 6n, `supply ${m.supply}`);
  check("mint authority = cofre, freeze nula", !!m.mintAuthority?.equals(vault) && m.freezeAuthority === null);
  check("hash da imagem on-chain", md.additionalMetadata[0]?.[1] === imgHash.toString("hex"));
  check("metadados sem autoridade de atualização", !md.updateAuthority || md.updateAuthority.equals(PublicKey.default));

  const buyerTok = await createAssociatedTokenAccountIdempotent(conn, admin, mint, buyer.publicKey, {}, TOKEN_2022_PROGRAM_ID);
  const common = (user: PublicKey) => ({ user, config, vault, ledger, mint, userTokenAccount: buyerTok, solTreasury: solT, usdcTreasury: usdcT, usdcMint: usdc, revenueWallet: revenue.publicKey, solPriceFeed: new PublicKey(cfg.solPrice), usdcPriceFeed: new PublicKey(cfg.usdcPrice), token2022Program: TOKEN_2022_PROGRAM_ID, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId });
  const rec = pda(Buffer.from("buyer"), vault.toBuffer(), buyer.publicKey.toBuffer());
  await run("buy_tokens (USDC)", await program.methods.buyTokens({ usdc: {} }, new BN(100_000_000), new BN(0), new BN(0))
    .accountsStrict({ ...common(buyer.publicKey), buyerRecord: rec, userUsdcAccount: buyerUsdc, revenueUsdcAccount: revUsdc }).instruction(), [buyer], buyer);
  check("compra USDC cunhou 9.881 tokens", (await getAccount(conn, buyerTok, "confirmed", TOKEN_2022_PROGRAM_ID)).amount === 9_881_000_000n);
  check("taxa de 1,19 USDC na carteira de receita", (await getAccount(conn, revUsdc)).amount === 1_190_000n);
  await run("buy_tokens (SOL)", await program.methods.buyTokens({ sol: {} }, new BN(LAMPORTS_PER_SOL), new BN(0), new BN(0))
    .accountsStrict({ ...common(buyer.publicKey), buyerRecord: rec, userUsdcAccount: null, revenueUsdcAccount: null }).instruction(), [buyer], buyer);
  await run("sell_tokens (USDC)", await program.methods.sellTokens({ usdc: {} }, new BN(5_000_000_000), new BN(0), new BN(0))
    .accountsStrict({ ...common(buyer.publicKey), buyerRecord: rec, userUsdcAccount: buyerUsdc, revenueUsdcAccount: revUsdc }).instruction(), [buyer], buyer);
  await run("sell_tokens (SOL)", await program.methods.sellTokens({ sol: {} }, new BN(1_000_000_000), new BN(0), new BN(0))
    .accountsStrict({ ...common(buyer.publicKey), buyerRecord: rec, userUsdcAccount: null, revenueUsdcAccount: null }).instruction(), [buyer], buyer);
  const ref = new BN(20261118);
  await run("inject_daily_profit (origem no máximo)", await program.methods.injectDailyProfit({ usdc: {} }, new BN(2_500_000_000), ref, fill(48))
    .accountsStrict({ injector: admin.publicKey, config, vault, ledger, receipt: pda(Buffer.from("profit"), vault.toBuffer(), ref.toArrayLike(Buffer, "le", 8)), solTreasury: solT, usdcTreasury: usdcT, usdcMint: usdc, injectorUsdcAccount: adminUsdc, revenueWallet: revenue.publicKey, revenueUsdcAccount: revUsdc, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId }).instruction(), [], admin);
  await run("emit_vault_snapshot", await program.methods.emitVaultSnapshot().accountsStrict({ config, vault, ledger, solPriceFeed: new PublicKey(cfg.solPrice), usdcPriceFeed: new PublicKey(cfg.usdcPrice) }).instruction(), [], admin);

  const v = await program.account.entityVault.fetch(vault), l = await program.account.backingLedger.fetch(ledger);
  const supply = (await getMint(conn, mint, "confirmed", TOKEN_2022_PROGRAM_ID)).supply;
  check("supply on-chain == circulante + vesting", supply === BigInt(v.circulatingSupply.add(v.vestingLockedSupply).toString()));
  check("cofre USDC cobre o lastro contabilizado", (await getAccount(conn, usdcT)).amount >= BigInt(l.usdcBacking.toString()));

  console.log("\nTransação".padEnd(46) + "bytes (máx 1232)".padEnd(20) + "compute units");
  for (const r of results) console.log(r.step.padEnd(45) + String(r.bytes).padEnd(20) + r.cu + (r.cu > 200_000 ? "  << acima do padrão de 200 mil: exige ComputeBudget" : ""));
  console.log(failures ? `\n${failures} verificação(ões) falharam` : "\nTodas as verificações passaram");
  process.exit(failures ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
