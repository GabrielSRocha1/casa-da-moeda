import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EmailSender } from '../src/modules/verification/email-sender.js';
import type { PhoneVerifier } from '../src/modules/verification/phone-verifier.js';
import { buildTestApp, solanaAddress } from './helpers.js';

class FakeEmailSender implements EmailSender {
  sent: Array<{ to: string; text: string }> = [];
  async send(to: string, _s: string, _h: string, text: string): Promise<void> {
    this.sent.push({ to, text });
  }
  lastCode(): string {
    return this.sent[this.sent.length - 1]?.text.match(/\b(\d{6})\b/)?.[1] ?? '';
  }
}
class FakePhoneVerifier implements PhoneVerifier {
  async start(): Promise<void> {}
  async check(_p: string, code: string): Promise<boolean> {
    return code === '123456';
  }
}

type Ctx = Awaited<ReturnType<typeof buildTestApp>>;
let ctx: Ctx;
const emailSender = new FakeEmailSender();

beforeAll(async () => {
  ctx = await buildTestApp({ VERIFY_RESEND_COOLDOWN_SECONDS: '0' }, { emailSender, phoneVerifier: new FakePhoneVerifier() });
});
afterAll(async () => {
  await ctx.close();
});

const api = () => request(ctx.app);

function registerBody(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Usuária de Teste',
    email: `conta-${Math.random().toString(36).slice(2, 8)}@exemplo.com`,
    phoneDdi: '55',
    phoneNumber: '11912345678',
    wallet: solanaAddress(),
    password: 'senha-forte-123',
    ...overrides,
  };
}

describe('Cadastro e login', () => {
  it('register → 201 com token e usuário (sem vazar hash de senha)', async () => {
    const body = registerBody();
    const res = await api().post('/api/auth/register').send(body);
    expect(res.status).toBe(201);
    expect(res.body.data.token).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(res.body.data.user).toMatchObject({
      email: body.email,
      name: body.name,
      phone: { ddi: '55', number: '11912345678' },
      walletNetwork: 'solana',
      emailVerified: false,
      phoneVerified: false,
    });
    expect(JSON.stringify(res.body)).not.toMatch(/passHash|scrypt|senha-forte/);
  });

  it('e-mail duplicado → 409 EMAIL_IN_USE', async () => {
    const body = registerBody();
    await api().post('/api/auth/register').send(body);
    const res = await api().post('/api/auth/register').send(registerBody({ email: body.email }));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_IN_USE');
  });

  it('wallet fora da curva → 400 apontando o campo wallet', async () => {
    const res = await api().post('/api/auth/register').send(registerBody({ wallet: '1'.repeat(40) }));
    expect(res.status).toBe(400);
  });

  it('login correto → 200 com nova sessão; senha errada → 401 genérico', async () => {
    const body = registerBody();
    await api().post('/api/auth/register').send(body);
    const ok = await api().post('/api/auth/login').send({ email: body.email, password: body.password });
    expect(ok.status).toBe(200);
    expect(ok.body.data.token).toBeTruthy();
    const bad = await api().post('/api/auth/login').send({ email: body.email, password: 'senha-errada-999' });
    expect(bad.status).toBe(401);
    const ghost = await api().post('/api/auth/login').send({ email: 'nao-existe@exemplo.com', password: 'qualquer-coisa' });
    expect(ghost.status).toBe(401);
    expect(bad.body.error.message).toBe(ghost.body.error.message); // não revela se o e-mail existe
  });

  it('GET /me com token válido → usuário; token inválido → 401', async () => {
    const reg = await api().post('/api/auth/register').send(registerBody());
    const me = await api().get('/api/auth/me').set('Authorization', `Bearer ${reg.body.data.token}`);
    expect(me.status).toBe(200);
    expect(me.body.data.email).toBe(reg.body.data.user.email);
    const bad = await api().get('/api/auth/me').set('Authorization', 'Bearer token-invalido-xxxxxxxxxxxxxxxxxxxxxxxx');
    expect(bad.status).toBe(401);
  });

  it('logout revoga a sessão', async () => {
    const reg = await api().post('/api/auth/register').send(registerBody());
    const token = reg.body.data.token;
    await api().post('/api/auth/logout').set('Authorization', `Bearer ${token}`);
    const me = await api().get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    expect(me.status).toBe(401);
  });
});

describe('Confirmações marcam as flags na conta', () => {
  it('confirmar código de e-mail → email_verified = true', async () => {
    const body = registerBody();
    const reg = await api().post('/api/auth/register').send(body);
    await api().post('/api/verification/email/send').send({ email: body.email });
    const confirm = await api().post('/api/verification/email/confirm').send({ email: body.email, code: emailSender.lastCode() });
    expect(confirm.status).toBe(200);
    const me = await api().get('/api/auth/me').set('Authorization', `Bearer ${reg.body.data.token}`);
    expect(me.body.data.emailVerified).toBe(true);
  });

  it('confirmar código de SMS → phone_verified = true', async () => {
    const body = registerBody({ phoneNumber: '11999887766' });
    const reg = await api().post('/api/auth/register').send(body);
    const phone = '+5511999887766';
    await api().post('/api/verification/phone/send').send({ phone });
    const confirm = await api().post('/api/verification/phone/confirm').send({ phone, code: '123456' });
    expect(confirm.status).toBe(200);
    const me = await api().get('/api/auth/me').set('Authorization', `Bearer ${reg.body.data.token}`);
    expect(me.body.data.phoneVerified).toBe(true);
  });
});
