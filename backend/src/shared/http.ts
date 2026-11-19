import type { NextFunction, Request, RequestHandler, Response } from 'express';

/**
 * Express 4 não captura rejeições de handlers async.
 * Este wrapper encaminha qualquer erro para o middleware de erros.
 */
export const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res, next).catch(next);
  };

/** Envelope padrão de sucesso: { data, meta? } */
export function ok(res: Response, data: unknown, meta?: Record<string, unknown>, status = 200) {
  return res.status(status).json(meta ? { data, meta } : { data });
}

export function created(res: Response, data: unknown, meta?: Record<string, unknown>) {
  return ok(res, data, meta, 201);
}
