import express from 'express';
import { randomUUID } from 'node:crypto';
import { createUpstream, PublicError, readCard } from './upstream.mjs';
import { createSubscriptionChecker, readSubscriptionInput } from './subscriptions.mjs';
import { createEligibilityStore } from './eligibility.mjs';
import { PROFILE_CLAIM, decodeJwt, parseSubscriptionInput, record, textValue } from '../shared/subscription.ts';
import { appLog } from './logger.mjs';

const MAX_SUBMISSION_BYTES = 256 * 1024;

function sessionEmail(root, accessToken) {
  const user = record(root.user);
  const account = record(root.account);
  const profile = record(decodeJwt(accessToken)?.payload?.[PROFILE_CLAIM]);
  const email = [root.email, user.email, user.email_address, account.email, account.email_address, profile.email]
    .map(value => textValue(value, 254))
    .find(value => value && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value));
  return email?.toLowerCase() ?? null;
}

export function readOrderSubmission(body) {
  const input = record(body);
  if (!Object.keys(input).length || Object.keys(input).some(key => !['code', 'sessionJson', 'contact'].includes(key))) {
    throw new PublicError(400, 'INVALID_INPUT', '请仅提交本次充值所需的卡密和 Session。');
  }
  const code = readCard({ code: input.code });
  if (typeof input.sessionJson !== 'string') {
    throw new PublicError(400, 'INVALID_INPUT', '请提供完整的 Session JSON。');
  }
  const sessionJson = input.sessionJson.replace(/^\uFEFF/, '').trim();
  if (!sessionJson || Buffer.byteLength(sessionJson, 'utf8') > MAX_SUBMISSION_BYTES) {
    throw new PublicError(400, 'INVALID_INPUT', 'Session JSON 为空或过长，请重新获取后再试。');
  }
  let root;
  try { root = JSON.parse(sessionJson); }
  catch { throw new PublicError(400, 'INVALID_INPUT', 'Session JSON 格式不正确，请重新复制完整内容。'); }
  let parsed;
  try { parsed = parseSubscriptionInput(sessionJson); }
  catch { throw new PublicError(400, 'SESSION_REJECTED', '完成提交需要单个账号的完整 ChatGPT Session JSON。'); }
  const account = parsed.length === 1 ? parsed[0] : null;
  if (!account || account.report.format !== 'session' || !account.accountId || !account.accessToken || !account.report.identityConsistent) {
    throw new PublicError(400, 'SESSION_REJECTED', '完成提交需要单个账号的完整 ChatGPT Session JSON。');
  }
  const accountEmail = sessionEmail(record(root), account.accessToken);
  if (!accountEmail) throw new PublicError(400, 'SESSION_REJECTED', 'Session 中未识别到账号邮箱，请重新获取完整内容。');
  const contact = input.contact === undefined || input.contact === '' ? '' : textValue(input.contact, 200);
  if (input.contact !== undefined && input.contact !== '' && contact === null) {
    throw new PublicError(400, 'INVALID_INPUT', '联系方式格式不正确。');
  }
  return { code, sessionJson, contact: contact ?? '', accountId: account.accountId, accountEmail };
}

function rateLimiter({ limit = 30, windowMs = 60_000, now = Date.now } = {}) {
  const buckets = new Map();
  return (req, res, next) => {
    const time = now();
    for (const [key, bucket] of buckets) if (bucket.until <= time) buckets.delete(key);
    const key = req.ip ?? 'unknown';
    const bucket = buckets.get(key) ?? { count: 0, until: time + windowMs };
    if (bucket.count >= limit || (!buckets.has(key) && buckets.size >= 10_000)) {
      appLog.warn('SECURITY', 'RATE_LIMITED', { ip: key, limit, windowMs });
      res.set('Retry-After', String(Math.max(1, Math.ceil((bucket.until - time) / 1000))));
      return next(new PublicError(429, 'RATE_LIMITED', '操作较频繁，请稍等一分钟后重试。'));
    }
    bucket.count++;
    buckets.set(key, bucket);
    next();
  };
}

export function createApi({ upstream = createUpstream(), subscriptions = createSubscriptionChecker(), publicOrigin, rateLimit } = {}) {
  const router = express.Router();
  const canonicalOrigin = publicOrigin ? new URL(publicOrigin).origin : null;
  const eligibility = createEligibilityStore();

  router.use((req, res, next) => {
    res.locals.requestId = randomUUID();
    res.locals.startedAt = performance.now();
    res.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Request-ID': res.locals.requestId });
    res.once('finish', () => {
      const routine = req.method === 'GET' && ['/health', '/service/status'].includes(req.path);
      if (!routine || process.env.SERVICE_DIAGNOSTICS === '1' || res.statusCode >= 400) {
        appLog.info('HTTP', 'REQUEST_COMPLETED', {
          requestId: res.locals.requestId,
          method: req.method,
          path: req.path,
          status: res.statusCode,
          durationMs: Math.round(performance.now() - res.locals.startedAt),
          ip: req.ip ?? 'unknown',
        });
      }
    });
    next();
  });

  router.get('/health', (_req, res) => {
    // This describes ByBuy readiness, not a fresh remote availability check.
    res.json({ ok: true, data: { status: 'ready', mode: 'preview', capabilities: ['verify', 'submit', 'query', 'subscription-check'] } });
  });

  router.use((req, res, next) => {
    const origin = req.get('origin');
    const host = req.get('host');
    const sameOrigin = origin === `http://${host}` || origin === `https://${host}`;
    if (req.get('sec-fetch-site') === 'cross-site' || (origin && !sameOrigin && origin !== canonicalOrigin)) {
      appLog.warn('SECURITY', 'ORIGIN_REJECTED', { requestId: res.locals.requestId, ip: req.ip ?? 'unknown', method: req.method, path: req.path });
      return next(new PublicError(403, 'ORIGIN_REJECTED', '请在 ByBuy 页面中完成操作。'));
    }
    next();
  });

  /* 顶部「系统状态」灯的数据源。
     放在这里（同源校验之后、全局限流之前）：
       · 同源校验 —— 别的站点不能拿它当免费的远端探针
       · 单独限流 240/分钟 —— 页面每 30 秒轮询一次（每人 2 次/分钟）。
         这个额度给得很宽松是故意的：即使 TRUST_PROXY 没配好、所有人共用一个
         IP 桶，也不会因为轮询把用户自己的操作额度挤掉。
         真正的远端压力由服务层 20 秒的结果缓存挡住，
         请求再多也只会在内存里读一次缓存。
       · fresh=1 只在用户点「重新检测」时带上，服务端仍有 3 秒下限。
     远端地址只存在于服务端，响应体里只有 { online, latencyMs, cached }。 */
  router.get('/service/status', rateLimiter({ limit: 240 }), async (req, res) => {
    const data = await upstream.status({ fresh: req.query.fresh === '1' });
    res.json({ ok: true, data });
  });

  router.use(rateLimiter(rateLimit));
  router.post('/subscriptions/check', rateLimiter({ limit: 8 }), express.json({ limit: '40kb', strict: true }), async (req, res) => {
    if (!req.is('application/json')) throw new PublicError(415, 'INVALID_CONTENT_TYPE', '请求格式不正确，请刷新页面重试。');
    const input = readSubscriptionInput(req.body);
    const controller = new AbortController();
    const cancel = () => { if (!res.writableEnded) controller.abort(); };
    res.on('close', cancel);
    try {
      const data = await subscriptions.check(input, controller.signal);
      if (!controller.signal.aborted) {
        const grant = eligibility.issue(data, input.accountId);
        appLog.info('SUBSCRIPTION', 'CHECK_COMPLETED', {
          requestId: res.locals.requestId,
          credentialState: data.credentialState,
          result: data.selected ? `${data.selected.scope}:${data.selected.status}` : 'unconfirmed',
          eligibilityIssued: Boolean(grant),
          checks: data.checks.map(check => `${check.source}:${check.code}`).join(','),
        });
        res.json({ ok: true, data: { ...data, eligibility: grant } });
      }
    } finally { res.off('close', cancel); }
  });

  router.post('/orders/submit', express.json({ limit: '600kb', strict: true }), async (req, res) => {
    if (!req.is('application/json')) throw new PublicError(415, 'INVALID_CONTENT_TYPE', '请求格式不正确，请刷新页面重试。');
    const input = readOrderSubmission(req.body);
    const ticket = req.get('X-ByBuy-Eligibility');
    eligibility.claimSubmission(ticket, input.code, input.accountId);
    appLog.info('ORDER', 'SUBMISSION_ACCEPTED', { requestId: res.locals.requestId });
    const data = await upstream.submit(input);
    res.json({ ok: true, data, meta: { requestId: res.locals.requestId, durationMs: Math.round(performance.now() - res.locals.startedAt) } });
  });

  router.use(express.json({ limit: '4kb', strict: true }));

  for (const [path, action] of [['/cards/verify', 'verify'], ['/orders/query', 'query']]) {
    router.post(path, async (req, res) => {
      if (!req.is('application/json')) throw new PublicError(415, 'INVALID_CONTENT_TYPE', '请求格式不正确，请刷新页面重试。');
      const code = readCard(req.body);
      const ticket = req.get('X-ByBuy-Eligibility');
      if (action === 'verify') eligibility.require(ticket);
      const data = await upstream[action](code);
      if (action === 'verify') eligibility.markCardVerified(ticket, code);
      res.json({ ok: true, data, meta: { requestId: res.locals.requestId, durationMs: Math.round(performance.now() - res.locals.startedAt) } });
    });
  }

  router.use((_req, _res, next) => next(new PublicError(404, 'NOT_FOUND', '此功能暂未开放。')));
  router.use((error, _req, res, _next) => {
    let safeError = error;
    if (!(safeError instanceof PublicError)) {
      appLog.error('ERROR', 'UNHANDLED_ERROR', { requestId: res.locals.requestId, name: error?.name ?? 'Error', code: error?.code ?? 'UNKNOWN' });
      if (error.type === 'entity.too.large') safeError = new PublicError(413, 'INVALID_INPUT', '输入内容过长，请仅提交本次操作需要的资料。');
      else if (error.type === 'entity.parse.failed') safeError = new PublicError(400, 'INVALID_INPUT', '请求格式不正确，请刷新页面重试。');
      else safeError = new PublicError(500, 'INTERNAL_ERROR', '服务暂时不可用，请稍后重试。');
    }
    const logFields = { requestId: res.locals.requestId, code: safeError.code, status: safeError.status };
    if (safeError.status >= 500) appLog.error('ERROR', 'PUBLIC_ERROR', logFields);
    else appLog.warn('ERROR', 'PUBLIC_ERROR', logFields);
    res.status(safeError.status).json({
      ok: false,
      error: { code: safeError.code, message: safeError.message, canQuery: safeError.canQuery },
      meta: { requestId: res.locals.requestId, durationMs: Math.round(performance.now() - res.locals.startedAt) },
    });
  });
  return router;
}
