import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { badRequest } from '../../shared/errors.js';
import type { FactoryClient } from './factory-client.js';
import { getMarkets } from './markets.js';

const base58 = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, 'endereço base58 inválido');
const uintStr = z.union([z.number().int().nonnegative(), z.string().regex(/^\d+$/)]);
const posStr = z.union([z.number().int().positive(), z.string().regex(/^[1-9]\d*$/)]);

const InitPoolSchema = z.object({
  quoteMint: base58.optional(),
  tokenDecimals: z.number().int().min(0).max(9),
  maxSupply: posStr,
  initialPrice: posStr,
  buyFeeBps: z.number().int().min(0).max(1000),
  sellFeeBps: z.number().int().min(0).max(1000),
  simulate: z.boolean().optional(),
});

const BuySchema = z.object({
  tokenMint: base58,
  quoteIn: posStr,
  minTokensOut: uintStr.optional(),
  simulate: z.boolean().optional(),
});

const SellSchema = z.object({
  tokenMint: base58,
  tokensIn: posStr,
  minQuoteOut: uintStr.optional(),
  simulate: z.boolean().optional(),
});

const InjectSchema = z.object({
  tokenMint: base58,
  amount: posStr,
  reference: z.string().min(1).max(128),
  simulate: z.boolean().optional(),
});

const PausedSchema = z.object({ tokenMint: base58, paused: z.boolean() });

function parse<T>(schema: z.ZodSchema<T>, body: unknown): T {
  const r = schema.safeParse(body);
  if (!r.success) {
    throw badRequest('INVALID_INPUT', r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  }
  return r.data;
}

/**
 * Rotas do programa on-chain `mastter_factory` (modelo Cofre de Cunhagem Evolutiva).
 * `guards.webhook` + `guards.write` protegem as rotas de escrita (custodiais).
 */
export function factoryRoutes(factory: FactoryClient, guards: { webhook: RequestHandler; write: RequestHandler }): Router {
  const r = Router();
  const write: RequestHandler[] = [guards.webhook, guards.write];

  r.get('/status', async (_req, res, next) => {
    try {
      res.json(await factory.status());
    } catch (err) {
      next(err);
    }
  });

  // Dados de mercado p/ o terminal: majors reais (CoinGecko) + tokens on-chain.
  r.get('/markets', async (_req, res, next) => {
    try {
      res.json(await getMarkets());
    } catch (err) {
      next(err);
    }
  });

  // Top holders reais on-chain de um mint (para o mapa de holders).
  r.get('/holders/:mint', async (req, res, next) => {
    try {
      if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(req.params.mint)) throw badRequest('INVALID_MINT', 'mint inválido.');
      const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
      res.json(await factory.getHolders(req.params.mint, limit));
    } catch (err) {
      next(err);
    }
  });

  r.get('/pool/:mint', async (req, res, next) => {
    try {
      if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(req.params.mint)) throw badRequest('INVALID_MINT', 'mint inválido.');
      res.json(await factory.getPool(req.params.mint));
    } catch (err) {
      next(err);
    }
  });

  // Cria um novo token (supply 0) + pool.
  r.post('/pool', ...write, async (req, res, next) => {
    try {
      const data = parse(InitPoolSchema, req.body);
      const result = await factory.initializePool(data);
      res.status(data.simulate ? 200 : 201).json(result);
    } catch (err) {
      next(err);
    }
  });

  // Compra custodial: dinheiro entra, token sai.
  r.post('/buy', ...write, async (req, res, next) => {
    try {
      const data = parse(BuySchema, req.body);
      const result = await factory.buy(data);
      res.status(data.simulate ? 200 : 201).json(result);
    } catch (err) {
      next(err);
    }
  });

  // Venda custodial: token volta ao cofre, USDC sai (única saída de USDC).
  r.post('/sell', ...write, async (req, res, next) => {
    try {
      const data = parse(SellSchema, req.body);
      const result = await factory.sell(data);
      res.status(data.simulate ? 200 : 201).json(result);
    } catch (err) {
      next(err);
    }
  });

  // Injeção de USDC sem emitir tokens (idempotente por referência).
  r.post('/inject', ...write, async (req, res, next) => {
    try {
      const data = parse(InjectSchema, req.body);
      const result = await factory.injectQuote(data);
      res.status(data.simulate ? 200 : 201).json(result);
    } catch (err) {
      next(err);
    }
  });

  // Pausa/retoma compras e injeções (vendas nunca pausam).
  r.post('/paused', ...write, async (req, res, next) => {
    try {
      const data = parse(PausedSchema, req.body);
      res.json(await factory.setPaused(data.tokenMint, data.paused));
    } catch (err) {
      next(err);
    }
  });

  return r;
}
