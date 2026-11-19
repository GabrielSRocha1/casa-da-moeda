import cors from 'cors';
import type { RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import helmet from 'helmet';
import type { Env } from '../config/env.js';

/** Helmet: cabeçalhos de segurança para uma API JSON (sem HTML servido). */
export function securityHeaders(): RequestHandler {
  return helmet({
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  });
}

/** CORS configurável por CORS_ORIGINS (lista separada por vírgula, ou "*"). */
export function corsPolicy(env: Env): RequestHandler {
  const origins = env.CORS_ORIGINS;
  const allowAll = origins.includes('*');
  return cors({
    origin: allowAll ? true : (origin, cb) => cb(null, !origin || origins.includes(origin)),
    methods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Idempotency-Key', 'X-Request-Id', 'X-Webhook-Secret'],
    exposedHeaders: ['X-Request-Id', 'RateLimit-Limit', 'RateLimit-Remaining', 'RateLimit-Reset'],
    maxAge: 600,
  });
}

const rateLimitBody = {
  error: { code: 'RATE_LIMITED', message: 'Muitas requisições. Aguarde alguns instantes e tente novamente.' },
};

/** Limite global (leitura). */
export function globalRateLimit(env: Env): RequestHandler {
  return rateLimit({
    windowMs: 15 * 60_000,
    limit: 600,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: () => !env.RATE_LIMIT_ENABLED,
    message: rateLimitBody,
  });
}

/** Limite mais rígido para criação de ordens e solicitações B2B. */
export function writeRateLimit(env: Env): RequestHandler {
  return rateLimit({
    windowMs: 60_000,
    limit: 20,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: () => !env.RATE_LIMIT_ENABLED,
    message: rateLimitBody,
  });
}

/** Limite bem restrito para envio/validação de códigos de verificação (e-mail/SMS). */
export function verificationRateLimit(env: Env): RequestHandler {
  return rateLimit({
    windowMs: 10 * 60_000,
    limit: 8,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: () => !env.RATE_LIMIT_ENABLED,
    message: rateLimitBody,
  });
}
