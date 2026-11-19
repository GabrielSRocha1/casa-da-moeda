import { and, asc, eq } from 'drizzle-orm';
import { NATIVE_TOKEN_ONCHAIN } from '../../config/constants.js';
import type { Database } from '../../db/client.js';
import { tokens, type Token } from '../../db/schema.js';
import { badGateway, notFound } from '../../shared/errors.js';
import { LATEST_USD_PRICES } from './live-price-feed.js';
import type { SolanaRpcClient, TokenMovement, TokenSupply } from './solana-rpc.js';

export interface TokenDTO {
  id: string;
  name: string;
  symbol: string;
  type: 'NATIVE' | 'CUSTOM';
  status: 'ACTIVE' | 'PAUSED';
  /** Preço de referência em USD, string decimal exata (null até o feed ao vivo cotar). */
  priceUsd: string | null;
  /** Preço de referência em BRL, string decimal exata (ex.: "0.85000000") — moeda do P2P/Pix. */
  price: string;
  priceCurrency: 'BRL';
  /** Variação 24h em % (ex.: 4.2 ou -2.1). */
  change24h: number;
  trend: 'UP' | 'DOWN' | 'FLAT';
  decimals: number;
  description: string | null;
  iconUrl: string | null;
  updatedAt: string;
  /** Dados on-chain (apenas tokens nativos com contrato público na Solana). */
  chain: string | null;
  mintAddress: string | null;
  explorerUrl: string | null;
}

/** Movimentação on-chain recente de um token nativo. */
export interface TokenActivityDTO {
  symbol: string;
  chain: string;
  mint: string;
  explorerUrl: string;
  supply: { amount: string; decimals: number } | null;
  movements: TokenMovement[];
  fetchedAt: string;
}

export function toTokenDTO(t: Token): TokenDTO {
  const change = Number(t.change24h);
  const onchain = NATIVE_TOKEN_ONCHAIN.get(t.symbol);
  return {
    chain: onchain?.chain ?? null,
    mintAddress: onchain?.mint ?? null,
    explorerUrl: onchain?.explorerUrl ?? null,
    priceUsd: LATEST_USD_PRICES.get(t.symbol) ?? null,
    id: t.id,
    name: t.name,
    symbol: t.symbol,
    type: t.type,
    status: t.status,
    price: t.price,
    priceCurrency: 'BRL',
    change24h: Math.round(change * 100) / 100,
    trend: change > 0 ? 'UP' : change < 0 ? 'DOWN' : 'FLAT',
    decimals: t.decimals,
    description: t.description,
    iconUrl: t.iconUrl,
    updatedAt: t.updatedAt.toISOString(),
  };
}

/** Normaliza e valida o formato de um símbolo de token. */
export function normalizeSymbol(symbol: string): string {
  return symbol.trim().toUpperCase();
}

const ACTIVITY_CACHE_MS = 30_000; // protege a RPC pública de rajadas de requisições

export class TokensService {
  private readonly activityCache = new Map<string, { at: number; data: TokenActivityDTO }>();

  constructor(
    private readonly db: Database,
    private readonly solana?: SolanaRpcClient,
  ) {}

  /** Lista tokens ativos. Padrão: apenas os nativos (Bode, Verum, Escoteiros). */
  async list(type: 'NATIVE' | 'CUSTOM' = 'NATIVE'): Promise<TokenDTO[]> {
    const rows = await this.db
      .select()
      .from(tokens)
      .where(and(eq(tokens.type, type), eq(tokens.status, 'ACTIVE')))
      .orderBy(asc(tokens.sortOrder), asc(tokens.symbol));
    return rows.map(toTokenDTO);
  }

  async findBySymbol(symbol: string): Promise<Token | undefined> {
    const [row] = await this.db.select().from(tokens).where(eq(tokens.symbol, normalizeSymbol(symbol))).limit(1);
    return row;
  }

  async getBySymbol(symbol: string): Promise<TokenDTO> {
    const row = await this.findBySymbol(symbol);
    if (!row) throw notFound('TOKEN_NOT_FOUND', `Token "${normalizeSymbol(symbol)}" não encontrado.`);
    return toTokenDTO(row);
  }

  /** Token apto a ser negociado no P2P (existe e está ACTIVE). */
  async getTradable(symbol: string): Promise<Token> {
    const row = await this.findBySymbol(symbol);
    if (!row) throw notFound('TOKEN_NOT_FOUND', `Token "${normalizeSymbol(symbol)}" não encontrado.`);
    if (row.status !== 'ACTIVE') {
      throw notFound('TOKEN_NOT_TRADABLE', `Token "${row.symbol}" está temporariamente indisponível para compra.`);
    }
    return row;
  }

  /**
   * Movimentação on-chain recente (RPC pública da Solana) de um token nativo.
   * Resultado cacheado por 30 s por símbolo/limite.
   */
  async getActivity(symbol: string, limit: number): Promise<TokenActivityDTO> {
    const token = await this.getBySymbol(symbol); // 404 se não existir
    const onchain = NATIVE_TOKEN_ONCHAIN.get(token.symbol);
    if (!onchain || !this.solana) {
      throw notFound('TOKEN_WITHOUT_ONCHAIN_DATA', `Token "${token.symbol}" não possui contrato on-chain rastreável.`);
    }

    const cacheKey = `${token.symbol}:${limit}`;
    const cached = this.activityCache.get(cacheKey);
    if (cached && Date.now() - cached.at < ACTIVITY_CACHE_MS) return cached.data;

    let supply: TokenSupply | null = null;
    let movements: TokenMovement[];
    try {
      [supply, movements] = await Promise.all([
        this.solana.getTokenSupply(onchain.mint).catch(() => null),
        this.solana.getRecentMovements(onchain.mint, limit),
      ]);
    } catch (err) {
      throw badGateway('SOLANA_RPC_UNAVAILABLE', `RPC da Solana indisponível no momento: ${(err as Error).message}`);
    }

    const data: TokenActivityDTO = {
      symbol: token.symbol,
      chain: onchain.chain,
      mint: onchain.mint,
      explorerUrl: onchain.explorerUrl,
      supply: supply ? { amount: supply.uiAmountString, decimals: supply.decimals } : null,
      movements,
      fetchedAt: new Date().toISOString(),
    };
    this.activityCache.set(cacheKey, { at: Date.now(), data });
    return data;
  }
}
