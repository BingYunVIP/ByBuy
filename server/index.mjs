import express from 'express';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApi } from './api.mjs';
import { createUpstream } from './upstream.mjs';
import { appLog } from './logger.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const port = Number(process.env.PORT || 2254);
const host = process.env.HOST || '0.0.0.0';
const timeoutMs = Number(process.env.UPSTREAM_TIMEOUT_MS || 25_000);
const dev = process.argv.includes('--dev');
if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error('PORT must be between 1 and 65535.');
if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 60_000) throw new Error('UPSTREAM_TIMEOUT_MS must be 1000–60000.');

if (!process.env.ChatGPT_Web?.trim()) {
  appLog.error('LIFECYCLE', 'CONFIG_MISSING', { key: 'ChatGPT_Web', hint: '请在 .env 中填写 ChatGPT_Web（充值服务网址）' });
  process.exit(1);
}
if (!process.env.Team_Web?.trim()) appLog.warn('LIFECYCLE', 'CONFIG_MISSING', { key: 'Team_Web', hint: '未填写 Team_Web，Team 兑换将显示暂未开放' });

const app = express();
app.disable('x-powered-by');
if (process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY);
app.use((_req, res, next) => {
  res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY' });
  if (!dev) res.set('Content-Security-Policy', "default-src 'self'; script-src 'self' https://js.stripe.com; style-src 'self'; img-src 'self' data: https://*.stripe.com https://*.stripe.network; connect-src 'self' https://api.stripe.com https://*.stripe.com https://*.stripe.network; frame-src https://js.stripe.com https://hooks.stripe.com https://*.stripe.com; worker-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'");
  next();
});
app.use('/api', createApi({
  upstream: createUpstream({ origin: process.env.ChatGPT_Web, timeoutMs, log: appLog }),
  publicOrigin: process.env.PUBLIC_ORIGIN,
}));

/* Canonical product routes; keep the old order/redeem links usable. */
app.get('/', (_req, res) => res.redirect(302, '/chatgpt'));
app.get('/order', (_req, res) => res.redirect(302, '/chatgpt/order'));
app.get(['/redeem', '/subscription'], (_req, res) => res.redirect(302, '/chatgpt'));

const server = createServer(app);
let vite;
if (dev) {
  const { createServer: createViteServer } = await import('vite');
  vite = await createViteServer({ root, server: { middlewareMode: true, ws: { server }, watch: { ignored: ['**/artifacts/**'] } } });
  app.use(vite.middlewares);
} else {
  const dist = path.join(root, 'dist');
  if (!existsSync(path.join(dist, 'index.html'))) throw new Error('Run npm run build before npm start.');
  app.use(express.static(dist, {
    index: false,
    setHeaders(res, file) {
      res.set('Cache-Control', file.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache');
    },
  }));
  app.get(['/', '/chatgpt', '/chatgpt/order', '/team', '/order', '/redeem', '/subscription'], (_req, res) => {
    res.set('Cache-Control', 'no-cache');
    res.sendFile(path.join(dist, 'index.html'));
  });
  app.use((_req, res) => res.status(404).type('text').send('Not found'));
}

server.listen(port, host, () => appLog.info('LIFECYCLE', 'SERVER_READY', { mode: dev ? 'development' : 'production', host, port }));
server.on('error', error => { appLog.error('LIFECYCLE', 'LISTEN_FAILED', { code: error.code ?? 'UNKNOWN', host, port }); process.exitCode = 1; });

let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  appLog.info('LIFECYCLE', 'SHUTDOWN_STARTED', { port });
  const forceExit = setTimeout(() => process.exit(1), 5000).unref();
  await vite?.close();
  server.close(() => { clearTimeout(forceExit); process.exit(0); });
  server.closeIdleConnections();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
