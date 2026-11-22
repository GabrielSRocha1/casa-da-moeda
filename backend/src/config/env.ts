import 'dotenv/config';
import { z } from 'zod';

/**
 * Leitura e validação das variáveis de ambiente.
 * Falha cedo (no boot) se algo estiver inválido, com mensagem clara.
 */

const bool = (def: boolean) =>
  z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((v) => (v === undefined ? def : typeof v === 'boolean' ? v : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase())));

const csv = (def: string) =>
  z
    .string()
    .optional()
    .transform((v) => (v ?? def).split(',').map((s) => s.trim()).filter(Boolean));

const DEV_WEBHOOK_SECRET = 'dev-webhook-secret-change-me';

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3333),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

    DATABASE_URL: z.string().min(1).default('pglite://./data/pglite'),
    DATABASE_SSL: bool(false),

    CORS_ORIGINS: csv('*'),
    WEBHOOK_SECRET: z.string().optional(),
    RATE_LIMIT_ENABLED: bool(true),
    // Na Vercel toda requisição chega via proxy: sem trust proxy, req.ip é o IP interno
    // e o rate limit vira um bucket global compartilhado por todos os usuários.
    // Por isso o valor é forçado para true lá, mesmo se o painel disser false.
    TRUST_PROXY: bool(false).transform((v) => v || Boolean(process.env.VERCEL)),

    P2P_FEE_BPS: z.coerce.number().int().min(0).max(5000).default(150),
    P2P_MIN_FIAT: z.coerce.number().positive().default(20),
    P2P_MAX_FIAT: z.coerce.number().positive().default(50_000),
    ORDER_TTL_MINUTES: z.coerce.number().int().min(1).max(1440).default(15),
    AUTO_SETTLE: bool(false),

    WALLET_NETWORKS: csv('solana,evm').pipe(z.array(z.enum(['solana', 'evm'])).min(1)),

    PIX_KEY: z.string().min(1).max(77).default('pix-sandbox@casadamoeda.dev'),
    PIX_MERCHANT_NAME: z.string().min(1).default('CASA DA MOEDA MASTER'),
    PIX_MERCHANT_CITY: z.string().min(1).default('SAO PAULO'),

    PRICE_FEED_INTERVAL_MS: z.coerce.number().int().min(0).default(15_000),

    /** 'live' = preços/movimentação reais (Solana + APIs públicas); 'simulated' = passeio aleatório local. */
    PRICE_FEED_MODE: z.enum(['live', 'simulated']).default('live'),
    /** RPC pública da Solana usada para movimentação on-chain e dados de supply (preços = mainnet). */
    SOLANA_RPC_URL: z.string().url().default('https://api.mainnet-beta.solana.com'),

    // ---------------------------------------------------------------- Custódia on-chain (dispatcher real)
    // Ponte backend → Solana para ENVIAR tokens na liquidação de ordens P2P.
    // RPC própria (separada da do feed de preços, que lê mainnet) para apontar à devnet sem quebrar os preços.
    /** 'auto' = usa o dispatcher real se houver keypair da tesouraria; senão simula. 'simulated'/'solana' forçam o modo. */
    DISPATCHER_MODE: z.enum(['auto', 'simulated', 'solana']).default('auto'),
    /** RPC usada pelo dispatcher real (devnet por padrão). Independente de SOLANA_RPC_URL. */
    SOLANA_DISPATCH_RPC_URL: z.string().url().default('https://api.devnet.solana.com'),
    /** Rótulo do cluster do dispatcher (apenas para logs e links do explorer). */
    SOLANA_DISPATCH_CLUSTER: z.enum(['mainnet', 'devnet', 'testnet']).default('devnet'),
    /** Caminho do arquivo de keypair da tesouraria (formato array JSON do solana-keygen). Nunca commitar. */
    SOLANA_TREASURY_KEYPAIR_PATH: z.string().optional(),
    /** Alternativa ao arquivo: secret key da tesouraria em base58 (hot wallet). Preferir o arquivo. */
    SOLANA_TREASURY_SECRET_KEY: z.string().optional(),
    // ---------------------------------------------------------------- Programa on-chain mastter_factory
    /** RPC usada pelo cliente Anchor do mastter_factory (devnet por padrão). */
    FACTORY_RPC_URL: z.string().url().default('https://api.devnet.solana.com'),
    /** Rótulo do cluster do factory (links do explorer / status). */
    FACTORY_CLUSTER: z.enum(['mainnet', 'devnet', 'testnet']).default('devnet'),
    /** Keypair do comprador/pagador que assina as instruções do factory. Default: a tesouraria. */
    FACTORY_BUYER_KEYPAIR_PATH: z.string().optional(),
    FACTORY_BUYER_SECRET_KEY: z.string().optional(),
    /** Mapa símbolo→mint no cluster do dispatcher, ex.: "BDC:...,VRC:...,ESCT:...". Sobrepõe os mints de mainnet. */
    SOLANA_TOKEN_MINTS: z
      .string()
      .optional()
      .transform((v) =>
        (v ?? '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
          .reduce<Record<string, string>>((acc, pair) => {
            const [sym, mint] = pair.split(':').map((x) => x.trim());
            if (sym && mint) acc[sym.toUpperCase()] = mint;
            return acc;
          }, {}),
      ),

    // E-mail transacional (Zoho SMTP). Sem SMTP_USER/SMTP_PASS em dev, os códigos vão para o log.
    SMTP_HOST: z.string().default('smtp.zoho.com'),
    SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(465),
    /** true = SSL direto (porta 465); false = STARTTLS (porta 587). */
    SMTP_SECURE: bool(true),
    SMTP_USER: z.string().optional(),
    SMTP_PASS: z.string().optional(),
    MAIL_FROM: z.string().default('Casa da Moeda Master Digital <no-reply@mastter.digital>'),

    // Twilio Verify (confirmação de telefone por SMS). Sem credenciais em dev, os códigos vão para o log.
    TWILIO_ACCOUNT_SID: z.string().optional(),
    TWILIO_AUTH_TOKEN: z.string().optional(),
    TWILIO_VERIFY_SERVICE_SID: z.string().optional(),

    // Regras dos códigos de verificação
    VERIFY_CODE_TTL_MINUTES: z.coerce.number().int().min(1).max(60).default(10),
    VERIFY_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(5),
    VERIFY_RESEND_COOLDOWN_SECONDS: z.coerce.number().int().min(0).max(3600).default(60),
  })
  .transform((env, ctx) => {
    // Em produção o segredo do webhook é obrigatório e não pode ser o valor de exemplo.
    let secret = env.WEBHOOK_SECRET;
    if (!secret) {
      if (env.NODE_ENV === 'production') {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['WEBHOOK_SECRET'], message: 'obrigatório em produção' });
        return z.NEVER;
      }
      secret = DEV_WEBHOOK_SECRET;
    }
    if (secret.length < 16) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['WEBHOOK_SECRET'], message: 'mínimo de 16 caracteres' });
      return z.NEVER;
    }
    if (env.NODE_ENV === 'production' && secret === DEV_WEBHOOK_SECRET) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['WEBHOOK_SECRET'], message: 'troque o valor de exemplo em produção' });
      return z.NEVER;
    }
    if (env.P2P_MIN_FIAT >= env.P2P_MAX_FIAT) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['P2P_MIN_FIAT'], message: 'deve ser menor que P2P_MAX_FIAT' });
      return z.NEVER;
    }
    // Em produção o envio real de e-mail e SMS é obrigatório (em dev cai no provider de console).
    if (env.NODE_ENV === 'production') {
      for (const key of ['SMTP_USER', 'SMTP_PASS', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_VERIFY_SERVICE_SID'] as const) {
        if (!env[key]) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: 'obrigatório em produção' });
        }
      }
      if (!env.SMTP_USER || !env.SMTP_PASS || !env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN || !env.TWILIO_VERIFY_SERVICE_SID) {
        return z.NEVER;
      }
    }
    return { ...env, WEBHOOK_SECRET: secret };
  });

export type Env = z.output<typeof EnvSchema>;

/** Carrega o ambiente; `overrides` é usado pelos testes. */
export function loadEnv(overrides: Record<string, unknown> = {}): Env {
  const parsed = EnvSchema.safeParse({ ...process.env, ...overrides });
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Variáveis de ambiente inválidas:\n${issues}`);
  }
  return parsed.data;
}
