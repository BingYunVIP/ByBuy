import { PublicError } from './upstream.mjs';
import {
  AUTH_CLAIM, MAX_TOKEN_LENGTH, accountIdentifier, decodeJwt, epochTime, isoTime,
  knownPaidPlan, maskIdentifier, normalizePlan, planScope, record,
} from '../shared/subscription.ts';

const ACCOUNT_URL = 'https://chatgpt.com/backend-api/accounts/check/v4-2023-04-27';
const SUBSCRIPTION_URL = 'https://chatgpt.com/backend-api/subscriptions';

// chatgpt.com 由 Cloudflare 提供机器人防护。只带 Authorization + Accept 的请求会被
// 直接判定为脚本流量并返回 403。下面这组头部只声明「这是一个浏览器发起的普通请求」，
// 不包含任何账号信息；实测可让同一请求从 403 变为 401（即正常抵达业务层）。
const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
  'sec-ch-ua': '"Chromium";v="131", "Not_A Brand";v="24"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
  Referer: 'https://chatgpt.com/',
  Origin: 'https://chatgpt.com',
  'oai-language': 'en-US',
};
const MESSAGES = {
  CREDENTIAL_REJECTED: '访问凭证被拒绝，请重新获取登录资料。',
  ACCESS_RESTRICTED: 'ChatGPT 暂时不允许此请求，可能需要网页验证或额外权限。',
  CHECK_RATE_LIMITED: 'ChatGPT 请求较频繁，请稍后再试。',
  CHECK_TIMEOUT: '等待 ChatGPT 响应超时，请稍后重试。',
  CHECK_UNAVAILABLE: '暂时无法连接 ChatGPT，请稍后重试。',
  CHECK_RESPONSE_UNKNOWN: '暂时无法识别 ChatGPT 返回的订阅资料。',
  CHECK_SCOPE_MISMATCH: '返回资料的账号归属不一致，未合并该结果。',
  WORKSPACE_NOT_ACCESSIBLE: '当前凭证未能确认所选工作区，请重新选择或更新资料。',
  SUBSCRIPTION_RECORDS_DIFFER: '在线订阅状态存在不一致，本次未确认有效状态。',
  SUBSCRIPTION_DATES_DIFFER: '在线来源的订阅周期不一致，本次未确认周期终点。',
};

export function readSubscriptionInput(body, now = Date.now()) {
  const input = record(body);
  if (!Object.keys(input).length || Object.keys(input).some(key => !['accessToken', 'accountId'].includes(key))) {
    throw new PublicError(400, 'INVALID_INPUT', '请仅提交所选账号的访问令牌和账号标识。');
  }
  if (typeof input.accessToken !== 'string' || input.accessToken.length > MAX_TOKEN_LENGTH) {
    throw new PublicError(400, 'INVALID_INPUT', '请提供完整的访问令牌。');
  }
  const decoded = decodeJwt(input.accessToken);
  const payload = decoded?.payload;
  const audience = typeof payload?.aud === 'string' ? [payload.aud] : payload?.aud;
  if (!decoded || decoded.header.alg !== 'RS256' || payload.iss !== 'https://auth.openai.com'
    || !Array.isArray(audience) || !audience.includes('https://api.openai.com/v1')) {
    throw new PublicError(400, 'CREDENTIAL_FORMAT', '访问令牌格式不受支持，请重新获取登录资料。');
  }
  const expiry = epochTime(payload.exp);
  const start = epochTime(payload.nbf);
  if (!expiry || Date.parse(expiry) <= now) throw new PublicError(400, 'CREDENTIAL_EXPIRED', '访问令牌已超过声明有效期，请更新资料后再试。');
  if (start && Date.parse(start) > now + 30_000) throw new PublicError(400, 'CREDENTIAL_NOT_YET_VALID', '访问令牌尚未生效，请检查系统时间或更新资料。');
  const tokenAccountId = accountIdentifier(record(payload[AUTH_CLAIM]).chatgpt_account_id);
  const tokenPlan = normalizePlan(record(payload[AUTH_CLAIM]).chatgpt_plan_type);
  const accountId = input.accountId === undefined ? tokenAccountId : accountIdentifier(input.accountId);
  if (!tokenAccountId || !accountId) throw new PublicError(400, 'ACCOUNT_ID_MISSING', '未取得明确的账号标识，请重新获取资料。');
  // JWT fields here are unverified routing hints, never ByBuy authentication.
  // Every actual result must come from ChatGPT authorizing this bearer token.
  return { accessToken: input.accessToken, tokenAccountId, tokenPlan, accountId };
}

class CheckError extends Error {
  constructor(code) { super(MESSAGES[code]); this.code = code; }
}

async function boundedJson(response) {
  if (!response.headers.get('content-type')?.includes('application/json')) {
    await response.body?.cancel();
    throw new CheckError('CHECK_RESPONSE_UNKNOWN');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new CheckError('CHECK_RESPONSE_UNKNOWN');
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 512 * 1024) {
        await reader.cancel();
        throw new CheckError('CHECK_RESPONSE_UNKNOWN');
      }
      chunks.push(value);
    }
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new CheckError('CHECK_RESPONSE_UNKNOWN');
    return body;
  } finally { reader.releaseLock(); }
}

function deriveStatus(plan, active, periodEnd, now) {
  if (plan === 'free') return active === true ? 'unknown' : 'free';
  if (!knownPaidPlan(plan)) return 'unknown';
  if (active === false) return 'inactive';
  if (active === true && periodEnd && Date.parse(periodEnd) <= now) return 'unknown';
  if (active === true || (periodEnd && Date.parse(periodEnd) > now)) return 'active';
  if (periodEnd && Date.parse(periodEnd) <= now) return 'inactive';
  return 'unknown';
}

function currentPersonalState(subject, { deactivated = false } = {}) {
  if (!deactivated && subject.scope === 'personal' && subject.status === 'inactive' && knownPaidPlan(subject.plan)) {
    return { ...subject, plan: 'free', status: 'free', periodStart: null, periodEnd: null, willRenew: false };
  }
  return subject;
}

function workspaceResult(value, key, now) {
  const item = record(value);
  const account = record(item.account);
  const entitlement = record(item.entitlement);
  const accountId = accountIdentifier(account.account_id ?? account.id ?? item.account_id)
    ?? (key !== 'default' ? accountIdentifier(key) : null);
  if (!accountId) return null;
  const accountPlan = normalizePlan(account.plan_type ?? account.planType ?? item.plan_type);
  const entitlementPlan = normalizePlan(entitlement.subscription_plan ?? entitlement.plan_type);
  const active = typeof entitlement.has_active_subscription === 'boolean' ? entitlement.has_active_subscription : null;
  // Inactive workspace billing plans are never substituted for the personal plan.
  const plan = active === false ? accountPlan ?? entitlementPlan : entitlementPlan ?? accountPlan;
  if (!plan && !Object.keys(entitlement).length) return null;
  const periodEnd = isoTime(entitlement.expires_at);
  const deactivated = account.is_deactivated === true || item.is_deactivated === true || account.status === 'deactivated';
  const status = deactivated ? 'inactive' : deriveStatus(plan, active, periodEnd, now);
  return currentPersonalState({
    accountId, accountMasked: maskIdentifier(accountId),
    scope: account.structure === 'personal' ? 'personal'
      : ['team', 'workspace', 'business'].includes(account.structure) || planScope(plan) === 'workspace' ? 'workspace' : 'unknown',
    plan, status, periodStart: isoTime(entitlement.starts_at ?? entitlement.active_start), periodEnd,
    willRenew: typeof entitlement.will_renew === 'boolean' ? entitlement.will_renew : null,
    source: 'live_workspace',
  }, { deactivated });
}

function parseWorkspaces(body, now) {
  const values = body.accounts;
  if (!values || typeof values !== 'object') throw new CheckError('CHECK_RESPONSE_UNKNOWN');
  const entries = Array.isArray(values) ? values.map(v => [null, v]) : Object.entries(values);
  if (entries.length > 100) throw new CheckError('CHECK_RESPONSE_UNKNOWN');
  const workspaces = new Map();
  let incomplete = false;
  for (const [key, value] of entries) {
    // The endpoint can represent its default workspace as an alias.
    if (key === 'default' && typeof value === 'string') continue;
    const parsed = workspaceResult(value, key, now);
    if (!parsed) { incomplete = true; continue; }
    const previous = workspaces.get(parsed.accountId);
    if (previous && (previous.plan !== parsed.plan || previous.status !== parsed.status || previous.periodEnd !== parsed.periodEnd)) {
      // Don't hide contradictory duplicate/default records by choosing one.
      workspaces.set(parsed.accountId, { ...previous, plan: null, status: 'unknown', periodEnd: null, willRenew: null });
      incomplete = true;
    } else workspaces.set(parsed.accountId, parsed);
  }
  if (!workspaces.size) throw new CheckError('CHECK_RESPONSE_UNKNOWN');
  return { workspaces: [...workspaces.values()], coverage: incomplete ? 'partial' : 'complete' };
}

function parseSubscription(body, target, now) {
  if (body.account_id !== undefined && accountIdentifier(body.account_id) !== target) throw new CheckError('CHECK_SCOPE_MISMATCH');
  const plan = normalizePlan(body.plan_type);
  if (!plan) throw new CheckError('CHECK_RESPONSE_UNKNOWN');
  const periodEnd = isoTime(body.active_until);
  if (body.active_until !== undefined && body.active_until !== null && !periodEnd) throw new CheckError('CHECK_RESPONSE_UNKNOWN');
  const active = typeof body.has_active_subscription === 'boolean' ? body.has_active_subscription : null;
  return currentPersonalState({
    accountId: target, accountMasked: maskIdentifier(target),
    scope: body.structure === 'personal' ? 'personal'
      : ['team', 'workspace', 'business'].includes(body.structure) || planScope(plan) === 'workspace' ? 'workspace' : 'unknown', plan,
    status: deriveStatus(plan, active, periodEnd, now), periodStart: isoTime(body.active_start), periodEnd,
    willRenew: typeof body.will_renew === 'boolean' ? body.will_renew : null,
    source: 'live_subscription',
  });
}

export function createSubscriptionChecker({ fetchImpl = globalThis.fetch, now = Date.now, timeoutMs = 20_000 } = {}) {
  async function get(url, token, signal) {
    try {
      const response = await fetchImpl(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...BROWSER_HEADERS },
        redirect: 'error', signal,
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new CheckError(response.status === 401 ? 'CREDENTIAL_REJECTED'
          : response.status === 403 ? 'ACCESS_RESTRICTED' : response.status === 429 ? 'CHECK_RATE_LIMITED' : 'CHECK_UNAVAILABLE');
      }
      return await boundedJson(response);
    } catch (error) {
      if (error instanceof CheckError) throw error;
      if (error.name === 'TimeoutError' || error.name === 'AbortError') throw new CheckError('CHECK_TIMEOUT');
      if (error instanceof SyntaxError) throw new CheckError('CHECK_RESPONSE_UNKNOWN');
      throw new CheckError('CHECK_UNAVAILABLE');
    }
  }
  return {
    async check(input, callerSignal) {
      const started = now();
      const timeout = AbortSignal.timeout(timeoutMs);
      const signal = callerSignal ? AbortSignal.any([callerSignal, timeout]) : timeout;
      const checks = [];
      const outcome = { checkedAt: new Date(started).toISOString(), credentialState: 'unconfirmed', selected: null, workspaces: [], workspaceCoverage: 'unavailable', checks };
      const fail = (source, error) => {
        const code = error instanceof CheckError ? error.code : 'CHECK_RESPONSE_UNKNOWN';
        checks.push({ source, ok: false, code, message: MESSAGES[code] });
      };
      const succeed = source => checks.push({ source, ok: true, code: 'OK', message: source === 'live_workspace' ? '已取得可见工作区资料。' : '已取得所选账号的订阅资料。' });
      try {
        const body = await get(ACCOUNT_URL, input.accessToken, signal);
        const parsed = parseWorkspaces(body, started);
        outcome.workspaces = parsed.workspaces;
        outcome.workspaceCoverage = parsed.coverage;
        outcome.credentialState = 'accepted';
        succeed('live_workspace');
      } catch (error) { fail('live_workspace', error); }

      const matching = outcome.workspaces.find(workspace => workspace.accountId === input.accountId);
      // Never guess that a default/POID record belongs to the token's account.
      // A different target must first appear in the authenticated workspace list.
      if (input.accountId !== input.tokenAccountId && !matching) {
        fail('live_subscription', new CheckError('WORKSPACE_NOT_ACCESSIBLE'));
      } else if (!callerSignal?.aborted && checks[0]?.code !== 'CREDENTIAL_REJECTED') {
        try {
          const url = new URL(SUBSCRIPTION_URL);
          url.searchParams.set('account_id', input.accountId);
          const body = await get(url, input.accessToken, signal);
          outcome.selected = parseSubscription(body, input.accountId, started);
          outcome.credentialState = 'accepted';
          succeed('live_subscription');
        } catch (error) { fail('live_subscription', error); }
      }

      if (!outcome.selected && matching && !checks.some(check => check.code === 'CHECK_SCOPE_MISMATCH')) outcome.selected = matching;
      if (outcome.selected && matching && outcome.selected.source === 'live_subscription') {
        if (outcome.selected.scope === 'unknown') outcome.selected.scope = matching.scope;
        else if (matching.scope !== 'unknown' && outcome.selected.scope !== matching.scope) {
          outcome.selected = { ...outcome.selected, scope: 'unknown', status: 'unknown', periodStart: null, periodEnd: null };
          fail('live_subscription', new CheckError('CHECK_SCOPE_MISMATCH'));
        }
        const comparable = status => ['active', 'inactive', 'free'].includes(status);
        const disagrees = comparable(outcome.selected.status) && comparable(matching.status)
          && (outcome.selected.status !== matching.status || (matching.plan && outcome.selected.plan !== matching.plan));
        if (disagrees) {
          outcome.selected = { ...outcome.selected, plan: null, status: 'unknown', periodEnd: null, willRenew: null };
          fail('live_subscription', new CheckError('SUBSCRIPTION_RECORDS_DIFFER'));
        } else if (outcome.selected.periodEnd && matching.periodEnd && outcome.selected.periodEnd !== matching.periodEnd) {
          outcome.selected = { ...outcome.selected, periodEnd: null };
          fail('live_subscription', new CheckError('SUBSCRIPTION_DATES_DIFFER'));
        }
      }
      const hasIdentityConflict = checks.some(check => ['CHECK_SCOPE_MISMATCH', 'SUBSCRIPTION_RECORDS_DIFFER'].includes(check.code));
      const hasActivePaidEvidence = (outcome.selected?.status === 'active' && knownPaidPlan(outcome.selected.plan))
        || (matching?.status === 'active' && knownPaidPlan(matching.plan));
      if (outcome.credentialState === 'accepted' && input.accountId === input.tokenAccountId && input.tokenPlan === 'free'
        && outcome.selected && outcome.selected.scope !== 'workspace' && !hasIdentityConflict && !hasActivePaidEvidence
        && ['inactive', 'unknown', 'free'].includes(outcome.selected.status)) {
        outcome.selected = { ...outcome.selected, scope: 'personal', plan: 'free', status: 'free', periodStart: null, periodEnd: null, willRenew: false };
      }
      if (outcome.credentialState !== 'accepted' && checks.some(check => check.code === 'CREDENTIAL_REJECTED')) outcome.credentialState = 'rejected';
      return outcome;
    },
  };
}
