/**
 * /api/service/status 的端到端实测。
 * 起一个真的 express + 真的 createApi + 真的 createUpstream，前面挂一个假上游。
 *
 *   node ui-tune/tests/test-status-route.mjs
 *
 * 验证四件事：
 *   1. 路由通，返回体只有 { online, latencyMs, cached }，不含上游域名
 *   2. 跨站请求被同源校验挡掉（否则别人能拿它当免费的上游探针）
 *   3. 高频轮询只会在内存里读缓存，不会反复打上游
 *   4. 轮询额度（240/分）与业务额度（30/分）是两个桶，轮询不会把用户自己的操作额度挤掉
 */
import express from 'express';
import { createServer } from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = process.env.SERVER_DIR ? resolve(process.env.SERVER_DIR) : resolve(HERE, '../server');
console.log(`被测服务端目录：${SERVER_DIR}`);

const { createUpstream } = await import(pathToFileURL(resolve(SERVER_DIR, 'upstream.mjs')).href);
const { createApi } = await import(pathToFileURL(resolve(SERVER_DIR, 'api.mjs')).href);

const results = [];
const check = (label, pass, detail = '') => {
  results.push({ label, pass });
  console.log(`${pass ? '  ✔' : '  ✘'} ${label}${detail ? `  ${detail}` : ''}`);
};

/* ------------------------------------------------------------ 假上游 */

let healthPings = 0;
let upstreamUp = true;

const fake = createServer((req, res) => {
  const json = body => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  if (req.url.startsWith('/api/health')) {
    healthPings++;
    if (!upstreamUp) { res.writeHead(503, { 'content-type': 'application/json' }); return res.end('{"code":"DOWN"}'); }
    return json({ code: 'OK', message: 'success', data: { ok: true } });
  }
  json({ code: 'OK', message: 'success', data: { status: 'COMPLETED', plan: 'plus', orderNo: 'GPTMV26C59AC1B6', accountEmail: 'cui242013@gmail.com' } });
});
await new Promise(r => fake.listen(0, '127.0.0.1', r));
const FAKE = `http://127.0.0.1:${fake.address().port}`;

/* ------------------------------------------------------------ 起真服务 */

const app = express();
app.use('/api', createApi({ upstream: createUpstream({ origin: FAKE, concurrency: 50, queueLimit: 500 }) }));
app.use((error, _req, res, _next) => {
  res.status(error.status ?? 500).json({ ok: false, error: { code: error.code ?? 'INTERNAL_ERROR', message: error.message } });
});
const server = createServer(app).listen(0, '127.0.0.1');
await new Promise(r => server.once('listening', r));
const BASE = `http://127.0.0.1:${server.address().port}`;
console.log(`本地服务：${BASE}`);

const getStatus = (query = '') => fetch(`${BASE}/api/service/status${query}`);

/* ------------------------------------------------ 1. 路由通 + 响应体干净 */

console.log('\n=== 1. 路由与响应体 ===');
{
  const response = await getStatus();
  const body = await response.json();
  console.log(`  HTTP ${response.status} ${JSON.stringify(body)}`);
  check('GET /api/service/status → 200', response.status === 200, `status=${response.status}`);
  check('上游正常 → online:true', body.ok === true && body.data?.online === true, JSON.stringify(body.data));
  check('响应体只有 online/latencyMs/cached 三个字段',
    Object.keys(body.data ?? {}).sort().join(',') === 'cached,latencyMs,online', JSON.stringify(body.data));
  check('响应体不含上游域名 / 端口', !JSON.stringify(body).includes('127.0.0.1'), JSON.stringify(body));
}

/* ------------------------------------------------ 2. 同源校验仍然生效 */

console.log('\n=== 2. 同源校验（别人不能拿它当免费探针）===');
{
  const crossSite = await fetch(`${BASE}/api/service/status`, { headers: { Origin: 'https://evil.example' } });
  const body = await crossSite.json().catch(() => ({}));
  check('跨站 Origin → 403 ORIGIN_REJECTED', crossSite.status === 403 && body.error?.code === 'ORIGIN_REJECTED', `status=${crossSite.status} code=${body.error?.code}`);

  const sameOrigin = await fetch(`${BASE}/api/service/status`, { headers: { Origin: BASE } });
  check('同源 Origin → 200', sameOrigin.status === 200, `status=${sameOrigin.status}`);

  const secFetch = await fetch(`${BASE}/api/service/status`, { headers: { 'Sec-Fetch-Site': 'cross-site' } });
  check('Sec-Fetch-Site: cross-site → 403', secFetch.status === 403, `status=${secFetch.status}`);
}

/* ------------------------------------------- 3. 高频轮询只读缓存，不反复打上游 */

console.log('\n=== 3. 轮询只读缓存 ===');
{
  healthPings = 0;
  /* 先来一发把缓存填上（缓存是 20 秒） */
  await getStatus();
  const afterWarm = healthPings;
  const codes = await Promise.all(Array.from({ length: 60 }, () => getStatus().then(r => r.status)));
  console.log(`  60 次并发轮询 → HTTP 状态集合 ${[...new Set(codes)].join(',')}，新增上游 ping = ${healthPings - afterWarm}`);
  check('60 次并发轮询全部 200', codes.every(code => code === 200), `codes=${[...new Set(codes)].join(',')}`);
  check('60 次并发轮询新增上游 ping = 0', healthPings - afterWarm === 0, `ping=${healthPings - afterWarm}`);

  /* fresh=1 有 3 秒下限：连点「重新检测」不该把上游当压测靶子 */
  healthPings = 0;
  const freshImmediate = await fetch(`${BASE}/api/service/status?fresh=1`).then(r => r.json());
  check('刚探测过就连点 fresh=1 → 仍吃缓存（3 秒下限）', freshImmediate.data?.cached === true && healthPings === 0, `cached=${freshImmediate.data?.cached} ping=${healthPings}`);

  /* 过了 3 秒下限，fresh=1 必须真的重新探测 */
  await new Promise(r => setTimeout(r, 3200));
  healthPings = 0;
  const freshLater = await fetch(`${BASE}/api/service/status?fresh=1`).then(r => r.json());
  check('过了 3 秒再点 fresh=1 → 真的重新探测上游', freshLater.data?.cached === false && healthPings === 1, `cached=${freshLater.data?.cached} ping=${healthPings}`);
  check('fresh=1 的响应体一样干净', Object.keys(freshLater.data ?? {}).sort().join(',') === 'cached,latencyMs,online', JSON.stringify(freshLater.data));
}

/* ------------------------------- 4. 轮询额度与业务额度是两个桶（互不挤占） */

console.log('\n=== 4. 轮询额度 vs 业务额度 ===');
{
  const codes = await Promise.all(Array.from({ length: 100 }, () => getStatus().then(r => r.status)));
  check('100 次轮询没有被 30/分的业务限流挡住', codes.every(code => code === 200), `codes=${[...new Set(codes)].join(',')}`);

  const business = await fetch(`${BASE}/api/cards/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: BASE },
    body: JSON.stringify({ code: 'DEMO-TEST-CARD-123456' }),
  });
  const businessBody = await business.json().catch(() => ({}));
  /* 注意：这里**故意**不传 X-ByBuy-Eligibility，所以正常结果是 403 ELIGIBILITY_REQUIRED。
     重点不是它成功，而是它没有变成 429 —— 说明 100 次轮询没有吃掉业务额度。 */
  console.log(`  业务请求 → HTTP ${business.status} code=${businessBody.error?.code}`);
  check('轮询之后业务请求没被限流（拿到的是资格校验，不是 429）',
    businessBody.error?.code !== 'RATE_LIMITED' && business.status !== 429,
    `status=${business.status} code=${businessBody.error?.code}`);
}

/* ---------------------------------------- 5. 上游挂掉 → 异常，且很快返回 */

console.log('\n=== 5. 上游挂掉 ===');
{
  upstreamUp = false;
  /* 等过 20 秒缓存 —— 用 fresh 绕不过 3 秒下限，所以这里直接等缓存自然过期不现实。
     换个办法：新建一个 upstream 实例（独立缓存）来测"挂掉"这一路。 */
  const downApp = express();
  downApp.use('/api', createApi({ upstream: createUpstream({ origin: FAKE, statusTimeoutMs: 2000 }) }));
  downApp.use((error, _req, res, _next) => res.status(error.status ?? 500).json({ ok: false, error: { code: error.code ?? 'INTERNAL_ERROR' } }));
  const downServer = createServer(downApp).listen(0, '127.0.0.1');
  await new Promise(r => downServer.once('listening', r));
  const downBase = `http://127.0.0.1:${downServer.address().port}`;

  const started = Date.now();
  const body = await fetch(`${downBase}/api/service/status`).then(r => r.json());
  const elapsed = Date.now() - started;
  console.log(`  上游 503 → ${JSON.stringify(body)}（${elapsed}ms）`);
  check('上游返回 503 → online:false', body.data?.online === false, JSON.stringify(body.data));
  check('探测很快返回，没让访客等满超时', elapsed < 3000, `${elapsed}ms`);
  check('异常时响应体依然不含上游域名', !JSON.stringify(body).includes('127.0.0.1'), JSON.stringify(body));
  downServer.close();
  upstreamUp = true;
}

/* ------------------------------------------------------------------ */

server.close();
fake.close();
const failed = results.filter(item => !item.pass);
console.log(`\n合计 ${results.length} 项，通过 ${results.length - failed.length}，失败 ${failed.length}`);
if (failed.length) { console.log('失败项：'); for (const item of failed) console.log('  -', item.label); process.exitCode = 1; }
