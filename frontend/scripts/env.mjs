// Gera frontend/assets/env.js a partir do .env da raiz do projeto.
// Roda automaticamente no `npm run dev` / `npm run serve` (importado por dev.mjs e serve.mjs).
// APENAS variáveis públicas vão para o frontend — nunca a service_role.
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const FRONTEND = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PROJECT_ROOT = resolve(FRONTEND, '..');

/** Parser simples de .env (KEY=valor, ignora comentários e linhas vazias). */
function parseDotEnv(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

async function loadEnv() {
  for (const file of [resolve(PROJECT_ROOT, '.env'), resolve(FRONTEND, '.env')]) {
    try { return parseDotEnv(await readFile(file, 'utf8')); } catch (_) { /* tenta o próximo */ }
  }
  return {};
}

const env = await loadEnv();

// Lista de permissão: só chaves PÚBLICAS entram no bundle do site.
const PUBLIC_KEYS = { SUPABASE_URL: '', SUPABASE_ANON_KEY: '', API_URL: 'http://localhost:3333' };
const publicEnv = {};
for (const key of Object.keys(PUBLIC_KEYS)) publicEnv[key] = env[key] || PUBLIC_KEYS[key];

const banner =
  '// ARQUIVO GERADO — não edite: edite o .env na raiz do projeto e rode `npm run dev`.\n' +
  '// Contém apenas chaves públicas (a anon key do Supabase é protegida pelo RLS).\n';
await writeFile(
  resolve(FRONTEND, 'assets', 'env.js'),
  banner + 'window.CMMD_ENV = ' + JSON.stringify(publicEnv, null, 2) + ';\n',
  'utf8'
);

const configured = publicEnv.SUPABASE_URL && publicEnv.SUPABASE_ANON_KEY;
console.log(configured
  ? 'Supabase configurado via .env → assets/env.js'
  : 'Supabase ainda sem chaves no .env (modo local) → assets/env.js');
