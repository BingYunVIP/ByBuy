import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';

const zh = {
  brand: 'AI代充', shop: '文档教程', prices: '全球价格对比', ai: 'AI 中转站', orders: '订单查询',
  support: '售后群', store: '冰云小店', email: '联系邮箱',
  home: '返回充值', nav: '主导航', menu: '菜单', light: '切换浅色模式', dark: '切换深色模式', language: 'Switch to English',
  skip: '跳转到主要内容', title: 'ChatGPT 自助充值', heroTitle: 'ChatGPT 自助充值', subtitle: '简单几步，为你的灵感续航。',
  servicePromises: '服务承诺', officialChannel: 'ChatGPT官方渠道充值', visaFunds: '正规VISA资金', laborOnly: '只收取人工费', fastService: '快速处理', encrypted: '数据加密传输',

  // Hero
  heroBadge: '官方渠道 · 人工代充',
  heroLead: '为个人 ChatGPT 账号充值 Plus / Pro，正规资金、只收人工费，全程加密。',
  heroPoint1: '个人 Free 账号可用',
  heroPoint2: '正规 VISA 资金',
  heroPoint3: '加密传输',
  ctaStart: '开始充值',
  ctaBuy: '文档教程',
  ctaSupport: '联系售后',
  factsTitle: '充值须知',
  factAccount: '账号要求', factAccountValue: '个人 Free 账号',
  factNeed: '需要准备', factNeedValue: 'Session JSON',
  factPay: '支付方式', factPayValue: '兑换卡密',
  factTime: '处理时效', factTimeValue: '提交后尽快处理',

  // Task section
  taskTitle: '开始你的充值',
  taskSubtitle: '按顺序完成订阅检查与卡密验证，全程只需两分钟。',

  // Guarantees
  guaranteesTitle: '为什么选择 AI代充',
  guaranteesSubtitle: '多项服务承诺，写在这里，也落实在每一步流程里。',
  officialChannelDesc: '通过官方渠道完成订阅充值，不涉及共享账号，账号始终由你本人持有。',
  visaFundsDesc: '使用正规 VISA 卡通道付款，资金来源清晰可查，不做来路不明的低价交易。',
  laborOnlyDesc: '价格透明，仅收取服务人工费，没有隐藏费用，下单前就能看清总价。',
  fastServiceDesc: '提交后尽快安排处理，进度可在「订单查询」中随时跟踪。',
  refundDesc: '遇到异常时请联系售后，我们会根据订单状态协助处理。',
  encryptedDesc: '全程 HTTPS 加密传输，登录资料仅用于本次订阅检查，用完即清。',

  // Process
  processTitle: '充值流程',
  processEyebrow: '四步完成',
  processSubtitle: '四步完成，每一步都有明确提示，不确定的地方随时找售后。',
  p1desc: '登录 ChatGPT 个人账号，获取并粘贴 Session JSON。',
  p2desc: '输入兑换卡密，系统校验卡密是否有效可用。',
  p3desc: '确认账号与套餐信息，提交本次充值申请。',
  p4desc: '在「订单查询」中用原卡密查看处理进度与结果。',

  // FAQ
  faqTitle: '常见问题',
  faqSubtitle: '下单前先看看，能解决你大部分疑问。',
  faq1q: '充值前需要准备什么？',
  faq1a: '一个个人 ChatGPT 账号（当前为 Free 套餐），以及它的 Session JSON。团队账号或仍在有效期内的 Plus / Pro 账号暂不支持。',
  faq2q: '为什么要求账号是个人 Free？',
  faq2a: '充值流程针对个人 Free 账号设计。团队账号与已付费账号的处理方式不同，请先切换个人账号，或等待当前订阅到期后再来。',
  faq3q: '如何购买卡密？',
  faq3a: '在顶部「冰云小店」购买卡密，卡密即凭证，请勿泄露给他人。',
  faq4q: '充值需要多久完成？',
  faq4a: '提交后我们会尽快安排处理。你可以在「订单查询」中输入原卡密，随时查看订单状态与完成时间。',
  faq5q: '如果充值失败怎么办？',
  faq5a: '若充值未能完成，请加入售后群并提供原卡密，我们会根据订单状态协助处理。',

  // Footer
  footerAbout: '面向个人 ChatGPT 账号的自助充值服务，正规资金、人工处理。',
  footerService: '服务',
  footerHelp: '支持',
  footerContact: '联系方式',
  footerContactNote: '工作日 9:00–22:00 在线',
  footerTerms: '服务条款',
  footerPrivacy: '隐私说明',
  footerRefund: '退款政策',
  footerRights: '保留所有权利',
  footerIcp: '备案信息待补充',

  step1: '检查订阅', step2: '验证卡密', step3: '提交信息', step4: '完成提交',
  guideLogin: '登录个人账号', guideSession: '获取 Session', guideNote: '复制完整内容，粘贴到下方。',
  session: 'Session JSON', import: '导入文件', importing: '正在读取…', placeholder: '粘贴你的 Session JSON，或导入 auth.json 文件',
  useNote: '仅用于订阅检查和本次订单，提交后清除', check: '检查订阅', checking: '正在检查…', recheck: '重新检查',
  object: '检查对象', plan: '套餐', start: '订阅开始', end: '订阅结束', personal: '个人', team: '团队', unknown: '待确认', emptyDate: '—',
  verified: '已核验', unverified: '待在线确认', eligible: '个人 Free 账号，可以继续。', switchPersonal: '请切换个人账号后再充值。',
  waitExpiry: '请确保当前订阅已过期，再进行充值。', unavailable: '未能取得当前订阅信息，请联系购买渠道协助检查。',
  accessRestricted: '订阅查询服务访问受限，请联系售后协助检查。', queryTimeout: '订阅查询超时，请检查网络连接后重新检查。',
  responseUnknown: '订阅信息未能识别，请联系购买渠道协助检查。',
  expired: '登录信息已失效，请重新获取 Session。', invalid: '请粘贴完整、有效的 JSON 内容。',
  identityMismatch: '账号信息不一致，请重新获取 Session。', selectAccount: '选择账号', chooseAccount: '请选择要检查的账号。',
  unsupported: '请选择 Session、auth.json 或 Sub2API JSON 文件。', tooLarge: '文件需小于 1 MB，最多支持 30 个账号。',
  fileError: '文件读取失败，请重试。', next: '下一步：验证卡密', back: '重新检查账号',
  card: '兑换卡密', cardPlaceholder: '输入完整卡密', verify: '验证卡密', verifying: '正在验证…',
  cardReminder: '卡密即凭证，请勿泄露给他人', showCard: '显示卡密', hideCard: '隐藏卡密', paste: '粘贴',
  pasteError: '请在输入框中手动粘贴。', cardInvalid: '请输入完整卡密。', cardUsed: '卡密无效或已使用。',
  cardPassed: '卡密验证通过', submissionSoon: '账号与卡密均已确认，可以完成提交。', notOpen: '暂未开放',
  sessionRequired: '完成充值需要从 ChatGPT 获取的完整 Session JSON，请重新导入后再继续。',
  submitOrder: '完成提交', submittingOrder: '正在提交…', submitted: '订单已提交', submittedPending: '充值请求已进入处理队列，可使用原卡密查询进度。',
  submitPrivacy: 'Session 只会发送给充值服务处理本次订单，提交后立即从当前页面内存清除。',
  completeVerification: '完成安全验证', verifyingPayment: '验证处理中…', verificationFailed: '安全验证未完成，请稍后在订单查询中重试。', verificationUnavailable: '安全验证信息暂不可用，请刷新状态重试。',
  submissionUnknown: '提交结果暂时无法确认，请使用原卡密查询订单，暂不要重复提交。', restart: '重新开始',
  checkRequired: '请先确认个人账号为 Free，再验证卡密。', ticketExpired: '检查结果已过期，请重新检查账号。',
  viewOrder: '查询此卡密', orderTitle: '查询充值进度', orderSubtitle: '输入原卡密，查看订单状态。',
  query: '查询订单', querying: '正在查询…', account: '充值账号', orderNo: '订单尾号', status: '订单状态', completedAt: '完成时间',
  completed: '充值已完成', processing: '充值处理中', queued: '等待处理', failed: '充值未完成', cancelled: '已取消',
  needsHelp: '订单需要进一步处理', notFound: '未找到订单，请检查卡密。', network: '连接失败，请检查网络连接。',
  rateLimited: '操作较频繁，请稍后再试。', refresh: '刷新状态', credentialHint: '仅显示本次检查结果',
  dateNote: '时间为 UTC+8', missingAccess: '请获取包含访问令牌的完整登录资料。',
};
const en: Record<keyof typeof zh, string> = {
  brand: 'AI Top-Up', shop: 'Docs', prices: 'Price Compare', ai: 'AI Router', orders: 'Orders',
  support: 'Support', store: 'Store', email: 'Email',
  home: 'Back to top-up', nav: 'Main navigation', menu: 'Menu', light: 'Switch to light mode', dark: 'Switch to dark mode', language: '切换中文',
  skip: 'Skip to content', title: 'ChatGPT, topped up.', heroTitle: 'ChatGPT Self-Service Top-Up', subtitle: 'A few simple steps. More room for inspiration.',
  servicePromises: 'Our service commitments', officialChannel: 'ChatGPT official-channel top-ups', visaFunds: 'Legitimate VISA payments', laborOnly: 'Service fee only', fastService: 'Fast processing', encrypted: 'Encrypted data transfer',

  heroBadge: 'Official channel · Manual top-up',
  heroLead: 'Top up Plus or Pro for your personal ChatGPT account — legitimate funds, service fee only, fully encrypted.',
  heroPoint1: 'Works with personal Free accounts',
  heroPoint2: 'Legitimate VISA payments',
  heroPoint3: 'Encrypted transfer',
  ctaStart: 'Start now',
  ctaBuy: 'Docs',
  ctaSupport: 'Contact support',
  factsTitle: 'Before you start',
  factAccount: 'Account', factAccountValue: 'Personal Free plan',
  factNeed: 'What you need', factNeedValue: 'Session JSON',
  factPay: 'Payment', factPayValue: 'Redemption code',
  factTime: 'Turnaround', factTimeValue: 'Handled soon after you submit',

  taskTitle: 'Start your top-up',
  taskSubtitle: 'Check the subscription, then verify your code — it takes about two minutes.',

  guaranteesTitle: 'Why choose AITop-Up',
  guaranteesSubtitle: 'Service commitments we apply throughout the flow.',
  officialChannelDesc: 'Top-ups go through the official channel. No shared accounts — the account always stays yours.',
  visaFundsDesc: 'Payment runs through legitimate VISA channels, with a clear and traceable source of funds.',
  laborOnlyDesc: 'Transparent pricing: a service fee only, no hidden charges. You see the full amount before ordering.',
  fastServiceDesc: 'We handle your request as soon as it is submitted, and you can track progress under Orders.',
  refundDesc: 'If an issue occurs, contact support and we will assist based on the order status.',
  encryptedDesc: 'Everything travels over HTTPS. Login details are used only for this check and cleared afterwards.',

  processTitle: 'How it works',
  processEyebrow: 'Four steps',
  processSubtitle: 'Four steps, each with a clear prompt. Reach out to support whenever you are unsure.',
  p1desc: 'Sign in to your personal ChatGPT account and paste its Session JSON.',
  p2desc: 'Enter your redemption code and we validate whether it can be used.',
  p3desc: 'Confirm your account and plan, then submit this top-up request.',
  p4desc: 'Track progress and the final result under Orders using the same code.',

  faqTitle: 'Frequently asked questions',
  faqSubtitle: 'A quick read before you order — it answers most questions.',
  faq1q: 'What do I need before topping up?',
  faq1a: 'A personal ChatGPT account on the Free plan, plus its Session JSON. Team accounts, or Plus / Pro accounts that are still active, are not supported yet.',
  faq2q: 'Why does it have to be a personal Free account?',
  faq2a: 'The flow is built for personal Free accounts. Team and already-paid accounts are handled differently — switch to your personal account, or come back once the current subscription expires.',
  faq3q: 'How do I buy a redemption code?',
  faq3a: 'Buy your code from Store in the top navigation. Your code is your proof of purchase — keep it private.',
  faq4q: 'How long does the top-up take?',
  faq4a: 'We handle it as soon as it is submitted. Enter your code under Orders at any time to see the status and completion time.',
  faq5q: 'What if the top-up fails?',
  faq5a: 'If the top-up cannot be completed, join the support group with your original code so we can check the order and assist.',

  footerAbout: 'Self-service top-ups for personal ChatGPT accounts — legitimate funds and manual handling.',
  footerService: 'Service',
  footerHelp: 'Support',
  footerContact: 'Contact',
  footerContactNote: 'Online weekdays 9:00–22:00',
  footerTerms: 'Terms of service',
  footerPrivacy: 'Privacy',
  footerRefund: 'Refund policy',
  footerRights: 'All rights reserved',
  footerIcp: 'Registration info to be added',

  step1: 'Check plan', step2: 'Verify code', step3: 'Submit details', step4: 'Complete',
  guideLogin: 'Sign in to your personal account', guideSession: 'Get Session', guideNote: 'Copy the full JSON and paste it below.',
  session: 'Session JSON', import: 'Import file', importing: 'Reading…', placeholder: 'Paste your Session JSON or import an auth.json file',
  useNote: 'Used only for this check and order, then cleared', check: 'Check subscription', checking: 'Checking…', recheck: 'Check again',
  object: 'Account type', plan: 'Plan', start: 'Subscription starts', end: 'Subscription ends', personal: 'Personal', team: 'Team', unknown: 'Unconfirmed', emptyDate: '—',
  verified: 'Verified', unverified: 'Awaiting online check', eligible: 'Personal Free account. You can continue.', switchPersonal: 'Please switch to your personal account.',
  waitExpiry: 'Please wait until your current subscription expires before topping up.', unavailable: 'Current subscription details are unavailable. Contact your seller for help.',
  accessRestricted: 'Access to the subscription service was denied. Contact support for help.', queryTimeout: 'The subscription check timed out. Check your connection before trying again.',
  responseUnknown: 'The subscription response could not be read. Contact your seller for help.',
  expired: 'Your login details have expired. Please get a new Session.', invalid: 'Please paste complete, valid JSON.',
  identityMismatch: 'Account details do not match. Please get a new Session.', selectAccount: 'Select an account', chooseAccount: 'Choose the account you want to check.',
  unsupported: 'Please use a Session, auth.json or Sub2API JSON file.', tooLarge: 'Use a file under 1 MB with no more than 30 accounts.',
  fileError: 'Unable to read the file. Please try again.', next: 'Next: verify code', back: 'Check another account',
  card: 'Redemption code', cardPlaceholder: 'Enter your full code', verify: 'Verify code', verifying: 'Verifying…',
  cardReminder: 'Your code is your proof of purchase. Keep it private.', showCard: 'Show code', hideCard: 'Hide code', paste: 'Paste',
  pasteError: 'Please paste directly into the field.', cardInvalid: 'Please enter your full code.', cardUsed: 'This code is invalid or already used.',
  cardPassed: 'Code verified', submissionSoon: 'Your account and code are confirmed. You can complete the submission.', notOpen: 'Not available yet',
  sessionRequired: 'A complete ChatGPT Session JSON is required to finish. Import it before continuing.',
  submitOrder: 'Complete submission', submittingOrder: 'Submitting…', submitted: 'Order submitted', submittedPending: 'Your request is in the processing queue. Use the original code to track it.',
  submitPrivacy: 'The Session is sent only to process this order and is cleared from this page immediately after submission.',
  completeVerification: 'Complete security check', verifyingPayment: 'Verifying…', verificationFailed: 'The security check was not completed. Try again later from the order view.', verificationUnavailable: 'Security-check details are temporarily unavailable. Refresh the order status and try again.',
  submissionUnknown: 'The submission result is not yet confirmed. Check the order with the original code and do not submit again.', restart: 'Start over',
  checkRequired: 'First confirm that your personal account is on the Free plan.', ticketExpired: 'Your check has expired. Please check your account again.',
  viewOrder: 'Look up this code', orderTitle: 'Track your top-up.', orderSubtitle: 'Use your original code to check your order.',
  query: 'Look up order', querying: 'Looking up…', account: 'Account', orderNo: 'Order ending', status: 'Status', completedAt: 'Completed at',
  completed: 'Top-up complete', processing: 'Processing', queued: 'Queued', failed: 'Top-up incomplete', cancelled: 'Cancelled',
  needsHelp: 'Order needs further action', notFound: 'No order found. Please check your code.', network: 'Unable to connect. Please check your network.',
  rateLimited: 'Too many requests. Please try again later.', refresh: 'Refresh status', credentialHint: 'Results from this check only',
  dateNote: 'All times UTC+8', missingAccess: 'Please get complete login details that include an access token.',
};
export type CopyKey = keyof typeof zh;
type Language = 'zh' | 'en';
type Theme = 'light' | 'dark';
const Context = createContext<{ lang: Language; theme: Theme; t: (key: CopyKey) => string; toggleLanguage: () => void; toggleTheme: () => void } | null>(null);
const preferenceKey = 'bybuy.preferences.v1';

function preferences(): { lang: Language; theme: Theme } {
  let saved: { lang?: string; theme?: string } = {};
  try { saved = JSON.parse(localStorage.getItem(preferenceKey) || '{}') ?? {}; } catch { /* private browsing */ }
  /* 默认暗色，与冰云首页保持一致；只有用户显式切过浅色，才按浅色渲染。 */
  return { lang: saved.lang === 'en' ? 'en' : 'zh', theme: saved.theme === 'light' ? 'light' : 'dark' };
}
export function LocaleProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState(preferences);
  const { lang, theme } = settings;
  useEffect(() => {
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
    document.documentElement.dataset.theme = theme;
    document.title = lang === 'zh' ? 'AI代充 · ChatGPT 自助充值' : 'AI Top-Up · ChatGPT top-up';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#0e1116' : '#f4f5f7');
    try { localStorage.setItem(preferenceKey, JSON.stringify(settings)); } catch { /* preferences are optional */ }
  }, [settings, lang, theme]);
  return <Context.Provider value={{ lang, theme, t: key => (lang === 'zh' ? zh : en)[key], toggleLanguage: () => setSettings(s => ({ ...s, lang: s.lang === 'zh' ? 'en' : 'zh' })), toggleTheme: () => setSettings(s => ({ ...s, theme: s.theme === 'light' ? 'dark' : 'light' })) }}>{children}</Context.Provider>;
}
export function useLocale() { const value = useContext(Context); if (!value) throw new Error('LocaleProvider required'); return value; }
export function errorKey(code?: string): CopyKey {
  if (code === 'ACCESS_RESTRICTED') return 'accessRestricted';
  if (code === 'CHECK_TIMEOUT') return 'queryTimeout';
  if (code === 'CHECK_RESPONSE_UNKNOWN') return 'responseUnknown';
  if (['CHECK_SCOPE_MISMATCH', 'SUBSCRIPTION_RECORDS_DIFFER'].includes(code ?? '')) return 'identityMismatch';
  if (code === 'SUBSCRIPTION_CHECK_REQUIRED') return 'ticketExpired';
  if (code === 'SESSION_ACCOUNT_MISMATCH') return 'identityMismatch';
  if (code === 'SESSION_REJECTED') return 'sessionRequired';
  if (code === 'CARD_VERIFICATION_REQUIRED') return 'checkRequired';
  if (code === 'PLAN_MISMATCH') return 'waitExpiry';
  if (['SUBMISSION_UNKNOWN', 'SUBMISSION_ALREADY_ATTEMPTED'].includes(code ?? '')) return 'submissionUnknown';
  if (code === 'INVALID_CARD') return 'cardUsed';
  if (code === 'ORDER_NOT_FOUND') return 'notFound';
  if (['RATE_LIMITED', 'SERVICE_BUSY', 'CHECK_RATE_LIMITED'].includes(code ?? '')) return 'rateLimited';
  if (['CREDENTIAL_REJECTED', 'CREDENTIAL_EXPIRED', 'CREDENTIAL_NOT_YET_VALID'].includes(code ?? '')) return 'expired';
  if (code === 'INVALID_INPUT') return 'invalid';
  return 'unavailable';
}
export function showDate(value: string | null | undefined, lang: Language) {
  if (!value || !Number.isFinite(Date.parse(value))) return '—';
  return new Intl.DateTimeFormat(lang === 'zh' ? 'zh-CN' : 'en-GB', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(value));
}
