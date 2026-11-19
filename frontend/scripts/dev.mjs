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

const stop = () => { tw.kill(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
