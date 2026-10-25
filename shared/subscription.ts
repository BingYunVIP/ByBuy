/** Pure, browser-safe parsing. Decoding a JWT is deliberately not verification. */
export const MAX_IMPORT_BYTES = 1024 * 1024;
export const MAX_ACCOUNTS = 30;
export const MAX_TOKEN_LENGTH = 32_768;
export const AUTH_CLAIM = 'https://api.openai.com/auth';
export const PROFILE_CLAIM = 'https://api.openai.com/profile';

export type JsonRecord = Record<string, unknown>;
export type InputFormat = 'session' | 'codex' | 'sub2api' | 'oauth';
export type EvidenceSource = 'session' | 'import' | 'access_token' | 'id_token';
export type CredentialTime = 'missing' | 'unknown' | 'expired' | 'not_yet_valid' | 'within_lifetime';
export interface Finding { code: string; level: 'info' | 'warning' | 'error'; message: string }
export interface Evidence {
  field: string;
  value: string;
  source: EvidenceSource;
  path: string;
  subject: string;
  checkedAt: string | null;
}
export interface CredentialInfo {
  present: boolean;
  readable: boolean;
  issuedAt: string | null;
  expiresAt: string | null;
  timeState: CredentialTime;
}
export interface OfflineReport {
  format: InputFormat;
  inspectedAt: string;
  exportedAt: string | null;
  lastRefresh: string | null;
  emailMasked: string | null;
  accountMasked: string | null;
  observedPlan: string | null;
  scope: 'personal' | 'workspace' | 'unknown';
  loginMethod: string;
  identityConsistent: boolean;
  access: CredentialInfo;
  id: CredentialInfo;
  hasRefreshToken: boolean;
  signature: 'not_verified';
  findings: Finding[];
  evidence: Evidence[];
  billing: { channel: 'unknown'; promotion: 'unknown'; history: 'unknown'; paymentIntegrity: 'not_assessable' };
}
export interface ParsedAccount {
  key: string;
  accountId: string | null;
  accessToken: string | null;
  report: OfflineReport;
  onlineBlockedReason: string | null;
}

export type SubscriptionStatus = 'active' | 'free' | 'inactive' | 'unknown';
export interface LiveSubscription {
  accountId: string;
  accountMasked: string;
  scope: 'personal' | 'workspace' | 'unknown';
  plan: string | null;
  status: SubscriptionStatus;
  periodStart: string | null;
  periodEnd: string | null;
  willRenew: boolean | null;
  source: 'live_subscription' | 'live_workspace';
}
export interface LiveCheck {
  source: 'live_subscription' | 'live_workspace';
  ok: boolean;
  code: string;
  message: string;
}
export interface LiveReport {
  eligibility?: { ticket: string; expiresAt: string } | null;
  checkedAt: string;
  credentialState: 'accepted' | 'rejected' | 'unconfirmed';
  selected: LiveSubscription | null;
  workspaces: LiveSubscription[];
  workspaceCoverage: 'complete' | 'partial' | 'unavailable';
  checks: LiveCheck[];
}

export function record(value: unknown): JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
}
export function textValue(value: unknown, max = 256): string | null {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max ? value.trim() : null;
}
export function accountIdentifier(value: unknown): string | null {
  const text = textValue(value, 160);
  return text && /^[A-Za-z0-9_-]{3,160}$/.test(text) ? text : null;
}
export function maskIdentifier(value: string | null): string | null {
  return value ? `•••• ${value.slice(-6)}` : null;
}
export function maskEmail(value: unknown): string | null {
  const email = textValue(value, 254);
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  const [name, domain] = email.split('@');
  return `${name.slice(0, 1)}***@${domain.slice(0, 1)}***${domain.slice(domain.lastIndexOf('.'))}`;
}
export function isoTime(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  // Reject impossible wall-clock dates that JS would otherwise normalize.
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  if (month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate()) return null;
  return new Date(ms).toISOString();
}
export function epochTime(value: unknown): string | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value < 253_402_300_800
    ? new Date(value * 1000).toISOString() : null;
}

const PLAN_ALIASES: Record<string, string> = {
  chatgptfreeplan: 'free', chatgptplusplan: 'plus', chatgptproplan: 'pro',
  chatgptteamplan: 'team', chatgptbusinessplan: 'business', chatgptgoplan: 'go',
  chatgptenterpriseplan: 'enterprise', chatgpteduplan: 'edu', education: 'edu',
};
const PLAN_LABELS: Record<string, string> = {
  free: 'Free', go: 'Go', plus: 'Plus', pro: 'Pro', prolite: 'Pro', promax: 'Pro Max',
  team: 'Business（Team）', business: 'Business', enterprise: 'Enterprise', edu: 'Edu',
};
export function normalizePlan(value: unknown): string | null {
  const raw = textValue(value, 80)?.toLowerCase();
  if (!raw || !/^[a-z][a-z0-9_-]*$/.test(raw)) return null;
  return Object.hasOwn(PLAN_ALIASES, raw) ? PLAN_ALIASES[raw] : raw;
}
export function planLabel(plan: string | null): string {
  if (!plan) return '套餐未知';
  return Object.hasOwn(PLAN_LABELS, plan) ? PLAN_LABELS[plan] : `未识别套餐（${plan}）`;
}
export function knownPaidPlan(plan: string | null): boolean {
  return plan !== null && plan !== 'free' && Object.hasOwn(PLAN_LABELS, plan);
}
export function planScope(plan: string | null): 'personal' | 'workspace' | 'unknown' {
  if (['free', 'go', 'plus', 'pro', 'prolite', 'promax'].includes(plan ?? '')) return 'personal';
  if (['team', 'business', 'enterprise', 'edu'].includes(plan ?? '')) return 'workspace';
  return 'unknown';
}

function decodePart(part: string): JsonRecord | null {
  try {
    const base64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const bytes = Uint8Array.from(atob(base64 + '='.repeat((4 - base64.length % 4) % 4)), c => c.charCodeAt(0));
    const parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch { return null; }
}
export function decodeJwt(token: unknown): { header: JsonRecord; payload: JsonRecord } | null {
  if (typeof token !== 'string' || token.length > MAX_TOKEN_LENGTH || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) return null;
  const [h, p] = token.split('.');
  const header = decodePart(h);
  const payload = decodePart(p);
  return header && payload ? { header, payload } : null;
}

function credential(token: unknown, payload: JsonRecord | null, now: number): CredentialInfo {
  const present = typeof token === 'string' && token.trim().length > 0;
  const issuedAt = epochTime(payload?.iat);
  const expiresAt = epochTime(payload?.exp);
  const startsAt = epochTime(payload?.nbf);
  let timeState: CredentialTime = !present ? 'missing' : 'unknown';
  if (present && expiresAt) timeState = Date.parse(expiresAt) <= now ? 'expired' : 'within_lifetime';
  if (startsAt && Date.parse(startsAt) > now + 30_000) timeState = 'not_yet_valid';
  return { present, readable: payload !== null, issuedAt, expiresAt, timeState };
}

function inspectOne(value: JsonRecord, format: InputFormat, index: number, exportedAt: string | null, now: number): ParsedAccount {
  const data = format === 'sub2api' ? record(value.credentials)
    : format === 'codex' ? record(value.tokens)
      : Object.keys(record(value.credentials)).length ? record(value.credentials) : value;
  const session = format === 'session';
  const accessToken = textValue(session ? value.accessToken : data.access_token, MAX_TOKEN_LENGTH);
  const idToken = session ? value.idToken : data.id_token;
  const accessDecoded = decodeJwt(accessToken);
  const idDecoded = decodeJwt(idToken);
  const accessPayload = accessDecoded?.payload ?? null;
  const idPayload = idDecoded?.payload ?? null;
  const accessAuth = record(accessPayload?.[AUTH_CLAIM]);
  const idAuth = record(idPayload?.[AUTH_CLAIM]);
  const sessionAccount = record(value.account);
  const metadataId = accountIdentifier(session ? sessionAccount.id : (data.chatgpt_account_id ?? data.account_id));
  const accessId = accountIdentifier(accessAuth.chatgpt_account_id);
  const idId = accountIdentifier(idAuth.chatgpt_account_id);
  const accountId = accessId ?? idId ?? metadataId;
  const findings: Finding[] = [];
  const addFinding = (code: string, level: Finding['level'], message: string) => findings.push({ code, level, message });
  const ids = [metadataId, accessId, idId].filter(Boolean);
  const users = [accountIdentifier(accessAuth.chatgpt_user_id ?? accessAuth.user_id), accountIdentifier(idAuth.chatgpt_user_id ?? idAuth.user_id)].filter(Boolean);
  const subs = [textValue(accessPayload?.sub), textValue(idPayload?.sub)].filter(Boolean);
  const identityConsistent = new Set(ids).size <= 1 && new Set(users).size <= 1 && new Set(subs).size <= 1;
  if (!identityConsistent) addFinding('IDENTITY_MISMATCH', 'error', '资料中的账号标识不一致，已停止合并。请重新导入同一账号的资料。');
  if (!accountId) addFinding('ACCOUNT_ID_MISSING', 'warning', '未取得明确的账号标识，无法进行在线核验。');
  const access = credential(accessToken, accessPayload, now);
  const id = credential(idToken, idPayload, now);
  if (access.present && !access.readable) addFinding('ACCESS_TOKEN_UNREADABLE', 'warning', '无法读取访问令牌，请重新获取完整资料。');
  if (id.present && !id.readable) addFinding('ID_TOKEN_UNREADABLE', 'warning', '无法读取身份令牌中的记录。其他可读资料仍会保留。');
  if (id.timeState === 'expired') addFinding('ID_TOKEN_EXPIRED', 'info', '身份令牌已超过声明有效期。这不代表订阅已结束，访问令牌将单独检查。');
  if (access.timeState === 'expired') addFinding('ACCESS_TOKEN_EXPIRED', 'warning', '访问令牌已超过声明有效期，请更新登录资料后再在线核验。');
  if (access.timeState === 'not_yet_valid') addFinding('ACCESS_TOKEN_NOT_YET_VALID', 'warning', '访问令牌尚未到声明生效时间，请检查系统时间或更新资料。');
  const issuerMatches = !accessPayload || accessPayload.iss === 'https://auth.openai.com';
  if (!issuerMatches) addFinding('ISSUER_UNSUPPORTED', 'error', '访问令牌的签发方不符合支持的格式。');

  const evidence: Evidence[] = [];
  const add = (field: string, raw: string | null, source: EvidenceSource, path: string, subject: string | null, checkedAt: string | null = null) => {
    if (raw) evidence.push({ field, value: raw, source, path, subject: maskIdentifier(subject) ?? '归属未提供', checkedAt });
  };
  const metaPlan = normalizePlan(session ? sessionAccount.planType : data.plan_type);
  add('plan', metaPlan, session ? 'session' : 'import', session ? 'account.planType' : 'credentials.plan_type', metadataId);
  add('periodEnd', isoTime(data.subscription_expires_at), 'import', 'credentials.subscription_expires_at', metadataId);
  const metadataExpiry = isoTime(data.expires_at);
  if (metadataExpiry && access.expiresAt && metadataExpiry !== access.expiresAt) addFinding('CREDENTIAL_DATES_DIFFER', 'warning', '导入的凭证到期时间与访问令牌不一致，将按令牌声明检查。');
  add('credentialEnd', metadataExpiry, 'import', 'credentials.expires_at', metadataId);
  for (const [source, auth, subject] of [['access_token', accessAuth, accessId], ['id_token', idAuth, idId]] as const) {
    const checkedAt = isoTime(auth.chatgpt_subscription_last_checked);
    add('plan', normalizePlan(auth.chatgpt_plan_type), source, `${source}.chatgpt_plan_type`, subject, checkedAt);
    add('periodStart', isoTime(auth.chatgpt_subscription_active_start), source, `${source}.chatgpt_subscription_active_start`, subject, checkedAt);
    add('periodEnd', isoTime(auth.chatgpt_subscription_active_until), source, `${source}.chatgpt_subscription_active_until`, subject, checkedAt);
    add('subscriptionCheckedAt', checkedAt, source, `${source}.chatgpt_subscription_last_checked`, subject, checkedAt);
  }
  const plans = [...new Set(evidence.filter(e => e.field === 'plan').map(e => e.value))];
  const observedPlan = identityConsistent && plans.length === 1 ? plans[0] : null;
  if (plans.length > 1) addFinding('PLAN_RECORDS_DIFFER', 'warning', '不同来源的套餐标记不一致，需要在线确认当前套餐。');
  if (new Set(evidence.filter(e => e.field === 'periodEnd').map(e => e.value)).size > 1) {
    addFinding('SUBSCRIPTION_DATES_DIFFER', 'warning', '订阅日期存在不同记录，可能涉及不同周期或旧资料，请在线确认。');
  }
  if (evidence.some(e => e.field === 'subscriptionCheckedAt' && now - Date.parse(e.value) > 24 * 60 * 60 * 1000)
    || evidence.some(e => e.field === 'periodEnd' && Date.parse(e.value) < now)) {
    addFinding('SUBSCRIPTION_SNAPSHOT_OLD', 'warning', '订阅快照需要更新。凭证最近刷新过，也不代表订阅记录已更新。');
  }
  const lastRefresh = isoTime(value.last_refresh ?? data.last_refresh);
  const amr = [...(Array.isArray(accessAuth.amr) ? accessAuth.amr : []), ...(Array.isArray(idPayload?.amr) ? idPayload.amr : []), ...(Array.isArray(record(value.user).amr) ? record(value.user).amr as unknown[] : [])];
  const loginMethod = amr.includes('urn:openai:amr:google') ? 'Google 登录'
    : amr.includes('urn:openai:amr:otp_email') || idPayload?.auth_provider === 'passwordless' || record(value.extra).auth_provider === 'passwordless' ? '邮件验证码登录' : '未提供';
  const email = record(accessPayload?.[PROFILE_CLAIM]).email ?? idPayload?.email ?? record(value.user).email ?? data.email;
  const scope = sessionAccount.structure === 'personal' ? 'personal' : planScope(observedPlan);
  const report: OfflineReport = {
    format, inspectedAt: new Date(now).toISOString(), exportedAt, lastRefresh,
    emailMasked: maskEmail(email), accountMasked: maskIdentifier(accountId), observedPlan, scope,
    loginMethod, identityConsistent, access, id,
    hasRefreshToken: Boolean(textValue(data.refresh_token, 64_000)), signature: 'not_verified', findings, evidence,
    billing: { channel: 'unknown', promotion: 'unknown', history: 'unknown', paymentIntegrity: 'not_assessable' },
  };
  const onlineBlockedReason = !identityConsistent ? '请先解决账号资料不一致的问题。'
    : !accessToken || !accessDecoded ? '需要包含完整访问令牌的登录资料。'
      : !issuerMatches ? '当前令牌签发方不受支持。'
        : !accountId || !accessId ? '需要访问令牌中明确的账号标识。'
          : access.timeState === 'expired' || access.timeState === 'not_yet_valid' ? '请更新访问令牌后再核验。' : null;
  // Only the access token survives parsing. Refresh and ID token originals are discarded.
  return { key: `account-${index + 1}`, accountId, accessToken, report, onlineBlockedReason };
}

export function parseSubscriptionInput(raw: string, now = Date.now()): ParsedAccount[] {
  if (!raw.trim()) throw new Error('请先粘贴登录资料或选择 JSON 文件。');
  if (new TextEncoder().encode(raw).byteLength > MAX_IMPORT_BYTES) throw new Error('文件过大，请使用不超过 1 MB 的 JSON 文件。');
  let value: unknown;
  try { value = JSON.parse(raw.replace(/^\uFEFF/, '')); }
  catch { throw new Error('JSON 格式不正确，请复制完整内容后重试。'); }
  const root = record(value);
  if (!Object.keys(root).length) throw new Error('未识别到登录资料，请导入 Session、auth.json 或 Sub2API JSON。');
  if (Array.isArray(root.accounts)) {
    if (!root.accounts.length || root.accounts.length > MAX_ACCOUNTS) throw new Error(`请选择包含 1–${MAX_ACCOUNTS} 个账号的导出文件。`);
    if (root.accounts.some(item => !Object.keys(record(record(item).credentials)).length || (record(item).platform && record(item).platform !== 'openai'))) {
      throw new Error('导出文件含不支持的账号，请仅导入带 OAuth 凭证的 OpenAI 账号。');
    }
    return root.accounts.map((item, index) => inspectOne(record(item), 'sub2api', index, isoTime(root.exported_at), now));
  }
  let format: InputFormat;
  if (Object.keys(record(root.tokens)).length) format = 'codex';
  else if (typeof root.accessToken === 'string' || Object.keys(record(root.account)).length) format = 'session';
  else if (typeof root.access_token === 'string' || typeof root.id_token === 'string' || Object.keys(record(root.credentials)).length) format = 'oauth';
  else throw new Error('未识别到支持的 OAuth 登录资料，API Key 不能用于此项检查。');
  return [inspectOne(root, format, 0, isoTime(root.exported_at), now)];
}

/** Explicit allowlist: safe for downloading, with no credential-bearing account object. */
export function downloadableReport(offline: OfflineReport, online: LiveReport | null) {
  const safeSubject = (subject: LiveSubscription) => {
    const { accountId: _accountId, ...safe } = subject;
    return safe;
  };
  return {
    version: 1, offline,
    online: online ? { checkedAt: online.checkedAt, credentialState: online.credentialState, workspaceCoverage: online.workspaceCoverage, checks: online.checks, selected: online.selected ? safeSubject(online.selected) : null, workspaces: online.workspaces.map(safeSubject) } : null,
    rechargeEligibility: 'unknown',
  };
}
