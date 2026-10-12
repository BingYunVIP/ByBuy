/**
 * 并发 / 多人使用相关的实测。
 * 用假上游（本地 HTTP）控制时序，这样能精确数出并发峰值、重试次数和探测次数。
 *
 *   node ui-tune/tests/test-concurrency.mjs
 *
 * 默认直接测项目里的 server/ 真实文件；
 * 想在应用改动之前先跑一遍，用 SERVER_DIR=./somewhere 指向一份副本。
 */
import express from 'express';
import { createServer } from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = process.env.SERVER_DIR ? resolve(process.env.SERVER_DIR) : resolve(HERE, '../server');
console.log(`被测服务端目录：${SERVER_DIR}`);

const { createUpstream, PublicError } = await import(pathToFileURL(resolve(SERVER_DIR, 'upstream.mjs')).href);
const { createApi } = await import(pathToFileURL(resolve(SERVER_DIR, 'api.mjs')).href);

const results = [];
const check = (label, pass, detail = '') => {
  results.push({ label, pass });
  console.log(`${pass ? '  ✔' : '  ✘'} ${label}${detail ? `  ${detail}` : ''}`);
};

/* ------------------------------------------------------------ 假上游 */

let inflight = 0;
let peak = 0;
let attempts = 0;
let healthPings = 0;
let mode = 'ok';               // ok | invalid | slow
const CONCURRENT_DELAY = 300;

const fake = createServer((req, res) => {
  const json = body => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  if (req.url.startsWith('/api/health')) { healthPings++; return json({ code: 'OK', message: 'success', data: { ok: true } }); }

  attempts++;
  inflight++; peak = Math.max(peak, inflight);
  const finish = () => {
    inflight--;
    if (mode === 'invalid') return json({ code: 'INVALID_CARD', message: '卡密无效或已使用' });
    json({ code: 'OK', message: 'success', data: { status: 'COMPLETED', plan: 'plus', orderNo: 'GPTMV26C59AC1B6', accountEmail: 'cui242013@gmail.com' } });
  };
  if (mode === 'slow') setTimeout(finish, CONCURRENT_DELAY); else finish();
});
await new Promise(r => fake.listen(0, '127.0.0.1', r));
const FAKE = `http://127.0.0.1:${fake.address().port}`;
const DEAD = 'http://127.0.0.1:1';        // 必然连不上
const reset = () => { inflight = 0; peak = 0; attempts = 0; };

/* ------------------------------------------------ 1. 并发闸门真的限流 */

console.log('\n=== 1. 上游并发闸门（concurrency=4）===');
{
  reset();
  mode = 'slow';                                  // 每次 300ms，才能看出并发被压住
  const upstream = createUpstream({ origin: FAKE, concurrency: 4, queueLimit: 200, queueWaitMs: 15_000 });
  const started = Date.now();
  const settled = await Promise.allSettled(Array.from({ length: 30 }, () => upstream.query('DEMO-TEST-CARD-123456')));
  const ok = settled.filter(item => item.status === 'fulfilled').length;
  console.log(`  30 个并发请求 → 成功 ${ok}，耗时 ${Date.now() - started}ms`);
  console.log(`  上游实际并发峰值 = ${peak}（上限 4，30 个请求 × 300ms ÷ 4 ≈ 8 批 ≈ 2400ms）`);
  check('并发峰值正好卡在上限', peak === 4, `peak=${peak}`);
  check('没有请求被漏掉', ok === 30, `ok=${ok}`);
  mode = 'ok';
}

/* ------------------------------------------ 2. 队列排满时快速失败，不干等 */

console.log('\n=== 2. 队列排满（concurrency=2, queueLimit=3）===');
{
  let queueAttempts = 0;
  const queueFake = createServer((_req, res) => {
    queueAttempts++;
    setTimeout(() => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ code: 'OK', data: { status: 'COMPLETED', plan: 'plus' } }));
    }, CONCURRENT_DELAY);
  });
  await new Promise(resolve => queueFake.listen(0, '127.0.0.1', resolve));
  const queueOrigin = `http://127.0.0.1:${queueFake.address().port}`;
  const upstream = createUpstream({ origin: queueOrigin, concurrency: 2, queueLimit: 3, queueWaitMs: 15_000 });
  const started = Date.now();
  const settled = await Promise.allSettled(Array.from({ length: 12 }, () => upstream.query('DEMO-TEST-CARD-123456')));
  const elapsed = Date.now() - started;
  const busy = settled.filter(item => item.status === 'rejected' && item.reason?.code === 'SERVICE_BUSY').length;
  const ok = settled.filter(item => item.status === 'fulfilled').length;
  console.log(`  12 个并发请求 → 成功 ${ok}，SERVICE_BUSY ${busy}，耗时 ${elapsed}ms`);
  check('超出名额的请求被快速拒绝', busy === 7, `busy=${busy}`);
  check('被拒的请求没有打到上游', queueAttempts === 5, `上游只收到 ${queueAttempts} 次`);
  check('拒绝是立刻返回的，不是等超时', elapsed < 3000, `${elapsed}ms`);
  await new Promise(resolve => queueFake.close(resolve));
}

/* --------------------------------------------------- 3. 两个域名互为兜底 */

console.log('\n=== 3. 双域名兜底 ===');
{
  reset();
  const viaBackup = await createUpstream({ origin: `${DEAD},${FAKE}`, concurrency: 4 }).query('DEMO-TEST-CARD-123456');
  check('主站挂了会自动切到备用站', viaBackup?.status === 'COMPLETED', `status=${viaBackup?.status}`);

  const allDown = createUpstream({ origin: `${DEAD},http://127.0.0.1:2`, concurrency: 4 });
  const failed = await allDown.query('DEMO-TEST-CARD-123456').then(() => null, error => error);
  check('两个站都挂了才报错', failed instanceof PublicError && failed.code === 'SERVICE_UNAVAILABLE', `code=${failed?.code}`);

  /* 业务结论不该换站重试 */
  reset();
  mode = 'invalid';
  const business = createUpstream({ origin: `${FAKE},${FAKE.replace(/\d+$/, m => Number(m) + 1)}`, concurrency: 4 });
  const invalid = await business.query('DEMO-TEST-CARD-123456').then(() => null, error => error);
  check('卡密无效不会换站重试（只打上游 1 次）', invalid?.code === 'INVALID_CARD' && attempts === 1, `code=${invalid?.code} attempts=${attempts}`);
  mode = 'ok';
}

/* --------------------------- 4. 状态探测：一个站通就算正常 + 缓存 + 搭车 */

console.log('\n=== 4. 状态探测（一个站通就算正常 / 缓存 / 同时探测合并）===');
{
  const oneUp = createUpstream({ origin: `${DEAD},${FAKE}` });
  const a = await oneUp.status();
  check('两站中一个可用 → 正常', a.online === true, JSON.stringify(a));

  const noneUp = createUpstream({ origin: `${DEAD},http://127.0.0.1:2`, statusTimeoutMs: 2000 });
  const b = await noneUp.status();
  check('两站全挂 → 异常', b.online === false, JSON.stringify(b));
  check('状态响应里不含上游域名', !JSON.stringify(b).includes('127.0.0.1'), JSON.stringify(b));
}

/* 冷启动时一批访客同时开页面 —— 只允许一次探测在飞，其余人搭车 */
{
  healthPings = 0;
  const cold = createUpstream({ origin: `${DEAD},${FAKE}` });
  await Promise.all(Array.from({ length: 20 }, () => cold.status()));
  check('20 个访客同时开页面只 ping 上游 1 次', healthPings === 1, `ping=${healthPings}`);

  await Promise.all(Array.from({ length: 20 }, () => cold.status()));
  check('缓存生效：再查 20 次打上游 0 次', healthPings === 1, `ping=${healthPings}`);
}

/* 缓存过期后必须重新探测 */
{
  healthPings = 0;
  let clock = 1_000_000;
  const timed = createUpstream({ origin: `${DEAD},${FAKE}`, now: () => clock });
  await timed.status();
  const afterFirst = healthPings;
  clock += 21_000;                                  // 越过 20 秒 TTL
  await timed.status();
  check('缓存过期（>20s）后会重新探测', healthPings === afterFirst + 1, `ping=${healthPings - afterFirst}`);
}

/* 探测失败也要缓存，否则上游挂了以后每个访客都要等满超时 */
{
  const downTimed = createUpstream({ origin: `${DEAD},http://127.0.0.1:2`, statusTimeoutMs: 2000 });
  await downTimed.status();
  const again = await downTimed.status();
  check('上游挂了时第二次查询直接吃缓存（不再等超时）', again.cached === true, `cached=${again.cached}`);
}

/* ------------------------------------- 5. TRUST_PROXY：所有人共用一个限流桶 */

console.log('\n=== 5. 反代后面的限流（这是多人同时用最要命的一条）===');

async function hitRateLimit(trustProxy) {
  const app = express();
  if (trustProxy) app.set('trust proxy', trustProxy);
  const upstream = createUpstream({ origin: FAKE, concurrency: 50, queueLimit: 500 });
  app.use('/api', createApi({ upstream }));
  const server = createServer(app).listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  const port = server.address().port;
  /* 模拟 40 个不同访客，各自带自己的 X-Forwarded-For（真实场景就是 Caddy 加的） */
  const codes = await Promise.all(Array.from({ length: 40 }, (_, i) =>
    fetch(`http://127.0.0.1:${port}/api/cards/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `203.0.113.${i + 1}`, Origin: `http://127.0.0.1:${port}` },
      body: JSON.stringify({ code: 'DEMO-TEST-CARD-123456' }),
    }).then(r => r.status, () => 0),
  ));
  server.close();
  return { rejected: codes.filter(code => code === 429).length, total: codes.length };
}

{
  const without = await hitRateLimit(null);
  console.log(`  未设 TRUST_PROXY：40 个不同访客 → ${without.rejected} 个被限流（429）`);
  check('未设 TRUST_PROXY 时所有人共用一个桶（这就是 bug）', without.rejected > 0, `429=${without.rejected}`);

  const withProxy = await hitRateLimit('loopback');
  console.log(`  设了 TRUST_PROXY=loopback：40 个不同访客 → ${withProxy.rejected} 个被限流`);
  check('设了 TRUST_PROXY 后每人各自计数', withProxy.rejected === 0, `429=${withProxy.rejected}`);
}

/* ------------------------------------------------------------------ */

fake.close();
const failed = results.filter(item => !item.pass);
console.log(`\n合计 ${results.length} 项，通过 ${results.length - failed.length}，失败 ${failed.length}`);
if (failed.length) { console.log('失败项：'); for (const item of failed) console.log('  -', item.label); process.exitCode = 1; }
