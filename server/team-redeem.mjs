import { PublicError } from './upstream.mjs';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CARD = /^[A-Z0-9]+(?:-[A-Z0-9]+)+$/;

/* 上游地址只允许来自 .env 的 Team_Web，代码里不保留任何默认网址。 */
function baseUrl(value) {
  const url = new URL(value);
  const loopback = ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || !url.pathname.endsWith('/')) {
    throw new Error('Team_Web must be an HTTPS base URL ending with /.');
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new Error('Team_Web must be HTTPS.');
  }
  return url;
}

function positive(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 1 ? Math.floor(number) : fallback;
}

/* 上游返回的提示文字会原样给浏览器看，先把里面的网址去掉，避免带出上游域名。 */
function safeText(value, fallback) {
  const text = typeof value === 'string' ? value.replace(/(?:https?:)?\/\/[^\s"'<>]+/gi, '').replace(/\s{2,}/g, ' ').trim() : '';
  return text ? text.slice(0, 240) : fallback;
}

async function readJson(response) {
  const type = response.headers.get('content-type') || '';
  if (!type.includes('application/json')) throw new PublicError(502, 'TEAM_RESPONSE', 'Team 兑换服务返回异常，请稍后重试。');
  const reader = response.body?.getReader();
  if (!reader) throw new PublicError(502, 'TEAM_RESPONSE', 'Team 兑换服务返回异常，请稍后重试。');
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 128 * 1024) {
        await reader.cancel();
        throw new PublicError(502, 'TEAM_RESPONSE', 'Team 兑换服务返回异常，请稍后重试。');
      }
      chunks.push(value);
    }
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('invalid envelope');
    return body;
  } catch (error) {
    if (error instanceof PublicError || error?.name === 'AbortError' || error?.name === 'TimeoutError') throw error;
    throw new PublicError(502, 'TEAM_RESPONSE', 'Team 兑换服务返回异常，请稍后重试。');
  } finally {
    reader.releaseLock();
  }
}

function readCode(value) {
  const code = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (code.length < 6 || code.length > 128 || !CARD.test(code)) {
    throw new PublicError(400, 'INVALID_INPUT', '请输入完整的 Team 卡密。');
  }
  return code;
}

function readRequestId(value) {
  if (typeof value !== 'string' || !UUID.test(value)) throw new PublicError(400, 'INVALID_INPUT', '兑换请求标识无效，请刷新页面后重试。');
  return value;
}

function readInvite(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !['cdk', 'email', 'request_id'].includes(key))) {
    throw new PublicError(400, 'INVALID_INPUT', '请求格式不正确，请刷新页面后重试。');
  }
  const cdk = readCode(body.cdk);
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (email.length > 254 || !EMAIL.test(email)) throw new PublicError(400, 'INVALID_INPUT', '请输入有效的 ChatGPT 注册邮箱。');
  return { cdk, email, request_id: readRequestId(body.request_id) };
}

function readReady(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !['cdk', 'request_id'].includes(key))) {
    throw new PublicError(400, 'INVALID_INPUT', '请求格式不正确，请刷新页面后重试。');
  }
  return { cdk: readCode(body.cdk), request_id: readRequestId(body.request_id) };
}

export function createTeamRedeem({ origin = process.env.Team_Web, timeoutMs = positive(process.env.TEAM_REDEEM_TIMEOUT_MS, 15_000), fetchImpl = globalThis.fetch } = {}) {
  /* 没配置 Team_Web 时服务照常启动，只是 Team 兑换对外显示「暂未开放」。 */
  const target = typeof origin === 'string' && origin.trim() ? baseUrl(origin.trim()) : null;
  const statusTtlMs = 20_000;
  let statusCache = null;
  let statusInflight = null;

  async function request(path, { method = 'GET', body } = {}) {
    if (!target) throw new PublicError(503, 'TEAM_NOT_CONFIGURED', 'Team 兑换服务暂未开放，请稍后再试。');
    let response;
    try {
      response = await fetchImpl(new URL(path, target), {
        method,
        headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}), 'User-Agent': 'ByBuy/0.1' },
        ...(body ? { body: JSON.stringify(body) } : {}),
        redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      if (error?.name === 'TimeoutError' || error?.name === 'AbortError') throw new PublicError(504, 'TEAM_TIMEOUT', 'Team 兑换服务响应超时，请保留卡密和当前页面，勿重复提交。', Boolean(body));
      throw new PublicError(502, 'TEAM_UNAVAILABLE', body ? 'Team 兑换结果暂时无法确认，请保留卡密和当前页面，勿重复提交。' : 'Team 兑换服务暂时不可用，请稍后重试。', Boolean(body));
    }
    let data;
    try { data = await readJson(response); }
    catch (error) {
      if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
        throw new PublicError(504, 'TEAM_TIMEOUT', 'Team 兑换服务响应超时，请保留卡密和当前页面，勿重复提交。', Boolean(body));
      }
      if (error instanceof PublicError && body && error.status >= 500) throw new PublicError(error.status, error.code, error.message, true);
      throw error;
    }
    if (!response.ok) {
      const detail = safeText(data.detail, safeText(data.msg, 'Team 兑换暂未完成，请稍后重试。'));
      if (response.status === 409) throw new PublicError(409, 'TEAM_PENDING', detail, true);
      if (response.status === 429) throw new PublicError(503, 'TEAM_BUSY', '当前兑换人数较多，请稍后重试。');
      throw new PublicError(response.status >= 500 ? 502 : 400, 'TEAM_REJECTED', detail, Boolean(body) && response.status >= 500);
    }
    return data;
  }

  return {
    async status({ fresh = false } = {}) {
      const now = Date.now();
      if (statusCache && (!fresh || now - statusCache.at < 3_000) && statusCache.expiresAt > now) {
        return { ...statusCache.value, cached: true };
      }
      if (!statusInflight) {
        statusInflight = (async () => {
          const started = performance.now();
          try {
            await this.availability();
            const value = { online: true, latencyMs: Math.round(performance.now() - started) };
            statusCache = { value, at: Date.now(), expiresAt: Date.now() + statusTtlMs };
            return value;
          } catch {
            const value = { online: false, latencyMs: Math.round(performance.now() - started) };
            statusCache = { value, at: Date.now(), expiresAt: Date.now() + statusTtlMs };
            return value;
          }
        })().finally(() => { statusInflight = null; });
      }
      return { ...(await statusInflight), cached: false };
    },
    async availability() {
      const data = await request('api/inventory/availability');
      const invite = data.invite_seats_remaining;
      const ready = data.ready_accounts_remaining;
      if (!Number.isSafeInteger(invite) || invite < 0 || !Number.isSafeInteger(ready) || ready < 0) {
        throw new PublicError(502, 'TEAM_RESPONSE', '库存信息暂时无法读取，请稍后重试。');
      }
      return { inviteSeatsRemaining: invite, readyAccountsRemaining: ready };
    },
    async invite(input) {
      const data = await request('api/cdk/redeem/invite', { method: 'POST', body: readInvite(input) });
      if (data.status !== 'success') throw new PublicError(502, 'TEAM_RESPONSE', 'Team 邀请结果暂时无法确认，请稍后查询。', true);
      return { status: 'success' };
    },
    async ready(input) {
      const data = await request('api/cdk/redeem/ready-sub', { method: 'POST', body: readReady(input) });
      const account = data.account;
      if (data.status !== 'success' || !account || typeof account !== 'object' || Array.isArray(account)) {
        throw new PublicError(502, 'TEAM_RESPONSE', '现成账号结果暂时无法确认，请稍后查询。', true);
      }
      const email = safeText(account.email, '');
      const password = safeText(account.password, '');
      const totpSecret = safeText(account.totp_secret, '');
      if (!email || !password) throw new PublicError(502, 'TEAM_RESPONSE', '现成账号结果暂时无法确认，请稍后查询。', true);
      return { status: 'success', account: { email, password, totp_secret: totpSecret } };
    },
  };
}

export { readInvite, readReady };
