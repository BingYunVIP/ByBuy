const PLANS = { go: 'ChatGPT Go', plus: 'ChatGPT Plus', pro: 'ChatGPT Pro' };
const STATUSES = new Set(['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED', 'PLAN_MISMATCH', 'SUSPICIOUS', 'REQUIRES_NEW_SESSION']);
const RECONCILABLE_STATUSES = new Set(['PENDING', 'PROCESSING', 'COMPLETED', 'SUSPICIOUS', 'REQUIRES_NEW_SESSION']);

/* 这些错误换个站点重试是有意义的（连不上 / 超时 / 被限流 / 返回不可解析）。
   而 INVALID_CARD、ORDER_NOT_FOUND 属于业务结论，换站重试不会改变结果。 */
const RETRYABLE = new Set(['SERVICE_UNAVAILABLE', 'SERVICE_TIMEOUT', 'SERVICE_BUSY', 'SERVICE_RESPONSE']);

export class PublicError extends Error {
  constructor(status, code, message, canQuery = false) {
    super(message);
    this.status = status;
    this.code = code;
    this.canQuery = canQuery;
  }
}

export function readCard(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => key !== 'code')) {
    throw new PublicError(400, 'INVALID_INPUT', '请仅填写需要验证或查询的卡密。');
  }
  const code = typeof body.code === 'string' ? body.code.trim().toUpperCase() : '';
  if (code.length < 6 || code.length > 128 || !/^[A-Z0-9]+(?:-[A-Z0-9]+)+$/.test(code)) {
    throw new PublicError(400, 'INVALID_INPUT', '请输入完整卡密，仅支持字母、数字和连字符。');
  }
  return code;
}

/* 充值服务把 Pro 按档位拆成 pro5 / pro / pro20 / pro25，本站统一只显示「Pro」，
   所以卡密和订单对外只会出现 Go、Plus、Pro 三种名称。 */
function planLabel(plan) {
  const key = typeof plan === 'string' ? plan.toLowerCase() : '';
  const family = /^pro\d*$/.test(key) ? 'pro' : key;
  return Object.hasOwn(PLANS, family) ? PLANS[family] : 'AI 订阅';
}

/* 本站不出售续费卡和 Codex 点数卡。它们的结果含义和普通充值不同
   （续费卡「完成」只是绑卡成功、等待自动扣费），按普通订单展示会误导顾客，
   所以在验证和查询阶段就明确拒绝，不让它们走进充值流程。 */
function isUnsupportedCard(data) {
  const kind = `${data.cardType ?? ''} ${data.plan ?? ''}`.toUpperCase();
  return Boolean(data.renewal) || /RENEWAL|CODEX/.test(kind);
}

function unsupportedCard() {
  return new PublicError(400, 'UNSUPPORTED_CARD', '该类型卡密暂不支持在本站使用。');
}

/* 顾客安全验证的进度事件。浏览器和 API 层只认左边的短名字，
   充值服务要求的事件名只存在于服务端。 */
export const VERIFICATION_EVENTS = Object.freeze({
  shown: 'CUSTOMER_VERIFICATION_MODAL_SHOWN',
  started: 'CUSTOMER_VERIFICATION_STARTED',
  succeeded: 'CUSTOMER_VERIFICATION_SUCCEEDED',
  failed: 'CUSTOMER_VERIFICATION_FAILED',
});

export function readVerificationEvent(body) {
  const invalid = () => new PublicError(400, 'INVALID_INPUT', '请求格式不正确，请刷新页面重试。');
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !['code', 'event'].includes(key))) throw invalid();
  const code = readCard({ code: body.code });
  if (typeof body.event !== 'string' || !Object.hasOwn(VERIFICATION_EVENTS, body.event)) throw invalid();
  return { code, event: body.event };
}

function maskEmail(email) {
  if (typeof email !== 'string' || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  const [name, domain] = email.split('@');
  const suffix = domain.slice(domain.lastIndexOf('.'));
  return `${name.slice(0, 1)}***@${domain.slice(0, 1)}***${suffix}`;
}

function maskOrder(orderNo) {
  if (typeof orderNo !== 'string' || !/^[A-Z0-9-]{6,100}$/i.test(orderNo)) return null;
  return `•••• ${orderNo.slice(-6)}`;
}

function timestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})?$/.test(value)) return null;
  return Number.isNaN(Date.parse(value)) ? null : value;
}

function emailAddress(value) {
  return typeof value === 'string' && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
    ? value.trim().toLowerCase() : null;
}

function verificationDetails(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.mode !== 'stripe') return null;
  const publishableKey = typeof value.publishableKey === 'string' && /^pk_[A-Za-z0-9_]{8,200}$/.test(value.publishableKey)
    ? value.publishableKey : null;
  const clientSecret = typeof value.clientSecret === 'string' && value.clientSecret.length <= 500 && /^[A-Za-z0-9_]+$/.test(value.clientSecret)
    ? value.clientSecret : null;
  const expiresAt = timestamp(value.expiresAt);
  return publishableKey && clientSecret && expiresAt ? { mode: 'stripe', publishableKey, clientSecret, expiresAt } : null;
}

function normalizedOrder(data, includeVerification = false) {
  const verification = includeVerification ? verificationDetails(data.verification) : null;
  return {
    kind: 'order',
    status: STATUSES.has(data.status) ? data.status : 'UNKNOWN',
    plan: planLabel(data.plan),
    orderNoMasked: maskOrder(data.orderNo),
    accountMasked: maskEmail(data.accountEmail),
    createdAt: timestamp(data.createdAt),
    processingAt: timestamp(data.processingAt),
    completedAt: timestamp(data.completedAt),
    updatedAt: timestamp(data.updatedAt),
    requiresVerification: includeVerification ? Boolean(verification) : Boolean(data.verification && typeof data.verification === 'object'),
    ...(includeVerification ? { verification } : {}),
  };
}

function positive(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}

/* ChatGPT_Web 支持逗号分隔多个地址：第一个是主站，后面的作为兜底。
   只要有一个可用，服务就认为是正常的。 */
function parseOrigins(value) {
  const list = (Array.isArray(value) ? value : String(value ?? '').split(','))
    .map(item => String(item).trim())
    .filter(Boolean);
  if (!list.length) throw new Error('ChatGPT_Web must list at least one origin (set it in .env).');
  return list.map(item => {
    const url = new URL(item);
    /* 只允许 https；唯一例外是本机回环上的 http，方便本地起假上游做联调。 */
    const loopback = ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname);
    const schemeOk = url.protocol === 'https:' || (url.protocol === 'http:' && loopback);
    if (!schemeOk || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
      throw new Error('ChatGPT_Web must be an HTTPS origin without credentials or a path.');
    }
    return url;
  });
}

/* ---------------------------------------------------------------------------
   上游并发闸门

   多人同时用的时候，每个访客的「检查订阅 / 验证卡密 / 查询订单」都会各自去打一次
   上游。不设上限的话，一次推广带来的流量尖峰会把上游打成 429，
   然后所有人都收到「查询人数较多」—— 明明是自己人打自己人。

   所以这里给上游调用加一个全局名额：
     · 同时最多 concurrency 个请求在飞
     · 超出的进队列等，最多排 queueLimit 个
     · 排队超过 queueWaitMs 还没轮到的，直接回 503，让用户重试而不是干等

   注意：这是**单进程内存态**。如果以后用 cluster / 多副本部署，
   每个进程各有一份名额，实际并发 = 配置值 × 进程数，需要相应调小。
   --------------------------------------------------------------------------- */
function createGate({ limit, queueLimit, waitMs }) {
  let active = 0;
  const waiting = [];

  function handOver() {
    const entry = waiting.shift();
    if (!entry) { active--; return; }        // 没人在等 → 真正释放名额
    clearTimeout(entry.timer);
    entry.resolve();                          // 有人等 → 名额直接转交，active 不变
  }

  async function acquire() {
    if (active < limit) { active++; return; }
    if (waiting.length >= queueLimit) {
      throw new PublicError(503, 'SERVICE_BUSY', '当前使用人数较多，请稍后再试。');
    }
    await new Promise((resolve, reject) => {
      const entry = { resolve, timer: null };
      entry.timer = setTimeout(() => {
        const index = waiting.indexOf(entry);
        if (index >= 0) waiting.splice(index, 1);
        reject(new PublicError(503, 'SERVICE_BUSY', '当前使用人数较多，请稍后再试。'));
      }, waitMs);
      waiting.push(entry);
    });
  }

  return { acquire, release: handOver, stats: () => ({ active, queued: waiting.length }) };
}

async function readJson(response) {
  if (!response.headers.get('content-type')?.includes('application/json')) {
    throw new PublicError(502, 'SERVICE_UNAVAILABLE', '充值服务暂时不可用，请稍后重试。');
  }
  // Bound upstream responses and keep the timeout active while reading the body.
  const reader = response.body?.getReader();
  if (!reader) throw new PublicError(502, 'SERVICE_RESPONSE', '暂时未取得查询结果，请稍后重试。');
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 128 * 1024) {
        await reader.cancel();
        throw new PublicError(502, 'SERVICE_RESPONSE', '充值服务返回异常，请稍后重试。');
      }
      chunks.push(value);
    }
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Invalid envelope');
    return body;
  } catch (error) {
    if (error instanceof PublicError || error.name === 'AbortError' || error.name === 'TimeoutError') throw error;
    throw new PublicError(502, 'SERVICE_RESPONSE', '充值服务返回异常，请稍后重试。');
  } finally {
    reader.releaseLock();
  }
}

export function createUpstream({
  origin = process.env.ChatGPT_Web,
  timeoutMs = 25_000,
  fetchImpl = globalThis.fetch,
  now = Date.now,
  log = console,
  statusTtlMs = 20_000,
  statusTimeoutMs = 8_000,
  concurrency = positive(process.env.UPSTREAM_CONCURRENCY, 8),
  queueLimit = positive(process.env.UPSTREAM_QUEUE, 100),
  queueWaitMs = positive(process.env.UPSTREAM_QUEUE_WAIT_MS, 8_000),
  diagnostics = process.env.SERVICE_DIAGNOSTICS === '1',
  reconcileDelayMs = 500,
} = {}) {
  const targets = parseOrigins(origin);
  const gate = createGate({ limit: concurrency, queueLimit, waitMs: queueWaitMs });

  function trace(action, targetIndex, detail) {
    if (!diagnostics) return;
    if (typeof log.info === 'function' && log.info.length >= 2) {
      log.info('REMOTE', 'REQUEST_COMPLETED', { action, target: targetIndex + 1, ...detail });
    } else {
      const fields = Object.entries(detail).map(([key, value]) => `${key}=${String(value).replace(/\s+/g, '_').slice(0, 80)}`).join(' ');
      log.info?.(`[service] action=${action} target=${targetIndex + 1} ${fields}`.trim());
    }
  }

  /* bestEffort：只关心「有没有送到」，响应体不解析 —— 用于顾客进度事件，
     2xx 就算成功，不要求返回格式固定。 */
  async function attempt(target, targetIndex, path, payload, action, { bestEffort = false } = {}) {
    const started = performance.now();
    let response;
    try {
      response = await fetchImpl(new URL(path, target), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': 'ByBuy/0.1' },
        body: JSON.stringify(payload),
        redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      trace(action, targetIndex, { outcome: error?.name ?? 'NETWORK_ERROR', durationMs: Math.round(performance.now() - started) });
      throw error;
    }
    if (response.status === 429) {
      await response.body?.cancel();
      trace(action, targetIndex, { status: response.status, outcome: 'BUSY', durationMs: Math.round(performance.now() - started) });
      throw new PublicError(503, 'SERVICE_BUSY', '查询人数较多，请稍后再试。');
    }
    if (response.status >= 500 || response.status === 401 || response.status === 403) {
      await response.body?.cancel();
      trace(action, targetIndex, { status: response.status, outcome: 'UNAVAILABLE', durationMs: Math.round(performance.now() - started) });
      throw new PublicError(502, 'SERVICE_UNAVAILABLE', '充值服务暂时不可用，请稍后重试。');
    }
    if (bestEffort && response.ok) {
      await response.body?.cancel();
      trace(action, targetIndex, { status: response.status, outcome: 'OK', durationMs: Math.round(performance.now() - started) });
      return {};
    }
    const body = await readJson(response);
    const resultCode = typeof body.code === 'string' && /^[A-Z0-9_]{1,64}$/.test(body.code) ? body.code : 'UNKNOWN';
    trace(action, targetIndex, { status: response.status, outcome: resultCode, durationMs: Math.round(performance.now() - started) });
    if (body.code === 'INVALID_CARD') {
      throw new PublicError(400, 'INVALID_CARD', '卡密无效或已使用。已兑换的卡密可以尝试查询订单。', true);
    }
    if (['ORDER_NOT_FOUND', 'NOT_FOUND'].includes(body.code) || response.status === 404) {
      throw new PublicError(404, 'ORDER_NOT_FOUND', '暂未找到关联订单，请检查卡密是否完整。');
    }
    if (body.code === 'PLAN_MISMATCH') {
      throw new PublicError(409, 'PLAN_MISMATCH', '当前账号套餐不符合卡密要求，请重新检查账号状态。');
    }
    if (typeof body.code === 'string' && body.code.includes('SESSION')) {
      throw new PublicError(400, 'SESSION_REJECTED', 'Session 已失效或格式不受支持，请重新获取后再试。');
    }
    if (!response.ok || body.code !== 'OK') {
      throw new PublicError(502, 'SERVICE_REJECTED', '暂时无法获取结果，请检查卡密或稍后重试。');
    }
    if (!body.data || typeof body.data !== 'object' || Array.isArray(body.data)) {
      throw new PublicError(502, 'SERVICE_RESPONSE', '充值服务返回异常，请稍后重试。');
    }
    return body.data;
  }

  function publicRequestError(error) {
    if (error instanceof PublicError) return error;
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      return new PublicError(504, 'SERVICE_TIMEOUT', '等待结果超时，请稍后重新查询。');
    }
    return new PublicError(502, 'SERVICE_UNAVAILABLE', '暂时无法连接充值服务，请稍后重试。');
  }

  async function request(path, payload, action, options) {
    /* 整次调用（含兜底重试）只占一个名额 —— 否则一个用户卡住会吃掉两个名额。 */
    await gate.acquire();
    try {
      let lastError = null;
      for (const [targetIndex, target] of targets.entries()) {
        try {
          return await attempt(target, targetIndex, path, payload, action, options);
        } catch (error) {
          if (error instanceof PublicError && !RETRYABLE.has(error.code)) throw error;
          lastError = error;
        }
      }
      throw lastError;
    } catch (error) {
      throw publicRequestError(error);
    } finally {
      gate.release();
    }
  }

  /* 可用性探测用的短超时。健康检查不该让访客等 25 秒。 */
  const pingTimeoutMs = Math.max(1_000, Math.min(timeoutMs, statusTimeoutMs));
  /* 手动「重新检测」最短间隔：防止有人连点把上游当压测靶子 */
  const statusMinTtlMs = 3_000;

  /* 结果缓存：多个访客同时开页面时，不至于把上游打爆。
     探测失败也缓存，否则上游挂了以后每个请求都会去等满超时。
     这个探测**不走闸门** —— 它正是用来发现上游出问题的，不能被业务请求挤掉。 */
  let statusCache = null;
  let statusInflight = null;
  let lastOnline = null;

  async function pingOne(target) {
    const started = performance.now();
    let online = false;
    try {
      const response = await fetchImpl(new URL('/api/health', target), {
        method: 'GET',
        headers: { Accept: 'application/json', 'User-Agent': 'ByBuy/0.1' },
        /* manual 而不是 error：将来上游加了 301 跳转，也不该被判成"挂了" */
        redirect: 'manual',
        signal: AbortSignal.timeout(pingTimeoutMs),
      });
      online = response.status >= 200 && response.status < 400;
      await response.body?.cancel();
    } catch {
      online = false;
    }
    return { online, latencyMs: Math.round(performance.now() - started) };
  }

  /* 真正打上游的那一次探测。
     冷启动 / 缓存刚过期时，一批访客会同时进来 —— 只允许一次探测在飞，
     其余人搭车等它的结果。否则 100 个访客同时开页面就是 100 次上游请求。 */
  async function probe() {
    const time = now();
    const results = await Promise.all(targets.map(pingOne));
    const healthy = results.filter(item => item.online);
    const value = {
      online: healthy.length > 0,
      /* 有站点正常时报最快那个；全挂了就报最快"失败"的耗时 */
      latencyMs: Math.min(...(healthy.length ? healthy : results).map(item => item.latencyMs)),
    };
    statusCache = { value, at: time, expiresAt: time + statusTtlMs };

    /* 状态翻转时打一行日志，方便排查；平时不刷屏。 */
    if (value.online !== lastOnline) {
      if (typeof log.info === 'function' && log.info.length >= 2) {
        log.info('HEALTH', 'REMOTE_STATUS_CHANGED', { online: value.online, healthyTargets: healthy.length, totalTargets: targets.length, latencyMs: value.latencyMs });
      } else {
        log.info?.(`[upstream] ${value.online ? '恢复正常' : '不可用'}（${healthy.length}/${targets.length} 个站点可用，${value.latencyMs}ms）`);
      }
      lastOnline = value.online;
    }
    return value;
  }

  return {
    async verify(code) {
      const data = await request('/api/public/cards/verify', { code }, 'verify');
      if (isUnsupportedCard(data)) throw unsupportedCard();
      return { kind: 'card', valid: true, plan: planLabel(data.plan), status: 'AVAILABLE' };
    },
    async query(code) {
      const data = await request('/api/public/orders/query-by-card', { code }, 'query');
      if (isUnsupportedCard(data)) throw unsupportedCard();
      // Deliberately select fields. Stripe action details are browser-scoped and allowlisted;
      // customerMessage, advertisements, contact details, Session and queryToken stay private.
      return normalizedOrder(data, true);
    },
    /* 只带卡密和事件名，不带 Session。事件是尽力而为：失败由调用方决定是否理会。 */
    async recordVerificationEvent(code, event) {
      await request('/api/public/orders/events', { code, eventType: VERIFICATION_EVENTS[event] }, 'verification-event', { bestEffort: true });
    },
    async submit({ code, sessionJson, contact = '', accountEmail }) {
      await gate.acquire();
      try {
        try {
          const data = await attempt(targets[0], 0, '/api/public/orders', { code, sessionJson, contact }, 'submit');
          return normalizedOrder(data, true);
        } catch (error) {
          if (error instanceof PublicError && !RETRYABLE.has(error.code)) throw error;
        }

        await new Promise(resolve => setTimeout(resolve, Math.max(0, Number(reconcileDelayMs) || 0)));
        for (const [targetIndex, target] of targets.entries()) {
          try {
            const data = await attempt(target, targetIndex, '/api/public/orders/query-by-card', { code }, 'submit-reconcile');
            if (emailAddress(data.accountEmail) === accountEmail && RECONCILABLE_STATUSES.has(data.status)) {
              return normalizedOrder(data, true);
            }
          } catch { /* reconciliation is best effort */ }
        }
        throw new PublicError(502, 'SUBMISSION_UNKNOWN', '提交结果暂时无法确认，请使用原卡密查询订单，暂不要重复提交。', true);
      } finally {
        gate.release();
      }
    },
    /* 只回可用性和耗时。**绝不回上游域名 / 响应内容 / 各站点明细** ——
       前端只需要一个「正常 / 异常」的信号。哪个站点挂了只写服务端日志。 */
    async status({ fresh = false } = {}) {
      const time = now();
      if (statusCache) {
        const age = time - statusCache.at;
        const usable = fresh ? age < statusMinTtlMs : statusCache.expiresAt > time;
        if (usable) return { ...statusCache.value, cached: true };
      }
      /* 已经有一次探测在飞 → 搭车，别再打一次上游 */
      if (!statusInflight) {
        statusInflight = probe().finally(() => { statusInflight = null; });
      }
      return { ...(await statusInflight), cached: false };
    },
    stats: () => gate.stats(),
  };
}
