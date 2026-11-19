import { Router } from 'express';
import { z } from 'zod';
import { LEGAL_DISCLAIMER } from '../../config/constants.js';
import { asyncHandler, ok } from '../../shared/http.js';
import type { TokensService } from './tokens.service.js';

const ListQuery = z.object({
  type: z
    .string()
    .optional()
    .transform((v) => (v ? v.toUpperCase() : 'NATIVE'))
    .pipe(z.enum(['NATIVE', 'CUSTOM'], { errorMap: () => ({ message: 'type deve ser NATIVE ou CUSTOM' }) })),
});

const SymbolParam = z.object({
  symbol: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9]{2,10}$/, 'Símbolo inválido: use 2 a 10 letras/números.'),
});

const ActivityQuery = z.object({
  limit: z.coerce.number().int().min(1).max(25).default(10),
});

/**
 * GET /api/tokens                   → lista de ativos nativos (ou ?type=CUSTOM)
 * GET /api/tokens/:symbol           → detalhes de um token
 * GET /api/tokens/:symbol/activity  → movimentação on-chain real (RPC Solana)
 */
export function tokensRoutes(service: TokensService): Router {
  const router = Router();

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const { type } = ListQuery.parse(req.query);
      const data = await service.list(type);
      return ok(res, data, { count: data.length, type, disclaimer: LEGAL_DISCLAIMER });
    }),
  );

  router.get(
    '/:symbol',
    asyncHandler(async (req, res) => {
      const { symbol } = SymbolParam.parse(req.params);
      const data = await service.getBySymbol(symbol);
      return ok(res, data, { disclaimer: LEGAL_DISCLAIMER });
    }),
  );

  router.get(
    '/:symbol/activity',
    asyncHandler(async (req, res) => {
      const { symbol } = SymbolParam.parse(req.params);
      const { limit } = ActivityQuery.parse(req.query);
      const data = await service.getActivity(symbol, limit);
      return ok(res, data, { disclaimer: LEGAL_DISCLAIMER });
    }),
  );

  return router;
}
