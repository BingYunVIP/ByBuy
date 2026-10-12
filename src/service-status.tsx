import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { CircleAlert, RefreshCw } from 'lucide-react';
import { useLocale } from './locale';

/* ============================================================================
   充值服务的可用性

   轮询自家后端的 /api/service/status（由服务端完成探测），
   前端只接收可用状态和延迟，不接收远端地址或响应内容。

   两个消费方：
     · 顶部的「系统状态」灯 —— 给用户一个信号
     · 充值卡 / 订单卡 —— 服务异常时锁住，不让用户白填一遍表单
   ============================================================================ */

export type ServiceState = 'checking' | 'online' | 'offline';

type ServiceStatus = {
  state: ServiceState;
  latencyMs: number | null;
  retrying: boolean;
  refresh: () => void;
};

const POLL_MS = 30_000;

/* 文案就地定义，不往 locale.tsx 里塞。 */
const TEXT = {
  zh: {
    prefix: '系统状态', checking: '检测中', online: '正常', offline: '异常',
    downTitle: '充值服务暂时不可用',
    downBody: '充值服务当前异常，这部分的操作已暂时停用。稍后再试，或点右侧重新检测。',
    retry: '重新检测', retrying: '检测中…',
  },
  en: {
    prefix: 'System status', checking: 'Checking', online: 'Normal', offline: 'Down',
    downTitle: 'Top-up service unavailable',
    downBody: 'The top-up service is currently unavailable, so this section is disabled. Please try again later, or re-check on the right.',
    retry: 'Re-check', retrying: 'Checking…',
  },
};

const Context = createContext<ServiceStatus | null>(null);

export function ServiceStatusProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ServiceState>('checking');
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(() => { setRetrying(true); setNonce(value => value + 1); }, []);

  useEffect(() => {
    const controller = new AbortController();
    let alive = true;

    async function probe(fresh: boolean) {
      try {
        const response = await fetch(`/api/service/status${fresh ? '?fresh=1' : ''}`, { cache: 'no-store', signal: controller.signal });
        const body = await response.json() as { ok?: boolean; data?: { online?: boolean; latencyMs?: number } };
        if (!alive) return;
        setState(response.ok && body?.ok && body.data?.online ? 'online' : 'offline');
        setLatencyMs(typeof body?.data?.latencyMs === 'number' ? body.data.latencyMs : null);
      } catch {
        /* 连自家后端都打不通时，对访客统一按服务异常处理。 */
        if (alive && !controller.signal.aborted) { setState('offline'); setLatencyMs(null); }
      } finally {
        if (alive) setRetrying(false);
      }
    }

    /* 只有手动「重新检测」才带 fresh=1 穿透缓存；
       定时轮询走缓存，避免每个标签页每 30 秒都触发一次真实探测。 */
    void probe(nonce > 0);
    const timer = setInterval(() => { void probe(false); }, POLL_MS);

    /* 标签页在后台时浏览器会把定时器降到约 1 分钟一次，
       切回来时补一次，避免用户看到过期状态。 */
    const onVisible = () => { if (!document.hidden) void probe(false); };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      alive = false;
      controller.abort();
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [nonce]);

  const value = useMemo(() => ({ state, latencyMs, retrying, refresh }), [state, latencyMs, retrying, refresh]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useServiceStatus(): ServiceStatus {
  const value = useContext(Context);
  if (!value) throw new Error('ServiceStatusProvider required');
  return value;
}

/* ------------------------------------------------------------------ 顶部状态灯 */

export function ServiceBadge() {
  const { state, latencyMs } = useServiceStatus();
  const { lang } = useLocale();
  const copy = lang === 'zh' ? TEXT.zh : TEXT.en;
  return (
    <span
      className={`service-status service-status--${state}`}
      title={latencyMs === null ? `${copy.prefix}：${copy[state]}` : `${copy.prefix}：${copy[state]} · ${latencyMs}ms`}
    >
      <span className="status-dot" aria-hidden="true" />
      <span className="status-prefix">{copy.prefix}：</span>
      <span className="status-value">{copy[state]}</span>
    </span>
  );
}

/* -------------------------------------------------------------- 异常时的说明条 */

export function ServiceNotice() {
  const { retrying, refresh } = useServiceStatus();
  const { lang } = useLocale();
  const copy = lang === 'zh' ? TEXT.zh : TEXT.en;
  return (
    <div className="service-notice" role="alert">
      <CircleAlert size={18} aria-hidden="true" />
      <div className="service-notice-text">
        <strong>{copy.downTitle}</strong>
        <p>{copy.downBody}</p>
      </div>
      <button className="text-button" type="button" onClick={refresh} disabled={retrying}>
        <RefreshCw size={14} className={retrying ? 'spinner' : undefined} aria-hidden="true" />
        {retrying ? copy.retrying : copy.retry}
      </button>
    </div>
  );
}
