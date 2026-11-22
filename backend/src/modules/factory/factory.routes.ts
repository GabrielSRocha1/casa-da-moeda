import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { badRequest } from '../../shared/errors.js';
import type { FactoryClient } from './factory-client.js';

const BuySchema = z.object({
  entityId: z.union([z.number().int().nonnegative(), z.string().regex(/^\d+$/)]),
  asset: z.enum(['sol', 'usdc']),
  /** Unidades-base: lamports (SOL) ou micro-USDC (USDC). */
  amountIn: z.union([z.number().int().positive(), z.string().regex(/^\d+$/)]),
  minTokensOut: z.union([z.number().int().nonnegative(), z.string().regex(/^\d+$/)]).optional(),
  deadlineTs: z.number().int().nonnegative().optional(),
  simulate: z.boolean().optional(),
});

/** Rotas de integração com o programa on-chain mastter_factory. `guards.webhook` protege a escrita. */
export function factoryRoutes(factory: FactoryClient, guards: { webhook: RequestHandler; write: RequestHandler }): Router {
  const r = Router();

  r.get('/status', async (_req, res, next) => {
    try {
      res.json(await factory.status());
    } catch (err) {
      next(err);
    }
  });

  r.get('/vault/:id', async (req, res, next) => {
    try {
      const id = req.params.id;
      if (!/^\d+$/.test(id)) throw badRequest('INVALID_ENTITY_ID', 'entityId inválido.');
      const v = await factory.getVault(id);
      res.json({
        entityId: v.entityId?.toString?.() ?? String(v.entityId),
        status: v.status,
        tokenName: v.tokenName,
        tokenSymbol: v.tokenSymbol,
        mint: v.mint?.toBase58?.() ?? null,
        circulatingSupply: v.circulatingSupply?.toString?.() ?? null,
        hardCap: v.hardCap?.toString?.() ?? null,
      });
    } catch (err) {
      next(err);
    }
  });

  // Compra custodial on-chain: o backend (hot wallet) chama buy_tokens.
  r.post('/buy', guards.webhook, guards.write, async (req, res, next) => {
    try {
      const parsed = BuySchema.safeParse(req.body);
      if (!parsed.success) {
        throw badRequest('INVALID_BUY_INPUT', parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
      }
      const result = await factory.buyTokens(parsed.data);
      res.status(parsed.data.simulate ? 200 : 201).json(result);
    } catch (err) {
      next(err);
    }
  });

  return r;
}
