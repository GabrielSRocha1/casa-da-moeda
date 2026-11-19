// Testa migrations/002_business_applications.sql num Postgres embutido simulando o Supabase,
// inserindo os payloads REAIS capturados do formulário no navegador
// (fixtures/payloads-formulario.json — regenerado por frontend/tests/test_parceria.py).
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const MAIN = readFileSync(new URL('../migrations/001_casa_da_moeda_master_digital.sql', import.meta.url), 'utf8');
const MIGRATION = readFileSync(new URL('../migrations/002_business_applications.sql', import.meta.url), 'utf8');
const PAYLOADS = JSON.parse(readFileSync(new URL('./fixtures/payloads-formulario.json', import.meta.url), 'utf8'));

const results = [];
const check = (name, cond, extra = '') => {
  results.push([name, !!cond]);
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${!cond && extra ? '  → ' + extra : ''}`);
};

async function supabaseLike() {
  const db = new PGlite();
  await db.waitReady;
  await db.exec(`
    CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
    GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES    TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
    CREATE PUBLICATION supabase_realtime;`);
  return db;
}

const CLAIMS = {
  anon: { role: 'anon' },
  user: { role: 'authenticated', app_metadata: {} },
  admin: { role: 'authenticated', app_metadata: { role: 'admin' } },
  service: { role: 'service_role' },
};
const PG_ROLE = { anon: 'anon', user: 'authenticated', admin: 'authenticated', service: 'service_role' };

function as(db, who, sql, params = []) {
  return db.transaction(async (tx) => {
    await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(CLAIMS[who])]);
    await tx.query(`set local role ${PG_ROLE[who]}`);
    return tx.query(sql, params);
  });
}
const err = (db, who, sql, params) => as(db, who, sql, params).then(() => null).catch((e) => e.message);

/** INSERT igual ao PostgREST: só as colunas enviadas no JSON, valores como texto/array. */
function postgrestInsert(db, who, row) {
  const cols = Object.keys(row);
  const vals = cols.map((c) => row[c]);
  const sql = `insert into business_applications (${cols.map((c) => `"${c}"`).join(',')}) values (${cols.map((_, i) => `$${i + 1}`).join(',')})`;
  return as(db, who, sql, vals);
}
const insertErr = (db, who, row) => postgrestInsert(db, who, row).then(() => null).catch((e) => e.message);

// ===================================================================== Standalone
{
  const db = await supabaseLike();
  try { await db.exec(MIGRATION); check('migração roda sozinha (banco vazio)', true); }
  catch (e) { check('migração roda sozinha (banco vazio)', false, e.message); }
  await db.close();
}

// ===================================================================== Após o script principal
const db = await supabaseLike();
await db.exec(MAIN);
try { await db.exec(MIGRATION); await db.exec(MIGRATION); check('migração roda após o script principal e é idempotente', true); }
catch (e) { check('migração roda após o script principal e é idempotente', false, e.message); }

const rls = await db.query(`select relrowsecurity from pg_class where relname='business_applications'`);
check('RLS habilitado', rls.rows[0]?.relrowsecurity === true);
const pub = await db.query(`select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='business_applications'`);
check('Realtime habilitado', pub.rows.length === 1);

// --- Payloads reais do formulário
check(`payloads capturados do navegador: ${PAYLOADS.length}`, PAYLOADS.length >= 2);
let okCount = 0;
for (const row of PAYLOADS) {
  const e = await insertErr(db, 'anon', row);
  if (!e) okCount++; else console.log('   erro:', e);
}
check('anon insere todos os payloads do formulário', okCount === PAYLOADS.length);

const first = PAYLOADS[0];
const saved = (await db.query(`select * from business_applications where id=$1`, [first.id])).rows[0];
check('protocolo do banco = protocolo exibido no site', saved.protocol === 'PAR-' + first.id.replace(/-/g, '').slice(0, 10).toUpperCase(), saved.protocol);
check('status NEW e consentimento registrado', saved.status === 'NEW' && saved.consent_lgpd === true && saved.consent_at);
check('arrays e horários gravados', JSON.stringify(saved.preferred_days) === '["SEG","TER","QUA","QUI","SEX"]' && saved.preferred_time_from === '14:00:00');
const other = (await db.query(`select * from business_applications where business_sector='Outros' limit 1`)).rows[0];
check('"Outros" com descrição e telefone PY', other?.business_sector_other === 'Cooperativa agrícola' && other?.alt_phone === '+595981123456');

// --- Reenvio com o mesmo id (o site trata 23505 na pkey como sucesso)
const dup = await insertErr(db, 'anon', PAYLOADS[1]);
check('reenvio com mesmo id → erro de pkey (site considera sucesso)', /business_applications_pkey/.test(dup || ''), dup);

// --- Isolamento
check('anon NÃO lê solicitações', (await err(db, 'anon', `select * from business_applications`)) !== null);
check('usuário comum lê 0 solicitações', (await as(db, 'user', `select * from business_applications`)).rows.length === 0);
check('admin lê solicitações', (await as(db, 'admin', `select * from business_applications`)).rows.length === PAYLOADS.length);
check('anon NÃO atualiza', (await err(db, 'anon', `update business_applications set status='APPROVED'`)) !== null);
check('usuário comum NÃO atualiza (0 linhas)', (await as(db, 'user', `update business_applications set status='APPROVED'`)).affectedRows === 0);
check('anon NÃO apaga', (await err(db, 'anon', `delete from business_applications`)) !== null);
check('admin NÃO apaga', (await err(db, 'admin', `delete from business_applications`)) !== null);

// --- Admin acompanha a solicitação
const upd = await as(db, 'admin', `update business_applications set status='CONTACTED', internal_notes='Reunião na terça' where id=$1 returning status, contacted_at`, [first.id]);
check('admin muda status e contacted_at é preenchido', upd.rows[0]?.status === 'CONTACTED' && upd.rows[0]?.contacted_at);
check('admin NÃO altera dados do empresário (sem permissão de coluna)', (await err(db, 'admin', `update business_applications set email='x@y.com' where id=$1`, [first.id])) !== null);
check('nem o backend altera dados do empresário', /IMMUTABLE_FIELD/.test(await err(db, 'service', `update business_applications set company_name='Outra' where id=$1`, [first.id])));
const dash = await as(db, 'admin', `select * from dashboard_business_applications`);
check('view do dashboard (admin)', dash.rows.length >= 2);
check('view do dashboard bloqueada para anon', (await err(db, 'anon', `select * from dashboard_business_applications`)) !== null);

// --- Campos forjados pelo visitante são ignorados
const forged = { ...PAYLOADS[0], id: '11111111-2222-4333-8444-555555555555', email: 'outro@instituicao.org', whatsapp: '+5511988887777',
  status: 'APPROVED', internal_notes: 'aprovado!', protocol: 'PAR-HACK' };
check('INSERT com status/notas/protocolo forjados é aceito…', (await insertErr(db, 'anon', forged)) === null);
const f = (await db.query(`select status, internal_notes, protocol from business_applications where id=$1`, [forged.id])).rows[0];
check('…mas o banco força NEW, limpa notas e gera o protocolo', f.status === 'NEW' && f.internal_notes === null && f.protocol === 'PAR-1111111122');

// --- Validações do banco (defesa mesmo sem o front)
const base = { ...PAYLOADS[0], email: 'valida@teste.com', whatsapp: '+5521977776666' };
const bad = async (patch, re, label) => {
  const row = { ...base, ...patch };
  delete row.id;
  const e = await insertErr(db, 'anon', row);
  check(label, e && re.test(e), e);
};
await bad({ business_sector: 'Cassino' }, /business_sector|check/i, 'rejeita ramo fora da lista');
await bad({ whatsapp: '11912345678' }, /whatsapp|check/i, 'rejeita WhatsApp fora do E.164');
await bad({ email: 'invalido' }, /email|check/i, 'rejeita e-mail inválido');
await bad({ company_description: 'curta' }, /company_description|check/i, 'rejeita descrição curta');
await bad({ preferred_days: [] }, /preferred_days|check/i, 'exige ao menos um dia');
await bad({ preferred_periods: ['MADRUGADA'] }, /preferred_periods|check/i, 'rejeita período inválido');
await bad({ preferred_time_from: '18:00', preferred_time_to: '14:00' }, /time_window|check/i, 'rejeita janela de horário invertida');
await bad({ business_sector: 'Outros', business_sector_other: null }, /other_sector|check/i, '"Outros" exige descrição');
await bad({ consent_lgpd: false }, /consent|INVALID_CONSENT/i, 'exige consentimento LGPD');
await bad({ timezone: 'Marte/Olympus' }, /INVALID_TIMEZONE/, 'rejeita fuso inválido');

// --- Antispam: 3 por e-mail/WhatsApp em 24h
const spam = { ...base, email: 'spam@teste.com', whatsapp: '+5531966665555' };
const res = [];
for (let i = 0; i < 4; i++) { const r = { ...spam }; delete r.id; res.push(await insertErr(db, 'anon', r)); }
check('antispam: 4ª solicitação do mesmo contato em 24h é bloqueada', res.slice(0, 3).every((x) => x === null) && /TOO_MANY_APPLICATIONS/.test(res[3] || ''), JSON.stringify(res));

// --- Normalização
const n = { ...base, email: '  CAIXA@Empresa.COM ', whatsapp: '+5541955554444', company_name: '  Empresa   Exemplo  ', preferred_days: ['SEX', 'SEG', 'SEG'] };
delete n.id;
await postgrestInsert(db, 'anon', n);
const nr = (await db.query(`select email, company_name, preferred_days from business_applications where whatsapp='+5541955554444'`)).rows[0];
check('normaliza e-mail, espaços e ordem dos dias', nr.email === 'caixa@empresa.com' && nr.company_name === 'Empresa Exemplo' && JSON.stringify(nr.preferred_days) === '["SEG","SEX"]', JSON.stringify(nr));

await db.close();
const failed = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - failed.length}/${results.length} testes passaram`);
process.exit(failed.length ? 1 : 0);
