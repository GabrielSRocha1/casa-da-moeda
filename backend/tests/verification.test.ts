import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { emailVerificationCodes } from '../src/db/schema.js';
import type { EmailSender } from '../src/modules/verification/email-sender.js';
import type { PhoneVerifier } from '../src/modules/verification/phone-verifier.js';
import { buildTestApp } from './helpers.js';

/** Captura o código de 6 dígitos do corpo do e-mail em vez de enviar. */
class FakeEmailSender implements EmailSender {
  sent: Array<{ to: string; subject: string; text: string }> = [];
  async send(to: string, subject: string, _html: string, text: string): Promise<void> {
    this.sent.push({ to, subject, text });
  }
  lastCode(): string {
    const text = this.sent[this.sent.length - 1]?.text ?? '';
    return text.match(/\b(\d{6})\b/)?.[1] ?? '';
  }
}

/** Verifier de telefone determinístico: aceita apenas o código fixo '123456'. */
class FakePhoneVerifier implements PhoneVerifier {
  started: string[] = [];
  async start(phoneE164: string): Promise<void> {
    this.started.push(phoneE164);
  }
  async check(_phoneE164: string, code: string): Promise<boolean> {
    return code === '123456';
  }
}

type Ctx = Awaited<ReturnType<typeof buildTestApp>>;
let ctx: Ctx;
const emailSender = new FakeEmailSender();
const phoneVerifier = new FakePhoneVerifier();

beforeAll(async () => {
  ctx = await buildTestApp({ VERIFY_RESEND_COOLDOWN_SECONDS: '0' }, { emailSender, phoneVerifier });
});
afterAll(async () => {
  await ctx.close();
});

const api = () => request(ctx.app);

describe('Verificação de e-mail', () => {
  const email = 'usuario@exemplo.com';

  it('send → 200 genérico e e-mail com código de 6 dígitos', async () => {
    const res = await api().post('/api/verification/email/send').send({ email });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ sent: true });
    expect(emailSender.sent.at(-1)?.to).toBe(email);
    expect(emailSender.lastCode()).toMatch(/^\d{6}$/);
  });

  it('código não fica em claro no banco (apenas hash)', async () => {
    const code = emailSender.lastCode();
    const rows = await ctx.database.db.select().from(emailVerificationCodes).where(eq(emailVerificationCodes.email, email));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.codeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0]?.codeHash).not.toContain(code);
  });

  it('confirm com código errado → 400 CODE_INVALID', async () => {
    const res = await api().post('/api/verification/email/confirm').send({ email, code: '000000' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('CODE_INVALID');
  });

  it('confirm com código correto → 200 verified', async () => {
    const res = await api().post('/api/verification/email/confirm').send({ email, code: emailSender.lastCode() });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ verified: true });
  });

  it('código consumido não pode ser reutilizado → CODE_EXPIRED', async () => {
    const res = await api().post('/api/verification/email/confirm').send({ email, code: emailSender.lastCode() });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('CODE_EXPIRED');
  });

  it('bloqueia após exceder o máximo de tentativas', async () => {
    const target = 'bloqueio@exemplo.com';
    await api().post('/api/verification/email/send').send({ email: target });
    const rightCode = emailSender.lastCode();
    for (let i = 0; i < ctx.env.VERIFY_MAX_ATTEMPTS; i++) {
      await api().post('/api/verification/email/confirm').send({ email: target, code: '999999' });
    }
    // Mesmo com o código certo, depois do limite → TOO_MANY_ATTEMPTS
    const res = await api().post('/api/verification/email/confirm').send({ email: target, code: rightCode });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('TOO_MANY_ATTEMPTS');
  });

  it('código expirado → CODE_EXPIRED', async () => {
    const target = 'expirado@exemplo.com';
    await api().post('/api/verification/email/send').send({ email: target });
    const code = emailSender.lastCode();
    await ctx.database.db
      .update(emailVerificationCodes)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(emailVerificationCodes.email, target));
    const res = await api().post('/api/verification/email/confirm').send({ email: target, code });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('CODE_EXPIRED');
  });

  it('cooldown de reenvio: não envia novo e-mail dentro da janela', async () => {
    const sender = new FakeEmailSender();
    const app = await buildTestApp({ VERIFY_RESEND_COOLDOWN_SECONDS: '60' }, { emailSender: sender, phoneVerifier });
    await request(app.app).post('/api/verification/email/send').send({ email: 'cooldown@exemplo.com' });
    const res = await request(app.app).post('/api/verification/email/send').send({ email: 'cooldown@exemplo.com' });
    expect(res.status).toBe(200); // resposta genérica, sem vazar o estado
    expect(sender.sent).toHaveLength(1); // mas nenhum segundo e-mail saiu
    await app.close();
  });

  it('e-mail inválido → 400 de validação', async () => {
    const res = await api().post('/api/verification/email/send').send({ email: 'nao-e-email' });
    expect(res.status).toBe(400);
  });
});

describe('Verificação de telefone', () => {
  const phone = '+5511999998888';

  it('send → 200 e provider acionado com o E.164', async () => {
    const res = await api().post('/api/verification/phone/send').send({ phone });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ sent: true });
    expect(phoneVerifier.started).toContain(phone);
  });

  it('confirm com código errado → 400 CODE_INVALID', async () => {
    const res = await api().post('/api/verification/phone/confirm').send({ phone, code: '000000' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('CODE_INVALID');
  });

  it('confirm com código correto → 200 verified', async () => {
    const res = await api().post('/api/verification/phone/confirm').send({ phone, code: '123456' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ verified: true });
  });

  it('telefone fora do E.164 → 400 de validação', async () => {
    const res = await api().post('/api/verification/phone/send').send({ phone: '11 99999-8888' });
    expect(res.status).toBe(400);
  });
});
