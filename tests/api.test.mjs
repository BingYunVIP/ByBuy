import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import express from 'express';
import { createApi } from '../server/api.mjs';
import { createUpstream } from '../server/upstream.mjs';
import { credentials, sessionFile, ACCOUNT } from './fixtures/subscriptions.mjs';

const card = 'DEMO-CARD-123456';
const serviceOrigin = 'https://service.example';
const browserLeak = /remote-provider\.invalid|upstream|上游/i;
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const order = {
  status: 'COMPLETED', plan: 'plus', orderNo: 'DEMO-ORDER-123456', accountEmail: 'private@example.test',
  createdAt: '2026-10-10T12:00:00', processingAt: '2026-10-10T12:00:01', completedAt: '2026-10-10T12:00:10',
  contact: 'private-contact', queryToken: 'private-query-token', sessionJson: 'private-session',
  customerMessage: '<a href="https://remote-provider.invalid">上游 advertisement</a>',
};

async function withApi(options, callback) {
  const app = express();
  app.use('/api', createApi({ subscriptions: { check: async () => ({ credentialState: 'accepted', selected: { accountId: ACCOUNT, scope: 'personal', plan: 'free', status: 'free' }, checks: [] }) }, ...options }));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  let ticket;
  const request = (path, body = { code: card }, extra = {}) => fetch(`${origin}${path}`, {
    method: 'POST', body: JSON.stringify(body), ...extra,
    headers: { 'content-type': 'application/json', ...(ticket ? { 'X-ByBuy-Eligibility': ticket } : {}), ...extra.headers },
  });
  const authorize = async () => {
    const response = await request('/api/subscriptions/check', { accessToken: credentials({ now: Date.now() }).access_token });
    const body = await response.json(); ticket = body.data.eligibility.ticket; return ticket;
  };
  try { await callback({ request, origin, authorize }); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}

test('query forwards only the normalized card to the fixed service path and strips sensitive/untrusted fields', async () => {
  let calls = 0;
  const upstream = createUpstream({ origin: serviceOrigin, fetchImpl: async (url, init) => {
    calls++;
    assert.equal(url.href, 'https://service.example/api/public/orders/query-by-card');
    assert.deepEqual(JSON.parse(init.body), { code: card });
    assert.equal(init.redirect, 'error');
    assert.ok(init.signal instanceof AbortSignal);
    return json({ code: 'OK', data: { ...order, verification: {
      mode: 'stripe', publishableKey: 'pk_test_query12345', clientSecret: 'seti_query_secret_12345', expiresAt: '2027-01-01T00:00:00Z', privateField: 'never-forward',
    } } });
  } });
  await withApi({ upstream }, async ({ request }) => {
    const response = await request('/api/orders/query', { code: ` ${card.toLowerCase()} ` });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.ok(response.headers.get('x-request-id'));
    const result = await response.json();
    assert.equal(result.data.status, 'COMPLETED');
    assert.equal(result.data.plan, 'ChatGPT Plus');
    assert.equal(result.data.accountMasked, 'p***@e***.test');
    assert.equal(result.data.orderNoMasked, '•••• 123456');
    assert.equal(result.data.completedAt, order.completedAt);
    assert.deepEqual(result.data.verification, { mode: 'stripe', publishableKey: 'pk_test_query12345', clientSecret: 'seti_query_secret_12345', expiresAt: '2027-01-01T00:00:00Z' });
    assert.equal(result.data.requiresVerification, true);
    const serialized = JSON.stringify(result);
    assert.doesNotMatch(serialized, browserLeak);
    for (const forbidden of [card, order.orderNo, order.accountEmail, order.contact, order.queryToken, order.sessionJson, order.customerMessage, 'advertisement.example', 'never-forward']) {
      assert.equal(serialized.includes(forbidden), false);
    }
    assert.equal(calls, 1);
  });
});

test('used/invalid card is a business error, with a safe message and lookup action', async () => {
  const upstream = createUpstream({ origin: serviceOrigin, fetchImpl: async () => json({ code: 'INVALID_CARD', message: 'Visit https://remote-provider.invalid 上游广告' }, 400) });
  await withApi({ upstream }, async ({ request, authorize }) => {
    await authorize();
    const response = await request('/api/cards/verify');
    const result = await response.json();
    assert.equal(response.status, 400);
    assert.equal(result.error.code, 'INVALID_CARD');
    assert.equal(result.error.canQuery, true);
    assert.match(result.error.message, /无效或已使用/);
    assert.doesNotMatch(JSON.stringify(result), /advertisement/);
    assert.doesNotMatch(JSON.stringify(result), browserLeak);
  });
});

test('valid card response exposes only the supported preview fields', async () => {
  const upstream = createUpstream({ origin: serviceOrigin, fetchImpl: async url => {
    assert.equal(url.pathname, '/api/public/cards/verify');
    return json({ code: 'OK', data: { plan: 'plus', secret: 'never-forward', url: 'https://ad.example' } });
  } });
  await withApi({ upstream }, async ({ request, authorize }) => {
    await authorize();
    const result = await (await request('/api/cards/verify')).json();
    assert.deepEqual(result.data, { kind: 'card', valid: true, plan: 'ChatGPT Plus', status: 'AVAILABLE' });
  });
});

test('submission uses the public order API, returns only safe fields, and diagnostics redact credentials', async () => {
  const logs = [];
  const sessionJson = JSON.stringify(sessionFile());
  const upstream = createUpstream({
    origin: serviceOrigin,
    diagnostics: true,
    log: { info: value => logs.push(value) },
    fetchImpl: async (url, init) => {
      assert.equal(url.pathname, '/api/public/orders');
      assert.deepEqual(JSON.parse(init.body), { code: card, sessionJson, contact: '' });
      return json({ code: 'OK', data: {
        ...order,
        status: 'PENDING',
        accountEmail: 'sample@example.test',
        verification: { mode: 'stripe', publishableKey: 'pk_test_demo12345', clientSecret: 'seti_demo_secret_12345', expiresAt: '2027-01-01T00:00:00Z' },
      } });
    },
  });
  const result = await upstream.submit({ code: card, sessionJson, contact: '', accountEmail: 'sample@example.test' });
  assert.equal(result.status, 'PENDING');
  assert.equal(result.accountMasked, 's***@e***.test');
  assert.deepEqual(result.verification, { mode: 'stripe', publishableKey: 'pk_test_demo12345', clientSecret: 'seti_demo_secret_12345', expiresAt: '2027-01-01T00:00:00Z' });
  const serialized = JSON.stringify(result);
  for (const secret of [card, sessionJson, order.orderNo, order.queryToken, order.customerMessage]) assert.equal(serialized.includes(secret), false);
  assert.ok(logs.some(line => line.includes('action=submit') && line.includes('status=200')));
  assert.doesNotMatch(logs.join('\n'), /DEMO-CARD|sessionToken|synthetic_signature|sample@example/);
});

test('ambiguous submission reconciles by card and matching account without creating a second order', async () => {
  const paths = [];
  const upstream = createUpstream({
    origin: serviceOrigin,
    reconcileDelayMs: 0,
    fetchImpl: async url => {
      paths.push(url.pathname);
      if (url.pathname === '/api/public/orders') throw new TypeError('connection closed after send');
      return json({ code: 'OK', data: { ...order, status: 'PROCESSING', accountEmail: 'sample@example.test' } });
    },
  });
  const result = await upstream.submit({ code: card, sessionJson: '{"private":true}', contact: '', accountEmail: 'sample@example.test' });
  assert.equal(result.status, 'PROCESSING');
  assert.deepEqual(paths, ['/api/public/orders', '/api/public/orders/query-by-card']);
});

test('ByBuy submit route requires the same verified card and Session account, then blocks duplicates', async () => {
  const rawSession = JSON.stringify(sessionFile());
  let submitted;
  const upstream = {
    verify: async () => ({ kind: 'card', valid: true, plan: 'ChatGPT Plus', status: 'AVAILABLE' }),
    submit: async input => {
      submitted = input;
      return { kind: 'order', status: 'PENDING', plan: 'ChatGPT Plus', orderNoMasked: '•••• 123456', accountMasked: 's***@e***.test', createdAt: null, processingAt: null, completedAt: null, updatedAt: null, requiresVerification: false, verification: null };
    },
    query: async () => ({ kind: 'order', status: 'PENDING' }),
  };
  await withApi({ upstream }, async ({ request, authorize }) => {
    await authorize();
    const payload = { code: card, sessionJson: rawSession, contact: '' };
    const beforeVerify = await request('/api/orders/submit', payload);
    assert.equal(beforeVerify.status, 403);
    assert.equal((await beforeVerify.json()).error.code, 'CARD_VERIFICATION_REQUIRED');

    assert.equal((await request('/api/cards/verify')).status, 200);
    const response = await request('/api/orders/submit', payload);
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.data.status, 'PENDING');
    assert.equal(submitted.code, card);
    assert.equal(submitted.sessionJson, rawSession);
    assert.equal(submitted.accountId, ACCOUNT);
    assert.equal(submitted.accountEmail, 'sample@example.test');
    assert.doesNotMatch(JSON.stringify(result), /sessionToken|synthetic_signature|DEMO-CARD/);

    const duplicate = await request('/api/orders/submit', payload);
    assert.equal(duplicate.status, 409);
    assert.equal((await duplicate.json()).error.code, 'SUBMISSION_ALREADY_ATTEMPTED');
  });
});

test('bad input, oversized bodies, malformed JSON and foreign origins never reach upstream', async () => {
  let calls = 0;
  const upstream = { verify() { calls++; }, query() { calls++; } };
  await withApi({ upstream }, async ({ request }) => {
    for (const body of [{}, { code: 123 }, { code: 'x' }, { code: 'https://evil.test' }, { code: card, url: 'https://evil.test' }, [card]]) {
      assert.equal((await request('/api/cards/verify', body)).status, 400);
    }
    assert.equal((await request('/api/cards/verify', { code: 'A'.repeat(5000) })).status, 413);
    assert.equal((await request('/api/cards/verify', {}, { body: '{broken' })).status, 400);
    assert.equal((await request('/api/cards/verify', {}, { headers: { 'content-type': 'text/plain' } })).status, 415);
    assert.equal((await request('/api/cards/verify', { code: card }, { headers: { 'content-type': 'application/json', origin: 'https://foreign.example' } })).status, 403);
    assert.equal(calls, 0);
  });
});

test('local health reports submit capability, while no generic proxy endpoints exist', async () => {
  let calls = 0;
  const upstream = { verify() { calls++; }, query() { calls++; } };
  await withApi({ upstream }, async ({ request, origin }) => {
    const response = await fetch(`${origin}/api/health`);
    const result = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(result.data.capabilities, ['verify', 'submit', 'query', 'subscription-check']);
    assert.equal(result.data.mode, 'preview');
    for (const route of ['/api/orders', '/api/proxy', '/api/unknown']) assert.equal((await request(route)).status, 404);
    assert.equal(calls, 0);
  });
});

test('same-origin JSON requests work and cross-site browser requests are refused', async () => {
  const upstream = { verify: async () => ({ kind: 'card', valid: true }) };
  await withApi({ upstream, publicOrigin: 'https://buy.bingyun.vip' }, async ({ request, origin, authorize }) => {
    await authorize();
    assert.equal((await request('/api/cards/verify', { code: card }, { headers: { 'content-type': 'application/json', origin } })).status, 200);
    assert.equal((await request('/api/cards/verify', { code: card }, { headers: { 'content-type': 'application/json', origin: 'https://buy.bingyun.vip', 'sec-fetch-site': 'same-origin' } })).status, 200);
    const forbidden = await request('/api/cards/verify', { code: card }, { headers: { 'content-type': 'application/json', origin, 'sec-fetch-site': 'cross-site' } });
    assert.equal(forbidden.status, 403);
    assert.equal(forbidden.headers.get('access-control-allow-origin'), null);
  });
});

test('rate limiting stops excess requests before upstream and includes retry information', async () => {
  let calls = 0;
  const upstream = { query: async () => { calls++; return { valid: true }; } };
  await withApi({ upstream, rateLimit: { limit: 2, now: () => 1000 } }, async ({ request }) => {
    assert.equal((await request('/api/orders/query')).status, 200);
    assert.equal((await request('/api/orders/query')).status, 200);
    const response = await request('/api/orders/query');
    assert.equal(response.status, 429);
    assert.equal(response.headers.get('retry-after'), '60');
    assert.equal(calls, 2);
  });
});

test('network failures, timeouts, challenge pages, rate limits and malformed replies stay safe', async t => {
  const cases = [
    ['network', () => { throw new Error('private connection detail'); }, 502, 'SERVICE_UNAVAILABLE'],
    ['timeout', () => { throw new DOMException('private token', 'TimeoutError'); }, 504, 'SERVICE_TIMEOUT'],
    ['challenge', () => new Response('<script>advertisement</script>', { headers: { 'content-type': 'text/html' } }), 502, 'SERVICE_UNAVAILABLE'],
    ['rate limit', () => json({}, 429), 503, 'SERVICE_BUSY'],
    ['not found', () => json({ code: 'ORDER_NOT_FOUND' }, 404), 404, 'ORDER_NOT_FOUND'],
    ['bad json', () => new Response('{broken', { headers: { 'content-type': 'application/json' } }), 502, 'SERVICE_RESPONSE'],
    ['missing data', () => json({ code: 'OK' }), 502, 'SERVICE_RESPONSE'],
    ['oversized', () => json({ code: 'OK', data: { text: 'a'.repeat(150_000) } }), 502, 'SERVICE_RESPONSE'],
  ];
  for (const [name, fetchImpl, status, code] of cases) await t.test(name, async () => {
    const upstream = createUpstream({ origin: serviceOrigin, fetchImpl });
    await withApi({ upstream }, async ({ request }) => {
      const response = await request('/api/orders/query');
      const result = await response.json();
      assert.equal(response.status, status);
      assert.equal(result.error.code, code);
      assert.doesNotMatch(JSON.stringify(result), /private|advertisement|broken/);
      assert.doesNotMatch(JSON.stringify(result), browserLeak);
      assert.equal(response.headers.get('cache-control'), 'no-store');
    });
  });
});

test('unknown service states and verification secrets are not treated as successful recharge', async () => {
  const upstream = createUpstream({ origin: serviceOrigin, fetchImpl: async () => json({ code: 'OK', data: {
    ...order, status: 'NEW_UNDOCUMENTED_STATE', plan: 'constructor', createdAt: 'bad date', verification: { clientSecret: 'secret-123' },
  } }) });
  const result = await upstream.query(card);
  assert.equal(result.status, 'UNKNOWN');
  assert.equal(result.plan, 'AI 订阅');
  assert.equal(result.createdAt, null);
  assert.equal(result.requiresVerification, false);
  assert.equal(result.verification, null);
  assert.doesNotMatch(JSON.stringify(result), /secret-123/);
});

test('Pro tiers collapse into one Pro label, so cards only ever show Go, Plus or Pro', async () => {
  const cases = [
    ['go', 'ChatGPT Go'], ['GO', 'ChatGPT Go'], ['plus', 'ChatGPT Plus'],
    ['pro', 'ChatGPT Pro'], ['pro5', 'ChatGPT Pro'], ['pro20', 'ChatGPT Pro'], ['PRO25', 'ChatGPT Pro'],
    ['promo', 'AI 订阅'], ['pro-max', 'AI 订阅'], ['constructor', 'AI 订阅'], [null, 'AI 订阅'],
  ];
  for (const [plan, label] of cases) {
    const upstream = createUpstream({ origin: serviceOrigin, fetchImpl: async () => json({ code: 'OK', data: { ...order, plan } }) });
    assert.equal((await upstream.verify(card)).plan, label, `verify ${plan}`);
    assert.equal((await upstream.query(card)).plan, label, `query ${plan}`);
  }
});

test('renewal and Codex point cards are refused when verifying or looking up, never shown as a recharge', async () => {
  const refused = [
    { plan: 'codex', creditQuantity: 500 },
    { plan: 'pro20', cardType: 'PRO20_RENEWAL' },
    { plan: 'plus', renewal: true },
    { plan: 'plus', cardType: 'plus_renewal' },
  ];
  for (const extra of refused) {
    const upstream = createUpstream({ origin: serviceOrigin, fetchImpl: async () => json({ code: 'OK', data: { ...order, ...extra } }) });
    for (const action of ['verify', 'query']) {
      await assert.rejects(() => upstream[action](card), error => error.status === 400 && error.code === 'UNSUPPORTED_CARD' && error.canQuery === false, `${action} ${JSON.stringify(extra)}`);
    }
  }
  const standard = createUpstream({ origin: serviceOrigin, fetchImpl: async () => json({ code: 'OK', data: { ...order, cardType: 'STANDARD', renewal: false } }) });
  assert.equal((await standard.verify(card)).plan, 'ChatGPT Plus');
  assert.equal((await standard.query(card)).status, 'COMPLETED');
});

test('a refused card type is reported to the page and never unlocks submission', async () => {
  const upstream = createUpstream({ origin: serviceOrigin, fetchImpl: async () => json({ code: 'OK', data: { plan: 'codex', creditQuantity: 500 } }) });
  await withApi({ upstream }, async ({ request, authorize }) => {
    await authorize();
    const verify = await request('/api/cards/verify');
    const refused = await verify.json();
    assert.equal(verify.status, 400);
    assert.equal(refused.error.code, 'UNSUPPORTED_CARD');
    assert.doesNotMatch(JSON.stringify(refused), /codex|500|upstream|上游/i);
    const submit = await request('/api/orders/submit', { code: card, sessionJson: JSON.stringify(sessionFile()), contact: '' });
    assert.equal(submit.status, 403);
    assert.equal((await submit.json()).error.code, 'CARD_VERIFICATION_REQUIRED');
  });
});

test('verification progress is forwarded with the fixed event names, the card and nothing else', async () => {
  const seen = [];
  const upstream = createUpstream({ origin: serviceOrigin, fetchImpl: async (url, init) => {
    assert.equal(url.href, 'https://service.example/api/public/orders/events');
    assert.equal(init.redirect, 'error');
    seen.push(JSON.parse(init.body));
    return json({ code: 'OK', message: 'success' });
  } });
  await withApi({ upstream }, async ({ request }) => {
    for (const event of ['shown', 'started', 'succeeded', 'failed']) {
      const response = await request('/api/orders/events', { code: ` ${card.toLowerCase()} `, event });
      assert.equal(response.status, 200, event);
      const result = await response.json();
      assert.deepEqual(result.data, { recorded: true });
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.doesNotMatch(JSON.stringify(result), browserLeak);
    }
  });
  assert.deepEqual(seen, [
    { code: card, eventType: 'CUSTOMER_VERIFICATION_MODAL_SHOWN' },
    { code: card, eventType: 'CUSTOMER_VERIFICATION_STARTED' },
    { code: card, eventType: 'CUSTOMER_VERIFICATION_SUCCEEDED' },
    { code: card, eventType: 'CUSTOMER_VERIFICATION_FAILED' },
  ]);
});

test('an accepted verification event counts as delivered whatever the reply body looks like', async () => {
  for (const reply of [() => new Response(null, { status: 204 }), () => new Response('ok', { status: 200, headers: { 'content-type': 'text/plain' } }), () => json({ code: 'OK', data: null })]) {
    const upstream = createUpstream({ origin: serviceOrigin, fetchImpl: async () => reply() });
    await upstream.recordVerificationEvent(card, 'started');
  }
});

test('verification events reject unknown names, extra fields and bad cards before reaching the service', async () => {
  let calls = 0;
  const upstream = { recordVerificationEvent() { calls++; } };
  await withApi({ upstream }, async ({ request }) => {
    const bodies = [
      {}, { code: card }, { event: 'started' }, { code: 'x', event: 'started' },
      { code: card, event: 'CUSTOMER_VERIFICATION_STARTED' }, { code: card, event: 'constructor' }, { code: card, event: ['started'] },
      { code: card, event: 'started', eventType: 'CUSTOMER_VERIFICATION_STARTED' }, { code: card, event: 'started', orderNo: 'x' }, [card],
    ];
    for (const body of bodies) assert.equal((await request('/api/orders/events', body)).status, 400, JSON.stringify(body));
    assert.equal((await request('/api/orders/events', {}, { headers: { 'content-type': 'text/plain' } })).status, 415);
    assert.equal((await request('/api/orders/events', { code: card, event: 'started' }, { headers: { 'content-type': 'application/json', origin: 'https://foreign.example' } })).status, 403);
    assert.equal(calls, 0);
  });
});

test('event delivery failures are mapped to safe errors and never leak service details', async t => {
  const cases = [
    ['unknown order', () => json({ code: 'NOT_FOUND', message: 'visit https://remote-provider.invalid 上游' }, 400), 404, 'ORDER_NOT_FOUND'],
    ['busy', () => json({}, 429), 503, 'SERVICE_BUSY'],
    ['server error', () => json({}, 500), 502, 'SERVICE_UNAVAILABLE'],
    ['network', () => { throw new Error('private connection detail'); }, 502, 'SERVICE_UNAVAILABLE'],
  ];
  for (const [name, fetchImpl, status, code] of cases) await t.test(name, async () => {
    const upstream = createUpstream({ origin: serviceOrigin, fetchImpl });
    await withApi({ upstream }, async ({ request }) => {
      const response = await request('/api/orders/events', { code: card, event: 'shown' });
      const result = await response.json();
      assert.equal(response.status, status);
      assert.equal(result.error.code, code);
      assert.doesNotMatch(JSON.stringify(result), /private|advertisement|remote-provider/);
      assert.doesNotMatch(JSON.stringify(result), browserLeak);
    });
  });
});

test('an event falls back to the second service address when the first is unreachable', async () => {
  const hosts = [];
  const upstream = createUpstream({ origin: 'https://one.example,https://two.example', fetchImpl: async url => {
    hosts.push(url.host);
    if (url.host === 'one.example') throw new TypeError('connect failed');
    return json({ code: 'OK' });
  } });
  await upstream.recordVerificationEvent(card, 'succeeded');
  assert.deepEqual(hosts, ['one.example', 'two.example']);
});
