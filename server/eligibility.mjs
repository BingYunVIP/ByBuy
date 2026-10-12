import { createHash, randomBytes } from 'node:crypto';
import { PublicError } from './upstream.mjs';

const cardDigest = code => createHash('sha256').update(code).digest('base64url');

/** Short-lived capability, created only from a successful server-side subscription check. */
export function createEligibilityStore({ now = Date.now, lifetimeMs = 5 * 60_000 } = {}) {
  const grants = new Map();
  function prune() {
    const time = now();
    for (const [ticket, grant] of grants) if (grant.until <= time) grants.delete(ticket);
  }
  return {
    issue(report, accountId) {
      prune();
      const current = report.selected;
      if (report.credentialState !== 'accepted' || !current || current.accountId !== accountId
        || current.scope !== 'personal' || current.plan !== 'free' || current.status !== 'free'
        || report.checks.some(check => ['CHECK_SCOPE_MISMATCH', 'SUBSCRIPTION_RECORDS_DIFFER', 'CREDENTIAL_REJECTED'].includes(check.code))) return null;
      if (grants.size >= 1000) return null;
      const ticket = randomBytes(32).toString('base64url');
      const until = now() + lifetimeMs;
      grants.set(ticket, { accountId, until, cardDigest: null, submissionClaimed: false });
      return { ticket, expiresAt: new Date(until).toISOString() };
    },
    require(ticket) {
      prune();
      if (typeof ticket !== 'string' || !grants.has(ticket)) {
        throw new PublicError(403, 'SUBSCRIPTION_CHECK_REQUIRED', '请先检查订阅，确认个人账号为 Free 后再验证卡密。');
      }
      return grants.get(ticket).accountId;
    },
    markCardVerified(ticket, code) {
      this.require(ticket);
      const grant = grants.get(ticket);
      grant.cardDigest = cardDigest(code);
      grant.submissionClaimed = false;
    },
    claimSubmission(ticket, code, accountId) {
      const grantedAccountId = this.require(ticket);
      const grant = grants.get(ticket);
      if (grantedAccountId !== accountId) {
        throw new PublicError(403, 'SESSION_ACCOUNT_MISMATCH', '提交账号与已检查账号不一致，请重新检查。');
      }
      if (!grant.cardDigest || grant.cardDigest !== cardDigest(code)) {
        throw new PublicError(403, 'CARD_VERIFICATION_REQUIRED', '请先验证本次提交使用的卡密。');
      }
      if (grant.submissionClaimed) {
        throw new PublicError(409, 'SUBMISSION_ALREADY_ATTEMPTED', '本次提交已经发起，请使用订单查询确认结果。', true);
      }
      grant.submissionClaimed = true;
      return grantedAccountId;
    },
  };
}
