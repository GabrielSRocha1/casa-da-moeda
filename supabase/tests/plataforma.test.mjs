// Teste do script SQL num PostgreSQL embutido (PGlite) simulando o ambiente do Supabase:
// papéis anon/authenticated/service_role, privilégios padrão, JWT via request.jwt.claims e publicação do Realtime.
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const SQL = readFileSync(new URL('../migrations/001_casa_da_moeda_master_digital.sql', import.meta.url), 'utf8');
const db = new PGlite();
await db.waitReady;

// ---------------------------------------------------------------- Ambiente "Supabase"
await db.exec(`
  CREATE ROLE anon NOLOGIN;
  CREATE ROLE authenticated NOLOGIN;
  CREATE ROLE service_role NOLOGIN BYPASSRLS;
  GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES    TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
  CREATE PUBLICATION supabase_realtime;
`);

const results = [];
const check = (name, cond, extra = '') => {
  results.push([name, !!cond]);
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${!cond && extra ? '  → ' + extra : ''}`);
};

const CLAIMS = {
  anon: { role: 'anon' },
  user: { role: 'authenticated', sub: 'u1', app_metadata: {} },
  admin: { role: 'authenticated', sub: 'a1', app_metadata: { role: 'admin' } },
  service: { role: 'service_role' },
};
const PG_ROLE = { anon: 'anon', user: 'authenticated', admin: 'authenticated', service: 'service_role', monitor: 'payment_monitor' };

/** Executa SQL como um papel do Supabase (igual ao PostgREST: SET ROLE + claims do JWT). */
async function as(who, sql, params = []) {
  return db.transaction(async (tx) => {
    await tx.query(`select set_config('request.jwt.claims', $1, true)`, [who === 'monitor' ? '' : JSON.stringify(CLAIMS[who])]);
    await tx.query(`set local role ${PG_ROLE[who]}`);
    return tx.query(sql, params);
  });
}
async function err(who, sql, params = []) {
  try {
    await as(who, sql, params);
    return null;
  } catch (e) {
    return e.message;
  }
}
const one = async (who, sql, params) => (await as(who, sql, params)).rows[0];

// Endereços de teste
const SOL = '65TXQe7RKv4P86qK7Lznap7vbX1KYprbe2Yte3XyCbPB';
const SOL2 = '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin';
const EVM = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed';

// ---------------------------------------------------------------- 1. Instalação
try {
  await db.exec(SQL);
  check('script executa sem erros', true);
} catch (e) {
  check('script executa sem erros', false, e.message);
  process.exit(1);
}
try {
  await db.exec(SQL);
  check('script é idempotente (2ª execução)', true);
} catch (e) {
  check('script é idempotente (2ª execução)', false, e.message);
}

const rls = await db.query(`select relname, relrowsecurity from pg_class where relnamespace='public'::regnamespace and relkind='r' order by 1`);
check('RLS habilitado nas 5 tabelas', rls.rows.length === 5 && rls.rows.every((r) => r.relrowsecurity), JSON.stringify(rls.rows));

const idx = await db.query(`select indexname from pg_indexes where tablename='p2p_orders' and indexdef ilike '%(payment_gateway_id)%'`);
check('índice em payment_gateway_id', idx.rows.length === 1, JSON.stringify(idx.rows));

const pub = await db.query(`select tablename from pg_publication_tables where pubname='supabase_realtime' order by 1`);
check('Realtime publica tokens, p2p_orders, token_requests', pub.rows.map((r) => r.tablename).join() === 'p2p_orders,token_requests,tokens');

// ---------------------------------------------------------------- 2. Tokens (leitura pública)
const toks = await as('anon', `select symbol, price::text, change_24h::text from tokens order by sort_order`);
check('anon lê os 3 tokens nativos', toks.rows.map((r) => r.symbol).join() === 'BODE,VRM,ESC');
check('preços e variações do seed', toks.rows[0].price === '0.85000000' && toks.rows[2].change_24h === '-2.10');
check('anon NÃO altera tokens', (await err('anon', `update tokens set price = 999`)) !== null);
check('anon NÃO insere tokens', (await err('anon', `insert into tokens(name,symbol,type,price) values ('X','XX','NATIVE',1)`)) !== null);
check('anon lê platform_settings (taxa)', (await one('anon', `select p2p_fee_bps from platform_settings`)).p2p_fee_bps === 150);

// ---------------------------------------------------------------- 3. Criação de ordens
const created = (await one('anon', `select create_p2p_order('bode', 500, $1) as o`, [SOL])).o;
check('create_p2p_order calcula taxa e tokens', created.fee_amount === 7.5 && created.token_amount === 579.4117647 && created.status === 'PENDING', JSON.stringify(created));
check('carteira mascarada na resposta', created.wallet === '65TXQe…CbPB');
check('sem cobrança vinculada ainda', created.payment_ready === false && created.payment_payload === null);

// INSERT direto tentando fraudar quantidade/status/gateway
await as('anon', `insert into p2p_orders (asset_symbol, fiat_amount, token_amount, user_wallet_address, status, payment_gateway_id, expires_at)
                  values ('VRM', 100, 999999999, $1, 'PAID', 'fake_gateway', now() + interval '10 years')`, [EVM]);
const forged = await db.query(`select token_amount::text, status, payment_gateway_id, expires_at < now() + interval '16 minutes' as ttl_ok from p2p_orders where user_wallet_address=$1`, [EVM]);
check('INSERT direto: banco recalcula token_amount', forged.rows[0].token_amount === '28.97058823', forged.rows[0].token_amount);
check('INSERT direto: força PENDING, ignora gateway_id e validade', forged.rows[0].status === 'PENDING' && forged.rows[0].payment_gateway_id === null && forged.rows[0].ttl_ok);

check('rejeita carteira inválida', /WALLET_INVALID|violates/.test(await err('anon', `select create_p2p_order('BODE', 100, '0x123')`)));
check('rejeita System Program', (await err('anon', `select create_p2p_order('BODE', 100, '11111111111111111111111111111111')`)) !== null);
check('rejeita valor abaixo do mínimo', /FIAT_AMOUNT_OUT_OF_RANGE/.test(await err('anon', `select create_p2p_order('BODE', 19.99, $1)`, [SOL])));
check('rejeita valor acima do máximo', /FIAT_AMOUNT_OUT_OF_RANGE/.test(await err('anon', `select create_p2p_order('BODE', 50000.01, $1)`, [SOL])));
check('rejeita 3 casas decimais', /INVALID_INPUT/.test(await err('anon', `select create_p2p_order('BODE', 10.555, $1)`, [SOL])));
check('rejeita token inexistente', /TOKEN_NOT_FOUND/.test(await err('anon', `select create_p2p_order('FAKE', 100, $1)`, [SOL])));

// ---------------------------------------------------------------- 4. Isolamento (RLS)
check('anon NÃO lê p2p_orders', (await err('anon', `select * from p2p_orders`)) !== null);
check('usuário comum lê 0 ordens', (await as('user', `select * from p2p_orders`)).rows.length === 0);
check('admin lê todas as ordens', (await as('admin', `select * from p2p_orders`)).rows.length === 2);
check('anon NÃO atualiza ordens', (await err('anon', `update p2p_orders set status='PAID'`)) !== null);
check('usuário comum NÃO atualiza ordens (0 linhas)', (await as('user', `update p2p_orders set failure_reason='x'`).catch(() => ({ affectedRows: 0 }))).affectedRows === 0);
check('admin NÃO atualiza ordens (restritiva)', (await err('admin', `update p2p_orders set failure_reason='x'`)) !== null || (await as('admin', `update p2p_orders set failure_reason='x'`)).affectedRows === 0);
check('anon NÃO apaga ordens', (await err('anon', `delete from p2p_orders`)) !== null);
check('anon NÃO executa o webhook', /permission denied/.test(await err('anon', `select update_order_status_from_gateway('x','PAID')`)));
check('admin NÃO executa o webhook', /permission denied/.test(await err('admin', `select update_order_status_from_gateway('x','PAID')`)));
check('anon NÃO lê trilha de auditoria', (await err('anon', `select * from p2p_order_events`)) !== null);

// ---------------------------------------------------------------- 5. Webhook do gateway
const oid = created.id;
await as('service', `select set_order_payment_charge($1, 'pix_tx_001', '000201SIMULADO6304ABCD')`, [oid]);
const withCharge = (await one('anon', `select get_p2p_order($1) as o`, [oid])).o;
check('cobrança vinculada aparece para o comprador', withCharge.payment_ready && withCharge.payment_payload === '000201SIMULADO6304ABCD');
check('payment_gateway_id não pode ser trocado', /GATEWAY_ID_LOCKED/.test(await err('service', `select set_order_payment_charge($1, 'outro_id')`, [oid])));

const plan = await db.transaction(async (tx) => {
  await tx.query('set local enable_seqscan = off');
  return tx.query(`explain select * from p2p_orders where payment_gateway_id = 'pix_tx_001'`);
});
check('webhook usa o índice de payment_gateway_id', JSON.stringify(plan.rows).includes('p2p_orders_payment_gateway_id_idx'));

const r1 = (await one('service', `select update_order_status_from_gateway('pix_tx_001','paid','evt_1','{"amount":500}'::jsonb) as r`)).r;
check('webhook PAID → updated', r1.result === 'updated' && r1.status === 'PAID' && r1.previous_status === 'PENDING', JSON.stringify(r1));
const r2 = (await one('service', `select update_order_status_from_gateway('pix_tx_001','PAID','evt_1') as r`)).r;
check('mesmo evento reenviado → duplicate_event', r2.result === 'duplicate_event');
const r3 = (await one('service', `select update_order_status_from_gateway('pix_tx_001','PAID','evt_2') as r`)).r;
check('mesmo status → unchanged', r3.result === 'unchanged');
check('COMPLETED sem hash → erro', /CUSTODY_TX_REQUIRED/.test(await err('service', `select update_order_status_from_gateway('pix_tx_001','COMPLETED','evt_3')`)));
const r4 = (await one('service', `select update_order_status_from_gateway('pix_tx_001','COMPLETED','evt_3','{}'::jsonb,'5VERYsolanaSignature') as r`)).r;
check('webhook COMPLETED → updated', r4.result === 'updated' && r4.status === 'COMPLETED');
check('ordem concluída não volta para PAID', /INVALID_STATUS_TRANSITION/.test(await err('service', `select update_order_status_from_gateway('pix_tx_001','FAILED','evt_4')`)));
check('status inválido → erro', /INVALID_INPUT/.test(await err('service', `select update_order_status_from_gateway('pix_tx_001','EXPIRED')`)));
check('gateway_id desconhecido → ORDER_NOT_FOUND', /ORDER_NOT_FOUND/.test(await err('service', `select update_order_status_from_gateway('nao_existe','PAID')`)));
const final = (await one('anon', `select get_p2p_order($1) as o`, [oid])).o;
check('comprador vê COMPLETED + tx hash, sem Pix', final.status === 'COMPLETED' && final.custody_tx_hash === '5VERYsolanaSignature' && final.payment_payload === null);

const ev = await db.query(`select from_status, to_status, source, gateway_event_id from p2p_order_events where order_id=$1 order by id`, [oid]);
check('auditoria: PENDING → PAID → COMPLETED', ev.rows.map((e) => e.to_status).join() === 'PENDING,PAID,COMPLETED' && ev.rows[1].gateway_event_id === 'evt_1');
check('auditoria é append-only (nem postgres apaga)', await db.query(`delete from p2p_order_events`).then(() => false).catch((e) => /APPEND_ONLY/.test(e.message)));

// Proteções que valem até para o backend (service_role ignora RLS, mas não os triggers)
check('service_role NÃO muda status por UPDATE direto', /STATUS_CHANGE_NOT_ALLOWED/.test(await err('service', `update p2p_orders set status='FAILED' where id=$1`, [oid])));
check('service_role NÃO altera valor/carteira', /IMMUTABLE_FIELD/.test(await err('service', `update p2p_orders set fiat_amount=1 where id=$1`, [oid])));
check('service_role NÃO pula etapas (PENDING → COMPLETED)', await (async () => {
  const o = (await one('anon', `select create_p2p_order('ESC', 50, $1) as o`, [SOL2])).o;
  await as('service', `select set_order_payment_charge($1,'pix_skip')`, [o.id]);
  return /INVALID_STATUS_TRANSITION/.test(await err('service', `select update_order_status_from_gateway('pix_skip','COMPLETED',null,'{}'::jsonb,'hash')`));
})());

// ---------------------------------------------------------------- 6. Expiração, pagamento tardio, cancelamento
const exp = (await one('anon', `select create_p2p_order('BODE', 100, $1) as o`, [SOL2])).o;
await as('service', `select set_order_payment_charge($1,'pix_late')`, [exp.id]);
await db.query(`update p2p_orders set expires_at = now() - interval '1 minute' where id=$1`, [exp.id]);
check('get_p2p_order mostra EXPIRED antes do cron', (await one('anon', `select get_p2p_order($1) as o`, [exp.id])).o.status === 'EXPIRED');
check('monitor sinaliza VENCIDA_NAO_EXPIRADA', (await one('monitor', `select alert from payment_monitor_queue where id=$1`, [exp.id])).alert === 'VENCIDA_NAO_EXPIRADA');
const nExp = (await one('service', `select expire_overdue_orders() as n`)).n;
check('expire_overdue_orders expira vencidas', nExp >= 1);
const late = (await one('service', `select update_order_status_from_gateway('pix_late','PAID','evt_late') as r`)).r;
check('pagamento após vencimento é aceito e sinalizado', late.result === 'updated' && late.late_payment === true);
check('anon NÃO executa expire_overdue_orders', /permission denied/.test(await err('anon', `select expire_overdue_orders()`)));

const c = (await one('anon', `select create_p2p_order('VRM', 30, $1) as o`, [SOL2])).o;
check('comprador cancela ordem pendente', (await one('anon', `select cancel_p2p_order($1) as o`, [c.id])).o.status === 'CANCELLED');
check('cancelar de novo é idempotente', (await one('anon', `select cancel_p2p_order($1) as o`, [c.id])).o.status === 'CANCELLED');
check('não cancela ordem paga', /ORDER_NOT_CANCELLABLE/.test(await err('anon', `select cancel_p2p_order($1)`, [exp.id])));

// Antispam
const spamWallet = 'GK2zqSsXLA2rwVZk347RYhh6jJpRsCA69FjLW93ZGi3B';
let blocked = null;
for (let i = 0; i < 6; i++) {
  const e = await err('anon', `select create_p2p_order('BODE', 25, $1)`, [spamWallet]);
  if (e) { blocked = { i, e }; break; }
}
check('antispam: 6ª ordem pendente da mesma carteira é bloqueada', blocked?.i === 5 && /TOO_MANY_PENDING_ORDERS/.test(blocked.e), JSON.stringify(blocked));

// ---------------------------------------------------------------- 7. Pedidos B2B
const ins = (vals) => as('anon', `insert into token_requests (token_name, symbol, category, purpose, creator_wallet) values ($1,$2,$3,$4,$5)`, vals);
await ins(['Rodeio Coin', 'rodeio', 'FESTAS_SERTANEJAS', 'Ingresso, consumo no bar e votação da atração do próximo ano.', SOL]);
const req = (await db.query(`select * from token_requests where symbol='RODEIO'`)).rows[0];
check('anon envia pedido B2B (símbolo e categoria normalizados)', req && req.category === 'Festas Sertanejas' && req.status === 'PENDING');
check('pedido vinculado às normas de utilidade', req.utility_terms.isSecurity === false && req.utility_terms.profitGuarantee === false && !!req.utility_terms.acceptedAt);
check('anon NÃO lê pedidos', (await err('anon', `select * from token_requests`)) !== null);
check('usuário comum lê 0 pedidos', (await as('user', `select * from token_requests`)).rows.length === 0);
check('admin lê pedidos', (await as('admin', `select * from token_requests`)).rows.length === 1);

const b2bErr = (vals) => ins(vals).then(() => null).catch((e) => e.message);
check('bloqueia promessa de lucro', /COMPLIANCE_VIOLATION/.test(await b2bErr(['Lucro Coin', 'LUCRO', 'Empresas', 'Rendimento garantido de 5% ao mês para todos os holders.', SOL])));
check('bloqueia símbolo reservado (USDT)', /SYMBOL_UNAVAILABLE/.test(await b2bErr(['Dolar Local', 'USDT', 'Empresas', 'Moeda interna de fidelidade da loja da esquina.', SOL])));
check('bloqueia símbolo de token existente (BODE)', /SYMBOL_UNAVAILABLE/.test(await b2bErr(['Outro Bode', 'BODE', 'Empresas', 'Moeda interna de fidelidade da loja da esquina.', SOL])));
check('bloqueia símbolo já pedido', /duplicate|unique/i.test(await b2bErr(['Rodeio Dois', 'RODEIO', 'Futebol', 'Programa de sócio-torcedor e votação de enquetes.', SOL2])));
check('bloqueia categoria inválida', /INVALID_CATEGORY/.test(await b2bErr(['Cassino Coin', 'CASINO', 'Cassino', 'Fichas internas para jogos do salão comunitário.', SOL])));
check('anon NÃO define status APPROVED', await (async () => {
  await as('anon', `insert into token_requests (token_name, symbol, category, purpose, creator_wallet, status) values ('Feira Norte','FNORTE','Feiras Culturais','Moeda da feira para expositores e visitantes.', $1, 'APPROVED')`, [SOL2]);
  return (await db.query(`select status from token_requests where symbol='FNORTE'`)).rows[0].status === 'PENDING';
})());

check('usuário comum NÃO aprova', /FORBIDDEN/.test(await err('user', `select approve_token_request($1, 0.10)`, [req.id])));
check('anon NÃO aprova', /permission denied/.test(await err('anon', `select approve_token_request($1, 0.10)`, [req.id])));
const approved = await one('admin', `select * from approve_token_request($1, 0.10)`, [req.id]);
check('admin aprova → token CUSTOM criado', approved.type === 'CUSTOM' && approved.symbol === 'RODEIO' && approved.category === 'Festas Sertanejas');
check('token aprovado aparece no carrossel (anon)', (await as('anon', `select symbol from tokens where type='CUSTOM'`)).rows[0]?.symbol === 'RODEIO');
check('pedido aprovado não é reaprovado', /REQUEST_NOT_PENDING/.test(await err('admin', `select approve_token_request($1, 0.10)`, [req.id])));
check('status do pedido não muda por UPDATE direto', /STATUS_CHANGE_NOT_ALLOWED/.test(await err('service', `update token_requests set status='REJECTED' where symbol='FNORTE'`)));
const rej = await one('service', `select r.status from token_requests t, lateral reject_token_request(t.id, 'Propósito pouco claro') r where t.symbol='FNORTE'`);
check('backend rejeita pedido com motivo', rej.status === 'REJECTED');
check('símbolo rejeitado volta a ficar livre', (await b2bErr(['Feira Norte', 'FNORTE', 'Feiras Culturais', 'Moeda da feira para expositores e visitantes da região.', SOL2])) === null);
check('compra de token CUSTOM aprovado funciona', (await one('anon', `select create_p2p_order('RODEIO', 100, $1) as o`, [SOL])).o.token_amount === 985);

// ---------------------------------------------------------------- 8. Dashboard e monitor
check('anon NÃO lê views do dashboard', (await err('anon', `select * from dashboard_order_summary`)) !== null);
check('usuário comum vê dashboard vazio', (await as('user', `select * from dashboard_order_summary`)).rows.length === 0);
const sum = await as('admin', `select status, orders::int, fiat_total_brl::text from dashboard_order_summary order by status`);
check('admin vê resumo por status', sum.rows.some((r) => r.status === 'COMPLETED' && r.fiat_total_brl === '500.00'), JSON.stringify(sum.rows));
check('volume diário (PAID/COMPLETED)', (await as('admin', `select * from dashboard_daily_volume`)).rows.length >= 1);
check('monitor lê ordens e eventos', (await as('monitor', `select count(*)::int n from p2p_orders`)).rows[0].n > 0 && (await as('monitor', `select count(*)::int n from p2p_order_events`)).rows[0].n > 0);
check('monitor lê fila de pagamentos', (await as('monitor', `select * from payment_monitor_queue`)).rows.length > 0);
check('monitor NÃO altera ordens', (await err('monitor', `update p2p_orders set failure_reason='x'`)) !== null);
check('monitor NÃO executa o webhook', /permission denied/.test(await err('monitor', `select update_order_status_from_gateway('pix_tx_001','PAID')`)));
check('monitor NÃO insere ordens', (await err('monitor', `insert into p2p_orders (asset_symbol,fiat_amount,token_amount,user_wallet_address) values ('BODE',100,1,'${SOL}')`)) !== null);

// ---------------------------------------------------------------- Resumo
const failed = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - failed.length}/${results.length} testes passaram`);
await db.close();
process.exit(failed.length ? 1 : 0);
