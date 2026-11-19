import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { LEGAL_DISCLAIMER } from '../../config/constants.js';
import { asyncHandler, created, ok } from '../../shared/http.js';
import { parseFiatToCents } from '../../shared/money.js';
import { WEBHOOK_STATUSES } from './order-status.js';
import type { P2PService } from './p2p.service.js';

// ------------------------------------------------------------------ Schemas de entrada

const CreateOrderBody = z.object({
  assetSymbol: z
    .string({ required_error: 'assetSymbol é obrigatório (ex.: "BDC")' })
    .trim()
    .regex(/^[A-Za-z0-9]{2,10}$/, 'assetSymbol inválido: use 2 a 10 letras/números.')
    .transform((s) => s.toUpperCase()),
  fiatAmount: z
    .union([z.number(), z.string()], { required_error: 'fiatAmount é obrigatório (valor em BRL)' })
    .transform((v, ctx) => {
      const cents = parseFiatToCents(v);
      if (cents === null || cents <= 0n) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'fiatAmount deve ser um valor positivo em BRL com até 2 casas decimais (ex.: 150.00).' });
        return z.NEVER;
      }
      return cents;
    }),
  userWalletAddress: z.string({ required_error: 'userWalletAddress é obrigatório' }).max(200),
});

const IdempotencyKey = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_-]{8,80}$/, 'Idempotency-Key deve ter 8–80 caracteres (letras, números, _ ou -).')
  .optional();

const OrderIdParam = z.object({ id: z.string().min(1).max(64) });

const UpdateStatusBody = z.object({
  status: z
    .string({ required_error: 'status é obrigatório' })
    .transform((s) => s.trim().toUpperCase())
    .pipe(z.enum(WEBHOOK_STATUSES, { errorMap: () => ({ message: `status deve ser um de: ${WEBHOOK_STATUSES.join(', ')}` }) })),
  paymentReference: z.string().trim().min(1).max(120).optional(),
  note: z.string().trim().max(500).optional(),
});

// ------------------------------------------------------------------ Rotas

/**
 * POST  /api/p2p/orders             → cria ordem e devolve cobrança Pix (copia e cola + QR)
 * GET   /api/p2p/orders/:id         → status atual + linha do tempo
 * POST  /api/p2p/orders/:id/cancel  → cancelamento pelo usuário (apenas PENDING)
 * PATCH /api/p2p/orders/:id/status  → webhook do pagamento (exige x-webhook-secret)
 */
export function p2pRoutes(service: P2PService, guards: { write: RequestHandler; webhook: RequestHandler }): Router {
  const router = Router();

  router.post(
    '/orders',
    guards.write,
    asyncHandler(async (req, res) => {
      const body = CreateOrderBody.parse(req.body);
      const idempotencyKey = IdempotencyKey.parse(req.header('idempotency-key') ?? undefined);
      const { order, created: isNew } = await service.createOrder({
        assetSymbol: body.assetSymbol,
        fiatCents: body.fiatAmount,
        userWalletAddress: body.userWalletAddress,
        idempotencyKey,
      });
      const meta = { idempotentReplay: !isNew, disclaimer: LEGAL_DISCLAIMER };
      if (isNew) res.setHeader('Location', `/api/p2p/orders/${order.id}`);
      return isNew ? created(res, order, meta) : ok(res, order, meta);
    }),
  );

  router.get(
    '/orders/:id',
    asyncHandler(async (req, res) => {
      const { id } = OrderIdParam.parse(req.params);
      const withQrCode = req.query.qrcode !== 'false';
      return ok(res, await service.getOrder(id, { withQrCode }));
    }),
  );

  /** Cancelamento pelo próprio usuário (botão vermelho "Cancelar ordem"): só vale para PENDING. */
  router.post(
    '/orders/:id/cancel',
    guards.write,
    asyncHandler(async (req, res) => {
      const { id } = OrderIdParam.parse(req.params);
      const { order, changed } = await service.updateStatus(id, { status: 'CANCELLED', note: 'Cancelada pelo usuário' }, 'api');
      return ok(res, order, { changed });
    }),
  );

  router.patch(
    '/orders/:id/status',
    guards.webhook,
    asyncHandler(async (req, res) => {
      const { id } = OrderIdParam.parse(req.params);
      const body = UpdateStatusBody.parse(req.body);
      const { order, changed } = await service.updateStatus(id, body, 'webhook');
      return ok(res, order, { changed });
    }),
  );

  return router;
}
