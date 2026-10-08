import http from 'node:http';
import { loadEnv } from './env.ts';
import { startApp } from './server.ts';

function healthcheck(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/healthz', timeout: 3000 }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(false));
  });
}

const env = loadEnv(process.env);

if (process.argv.includes('--healthcheck')) {
  process.exit((await healthcheck(env.port)) ? 0 : 1);
}

const app = await startApp(env);
console.log(`[rack] listening on port ${app.port}${env.demo ? ' (demo mode)' : ''}`);

let stopping = false;
const shutdown = async () => {
  if (stopping) return;
  stopping = true;
  await app.close();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
