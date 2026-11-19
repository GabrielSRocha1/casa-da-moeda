/**
 * Erros de aplicação com status HTTP e código estável (para o frontend tratar).
 * Formato da resposta: { error: { code, message, details?, requestId } }
 */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (code: string, message: string, details?: unknown) => new AppError(400, code, message, details);
export const unauthorized = (message = 'Não autorizado.') => new AppError(401, 'UNAUTHORIZED', message);
export const notFound = (code: string, message: string) => new AppError(404, code, message);
export const conflict = (code: string, message: string, details?: unknown) => new AppError(409, code, message, details);
export const badGateway = (code: string, message: string) => new AppError(502, code, message);
