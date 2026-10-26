import { Children, Fragment } from 'react';
import type { ReactNode } from 'react';
import { CircleAlert, CircleCheck, Info } from 'lucide-react';
import { SUPPORT } from './links';

export type AlertTone = 'error' | 'info' | 'success';

const ICONS = { error: CircleAlert, info: Info, success: CircleCheck } as const;
const SUPPORT_WORDS = /(网站客服|website support)/;

/* 文案里出现「网站客服」时自动变成指向售后群的链接，文案表里不用写链接。 */
function withSupportLink(text: string) {
  return text.split(SUPPORT_WORDS).map((part, index) => SUPPORT_WORDS.test(part)
    ? <a key={index} className="alert-link" href={SUPPORT} target="_blank" rel="noopener noreferrer">{part}</a>
    : <Fragment key={index}>{part}</Fragment>);
}

interface AlertProps {
  tone: AlertTone;
  role?: 'alert' | 'status';
  children: ReactNode;
}

/* 全站唯一的提示框：颜色只看含义（红＝出错，蓝＝需要你做一步 / 提示，绿＝成功），与页面无关。 */
export default function Alert({ tone, role, children }: AlertProps) {
  const Icon = ICONS[tone];
  return <div className={`alert alert--${tone} bb-rise`} role={role ?? (tone === 'error' ? 'alert' : 'status')}>
    <Icon size={17} aria-hidden="true" />
    {Children.map(children, child => typeof child === 'string'
      ? <span className="alert-text">{withSupportLink(child)}</span> : child)}
  </div>;
}
