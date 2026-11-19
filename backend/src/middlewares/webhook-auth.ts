import { createHash, timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';
import { unauthorized } from '../shared/errors.js';

/**
 * Protege o webhook de pagamento: exige o header `x-webhook-secret`.
 * Comparação em tempo constante (sobre o hash, para não vazar o tamanho do segredo).
 */
export function webhookAuth(secret: string): RequestHandler {
  const expected = createHash('sha256').update(secret).digest();
  return (req, _res, next) => {
    const provided = req.header('x-webhook-secret');
    if (!provided) return next(unauthorized('Header x-webhook-secret ausente.'));
    const got = createHash('sha256').update(provided).digest();
    if (!timingSafeEqual(got, expected)) return next(unauthorized('Segredo do webhook inválido.'));
    next();
  };
}
