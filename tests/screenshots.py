"""Capture every state (failure + success) of each step on /chatgpt, /chatgpt/order and /team.
All backends are mocked with synthetic data. Output: artifacts/screens/<page>/<NN-name>.png
Run: python3 tests/screenshots.py   (needs a running server, BYBUY_BASE_URL to override)"""
import json
import os
import re
import shutil
import subprocess
from datetime import datetime, timedelta, timezone
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'artifacts' / 'screens'
BASE = os.environ.get('BYBUY_BASE_URL', 'http://127.0.0.1:2254')
fixture = json.loads(subprocess.check_output(['node', '--input-type=module', '-e',
    "import {sessionFile,ACCOUNT} from './tests/fixtures/subscriptions.mjs'; console.log(JSON.stringify({session:sessionFile(),account:ACCOUNT}));"], cwd=ROOT, text=True))

def j(route, body, status=200):
    route.fulfill(status=status, content_type='application/json', body=json.dumps(body))

def err(code, message='x', can_query=False):
    return {'ok': False, 'error': {'code': code, 'message': message, 'canQuery': can_query}}

def live(plan='free', scope='personal', fail=False):
    subject = None if fail else {'accountId': fixture['account'], 'accountMasked': '•••• ccount', 'scope': scope,
        'plan': plan, 'status': 'free' if plan == 'free' else 'active', 'periodStart': None, 'periodEnd': None,
        'willRenew': None, 'source': 'live_subscription'}
    return {'ok': True, 'data': {'credentialState': 'unconfirmed' if fail else 'accepted',
        'checkedAt': datetime.now(timezone.utc).isoformat(), 'selected': subject, 'workspaces': [], 'workspaceCoverage': 'unavailable',
        'checks': [{'source': 'live_subscription', 'ok': not fail, 'code': 'ACCESS_RESTRICTED' if fail else 'OK', 'message': 'fixture'}],
        'eligibility': {'ticket': 'synthetic-ticket', 'expiresAt': (datetime.now(timezone.utc) + timedelta(minutes=30)).isoformat()} if plan == 'free' and scope == 'personal' and not fail else None}}

VERIFICATION = {'mode': 'stripe', 'publishableKey': 'pk_test_synthetic', 'clientSecret': 'seti_synthetic_secret', 'expiresAt': '2099-01-01T00:00:00Z'}

def order(status, **extra):
    data = {'kind': 'order', 'status': status, 'plan': 'ChatGPT Plus', 'accountMasked': 's***@e***.test', 'orderNoMasked': '•••• 123456',
            'createdAt': '2026-10-25T11:00:00Z', 'processingAt': None, 'completedAt': None, 'updatedAt': None,
            'requiresVerification': False, 'verification': None}
    data.update(extra)
    return {'ok': True, 'data': data}

PROCESSING = order('PROCESSING', processingAt='2026-10-25T11:00:10Z')
VERIFY = order('PROCESSING', processingAt='2026-10-25T11:00:10Z', requiresVerification=True, verification=VERIFICATION)
COMPLETED = order('COMPLETED', processingAt='2026-10-25T11:00:10Z', completedAt='2026-10-25T11:01:00Z')
FAILED = order('FAILED', processingAt='2026-10-25T11:00:10Z', updatedAt='2026-10-25T11:02:00Z')

# One mutable mock table so each state only changes what it needs.
state = {
    'check': live(), 'verify': (200, {'ok': True, 'data': {'kind': 'card', 'valid': True, 'plan': 'ChatGPT Plus', 'status': 'AVAILABLE'}}),
    'submit': (200, order('PENDING')), 'query': (200, PROCESSING),
    'team_invite': (200, {'ok': True, 'data': {'status': 'success'}}),
    'team_ready': (200, {'ok': True, 'data': {'status': 'success', 'account': {'email': 'team-ready@example.test', 'password': 'Demo-Pass-2026', 'totp_secret': 'JBSWY3DPEHPK3PXP'}}}),
    'availability': (200, {'ok': True, 'data': {'inviteSeatsRemaining': 48, 'readyAccountsRemaining': 11}}),
}

shutil.rmtree(OUT, ignore_errors=True)

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, args=['--no-sandbox'])
    context = browser.new_context(viewport={'width': 1440, 'height': 1000}, reduced_motion='reduce', color_scheme='light', locale='zh-CN')
    page = context.new_page()
    page.add_init_script("window.Stripe=()=>({handleNextAction:async()=>({})})")
    page.route('**/api/service/status*', lambda r: j(r, {'ok': True, 'data': {'online': True, 'latencyMs': 20, 'cached': True}}))
    page.route('**/api/orders/events', lambda r: j(r, {'ok': True, 'data': {'recorded': True}}))
    page.route('**/api/subscriptions/check', lambda r: j(r, state['check']))
    page.route('**/api/cards/verify', lambda r: j(r, state['verify'][1], state['verify'][0]))
    page.route('**/api/orders/submit', lambda r: j(r, state['submit'][1], state['submit'][0]))
    page.route('**/api/orders/query', lambda r: j(r, state['query'][1], state['query'][0]))
    page.route('**/api/team/availability', lambda r: j(r, state['availability'][1], state['availability'][0]))
    page.route('**/api/team/invite', lambda r: j(r, state['team_invite'][1], state['team_invite'][0]))
    page.route('**/api/team/ready', lambda r: j(r, state['team_ready'][1], state['team_ready'][0]))

    counters = {}
    def snap(group, name):
        folder = OUT / group
        folder.mkdir(parents=True, exist_ok=True)
        counters[group] = counters.get(group, 0) + 1
        page.wait_for_timeout(250)
        page.screenshot(path=str(folder / f'{counters[group]:02d}-{name}.png'), full_page=True)

    # ---------------------------------------------------------------- /chatgpt
    def import_session():
        page.get_by_label('导入文件', exact=True).set_input_files({'name': 'session.json', 'mimeType': 'application/json', 'buffer': json.dumps(fixture['session']).encode()})
        expect(page.get_by_role('button', name='重新检查', exact=True)).to_be_visible()

    def recharge_home():
        page.goto(f'{BASE}/chatgpt', wait_until='networkidle')

    def to_step2(check=None):
        state['check'] = check or live()
        recharge_home(); import_session()
        page.get_by_role('button', name='重新检查', exact=True).click()
        expect(page.get_by_role('button', name='下一步：验证卡密', exact=True)).to_be_enabled()
        page.get_by_role('button', name='下一步：验证卡密', exact=True).click()
        page.get_by_label('兑换卡密', exact=True).fill('DEMO-TEST-CARD')

    def to_step3():
        state['verify'] = (200, {'ok': True, 'data': {'kind': 'card', 'valid': True, 'plan': 'ChatGPT Plus', 'status': 'AVAILABLE'}})
        to_step2()
        page.get_by_role('button', name='验证卡密', exact=True).click()
        expect(page.get_by_role('heading', name='卡密验证通过', exact=True)).to_be_visible()

    g = 'chatgpt'
    # Step 1: check subscription
    recharge_home(); snap(g, 'step1-initial')
    page.get_by_role('button', name='检查订阅', exact=True).click()
    expect(page.get_by_role('alert')).to_contain_text('完整、有效的 JSON'); snap(g, 'step1-fail-empty-json')
    page.get_by_label('Session JSON', exact=True).fill('{"not":"a session"')
    page.get_by_role('button', name='检查订阅', exact=True).click(); snap(g, 'step1-fail-bad-json')
    for label, value, text in [
        ('fail-access-restricted', live(fail=True), '访问受限'),
        ('fail-paid-plan', live('plus'), '请确保当前订阅已过期'),
        ('fail-team-workspace', live('free', 'workspace'), '请切换个人账号'),
    ]:
        state['check'] = value
        recharge_home(); import_session()
        page.get_by_role('button', name='重新检查', exact=True).click()
        expect(page.get_by_role('alert')).to_contain_text(text); snap(g, f'step1-{label}')
    state['check'] = live()
    recharge_home(); import_session(); snap(g, 'step1-session-imported')
    page.get_by_role('button', name='重新检查', exact=True).click()
    expect(page.get_by_role('button', name='下一步：验证卡密', exact=True)).to_be_enabled(); snap(g, 'step1-success-free-personal')

    # Step 2: verify card
    page.get_by_role('button', name='下一步：验证卡密', exact=True).click(); snap(g, 'step2-initial')
    page.get_by_label('兑换卡密', exact=True).fill('DEMO-TEST-CARD')
    page.get_by_role('button', name='显示卡密', exact=True).click(); snap(g, 'step2-code-entered')
    page.get_by_role('button', name='隐藏卡密', exact=True).click()
    for label, status, body, text in [
        ('fail-unsupported', 400, err('UNSUPPORTED_CARD'), '暂不支持在本站使用'),
        ('fail-invalid-or-used', 400, err('INVALID_CARD', can_query=True), '卡密无效或已使用'),
        ('fail-rate-limited', 429, err('RATE_LIMITED'), None),
        ('fail-service-unavailable', 502, err('UPSTREAM_UNAVAILABLE'), None),
    ]:
        state['verify'] = (status, body)
        page.get_by_role('button', name='验证卡密', exact=True).click()
        expect(page.get_by_role('alert').first).to_be_visible(); snap(g, f'step2-{label}')
    page.get_by_label('兑换卡密', exact=True).fill('A')
    page.get_by_role('button', name='验证卡密', exact=True).click(); snap(g, 'step2-fail-code-too-short')
    page.get_by_label('兑换卡密', exact=True).fill('DEMO-TEST-CARD')
    state['verify'] = (200, {'ok': True, 'data': {'kind': 'card', 'valid': True, 'plan': 'ChatGPT Plus', 'status': 'AVAILABLE'}})
    page.get_by_role('button', name='验证卡密', exact=True).click()
    expect(page.get_by_role('heading', name='卡密验证通过', exact=True)).to_be_visible(); snap(g, 'step2-success-card-verified')

    # Step 3: submit and show order result in place
    for label, status, body in [
        ('fail-submission-unknown', 409, err('SUBMISSION_UNKNOWN', can_query=True)),
        ('fail-session-rejected', 401, err('SESSION_REJECTED')),
        ('fail-service-unavailable', 502, err('UPSTREAM_UNAVAILABLE')),
    ]:
        to_step3()
        state['submit'] = (status, body)
        page.get_by_role('button', name='完成提交', exact=True).click()
        expect(page.get_by_role('alert').first).to_be_visible(); snap(g, f'step3-{label}')
    for label, submit_body, query_body in [
        ('success-pending', order('PENDING'), order('PENDING')),
        ('success-processing', order('PENDING'), PROCESSING),
        ('success-needs-verification', order('PENDING'), VERIFY),
        ('success-completed', order('PENDING'), COMPLETED),
        ('fail-order-failed', order('PENDING'), FAILED),
    ]:
        to_step3()
        state['submit'] = (200, submit_body); state['query'] = (200, query_body)
        page.get_by_role('button', name='完成提交', exact=True).click()
        expect(page.locator('.order-result')).to_be_visible()
        expect(page).not_to_have_url(re.compile(r'/order'))
        page.wait_for_timeout(500); snap(g, f'step3-{label}')
    # needs verification -> finish verification -> completed, all inside step 3
    to_step3()
    state['submit'] = (200, order('PENDING')); state['query'] = (200, VERIFY)
    page.get_by_role('button', name='完成提交', exact=True).click()
    expect(page.get_by_role('button', name='完成安全验证', exact=True)).to_be_visible()
    page.evaluate("window.Stripe=()=>({handleNextAction:async()=>({error:{message:'declined'}})})")
    page.get_by_role('button', name='完成安全验证', exact=True).click()
    expect(page.get_by_text('安全验证未完成', exact=False)).to_be_visible(); snap(g, 'step3-fail-verification-declined')
    page.evaluate("window.Stripe=()=>({handleNextAction:async()=>({})})")
    state['query'] = (200, COMPLETED)
    page.get_by_role('button', name='完成安全验证', exact=True).click()
    expect(page.get_by_role('heading', name='充值已完成', exact=True)).to_be_visible(); snap(g, 'step3-success-after-verification')

    # ---------------------------------------------------------------- /chatgpt/order
    g = 'chatgpt-order'
    page.goto(f'{BASE}/chatgpt/order', wait_until='networkidle'); snap(g, 'initial')
    page.get_by_label('兑换卡密', exact=True).fill('X'); page.get_by_role('button', name='查询订单', exact=True).click(); snap(g, 'fail-code-too-short')
    page.get_by_label('兑换卡密', exact=True).fill('DEMO-TEST-CARD')
    for label, status, body in [
        ('fail-not-found', 404, err('ORDER_NOT_FOUND')),
        ('fail-unsupported', 400, err('UNSUPPORTED_CARD')),
        ('fail-rate-limited', 429, err('RATE_LIMITED')),
        ('success-pending', 200, order('PENDING')),
        ('success-processing', 200, PROCESSING),
        ('success-needs-verification', 200, VERIFY),
        ('success-completed', 200, COMPLETED),
        ('fail-order-failed', 200, FAILED),
        ('fail-cancelled', 200, order('CANCELLED', updatedAt='2026-10-25T11:02:00Z')),
    ]:
        state['query'] = (status, body)
        page.get_by_label('兑换卡密', exact=True).fill('DEMO-TEST-CARD')
        page.locator('form button.primary-button').click()
        page.wait_for_timeout(500); snap(g, label)

    # ---------------------------------------------------------------- /team
    g = 'team'
    def team_home():
        page.goto(f'{BASE}/team', wait_until='networkidle')
    def submit_invite(cdk='TEAM-TEST-123456', email='demo@example.com'):
        page.get_by_label('卡密 (CDK)', exact=True).fill(cdk)
        page.get_by_label('您的 ChatGPT 账号邮箱', exact=True).fill(email)
        page.get_by_role('button', name='立即兑换并拉入团队空间', exact=True).click()
    def submit_ready(cdk='TEAM-TEST-READY'):
        page.get_by_role('button', name=re.compile('领取现成成品号')).click()
        page.get_by_label('卡密 (CDK)', exact=True).fill(cdk)
        page.get_by_role('button', name='立即核销并提取成品账号', exact=True).click()

    team_home(); snap(g, 'invite-initial')
    page.get_by_label('卡密 (CDK)', exact=True).fill('TEAM-TEST-123456')
    page.get_by_label('您的 ChatGPT 账号邮箱', exact=True).fill('demo@example.com'); snap(g, 'invite-filled')
    team_home(); page.get_by_role('button', name='立即兑换并拉入团队空间', exact=True).click()
    expect(page.get_by_role('alert')).to_be_visible(); snap(g, 'invite-fail-empty-code')
    team_home(); submit_invite(email='a@b'); expect(page.get_by_role('alert')).to_be_visible(); snap(g, 'invite-fail-bad-email')
    for label, status, body in [
        ('invite-fail-code-not-found', 400, {'ok': False, 'error': {'code': 'TEAM_REJECTED', 'message': '卡密不存在，请核对后重试。'}}),
        ('invite-fail-already-redeemed', 409, {'ok': False, 'error': {'code': 'TEAM_ALREADY_REDEEMED', 'message': '该卡密已经兑换过：团队邀请已发送到 d***@example.com，请前往邮箱查收邀请邮件，无需再次兑换。'}}),
        ('invite-fail-busy', 503, {'ok': False, 'error': {'code': 'TEAM_BUSY', 'message': '当前兑换人数较多，请稍后重试。'}}),
        ('invite-fail-timeout', 504, {'ok': False, 'error': {'code': 'TEAM_TIMEOUT', 'message': 'Team 兑换服务响应超时，请保留卡密和当前页面，勿重复提交，请您联系网站客服协助处理。'}}),
        ('invite-fail-service-unavailable', 503, {'ok': False, 'error': {'code': 'TEAM_NOT_CONFIGURED', 'message': 'Team 兑换服务暂未开放，请您联系网站客服协助处理。'}}),
    ]:
        state['team_invite'] = (status, body)
        team_home(); submit_invite(); expect(page.get_by_role('alert')).to_be_visible(); snap(g, label)
    state['team_invite'] = (200, {'ok': True, 'data': {'status': 'success'}})
    team_home(); submit_invite(); expect(page.get_by_role('heading', name='兑换成功！', exact=True)).to_be_visible(); snap(g, 'invite-success')

    team_home(); page.get_by_role('button', name=re.compile('领取现成成品号')).click(); snap(g, 'ready-initial')
    page.get_by_label('卡密 (CDK)', exact=True).fill('TEAM-TEST-READY'); snap(g, 'ready-filled')
    team_home(); page.get_by_role('button', name=re.compile('领取现成成品号')).click()
    page.get_by_role('button', name='立即核销并提取成品账号', exact=True).click(); expect(page.get_by_role('alert')).to_be_visible(); snap(g, 'ready-fail-empty-code')
    for label, status, body in [
        ('ready-fail-code-not-found', 400, {'ok': False, 'error': {'code': 'TEAM_REJECTED', 'message': '卡密不存在，请核对后重试。'}}),
        ('ready-fail-out-of-stock', 400, {'ok': False, 'error': {'code': 'TEAM_REJECTED', 'message': '现成账号库存不足，请稍后再试。'}}),
        ('ready-fail-result-unconfirmed', 502, {'ok': False, 'error': {'code': 'TEAM_RESPONSE', 'message': '现成账号结果暂时无法确认，请勿重复提交，请您联系网站客服协助处理。'}}),
    ]:
        state['team_ready'] = (status, body)
        team_home(); submit_ready(); expect(page.get_by_role('alert')).to_be_visible(); snap(g, label)
    state['team_ready'] = (200, {'ok': True, 'data': {'status': 'success', 'account': {'email': 'team-ready@example.test', 'password': 'Demo-Pass-2026', 'totp_secret': 'JBSWY3DPEHPK3PXP'}}})
    team_home(); submit_ready(); expect(page.get_by_role('heading', name='账号出库成功！', exact=True)).to_be_visible(); snap(g, 'ready-success')
    state['team_ready'] = (200, {'ok': True, 'data': {'status': 'success', 'account': {'email': 'team-ready@example.test', 'password': 'Demo-Pass-2026', 'totp_secret': ''}}})
    team_home(); submit_ready(); expect(page.get_by_role('heading', name='账号出库成功！', exact=True)).to_be_visible(); snap(g, 'ready-success-no-2fa')

    browser.close()

total = sum(1 for _ in OUT.rglob('*.png'))
print(f'{total} screenshots written to {OUT}')
