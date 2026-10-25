import { createHmac, randomBytes } from 'node:crypto';

const LEVELS = new Set(['debug', 'info', 'warn', 'error']);
const LEVEL_ORDER = { debug: 10, info: 20, warn: 30, error: 40 };

/* 日志脱敏：调用方应当只传已经脱敏的值；这里再做一层兜底，
   即使有人误把邮箱、卡密或令牌传进来，写出前也会被抹掉。 */
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const JWT = /\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]*/g;
const CARD = /\b[A-Z0-9]{3,}(?:-[A-Z0-9]{2,}){2,}\b/g;
const LONG_SECRET = /\b[A-Za-z0-9+/_=-]{40,}\b/g;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const salt = process.env.LOG_SALT?.trim() || randomBytes(16).toString('hex');

export function maskEmail(value) {
  if (typeof value !== 'string' || value.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return null;
  const [name, domain] = value.split('@');
  return `${name.slice(0, 1)}***@${domain.slice(0, 1)}***${domain.slice(domain.lastIndexOf('.'))}`;
}

/* IPv4 只留前两段，IPv6 只留前两组；其余一律当作未知。 */
export function maskIp(value) {
  if (typeof value !== 'string') return 'unknown';
  const v4 = value.replace(/^::ffff:/i, '').match(/^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/);
  if (v4) return `${v4[1]}.${v4[2]}.*.*`;
  const v6 = value.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4}):/i);
  return v6 ? `${v6[1]}:${v6[2]}::*` : 'unknown';
}

/* 卡密只记一个带盐的短指纹：能把同一张卡的前后操作串起来，但还原不出卡密。
   盐默认每次启动随机生成；想跨重启关联，在 .env 里设置 LOG_SALT。 */
export function fingerprint(value) {
  const text = typeof value === 'string' ? value.trim().toUpperCase() : '';
  return text ? `card:${createHmac('sha256', salt).update(text).digest('hex').slice(0, 8)}` : null;
}

export function scrub(text) {
  /* requestId 是 UUID，长得像卡密，先收起来脱敏后再放回去。 */
  const ids = [];
  const hidden = text.replace(UUID, match => `\u0000${ids.push(match) - 1}\u0000`);
  return hidden
    .replace(EMAIL, match => maskEmail(match) ?? '[email]')
    .replace(JWT, '[token]')
    .replace(CARD, '[card]')
    .replace(LONG_SECRET, '[secret]')
    .replace(/\u0000(\d+)\u0000/g, (_m, index) => ids[Number(index)]);
}

function clean(value) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  return scrub(String(value).replace(/[\r\n\t]+/g, ' ')).slice(0, 160);
}

export function logEvent(category, event, fields = {}, level = 'info') {
  if (process.env.LOG_LEVEL === 'silent') return;
  try {
  const safeLevel = LEVELS.has(level) ? level : 'info';
  const configuredLevel = LEVELS.has(process.env.LOG_LEVEL) ? process.env.LOG_LEVEL : 'info';
  if (LEVEL_ORDER[safeLevel] < LEVEL_ORDER[configuredLevel]) return;
  const record = {
    time: new Date().toISOString(),
    level: safeLevel.toUpperCase(),
    category: clean(category),
    event: clean(event),
  };
  for (const [key, value] of Object.entries(fields)) record[key] = clean(value);
  const line = JSON.stringify(record);
  const writer = safeLevel === 'debug' ? console.debug
    : safeLevel === 'warn' ? console.warn
      : safeLevel === 'error' ? console.error : console.info;
  writer(line);
  } catch {
    // Logging must never change an API response or stop the service.
  }
}

export const appLog = {
  debug: (category, event, fields) => logEvent(category, event, fields, 'debug'),
  info: (category, event, fields) => logEvent(category, event, fields, 'info'),
  warn: (category, event, fields) => logEvent(category, event, fields, 'warn'),
  error: (category, event, fields) => logEvent(category, event, fields, 'error'),
};
