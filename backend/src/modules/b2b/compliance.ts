import {
  BUSINESS_CATEGORIES,
  LEGAL_DISCLAIMER,
  UTILITY_CLASS,
  UTILITY_TERMS_VERSION,
  type BusinessCategory,
} from '../../config/constants.js';

/**
 * Normas de utilidade interna.
 * Todo token B2B é registrado como Utility Token comunitário/educacional:
 * sem promessa de lucro, sem caráter de valor mobiliário e sem garantia financeira.
 */

const strip = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

/**
 * Expressões que caracterizam promessa de rendimento ou oferta de investimento.
 * O texto é comparado sem acentos e em minúsculas.
 */
const FORBIDDEN_PATTERNS: { label: string; re: RegExp }[] = [
  { label: 'promessa de lucro', re: /\b(lucro (garantido|certo|assegurado)|garantia de lucro|lucros? garantidos?)\b/ },
  { label: 'rendimento garantido', re: /\brendimentos? (garantidos?|fixos?|mensa(l|is)|assegurados?)\b/ },
  { label: 'retorno garantido', re: /\bretorno( financeiro)? (garantido|certo|assegurado)\b|\bretorno de \d+ ?%/ },
  { label: 'rentabilidade periódica', re: /\b\d+([.,]\d+)? ?% ?(ao|por|a cada) ?(dia|semana|mes|ano)\b/ },
  { label: 'dividendos / participação nos lucros', re: /\b(dividendos?|participacao nos lucros|distribuicao de lucros)\b/ },
  { label: 'renda passiva', re: /\brenda passiva\b/ },
  { label: 'valorização garantida', re: /\b(valorizacao (garantida|certa)|vai valorizar|valorizacao de \d+)/ },
  { label: 'investimento sem risco', re: /\b(investimento (seguro|sem risco|garantido)|sem risco|risco zero)\b/ },
  { label: 'multiplicação de dinheiro', re: /\b(multiplic(ar|a|que) (o |seu )?dinheiro|dobr(ar|e|a) (o |seu )?dinheiro|fique rico|enriquec)/ },
  { label: 'participação societária', re: /\b(participacao societaria|cotas? da empresa|acoes da empresa|equity)\b/ },
];

/** Retorna os rótulos das regras violadas (vazio = conforme). */
export function findComplianceViolations(...texts: string[]): string[] {
  const normalized = strip(texts.join(' \n '));
  return FORBIDDEN_PATTERNS.filter((p) => p.re.test(normalized)).map((p) => p.label);
}

/** Aceita o código (EMPRESAS) ou o rótulo usado no frontend ("Festas Sertanejas", "Ajuda Humanitária"...). */
const CATEGORY_ALIASES: Record<string, BusinessCategory> = {
  empresas: 'EMPRESAS',
  empresa: 'EMPRESAS',
  negocios: 'EMPRESAS',
  'empresas e negocios': 'EMPRESAS',
  'festas sertanejas': 'FESTAS_SERTANEJAS',
  'festa sertaneja': 'FESTAS_SERTANEJAS',
  eventos: 'FESTAS_SERTANEJAS',
  'eventos e festas sertanejas': 'FESTAS_SERTANEJAS',
  futebol: 'FUTEBOL',
  esportes: 'FUTEBOL',
  'times de futebol': 'FUTEBOL',
  'times de futebol e esportes': 'FUTEBOL',
  'feiras culturais': 'FEIRAS_CULTURAIS',
  'feira cultural': 'FEIRAS_CULTURAIS',
  'ajuda humanitaria': 'AJUDA_HUMANITARIA',
  ong: 'AJUDA_HUMANITARIA',
  ongs: 'AJUDA_HUMANITARIA',
  'instituicoes de ajuda humanitaria / ongs': 'AJUDA_HUMANITARIA',
  'ajuda humanitaria / ongs': 'AJUDA_HUMANITARIA',
};

export function normalizeCategory(input: string): BusinessCategory | null {
  const code = input.trim().toUpperCase().replace(/[\s-]+/g, '_');
  if (code in BUSINESS_CATEGORIES) return code as BusinessCategory;
  return CATEGORY_ALIASES[strip(input).trim().replace(/\s+/g, ' ')] ?? null;
}

/** Registro de conformidade gravado junto com a solicitação. */
export function buildComplianceRecord(acceptedAt: Date) {
  return {
    utilityClass: UTILITY_CLASS,
    termsVersion: UTILITY_TERMS_VERSION,
    termsAcceptedAt: acceptedAt.toISOString(),
    rules: {
      isUtilityToken: true,
      isSecurity: false,
      profitGuarantee: false,
      financialGuarantee: false,
      realEstateValue: false,
      purposeScope: ['educacional', 'comunitario', 'uso interno no ecossistema'],
    },
    disclaimer: LEGAL_DISCLAIMER,
  };
}
