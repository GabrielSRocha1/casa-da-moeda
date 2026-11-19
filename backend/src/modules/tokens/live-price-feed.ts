import { eq, sql } from 'drizzle-orm';
import { NATIVE_TOKEN_ONCHAIN } from '../../config/constants.js';
import type { Database } from '../../db/client.js';
import { tokens } from '../../db/schema.js';
import type { Logger } from '../../shared/logger.js';

/**
 * Feed de preços REAL dos tokens nativos (BDC, VRC, ESCT) na Solana.
 *
 * Fontes públicas, em cascata:
 *   1. Jupiter Price API (lite-api.jup.ag) — preço agregado dos pools on-chain;
 *   2. DexScreener — fallback por token quando o Jupiter não cobre o mint;
 *   3. Câmbio USD→BRL: AwesomeAPI (economia.awesomeapi.com.br) com fallback
 *      open.er-api.com, cacheado por 10 minutos.
 *
 * Mantém a mesma interface do SimulatedPriceFeed (tick/start/stop).
 */

interface UsdQuote {
  usd: number;
  change24h: number | null;
}

const FX_CACHE_MS = 10 * 60 * 1000;
const HTTP_TIMEOUT_MS = 10_000;

/**
 * Último preço em USD por símbolo, atualizado pelo feed ao vivo.
 * Lido pelo DTO de tokens para expor `priceUsd` sem alterar o schema do banco
 * (o preço persistido continua em BRL, que é a moeda do P2P/Pix).
 */
export const LATEST_USD_PRICES = new Map<string, string>();

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} em ${new URL(url).host}`);
  return res.json();
}

const ICON_SYNC_MAX_ATTEMPTS = 5;

/** Gateways IPFS públicos, em ordem de preferência (ipfs.io costuma responder 429). */
const IPFS_GATEWAYS = [
  'https://gateway.lighthouse.storage/ipfs/',
  'https://ipfs.filebase.io/ipfs/',
  'https://gateway.pinata.cloud/ipfs/',
  'https://ipfs.io/ipfs/',
];

/** Para URLs IPFS, gera a mesma imagem em vários gateways; outras URLs ficam como estão. */
function ipfsCandidates(url: string): string[] {
  const m = url.match(/\/ipfs\/([^?#]+)/);
  if (!m) return [url];
  const alternates = IPFS_GATEWAYS.map((g) => g + m[1]).filter((u) => u !== url);
  return [url, ...alternates];
}

/** Devolve a primeira URL que responde com uma imagem de verdade (ou null). */
async function resolveWorkingImage(url: string): Promise<string | null> {
  for (const candidate of ipfsCandidates(url)) {
    try {
      const res = await fetch(candidate, { signal: AbortSignal.timeout(10_000) });
      const type = res.headers.get('content-type') ?? '';
      if (res.ok && type.startsWith('image/')) {
        await res.body?.cancel();
        return candidate;
      }
    } catch {
      // tenta o próximo gateway
    }
  }
  return null;
}

export class LivePriceFeed {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private fx: { rate: number; at: number } | null = null;
  private iconsDone = false;
  private iconAttempts = 0;

  constructor(
    private readonly db: Database,
    private readonly logger: Logger,
  ) {}

  async tick(): Promise<void> {
    await this.syncIcons();
    const entries = [...NATIVE_TOKEN_ONCHAIN.entries()];
    const quotes = await this.fetchUsdQuotes(entries.map(([, info]) => info.mint));
    const usdBrl = await this.getUsdBrl();

    for (const [symbol, info] of entries) {
      const quote = quotes.get(info.mint);
      if (!quote) {
        this.logger.warn({ symbol, mint: info.mint }, 'Sem cotação nas fontes públicas; preço anterior mantido');
        continue;
      }
      const priceBrl = quote.usd * usdBrl;
      if (!Number.isFinite(priceBrl) || priceBrl <= 0) continue;
      LATEST_USD_PRICES.set(symbol, quote.usd.toFixed(8));
      const price = priceBrl.toFixed(8);
      const change = quote.change24h !== null && Number.isFinite(quote.change24h) ? quote.change24h : 0;
      // Referência de 24h coerente com a variação informada pela fonte.
      const reference = change > -99.99 ? (priceBrl / (1 + change / 100)).toFixed(8) : price;
      await this.db
        .update(tokens)
        .set({ price, change24h: change.toFixed(4), referencePrice24h: reference, updatedAt: sql`now()` })
        .where(eq(tokens.symbol, symbol));
    }
  }

  /**
   * Ícones reais dos tokens (metadados on-chain via Jupiter Token API, IPFS).
   * Roda nos primeiros ticks até conseguir todos (máx. 5 tentativas).
   */
  private async syncIcons(): Promise<void> {
    if (this.iconsDone || this.iconAttempts >= ICON_SYNC_MAX_ATTEMPTS) return;
    this.iconAttempts += 1;
    let missing = 0;
    for (const [symbol, info] of NATIVE_TOKEN_ONCHAIN) {
      try {
        const data = (await getJson(`https://lite-api.jup.ag/tokens/v2/search?query=${info.mint}`)) as Array<{
          id?: string;
          icon?: string;
        }>;
        const icon = Array.isArray(data) ? data.find((t) => t.id === info.mint)?.icon : undefined;
        const working = icon && /^https:\/\//.test(icon) ? await resolveWorkingImage(icon) : null;
        if (working) {
          await this.db.update(tokens).set({ iconUrl: working, updatedAt: sql`now()` }).where(eq(tokens.symbol, symbol));
        } else {
          missing += 1;
        }
      } catch {
        missing += 1;
      }
    }
    if (missing === 0) {
      this.iconsDone = true;
      this.logger.info('Ícones reais dos tokens sincronizados (metadados on-chain)');
    }
  }

  /** Jupiter para todos os mints; DexScreener cobre os que faltarem. */
  private async fetchUsdQuotes(mints: string[]): Promise<Map<string, UsdQuote>> {
    const quotes = new Map<string, UsdQuote>();

    try {
      const data = (await getJson(`https://lite-api.jup.ag/price/v3?ids=${mints.join(',')}`)) as Record<
        string,
        { usdPrice?: number; priceChange24h?: number } | undefined
      >;
      for (const mint of mints) {
        const q = data[mint];
        if (q?.usdPrice && q.usdPrice > 0) {
          quotes.set(mint, { usd: q.usdPrice, change24h: q.priceChange24h ?? null });
        }
      }
    } catch (err) {
      this.logger.warn({ err }, 'Jupiter Price API indisponível; tentando DexScreener');
    }

    const missing = mints.filter((m) => !quotes.has(m));
    if (missing.length > 0) {
      try {
        const pairs = (await getJson(`https://api.dexscreener.com/tokens/v1/solana/${missing.join(',')}`)) as Array<{
          baseToken?: { address?: string };
          priceUsd?: string;
          liquidity?: { usd?: number };
          priceChange?: { h24?: number };
        }>;
        // Por token, fica o par de maior liquidez.
        const best = new Map<string, { liq: number; quote: UsdQuote }>();
        for (const p of Array.isArray(pairs) ? pairs : []) {
          const mint = p.baseToken?.address;
          const usd = Number(p.priceUsd);
          if (!mint || !missing.includes(mint) || !Number.isFinite(usd) || usd <= 0) continue;
          const liq = p.liquidity?.usd ?? 0;
          const current = best.get(mint);
          if (!current || liq > current.liq) best.set(mint, { liq, quote: { usd, change24h: p.priceChange?.h24 ?? null } });
        }
        for (const [mint, { quote }] of best) quotes.set(mint, quote);
      } catch (err) {
        this.logger.warn({ err }, 'DexScreener indisponível');
      }
    }
    return quotes;
  }

  private async getUsdBrl(): Promise<number> {
    if (this.fx && Date.now() - this.fx.at < FX_CACHE_MS) return this.fx.rate;
    let rate: number | null = null;
    try {
      const data = (await getJson('https://economia.awesomeapi.com.br/json/last/USD-BRL')) as {
        USDBRL?: { bid?: string };
      };
      const bid = Number(data.USDBRL?.bid);
      if (Number.isFinite(bid) && bid > 0) rate = bid;
    } catch {
      // tenta o fallback abaixo
    }
    if (rate === null) {
      try {
        const data = (await getJson('https://open.er-api.com/v6/latest/USD')) as { rates?: { BRL?: number } };
        const brl = data.rates?.BRL;
        if (typeof brl === 'number' && brl > 0) rate = brl;
      } catch {
        // sem fonte de câmbio agora
      }
    }
    if (rate === null) {
      if (this.fx) return this.fx.rate; // usa o último conhecido, mesmo vencido
      throw new Error('Nenhuma fonte de câmbio USD→BRL disponível');
    }
    this.fx = { rate, at: Date.now() };
    return rate;
  }

  start(intervalMs: number): void {
    if (intervalMs <= 0 || this.timer) return;
    const run = () => {
      if (this.running) return; // evita ticks sobrepostos em redes lentas
      this.running = true;
      this.tick()
        .catch((err) => this.logger.error({ err }, 'Falha ao atualizar preços reais'))
        .finally(() => { this.running = false; });
    };
    run(); // primeira atualização imediata (substitui o preço do seed)
    this.timer = setInterval(run, intervalMs);
    this.timer.unref();
    this.logger.info({ intervalMs }, 'Feed de preços reais (Solana) ativo');
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
