// Função serverless da Vercel que embrulha a API Express (backend compilado em backend/dist).
// O bootstrap (env → banco → migrations → seed) roda uma única vez por instância (cold start)
// e é reaproveitado nas invocações seguintes.
import { createApp } from '../backend/dist/app.js';
import { loadEnv } from '../backend/dist/config/env.js';
import { createDatabase } from '../backend/dist/db/client.js';
import { seedNativeTokens } from '../backend/dist/db/seed.js';
import { LivePriceFeed } from '../backend/dist/modules/tokens/live-price-feed.js';
import { createLogger } from '../backend/dist/shared/logger.js';

let appPromise;

// No serverless não há processo residente para o setInterval do feed de preços:
// o tick roda sob demanda, no máximo uma vez por intervalo, disparado pelas invocações.
let priceFeed = null;
let refreshIntervalMs = 0;
let lastTickAt = 0;
let ticking = false;
let feedLogger = null;

function refreshPricesOnDemand() {
  if (!priceFeed || ticking || Date.now() - lastTickAt < refreshIntervalMs) return;
  ticking = true;
  priceFeed
    .tick()
    .then(() => { lastTickAt = Date.now(); })
    .catch((err) => feedLogger?.warn({ err }, 'Falha ao atualizar preços reais (tick sob demanda)'))
    .finally(() => { ticking = false; });
}

async function bootstrap() {
  const env = loadEnv();
  const logger = createLogger(env.LOG_LEVEL);
  const database = await createDatabase(env.DATABASE_URL, { ssl: env.DATABASE_SSL });
  await database.migrate();
  await seedNativeTokens(database.db);

  if (env.PRICE_FEED_MODE === 'live') {
    priceFeed = new LivePriceFeed(database.db, logger);
    feedLogger = logger;
    refreshIntervalMs = Math.max(env.PRICE_FEED_INTERVAL_MS, 15_000);
    // Primeiro tick ainda no cold start: substitui o preço do seed antes de cotar ordens.
    try {
      await priceFeed.tick();
      lastTickAt = Date.now();
    } catch (err) {
      logger.warn({ err }, 'Preços reais indisponíveis no boot; usando os persistidos');
    }
  }

  logger.info({ driver: database.driver }, 'Banco pronto (serverless)');
  return createApp({ env, database, logger }).app;
}

export default async function handler(req, res) {
  try {
    appPromise ??= bootstrap();
    const app = await appPromise;
    refreshPricesOnDemand();
    return app(req, res);
  } catch (err) {
    // Bootstrap falhou (ex.: variável de ambiente faltando): permite nova tentativa no próximo request.
    appPromise = undefined;
    console.error('Falha ao iniciar a API:', err);
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: 'Falha ao iniciar a API. Verifique as variáveis de ambiente no painel da Vercel.' }));
  }
}
