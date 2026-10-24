// Entirely synthetic credentials. Never replace these with exported real tokens.
export const REFERENCE_TIME = Date.parse('2026-10-11T07:04:21Z');
export const AUTH = 'https://api.openai.com/auth';
export const PROFILE = 'https://api.openai.com/profile';
export const ACCOUNT = 'test-personal-account';
export const ORGANIZATION = 'org-test-default';
export const TEAM = 'test-business-workspace';

export function jwt(payload, header = { alg: 'RS256', typ: 'JWT' }) {
  return `${Buffer.from(JSON.stringify(header)).toString('base64url')}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.synthetic_signature`;
}
/* Keep the default synthetic access token valid beyond the current development date;
   individual tests that need expiry pass an explicit accessExp. */
export function credentials({ plan = 'plus', idAccount = ACCOUNT, accessExp = 1893456000, now } = {}) {
  const iat = now ? Math.floor(now / 1000) - 100 : 1791639403;
  return {
    access_token: jwt({
      iss: 'https://auth.openai.com', aud: ['https://api.openai.com/v1'], iat, nbf: iat,
      exp: now ? Math.floor(now / 1000) + 3600 : accessExp, sub: 'synthetic-user',
      [AUTH]: { chatgpt_account_id: ACCOUNT, chatgpt_user_id: 'test-user', chatgpt_plan_type: plan, poid: ORGANIZATION },
      [PROFILE]: { email: 'sample@example.test' },
    }),
    id_token: jwt({
      iss: 'https://auth.openai.com', aud: ['test-client'], iat, exp: 1791643003, sub: 'synthetic-user',
      auth_provider: 'passwordless', email: 'sample@example.test',
      [AUTH]: { chatgpt_account_id: idAccount, chatgpt_user_id: 'test-user', chatgpt_plan_type: plan,
        chatgpt_subscription_active_start: '2026-08-30T12:52:44Z',
        chatgpt_subscription_active_until: '2026-09-30T12:52:44Z',
        chatgpt_subscription_last_checked: '2026-09-13T03:26:39.418066Z',
        organizations: [{ id: ORGANIZATION, title: 'Personal', role: 'owner' }],
      },
    }),
    refresh_token: 'SYNTHETIC_REFRESH_MUST_NOT_LEAVE_BROWSER',
    account_id: ACCOUNT,
  };
}
export function authFile(options = {}) {
  return { OPENAI_API_KEY: null, tokens: credentials(options), last_refresh: '2026-10-10T13:36:47Z', type: 'codex' };
}
export function sub2apiFile(options = {}) {
  return { type: 'sub2api-data', version: 1, exported_at: '2026-10-11T07:04:21Z', proxies: [{ url: 'https://never-use.example' }], accounts: [{
    name: 'sample@example.test', platform: 'openai', type: 'oauth', concurrency: 3, priority: 50,
    credentials: { ...credentials(options), chatgpt_account_id: ACCOUNT, plan_type: options.plan ?? 'plus', subscription_expires_at: '2026-10-30T18:52:44Z', expires_at: '2026-10-20T13:36:43Z' },
  }] };
}
export function sessionFile() {
  return { accessToken: credentials({ plan: 'free' }).access_token,
    account: { id: ACCOUNT, planType: 'free', structure: 'personal', isDelinquent: false },
    user: { email: 'sample@example.test', amr: ['urn:openai:amr:google'] },
    expires: '2027-01-09T06:41:13Z', sessionToken: 'SYNTHETIC_SESSION_MUST_NOT_LEAVE_BROWSER',
  };
}
export function workspace(id = ACCOUNT, plan = 'plus', active = true, expires = '2026-10-30T18:52:44Z') {
  return { account: { account_id: id, plan_type: plan, structure: id === ACCOUNT ? 'personal' : 'team' }, entitlement: { subscription_plan: plan, has_active_subscription: active, expires_at: expires } };
}
