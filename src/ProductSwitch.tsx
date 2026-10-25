import { BadgeCheck, ShieldCheck } from 'lucide-react';
import { useLocale } from './locale';

export type ProductPage = 'chatgpt' | 'team';

type ProductSwitchProps = {
  product: ProductPage;
  navigateProduct: (next: ProductPage) => void;
  center?: boolean;
};

/** One shared business switch used in the header menu and both page heroes. */
export default function ProductSwitch({ product, navigateProduct, center = false }: ProductSwitchProps) {
  const { lang } = useLocale();
  const zh = lang === 'zh';
  return (
    <div className={`product-switch${center ? ' product-switch-center' : ''}`} role="group" aria-label={zh ? '业务入口' : 'Product areas'}>
      <button type="button" aria-pressed={product === 'chatgpt'} className={product === 'chatgpt' ? 'active' : ''} onClick={() => navigateProduct('chatgpt')}>
        <ShieldCheck size={15} aria-hidden="true" /><span>{zh ? 'ChatGPT 充值' : 'ChatGPT top-up'}</span>
      </button>
      <button type="button" aria-pressed={product === 'team'} className={product === 'team' ? 'active' : ''} onClick={() => navigateProduct('team')}>
        <BadgeCheck size={15} aria-hidden="true" /><span>{zh ? 'Team 兑换' : 'Team redeem'}</span>
      </button>
    </div>
  );
}
