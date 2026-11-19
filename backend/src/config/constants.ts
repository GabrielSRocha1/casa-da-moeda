/**
 * Constantes de domínio da Casa da Moeda Master Digital.
 */

/** Aviso legal obrigatório — texto idêntico ao exibido no frontend. */
export const LEGAL_DISCLAIMER =
  'Aviso importante: O investimento em ativos digitais oferecidos nesta plataforma não garante lucro. Os ativos listados são estritamente Utility Tokens (tokens de utilidade), não possuindo valor imobiliário, mobiliário ou de garantia financeira. Sua finalidade é exclusivamente educacional, comunitária e de uso interno no ecossistema. A valorização ou flutuação do ativo depende exclusivamente do engajamento e comprimento da comunidade.';

/** Versão das normas de utilidade às quais todo token B2B é vinculado. */
export const UTILITY_TERMS_VERSION = '2026-11-v1';

/** Classe de utilidade aplicada a todos os tokens da plataforma. */
export const UTILITY_CLASS = 'UTILITY_COMMUNITY_EDUCATIONAL';

/** Casas decimais usadas para preços e quantidades de token. */
export const TOKEN_SCALE = 8;

/**
 * Ativos nativos (usados no seed do banco).
 * `mint` é o endereço SPL na Solana mainnet — fonte dos preços e da movimentação
 * reais (feed on-chain). Os preços abaixo são apenas o valor inicial do seed;
 * o feed ao vivo os substitui logo no boot.
 */
export const NATIVE_TOKENS = [
  {
    name: 'Bode Coin',
    symbol: 'BDC',
    chain: 'solana',
    mint: 'AeAQdgjGqtHErysb5FBvUxNxmob2mVBGnEXdmULJ7dH9',
    price: '0.85000000',
    referencePrice24h: '0.81573896',
    description: 'O token da resistência e da força do sertão. Usado em feiras, eventos e no comércio da comunidade.',
    iconUrl: '/assets/tokens/bode.svg',
  },
  {
    name: 'Verum Coin',
    symbol: 'VRC',
    chain: 'solana',
    mint: '42NcQ9VEaWe8WaKFdbDxqLXsJTqPj2gMArAk7c5ZkgxY',
    price: '3.40000000',
    referencePrice24h: '3.33988212',
    description: 'Token de utilidade do ecossistema Verum: acesso a serviços, descontos e governança comunitária.',
    iconUrl: '/assets/tokens/verum.svg',
  },
  {
    name: 'Escoteiros Coin',
    symbol: 'ESCT',
    chain: 'solana',
    mint: 'Ctauy54NbyabVqGXHuY5wwVEAh29mGhh5KGfif5jppZt',
    price: '0.52000000',
    referencePrice24h: '0.53115424',
    description: 'Recompensa atividades educativas, ações sociais e projetos de grupos de jovens e voluntários.',
    iconUrl: '/assets/tokens/escoteiros.svg',
  },
] as const;

export interface NativeTokenOnchainInfo {
  chain: string;
  mint: string;
  explorerUrl: string;
}

/** Mapa símbolo → dados on-chain dos ativos nativos. */
export const NATIVE_TOKEN_ONCHAIN: ReadonlyMap<string, NativeTokenOnchainInfo> = new Map(
  NATIVE_TOKENS.map((t) => [t.symbol, { chain: t.chain, mint: t.mint, explorerUrl: `https://solscan.io/token/${t.mint}` }]),
);

/** Categorias aceitas na emissão B2B. */
export const BUSINESS_CATEGORIES = {
  EMPRESAS: 'Empresas e negócios',
  FESTAS_SERTANEJAS: 'Eventos e festas sertanejas',
  FUTEBOL: 'Times de futebol e esportes',
  FEIRAS_CULTURAIS: 'Feiras culturais',
  AJUDA_HUMANITARIA: 'Instituições de ajuda humanitária / ONGs',
} as const;

export type BusinessCategory = keyof typeof BUSINESS_CATEGORIES;

/**
 * Símbolos que nenhum token B2B pode usar: nativos + ativos/moedas conhecidos
 * (evita confusão e tentativa de se passar por outro ativo).
 */
export const RESERVED_SYMBOLS = new Set([
  ...NATIVE_TOKENS.map((t) => t.symbol),
  // Símbolos legados dos ativos nativos (antes do alinhamento com os tickers on-chain).
  'BODE', 'VRM', 'ESC',
  'BTC', 'ETH', 'SOL', 'USDT', 'USDC', 'BNB', 'XRP', 'ADA', 'DOGE', 'TRX', 'DAI', 'MATIC', 'POL',
  'BRL', 'BRZ', 'USD', 'EUR', 'PYG', 'DREX', 'PIX', 'CMMD',
]);
