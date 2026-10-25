import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import express from 'express';
import { createEligibilityStore } from '../server/eligibility.mjs';
import { createApi } from '../server/api.mjs';
import { createSubscriptionChecker, readSubscriptionInput } from '../server/subscriptions.mjs';
import { credentials, ACCOUNT, TEAM, workspace, REFERENCE_TIME } from './fixtures/subscriptions.mjs';

function report(overrides = {}) {
  return { credentialState: 'accepted', selected: { accountId: ACCOUNT, scope: 'personal', plan: 'free', status: 'free', ...overrides }, checks: [] };
}

test('only an online-confirmed personal Free account receives a verification capability', () => {
  const store = createEligibilityStore();
  for (const overrides of [{ plan: 'plus', status: 'active' }, { plan: 'pro', status: 'inactive' }, { scope: 'workspace' }, { scope: 'unknown' }, { status: 'unknown' }, { accountId: TEAM }]) {
    assert.equal(store.issue(report(overrides), ACCOUNT), null);
  }
  assert.equal(store.issue({ ...report(), credentialState: 'unconfirmed' }, ACCOUNT), null);
  assert.equal(store.issue({ ...report(), checks: [{ code: 'CHECK_SCOPE_MISMATCH' }] }, ACCOUNT), null);
  assert.equal(store.issue({ ...report(), checks: [{ code: 'CREDENTIAL_REJECTED' }] }, ACCOUNT), null);
  const grant = store.issue(report(), ACCOUNT);
  assert.ok(grant.ticket);
  assert.equal(store.require(grant.ticket), ACCOUNT);
  assert.throws(() => store.require(grant.ticket + 'x'));
});

test('eligibility expires without storing the user access token', () => {
  let clock = REFERENCE_TIME;
  const store = createEligibilityStore({ now: () => clock, lifetimeMs: 1000 });
  const grant = store.issue(report(), ACCOUNT);
  assert.equal(store.require(grant.ticket), ACCOUNT);
  clock += 1000;
  assert.throws(() => store.require(grant.ticket), error => error.code === 'SUBSCRIPTION_CHECK_REQUIRED');
});

test('a submission capability is bound to the verified card and account and can be claimed once', () => {
  const store = createEligibilityStore();
  const grant = store.issue(report(), ACCOUNT);
  assert.throws(() => store.claimSubmission(grant.ticket, 'DEMO-CARD-123456', ACCOUNT), error => error.code === 'CARD_VERIFICATION_REQUIRED');
  store.markCardVerified(grant.ticket, 'DEMO-CARD-123456');
  assert.throws(() => store.claimSubmission(grant.ticket, 'OTHER-CARD-123456', ACCOUNT), error => error.code === 'CARD_VERIFICATION_REQUIRED');
  assert.throws(() => store.claimSubmission(grant.ticket, 'DEMO-CARD-123456', TEAM), error => error.code === 'SESSION_ACCOUNT_MISMATCH');
  assert.equal(store.claimSubmission(grant.ticket, 'DEMO-CARD-123456', ACCOUNT), ACCOUNT);
  assert.throws(() => store.claimSubmission(grant.ticket, 'DEMO-CARD-123456', ACCOUNT), error => error.code === 'SUBMISSION_ALREADY_ATTEMPTED');
});

test('Free workspace does not become a personal account merely because its plan is Free', async () => {
  const body = { accounts: { [ACCOUNT]: workspace(ACCOUNT, 'free', false, null) } };
  body.accounts[ACCOUNT].account.structure = 'team';
  const checker = createSubscriptionChecker({ now: () => REFERENCE_TIME, fetchImpl: async url => new Response(JSON.stringify(new URL(url).pathname.includes('accounts/check') ? body : { plan_type: 'free' }), { headers: { 'content-type': 'application/json' } }) });
  const result = await checker.check(readSubscriptionInput({ accessToken: credentials().access_token }, REFERENCE_TIME));
  assert.equal(result.selected.scope, 'workspace');
  assert.equal(createEligibilityStore().issue(result, ACCOUNT), null);
});

test('missing scope cannot unlock card verification', async () => {
  const body = { accounts: { [ACCOUNT]: workspace(ACCOUNT, 'free', false, null) } };
  delete body.accounts[ACCOUNT].account.structure;
  const checker = createSubscriptionChecker({ now: () => REFERENCE_TIME, fetchImpl: async () => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } }) });
  const result = await checker.check(readSubscriptionInput({ accessToken: credentials({ plan: 'free' }).access_token }, REFERENCE_TIME));
  assert.equal(result.selected.scope, 'unknown');
  assert.equal(createEligibilityStore().issue(result, ACCOUNT), null);
});

test('verification cannot be bypassed by calling the API; order lookup remains independent', async () => {
  let verified = 0;
  const app = express();
  app.use('/api', createApi({ upstream: { verify: async () => { verified++; return { kind: 'card', valid: true }; }, query: async () => ({ kind: 'order', status: 'COMPLETED' }) }, subscriptions: { check: async () => report() } }));
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body, ticket) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(ticket ? { 'X-ByBuy-Eligibility': ticket } : {}) }, body: JSON.stringify(body) });
  try {
    const card = { code: 'DEMO-TEST-CARD' };
    assert.equal((await post('/api/cards/verify', card)).status, 403);
    assert.equal((await post('/api/cards/verify', card, 'fabricated-ticket')).status, 403);
    assert.equal(verified, 0);
    assert.equal((await post('/api/orders/query', card)).status, 200);
    const check = await (await post('/api/subscriptions/check', { accessToken: credentials({ now: Date.now() }).access_token })).json();
    assert.ok(check.data.eligibility.ticket);
    assert.equal((await post('/api/cards/verify', card, check.data.eligibility.ticket)).status, 200);
    assert.equal(verified, 1);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
