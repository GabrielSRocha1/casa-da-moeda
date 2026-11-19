import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp } from './helpers.js';

type Ctx = Awaited<ReturnType<typeof buildTestApp>>;
let ctx: Ctx;

beforeAll(async () => {
  ctx = await buildTestApp();
});
afterAll(async () => {
  await ctx.close();
});

const api = () => request(ctx.app);

/** Linha válida no mesmo formato que o site envia (buildRow do index.html). */
function validRow(overrides: Record<string, unknown> = {}) {
  return {
    id: randomUUID(),
    company_name: 'Associação Cultural Vale do Sol',
    company_address: 'Rua das Flores, 123, Centro, São Paulo - SP, 01000-000, Brasil',
    business_sector: 'Feiras Culturais',
    business_sector_other: null,
    company_description: 'Associação cultural que organiza feiras de artesanato e eventos comunitários há 12 anos na região.',
    director_name: 'Maria da Silva',
    whatsapp: '+5511912345678',
    alt_phone: null,
    email: 'diretoria@valedosol.org',
    needs_creation_approver: false,
    approver_name: null,
    preferred_days: ['SEG', 'QUA', 'SEX'],
    preferred_periods: ['MANHA', 'TARDE'],
    preferred_time_from: null,
    preferred_time_to: null,
    timezone: 'America/Sao_Paulo',
    consent_lgpd: true,
    source: 'site',
    ...overrides,
  };
}

describe('POST /api/b2b/partnerships', () => {
  it('cria a solicitação e devolve protocolo PAR- derivado do id', async () => {
    const row = validRow();
    const res = await api().post('/api/b2b/partnerships').send(row);
    expect(res.status).toBe(201);
    expect(res.body.data.id).toBe(row.id);
    expect(res.body.data.protocol).toBe('PAR-' + String(row.id).replace(/-/g, '').slice(0, 10).toUpperCase());
    expect(res.body.data).toMatchObject({ companyName: row.company_name, businessSector: row.business_sector, status: 'NEW' });
  });

  it('reenvio com o mesmo id é idempotente (não duplica)', async () => {
    const row = validRow();
    const first = await api().post('/api/b2b/partnerships').send(row);
    const second = await api().post('/api/b2b/partnerships').send(row);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.data.id).toBe(first.body.data.id);
    expect(second.body.data.protocol).toBe(first.body.data.protocol);
  });

  it('setor fora da lista → 400', async () => {
    const res = await api().post('/api/b2b/partnerships').send(validRow({ business_sector: 'Mineração' }));
    expect(res.status).toBe(400);
  });

  it('setor "Outros" exige business_sector_other (e vice-versa)', async () => {
    const semOutro = await api().post('/api/b2b/partnerships').send(validRow({ business_sector: 'Outros' }));
    expect(semOutro.status).toBe(400);
    const comOutroIndevido = await api().post('/api/b2b/partnerships').send(validRow({ business_sector_other: 'Cooperativa' }));
    expect(comOutroIndevido.status).toBe(400);
    const correto = await api().post('/api/b2b/partnerships').send(validRow({ business_sector: 'Outros', business_sector_other: 'Cooperativa agrícola' }));
    expect(correto.status).toBe(201);
  });

  it('needs_creation_approver=true exige approver_name', async () => {
    const res = await api().post('/api/b2b/partnerships').send(validRow({ needs_creation_approver: true }));
    expect(res.status).toBe(400);
    const ok = await api()
      .post('/api/b2b/partnerships')
      .send(validRow({ needs_creation_approver: true, approver_name: 'Ana Lima, Presidente do Conselho' }));
    expect(ok.status).toBe(201);
  });

  it('whatsapp fora do E.164 → 400', async () => {
    const res = await api().post('/api/b2b/partnerships').send(validRow({ whatsapp: '(11) 91234-5678' }));
    expect(res.status).toBe(400);
  });

  it('sem consentimento LGPD → 400', async () => {
    const res = await api().post('/api/b2b/partnerships').send(validRow({ consent_lgpd: false }));
    expect(res.status).toBe(400);
  });

  it('faixa de horário incompleta ou invertida → 400', async () => {
    const soInicio = await api().post('/api/b2b/partnerships').send(validRow({ preferred_time_from: '09:00' }));
    expect(soInicio.status).toBe(400);
    const invertida = await api().post('/api/b2b/partnerships').send(validRow({ preferred_time_from: '18:00', preferred_time_to: '09:00' }));
    expect(invertida.status).toBe(400);
    const valida = await api().post('/api/b2b/partnerships').send(validRow({ preferred_time_from: '09:00', preferred_time_to: '12:00' }));
    expect(valida.status).toBe(201);
  });
});
