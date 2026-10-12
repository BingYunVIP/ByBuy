import { useState } from 'react';
import { Clipboard, Eye, EyeOff, KeyRound } from 'lucide-react';
import { useLocale } from './locale';
import type { CopyKey } from './locale';

export default function CardField({ value, onChange, disabled = false }: { value: string; onChange: (value: string) => void; disabled?: boolean }) {
  const { t } = useLocale();
  const [visible, setVisible] = useState(false);
  const [notice, setNotice] = useState<CopyKey | null>(null);
  async function paste() {
    try {
      const text = (await navigator.clipboard.readText()).trim();
      if (text.length > 128) { setNotice('cardInvalid'); return; }
      onChange(text); setNotice(null);
    } catch { setNotice('pasteError'); }
  }
  return <div className="card-field">
    <label htmlFor="card-code">{t('card')}</label>
    <div className="code-input"><KeyRound size={18} aria-hidden="true" />
      <input id="card-code" value={value} onChange={event => { onChange(event.target.value); setNotice(null); }} type={visible ? 'text' : 'password'} placeholder={t('cardPlaceholder')} autoComplete="off" spellCheck={false} maxLength={128} readOnly={disabled} />
      <button type="button" className="field-icon" onClick={() => setVisible(v => !v)} aria-label={t(visible ? 'hideCard' : 'showCard')} aria-pressed={visible}>{visible ? <EyeOff size={17} /> : <Eye size={17} />}</button>
      <button type="button" className="paste-button" disabled={disabled} onClick={() => void paste()} aria-label={t('paste')}><Clipboard size={16} /><span>{t('paste')}</span></button>
    </div>
    {notice ? <p className="field-note" role="status">{t(notice)}</p> : null}
  </div>;
}
