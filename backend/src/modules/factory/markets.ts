import { LATEST_USD_PRICES } from '../tokens/live-price-feed.js';
import type { Logger } from '../../shared/logger.js';

/**
 * Dados de mercado para o terminal do contrato (aba Perpétuos):
 *   - Majors (SOL/ETH/BTC): preço USD real + variação 24h via CoinGecko (server-side,
 *     evita CORS no navegador), cacheado por 30 s.
 *   - Tokens do projeto (BDC/VRC/ESCT): preço USD real on-chain, do feed ao vivo
 *     (`LATEST_USD_PRICES`, alimentado por Jupiter/DexScreener).
 */

export interface MarketCoin {
  sym: string;
  name: string;
  icon: string;
  source: 'market' | 'onchain';
  priceUsd: number | null;
  change24h: number | null;
}

const MAJORS: { sym: string; name: string; icon: string; id: string }[] = [
  { sym: 'SOL', name: 'Solana', icon: '◎', id: 'solana' },
  { sym: 'ETH', name: 'Ethereum', icon: '◆', id: 'ethereum' },
  { sym: 'BTC', name: 'Bitcoin', icon: '₿', id: 'bitcoin' },
];

const PROJECT: { sym: string; name: string; icon: string }[] = [
  { sym: 'BDC', name: 'BDC', icon: 'B' },
  { sym: 'VRC', name: 'VRC', icon: 'V' },
  { sym: 'ESCT', name: 'ESCT', icon: 'E' },
];

const CACHE_MS = 30_000;
const HTTP_TIMEOUT_MS = 10_000;

let cache: { at: number; coins: MarketCoin[] } | null = null;

async function fetchMajors(logger?: Logger): Promise<Map<string, { usd: number; change: number | null }>> {
  const out = new Map<string, { usd: number; change: number | null }>();
  try {
    const ids = MAJORS.map((m) => m.id).join(',');
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`;
    const res = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as Record<string, { usd?: number; usd_24h_change?: number }>;
    for (const m of MAJORS) {
      const row = json[m.id];
      if (row && typeof row.usd === 'number') {
        out.set(m.sym, { usd: row.usd, change: typeof row.usd_24h_change === 'number' ? row.usd_24h_change : null });
      }
    }
  } catch (err) {
    logger?.warn({ err: String(err) }, 'markets: falha ao buscar majors (CoinGecko)');
  }
  return out;
}

export async function getMarkets(logger?: Logger): Promise<{ coins: MarketCoin[]; updatedAt: number }> {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_MS) return { coins: cache.coins, updatedAt: cache.at };

  const majors = await fetchMajors(logger);
  const coins: MarketCoin[] = [];

  for (const m of MAJORS) {
    const q = majors.get(m.sym);
    coins.push({ sym: m.sym, name: m.name, icon: m.icon, source: 'market', priceUsd: q?.usd ?? null, change24h: q?.change ?? null });
  }
  for (const t of PROJECT) {
    const raw = LATEST_USD_PRICES.get(t.sym) ?? LATEST_USD_PRICES.get(t.sym.toUpperCase());
    const price = raw != null ? Number(raw) : null;
    coins.push({ sym: t.sym, name: t.name, icon: t.icon, source: 'onchain', priceUsd: Number.isFinite(price as number) ? price : null, change24h: null });
  }

  cache = { at: now, coins };
  return { coins, updatedAt: now };
}
