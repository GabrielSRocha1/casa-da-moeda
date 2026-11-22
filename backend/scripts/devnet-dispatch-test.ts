/**
 * Teste ao vivo em devnet do SolanaTokenDispatcher (a ponte backend → on-chain).
 * Usa a mesma config do .env que o app usa e faz uma transferência SPL REAL.
 *   npx tsx scripts/devnet-dispatch-test.ts
 */
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddress, getAccount } from '@solana/spl-token';
import { loadEnv } from '../src/config/env.js';
import { SolanaTokenDispatcher } from '../src/modules/p2p/custody/solana-dispatcher.js';
import { SimulatedTokenDispatcher } from '../src/modules/p2p/custody/token-dispatcher.js';
import { createLogger } from '../src/shared/logger.js';

async function main() {
  const env = loadEnv();
  const logger = createLogger(env.LOG_LEVEL);

  const dispatcher = new SolanaTokenDispatcher({
    rpcUrl: env.SOLANA_DISPATCH_RPC_URL,
    cluster: env.SOLANA_DISPATCH_CLUSTER,
    treasuryKeypairPath: env.SOLANA_TREASURY_KEYPAIR_PATH,
    treasurySecretKey: env.SOLANA_TREASURY_SECRET_KEY,
    mints: env.SOLANA_TOKEN_MINTS,
    fallback: new SimulatedTokenDispatcher(),
    logger,
  });

  console.log('Status:', JSON.stringify(dispatcher.status(), null, 2));

  const recipient = Keypair.generate().publicKey; // destinatário novo (ATA criada sob demanda)
  const symbol = process.env.TEST_SYMBOL ?? 'BDC';
  const amount = process.env.TEST_AMOUNT ?? '12.5';
  console.log(`\nEnviando ${amount} ${symbol} -> ${recipient.toBase58()} ...`);

  const result = await dispatcher.send({
    orderId: 'devnet-test-order',
    assetSymbol: symbol,
    tokenAmount: amount,
    toAddress: recipient.toBase58(),
    network: 'solana',
  });

  console.log('\nResultado:', result);
  console.log(`Explorer: https://explorer.solana.com/tx/${result.txHash}?cluster=devnet`);

  // Confirma on-chain que o destinatário recebeu.
  const conn = new Connection(env.SOLANA_DISPATCH_RPC_URL, 'confirmed');
  const mint = new PublicKey(env.SOLANA_TOKEN_MINTS[symbol.toUpperCase()]!);
  const ata = await getAssociatedTokenAddress(mint, recipient);
  const acc = await getAccount(conn, ata, 'confirmed');
  console.log(`\nSaldo on-chain do destinatário: ${acc.amount} unidades-base (esperado 12.5 * 10^6 = 12500000)`);
  if (result.simulated) throw new Error('ERRO: resultado veio como simulado!');
  if (acc.amount !== 12_500_000n) throw new Error(`ERRO: saldo inesperado ${acc.amount}`);
  console.log('\nOK — transferência on-chain real confirmada em devnet.');
}

main().catch((e) => {
  console.error('FALHOU:', e?.message ?? e);
  process.exit(1);
});
