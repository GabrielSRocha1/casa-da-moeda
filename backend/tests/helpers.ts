import { randomBytes } from 'node:crypto';
import { ed25519 } from '@noble/curves/ed25519';
import bs58 from 'bs58';
import { createApp, type AppDeps } from '../src/app.js';
import { loadEnv } from '../src/config/env.js';
import { createDatabase } from '../src/db/client.js';
import { seedNativeTokens } from '../src/db/seed.js';
import { createLogger } from '../src/shared/logger.js';

export const WEBHOOK_SECRET = 'test-webhook-secret-123456';

/** Sobe a API com um Postgres em memória (PGlite), migrations e seed aplicados. */
export async function buildTestApp(envOverrides: Record<string, unknown> = {}, extra: Partial<AppDeps> = {}) {
  const env = loadEnv({
    NODE_ENV: 'test',
    DATABASE_URL: 'memory://',
    LOG_LEVEL: 'silent',
    RATE_LIMIT_ENABLED: 'false',
    WEBHOOK_SECRET,
    AUTO_SETTLE: 'false',
    // Testes nunca fazem transferências on-chain reais; isola do .env local.
    DISPATCHER_MODE: 'simulated',
    ...envOverrides,
  });
  const database = await createDatabase(env.DATABASE_URL);
  await database.migrate();
  await seedNativeTokens(database.db);
  const logger = createLogger('silent');
  const container = createApp({ env, database, logger, ...extra });
  return { ...container, env, database, close: () => database.close() };
}

/** Endereço Solana válido (chave pública Ed25519 real, na curva). */
export function solanaAddress(): string {
  return bs58.encode(ed25519.getPublicKey(ed25519.utils.randomPrivateKey()));
}

/** Endereço Solana fora da curva Ed25519 (formato de PDA). */
export function offCurveSolanaAddress(): string {
  for (;;) {
    const bytes = randomBytes(32);
    try {
      ed25519.ExtendedPoint.fromHex(bytes);
    } catch {
      return bs58.encode(bytes);
    }
  }
}

/** Exemplo oficial da EIP-55 (checksum correto). */
export const EVM_CHECKSUMMED = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed';
