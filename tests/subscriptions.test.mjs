import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { once } from 'node:events';
import { parseSubscriptionInput, downloadableReport, isoTime, planLabel } from '../shared/subscription.ts';
import { createSubscriptionChecker, readSubscriptionInput } from '../server/subscriptions.mjs';
import { createApi } from '../server/api.mjs';
import { createEligibilityStore } from '../server/eligibility.mjs';
import { ACCOUNT, AUTH, ORGANIZATION, TEAM, REFERENCE_TIME, authFile, credentials, jwt, sessionFile, sub2apiFile, workspace } from './fixtures/subscriptions.mjs';

const parse = value => parseSubscriptionInput(JSON.stringify(value), REFERENCE_TIME);
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
const requestInput = (accountId = ACCOUNT, plan = 'plus') => readSubscriptionInput({ accessToken: credentials({ plan }).access_token, accountId }, REFERENCE_TIME);

test('original auth.json retains independent clocks and never invents the external export expiry', () => {
  const [account] = parse(authFile());
  const report = account.report;
  assert.equal(report.format, 'codex');
  assert.equal(report.observedPlan, 'plus');
  assert.equal(report.signature, 'not_verified');
  assert.equal(report.lastRefresh, '2026-10-10T13:36:47.000Z');
  assert.equal(report.access.timeState, 'within_lifetime');
  assert.equal(report.id.timeState, 'expired');
  assert.equal(account.onlineBlockedReason, null);
  assert.equal(report.evidence.find(e => e.field === 'periodEnd').value, '2026-09-30T12:52:44.000Z');
  assert.equal(report.evidence.find(e => e.field === 'subscriptionCheckedAt').value, '2026-09-13T03:26:39.418Z');
  assert.ok(report.findings.some(f => f.code === 'SUBSCRIPTION_SNAPSHOT_OLD'));
  assert.equal(report.findings.some(f => f.code === 'SUBSCRIPTION_DATES_DIFFER'), false);
  assert.doesNotMatch(JSON.stringify(report), /2026-10-30/);
});

test('Sub2API metadata dates remain separate, and proxy/priority/refresh credentials never enter reports', () => {
  const input = sub2apiFile();
  const [account] = parse(input);
  assert.equal(account.report.format, 'sub2api');
  assert.ok(account.report.findings.some(f => f.code === 'SUBSCRIPTION_DATES_DIFFER'));
  const endDates = account.report.evidence.filter(e => e.field === 'periodEnd');
  assert.equal(endDates.length, 2);
  assert.equal(endDates.find(e => e.source === 'import').checkedAt, null);
  assert.equal(account.report.exportedAt, '2026-10-11T07:04:21.000Z');
  const serialized = JSON.stringify(downloadableReport(account.report, null));
  for (const secret of [input.accounts[0].credentials.access_token, input.accounts[0].credentials.id_token, input.accounts[0].credentials.refresh_token, 'sample@example.test', ACCOUNT, 'never-use.example', 'concurrency', 'priority']) {
    assert.equal(serialized.includes(secret), false);
  }
});

test('Session Free is a current-snapshot label only, and Google login is not a billing channel', () => {
  const report = parse(sessionFile())[0].report;
  assert.equal(report.observedPlan, 'free');
  assert.equal(report.scope, 'personal');
  assert.equal(report.loginMethod, 'Google 登录');
  assert.equal(report.billing.channel, 'unknown');
  assert.equal(report.billing.history, 'unknown');
  assert.equal(report.billing.paymentIntegrity, 'not_assessable');
  assert.equal(report.evidence.some(e => e.field === 'periodEnd'), false);
  assert.doesNotMatch(JSON.stringify(report), /2027-01-09/);
});

test('full Session exports may contain auxiliary metadata without retaining non-access credentials', () => {
  const file = sessionFile();
  file.WARNING_BANNER = 'SYNTHETIC_WARNING';
  file.marketingEligibility = { segment: 'test' };
  file.statsigContext = { locale: 'zh-CN', deviceId: 'synthetic-device' };
  file.sessionToken = 'SYNTHETIC_SESSION_'.repeat(300);
  const [account] = parse(file);
  assert.equal(account.report.format, 'session');
  assert.equal(account.report.observedPlan, 'free');
  assert.equal(account.onlineBlockedReason, null);
  assert.doesNotMatch(JSON.stringify(account), /SYNTHETIC_SESSION_|synthetic-device|SYNTHETIC_WARNING/);
});

test('unknown or absent plans never become Free; raw unfamiliar identifiers remain visible', () => {
  const missing = parse({ account: { id: ACCOUNT, structure: 'personal' } })[0];
  assert.equal(missing.report.observedPlan, null);
  assert.ok(missing.onlineBlockedReason);
  const future = parse(authFile({ plan: 'future_plan' }))[0];
  assert.equal(future.report.observedPlan, 'future_plan');
  assert.match(planLabel('future_plan'), /未识别套餐/);
  assert.equal(planLabel('constructor'), '未识别套餐（constructor）');
});

test('different identity, user or plan records block merging instead of voting', () => {
  const mismatched = parse(authFile({ idAccount: 'another-personal-account' }))[0];
  assert.equal(mismatched.report.identityConsistent, false);
  assert.equal(mismatched.report.observedPlan, null);
  assert.ok(mismatched.onlineBlockedReason);
  const exportFile = sub2apiFile(); exportFile.accounts[0].credentials.plan_type = 'pro';
  const differing = parse(exportFile)[0];
  assert.equal(differing.report.observedPlan, null);
  assert.ok(differing.report.findings.some(f => f.code === 'PLAN_RECORDS_DIFFER'));
});

test('expired access blocks online checking while an expired ID token alone does not', () => {
  const [account] = parse(authFile({ accessExp: 1791643003 }));
  assert.ok(account.onlineBlockedReason);
  assert.equal(account.report.observedPlan, 'plus');
  assert.equal(account.report.access.timeState, 'expired');
  assert.equal(parse(authFile())[0].onlineBlockedReason, null);
});

test('malformed, oversized and unsupported input yields safe errors without echoing credentials', () => {
  for (const raw of ['', '{PRIVATE_SECRET', 'null', '[]', '{}', JSON.stringify({ OPENAI_API_KEY: 'not-an-oauth-account' }), 'a'.repeat(1024 * 1024 + 1)]) {
    assert.throws(() => parseSubscriptionInput(raw), error => !error.message.includes('PRIVATE_SECRET'));
  }
  assert.throws(() => parse({ accounts: [] }));
  assert.throws(() => parse({ accounts: Array(31).fill(sub2apiFile().accounts[0]) }));
  assert.throws(() => parse({ accounts: [{ platform: 'other', credentials: {} }] }));
  assert.equal(parseSubscriptionInput('\uFEFF' + JSON.stringify(authFile()), REFERENCE_TIME).length, 1);
});

test('timezone-equivalent dates do not cause a false conflict; missing timezone is not guessed', () => {
  const file = sub2apiFile();
  file.accounts[0].credentials.subscription_expires_at = '2026-09-30T20:52:44+08:00';
  assert.equal(parse(file)[0].report.findings.some(f => f.code === 'SUBSCRIPTION_DATES_DIFFER'), false);
  assert.equal(isoTime('2026-10-30T18:52:44'), null);
  assert.equal(isoTime('2026-02-30T18:52:44Z'), null);
});

test('multiple accounts are kept separate and reports strip online account IDs too', () => {
  const file = sub2apiFile(); file.accounts.push({ platform: 'openai', credentials: credentials({ plan: 'free' }) });
  const results = parse(file);
  assert.equal(results.length, 2);
  assert.notEqual(results[0].key, results[1].key);
  assert.equal(results[1].report.observedPlan, 'free');
  const online = { selected: { accountId: ACCOUNT, accountMasked: '•••• ccount', status: 'active' }, workspaces: [{ accountId: TEAM, accountMasked: '•••• kspace' }], checks: [] };
  const exported = downloadableReport(results[0].report, online);
  assert.equal('accountId' in exported.online.selected, false);
  assert.equal('accountId' in exported.online.workspaces[0], false);
});

test('online requests are fixed read-only ChatGPT calls and ignore unrelated response fields', async () => {
  const calls = [];
  const personal = workspace(ACCOUNT, 'plus', true, '2026-10-30T18:52:44Z');
  personal.entitlement.will_renew = false;
  personal.amount = 'untrusted';
  personal.message = 'advertisement.example';
  const checker = createSubscriptionChecker({ now: () => REFERENCE_TIME, fetchImpl: async (url, init) => {
    const target = new URL(url); calls.push(target);
    assert.equal(target.origin, 'https://chatgpt.com');
    assert.ok(target.pathname.includes('accounts/check'));
    assert.equal(init.method, 'GET');
    assert.equal(init.redirect, 'error');
    assert.equal(init.body, undefined);
    assert.equal(init.headers.Authorization, `Bearer ${credentials().access_token}`);
    return json({ accounts: { [ACCOUNT]: personal, [ORGANIZATION]: workspace(ORGANIZATION, 'business', true, '2027-03-01T00:00:00Z'), default: ACCOUNT } });
  } });
  const result = await checker.check(requestInput());
  assert.equal(result.selected.plan, 'plus');
  assert.equal(result.selected.status, 'active');
  assert.equal(result.selected.willRenew, false);
  assert.equal(result.selected.periodEnd, '2026-10-30T18:52:44.000Z');
  assert.equal(result.workspaces.find(item => item.accountId === ORGANIZATION).plan, 'business');
  assert.equal(result.credentialState, 'accepted');
  assert.equal(calls.length, 1);
  assert.doesNotMatch(JSON.stringify(result), /untrusted|advertisement|Bearer|synthetic_signature/);
});

test('personal Free and team Business stay separate, and requested workspace must be accessible', async () => {
  const calls = [];
  const checker = createSubscriptionChecker({ now: () => REFERENCE_TIME, fetchImpl: async url => {
    const target = new URL(url); calls.push(target);
    assert.ok(target.pathname.includes('accounts/check'));
    return json({ accounts: { [ACCOUNT]: workspace(ACCOUNT, 'free', false, null), [TEAM]: workspace(TEAM, 'business'), default: ACCOUNT } });
  } });
  const personal = await checker.check(requestInput());
  assert.equal(personal.selected.status, 'free');
  assert.equal(personal.workspaces.find(w => w.accountId === TEAM).status, 'active');
  const team = await checker.check(requestInput(TEAM));
  assert.equal(team.selected.plan, 'business');
  const count = calls.length;
  const invalid = await checker.check(requestInput('unknown-account'));
  assert.equal(invalid.selected, null);
  assert.equal(calls.length, count + 1);
  assert.equal(invalid.checks.at(-1).code, 'WORKSPACE_NOT_ACCESSIBLE');
});

test('unknown, malformed and inaccessible account records never confirm membership', async () => {
  const unknown = await createSubscriptionChecker({ now: () => REFERENCE_TIME, fetchImpl: async () => json({ accounts: { [ACCOUNT]: workspace(ACCOUNT, 'new-plan', null, null) } }) }).check(requestInput());
  assert.equal(unknown.selected.status, 'unknown');
  assert.equal(createEligibilityStore().issue(unknown, ACCOUNT), null);

  const malformed = await createSubscriptionChecker({ now: () => REFERENCE_TIME, fetchImpl: async () => json({ accounts: { [ACCOUNT]: { account: { account_id: ACCOUNT } } } }) }).check(requestInput());
  assert.equal(malformed.selected, null);
  assert.equal(malformed.checks[0].code, 'CHECK_RESPONSE_UNKNOWN');

  const inaccessible = await createSubscriptionChecker({ now: () => REFERENCE_TIME, fetchImpl: async () => json({ accounts: { [TEAM]: workspace(TEAM, 'business') } }) }).check(requestInput());
  assert.equal(inaccessible.credentialState, 'accepted');
  assert.equal(inaccessible.selected, null);
  assert.equal(inaccessible.checks[0].code, 'WORKSPACE_NOT_ACCESSIBLE');
});

test('conflicting duplicate account records yield an explicit unknown outcome', async () => {
  const checker = createSubscriptionChecker({ now: () => REFERENCE_TIME, fetchImpl: async () => json({ accounts: [
    workspace(ACCOUNT, 'free', false, null),
    workspace(ACCOUNT, 'plus', true, '2026-10-30T18:52:44Z'),
  ] }) });
  const result = await checker.check(requestInput());
  assert.equal(result.selected.status, 'unknown');
  assert.equal(result.selected.plan, null);
  assert.equal(result.workspaceCoverage, 'partial');
  assert.equal(createEligibilityStore().issue(result, ACCOUNT), null);
});

test('expired personal paid records become current Free, while a future paid period remains active', async () => {
  for (const [end, plan, state] of [['2026-09-30T12:52:44Z', 'free', 'free'], ['2026-10-30T12:52:44Z', 'plus', 'active']]) {
    const checker = createSubscriptionChecker({ now: () => REFERENCE_TIME, fetchImpl: async () => json({ accounts: {
      [ACCOUNT]: workspace(ACCOUNT, 'plus', state === 'active', end),
    } }) });
    const result = await checker.check(requestInput());
    assert.equal(result.selected.plan, plan);
    assert.equal(result.selected.status, state);
    assert.equal(result.workspaceCoverage, 'complete');
    if (state === 'free') assert.ok(createEligibilityStore().issue(result, ACCOUNT));
  }
});

test('a current Free token never overrides an online active Plus record', async () => {
  for (const [end, active, expectedPlan, expectedStatus] of [
    ['2026-09-30T12:52:44Z', false, 'free', 'free'],
    ['2026-10-30T12:52:44Z', true, 'plus', 'active'],
  ]) {
    const checker = createSubscriptionChecker({ now: () => REFERENCE_TIME, fetchImpl: async () => json({ accounts: {
      [ACCOUNT]: workspace(ACCOUNT, 'plus', active, end),
    } }) });
    const result = await checker.check(requestInput(ACCOUNT, 'free'));
    assert.equal(result.selected.plan, expectedPlan);
    assert.equal(result.selected.status, expectedStatus);
    if (expectedStatus === 'free') assert.ok(createEligibilityStore().issue(result, ACCOUNT));
  }
});

test('an explicitly inactive personal Plus workspace is current Free, but inactive Business stays a workspace plan', async () => {
  const checker = createSubscriptionChecker({ now: () => REFERENCE_TIME, fetchImpl: async () => json({ accounts: {
    [ACCOUNT]: workspace(ACCOUNT, 'plus', false, '2026-09-30T12:52:44Z'),
    [TEAM]: workspace(TEAM, 'business', false, '2026-09-30T12:52:44Z'),
  } }) });
  const personal = await checker.check(requestInput());
  assert.equal(personal.selected.plan, 'free');
  assert.equal(personal.selected.status, 'free');
  assert.equal(personal.selected.scope, 'personal');
  const team = await checker.check(requestInput(TEAM));
  assert.equal(team.selected.plan, 'business');
  assert.equal(team.selected.status, 'inactive');
  assert.equal(team.selected.scope, 'workspace');
});

test('duplicate account dates are not resolved by blindly choosing the larger date', async () => {
  const checker = createSubscriptionChecker({ now: () => REFERENCE_TIME, fetchImpl: async () => json({ accounts: [
    workspace(ACCOUNT, 'plus', true, '2026-11-30T12:00:00Z'),
    workspace(ACCOUNT, 'plus', true, '2026-10-30T12:00:00Z'),
  ] }) });
  const result = await checker.check(requestInput());
  assert.equal(result.selected.status, 'unknown');
  assert.equal(result.selected.plan, null);
  assert.equal(result.selected.periodEnd, null);
  assert.equal(result.workspaceCoverage, 'partial');
});

test('a transient account-check failure is retried and still issues a Free-account capability', async () => {
  let attempts = 0;
  const checker = createSubscriptionChecker({ now: () => REFERENCE_TIME, fetchImpl: async url => {
    assert.ok(new URL(url).pathname.includes('accounts/check'));
    attempts++;
    return attempts === 1 ? json({}, 503) : json({ accounts: { [ACCOUNT]: workspace(ACCOUNT, 'free', false, null) } });
  } });
  const result = await checker.check(requestInput(ACCOUNT, 'free'));
  assert.equal(attempts, 2);
  assert.equal(result.selected.plan, 'free');
  assert.equal(result.selected.status, 'free');
  assert.deepEqual(result.checks.map(check => [check.source, check.code]), [['live_workspace', 'OK']]);
  assert.ok(createEligibilityStore().issue(result, ACCOUNT));
});

test('network, challenge, 401, 403, 429, invalid JSON and oversized responses remain unknown', async t => {
  const cases = [
    ['401', () => json({ secret: 'do-not-leak' }, 401), 'CREDENTIAL_REJECTED', 1],
    ['403', () => json({}, 403), 'ACCESS_RESTRICTED', 1],
    ['408', () => json({}, 408), 'CHECK_UNAVAILABLE', 2],
    ['429', () => json({}, 429), 'CHECK_RATE_LIMITED', 1],
    ['500', () => json({}, 500), 'CHECK_UNAVAILABLE', 2],
    ['html', () => new Response('<script>do-not-leak</script>', { headers: { 'content-type': 'text/html' } }), 'CHECK_RESPONSE_UNKNOWN', 1],
    ['invalid-json', () => new Response('{do-not-leak', { headers: { 'content-type': 'application/json' } }), 'CHECK_RESPONSE_UNKNOWN', 1],
    ['too-large', () => json({ private: 'x'.repeat(600_000) }), 'CHECK_RESPONSE_UNKNOWN', 1],
    ['network', () => { throw new Error('do-not-leak'); }, 'CHECK_UNAVAILABLE', 2],
    ['timeout', () => { throw new DOMException('do-not-leak', 'TimeoutError'); }, 'CHECK_TIMEOUT', 2],
  ];
  for (const [name, fetchImpl, code, expectedAttempts] of cases) await t.test(name, async () => {
    let attempts = 0;
    const result = await createSubscriptionChecker({ now: () => REFERENCE_TIME, fetchImpl: (...args) => { attempts++; return fetchImpl(...args); } }).check(requestInput());
    assert.equal(result.selected, null);
    assert.equal(result.workspaceCoverage, 'unavailable');
    assert.equal(result.checks[0].code, code);
    assert.equal(result.credentialState, code === 'CREDENTIAL_REJECTED' ? 'rejected' : 'unconfirmed');
    assert.equal(attempts, expectedAttempts);
    assert.doesNotMatch(JSON.stringify(result), /do-not-leak|synthetic_signature/);
  });
});

test('invalid credentials, added refresh tokens and client-controlled URLs are refused before network access', () => {
  const valid = { accessToken: credentials().access_token, accountId: ACCOUNT };
  for (const input of [null, {}, { ...valid, refreshToken: 'must-not-send' }, { ...valid, url: 'http://127.0.0.1' }, { ...valid, accountId: 'https://evil.example' }, { accessToken: 'bad' }, { accessToken: credentials({ accessExp: 1791643003 }).access_token }]) {
    assert.throws(() => readSubscriptionInput(input, REFERENCE_TIME));
  }
  const badIssuer = jwt({ iss: 'https://evil.example', exp: 1792503403, aud: ['https://api.openai.com/v1'], [AUTH]: { chatgpt_account_id: ACCOUNT } });
  assert.throws(() => readSubscriptionInput({ accessToken: badIssuer }, REFERENCE_TIME));
});

test('subscription API accepts a JWT larger than the card limit and only returns safe result fields', async () => {
  let observed;
  const subscriptions = { check: async input => { observed = input; return { checkedAt: '2026-10-11T07:04:21Z', selected: null, checks: [], workspaces: [] }; } };
  const upstream = { status: async () => ({ online: true, latencyMs: 0, cached: true }), verify: async () => ({}), query: async () => ({}) };
  const app = express(); app.use('/api', createApi({ subscriptions, upstream }));
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}/api/subscriptions/check`;
  try {
    const token = jwt({ iss: 'https://auth.openai.com', aud: ['https://api.openai.com/v1'], exp: Math.floor(Date.now() / 1000) + 3600, padding: 'x'.repeat(4500), [AUTH]: { chatgpt_account_id: ACCOUNT } });
    const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ accessToken: token }) });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(observed.accessToken, token);
    assert.equal(observed.accountId, ACCOUNT);
    assert.doesNotMatch(await response.text(), /synthetic_signature|accessToken/);
    const foreign = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://foreign.example' }, body: JSON.stringify({ accessToken: token }) });
    assert.equal(foreign.status, 403);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
