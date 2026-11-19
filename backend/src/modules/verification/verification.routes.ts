import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { asyncHandler, ok } from '../../shared/http.js';
import type { VerificationService } from './verification.service.js';

const Email = z.string({ required_error: 'email é obrigatório' }).trim().toLowerCase().email('email inválido.').max(254);
const Phone = z
  .string({ required_error: 'phone é obrigatório' })
  .trim()
  .regex(/^\+[1-9]\d{7,14}$/, 'phone deve estar no formato E.164 (ex.: +5511999998888).');
const Code = z
  .string({ required_error: 'code é obrigatório' })
  .trim()
  .regex(/^\d{6}$/, 'code deve ter 6 dígitos.');

const EmailSendBody = z.object({ email: Email });
const EmailConfirmBody = z.object({ email: Email, code: Code });
const PhoneSendBody = z.object({ phone: Phone });
const PhoneConfirmBody = z.object({ phone: Phone, code: Code });

/**
 * POST /api/verification/email/send      → envia código de confirmação por e-mail
 * POST /api/verification/email/confirm   → valida o código do e-mail
 * POST /api/verification/phone/send      → envia código por SMS (Twilio Verify)
 * POST /api/verification/phone/confirm   → valida o código do SMS
 */
export function verificationRoutes(service: VerificationService, guards: { verify: RequestHandler }): Router {
  const router = Router();

  router.post(
    '/email/send',
    guards.verify,
    asyncHandler(async (req, res) => {
      const { email } = EmailSendBody.parse(req.body);
      return ok(res, await service.sendEmailCode(email));
    }),
  );

  router.post(
    '/email/confirm',
    guards.verify,
    asyncHandler(async (req, res) => {
      const { email, code } = EmailConfirmBody.parse(req.body);
      return ok(res, await service.confirmEmailCode(email, code));
    }),
  );

  router.post(
    '/phone/send',
    guards.verify,
    asyncHandler(async (req, res) => {
      const { phone } = PhoneSendBody.parse(req.body);
      return ok(res, await service.sendPhoneCode(phone));
    }),
  );

  router.post(
    '/phone/confirm',
    guards.verify,
    asyncHandler(async (req, res) => {
      const { phone, code } = PhoneConfirmBody.parse(req.body);
      return ok(res, await service.confirmPhoneCode(phone, code));
    }),
  );

  return router;
}
