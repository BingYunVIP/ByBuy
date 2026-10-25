import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, CircleCheck, FileJson, LoaderCircle, LockKeyhole, RefreshCw, Upload } from 'lucide-react';
import { MAX_IMPORT_BYTES, parseSubscriptionInput, planLabel } from '../shared/subscription.ts';
import type { LiveReport, ParsedAccount } from '../shared/subscription.ts';
import { reportVerification, requestCard, runVerification, submitOrder } from './api';
import type { CardResult, OrderResult, SubmissionResult } from './api';
import CardField from './CardField';
import { errorKey, useLocale } from './locale';
import type { CopyKey } from './locale';
import { ServiceNotice, useServiceStatus } from './service-status';

/* 只有三步：检查订阅 → 验证卡密 → 完成提交。
   「提交信息」原本是第 3 步，但 Session JSON 在第 1 步就已经提交了，
   那一步纯属重复，已删除。 */
const FLOW_STEPS = ['step1', 'step2', 'step4'] as const;

export default function SubscriptionCheck({ onQuery }: { onQuery: (code: string) => void }) {
  const { t } = useLocale();
  const { state } = useServiceStatus();
  const [draft, setDraft] = useState('');
  const [sessionJson, setSessionJson] = useState('');
  const [accounts, setAccounts] = useState<ParsedAccount[]>([]);
  const [selected, setSelected] = useState(0);
  const [live, setLive] = useState<LiveReport | null>(null);
  const [notice, setNotice] = useState<CopyKey | null>(null);
  const [busy, setBusy] = useState<'check' | 'card' | 'file' | 'submit' | 'verification' | null>(null);
  const [step, setStep] = useState(1);
  const [code, setCode] = useState('');
  const [card, setCard] = useState<CardResult | null>(null);
  const [submission, setSubmission] = useState<SubmissionResult | null>(null);
  const [submissionNotice, setSubmissionNotice] = useState<CopyKey | null>(null);
  const [submissionCanQuery, setSubmissionCanQuery] = useState(false);
  const [usedCard, setUsedCard] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const account = accounts[selected];
  const current = live?.selected;
  const ticket = live?.eligibility;
  const canContinue = Boolean(sessionJson && account?.report.format === 'session' && ticket && Date.parse(ticket.expiresAt) > Date.now()
    && live?.credentialState === 'accepted' && current?.scope === 'personal' && current.plan === 'free' && current.status === 'free');

  /* 服务异常时整块停用。用户在页面上填完 Session、填完卡密，
     最后才吃一个「暂时无法连接」，体验比直接告诉他"现在不能用"差得多。
     已经填过的内容留在 state 里，恢复了接着用。 */
  const locked = state === 'offline';

  useEffect(() => () => { generation.current++; controller.current?.abort(); controller.current = null; }, []);
  useEffect(() => {
    if (!ticket) return;
    const remaining = Date.parse(ticket.expiresAt) - Date.now();
    const timeout = setTimeout(() => { setLive(value => value ? { ...value, eligibility: null } : null); setStep(1); setCard(null); setSubmission(null); setCode(''); setNotice('ticketExpired'); }, Math.max(0, remaining));
    return () => clearTimeout(timeout);
  }, [ticket]);

  /* 验证提示出现时回报一次（同一份验证信息只报一次，去重在 reportVerification 里）。 */
  const pendingVerification = submission?.verification ?? null;
  useEffect(() => { if (pendingVerification) reportVerification(code.trim().toUpperCase(), 'shown', pendingVerification); }, [pendingVerification]); // eslint-disable-line react-hooks/exhaustive-deps

  function cancel() { generation.current++; controller.current?.abort(); controller.current = null; setBusy(null); }
  function clearCredentials() { setDraft(''); setSessionJson(''); setAccounts([]); setSelected(0); setLive(null); if (fileRef.current) fileRef.current.value = ''; }
  function reset() { cancel(); clearCredentials(); setNotice(null); setStep(1); setCode(''); setCard(null); setSubmission(null); setSubmissionNotice(null); setSubmissionCanQuery(false); setUsedCard(false); }
  function choose(index: number) { cancel(); setSelected(index); setSessionJson(''); setLive(null); setNotice(null); setStep(1); setCode(''); setCard(null); setSubmission(null); }
  function parse(raw: string) {
    if (!raw.trim()) { setNotice('invalid'); return null; }
    if (new TextEncoder().encode(raw).byteLength > MAX_IMPORT_BYTES) { setNotice('tooLarge'); return null; }
    try {
      const parsed = parseSubscriptionInput(raw);
      const retainedSession = parsed.length === 1 && parsed[0].report.format === 'session' ? raw.replace(/^\uFEFF/, '').trim() : '';
      setAccounts(parsed); setSelected(0); setDraft(''); setSessionJson(retainedSession);
      if (parsed.length > 1) setNotice('chooseAccount');
      return { parsed, retainedSession };
    } catch { setNotice('invalid'); return null; }
  }
  async function importFile(file: File | undefined) {
    if (!file) return;
    reset(); const id = generation.current;
    if (file.size > MAX_IMPORT_BYTES) { setNotice('tooLarge'); return; }
    setBusy('file');
    try { const raw = await file.text(); if (generation.current === id) parse(raw); }
    catch { if (generation.current === id) setNotice('fileError'); }
    finally { if (generation.current === id) setBusy(null); }
  }

  async function checkSubscription() {
    if (locked || controller.current) return;
    setNotice(null); setLive(null); setCard(null); setCode(''); setStep(1);
    let target = account;
    let hasSubmissionSession = Boolean(sessionJson);
    if (!target) {
      const result = parse(draft); if (!result || result.parsed.length > 1) return;
      target = result.parsed[0];
      hasSubmissionSession = Boolean(result.retainedSession);
    }
    if (!target.report.identityConsistent) { setNotice('identityMismatch'); return; }
    if (target.report.access.timeState === 'expired' || target.report.access.timeState === 'not_yet_valid') { setNotice('expired'); return; }
    if (target.onlineBlockedReason || !target.accountId) { setNotice('missingAccess'); return; }
    const request = new AbortController(); controller.current = request; setBusy('check');
    try {
      const response = await fetch('/api/subscriptions/check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accessToken: target.accessToken, accountId: target.accountId }), cache: 'no-store', signal: AbortSignal.any([request.signal, AbortSignal.timeout(30_000)]) });
      const body = await response.json(); if (controller.current !== request) return;
      if (!response.ok || !body.ok) { setNotice(errorKey(body.error?.code)); return; }
      const result = body.data as LiveReport;
      if (!Array.isArray(result.checks)) { setNotice('unavailable'); return; }
      setLive(result);
      if (result.selected?.scope === 'workspace') setNotice('switchPersonal');
      else if (result.selected?.status === 'active' && result.selected.plan && result.selected.plan !== 'free') setNotice('waitExpiry');
      else if (result.eligibility?.ticket && result.selected?.scope === 'personal' && result.selected.plan === 'free' && result.selected.status === 'free') setNotice(hasSubmissionSession ? 'eligible' : 'sessionRequired');
      else setNotice(result.credentialState === 'rejected' ? 'expired' : errorKey(result.checks.find(item => !item.ok)?.code));
    } catch (error) { if (controller.current === request && !request.signal.aborted) setNotice(error instanceof Error && error.name === 'TimeoutError' ? 'queryTimeout' : 'network'); }
    finally { if (controller.current === request) { controller.current = null; setBusy(null); } }
  }

  async function verify() {
    if (locked) return;
    if (!canContinue || !ticket) { setNotice('checkRequired'); setStep(1); return; }
    if (controller.current) return;
    setNotice(null); setUsedCard(false);
    const normalized = code.trim().toUpperCase();
    if (!/^[A-Z0-9]+(?:-[A-Z0-9]+)+$/.test(normalized) || normalized.length < 6) { setNotice('cardInvalid'); return; }
    const request = new AbortController(); controller.current = request; setBusy('card');
    const response = await requestCard('verify', normalized, request.signal, ticket.ticket);
    if (controller.current !== request) return;
    if (response.ok && response.data.kind === 'card') {
      setCard(response.data); setSubmission(null); setSubmissionNotice(null); setSubmissionCanQuery(false); setStep(3);
      requestAnimationFrame(() => resultRef.current?.focus());
    }
    else if (!response.ok) {
      setNotice(errorKey(response.error.code)); setUsedCard(response.error.canQuery);
      if (response.error.code === 'SUBSCRIPTION_CHECK_REQUIRED') { setLive(null); setStep(1); }
    }
    controller.current = null; setBusy(null);
  }

  async function finishSubmission() {
    if (locked || controller.current || !ticket || !card || !sessionJson) return;
    const request = new AbortController(); controller.current = request; setBusy('submit'); setSubmissionNotice(null); setSubmissionCanQuery(false);
    try {
      const response = await submitOrder(code.trim().toUpperCase(), sessionJson, ticket.ticket, request.signal);
      if (controller.current !== request) return;
      if (response.ok) {
        setSubmission(response.data);
        requestAnimationFrame(() => resultRef.current?.focus());
      } else {
        setSubmissionNotice(errorKey(response.error.code));
        setSubmissionCanQuery(response.error.canQuery);
      }
      clearCredentials();
    } finally {
      if (controller.current === request) { controller.current = null; setBusy(null); }
    }
  }

  async function verifyPayment() {
    const details = submission?.verification;
    if (!details || controller.current) return;
    const request = new AbortController(); controller.current = request; setBusy('verification'); setSubmissionNotice(null);
    try {
      await runVerification(code.trim().toUpperCase(), details);
      if (request.signal.aborted) return;
      await new Promise(resolve => setTimeout(resolve, 1000));
      const response = await requestCard('query', code.trim().toUpperCase(), request.signal);
      if (response.ok && response.data.kind === 'order') setSubmission({ ...response.data, verification: null });
      else setSubmissionNotice('verificationFailed');
    } catch {
      if (!request.signal.aborted) setSubmissionNotice('verificationFailed');
    } finally {
      if (controller.current === request) { controller.current = null; setBusy(null); }
    }
  }

  /* 结果只来自服务端确认过的 current —— 不再回退到本地 JWT 声明。
     原来写成 `current?.scope ?? account?.report.scope`，于是刚粘贴完 Session JSON、
     检查还没跑完，页面上就先冒出一份「个人 / Free」的本地推测值，看着像结果其实不是。 */
  const displayPlan = !current?.plan || current.status === 'unknown' ? t('unknown')
    : ['pro', 'prolite', 'promax'].includes(current.plan) ? 'Pro'
      : current.plan === 'free' ? 'Free' : current.plan === 'plus' ? 'Plus' : planLabel(current.plan);
  const checking = busy === 'check';
  const submissionStatus = (status: OrderResult['status']): CopyKey => status === 'COMPLETED' ? 'completed'
    : status === 'PENDING' || status === 'PROCESSING' ? 'processing'
      : status === 'UNKNOWN' ? 'submitted' : status === 'CANCELLED' ? 'cancelled' : 'failed';

  return <>
    <section className={`flow-card${locked ? ' flow-card--locked' : ''}`} aria-label={t('title')} aria-disabled={locked || undefined}>
      {locked ? <ServiceNotice /> : null}
      <ol className="steps" aria-label={t('title')} inert={locked || undefined}>{FLOW_STEPS.map((key, index) => <li key={key} className={step === index + 1 ? 'current' : step > index + 1 ? 'done' : ''} aria-current={step === index + 1 ? 'step' : undefined}>
        <button type="button" disabled={index === 2 || (index === 1 && (!canContinue || Boolean(busy)))} onClick={() => { setStep(index + 1); setNotice(null); }}><span className="step-circle">{step > index + 1 ? <Check size={14} /> : index + 1}</span><span>{t(key)}</span></button>
      </li>)}</ol>
      <div className="flow-body" inert={locked || undefined}>
        {step === 1 ? <div className="step-pane" key="pane-1">
          <form onSubmit={event => { event.preventDefault(); void checkSubscription(); }} aria-busy={checking}>
            <div className="session-guide bb-rise" style={{ animationDelay: '140ms' }}>
              <a href="https://chatgpt.com" target="_blank" rel="noopener noreferrer"><span className="guide-pointer" aria-hidden="true">👉</span>{t('guideLogin')}</a>
              <span className="guide-divider" />
              <a href="https://chatgpt.com/api/auth/session" target="_blank" rel="noopener noreferrer"><span className="guide-pointer" aria-hidden="true">👉</span>{t('guideSession')}</a>
              <p>{t('guideNote')}</p>
            </div>
            <div className="form-label-row"><label htmlFor="session-json">{t('session')}</label><button className="text-button" type="button" disabled={Boolean(busy)} onClick={() => fileRef.current?.click()}><Upload size={14} />{t(busy === 'file' ? 'importing' : 'import')}</button></div>
            {!account ? <textarea id="session-json" value={draft} onChange={event => { setDraft(event.target.value); setNotice(null); }} placeholder={t('placeholder')} maxLength={MAX_IMPORT_BYTES} spellCheck={false} autoComplete="off" autoCapitalize="off" aria-label={t('session')} /> : <div className="loaded-file"><FileJson size={19} /><span>{account.report.format === 'codex' ? 'auth.json' : account.report.format === 'session' ? 'Session JSON' : 'OAuth JSON'}</span><button className="text-button" type="button" onClick={reset} disabled={Boolean(busy)}>{t('back')}</button></div>}
            {accounts.length > 1 ? <div className="account-select"><label htmlFor="selected-account">{t('selectAccount')}</label><select id="selected-account" value={selected} onChange={event => choose(Number(event.target.value))}>{accounts.map((item, index) => <option key={item.key} value={index}>{index + 1} · {item.report.emailMasked ?? item.report.accountMasked ?? t('unknown')}</option>)}</select></div> : null}
            <input ref={fileRef} className="visually-hidden" type="file" accept="application/json,.json" aria-label={t('import')} tabIndex={-1} onChange={event => void importFile(event.target.files?.[0])} />
            <div className="form-bottom"><span><LockKeyhole size={12} />{t('useNote')}</span><button className={canContinue ? 'secondary-button' : 'primary-button'} disabled={Boolean(busy)}>{checking ? <LoaderCircle size={16} className="spinner" /> : account ? <RefreshCw size={15} /> : null}{t(checking ? 'checking' : account ? 'recheck' : 'check')}{!busy && !account ? <ArrowRight size={16} /> : null}</button></div>
          </form>

          {checking ? <div className="result-pending" role="status" aria-label={t('checking')}>
            <span className="skeleton-bar" /><span className="skeleton-bar" />
          </div> : current ? <div className="subscription-result bb-rise"><dl className="simple-results">
            <div><dt>{t('object')}</dt><dd>{current.scope === 'personal' ? t('personal') : current.scope === 'workspace' ? t('team') : t('unknown')}</dd></div>
            <div><dt>{t('plan')}</dt><dd>{displayPlan}</dd></div>
          </dl></div> : null}

          {notice ? <p className={`notice bb-rise ${notice === 'eligible' ? 'success' : 'warning'}`} role="status">{notice === 'eligible' ? <CircleCheck size={16} /> : null}{t(notice)}</p> : null}
          {current ? <button className="primary-button continue-button" type="button" disabled={!canContinue || Boolean(busy)} onClick={() => { setStep(2); setNotice(null); }}>{t('next')}<ArrowRight size={16} /></button> : null}
        </div> : step === 2 ? <div className="step-pane" key="pane-2">
          <div className="stage-title"><h2>{t('step2')}</h2><span className="status-label positive"><Check size={12} />{t('personal')} · Free</span></div>
          <form onSubmit={event => { event.preventDefault(); void verify(); }} aria-busy={busy === 'card'}><CardField value={code} onChange={value => { setCode(value); setCard(null); setNotice(null); setUsedCard(false); }} disabled={Boolean(busy)} />
            {notice ? <p className="notice bb-rise warning" role="alert">{t(notice)}{usedCard ? <button type="button" className="text-button" onClick={() => onQuery(code)}>{t('viewOrder')}<ArrowRight size={14} /></button> : null}</p> : null}
            <div className="stage-actions"><button className="text-button" type="button" onClick={() => { cancel(); setStep(1); setLive(null); setNotice(null); setCard(null); setCode(''); }}><ArrowLeft size={15} />{t('back')}</button><button className="primary-button" disabled={!canContinue || Boolean(busy)}>{busy === 'card' ? <LoaderCircle className="spinner" size={16} /> : null}{t(busy === 'card' ? 'verifying' : 'verify')}<ArrowRight size={16} /></button></div>
          </form>
        </div> : <div className="step-pane" key="pane-3">
          <div className="stage-title"><h2>{t('step4')}</h2><span className="status-label positive"><Check size={12} />{card?.plan ?? t('verified')}</span></div>
          {submission ? <>
            <div className="verified-card bb-pop" tabIndex={-1} ref={resultRef} role="status"><CircleCheck size={24} /><div><h3>{t(submissionStatus(submission.status))}</h3><p>{t('submittedPending')}</p></div></div>
            <div className="subscription-result bb-rise"><dl className="simple-results">
              <div><dt>{t('account')}</dt><dd>{submission.accountMasked ?? '—'}</dd></div>
              <div><dt>{t('status')}</dt><dd>{t(submissionStatus(submission.status))}</dd></div>
            </dl></div>
            {submission.verification ? <div className="notice bb-rise warning" role="alert">
              <span>{t('completeVerification')}</span>
              <button className="text-button" type="button" disabled={busy === 'verification'} onClick={() => void verifyPayment()}>{busy === 'verification' ? <LoaderCircle className="spinner" size={15} /> : <LockKeyhole size={15} />}{t(busy === 'verification' ? 'verifyingPayment' : 'completeVerification')}</button>
            </div> : null}
            {submissionNotice ? <p className="notice bb-rise warning" role="alert">{t(submissionNotice)}</p> : null}
            <div className="stage-actions"><button className="text-button" type="button" onClick={reset}><RefreshCw size={15} />{t('restart')}</button><button className="primary-button" type="button" onClick={() => onQuery(code)}>{t('viewOrder')}<ArrowRight size={16} /></button></div>
          </> : <>
            <div className="verified-card bb-pop" tabIndex={-1} ref={resultRef} role="status"><CircleCheck size={24} /><div><h3>{t('cardPassed')}</h3><p>{t('submissionSoon')}</p></div></div>
            <p className="field-note"><LockKeyhole size={13} />{t('submitPrivacy')}</p>
            {submissionNotice ? <p className="notice bb-rise warning" role="alert">{t(submissionNotice)}</p> : null}
            <div className="stage-actions">
              <button className="text-button" type="button" onClick={submissionNotice ? reset : () => setStep(2)}><ArrowLeft size={15} />{t(submissionNotice ? 'restart' : 'back')}</button>
              {submissionCanQuery ? <button className="primary-button" type="button" onClick={() => onQuery(code)}>{t('viewOrder')}<ArrowRight size={16} /></button>
                : !submissionNotice ? <button className="primary-button" type="button" disabled={busy === 'submit'} onClick={() => void finishSubmission()}>{busy === 'submit' ? <LoaderCircle className="spinner" size={16} /> : null}{t(busy === 'submit' ? 'submittingOrder' : 'submitOrder')}<ArrowRight size={16} /></button> : null}
            </div>
          </>}
        </div>}
      </div>
    </section>
  </>;
}
