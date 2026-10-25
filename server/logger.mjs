const LEVELS = new Set(['debug', 'info', 'warn', 'error']);
const LEVEL_ORDER = { debug: 10, info: 20, warn: 30, error: 40 };

function clean(value) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  return String(value).replace(/[\r\n\t]+/g, ' ').slice(0, 160);
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
