import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import {
  Ban, Check, ChevronDown, CircleCheck, CircleX, Clock3, Info,
  Languages, LoaderCircle, LockKeyhole, Moon, Search, ShieldCheck, Sun,
  TriangleAlert,
} from 'lucide-react';
import CardField from './CardField';
import { reportVerification, requestCard, runVerification } from './api';
import type { OrderResult } from './api';
import { errorKey, showDate, useLocale } from './locale';
import type { CopyKey } from './locale';
import ProductSwitch from './ProductSwitch';
import type { ProductPage } from './ProductSwitch';
import { heroServiceChips, ServiceChips } from './service-chips';
import { ServiceBadge, ServiceNotice, ServiceStatusProvider, useServiceStatus } from './service-status';
import './styles.slim.css';
import './styles.motion.css';
import './styles.order.css';
import './styles.tune.css';
import './styles.team.css';
import './styles.unified.css';

const Recharge = lazy(() => import('./SubscriptionCheck'));
const TeamRedeem = lazy(() => import('./TeamRedeem'));
const ORDER_POLL_MS = 5_000;

/* 顶部导航的外链。SHOP 是卡密购买入口，与冰云首页「冰云商店」指向同一站点。 */
const SUPPORT = 'https://qm.qq.com/q/6fuAq8mBwW';
const SHOP = 'https://shop.bingyun.vip';
const EMAIL = 'support@bingyun.vip';
/* 外链直接指向 ChatGPT 这个 App 的全球价格对比页，而不是站点首页。
   App Store ID 6448311069 = ChatGPT。 */
const PRICES = 'https://appstoreprice.org/zh/apps/6448311069';
const BYAI = 'https://api.bingyun.vip';

/* 顶部导航（订单查询是站内路由，单独渲染，所以不在这份表里）。 */
const navLinks = [
  { key: 'prices', href: PRICES, icon: 'appstore', external: true },
  { key: 'ai', href: BYAI, icon: 'openai', external: true },
  { key: 'store', href: SHOP, icon: 'bag', external: true },
  { key: 'support', href: SUPPORT, icon: 'users', external: true },
  { key: 'email', href: `mailto:${EMAIL}`, icon: 'mail', external: false },
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

function notifyRouteChange() { window.dispatchEvent(new Event('bybuy:navigate')); }

/* 把 **…** 渲染成 <strong>，省得为几个加粗词写一堆 JSX。 */
function emphasize(text: string) {
  return text.split('**').map((part, index) => (index % 2 ? <strong key={index}>{part}</strong> : part));
}

/* 顶部导航图标。按「冰云首页有则复用、没有则保持原样」处理：
   订单查询 / 全球价格比对沿用 ByBuy 原有图标；
   AI 中转站、冰云小店、售后群、联系邮箱复用冰云首页（ByHome_UI）的导航标记。 */
function NavIcon({ name }: { name: 'clock' | 'appstore' | 'openai' | 'bag' | 'users' | 'mail' }) {
  if (name === 'clock') return <Clock3 size={17} aria-hidden="true" />;
  if (name === 'appstore') return <span className="brand-icon appstore-icon" aria-hidden="true" />;
  if (name === 'openai') return <svg aria-hidden="true" viewBox="0 0 24 24"><path fill="currentColor" d="M22.418 9.822a5.903 5.903 0 0 0-.52-4.91 6.1 6.1 0 0 0-2.822-2.513 6.204 6.204 0 0 0-3.78-.389A6.055 6.055 0 0 0 13.232.518 6.129 6.129 0 0 0 10.726 0a6.185 6.185 0 0 0-3.615 1.153A6.052 6.052 0 0 0 4.88 4.187a6.102 6.102 0 0 0-2.344 1.018A6.008 6.008 0 0 0 .828 7.087a5.981 5.981 0 0 0 .754 7.09 5.904 5.904 0 0 0 .52 4.911 6.101 6.101 0 0 0 2.821 2.513 6.205 6.205 0 0 0 3.78.389 6.057 6.057 0 0 0 2.065 1.492 6.13 6.13 0 0 0 2.505.518 6.185 6.185 0 0 0 3.617-1.154 6.052 6.052 0 0 0 2.232-3.035 6.101 6.101 0 0 0 2.343-1.018 6.009 6.009 0 0 0 1.709-1.883 5.981 5.981 0 0 0-.756-7.088Zm-9.143 12.609a4.583 4.583 0 0 1-2.918-1.04c.037-.02.102-.056.144-.081l4.844-2.76a.783.783 0 0 0 .397-.68v-6.738L17.79 12.3a.072.072 0 0 1 .04.055v5.58a4.473 4.473 0 0 1-1.335 3.176 4.596 4.596 0 0 1-3.219 1.321Zm-9.793-4.127a4.432 4.432 0 0 1-.544-3.014c.036.021.099.06.144.085l4.843 2.76a.796.796 0 0 0 .795 0l5.913-3.369V17.1a.071.071 0 0 1-.029.062L9.708 19.95a4.617 4.617 0 0 1-3.458.447 4.556 4.556 0 0 1-2.768-2.093ZM2.208 7.872A4.527 4.527 0 0 1 4.58 5.9l-.002.164v5.52a.768.768 0 0 0 .397.68l5.913 3.369-2.047 1.166a.075.075 0 0 1-.069.006l-4.896-2.792a4.51 4.51 0 0 1-2.12-2.73 4.45 4.45 0 0 1 .452-3.411Zm16.818 3.861-5.913-3.368 2.047-1.166a.074.074 0 0 1 .07-.006l4.896 2.789a4.526 4.526 0 0 1 1.762 1.815 4.448 4.448 0 0 1-.418 4.808 4.556 4.556 0 0 1-2.049 1.494v-5.686a.767.767 0 0 0-.395-.68Zm2.038-3.025a6.874 6.874 0 0 0-.144-.085l-4.843-2.76a.797.797 0 0 0-.796 0L9.368 9.23V6.9a.072.072 0 0 1 .03-.062l4.895-2.787a4.608 4.608 0 0 1 4.885.207 4.51 4.51 0 0 1 1.599 1.955c.333.788.433 1.654.287 2.496ZM8.255 12.865 6.208 11.7a.071.071 0 0 1-.04-.056v-5.58c0-.854.248-1.69.713-2.412a4.54 4.54 0 0 1 1.913-1.658 4.614 4.614 0 0 1 4.85.616c-.037.02-.102.055-.144.08L8.657 5.452a.782.782 0 0 0-.398.68l-.004 6.734ZM9.367 10.5 12.001 9l2.633 1.5v3L12.001 15l-2.634-1.5v-3Z" /></svg>;
  if (name === 'bag') return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7}><path d="m3 9 2-6h14l2 6M4 13v8h16v-8M9 21v-7h6v7" /><path d="M3 9a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0H3Z" /></svg>;
  if (name === 'users') return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /><circle cx="9" cy="7" r="4" /></svg>;
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7}><rect height="14" rx="3" width="18" x="3" y="5" /><path d="m3 7 9 6 9-6" /></svg>;
}

type ChatgptView = 'recharge' | 'order';

/* 桌面端居中排列、窄屏折叠进菜单面板，两处渲染同一份导航数据。 */
function HeaderNav({ product, chatgptView, navigateChatgpt }: {
  product: ProductPage;
  chatgptView: ChatgptView;
  navigateChatgpt: (next: ChatgptView, code?: string) => void;
}) {
  const { t } = useLocale();
  return <>
    {product === 'chatgpt' ? <button type="button" onClick={() => navigateChatgpt(chatgptView === 'order' ? 'recharge' : 'order')} className={chatgptView === 'order' ? 'active' : ''} aria-current={chatgptView === 'order' ? 'page' : undefined}>
      <NavIcon name="clock" /><span>{t(chatgptView === 'order' ? 'home' : 'orders')}</span>
    </button> : null}
    {navLinks.map(item => (
      <a key={item.key} href={item.href} {...(item.external ? { target: '_blank', rel: 'noopener noreferrer' } : { title: EMAIL })}>
        <NavIcon name={item.icon} /><span>{t(item.key)}</span>
      </a>
    ))}
  </>;
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
      await runVerification(code.trim().toUpperCase(), details);
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

  /* 验证提示出现时回报一次（同一份验证信息只报一次，去重在 reportVerification 里）。 */
  const pendingVerification = result?.verification ?? null;
  useEffect(() => { if (pendingVerification) reportVerification(code.trim().toUpperCase(), 'shown', pendingVerification); }, [pendingVerification]); // eslint-disable-line react-hooks/exhaustive-deps

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

function RechargePage({ onQuery, onNavigateProduct }: { onQuery: (code: string) => void; onNavigateProduct: (next: ProductPage) => void }) {
  const { t } = useLocale();
  /* 每次打开页面随机挑一个关键词胶囊放大，给首屏一个视觉焦点，
     也顺带让每次访问看起来不完全一样。
     用 useState 的惰性初始化，保证只在挂载时算一次 —— 重渲染时不会跳来跳去。 */
  return <div className="chatgpt-page">
    <section className="hero hero--slim">
      <div className="container hero-slim">
        <div className="route-switch-row bb-rise">
          <span className="guide-pointer" aria-hidden="true">👉</span>
          <ProductSwitch product="chatgpt" navigateProduct={onNavigateProduct} center />
        </div>
        <h1 className="bb-rise">{t('heroTitle')}</h1>
        <ServiceChips items={heroServiceChips} />
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
  </div>;
}

function Shell() {
  const { t, lang, theme, toggleLanguage, toggleTheme } = useLocale();
  const initialProduct: ProductPage = location.pathname === '/team' ? 'team' : 'chatgpt';
  const initialChatgptView: ChatgptView = location.pathname === '/order' || location.pathname === '/chatgpt/order' ? 'order' : 'recharge';
  const [product, setProduct] = useState<ProductPage>(initialProduct);
  const [chatgptView, setChatgptView] = useState<ChatgptView>(initialChatgptView);
  const [orderCode, setOrderCode] = useState('');
  const menu = useRef<HTMLDetailsElement>(null);
  function canonicalizePath() {
    const pathname = location.pathname;
    if (pathname === '/') history.replaceState(null, '', '/chatgpt');
    else if (pathname === '/order') history.replaceState(null, '', '/chatgpt/order');
    else if (pathname === '/redeem' || pathname === '/subscription') history.replaceState(null, '', '/chatgpt');
  }
  useEffect(() => {
    canonicalizePath();
    const changed = () => {
      canonicalizePath();
      const isTeam = location.pathname === '/team';
      const isOrder = location.pathname === '/order' || location.pathname === '/chatgpt/order';
      setProduct(isTeam ? 'team' : 'chatgpt');
      setChatgptView(isOrder ? 'order' : 'recharge');
      setOrderCode('');
    };
    addEventListener('popstate', changed);
    return () => removeEventListener('popstate', changed);
  }, []);
  function navigateProduct(next: ProductPage) {
    setProduct(next);
    if (next === 'team') {
      setOrderCode('');
      if (location.pathname !== '/team') history.pushState(null, '', '/team');
    } else {
      setChatgptView('recharge');
      setOrderCode('');
      if (location.pathname !== '/chatgpt') history.pushState(null, '', '/chatgpt');
    }
    notifyRouteChange();
  }
  function navigateChatgpt(next: ChatgptView, code = '') {
    setProduct('chatgpt');
    setChatgptView(next);
    setOrderCode(code);
    const pathname = next === 'order' ? '/chatgpt/order' : '/chatgpt';
    if (location.pathname !== pathname) history.pushState(null, '', pathname);
    notifyRouteChange();
  }
  useEffect(() => {
    document.title = lang === 'zh'
      ? (product === 'team' ? 'Team 兑换 · ByBuy' : chatgptView === 'order' ? '订单查询 · ByBuy' : 'ChatGPT 自助充值 · ByBuy')
      : (product === 'team' ? 'Team Redeem · ByBuy' : chatgptView === 'order' ? 'Order lookup · ByBuy' : 'ChatGPT Top-Up · ByBuy');
  }, [lang, product, chatgptView]);
  /* 窄屏菜单：点面板里任意一项就收起，点面板外也收起，
     免得它浮在内容上面挡住表单。 */
  useEffect(() => {
    const outside = (event: MouseEvent) => {
      const element = menu.current;
      if (element?.open && !element.contains(event.target as Node)) element.open = false;
    };
    document.addEventListener('click', outside);
    return () => document.removeEventListener('click', outside);
  }, []);
  return <>
    <a className="skip-link" href="#main-content">{t('skip')}</a>

    <header className="site-header">
      <div className="header-content">
        <a href="/chatgpt" className="brand" onClick={event => { event.preventDefault(); navigateProduct('chatgpt'); }} aria-label={t('brand')}>
          <img src="/logo.png" width="32" height="32" alt="" /><span>{t('brand')}</span>
        </a>

        <nav aria-label={t('nav')} className="header-links">
          <HeaderNav product={product} chatgptView={chatgptView} navigateChatgpt={navigateChatgpt} />
        </nav>

        <div className="header-settings">
          <ServiceBadge />
          <span className="settings-divider" aria-hidden="true" />
          <button className="icon-button" onClick={toggleTheme} aria-label={t(theme === 'light' ? 'dark' : 'light')}>{theme === 'light' ? <Moon size={17} /> : <Sun size={17} />}</button>
          <span className="settings-divider" aria-hidden="true" />
          <button className="language-button" onClick={toggleLanguage} aria-label={t('language')}><Languages size={16} /><span>{lang === 'zh' ? 'EN' : '中文'}</span></button>
          <details className="header-menu" ref={menu}>
            <summary aria-label={t('menu')}><span className="burger" aria-hidden="true" /></summary>
            <div className="header-menu-panel" onClick={() => { if (menu.current) menu.current.open = false; }}>
              <ProductSwitch product={product} navigateProduct={navigateProduct} center={false} />
              <HeaderNav product={product} chatgptView={chatgptView} navigateChatgpt={navigateChatgpt} />
            </div>
          </details>
        </div>
      </div>
    </header>

    <main id="main-content">
      {product === 'team' ? <div className="team-page"><Suspense fallback={<p className="loading-page" role="status"><LoaderCircle className="spinner" size={18} />{lang === 'zh' ? '正在打开 Team 兑换…' : 'Loading Team redemption…'}</p>}><TeamRedeem onNavigateProduct={navigateProduct} /></Suspense></div>
        : chatgptView === 'order'
          ? <div className="order-page"><div className="container page-shell"><div className="route-switch-row order-route-switch"><span className="guide-pointer" aria-hidden="true">👉</span><ProductSwitch product="chatgpt" navigateProduct={navigateProduct} center /></div><OrderView key={orderCode} initialCode={orderCode} /></div></div>
          : <RechargePage onQuery={code => navigateChatgpt('order', code)} onNavigateProduct={navigateProduct} />}
    </main>
  </>;
}

export default function App() {
  return <ServiceStatusProvider><Shell /></ServiceStatusProvider>;
}
