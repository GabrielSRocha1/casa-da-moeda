import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { BUSINESS_CATEGORIES, LEGAL_DISCLAIMER } from '../../config/constants.js';
import { asyncHandler, created, ok } from '../../shared/http.js';
import type { B2BService } from './b2b.service.js';
import { normalizeCategory } from './compliance.js';

const CATEGORY_HELP = Object.keys(BUSINESS_CATEGORIES).join(', ');

const CreateBody = z.object({
  tokenName: z
    .string({ required_error: 'tokenName é obrigatório' })
    .trim()
    .min(3, 'tokenName deve ter ao menos 3 caracteres.')
    .max(40, 'tokenName deve ter no máximo 40 caracteres.')
    .regex(/^[\p{L}\p{N}][\p{L}\p{N} .'&-]*$/u, 'tokenName contém caracteres não permitidos.'),
  symbol: z
    .string({ required_error: 'symbol é obrigatório' })
    .trim()
    .transform((s) => s.toUpperCase())
    .pipe(z.string().regex(/^[A-Z][A-Z0-9]{1,7}$/, 'symbol deve ter 2 a 8 caracteres (letras/números, começando por letra).')),
  category: z.string({ required_error: 'category é obrigatório' }).transform((v, ctx) => {
    const c = normalizeCategory(v);
    if (!c) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `category inválida. Use: ${CATEGORY_HELP}.` });
      return z.NEVER;
    }
    return c;
  }),
  purpose: z
    .string({ required_error: 'purpose é obrigatório' })
    .trim()
    .min(20, 'Descreva o propósito/utilidade com pelo menos 20 caracteres.')
    .max(600, 'purpose deve ter no máximo 600 caracteres.'),
  creatorWallet: z.string({ required_error: 'creatorWallet é obrigatório' }).max(200),
  contactEmail: z.string().trim().toLowerCase().email('contactEmail inválido.').max(254).optional(),
  totalSupply: z
    .union([z.string(), z.number()])
    .optional()
    .transform((v, ctx) => {
      if (v === undefined || v === '') return undefined;
      const s = String(v).replace(/[.\s_]/g, '');
      if (!/^[1-9]\d{0,17}$/.test(s)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'totalSupply deve ser um inteiro positivo (até 18 dígitos).' });
        return z.NEVER;
      }
      return s;
    }),
  acceptUtilityTerms: z.literal(true, {
    errorMap: () => ({
      message: 'É obrigatório aceitar as normas de utilidade (acceptUtilityTerms: true): sem promessa de lucro e sem caráter de valor mobiliário.',
    }),
  }),
});

const RequestParam = z.object({ id: z.string().min(1).max(64) });

// ------------------------------------------------------------------ Solicitação de parceria (onboarding)
// O corpo usa snake_case: é o mesmo contrato da tabela public.business_applications
// que o site já montava (frontend buildRow), validado aqui com as mesmas regras do banco.

const SECTORS = [
  'Empresas e Negócios',
  'Eventos e Festas Sertanejas',
  'Times de Futebol / Esportes',
  'Feiras Culturais',
  'Ajuda Humanitária / ONGs',
  'Igrejas e Instituições Religiosas',
  'Clubes Recreativos',
  'Fraternidades e Lojas',
  'Outros',
] as const;

const E164 = /^\+[1-9]\d{7,14}$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

const PartnershipBody = z
  .object({
    id: z.string().uuid('id deve ser um uuid.').optional(),
    company_name: z.string({ required_error: 'company_name é obrigatório' }).trim().min(3).max(120),
    company_address: z.string({ required_error: 'company_address é obrigatório' }).trim().min(10).max(300),
    business_sector: z.enum(SECTORS, { errorMap: () => ({ message: `business_sector deve ser um de: ${SECTORS.join(' | ')}` }) }),
    business_sector_other: z.string().trim().min(3).max(80).nullish(),
    company_description: z.string({ required_error: 'company_description é obrigatório' }).trim().min(30).max(800),
    director_name: z.string({ required_error: 'director_name é obrigatório' }).trim().min(5).max(120),
    whatsapp: z.string({ required_error: 'whatsapp é obrigatório' }).regex(E164, 'whatsapp deve estar em E.164 (ex.: +5511912345678).'),
    alt_phone: z.string().regex(E164, 'alt_phone deve estar em E.164.').nullish(),
    email: z.string({ required_error: 'email é obrigatório' }).trim().toLowerCase().email('email inválido.').max(254),
    needs_creation_approver: z.boolean().default(false),
    approver_name: z.string().trim().min(5).max(120).nullish(),
    preferred_days: z.array(z.enum(['SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB', 'DOM'])).min(1).max(7),
    preferred_periods: z.array(z.enum(['MANHA', 'TARDE', 'NOITE'])).min(1).max(3),
    preferred_time_from: z.string().regex(HHMM, 'preferred_time_from deve ser HH:MM.').nullish(),
    preferred_time_to: z.string().regex(HHMM, 'preferred_time_to deve ser HH:MM.').nullish(),
    timezone: z.string().trim().min(1).max(64).default('America/Sao_Paulo'),
    consent_lgpd: z.literal(true, { errorMap: () => ({ message: 'É obrigatório autorizar o contato (consent_lgpd: true) — LGPD.' }) }),
    source: z.string().trim().max(40).optional(),
  })
  .superRefine((b, ctx) => {
    if ((b.business_sector === 'Outros') !== Boolean(b.business_sector_other)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['business_sector_other'], message: 'Obrigatório quando business_sector = "Outros" (e só nesse caso).' });
    }
    if (b.needs_creation_approver !== Boolean(b.approver_name)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['approver_name'], message: 'Obrigatório quando needs_creation_approver = true (e só nesse caso).' });
    }
    if (Boolean(b.preferred_time_from) !== Boolean(b.preferred_time_to)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['preferred_time_to'], message: 'Preencha o horário inicial e o final, ou nenhum dos dois.' });
    } else if (b.preferred_time_from && b.preferred_time_to && b.preferred_time_from >= b.preferred_time_to) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['preferred_time_to'], message: 'O horário final deve ser depois do inicial.' });
    }
  });

/**
 * POST /api/b2b/tokens/create         → registra a solicitação de um novo utility token
 * GET  /api/b2b/tokens/categories     → categorias aceitas
 * GET  /api/b2b/tokens/requests/:id   → consulta por id ou protocolo
 * POST /api/b2b/partnerships          → solicitação de parceria do formulário do site
 */
export function b2bRoutes(service: B2BService, guards: { write: RequestHandler }): Router {
  const router = Router();

  router.get('/tokens/categories', (_req, res) =>
    ok(
      res,
      Object.entries(BUSINESS_CATEGORIES).map(([code, label]) => ({ code, label })),
    ),
  );

  router.post(
    '/tokens/create',
    guards.write,
    asyncHandler(async (req, res) => {
      const body = CreateBody.parse(req.body);
      const data = await service.create(body);
      res.setHeader('Location', `/api/b2b/tokens/requests/${data.id}`);
      return created(res, data, {
        disclaimer: LEGAL_DISCLAIMER,
        nextSteps: [
          'A equipe analisa o propósito e a conformidade com as normas de utilidade.',
          'Aprovado, o token é emitido e listado como CUSTOM na plataforma.',
          'Acompanhe pelo protocolo em GET /api/b2b/tokens/requests/:protocolo.',
        ],
      });
    }),
  );

  router.get(
    '/tokens/requests/:id',
    asyncHandler(async (req, res) => {
      const { id } = RequestParam.parse(req.params);
      return ok(res, await service.get(id));
    }),
  );

  router.post(
    '/partnerships',
    guards.write,
    asyncHandler(async (req, res) => {
      const b = PartnershipBody.parse(req.body);
      const data = await service.createPartnership({
        id: b.id,
        companyName: b.company_name.replace(/\s+/g, ' '),
        companyAddress: b.company_address.replace(/\s+/g, ' '),
        businessSector: b.business_sector,
        businessSectorOther: b.business_sector_other ?? undefined,
        companyDescription: b.company_description,
        directorName: b.director_name.replace(/\s+/g, ' '),
        whatsapp: b.whatsapp,
        altPhone: b.alt_phone ?? undefined,
        email: b.email,
        needsCreationApprover: b.needs_creation_approver,
        approverName: b.approver_name ?? undefined,
        preferredDays: b.preferred_days,
        preferredPeriods: b.preferred_periods,
        preferredTimeFrom: b.preferred_time_from ?? undefined,
        preferredTimeTo: b.preferred_time_to ?? undefined,
        timezone: b.timezone,
        source: b.source,
      });
      return created(res, data, {
        nextSteps: [
          'Nossa equipe entra em contato pelos canais informados dentro da sua disponibilidade.',
          'Guarde o protocolo para acompanhar a solicitação.',
        ],
      });
    }),
  );

  return router;
}
