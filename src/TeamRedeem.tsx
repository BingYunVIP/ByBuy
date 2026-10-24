import { useEffect, useState } from 'react';
import {
  AtSign, CircleAlert, CircleCheck, Copy, Gift, KeyRound, LoaderCircle, Mail, RefreshCw, RotateCcw,
  ShieldCheck,
} from 'lucide-react';
import { useLocale } from './locale';
import ProductSwitch from './ProductSwitch';
import type { ProductPage } from './ProductSwitch';
import { ServiceChips, teamServiceChips } from './service-chips';
import { ServiceNotice, useServiceStatus } from './service-status';

type TeamMode = 'invite' | 'ready';
type TeamResult = 'invite' | 'ready' | null;
type Availability = { inviteSeatsRemaining: number; readyAccountsRemaining: number };
type Account = { email: string; password: string; totp_secret: string };
type ApiEnvelope<T> = { ok?: boolean; data?: T; error?: { message?: string; code?: string; canQuery?: boolean } };
type TeamRedeemProps = { onNavigateProduct: (next: ProductPage) => void };

function validEmail(value: string) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()); }

function fallbackUuid() {
  const bytes = new Uint8Array(16);
  window.crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function requestId(mode: TeamMode, cdk: string, email = '') {
  if (!window.crypto?.subtle || !window.crypto?.getRandomValues) throw new Error('请通过安全链接打开页面后再兑换。');
  const identity = JSON.stringify([mode, cdk.trim().toUpperCase(), email.trim().toLowerCase()]);
  const bytes = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(identity));
  const digest = Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
  const key = `redemption-v1:${digest}`;
  try {
    const stored = window.sessionStorage.getItem(key);
    if (stored && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(stored)) return stored;
    const value = window.crypto.randomUUID?.() ?? fallbackUuid();
    window.sessionStorage.setItem(key, value);
    return value;
  } catch { throw new Error('浏览器无法保存本次兑换标识，请允许当前网站的会话存储后重试。'); }
}

async function fetchJson<T>(path: string, init?: RequestInit, timeoutMs = 10_000): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(path, {
      ...init, credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
      headers: { Accept: 'application/json', ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...init?.headers },
    });
    let body: ApiEnvelope<T>;
    try { body = await response.json() as ApiEnvelope<T>; }
    catch { throw new Error('Team 兑换服务暂时不可用，请稍后重试。'); }
    if (!response.ok || body.ok === false) {
      const message = body.error?.message || 'Team 兑换服务暂时不可用，请稍后重试。';
      if (body.error?.canQuery || body.error?.code === 'TEAM_PENDING') throw new Error(`本次兑换正在处理或等待核对，请保留卡密和当前页面，勿更换邮箱重复提交。${message}`);
      throw new Error(message);
    }
    if (!body.data) throw new Error('Team 兑换服务返回异常，请稍后重试。');
    return body.data;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw new Error('Team 兑换服务响应超时，请稍后重试。');
    if (error instanceof Error) throw error;
    throw new Error('Team 兑换服务暂时不可用，请稍后重试。');
  } finally { window.clearTimeout(timer); }
}

function countLabel(value: number | null, zh: boolean) {
  if (value === null) return null;
  return zh ? `余 ${value.toLocaleString('zh-CN')} 席` : `${value.toLocaleString('en-US')} available`;
}

export default function TeamRedeem({ onNavigateProduct }: TeamRedeemProps) {
  const { lang } = useLocale();
  const { state } = useServiceStatus();
  const zh = lang === 'zh';
  const locked = state === 'offline';
  const [mode, setMode] = useState<TeamMode>('invite');
  const [availability, setAvailability] = useState<Availability | null>(null);
  const [cdk, setCdk] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<TeamResult>(null);
  const [account, setAccount] = useState<Account | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let active = false;
    const refresh = async () => {
      if (active) return;
      active = true;
      try {
        const data = await fetchJson<Availability>('/api/team/availability', undefined, 8_000);
        if (!cancelled) setAvailability(data);
      } catch {
        /* Inventory is optional UI; hide stale counts and keep the redeem form usable. */
        if (!cancelled) setAvailability(null);
      }
      finally { active = false; }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30_000);
    const onVisibility = () => { if (document.visibilityState === 'visible') void refresh(); };
    document.addEventListener('visibilitychange', onVisibility);
    return () => { cancelled = true; window.clearInterval(timer); document.removeEventListener('visibilitychange', onVisibility); };
  }, []);

  function switchMode(next: TeamMode) {
    if (busy || locked) return;
    setMode(next); setError(''); setResult(null); setAccount(null); setCopied(false);
  }

  async function submit() {
    if (busy || locked) return;
    setError(''); setCopied(false);
    const code = cdk.trim().toUpperCase();
    const address = email.trim().toLowerCase();
    if (!code) { setError(zh ? '请输入卡密 (CDK)。' : 'Enter your Team code.'); return; }
    if (mode === 'invite' && !validEmail(address)) { setError(zh ? '请输入有效的 ChatGPT 注册邮箱地址。' : 'Enter a valid ChatGPT account email.'); return; }
    setBusy(true);
    try {
      const id = await requestId(mode, code, address);
      if (mode === 'invite') {
        await fetchJson('/api/team/invite', { method: 'POST', body: JSON.stringify({ cdk: code, email: address, request_id: id }) });
      } else {
        const data = await fetchJson<{ status: string; account: Account }>('/api/team/ready', { method: 'POST', body: JSON.stringify({ cdk: code, request_id: id }) });
        if (data.status !== 'success' || !data.account?.email || !data.account.password) throw new Error('现成账号结果暂时无法确认，请稍后查询。');
        setAccount(data.account);
      }
      setResult(mode);
      try { setAvailability(await fetchJson<Availability>('/api/team/availability', undefined, 8_000)); }
      catch { /* The completed redemption stays visible even when inventory refresh is unavailable. */ }
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : (zh ? '兑换失败，请稍后重试。' : 'Redemption failed. Try again later.'));
    } finally { setBusy(false); }
  }

  function reset() {
    if (busy) return;
    setResult(null); setAccount(null); setError(''); setCopied(false); setCdk(''); setEmail('');
  }

  async function copyAccount() {
    if (!account) return;
    const text = zh
      ? `【ChatGPT Team 账号】\n登录邮箱：${account.email}\n登录密码：${account.password}\n2FA 密钥：${account.totp_secret || '无'}`
      : `ChatGPT Team account\nEmail: ${account.email}\nPassword: ${account.password}\n2FA secret: ${account.totp_secret || 'None'}`;
    try { await navigator.clipboard.writeText(text); setCopied(true); window.setTimeout(() => setCopied(false), 2_500); }
    catch { setError(zh ? '浏览器未允许复制，请手动记录账号信息。' : 'Clipboard access was denied. Copy the account details manually.'); }
  }

  const inviteSeats = availability?.inviteSeatsRemaining ?? null;
  const readyAccounts = availability?.readyAccountsRemaining ?? null;
  const inventoryMessage = zh ? '按最近同步库存更新 · 每 30 秒刷新' : 'Synced inventory · refreshes every 30 seconds';

  return <div className="team-page-inner">
    <section className="team-hero" aria-labelledby="team-title">
      <div className="team-route-switch"><span className="guide-pointer" aria-hidden="true">👉</span><ProductSwitch product="team" navigateProduct={onNavigateProduct} center /></div>
      <h1 id="team-title">{zh ? 'Team 兑换中心' : 'Team redemption center'}</h1>
      <ServiceChips items={teamServiceChips} />
    </section>

    {locked ? <ServiceNotice /> : null}

      <section className="redeem-container redeem-main w-full mx-auto flex-1 flex flex-col justify-center my-3">
      <section className="redeem-card neo-card" aria-labelledby="redeem-method-title" aria-disabled={locked || undefined}>
        <div className="redeem-tabs" role="group" aria-label={zh ? '兑换方式' : 'Redemption method'}>
          <button type="button" aria-pressed={mode === 'invite'} className={`neo-btn redeem-tab${mode === 'invite' ? ' active' : ''}`} onClick={() => switchMode('invite')} disabled={busy || locked}><Mail size={18} aria-hidden="true" /><span>{zh ? '自备邮箱上车' : 'Invite my email'}</span>{countLabel(inviteSeats, zh) ? <strong>{countLabel(inviteSeats, zh)}</strong> : null}</button>
          <button type="button" aria-pressed={mode === 'ready'} className={`neo-btn redeem-tab${mode === 'ready' ? ' active' : ''}`} onClick={() => switchMode('ready')} disabled={busy || locked}><Gift size={18} aria-hidden="true" /><span>{zh ? '领取现成成品号' : 'Claim ready account'}</span>{countLabel(readyAccounts, zh) ? <strong>{countLabel(readyAccounts, zh)}</strong> : null}</button>
        </div>
        {availability ? <p className="inventory-updated" role="status"><RefreshCw size={14} aria-hidden="true" />{inventoryMessage}</p> : null}
        <h2 className="sr-only" id="redeem-method-title">{mode === 'invite' ? (zh ? '自备账号拉人上车' : 'Invite your email') : (zh ? '现成独立成品号提卡' : 'Claim a ready account')}</h2>

        {result === 'invite' ? <section className="team-result team-result--invite" role="status" aria-live="polite">
          <CircleCheck size={40} aria-hidden="true" /><h3>{zh ? '兑换成功！' : 'Redemption successful'}</h3><p>{zh ? '团队邀请已成功提交，请检查邮箱。' : 'The team invite was submitted. Check your email.'}</p>
          <div className="team-next-steps"><b>{zh ? '下一步操作指引：' : 'Next steps:'}</b><br />{zh ? '1. 查收来自 OpenAI 的团队邀请邮件；2. 点击邮件内的 Join Workspace；3. 若未收到，请检查垃圾邮件。' : '1. Find the OpenAI team invite; 2. click Join Workspace; 3. check spam if it is missing.'}</div>
          <button type="button" className="neo-btn redeem-secondary" onClick={reset}><RotateCcw size={16} aria-hidden="true" />{zh ? '兑换另一个卡密' : 'Redeem another code'}</button>
        </section> : result === 'ready' && account ? <section className="team-result team-result--ready" role="status" aria-live="polite">
          <CircleCheck size={40} aria-hidden="true" /><h3>{zh ? '账号出库成功！' : 'Account delivered'}</h3><p>{zh ? '请妥善保存以下登录交付信息。' : 'Save the login details below securely.'}</p>
          <dl className="account-facts"><div><dt>{zh ? '登录邮箱' : 'Email'}</dt><dd>{account.email}</dd></div><div><dt>{zh ? '登录密码' : 'Password'}</dt><dd>{account.password}</dd></div><div><dt>{zh ? '2FA 密钥' : '2FA secret'}</dt><dd>{account.totp_secret || (zh ? '无' : 'None')}</dd></div></dl>
          <p className="account-note">{zh ? '请将 2FA 密钥保存到您信任的验证器中。' : 'Save the 2FA secret in a trusted authenticator.'}</p>
          <div className="result-actions"><button type="button" className="neo-btn redeem-primary" onClick={() => void copyAccount()}><Copy size={16} aria-hidden="true" />{copied ? (zh ? '已复制到剪贴板' : 'Copied') : (zh ? '一键复制全部账号信息' : 'Copy account details')}</button><button type="button" className="neo-btn redeem-secondary" onClick={reset}><RotateCcw size={16} aria-hidden="true" />{zh ? '兑换另一个卡密' : 'Redeem another code'}</button></div>
        </section> : <section className="team-form-panel">
          <div className="panel-heading"><span className="panel-icon" aria-hidden="true">{mode === 'invite' ? <Mail size={21} /> : <Gift size={21} />}</span><div><h3>{mode === 'invite' ? (zh ? '自备账号拉人上车' : 'Invite your own account') : (zh ? '现成独立成品号提卡' : 'Claim a ready account')}</h3><p>{mode === 'invite' ? (zh ? '输入您的 ChatGPT 注册邮箱，系统确认后发送团队邀请。' : 'Enter your ChatGPT registration email to receive the team invite.') : (zh ? '无需提供账号，输入卡密即刻出库独立配置好的账号。' : 'No email is needed; a configured account is delivered after redemption.')}</p></div></div>
          <form onSubmit={event => { event.preventDefault(); void submit(); }}>
            <div className={`form-fields${mode === 'ready' ? ' form-fields--single' : ''}`}>
              <label htmlFor="team-cdk"><span>{zh ? '卡密 (CDK)' : 'Code (CDK)'}</span><div className="neo-input-wrap"><KeyRound size={17} aria-hidden="true" /><input id="team-cdk" value={cdk} onChange={event => setCdk(event.target.value.toUpperCase())} placeholder={zh ? '例如：TEAM-XXXXXXXX-XXXXXXXX' : 'e.g. TEAM-XXXXXXXX-XXXXXXXX'} autoComplete="off" disabled={busy || locked} /></div></label>
              {mode === 'invite' ? <label htmlFor="team-email"><span>{zh ? '您的 ChatGPT 账号邮箱' : 'ChatGPT account email'}</span><div className="neo-input-wrap"><AtSign size={17} aria-hidden="true" /><input id="team-email" type="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="your_email@example.com" autoComplete="email" disabled={busy || locked} /></div></label> : <div className="form-hint"><ShieldCheck size={18} aria-hidden="true" /><span>{zh ? '无需提供邮箱，提交后会展示现成账号的登录信息。' : 'No email is required. Login details appear after submission.'}</span></div>}
            </div>
            {error ? <p className="team-error" role="alert"><CircleAlert size={17} aria-hidden="true" />{error}</p> : null}
            <button type="submit" className="neo-btn redeem-primary redeem-submit" disabled={busy || locked}>{busy ? <LoaderCircle className="spinner" size={18} aria-hidden="true" /> : mode === 'invite' ? <Mail size={18} aria-hidden="true" /> : <Gift size={18} aria-hidden="true" />}{busy ? (zh ? '正在处理…' : 'Processing…') : mode === 'invite' ? (zh ? '立即兑换并拉入团队空间' : 'Redeem and join team') : (zh ? '立即核销并提取成品账号' : 'Redeem and receive account')}</button>
          </form>
        </section>}
      </section>
      </section>
  </div>;
}
