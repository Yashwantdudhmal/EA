import waitOn from 'wait-on';
import { spawn } from 'node:child_process';

const VITE_URL = process.env.VITE_URL ?? 'http://127.0.0.1:5173';

await waitOn({
  resources: [VITE_URL],
  timeout: 60_000,
  interval: 250,
  validateStatus: (status) => status >= 200 && status < 500
});

const electronModule = await import('electron');
const electronPath = electronModule.default;

const child = spawn(electronPath, ['.'], {
  stdio: 'inherit'
});

child.on('exit', (code) => {
  process.exit(code ?? 0);
});
