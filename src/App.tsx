import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import {
  BadgeCheck, BadgeDollarSign, Ban, BookOpenText, Check, ChevronDown, CircleCheck, CircleX, Clock3, CreditCard, HandCoins, Info,
  Languages, LoaderCircle, LockKeyhole, MapPin, Moon, Repeat2, RotateCcw, Search, ShieldCheck, Sun,
  TriangleAlert, UsersRound,
} from 'lucide-react';
import CardField from './CardField';
import { completeStripeVerification, requestCard } from './api';
import type { OrderResult } from './api';
import { errorKey, showDate, useLocale } from './locale';
import type { CopyKey } from './locale';
import { ServiceBadge, ServiceNotice, ServiceStatusProvider, useServiceStatus } from './service-status';
import './styles.slim.css';
import './styles.motion.css';
import './styles.order.css';
import './styles.tune.css';

const Recharge = lazy(() => import('./SubscriptionCheck'));
const ORDER_POLL_MS = 5_000;

const SUPPORT = 'https://qm.qq.com/q/6fuAq8mBwW';
const DOCS = 'https://docs.bingyun.vip/zh/posts/shop/chatgpt/';
/* 外链直接指向 ChatGPT 这个 App 的全球价格对比页，而不是站点首页。
   App Store ID 6448311069 = ChatGPT。 */
const PRICES = 'https://appstoreprice.org/zh/apps/6448311069';
const BYAI = 'https://api.bingyun.vip';

/* Hero 关键词胶囊：保持统一尺寸与现有动效，补充套餐、保障和地区信息。 */
const heroChips = [
  [ShieldCheck, '官方渠道', 'Official channel'],
  [CreditCard, '正规VISA资金', 'Legit VISA funds'],
  [HandCoins, '只收人工费', 'Service fee only'],
  [LockKeyhole, '数据加密传输', 'Encrypted transfer'],
  [RotateCcw, '失败可退', 'Refund on failure'],
  [BadgeDollarSign, 'Plus 125r', 'Plus 125r'],
  [BadgeDollarSign, 'Pro 5x 700r', 'Pro 5x 700r'],
  [BadgeDollarSign, 'Pro 20x 1100r', 'Pro 20x 1100r'],
  [BadgeDollarSign, 'Pro 25x 3200r', 'Pro 25x 3200r'],
  [Repeat2, '复购有优惠', 'Repeat-order discount'],
  [BadgeCheck, '质保一个月的订阅', 'One-month subscription warranty'],
  [MapPin, '菲律宾', 'Philippines'],
  [MapPin, '智利', 'Chile'],
] as const;

/* 注意事项。夹在引导条和充值卡之间 —— 提交前一定会看到。
   11 条平铺下来没人读得下去，所以按「严重程度」分三组、各给一个颜色：
   琥珀 = 先确认账号状态，红 = 别提交，绿 = 建议与保障。
   桌面端三组并排（整块只占一张卡的高度），窄屏自动堆叠。
   颜色走 styles.css 里已有的 --warn / --danger / --ok 令牌，深色模式自动跟着变。 */
const noticeGroups = [
  {
    key: 'warn',
    icon: TriangleAlert,
    title: ['充值前先确认账号状态', 'Check your account first'],
    items: [
      ['账号当前是 **Plus / Team / Pro** → 请等过期后再充值。',
       'Account is currently **Plus / Team / Pro** → wait until it expires.'],
      ['刚到期、已是免费版，但页面仍显示 Plus → 是浏览器缓存：清理缓存后重新登录 ChatGPT，再重新获取 Session。',
       'Just expired (already free) but still shows Plus → that is browser cache: clear it, sign in to ChatGPT again, then fetch a new Session.'],
      ['已到期但账户仍显示 Plus → 到「**设置 → 账单**」取消自动续费，再充值。',
       'Expired but the account still shows Plus → cancel auto-renew under **Settings → Billing**, then recharge.'],
    ],
  },
  {
    key: 'danger',
    icon: Ban,
    title: ['这些情况请勿提交', 'Do not submit'],
    items: [
      ['之前买过非正常渠道的 Pro / Plus（例如 0 元购、谷歌内购、低价黑冲等账号），请勿提交。',
       'Accounts previously bought through abnormal channels (free-claim Pro/Plus, Google in-app purchase, cheap grey-market top-ups) — do not submit.'],
      ['**不要提交中文的 Session 信息。**',
       '**Do not submit a Chinese-language Session.**'],
      ['提示 **401 token 过期** 或 **access Token 过期**的 Session 请勿提交 → 重新登录 ChatGPT，获取最新的 Session 再提交。',
       'A Session reporting **401 / access token expired** — do not submit it. Sign in to ChatGPT again, fetch a fresh Session, then submit.'],
    ],
  },
  {
    key: 'safe',
    icon: ShieldCheck,
    title: ['建议与保障', 'Recommendations'],
    items: [
      ['建议使用 **Gmail（强烈建议）**、QQ、163、126 邮箱；充值成功后会有邮件发送到您的邮箱。',
       'Use **Gmail (strongly recommended)**, QQ, 163 or 126 mail — a confirmation email is sent after a successful recharge.'],
      ['**卡密即凭证，请勿泄露给他人。**',
       '**Your code is your proof of purchase — keep it private.**'],
      ['因违规行为导致的问题（包括但不限于破限、邮件欺诈、网络滥用、违反 OpenAI 平台使用条款等）无法退款，请遵守使用规则以保障自身权益。',
       'No refunds for issues caused by violations (including but not limited to bypassing usage limits, mail fraud, network abuse, or breaching the OpenAI usage terms). Follow the rules to protect your own interests.'],
    ],
  },
];

/* 把 **…** 渲染成 <strong>，省得为几个加粗词写一堆 JSX。 */
function emphasize(text: string) {
  return text.split('**').map((part, index) => (index % 2 ? <strong key={index}>{part}</strong> : part));
}

function NoticeBoard() {
  const { lang } = useLocale();
  const zh = lang === 'zh';
  const [expanded, setExpanded] = useState(true);
  return (
    <section className={`notice-board bb-rise${expanded ? '' : ' notice-board--collapsed'}`} style={{ animationDelay: '180ms' }} aria-labelledby="notice-board-title">
      <button className="notice-board-head" type="button" aria-expanded={expanded} aria-controls="notice-board-content" onClick={() => setExpanded(value => !value)}>
        <Info size={16} aria-hidden="true" />
        <h2 id="notice-board-title">{zh ? '注意事项' : 'Before you start'}</h2>
        <p>{zh ? '提交前先看一遍，能省掉大部分失败和退款纠纷。' : 'A quick read saves most failures and refund disputes.'}</p>
        <ChevronDown className="notice-toggle-icon" size={16} aria-hidden="true" />
      </button>
      {expanded ? <div className="notice-groups" id="notice-board-content">
        {noticeGroups.map(({ key, icon: Icon, title, items }) => (
          <div key={key} className={`notice-group notice-group--${key}`}>
            <p className="notice-group-title"><Icon size={14} aria-hidden="true" />{title[zh ? 0 : 1]}</p>
            <ul>
              {items.map((item, index) => <li key={index}>{emphasize(item[zh ? 0 : 1])}</li>)}
            </ul>
          </div>
        ))}
      </div> : null}
    </section>
  );
}


const orderStatus: Record<OrderResult['status'], CopyKey> = {
  COMPLETED: 'completed', PROCESSING: 'processing', PENDING: 'queued', FAILED: 'failed',
  CANCELLED: 'cancelled', PLAN_MISMATCH: 'failed', SUSPICIOUS: 'needsHelp', REQUIRES_NEW_SESSION: 'needsHelp', UNKNOWN: 'unknown',
};

/* 订单状态的语义分组：决定标题卡、时间轴用哪套配色。 */
function orderTone(status: OrderResult['status']) {
  if (status === 'COMPLETED') return 'ok';
  if (status === 'PROCESSING' || status === 'PENDING') return 'progress';
  if (status === 'UNKNOWN') return 'muted';
  return 'bad';
}

/* 时间轴节点名。locale.tsx 里没有对应文案键，而那个文件不该被这次改动碰，
   所以就地按语言定义两份，避免往共用文案表里塞东西。 */
const TIMELINE_ZH = { placed: '提交订单', processing: '开始处理', done: '充值完成' };
const TIMELINE_EN = { placed: 'Order placed', processing: 'Processing', done: 'Completed' };

/* 卡密只显示头尾，中间打码 —— 和页面里其它地方一样不暴露完整凭证。 */
function maskCode(value: string) {
  const parts = value.trim().split('-');
  if (parts.length < 3) return value;
  return `${parts[0]}-${parts[1]}-••••-${parts[parts.length - 1]}`;
}

function OrderView({ initialCode }: { initialCode: string }) {
  const { t, lang } = useLocale();
  const { state } = useServiceStatus();
  const [code, setCode] = useState(initialCode);
  const [result, setResult] = useState<OrderResult | null>(null);
  const [error, setError] = useState<CopyKey | null>(null);
  const [pending, setPending] = useState(false);
  const [verificationBusy, setVerificationBusy] = useState(false);
  const [verificationError, setVerificationError] = useState<CopyKey | null>(null);
  const controller = useRef<AbortController | null>(null);
  /* 服务异常时整块停用：不让用户填完卡密再吃一个「暂时无法连接」。 */
  const locked = state === 'offline';

  /* 卸载时中断，并且顺手把 ref 清空。
     如果只 abort 不置空，StrictMode 的「挂载 → 清理 → 再挂载」会让第二次自动查询
     撞上 `if (controller.current) return` 直接返回，页面就永远停在骨架屏上。 */
  useEffect(() => () => { controller.current?.abort(); controller.current = null; }, []);

  async function query(background = false) {
    if (controller.current) return;
    setError(null); setVerificationError(null);
    const value = code.trim().toUpperCase();
    if (!/^[A-Z0-9]+(?:-[A-Z0-9]+)+$/.test(value) || value.length < 6) { setError('cardInvalid'); return; }
    const current = new AbortController(); controller.current = current; if (!background) setPending(true);
    try {
      const response = await requestCard('query', value, current.signal);
      if (current.signal.aborted) return;
      if (response.ok && response.data.kind === 'order') { setResult(response.data); setError(null); }
      else if (!response.ok) { setResult(null); setError(errorKey(response.error.code)); }
    } catch { /* 主动中断时 requestCard 会把 AbortError 抛出来，这里吞掉即可 */ }
    finally { if (controller.current === current) { controller.current = null; if (!background) setPending(false); } }
  }

  async function verifyOrder() {
    const details = result?.verification;
    if (!details || controller.current) return;
    const current = new AbortController(); controller.current = current; setVerificationBusy(true); setVerificationError(null);
    try {
      await completeStripeVerification(details);
      if (current.signal.aborted) return;
      await new Promise(resolve => setTimeout(resolve, 1000));
      const response = await requestCard('query', code.trim().toUpperCase(), current.signal);
      if (response.ok && response.data.kind === 'order') setResult(response.data);
      else setVerificationError('verificationFailed');
    } catch {
      if (!current.signal.aborted) setVerificationError('verificationFailed');
    } finally {
      if (controller.current === current) { controller.current = null; setVerificationBusy(false); }
    }
  }

  /* 从充值流程点「查询此卡密」跳过来时卡密已经在手上，直接查，不用再点一次。 */
  useEffect(() => { if (initialCode.trim()) void query(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!result || !['PENDING', 'PROCESSING'].includes(result.status) || result.verification) return;
    const timer = window.setTimeout(() => void query(true), ORDER_POLL_MS);
    return () => window.clearTimeout(timer);
  }, [result]); // eslint-disable-line react-hooks/exhaustive-deps

  const tone = result ? orderTone(result.status) : 'muted';
  const StatusIcon = tone === 'ok' ? CircleCheck : tone === 'progress' ? LoaderCircle : tone === 'muted' ? Clock3 : CircleX;

  const timeline = result ? [
    { key: 'placed', label: (lang === 'zh' ? TIMELINE_ZH : TIMELINE_EN).placed, at: result.createdAt },
    { key: 'processing', label: (lang === 'zh' ? TIMELINE_ZH : TIMELINE_EN).processing, at: result.processingAt },
    { key: 'done', label: (lang === 'zh' ? TIMELINE_ZH : TIMELINE_EN).done, at: result.completedAt },
  ] : [];
  /* 走到第几个节点 —— 以最后一个有时间的节点为准，缺时间戳的节点不算走到。 */
  const reached = timeline.reduce((count, item, index) => (item.at ? index + 1 : count), 0);

  return <>
    <section className="page-intro bb-rise">
      <h1>{t('orderTitle')}</h1>
    </section>

    {locked ? <ServiceNotice /> : null}

    <section className={`flow-card order-card bb-rise${locked ? ' flow-card--locked' : ''}`} style={{ animationDelay: '80ms' }} aria-disabled={locked || undefined}>
      <form onSubmit={event => { event.preventDefault(); void query(); }} aria-busy={pending} inert={locked || undefined}>
        <CardField value={code} onChange={value => { setCode(value); setResult(null); setError(null); setVerificationError(null); }} disabled={pending || verificationBusy || locked} />
        {error ? <p className="notice bb-rise warning" role="alert">{t(error)}</p> : null}
        <button className="primary-button" disabled={pending || verificationBusy || locked}>{pending ? <LoaderCircle className="spinner" size={16} /> : <Search size={16} />}{t(pending ? 'querying' : result ? 'refresh' : 'query')}</button>
      </form>

      {pending ? <div className="result-pending" role="status" aria-label={t('querying')}>
        <span className="skeleton-bar" /><span className="skeleton-bar" />
      </div> : result ? <div className={`order-result order-result--${tone} bb-rise`} aria-live="polite">
        <div className="order-headline">
          <span className="order-mark"><StatusIcon size={22} className={tone === 'progress' ? 'spinner' : undefined} aria-hidden="true" /></span>
          <div>
            <h2>{t(orderStatus[result.status])}</h2>
            <p>{t('plan')} · <strong>{result.plan}</strong></p>
          </div>
        </div>

        <dl className="order-facts">
          <div><dt>{t('account')}</dt><dd>{result.accountMasked ?? '—'}</dd></div>
          <div><dt>{t('orderNo')}</dt><dd>{result.orderNoMasked ?? '—'}</dd></div>
          <div><dt>{t('card')}</dt><dd>{maskCode(code)}</dd></div>
        </dl>

        {reached > 0 ? <ol className="order-timeline">
          {timeline.map((item, index) => (
            <li key={item.key} className={index < reached - 1 ? 'done' : index === reached - 1 ? 'current' : 'pending'}>
              <span className="tl-dot">{index < reached ? <Check size={12} aria-hidden="true" /> : null}</span>
              <span className="tl-label">{item.label}</span>
              <time className="tl-time">{showDate(item.at, lang)}</time>
            </li>
          ))}
        </ol> : null}

        {result.verification ? <div className="notice bb-rise warning" role="alert">
          <span>{t('completeVerification')}</span>
          <button className="text-button" type="button" disabled={verificationBusy} onClick={() => void verifyOrder()}>{verificationBusy ? <LoaderCircle className="spinner" size={15} /> : <LockKeyhole size={15} />}{t(verificationBusy ? 'verifyingPayment' : 'completeVerification')}</button>
        </div> : result.requiresVerification ? <p className="notice bb-rise warning">{t('verificationUnavailable')}</p> : null}
        {verificationError ? <p className="notice bb-rise warning" role="alert">{t(verificationError)}</p> : null}
      </div> : null}
    </section>
  </>;
}

function RechargePage({ onQuery }: { onQuery: (code: string) => void }) {
  const { t, lang } = useLocale();
  /* 每次打开页面随机挑一个关键词胶囊放大，给首屏一个视觉焦点，
     也顺带让每次访问看起来不完全一样。
     用 useState 的惰性初始化，保证只在挂载时算一次 —— 重渲染时不会跳来跳去。 */
  const [featured] = useState(() => Math.floor(Math.random() * heroChips.length));
  return <>
    <section className="hero hero--slim">
      <div className="container hero-slim">
        <h1 className="bb-rise">{t('heroTitle')}</h1>
        <ul className="hero-chips">
          {heroChips.map(([Icon, zh, en], index) => (
            <li
              key={zh}
              className={index === featured ? 'bb-pop hero-chip--featured' : 'bb-pop'}
              style={{ animationDelay: `${90 + index * 55}ms` }}
            >
              <Icon size={15} aria-hidden="true" />{lang === 'zh' ? zh : en}
            </li>
          ))}
        </ul>
      </div>
    </section>

    <section className="task-section" id="recharge">
      <div className="container">
        <NoticeBoard />
        <Suspense fallback={<p className="loading-page" role="status"><LoaderCircle className="spinner" size={18} />{t('checking')}</p>}>
          <Recharge onQuery={onQuery} />
        </Suspense>
      </div>
    </section>
  </>;
}

function Shell() {
  const { t, lang, theme, toggleLanguage, toggleTheme } = useLocale();
  const [page, setPage] = useState<'recharge' | 'order'>(location.pathname === '/order' ? 'order' : 'recharge');
  const [orderCode, setOrderCode] = useState('');
  function navigate(next: 'recharge' | 'order', code = '') {
    setPage(next); setOrderCode(code); history.pushState(null, '', next === 'order' ? '/order' : '/');
  }
  useEffect(() => {
    const changed = () => { setPage(location.pathname === '/order' ? 'order' : 'recharge'); setOrderCode(''); };
    addEventListener('popstate', changed); return () => removeEventListener('popstate', changed);
  }, []);
  return <>
    <a className="skip-link" href="#main-content">{t('skip')}</a>

    <header className="site-header">
      <div className="header-content">
        <a href="/" className="brand" onClick={event => { event.preventDefault(); navigate('recharge'); }} aria-label={t('brand')}>
          <img src="/logo.png" width="32" height="32" alt="" /><span>{t('brand')}</span>
        </a>
        <nav aria-label={t('nav')} className="header-links">
          <button onClick={() => navigate(page === 'order' ? 'recharge' : 'order')} className={page === 'order' ? 'active' : ''}><Clock3 size={16} aria-hidden="true" /><span>{t(page === 'order' ? 'home' : 'orders')}</span></button>
          <a href={DOCS} target="_blank" rel="noopener noreferrer"><BookOpenText size={16} aria-hidden="true" /><span>{t('shop')}</span></a>
          <a href={PRICES} target="_blank" rel="noopener noreferrer"><span className="brand-icon appstore-icon" aria-hidden="true" /><span>{t('prices')}</span></a>
          <a href={BYAI} target="_blank" rel="noopener noreferrer"><span className="brand-icon chatgpt-icon" aria-hidden="true" /><span>{t('ai')}</span></a>
          <a href={SUPPORT} target="_blank" rel="noopener noreferrer"><UsersRound size={16} aria-hidden="true" /><span>{t('support')}</span></a>
        </nav>
        <div className="header-settings">
          <ServiceBadge />
          <span className="settings-divider" />
          <button className="icon-button" onClick={toggleTheme} aria-label={t(theme === 'light' ? 'dark' : 'light')}>{theme === 'light' ? <Moon size={17} /> : <Sun size={17} />}</button>
          <span className="settings-divider" />
          <button className="language-button" onClick={toggleLanguage} aria-label={t('language')}><Languages size={16} /><span>{lang === 'zh' ? 'EN' : '中文'}</span></button>
        </div>
      </div>
    </header>

    <main id="main-content">
      {page === 'order'
        ? <div className="container page-shell"><OrderView key={orderCode} initialCode={orderCode} /></div>
        : <RechargePage onQuery={code => navigate('order', code)} />}
    </main>
  </>;
}

export default function App() {
  return <ServiceStatusProvider><Shell /></ServiceStatusProvider>;
}
