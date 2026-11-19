import { NATIVE_TOKENS } from '../config/constants.js';
import { percentChange } from '../shared/money.js';
import type { Database } from './client.js';
import { tokens } from './schema.js';

/**
 * Seed idempotente dos três ativos nativos.
 * Se o token já existir, nada é alterado (preserva preços atualizados pelo oráculo).
 */
export async function seedNativeTokens(db: Database): Promise<number> {
  const rows = NATIVE_TOKENS.map((t, i) => ({
    name: t.name,
    symbol: t.symbol,
    price: t.price,
    referencePrice24h: t.referencePrice24h,
    change24h: percentChange(t.referencePrice24h, t.price),
    type: 'NATIVE' as const,
    status: 'ACTIVE' as const,
    decimals: 8,
    sortOrder: i + 1,
    description: t.description,
    iconUrl: t.iconUrl,
  }));
  const inserted = await db.insert(tokens).values(rows).onConflictDoNothing({ target: tokens.symbol }).returning({ id: tokens.id });
  return inserted.length;
}
