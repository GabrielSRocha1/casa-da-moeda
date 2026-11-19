import { createApp } from './app.js';
import { loadEnv } from './config/env.js';
import { createDatabase } from './db/client.js';
import { seedNativeTokens } from './db/seed.js';
import { LivePriceFeed } from './modules/tokens/live-price-feed.js';
import { SimulatedPriceFeed } from './modules/tokens/price-feed.js';
import { createLogger } from './shared/logger.js';

/**
 * Ponto de entrada: carrega ambiente → conecta banco → aplica migrations → seed
 * → sobe HTTP → oráculo de preços → encerramento gracioso.
 */
async function bootstrap() {
  const env = loadEnv();
  const logger = createLogger(env.LOG_LEVEL);

  const database = await createDatabase(env.DATABASE_URL, { ssl: env.DATABASE_SSL });
  await database.migrate();
  const seeded = await seedNativeTokens(database.db);
  logger.info({ driver: database.driver, seeded }, 'Banco de dados pronto');

  const { app } = createApp({ env, database, logger });
  const server = app.listen(env.PORT, () => {
    logger.info(`🚀 Casa da Moeda Master Digital API em http://localhost:${env.PORT}/api`);
  });

  // Preços reais (RPC/APIs públicas) por padrão; 'simulated' fica restrito a desenvolvimento.
  const priceFeed =
    env.PRICE_FEED_MODE === 'live' ? new LivePriceFeed(database.db, logger) : new SimulatedPriceFeed(database.db, logger);
  if (env.PRICE_FEED_MODE === 'live' || env.NODE_ENV !== 'production') priceFeed.start(env.PRICE_FEED_INTERVAL_MS);

  const shutdown = (signal: string) => {
    logger.info({ signal }, 'Encerrando…');
    priceFeed.stop();
    server.close(async () => {
      await database.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

bootstrap().catch((err) => {
  console.error('Falha ao iniciar a API:', err);
  process.exit(1);
});
