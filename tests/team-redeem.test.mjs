import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import express from 'express';
import { createApi } from '../server/api.mjs';
import { createTeamRedeem } from '../server/team-redeem.mjs';
import { PublicError } from '../server/upstream.mjs';

const origin = 'https://team.example/team-redeem/';
const requestId = '77db8dd5-7fef-4f8a-8a5d-8c91c0fd7090';
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('Team adapter calls only the fixed public inventory and redemption paths', async () => {
  const calls = [];
  const team = createTeamRedeem({ origin, fetchImpl: async (url, init) => {
    calls.push({ url: url.href, init });
    if (url.pathname.endsWith('/availability')) return json({ invite_seats_remaining: 45, ready_accounts_remaining: 21 });
    if (url.pathname.endsWith('/invite')) return json({ status: 'success' });
    return json({ status: 'success', account: { email: 'account@example.test', password: 'private-password', totp_secret: 'private-totp' } });
  } });

  assert.deepEqual(await team.availability(), { inviteSeatsRemaining: 45, readyAccountsRemaining: 21 });
  assert.deepEqual(await team.invite({ cdk: ' team-code-123 ', email: ' Buyer@Example.com ', request_id: requestId }), { status: 'success' });
  assert.deepEqual(await team.ready({ cdk: 'TEAM-CODE-456', request_id: requestId }), {
    status: 'success', account: { email: 'account@example.test', password: 'private-password', totp_secret: 'private-totp' },
  });

  assert.deepEqual(calls.map(call => call.url), [
    `${origin}api/inventory/availability`, `${origin}api/cdk/redeem/invite`, `${origin}api/cdk/redeem/ready-sub`,
  ]);
  assert.equal(calls[0].init.method, 'GET');
  assert.deepEqual(JSON.parse(calls[1].init.body), { cdk: 'TEAM-CODE-123', email: 'buyer@example.com', request_id: requestId });
  assert.deepEqual(JSON.parse(calls[2].init.body), { cdk: 'TEAM-CODE-456', request_id: requestId });
  assert.ok(calls.every(call => call.init.redirect === 'error' && call.init.signal instanceof AbortSignal));
});

test('Team adapter rejects unsafe destinations, malformed inputs and non-success envelopes', async t => {
  assert.throws(() => createTeamRedeem({ origin: 'http://remote.example/' }), /HTTPS/);
  let calls = 0;
  const team = createTeamRedeem({ origin, fetchImpl: async () => { calls++; return json({ status: 'success' }); } });
  await t.test('input whitelist and UUID validation', async () => {
    for (const body of [
      { cdk: 'TEAM-123456', email: 'a@example.com', request_id: requestId, extra: 'secret' },
      { cdk: 'TEAM-123456', email: 'bad', request_id: requestId },
      { cdk: 'TEAM-123456', email: 'a@example.com', request_id: 'not-a-uuid' },
    ]) await assert.rejects(team.invite(body), error => error instanceof PublicError && error.status === 400);
    assert.equal(calls, 0);
  });
  await t.test('non-success and malformed success responses never become success', async () => {
    const invite = createTeamRedeem({ origin, fetchImpl: async () => json({ detail: '正在处理' }, 409) });
    await assert.rejects(invite.invite({ cdk: 'TEAM-123456', email: 'a@example.com', request_id: requestId }), error => error.status === 409 && error.canQuery);
    const ready = createTeamRedeem({ origin, fetchImpl: async () => json({ status: 'success', account: { email: 'a@example.com' } }) });
    await assert.rejects(ready.ready({ cdk: 'TEAM-123456', request_id: requestId }), error => error.status === 502 && error.canQuery);
  });
  await t.test('a card already used for an invite is reported as used, not as an outage', async () => {
    const replay = createTeamRedeem({ origin, fetchImpl: async () => json({ status: 'success', msg: '邀请已发送，请前往邮箱接受工作区邀请。', email: 'someone.real@example.com', operation_id: 'op-1' }) });
    await assert.rejects(replay.ready({ cdk: 'TEAM-123456', request_id: requestId }), error => {
      assert.equal(error.status, 409);
      assert.equal(error.code, 'TEAM_ALREADY_REDEEMED');
      assert.equal(error.canQuery, false);
      assert.match(error.message, /已经兑换过.*s\*\*\*@e\*\*\*\.com.*查收/);
      assert.equal(error.message.includes('someone.real'), false, 'full email must not reach the browser');
      return true;
    });
  });
  await t.test('timeouts, network failures, busy and malformed replies are safe and never retried', async () => {
    const cases = [
      ['timeout', () => { throw new DOMException('private timeout detail', 'TimeoutError'); }, 504, 'TEAM_TIMEOUT'],
      ['network', () => { throw new Error('private network detail'); }, 502, 'TEAM_UNAVAILABLE'],
      ['busy', () => json({}, 429), 503, 'TEAM_BUSY'],
      ['malformed', () => new Response('<html>private challenge</html>', { headers: { 'content-type': 'text/html' } }), 502, 'TEAM_RESPONSE'],
    ];
    for (const [name, fetchImpl, status, code] of cases) {
      let attempts = 0;
      const adapter = createTeamRedeem({ origin, fetchImpl: async (...args) => { attempts++; return fetchImpl(...args); } });
      await assert.rejects(adapter.invite({ cdk: 'TEAM-123456', email: 'a@example.com', request_id: requestId }), error => {
        assert.equal(error.status, status, name);
        assert.equal(error.code, code, name);
        assert.equal(typeof error.canQuery, 'boolean', name);
        assert.doesNotMatch(error.message, /private|challenge|html/i);
        return true;
      });
      assert.equal(attempts, 1, `${name} request was unexpectedly replayed`);
    }
  });
});

test('Team adapter reports not-configured without any built-in address', async () => {
  let calls = 0;
  const team = createTeamRedeem({ origin: '', fetchImpl: async () => { calls++; return json({}); } });
  await assert.rejects(team.availability(), error => error instanceof PublicError && error.status === 503 && error.code === 'TEAM_NOT_CONFIGURED' && !/https?:/i.test(error.message));
  assert.equal(calls, 0);
  assert.deepEqual({ ...(await team.status()), latencyMs: 0 }, { online: false, latencyMs: 0, cached: false });
});

test('Team adapter strips web addresses from messages passed to the browser', async () => {
  const team = createTeamRedeem({ origin, fetchImpl: async () => json({ detail: '卡密无效，详见 https://secret-upstream.example/help 或 //cdn.example/x' }, 400) });
  await assert.rejects(team.invite({ cdk: 'TEAM-123456', email: 'a@example.com', request_id: requestId }), error => {
    assert.doesNotMatch(error.message, /secret-upstream|cdn\.example|https?:/i);
    assert.match(error.message, /卡密无效/);
    return true;
  });
});

test('ByBuy Team endpoints are same-origin, no-store, and forward only approved public fields', async () => {
  const received = [];
  const teamRedeem = {
    availability: async () => ({ inviteSeatsRemaining: 3, readyAccountsRemaining: 2 }),
    invite: async input => { received.push(input); return { status: 'success' }; },
    ready: async input => { received.push(input); return { status: 'success', account: { email: 'ready@example.test', password: 'temp-pass', totp_secret: 'secret' } }; },
  };
  const app = express();
  app.use('/api', createApi({ teamRedeem, upstream: {}, subscriptions: {} }));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}/api/team`;
  try {
    const stock = await fetch(`${base}/availability`);
    assert.equal(stock.status, 200);
    assert.equal(stock.headers.get('cache-control'), 'no-store');
    assert.deepEqual((await stock.json()).data, { inviteSeatsRemaining: 3, readyAccountsRemaining: 2 });

    const invite = await fetch(`${base}/invite`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cdk: 'TEAM-123456', email: 'a@example.com', request_id: requestId }) });
    assert.equal(invite.status, 200);
    assert.deepEqual((await invite.json()).data, { status: 'success' });

    const ready = await fetch(`${base}/ready`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cdk: 'TEAM-654321', request_id: requestId }) });
    const result = await ready.json();
    assert.equal(ready.status, 200);
    assert.equal(result.data.account.email, 'ready@example.test');
    assert.deepEqual(received, [
      { cdk: 'TEAM-123456', email: 'a@example.com', request_id: requestId },
      { cdk: 'TEAM-654321', request_id: requestId },
    ]);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});

test('service status selects the Team probe only on the Team route', async () => {
  const probes = [];
  const app = express();
  app.use('/api', createApi({
    upstream: { status: async () => { probes.push('chatgpt'); return { online: true, latencyMs: 4 }; } },
    teamRedeem: { status: async () => { probes.push('team'); return { online: true, latencyMs: 5 }; }, availability: async () => ({ inviteSeatsRemaining: 1, readyAccountsRemaining: 1 }) },
    subscriptions: {},
  }));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}/api/service/status`;
  try {
    assert.deepEqual((await (await fetch(`${base}?service=chatgpt`)).json()).data, { online: true, latencyMs: 4 });
    assert.deepEqual((await (await fetch(`${base}?service=team`)).json()).data, { online: true, latencyMs: 5 });
    assert.deepEqual(probes, ['chatgpt', 'team']);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
