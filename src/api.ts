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

export async function completeStripeVerification(details: VerificationDetails): Promise<void> {
  if (details.mode !== 'stripe' || Date.parse(details.expiresAt) <= Date.now()) throw new Error('Verification unavailable');
  await loadStripe();
  const stripe = window.Stripe?.(details.publishableKey);
  if (!stripe) throw new Error('Verification unavailable');
  const result = await stripe.handleNextAction({ clientSecret: details.clientSecret });
  if (result.error) throw new Error('Verification failed');
}
