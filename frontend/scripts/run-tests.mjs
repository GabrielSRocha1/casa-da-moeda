// Roda os testes Python do site com o binário certo por plataforma
// (Windows: py/python; macOS/Linux: python3).
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const candidates = process.platform === 'win32' ? ['py', 'python', 'python3'] : ['python3', 'python'];

const python = candidates.find((bin) => spawnSync(bin, ['--version'], { shell: false }).status === 0);
if (!python) {
  console.error('Python não encontrado no PATH (tentado: ' + candidates.join(', ') + ').');
  process.exit(1);
}

for (const file of ['tests/test_site.py', 'tests/test_parceria.py']) {
  const r = spawnSync(python, [file], { cwd: root, stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
