import { pino, type Logger } from 'pino';

/**
 * Logger estruturado (JSON). Em desenvolvimento, use `npm run dev | npx pino-pretty`.
 * Segredos e endereços nunca vão em claro para o log.
 */
export function createLogger(level: string): Logger {
  return pino({
    level,
    base: { service: 'cmmd-backend' },
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.headers["x-webhook-secret"]',
        'req.headers["idempotency-key"]',
      ],
      censor: '[REDACTED]',
    },
  });
}

export type { Logger };
