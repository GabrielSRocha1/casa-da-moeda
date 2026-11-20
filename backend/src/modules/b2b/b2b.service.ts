import { randomInt, randomUUID } from 'node:crypto';
import { and, eq, ne, sql } from 'drizzle-orm';
import { BUSINESS_CATEGORIES, NATIVE_TOKENS, RESERVED_SYMBOLS, UTILITY_CLASS, UTILITY_TERMS_VERSION, type BusinessCategory } from '../../config/constants.js';
import type { Database } from '../../db/client.js';
import { businessApplications, businessTokenRequests, tokens, type BusinessApplication, type BusinessTokenRequest } from '../../db/schema.js';
import { badRequest, conflict, notFound } from '../../shared/errors.js';
import type { Logger } from '../../shared/logger.js';
import type { WalletService } from '../wallet/wallet.service.js';
import { buildComplianceRecord, findComplianceViolations } from './compliance.js';

export interface CreateBusinessTokenInput {
  tokenName: string;
  symbol: string;
  category: BusinessCategory;
  purpose: string;
  creatorWallet: string;
  contactEmail?: string;
  totalSupply?: string;
  acceptUtilityTerms: true;
}

export interface BusinessTokenRequestDTO {
  id: string;
  protocol: string;
  tokenName: string;
  symbol: string;
  category: BusinessCategory;
  categoryLabel: string;
  purpose: string;
  creatorWallet: string;
  creatorWalletNetwork: string;
  contactEmail: string | null;
  totalSupply: string | null;
  status: BusinessTokenRequest['status'];
  compliance: Record<string, unknown>;
  createdAt: string;
}

export interface CreatePartnershipInput {
  /** uuid opcional gerado no cliente para reenvio idempotente. */
  id?: string;
  companyName: string;
  companyAddress: string;
  businessSector: string;
  businessSectorOther?: string;
  companyDescription: string;
  directorName: string;
  whatsapp: string;
  altPhone?: string;
  email: string;
  needsCreationApprover: boolean;
  approverName?: string;
  preferredDays: string[];
  preferredPeriods: string[];
  preferredTimeFrom?: string;
  preferredTimeTo?: string;
  timezone: string;
  source?: string;
}

export interface PartnershipDTO {
  id: string;
  protocol: string;
  companyName: string;
  businessSector: string;
  status: string;
  createdAt: string;
}

function partnershipToDTO(r: BusinessApplication): PartnershipDTO {
  return {
    id: r.id,
    protocol: r.protocol,
    companyName: r.companyName,
    businessSector: r.businessSector,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
  };
}

const PROTOCOL_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function newProtocol(): string {
  let s = '';
  for (let i = 0; i < 10; i++) s += PROTOCOL_ALPHABET[randomInt(PROTOCOL_ALPHABET.length)];
  return `UTK-${s}`;
}

function toDTO(r: BusinessTokenRequest): BusinessTokenRequestDTO {
  return {
    id: r.id,
    protocol: r.protocol,
    tokenName: r.tokenName,
    symbol: r.symbol,
    category: r.category,
    categoryLabel: BUSINESS_CATEGORIES[r.category],
    purpose: r.purpose,
    creatorWallet: r.creatorWallet,
    creatorWalletNetwork: r.creatorWalletNetwork,
    contactEmail: r.contactEmail,
    totalSupply: r.totalSupply,
    status: r.status,
    compliance: r.compliance,
    createdAt: r.createdAt.toISOString(),
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NATIVE_NAMES = new Set(NATIVE_TOKENS.map((t) => t.name.toLowerCase()));

export class B2BService {
  constructor(
    private readonly db: Database,
    private readonly wallet: WalletService,
    private readonly logger: Logger,
  ) {}

  async create(input: CreateBusinessTokenInput): Promise<BusinessTokenRequestDTO> {
    // 1) Carteira do criador (mesma validação estrita da auto-custódia)
    const wallet = this.wallet.assertValid(input.creatorWallet, 'creatorWallet');

    // 2) Normas de utilidade: nada de promessa de lucro/rendimento
    const violations = findComplianceViolations(input.tokenName, input.purpose);
    if (violations.length) {
      throw badRequest(
        'COMPLIANCE_VIOLATION',
        'Utility tokens não podem prometer lucro, rendimento, dividendos ou valorização. Reescreva o propósito com foco na utilidade do token.',
        violations.map((v) => ({ field: 'purpose', message: `Termo não permitido: ${v}` })),
      );
    }

    // 3) Nome/símbolo disponíveis
    if (NATIVE_NAMES.has(input.tokenName.trim().toLowerCase())) {
      throw conflict('TOKEN_NAME_UNAVAILABLE', 'Este nome pertence a um ativo nativo da plataforma.');
    }
    if (RESERVED_SYMBOLS.has(input.symbol)) {
      throw conflict('SYMBOL_UNAVAILABLE', `O símbolo ${input.symbol} é reservado. Escolha outro.`);
    }
    const [listed] = await this.db.select({ id: tokens.id }).from(tokens).where(eq(tokens.symbol, input.symbol)).limit(1);
    const [pending] = await this.db
      .select({ id: businessTokenRequests.id })
      .from(businessTokenRequests)
      .where(and(eq(businessTokenRequests.symbol, input.symbol), ne(businessTokenRequests.status, 'REJECTED')))
      .limit(1);
    if (listed || pending) {
      throw conflict('SYMBOL_UNAVAILABLE', `O símbolo ${input.symbol} já está em uso ou em análise. Escolha outro.`);
    }

    // 4) Persistência vinculada às normas
    const acceptedAt = new Date();
    try {
      const [row] = await this.db
        .insert(businessTokenRequests)
        .values({
          protocol: newProtocol(),
          tokenName: input.tokenName.trim(),
          symbol: input.symbol,
          category: input.category,
          purpose: input.purpose.trim(),
          creatorWallet: wallet.address,
          creatorWalletNetwork: wallet.network,
          contactEmail: input.contactEmail ?? null,
          totalSupply: input.totalSupply ?? null,
          status: 'PENDING_REVIEW',
          utilityClass: UTILITY_CLASS,
          termsVersion: UTILITY_TERMS_VERSION,
          termsAcceptedAt: acceptedAt,
          isSecurity: false,
          profitGuarantee: false,
          compliance: buildComplianceRecord(acceptedAt),
        })
        .returning();
      this.logger.info({ requestId: row!.id, symbol: row!.symbol, category: row!.category }, 'Solicitação de utility token registrada');
      return toDTO(row!);
    } catch (err) {
      const e = err as { code?: string; cause?: { code?: string } };
      if (e?.code === '23505' || e?.cause?.code === '23505') {
        throw conflict('SYMBOL_UNAVAILABLE', `O símbolo ${input.symbol} acabou de ser reservado por outra solicitação.`);
      }
      throw err;
    }
  }

  /** Consulta por id (uuid) ou protocolo (UTK-XXXXXXXXXX). */
  async get(idOrProtocol: string): Promise<BusinessTokenRequestDTO> {
    const key = idOrProtocol.trim();
    const where = UUID_RE.test(key)
      ? eq(businessTokenRequests.id, key)
      : /^UTK-[A-Z0-9]{10}$/i.test(key)
        ? sql`upper(${businessTokenRequests.protocol}) = ${key.toUpperCase()}`
        : null;
    if (!where) throw badRequest('INVALID_REQUEST_ID', 'Informe o id (uuid) ou o protocolo (UTK-XXXXXXXXXX).');
    const [row] = await this.db.select().from(businessTokenRequests).where(where).limit(1);
    if (!row) throw notFound('TOKEN_REQUEST_NOT_FOUND', 'Solicitação não encontrada.');
    return toDTO(row);
  }

  // ------------------------------------------------------------------ Solicitações de parceria (onboarding)

  /**
   * Registra a solicitação de parceria do formulário B2B do site.
   * O `id` pode vir do cliente (reenvio idempotente após falha de rede):
   * se já existir, devolve a solicitação original em vez de duplicar.
   */
  async createPartnership(input: CreatePartnershipInput): Promise<PartnershipDTO> {
    const id = input.id ?? randomUUID();
    // Mesma regra do trigger do Supabase: PAR- + 10 primeiros hex do id.
    const protocol = 'PAR-' + id.replace(/-/g, '').slice(0, 10).toUpperCase();

    try {
      const [row] = await this.db
        .insert(businessApplications)
        .values({
          id,
          protocol,
          companyName: input.companyName,
          companyAddress: input.companyAddress,
          businessSector: input.businessSector,
          businessSectorOther: input.businessSectorOther ?? null,
          companyDescription: input.companyDescription,
          directorName: input.directorName,
          whatsapp: input.whatsapp,
          altPhone: input.altPhone ?? null,
          email: input.email,
          needsCreationApprover: input.needsCreationApprover,
          approverName: input.approverName ?? null,
          preferredDays: input.preferredDays,
          preferredPeriods: input.preferredPeriods,
          preferredTimeFrom: input.preferredTimeFrom ?? null,
          preferredTimeTo: input.preferredTimeTo ?? null,
          timezone: input.timezone,
          consentLgpd: true,
          source: input.source ?? 'site',
        })
        .returning();
      this.logger.info({ applicationId: row!.id, protocol: row!.protocol, sector: row!.businessSector }, 'Solicitação de parceria registrada');
      return partnershipToDTO(row!);
    } catch (err) {
      const e = err as { code?: string; cause?: { code?: string } };
      if (e?.code === '23505' || e?.cause?.code === '23505') {
        // Reenvio da mesma solicitação: devolve a existente (idempotente) —
        // mas só se o payload bater, para um id adivinhado não vazar dados de terceiros.
        const [existing] = await this.db.select().from(businessApplications).where(eq(businessApplications.id, id)).limit(1);
        if (existing) {
          if (existing.email !== input.email || existing.whatsapp !== input.whatsapp) {
            throw conflict('IDEMPOTENCY_KEY_REUSED', 'Este id já foi usado com dados diferentes.');
          }
          return partnershipToDTO(existing);
        }
      }
      throw err;
    }
  }
}
