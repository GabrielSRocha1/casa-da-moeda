import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { asyncHandler, created, ok } from '../../shared/http.js';
import { unauthorized } from '../../shared/errors.js';
import type { AuthService } from './auth.service.js';

const RegisterBody = z.object({
  name: z.string({ required_error: 'name é obrigatório' }).trim().min(3, 'Informe seu nome completo.').max(120),
  email: z.string({ required_error: 'email é obrigatório' }).trim().toLowerCase().email('E-mail inválido.').max(254),
  phoneDdi: z.string({ required_error: 'phoneDdi é obrigatório' }).trim().regex(/^\d{1,4}$/, 'DDI inválido.'),
  phoneNumber: z
    .string({ required_error: 'phoneNumber é obrigatório' })
    .transform((s) => s.replace(/\D/g, ''))
    .pipe(z.string().min(8, 'Telefone inválido.').max(15)),
  wallet: z.string({ required_error: 'wallet é obrigatório' }).trim().max(200),
  password: z.string({ required_error: 'password é obrigatório' }).min(8, 'A senha precisa ter pelo menos 8 caracteres.').max(200),
});

const LoginBody = z.object({
  email: z.string({ required_error: 'email é obrigatório' }).trim().max(254),
  password: z.string({ required_error: 'password é obrigatório' }).max(200),
});

export function bearerToken(header: string | undefined): string {
  const m = /^Bearer\s+(.+)$/i.exec(header ?? '');
  if (!m) throw unauthorized('Envie o token de sessão no header Authorization: Bearer <token>.');
  return m[1]!;
}

/**
 * POST /api/auth/register  → cria a conta e já devolve a sessão
 * POST /api/auth/login     → sessão nova
 * GET  /api/auth/me        → usuário da sessão (Bearer)
 * POST /api/auth/logout    → revoga a sessão (Bearer)
 */
export function authRoutes(service: AuthService, guards: { verify: RequestHandler }): Router {
  const router = Router();

  router.post(
    '/register',
    guards.verify,
    asyncHandler(async (req, res) => {
      const body = RegisterBody.parse(req.body);
      return created(res, await service.register(body));
    }),
  );

  router.post(
    '/login',
    guards.verify,
    asyncHandler(async (req, res) => {
      const { email, password } = LoginBody.parse(req.body);
      return ok(res, await service.login(email, password));
    }),
  );

  router.get(
    '/me',
    asyncHandler(async (req, res) => {
      return ok(res, await service.me(bearerToken(req.header('authorization'))));
    }),
  );

  router.post(
    '/logout',
    asyncHandler(async (req, res) => {
      await service.logout(bearerToken(req.header('authorization')));
      return ok(res, { loggedOut: true });
    }),
  );

  return router;
}
