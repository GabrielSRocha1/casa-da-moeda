// Função serverless da Vercel que embrulha a API Express (backend compilado em backend/dist).
// O bootstrap (env → banco → migrations → seed) roda uma única vez por instância (cold start)
// e é reaproveitado nas invocações seguintes.
import { createApp } from '../backend/dist/app.js';
import { loadEnv } from '../backend/dist/config/env.js';
import { createDatabase } from '../backend/dist/db/client.js';
import { seedNativeTokens } from '../backend/dist/db/seed.js';
import { createLogger } from '../backend/dist/shared/logger.js';

let appPromise;

async function bootstrap() {
  const env = loadEnv();
  const logger = createLogger(env.LOG_LEVEL);
  const database = await createDatabase(env.DATABASE_URL, { ssl: env.DATABASE_SSL });
  await database.migrate();
  await seedNativeTokens(database.db);
  logger.info({ driver: database.driver }, 'Banco pronto (serverless)');
  return createApp({ env, database, logger }).app;
}

export default async function handler(req, res) {
  try {
    appPromise ??= bootstrap();
    const app = await appPromise;
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
