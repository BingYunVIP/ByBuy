export type Mode = 'verify' | 'query';

export interface CardResult {
  kind: 'card';
  valid: true;
  plan: string;
  status: 'AVAILABLE';
}

export interface OrderResult {
  kind: 'order';
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'PLAN_MISMATCH' | 'SUSPICIOUS' | 'REQUIRES_NEW_SESSION' | 'UNKNOWN';
  plan: string;
  orderNoMasked: string | null;
  accountMasked: string | null;
  createdAt: string | null;
  processingAt: string | null;
  completedAt: string | null;
  updatedAt: string | null;
  requiresVerification: boolean;
  verification?: VerificationDetails | null;
}

export interface VerificationDetails {
  mode: 'stripe';
  publishableKey: string;
  clientSecret: string;
  expiresAt: string;
}

export interface SubmissionResult extends OrderResult {
  verification: VerificationDetails | null;
}

export interface ApiError {
  code: string;
  message: string;
  canQuery: boolean;
}

type ApiResponse = { ok: true; data: CardResult | OrderResult } | { ok: false; error: ApiError };
type SubmitResponse = { ok: true; data: SubmissionResult } | { ok: false; error: ApiError };

function networkError(error: unknown): { ok: false; error: ApiError } {
  return {
    ok: false,
    error: {
      code: 'NETWORK_ERROR',
      message: error instanceof Error && error.name === 'TimeoutError'
        ? '等待结果超时，请稍后重新查询。'
        : '连接暂时中断，请检查网络后重试。',
      canQuery: false,
    },
  };
}

export async function requestCard(mode: Mode, code: string, signal: AbortSignal, ticket?: string): Promise<ApiResponse> {
  try {
    const response = await fetch(mode === 'verify' ? '/api/cards/verify' : '/api/orders/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(ticket ? { 'X-ByBuy-Eligibility': ticket } : {}) },
      body: JSON.stringify({ code }),
      cache: 'no-store',
      signal: AbortSignal.any([signal, AbortSignal.timeout(65_000)]),
    });
    const result = await response.json() as ApiResponse;
    if (typeof result.ok !== 'boolean') throw new Error('Invalid response');
    return result;
  } catch (error) {
    if (signal.aborted) throw error;
    return networkError(error);
  }
}

export async function submitOrder(code: string, sessionJson: string, ticket: string, signal: AbortSignal): Promise<SubmitResponse> {
  try {
    const response = await fetch('/api/orders/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-ByBuy-Eligibility': ticket },
      body: JSON.stringify({ code, sessionJson, contact: '' }),
      cache: 'no-store',
      signal: AbortSignal.any([signal, AbortSignal.timeout(65_000)]),
    });
    const result = await response.json() as SubmitResponse;
    if (typeof result.ok !== 'boolean') throw new Error('Invalid response');
    return result;
  } catch (error) {
    if (signal.aborted) throw error;
    return networkError(error);
  }
}

type StripeClient = { handleNextAction: (input: { clientSecret: string }) => Promise<{ error?: { message?: string } }> };
declare global { interface Window { Stripe?: (publishableKey: string) => StripeClient } }

let stripeLoader: Promise<void> | null = null;

function loadStripe(): Promise<void> {
  if (window.Stripe) return Promise.resolve();
  if (stripeLoader) return stripeLoader;
  stripeLoader = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-stripe-js]');
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('Stripe load failed')), { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://js.stripe.com/v3/';
    script.async = true;
    script.dataset.stripeJs = 'true';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Stripe load failed'));
    document.head.appendChild(script);
  }).catch(error => { stripeLoader = null; throw error; });
  return stripeLoader;
}

async function completeStripeVerification(details: VerificationDetails): Promise<void> {
  if (details.mode !== 'stripe' || Date.parse(details.expiresAt) <= Date.now()) throw new Error('Verification unavailable');
  await loadStripe();
  const stripe = window.Stripe?.(details.publishableKey);
  if (!stripe) throw new Error('Verification unavailable');
  const result = await stripe.handleNextAction({ clientSecret: details.clientSecret });
  if (result.error) throw new Error('Verification failed');
}

export type VerificationEvent = 'shown' | 'started' | 'succeeded' | 'failed';

/* 同一份验证信息只报一次「出现」：订单页每刷新一次都会拿到同一份信息。
   只记指纹，不把验证密钥留在模块里。 */
const reportedShown = new Set<string>();

function fingerprint(details: VerificationDetails): string {
  let hash = 2166136261;
  for (const char of `${details.mode}|${details.clientSecret}|${details.expiresAt}`) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return String(hash >>> 0);
}

/* 把顾客安全验证的进度告诉服务端，由它转交给充值服务。
   只带卡密和事件名；即发即忘，失败不影响验证本身。 */
export function reportVerification(code: string, event: VerificationEvent, details?: VerificationDetails): void {
  if (event === 'shown' && details) {
    const key = fingerprint(details);
    if (reportedShown.has(key)) return;
    reportedShown.add(key);
  }
  void fetch('/api/orders/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, event }),
    cache: 'no-store',
    keepalive: true,
  }).catch(() => undefined);
}

/* 完成安全验证，并按「开始 → 成功 / 失败」回报进度。 */
export async function runVerification(code: string, details: VerificationDetails): Promise<void> {
  reportVerification(code, 'started');
  try {
    await completeStripeVerification(details);
  } catch (error) {
    reportVerification(code, 'failed');
    throw error;
  }
  reportVerification(code, 'succeeded');
}
