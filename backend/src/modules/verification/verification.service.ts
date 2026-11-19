import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import { desc, eq, sql } from 'drizzle-orm';
import type { Env } from '../../config/env.js';
import type { Database } from '../../db/client.js';
import { emailVerificationCodes, users } from '../../db/schema.js';
import { badRequest } from '../../shared/errors.js';
import type { Logger } from '../../shared/logger.js';
import type { EmailSender } from './email-sender.js';
import { emailCodeTemplate } from './email-templates.js';
import type { PhoneVerifier } from './phone-verifier.js';

/**
 * Confirmação de e-mail (código próprio, hash no banco) e de telefone (delegada ao PhoneVerifier).
 * Respostas de envio são sempre genéricas — nunca revelam se o destino existe na base.
 */
export class VerificationService {
  constructor(
    private readonly db: Database,
    private readonly env: Env,
    private readonly emailSender: EmailSender,
    private readonly phoneVerifier: PhoneVerifier,
    private readonly logger: Logger,
  ) {}

  private hashCode(email: string, code: string): string {
    return createHash('sha256').update(`${email}:${code}`).digest('hex');
  }

  async sendEmailCode(email: string): Promise<{ sent: true; message: string }> {
    const genericResponse = { sent: true as const, message: 'Se o e-mail for válido, um código foi enviado.' };

    const [latest] = await this.db
      .select()
      .from(emailVerificationCodes)
      .where(eq(emailVerificationCodes.email, email))
      .orderBy(desc(emailVerificationCodes.createdAt))
      .limit(1);

    // Cooldown de reenvio: responde genérico sem reenviar (não vaza existência nem estado).
    if (latest && !latest.consumedAt) {
      const ageSeconds = (Date.now() - latest.createdAt.getTime()) / 1000;
      if (ageSeconds < this.env.VERIFY_RESEND_COOLDOWN_SECONDS) return genericResponse;
    }

    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const expiresAt = new Date(Date.now() + this.env.VERIFY_CODE_TTL_MINUTES * 60_000);

    // Um único código ativo por e-mail.
    await this.db.delete(emailVerificationCodes).where(eq(emailVerificationCodes.email, email));
    await this.db.insert(emailVerificationCodes).values({ email, codeHash: this.hashCode(email, code), expiresAt });

    const tpl = emailCodeTemplate(code, this.env.VERIFY_CODE_TTL_MINUTES);
    try {
      await this.emailSender.send(email, tpl.subject, tpl.html, tpl.text);
    } catch (err) {
      this.logger.error({ err }, 'Falha ao enviar e-mail de confirmação');
      // Resposta continua genérica: não expor falha de entrega por destinatário.
    }
    return genericResponse;
  }

  async confirmEmailCode(email: string, code: string): Promise<{ verified: true }> {
    const [record] = await this.db
      .select()
      .from(emailVerificationCodes)
      .where(eq(emailVerificationCodes.email, email))
      .orderBy(desc(emailVerificationCodes.createdAt))
      .limit(1);

    const expired = badRequest('CODE_EXPIRED', 'Código expirado ou inexistente. Solicite um novo.');
    if (!record || record.consumedAt || record.expiresAt.getTime() < Date.now()) throw expired;
    if (record.attempts >= this.env.VERIFY_MAX_ATTEMPTS) {
      throw badRequest('TOO_MANY_ATTEMPTS', 'Número máximo de tentativas excedido. Solicite um novo código.');
    }

    const expectedHash = Buffer.from(record.codeHash, 'hex');
    const givenHash = Buffer.from(this.hashCode(email, code), 'hex');
    const matches = expectedHash.length === givenHash.length && timingSafeEqual(expectedHash, givenHash);

    if (!matches) {
      await this.db
        .update(emailVerificationCodes)
        .set({ attempts: record.attempts + 1 })
        .where(eq(emailVerificationCodes.id, record.id));
      throw badRequest('CODE_INVALID', 'Código incorreto. Verifique e tente novamente.');
    }

    await this.db
      .update(emailVerificationCodes)
      .set({ consumedAt: new Date() })
      .where(eq(emailVerificationCodes.id, record.id));
    // Se houver conta com este e-mail, marca como verificado.
    await this.db.update(users).set({ emailVerified: true, updatedAt: sql`now()` }).where(eq(users.email, email));
    return { verified: true };
  }

  async sendPhoneCode(phoneE164: string): Promise<{ sent: true; message: string }> {
    await this.phoneVerifier.start(phoneE164);
    return { sent: true, message: 'Código enviado por SMS.' };
  }

  async confirmPhoneCode(phoneE164: string, code: string): Promise<{ verified: true }> {
    const approved = await this.phoneVerifier.check(phoneE164, code);
    if (!approved) throw badRequest('CODE_INVALID', 'Código incorreto ou expirado. Verifique e tente novamente.');
    // Se houver conta com este telefone, marca como verificado.
    await this.db.update(users).set({ phoneVerified: true, updatedAt: sql`now()` }).where(eq(users.phoneE164, phoneE164));
    return { verified: true };
  }
}
