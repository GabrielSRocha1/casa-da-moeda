import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LEGAL_DISCLAIMER } from '../src/config/constants.js';
import type { TokenDispatcher } from '../src/modules/p2p/custody/token-dispatcher.js';
import { EVM_CHECKSUMMED, WEBHOOK_SECRET, buildTestApp, offCurveSolanaAddress, solanaAddress } from './helpers.js';

type Ctx = Awaited<ReturnType<typeof buildTestApp>>;
let ctx: Ctx;

beforeAll(async () => {
  ctx = await buildTestApp();
});
afterAll(async () => {
  await ctx.close();
});

const api = () => request(ctx.app);
const createOrder = (body: Record<string, unknown>, headers: Record<string, string> = {}) =>
  api().post('/api/p2p/orders').set(headers).send(body);
const setStatus = (id: string, body: Record<string, unknown>, secret = WEBHOOK_SECRET) =>
  api().patch(`/api/p2p/orders/${id}/status`).set('x-webhook-secret', secret).send(body);

// ===================================================================== Infra
describe('Infra e segurança', () => {
  it('GET /health → 200', async () => {
    const res = await api().get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok', database: 'pglite' });
  });

  it('aplica Helmet e x-request-id', async () => {
    const res = await api().get('/api/tokens').set('x-request-id', 'req-test-12345');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBeDefined();
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-request-id']).toBe('req-test-12345');
  });

  it('responde CORS preflight', async () => {
    const res = await api().options('/api/p2p/orders').set('Origin', 'https://app.exemplo.com').set('Access-Control-Request-Method', 'POST');
    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('https://app.exemplo.com');
  });

  it('rota inexistente → 404 JSON', async () => {
    const res = await api().get('/api/nao-existe');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('ROUTE_NOT_FOUND');
    expect(res.body.error.requestId).toBeTruthy();
  });

  it('JSON malformado → 400 INVALID_JSON', async () => {
    const res = await api().post('/api/p2p/orders').set('Content-Type', 'application/json').send('{"assetSymbol":');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_JSON');
  });

  it('erro inesperado → 500 genérico sem vazar detalhes', async () => {
    const failing = await buildTestApp();
    await failing.database.close(); // derruba o banco de propósito
    const res = await request(failing.app).get('/api/tokens');
    expect(res.status).toBe(500);
    expect(res.body.error).toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(JSON.stringify(res.body)).not.toMatch(/stack|PGlite/i);
  });

  it('rate limit devolve 429 quando habilitado', async () => {
    const limited = await buildTestApp({ RATE_LIMIT_ENABLED: 'true' });
    let last = 0;
    for (let i = 0; i < 21; i++) last = (await request(limited.app).post('/api/b2b/tokens/create').send({})).status;
    expect(last).toBe(429);
    await limited.close();
  });
});

// ===================================================================== Tokens
describe('A. Ativos e cotações', () => {
  it('GET /api/tokens → 3 ativos nativos com metadados', async () => {
    const res = await api().get('/api/tokens');
    expect(res.status).toBe(200);
    expect(res.body.data.map((t: { symbol: string }) => t.symbol)).toEqual(['BDC', 'VRC', 'ESCT']);
    const bode = res.body.data[0];
    expect(bode).toMatchObject({ name: 'Bode Coin', type: 'NATIVE', price: '0.85000000', change24h: 4.2, trend: 'UP', priceCurrency: 'BRL', chain: 'solana' });
    expect(bode.mintAddress).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
    expect(res.body.data[2]).toMatchObject({ symbol: 'ESCT', change24h: -2.1, trend: 'DOWN' });
    expect(res.body.meta.disclaimer).toBe(LEGAL_DISCLAIMER);
  });

  it('GET /api/tokens?type=CUSTOM → lista vazia', async () => {
    const res = await api().get('/api/tokens?type=custom');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it('GET /api/tokens?type=XYZ → 400', async () => {
    expect((await api().get('/api/tokens?type=XYZ')).status).toBe(400);
  });

  it('GET /api/tokens/:symbol (case-insensitive)', async () => {
    const res = await api().get('/api/tokens/vrc');
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ symbol: 'VRC', name: 'Verum Coin', price: '3.40000000' });
  });

  it('GET /api/tokens/:symbol inexistente → 404', async () => {
    const res = await api().get('/api/tokens/NOPE');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('TOKEN_NOT_FOUND');
  });

  it('GET /api/tokens/:symbol inválido → 400', async () => {
    expect((await api().get('/api/tokens/a$')).status).toBe(400);
  });
});

// ===================================================================== Carteira
describe('Módulo de carteira', () => {
  it('POST /api/wallet/validate → 200 para Solana', async () => {
    const addr = solanaAddress();
    const res = await api().post('/api/wallet/validate').send({ address: addr });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ valid: true, network: 'solana', address: addr });
  });

  it('POST /api/wallet/validate → 400 para PDA', async () => {
    const res = await api().post('/api/wallet/validate').send({ address: offCurveSolanaAddress() });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('WALLET_NOT_SELF_CUSTODY');
  });

  it('POST /api/wallet/validate → 400 SEED_PHRASE_DETECTED', async () => {
    const res = await api().post('/api/wallet/validate').send({ address: 'abandon '.repeat(12).trim() });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('SEED_PHRASE_DETECTED');
  });
});

// ===================================================================== P2P
describe('B. Transações P2P', () => {
  it('cria ordem: calcula tokens, trava cotação e gera Pix', async () => {
    const wallet = solanaAddress();
    const res = await createOrder({ assetSymbol: 'bdc', fiatAmount: 500, userWalletAddress: wallet });
    expect(res.status).toBe(201);
    expect(res.headers.location).toBe(`/api/p2p/orders/${res.body.data.id}`);
    const o = res.body.data;
    expect(o).toMatchObject({
      status: 'PENDING',
      statusLabel: 'Pendente',
      assetSymbol: 'BDC',
      fiatAmount: '500.00',
      feeAmount: '7.50',
      netFiatAmount: '492.50',
      unitPrice: '0.85000000',
      tokenAmount: '579.41176470', // 492.50 / 0.85, truncado
      userWalletAddress: wallet,
      walletNetwork: 'solana',
      custody: null,
    });
    expect(o.payment.simulated).toBe(true);
    expect(o.payment.pixCopyPaste).toMatch(/^000201.*6304[0-9A-F]{4}$/);
    expect(o.payment.qrCodeDataUrl).toMatch(/^data:image\/png;base64,/);
    expect(new Date(o.payment.expiresAt).getTime()).toBeGreaterThan(Date.now() + 14 * 60_000);
    expect(o.timeline).toHaveLength(1);
    expect(res.body.meta.disclaimer).toBe(LEGAL_DISCLAIMER);
  });

  it('aceita valor como string com vírgula e carteira EVM (normaliza checksum)', async () => {
    const res = await createOrder({ assetSymbol: 'VRC', fiatAmount: '100,00', userWalletAddress: EVM_CHECKSUMMED.toLowerCase() });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ fiatAmount: '100.00', tokenAmount: '28.97058823', walletNetwork: 'evm', userWalletAddress: EVM_CHECKSUMMED });
  });

  it.each([
    [{}, 'VALIDATION_ERROR'],
    [{ assetSymbol: 'BDC', fiatAmount: 'abc', userWalletAddress: 'x' }, 'VALIDATION_ERROR'],
    [{ assetSymbol: 'BDC', fiatAmount: 10.123, userWalletAddress: 'x' }, 'VALIDATION_ERROR'],
    [{ assetSymbol: 'BDC', fiatAmount: -50, userWalletAddress: 'x' }, 'VALIDATION_ERROR'],
  ])('rejeita payload inválido %#', async (body, code) => {
    const res = await createOrder(body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe(code);
    expect(Array.isArray(res.body.error.details)).toBe(true);
  });

  it('rejeita valor fora do limite (mín. R$ 20 / máx. R$ 50.000)', async () => {
    const w = solanaAddress();
    expect((await createOrder({ assetSymbol: 'BDC', fiatAmount: 19.99, userWalletAddress: w })).body.error.code).toBe('FIAT_AMOUNT_OUT_OF_RANGE');
    expect((await createOrder({ assetSymbol: 'BDC', fiatAmount: 50000.01, userWalletAddress: w })).status).toBe(400);
  });

  it('rejeita carteira inválida, PDA e seed phrase', async () => {
    const base = { assetSymbol: 'BDC', fiatAmount: 100 };
    expect((await createOrder({ ...base, userWalletAddress: '0x123' })).body.error.code).toBe('WALLET_INVALID_FORMAT');
    expect((await createOrder({ ...base, userWalletAddress: offCurveSolanaAddress() })).body.error.code).toBe('WALLET_NOT_SELF_CUSTODY');
    expect((await createOrder({ ...base, userWalletAddress: 'word '.repeat(24) })).body.error.code).toBe('SEED_PHRASE_DETECTED');
  });

  it('token inexistente → 404', async () => {
    const res = await createOrder({ assetSymbol: 'FAKE', fiatAmount: 100, userWalletAddress: solanaAddress() });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('TOKEN_NOT_FOUND');
  });

  it('Idempotency-Key: repete a mesma ordem e bloqueia reuso com dados diferentes', async () => {
    const w = solanaAddress();
    const body = { assetSymbol: 'ESCT', fiatAmount: 200, userWalletAddress: w };
    const first = await createOrder(body, { 'Idempotency-Key': 'checkout-abc-001' });
    const replay = await createOrder(body, { 'Idempotency-Key': 'checkout-abc-001' });
    expect(first.status).toBe(201);
    expect(replay.status).toBe(200);
    expect(replay.body.data.id).toBe(first.body.data.id);
    expect(replay.body.meta.idempotentReplay).toBe(true);
    const reused = await createOrder({ ...body, fiatAmount: 300 }, { 'Idempotency-Key': 'checkout-abc-001' });
    expect(reused.status).toBe(409);
    expect(reused.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('GET /api/p2p/orders/:id → 200 / 404 / 400', async () => {
    const created = await createOrder({ assetSymbol: 'BDC', fiatAmount: 50, userWalletAddress: solanaAddress() });
    const res = await api().get(`/api/p2p/orders/${created.body.data.id}?qrcode=false`);
    expect(res.status).toBe(200);
    expect(res.body.data.payment.qrCodeDataUrl).toBeUndefined();
    expect(res.body.data.payment.pixCopyPaste).toBeTruthy();
    expect((await api().get('/api/p2p/orders/00000000-0000-4000-8000-000000000000')).status).toBe(404);
    expect((await api().get('/api/p2p/orders/abc')).body.error.code).toBe('INVALID_ORDER_ID');
  });

  it('fluxo completo: PENDING → PAID → COMPLETED (envio para auto-custódia)', async () => {
    const created = await createOrder({ assetSymbol: 'VRC', fiatAmount: 340, userWalletAddress: solanaAddress() });
    const id = created.body.data.id;

    const paid = await setStatus(id, { status: 'paid', paymentReference: 'E2E-PIX-0001' });
    expect(paid.status).toBe(200);
    expect(paid.body.data).toMatchObject({ status: 'PAID', statusLabel: 'Pago', allowedNextStatuses: ['COMPLETED'] });
    expect(paid.body.data.payment.reference).toBe('E2E-PIX-0001');
    expect(paid.body.data.payment.pixCopyPaste).toBeUndefined(); // não expõe mais a cobrança

    const done = await setStatus(id, { status: 'COMPLETED' });
    expect(done.status).toBe(200);
    expect(done.body.data.status).toBe('COMPLETED');
    expect(done.body.data.statusLabel).toBe('Concluído / Enviado');
    expect(done.body.data.custody.txHash).toMatch(/^[1-9A-HJ-NP-Za-km-z]{80,90}$/); // assinatura Solana
    expect(done.body.data.timeline.map((e: { to: string }) => e.to)).toEqual(['PENDING', 'PAID', 'COMPLETED']);

    // Webhook reenviado: idempotente, não reenvia tokens
    const again = await setStatus(id, { status: 'COMPLETED' });
    expect(again.status).toBe(200);
    expect(again.body.meta.changed).toBe(false);
    expect(again.body.data.custody.txHash).toBe(done.body.data.custody.txHash);
  });

  it('transições inválidas → 409', async () => {
    const created = await createOrder({ assetSymbol: 'BDC', fiatAmount: 100, userWalletAddress: solanaAddress() });
    const id = created.body.data.id;
    const skip = await setStatus(id, { status: 'COMPLETED' });
    expect(skip.status).toBe(409);
    expect(skip.body.error).toMatchObject({ code: 'INVALID_STATUS_TRANSITION', details: { from: 'PENDING', to: 'COMPLETED' } });
    await setStatus(id, { status: 'CANCELLED' });
    expect((await setStatus(id, { status: 'PAID' })).status).toBe(409);
  });

  it('webhook exige segredo → 401', async () => {
    const created = await createOrder({ assetSymbol: 'BDC', fiatAmount: 100, userWalletAddress: solanaAddress() });
    const id = created.body.data.id;
    expect((await api().patch(`/api/p2p/orders/${id}/status`).send({ status: 'PAID' })).status).toBe(401);
    const wrong = await setStatus(id, { status: 'PAID' }, 'segredo-errado-qualquer');
    expect(wrong.status).toBe(401);
    expect(wrong.body.error.code).toBe('UNAUTHORIZED');
  });

  it('status desconhecido ou EXPIRED via webhook → 400', async () => {
    const created = await createOrder({ assetSymbol: 'BDC', fiatAmount: 100, userWalletAddress: solanaAddress() });
    expect((await setStatus(created.body.data.id, { status: 'EXPIRED' })).status).toBe(400);
    expect((await setStatus(created.body.data.id, { status: 'FOO' })).status).toBe(400);
  });

  it('usuário cancela ordem pendente', async () => {
    const created = await createOrder({ assetSymbol: 'ESCT', fiatAmount: 100, userWalletAddress: solanaAddress() });
    const res = await api().post(`/api/p2p/orders/${created.body.data.id}/cancel`);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('CANCELLED');
  });

  it('ordem vencida expira e não aceita pagamento (409 ORDER_EXPIRED)', async () => {
    const created = await createOrder({ assetSymbol: 'BDC', fiatAmount: 100, userWalletAddress: solanaAddress() });
    const id = created.body.data.id;
    await ctx.database.db.execute(
      // força o vencimento
      (await import('drizzle-orm')).sql`update p2p_orders set expires_at = now() - interval '1 minute' where id = ${id}`,
    );
    const get = await api().get(`/api/p2p/orders/${id}`);
    expect(get.body.data.status).toBe('EXPIRED');
    const pay = await setStatus(id, { status: 'PAID' });
    expect(pay.status).toBe(409);
    expect(pay.body.error.code).toBe('ORDER_EXPIRED');
  });

  it('AUTO_SETTLE: pagamento confirmado já envia os tokens', async () => {
    const auto = await buildTestApp({ AUTO_SETTLE: 'true' });
    const created = await request(auto.app).post('/api/p2p/orders').send({ assetSymbol: 'VRC', fiatAmount: 100, userWalletAddress: EVM_CHECKSUMMED });
    const res = await request(auto.app)
      .patch(`/api/p2p/orders/${created.body.data.id}/status`)
      .set('x-webhook-secret', WEBHOOK_SECRET)
      .send({ status: 'PAID' });
    expect(res.body.data.status).toBe('COMPLETED');
    expect(res.body.data.custody.txHash).toMatch(/^0x[0-9a-f]{64}$/);
    await auto.close();
  });

  it('falha no envio on-chain → 502 e ordem permanece PAID', async () => {
    const broken: TokenDispatcher = { name: 'BROKEN', send: async () => { throw new Error('RPC fora do ar'); } };
    const app2 = await buildTestApp({}, { dispatcher: broken });
    const created = await request(app2.app).post('/api/p2p/orders').send({ assetSymbol: 'BDC', fiatAmount: 100, userWalletAddress: solanaAddress() });
    const id = created.body.data.id;
    const hook = (status: string) => request(app2.app).patch(`/api/p2p/orders/${id}/status`).set('x-webhook-secret', WEBHOOK_SECRET).send({ status });
    await hook('PAID');
    const res = await hook('COMPLETED');
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('DISPATCH_FAILED');
    expect((await request(app2.app).get(`/api/p2p/orders/${id}`)).body.data.status).toBe('PAID');
    await app2.close();
  });

  it('webhooks concorrentes não enviam tokens em duplicidade', async () => {
    let sends = 0;
    const counting: TokenDispatcher = { name: 'COUNT', send: async (i) => { sends++; return { txHash: '0x' + 'a'.repeat(64), network: i.network, simulated: true }; } };
    const app3 = await buildTestApp({}, { dispatcher: counting });
    const created = await request(app3.app).post('/api/p2p/orders').send({ assetSymbol: 'BDC', fiatAmount: 100, userWalletAddress: solanaAddress() });
    const id = created.body.data.id;
    const hook = (status: string) => request(app3.app).patch(`/api/p2p/orders/${id}/status`).set('x-webhook-secret', WEBHOOK_SECRET).send({ status });
    await hook('PAID');
    const results = await Promise.all([hook('COMPLETED'), hook('COMPLETED'), hook('COMPLETED')]);
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(sends).toBe(1);
    await app3.close();
  });
});

// ===================================================================== B2B
describe('C. Emissão B2B', () => {
  const valid = () => ({
    tokenName: 'Rodeio Coin',
    symbol: 'rodeio',
    category: 'Festas Sertanejas',
    purpose: 'Ingresso, consumo no bar e votação da atração do próximo ano.',
    creatorWallet: solanaAddress(),
    acceptUtilityTerms: true,
  });
  const create = (body: Record<string, unknown>) => api().post('/api/b2b/tokens/create').send(body);

  it('cria solicitação vinculada às normas de utilidade → 201', async () => {
    const body = { ...valid(), contactEmail: 'Organizador@Rodeio.com', totalSupply: '1.000.000' };
    const res = await create(body);
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      tokenName: 'Rodeio Coin',
      symbol: 'RODEIO',
      category: 'FESTAS_SERTANEJAS',
      categoryLabel: 'Eventos e festas sertanejas',
      creatorWallet: body.creatorWallet,
      creatorWalletNetwork: 'solana',
      contactEmail: 'organizador@rodeio.com',
      totalSupply: '1000000',
      status: 'PENDING_REVIEW',
    });
    expect(res.body.data.protocol).toMatch(/^UTK-[A-Z0-9]{10}$/);
    expect(res.body.data.compliance).toMatchObject({
      utilityClass: 'UTILITY_COMMUNITY_EDUCATIONAL',
      rules: { isUtilityToken: true, isSecurity: false, profitGuarantee: false },
      disclaimer: LEGAL_DISCLAIMER,
    });
    expect(res.headers.location).toContain(res.body.data.id);

    // consulta por id e por protocolo
    expect((await api().get(`/api/b2b/tokens/requests/${res.body.data.id}`)).body.data.symbol).toBe('RODEIO');
    expect((await api().get(`/api/b2b/tokens/requests/${res.body.data.protocol.toLowerCase()}`)).status).toBe(200);
  });

  it('aceita as 5 categorias (código ou rótulo)', async () => {
    const cats = ['Empresas', 'FUTEBOL', 'Feiras Culturais', 'Ajuda Humanitária', 'festas_sertanejas'];
    for (const [i, category] of cats.entries()) {
      const res = await create({ ...valid(), category, symbol: `CAT${i}X` });
      expect(res.status, category).toBe(201);
    }
    const list = await api().get('/api/b2b/tokens/categories');
    expect(list.body.data).toHaveLength(5);
  });

  it('símbolo duplicado, reservado ou nome de ativo nativo → 409', async () => {
    await create({ ...valid(), symbol: 'FEIRA' });
    expect((await create({ ...valid(), symbol: 'feira' })).body.error.code).toBe('SYMBOL_UNAVAILABLE');
    expect((await create({ ...valid(), symbol: 'BODE' })).status).toBe(409);
    expect((await create({ ...valid(), symbol: 'USDT' })).status).toBe(409);
    expect((await create({ ...valid(), symbol: 'BODEX', tokenName: 'bode coin' })).body.error.code).toBe('TOKEN_NAME_UNAVAILABLE');
  });

  it('promessa de lucro → 400 COMPLIANCE_VIOLATION', async () => {
    const res = await create({ ...valid(), symbol: 'LUCRO', purpose: 'Token com lucro garantido e rendimento de 3% ao mês para os investidores.' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('COMPLIANCE_VIOLATION');
    expect(res.body.error.details.length).toBeGreaterThanOrEqual(2);
  });

  it('sem aceite das normas → 400', async () => {
    const res = await create({ ...valid(), symbol: 'NOTERM', acceptUtilityTerms: false });
    expect(res.status).toBe(400);
    expect(res.body.error.details[0].field).toBe('acceptUtilityTerms');
  });

  it('valida campos e carteira do criador', async () => {
    const res = await create({ tokenName: 'X', symbol: '1A', category: 'Cassino', purpose: 'curto', creatorWallet: 'abc', acceptUtilityTerms: true });
    expect(res.status).toBe(400);
    const fields = res.body.error.details.map((d: { field: string }) => d.field);
    expect(fields).toEqual(expect.arrayContaining(['tokenName', 'symbol', 'category', 'purpose']));
    const badWallet = await create({ ...valid(), symbol: 'WALLET', creatorWallet: offCurveSolanaAddress() });
    expect(badWallet.body.error.code).toBe('WALLET_NOT_SELF_CUSTODY');
  });

  it('consulta inexistente → 404; formato inválido → 400', async () => {
    expect((await api().get('/api/b2b/tokens/requests/UTK-ZZZZZZZZZZ')).status).toBe(404);
    expect((await api().get('/api/b2b/tokens/requests/qualquer')).status).toBe(400);
  });
});
