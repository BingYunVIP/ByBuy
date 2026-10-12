import { mkdir, writeFile } from 'node:fs/promises';

const code = process.env.BYBUY_TEST_CARD?.trim();
if (!code) {
  console.error('Set BYBUY_TEST_CARD in your private .env first. Do not place real cards in source code.');
  process.exit(1);
}
const base = process.env.BYBUY_BASE_URL || `http://127.0.0.1:${process.env.PORT || 2254}`;
const checks = [];
for (const [name, route] of [['health', '/api/health'], ['verify-gate', '/api/cards/verify'], ['query', '/api/orders/query']]) {
  try {
    const start = performance.now();
    const response = await fetch(new URL(route, base), name === 'health' ? { signal: AbortSignal.timeout(5000) } : {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }), signal: AbortSignal.timeout(65_000),
    });
    const body = await response.json();
    const check = {
      name, httpStatus: response.status, result: body.data?.status ?? body.error?.code ?? 'UNKNOWN',
      durationMs: Math.round(performance.now() - start),
      passed: name === 'health' ? body.data?.mode === 'preview'
        : name === 'verify-gate' ? response.status === 403 && body.error?.code === 'SUBSCRIPTION_CHECK_REQUIRED'
          : response.ok && body.data?.kind === 'order',
    };
    checks.push(check);
    console.info(JSON.stringify(check));
  } catch {
    checks.push({ name, passed: false, result: 'CONNECTION_FAILED' });
    console.error(`${name}: connection failed; ensure ByBuy is running.`);
  }
}
await mkdir(new URL('../artifacts/', import.meta.url), { recursive: true });
await writeFile(new URL('../artifacts/live-probe.json', import.meta.url), JSON.stringify({ checkedAt: new Date().toISOString(), checks }, null, 2));
if (checks.some(check => !check.passed)) process.exitCode = 1;
