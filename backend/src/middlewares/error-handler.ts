import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../shared/errors.js';

/** 404 para rotas inexistentes. */
export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({
    error: {
      code: 'ROUTE_NOT_FOUND',
      message: `Rota ${req.method} ${req.path} não encontrada.`,
      requestId: req.id,
    },
  });
};

/** Converte issues do Zod em uma lista amigável { field, message }. */
function formatZodIssues(err: ZodError) {
  return err.issues.map((i) => ({ field: i.path.join('.') || '(body)', message: i.message }));
}

/**
 * Middleware central de erros. Garante sempre JSON no formato:
 *   { error: { code, message, details?, requestId } }
 * Erros inesperados viram 500 genérico (detalhes só no log, nunca para o cliente).
 */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const requestId = req.id;
  const send = (status: number, code: string, message: string, details?: unknown) =>
    res.status(status).json({ error: { code, message, ...(details !== undefined ? { details } : {}), requestId } });

  if (err instanceof AppError) {
    if (err.status >= 500) req.log?.error({ err }, err.message);
    return send(err.status, err.code, err.message, err.details);
  }

  if (err instanceof ZodError) {
    return send(400, 'VALIDATION_ERROR', 'Dados inválidos. Verifique os campos informados.', formatZodIssues(err));
  }

  // Erros do body-parser (express.json)
  const e = err as { type?: string; status?: number; code?: string };
  if (e?.type === 'entity.parse.failed') return send(400, 'INVALID_JSON', 'O corpo da requisição não é um JSON válido.');
  if (e?.type === 'entity.too.large') return send(413, 'PAYLOAD_TOO_LARGE', 'Corpo da requisição muito grande.');
  if (e?.type === 'encoding.unsupported' || e?.type === 'charset.unsupported') {
    return send(415, 'UNSUPPORTED_ENCODING', 'Codificação não suportada. Use UTF-8.');
  }

  // Violação de unicidade no Postgres (corrida entre duas requisições simultâneas)
  const pgCode = e?.code ?? (err as { cause?: { code?: string } })?.cause?.code;
  if (pgCode === '23505') return send(409, 'DUPLICATE_RESOURCE', 'Registro já existe.');

  req.log?.error({ err }, 'Erro não tratado');
  return send(500, 'INTERNAL_ERROR', 'Erro interno do servidor. Tente novamente mais tarde.');
};
