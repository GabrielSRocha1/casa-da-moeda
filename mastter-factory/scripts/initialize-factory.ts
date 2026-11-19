/**
 * Inicializa a Factory (uma única vez por deploy). Deve ser executado pela
 * upgrade authority do programa. Nenhum endereço é embutido: tudo vem do ambiente.
 *
 *   ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
 *   ANCHOR_WALLET=~/.config/solana/id.json \
 *   USDC_MINT=<mint USDC do cluster> \
 *   REVENUE_WALLET=<carteira de receita Mastter.Digital (já com saldo em SOL)> \
 *   ORACLE_PROGRAM=<Pyth Solana Receiver do cluster> \
 *   SOL_PRICE_ACCOUNT=<conta de preço SOL/USD> SOL_FEED_ID=<hex 32 bytes> \
 *   USDC_PRICE_ACCOUNT=<conta de preço USDC/USD> USDC_FEED_ID=<hex 32 bytes> \
 *   npx ts-node scripts/initialize-factory.ts
 */
import * as anchor from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Variável de ambiente obrigatória ausente: ${name}`);
  return v;
}

function feedId(name: string): number[] {
  const hex = env(name).replace(/^0x/, "");
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error(`${name} deve ter 32 bytes em hexadecimal`);
  return [...Buffer.from(hex, "hex")];
}

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const idl = JSON.parse(fs.readFileSync(path.join(__dirname, "../target/idl/mastter_factory.json"), "utf8"));
  const program = new anchor.Program(idl, provider);
  const programId = program.programId;

  const [config] = PublicKey.findProgramAddressSync([Buffer.from("config")], programId);
  const [programData] = PublicKey.findProgramAddressSync(
    [programId.toBuffer()],
    new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111")
  );

  const args = {
    oracleProgram: new PublicKey(env("ORACLE_PROGRAM")),
    solPriceAccount: new PublicKey(env("SOL_PRICE_ACCOUNT")),
    usdcPriceAccount: new PublicKey(env("USDC_PRICE_ACCOUNT")),
    solFeedId: feedId("SOL_FEED_ID"),
    usdcFeedId: feedId("USDC_FEED_ID"),
    maxPriceAgeSecs: new anchor.BN(process.env.MAX_PRICE_AGE_SECS ?? "60"),
    maxConfBps: Number(process.env.MAX_CONF_BPS ?? "100"),
    opsUtcOffsetSecs: Number(process.env.OPS_UTC_OFFSET_SECS ?? "-10800"),
  };

  const sig = await (program.methods as any)
    .initializeFactory(args)
    .accountsStrict({
      admin: provider.wallet.publicKey,
      config,
      program: programId,
      programData,
      usdcMint: new PublicKey(env("USDC_MINT")),
      revenueWallet: new PublicKey(env("REVENUE_WALLET")),
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  console.log("Factory inicializada.");
  console.log("  programa:", programId.toBase58());
  console.log("  config  :", config.toBase58());
  console.log("  tx      :", sig);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
