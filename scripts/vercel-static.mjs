// Copia o site estático (HTML + assets) de frontend/ para public/, que é o
// outputDirectory servido pela Vercel. Roda no buildCommand (npm run vercel-build).
import { cp, mkdir, readdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const FRONTEND = resolve(ROOT, 'frontend');
const PUBLIC = resolve(ROOT, 'public');

await rm(PUBLIC, { recursive: true, force: true });
await mkdir(PUBLIC, { recursive: true });

const entries = await readdir(FRONTEND, { withFileTypes: true });
for (const entry of entries) {
  const isHtml = entry.isFile() && entry.name.endsWith('.html');
  const isImage = entry.isFile() && /\.(png|svg|ico|jpe?g|webp)$/i.test(entry.name);
  const isAssets = entry.isDirectory() && entry.name === 'assets';
  if (!isHtml && !isImage && !isAssets) continue;
  await cp(resolve(FRONTEND, entry.name), resolve(PUBLIC, entry.name), { recursive: true });
}

console.log('Site copiado para public/');
