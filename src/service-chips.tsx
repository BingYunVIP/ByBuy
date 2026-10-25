import { BadgeCheck, CreditCard, HandCoins, Headphones, LockKeyhole, ShieldCheck, Sparkles } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useLocale } from './locale';

export type ServiceChip = readonly [LucideIcon, string, string];

export function ServiceChips({ items }: { items: readonly ServiceChip[] }) {
  const { lang } = useLocale();
  return (
    <ul className="hero-chips hero-chips--services" aria-label={lang === 'zh' ? '服务保障' : 'Service commitments'}>
      {items.map(([Icon, zh, en], index) => (
        <li key={zh} className="bb-pop" style={{ animationDelay: `${90 + index * 55}ms` }}>
          <Icon size={15} aria-hidden="true" />{lang === 'zh' ? zh : en}
        </li>
      ))}
    </ul>
  );
}

export const heroServiceChips: readonly ServiceChip[] = [
  [ShieldCheck, '官方渠道', 'Official channel'],
  [CreditCard, '正规VISA资金', 'Legit VISA funds'],
  [HandCoins, '只收人工费', 'Service fee only'],
  [LockKeyhole, '数据加密传输', 'Encrypted transfer'],
  [BadgeCheck, '质保订阅一个月', 'One-month subscription warranty'],
  [Headphones, '售后有保障', 'After-sales support'],
] as const;

export const teamServiceChips: readonly ServiceChip[] = [
  heroServiceChips[0],
  heroServiceChips[1],
  heroServiceChips[2],
  heroServiceChips[3],
  [BadgeCheck, '质保25天', '25-day warranty'],
  heroServiceChips[5],
  [Sparkles, 'Team 当成 Plus', 'Team works like Plus'],
] as const;
