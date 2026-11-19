import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

/**
 * Modelo de dados (PostgreSQL) — Drizzle ORM.
 *
 * Valores monetários usam NUMERIC (precisão exata). O driver devolve NUMERIC como
 * string; toda aritmética é feita em BigInt (ver src/shared/money.ts), nunca em float.
 */

// ---------------------------------------------------------------- Enums
export const tokenTypeEnum = pgEnum('token_type', ['NATIVE', 'CUSTOM']);
export const tokenStatusEnum = pgEnum('token_status', ['ACTIVE', 'PAUSED']);

export const orderStatusEnum = pgEnum('order_status', [
  'PENDING', //   Aguardando pagamento Pix
  'PAID', //      Pagamento confirmado
  'COMPLETED', // Tokens enviados para a Verum Wallet (auto-custódia)
  'CANCELLED', // Cancelada antes do pagamento
  'EXPIRED', //   Cobrança expirou sem pagamento
]);

export const walletNetworkEnum = pgEnum('wallet_network', ['solana', 'evm']);

export const businessCategoryEnum = pgEnum('business_category', [
  'EMPRESAS',
  'FESTAS_SERTANEJAS',
  'FUTEBOL',
  'FEIRAS_CULTURAIS',
  'AJUDA_HUMANITARIA',
]);

export const businessRequestStatusEnum = pgEnum('business_request_status', ['PENDING_REVIEW', 'APPROVED', 'REJECTED']);

// ---------------------------------------------------------------- Token
export const tokens = pgTable('tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 60 }).notNull(),
  symbol: varchar('symbol', { length: 10 }).notNull().unique(),
  /** Preço de referência atual em BRL. */
  price: numeric('price', { precision: 24, scale: 8 }).notNull(),
  /** Variação percentual em 24h (ex.: 4.2 = +4,20%). */
  change24h: numeric('change_24h', { precision: 10, scale: 4 }).notNull().default('0'),
  /** Preço de referência de 24h atrás (base do cálculo de change24h). */
  referencePrice24h: numeric('reference_price_24h', { precision: 24, scale: 8 }).notNull(),
  type: tokenTypeEnum('type').notNull(),
  status: tokenStatusEnum('status').notNull().default('ACTIVE'),
  decimals: integer('decimals').notNull().default(8),
  /** Ordem de exibição (carrossel do frontend). */
  sortOrder: integer('sort_order').notNull().default(100),
  description: text('description'),
  iconUrl: text('icon_url'),
  /** Para tokens CUSTOM: solicitação B2B que os originou. */
  businessRequestId: uuid('business_request_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------- P2P Order
export const p2pOrders = pgTable(
  'p2p_orders',
  {
    id: uuid('id').primaryKey(),
    assetSymbol: varchar('asset_symbol', { length: 10 })
      .notNull()
      .references(() => tokens.symbol),
    /** Valor bruto pago em BRL. */
    fiatAmount: numeric('fiat_amount', { precision: 14, scale: 2 }).notNull(),
    /** Taxa da plataforma em BRL. */
    feeAmount: numeric('fee_amount', { precision: 14, scale: 2 }).notNull(),
    /** Cotação travada no momento da ordem. */
    unitPrice: numeric('unit_price', { precision: 24, scale: 8 }).notNull(),
    /** Quantidade de tokens a enviar. */
    tokenAmount: numeric('token_amount', { precision: 30, scale: 8 }).notNull(),
    userWalletAddress: varchar('user_wallet_address', { length: 100 }).notNull(),
    walletNetwork: walletNetworkEnum('wallet_network').notNull(),
    status: orderStatusEnum('status').notNull().default('PENDING'),

    // Pagamento
    paymentProvider: varchar('payment_provider', { length: 40 }).notNull(),
    paymentTxid: varchar('payment_txid', { length: 35 }).notNull().unique(),
    pixPayload: text('pix_payload').notNull(),
    paymentReference: varchar('payment_reference', { length: 120 }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    paidAt: timestamp('paid_at', { withTimezone: true }),

    // Envio para auto-custódia
    custodyTxHash: varchar('custody_tx_hash', { length: 120 }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),

    /** Chave enviada pelo cliente no header Idempotency-Key (evita ordens duplicadas). */
    idempotencyKey: varchar('idempotency_key', { length: 80 }).unique(),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('p2p_orders_status_idx').on(t.status),
    index('p2p_orders_wallet_idx').on(t.userWalletAddress),
  ],
);

/** Trilha de auditoria de cada mudança de status da ordem. */
export const p2pOrderEvents = pgTable(
  'p2p_order_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => p2pOrders.id, { onDelete: 'cascade' }),
    fromStatus: orderStatusEnum('from_status'),
    toStatus: orderStatusEnum('to_status').notNull(),
    source: varchar('source', { length: 30 }).notNull(), // api | webhook | system
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('p2p_order_events_order_idx').on(t.orderId)],
);

// ---------------------------------------------------------------- B2B
export const businessTokenRequests = pgTable(
  'business_token_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    protocol: varchar('protocol', { length: 20 }).notNull().unique(),
    tokenName: varchar('token_name', { length: 40 }).notNull(),
    symbol: varchar('symbol', { length: 8 }).notNull(),
    category: businessCategoryEnum('category').notNull(),
    purpose: text('purpose').notNull(),
    creatorWallet: varchar('creator_wallet', { length: 100 }).notNull(),
    creatorWalletNetwork: walletNetworkEnum('creator_wallet_network').notNull(),
    contactEmail: varchar('contact_email', { length: 254 }),
    totalSupply: numeric('total_supply', { precision: 30, scale: 0 }),
    status: businessRequestStatusEnum('status').notNull().default('PENDING_REVIEW'),

    // Vínculo às normas de utilidade
    utilityClass: varchar('utility_class', { length: 40 }).notNull(),
    termsVersion: varchar('terms_version', { length: 20 }).notNull(),
    termsAcceptedAt: timestamp('terms_accepted_at', { withTimezone: true }).notNull(),
    isSecurity: boolean('is_security').notNull().default(false),
    profitGuarantee: boolean('profit_guarantee').notNull().default(false),
    compliance: jsonb('compliance').$type<Record<string, unknown>>().notNull(),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // O mesmo símbolo não pode estar em duas solicitações ativas (rejeitadas liberam o símbolo).
    uniqueIndex('business_requests_symbol_active_uq').on(t.symbol).where(sql`${t.status} <> 'REJECTED'`),
  ],
);

// ---------------------------------------------------------------- Usuários e sessões
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 120 }).notNull(),
    email: varchar('email', { length: 254 }).notNull(),
    phoneDdi: varchar('phone_ddi', { length: 4 }).notNull(),
    phoneNumber: varchar('phone_number', { length: 15 }).notNull(),
    /** Telefone completo em E.164 (+5511...) — usado para casar a confirmação por SMS. */
    phoneE164: varchar('phone_e164', { length: 20 }).notNull(),
    walletAddress: varchar('wallet_address', { length: 100 }).notNull(),
    walletNetwork: walletNetworkEnum('wallet_network').notNull(),
    /** Formato: scrypt$N$r$p$salt(base64)$hash(base64). Nunca a senha em claro. */
    passHash: varchar('pass_hash', { length: 300 }).notNull(),
    emailVerified: boolean('email_verified').notNull().default(false),
    phoneVerified: boolean('phone_verified').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('users_email_uq').on(t.email), index('users_phone_e164_idx').on(t.phoneE164)],
);

/** Sessões de login: o cliente guarda o token opaco; aqui fica apenas o sha256 dele. */
export const authSessions = pgTable(
  'auth_sessions',
  {
    tokenHash: varchar('token_hash', { length: 64 }).primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('auth_sessions_user_idx').on(t.userId)],
);

// ---------------------------------------------------------------- Solicitações de parceria (onboarding B2B)
/**
 * Espelho da tabela public.business_applications do Supabase (migrations 002/003).
 * A migration Drizzle usa CREATE TABLE IF NOT EXISTS: em produção (Supabase) a tabela
 * já existe com triggers/RLS próprios; em dev (PGlite) ela é criada por aqui.
 */
export const businessApplications = pgTable('business_applications', {
  id: uuid('id').primaryKey().defaultRandom(),
  protocol: text('protocol').notNull().unique(),

  companyName: text('company_name').notNull(),
  companyAddress: text('company_address').notNull(),
  businessSector: text('business_sector').notNull(),
  businessSectorOther: text('business_sector_other'),
  companyDescription: text('company_description').notNull(),

  directorName: text('director_name').notNull(),
  whatsapp: text('whatsapp').notNull(),
  altPhone: text('alt_phone'),
  email: text('email').notNull(),
  needsCreationApprover: boolean('needs_creation_approver').notNull().default(false),
  approverName: text('approver_name'),

  preferredDays: text('preferred_days').array().notNull(),
  preferredPeriods: text('preferred_periods').array().notNull(),
  preferredTimeFrom: time('preferred_time_from'),
  preferredTimeTo: time('preferred_time_to'),
  timezone: text('timezone').notNull().default('America/Sao_Paulo'),

  consentLgpd: boolean('consent_lgpd').notNull(),
  consentAt: timestamp('consent_at', { withTimezone: true }).notNull().defaultNow(),

  status: text('status').notNull().default('NEW'),
  source: text('source').notNull().default('site'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------- Verificação de e-mail
/** Códigos de confirmação de e-mail. O código nunca é salvo em claro — apenas sha256(email + ':' + código). */
export const emailVerificationCodes = pgTable(
  'email_verification_codes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: varchar('email', { length: 254 }).notNull(),
    codeHash: varchar('code_hash', { length: 64 }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    attempts: integer('attempts').notNull().default(0),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('email_verification_codes_email_idx').on(t.email)],
);

export type Token = typeof tokens.$inferSelect;
export type NewToken = typeof tokens.$inferInsert;
export type P2POrder = typeof p2pOrders.$inferSelect;
export type P2POrderEvent = typeof p2pOrderEvents.$inferSelect;
export type OrderStatus = (typeof orderStatusEnum.enumValues)[number];
export type WalletNetwork = (typeof walletNetworkEnum.enumValues)[number];
export type BusinessTokenRequest = typeof businessTokenRequests.$inferSelect;
export type BusinessApplication = typeof businessApplications.$inferSelect;
export type User = typeof users.$inferSelect;
