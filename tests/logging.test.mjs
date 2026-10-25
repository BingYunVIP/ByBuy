import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import express from 'express';
import { createApi } from '../server/api.mjs';
import { createUpstream } from '../server/upstream.mjs';
import { createTeamRedeem } from '../server/team-redeem.mjs';
import { fingerprint, maskIp, scrub } from '../server/logger.mjs';

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const TEAM_CARD = 'TEAMCARD-ABCD-123456';
const GPT_CARD = 'DEMOCARD-WXYZ-654321';
const EMAIL = 'private.person@example.test';
const PASSWORD = 'Sup3r-Secret-Pass-Word-9876';
const REQUEST_ID = '3f2b1c4e-1111-4222-8333-444455556666';

/* 抓取 LOG_LEVEL 不是 silent 时写出的所有日志行 */
async function captureLogs(callback) {
  const previous = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = 'debug';
  const lines = [];
  const originals = {};
  for (const name of ['debug', 'info', 'warn', 'error']) {
    originals[name] = console[name];
    console[name] = line => lines.push(String(line));
  }
  try { await callback(); }
  finally {
    Object.assign(console, originals);
    if (previous === undefined) delete process.env.LOG_LEVEL; else process.env.LOG_LEVEL = previous;
  }
  return lines;
}

async function withApi(options, callback) {
  const app = express();
  app.use('/api', createApi(options));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body) => fetch(`${origin}${path}`, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
  try { await callback({ post }); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}

test('Team and ChatGPT actions are both logged, with no sensitive values', async () => {
  const teamRedeem = createTeamRedeem({
    origin: 'https://team.example',
    fetchImpl: async (url) => String(url).includes('ready-sub')
      ? json({ status: 'success', account: { email: EMAIL, password: PASSWORD, totp_secret: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP' } })
      : json({ status: 'success' }),
  });
  const upstream = createUpstream({
    origin: 'https://service.example',
    fetchImpl: async () => json({ code: 'OK', data: { status: 'COMPLETED', plan: 'plus', orderNo: 'DEMO-ORDER-123456', accountEmail: EMAIL } }),
    log: { info() {}, warn() {}, error() {} },
  });
  const lines = await captureLogs(() => withApi({ teamRedeem, upstream }, async ({ post }) => {
    assert.equal((await post('/api/team/invite', { cdk: TEAM_CARD, email: EMAIL, request_id: REQUEST_ID })).status, 200);
    assert.equal((await post('/api/team/ready', { cdk: TEAM_CARD, request_id: REQUEST_ID })).status, 200);
    assert.equal((await post('/api/orders/query', { code: GPT_CARD })).status, 200);
    assert.equal((await post('/api/team/invite', { cdk: TEAM_CARD, email: 'not-an-email', request_id: REQUEST_ID })).status, 400);
  }));

  const records = lines.map(line => JSON.parse(line));
  const business = records.filter(r => ['TEAM', 'ORDER'].includes(r.category));
  assert.deepEqual(business.map(r => `${r.service}:${r.event}:${r.outcome}`),
    ['team:INVITE:OK', 'team:READY_ACCOUNT:OK', 'chatgpt:ORDER_QUERY:OK', 'team:INVITE:FAILED']);
  assert.match(business[0].email, /^p\*\*\*@e\*\*\*\.test$/);
  assert.equal(business[0].card, fingerprint(TEAM_CARD));
  assert.equal(business[0].card, business[3].card, 'same card links across requests');
  assert.notEqual(business[0].card, business[2].card, 'different cards differ');
  assert.equal(business[3].code, 'INVALID_INPUT');
  assert.ok(records.every(r => typeof r.requestId !== 'string' || /^[0-9a-f-]{36}$/.test(r.requestId)));
  assert.ok(records.filter(r => r.category === 'HTTP').every(r => r.ip === '127.0.*.*'), 'client IP is masked');

  const everything = lines.join('\n');
  for (const secret of [TEAM_CARD, GPT_CARD, EMAIL, PASSWORD, 'JBSWY3DPEHPK3PXP', 'DEMO-ORDER-123456', 'team.example', 'service.example']) {
    assert.equal(everything.includes(secret), false, `log leaked ${secret}`);
  }
});

test('logger scrubs sensitive values even when a caller forgets to', async () => {
  const lines = await captureLogs(async () => {
    const { appLog } = await import('../server/logger.mjs');
    appLog.info('TEST', 'LEAK', {
      email: EMAIL, card: TEAM_CARD, token: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcDEF_ghi-12',
      blob: 'A'.repeat(64), requestId: REQUEST_ID, note: 'line\nbreak',
    });
  });
  const record = JSON.parse(lines[0]);
  assert.equal(record.email, 'p***@e***.test');
  assert.equal(record.card, '[card]');
  assert.equal(record.token, '[token]');
  assert.equal(record.blob, '[secret]');
  assert.equal(record.requestId, REQUEST_ID);
  assert.equal(record.note, 'line break');
});

test('IP masking and card fingerprints', () => {
  assert.equal(maskIp('203.0.113.77'), '203.0.*.*');
  assert.equal(maskIp('::ffff:198.51.100.9'), '198.51.*.*');
  assert.equal(maskIp('2001:db8:1:2::1'), '2001:db8::*');
  assert.equal(maskIp(undefined), 'unknown');
  assert.equal(fingerprint(' abcd-1234-efgh '), fingerprint('ABCD-1234-EFGH'));
  assert.equal(fingerprint(''), null);
  assert.equal(scrub('POST /api/team/invite 200'), 'POST /api/team/invite 200');
});
