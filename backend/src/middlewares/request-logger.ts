import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { pinoHttp } from 'pino-http';
import type { Logger } from '../shared/logger.js';

const REQUEST_ID_RE = /^[A-Za-z0-9._-]{8,64}$/;

/**
 * Log de requisições + correlação por x-request-id.
 * Reaproveita o x-request-id enviado pelo cliente/proxy (se válido) e o devolve na resposta.
 * Corpo da requisição NÃO é logado (pode conter endereços de carteira, e-mails, etc.).
 */
export function requestLogger(logger: Logger) {
  return pinoHttp({
    logger,
    genReqId(req: IncomingMessage, res: ServerResponse) {
      const incoming = req.headers['x-request-id'];
      const id = typeof incoming === 'string' && REQUEST_ID_RE.test(incoming) ? incoming : randomUUID();
      res.setHeader('x-request-id', id);
      return id;
    },
    customLogLevel(_req, res, err) {
      if (err || res.statusCode >= 500) return 'error';
      if (res.statusCode >= 400) return 'warn';
      return 'info';
    },
    serializers: {
      req: (req: { id: string; method: string; url: string }) => ({ id: req.id, method: req.method, url: req.url }),
      res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
    },
    autoLogging: { ignore: (req) => req.url === '/health' },
  });
}
