// npm run dev → servidor local + recompilação automática do Tailwind (Windows, macOS e Linux)
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const tw = spawn('npx', ['tailwindcss', '-c', 'tailwind.config.js', '-i', 'src/tailwind.css', '-o', 'assets/app.css', '--watch'], {
  cwd: root,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
await import('./serve.mjs');

const stop = () => {
  // No Windows o spawn com shell cria um cmd.exe intermediário: kill() mataria só o shell
  // e deixaria o watcher do Tailwind órfão segurando o assets/app.css.
  if (process.platform === 'win32' && tw.pid) {
    spawn('taskkill', ['/pid', String(tw.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    tw.kill();
  }
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
