import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import { migrate as migratePg } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import * as schema from './schema.js';

/** Tipo comum aos dois drivers (PGlite em dev/teste, node-postgres em produção). */
export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;

export interface DatabaseHandle {
  db: Database;
  driver: 'pglite' | 'postgres';
  migrate: () => Promise<void>;
  ping: () => Promise<void>;
  close: () => Promise<void>;
}

const MIGRATIONS_FOLDER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../drizzle');

/**
 * Cria a conexão com o banco a partir de DATABASE_URL:
 *  - postgres:// | postgresql://  → Postgres real (Supabase, RDS, Docker)
 *  - pglite://<pasta>             → Postgres embutido persistido em disco (dev)
 *  - memory://                    → Postgres embutido em memória (testes)
 */
export async function createDatabase(url: string, opts: { ssl?: boolean } = {}): Promise<DatabaseHandle> {
  if (/^postgres(ql)?:\/\//i.test(url)) {
    const pool = new pg.Pool({
      connectionString: url,
      max: 10,
      ssl: opts.ssl ? { rejectUnauthorized: false } : undefined,
    });
    const db = drizzlePg(pool, { schema }) as unknown as Database;
    return {
      db,
      driver: 'postgres',
      migrate: () => migratePg(drizzlePg(pool), { migrationsFolder: MIGRATIONS_FOLDER }),
      ping: async () => {
        await pool.query('select 1');
      },
      close: () => pool.end(),
    };
  }

  let dataDir: string | undefined;
  if (url.startsWith('memory://')) dataDir = undefined;
  else if (url.startsWith('pglite://')) dataDir = url.slice('pglite://'.length) || './data/pglite';
  else throw new Error(`DATABASE_URL não suportada: ${url.split(':')[0]}://`);

  // Cria a pasta-pai (ex.: ./data) caso ainda não exista.
  if (dataDir) mkdirSync(path.dirname(path.resolve(dataDir)), { recursive: true });
  const client = new PGlite(dataDir);
  await client.waitReady;
  const pgliteDb = drizzlePglite(client, { schema });
  return {
    db: pgliteDb as unknown as Database,
    driver: 'pglite',
    migrate: () => migratePglite(pgliteDb, { migrationsFolder: MIGRATIONS_FOLDER }),
    ping: async () => {
      await client.query('select 1');
    },
    close: () => client.close(),
  };
}
