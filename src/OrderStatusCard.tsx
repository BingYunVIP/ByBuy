import { Check, CircleCheck, CircleX, Clock3, LoaderCircle, LockKeyhole } from 'lucide-react';
import Alert from './Alert';
import type { OrderResult } from './api';
import { showDate, useLocale } from './locale';
import type { CopyKey } from './locale';

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

interface OrderStatusCardProps {
  result: OrderResult;
  code: string;
  verificationBusy: boolean;
  verificationError: CopyKey | null;
  onVerify: () => void;
}

/* 订单结果卡：订单查询页和充值第三步共用同一份渲染，两处看到的内容完全一致。 */
export default function OrderStatusCard({ result, code, verificationBusy, verificationError, onVerify }: OrderStatusCardProps) {
  const { t, lang } = useLocale();
  const tone = orderTone(result.status);
  const StatusIcon = tone === 'ok' ? CircleCheck : tone === 'progress' ? LoaderCircle : tone === 'muted' ? Clock3 : CircleX;
  const labels = lang === 'zh' ? TIMELINE_ZH : TIMELINE_EN;
  const timeline = [
    { key: 'placed', label: labels.placed, at: result.createdAt },
    { key: 'processing', label: labels.processing, at: result.processingAt },
    { key: 'done', label: labels.done, at: result.completedAt },
  ];
  /* 走到第几个节点 —— 以最后一个有时间的节点为准，缺时间戳的节点不算走到。 */
  const reached = timeline.reduce((count, item, index) => (item.at ? index + 1 : count), 0);

  return <div className={`order-result order-result--${tone} bb-rise`} aria-live="polite">
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

        {result.verification ? <Alert tone="info" role="alert">
          <span className="alert-text">{t('verificationHint')}</span>
          <button className="text-button" type="button" disabled={verificationBusy} onClick={onVerify}>{verificationBusy ? <LoaderCircle className="spinner" size={15} /> : <LockKeyhole size={15} />}{t(verificationBusy ? 'verifyingPayment' : 'completeVerification')}</button>
        </Alert> : result.requiresVerification ? <Alert tone="error">{t('verificationUnavailable')}</Alert> : null}
        {verificationError ? <Alert tone="error">{t(verificationError)}</Alert> : null}
  </div>;
}
