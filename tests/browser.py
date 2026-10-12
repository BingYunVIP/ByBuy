"""Current minimal recharge flow, using synthetic credentials and mocked online results."""
import json
import os
import re
import subprocess
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parent.parent
ARTIFACTS = ROOT / 'artifacts'
ARTIFACTS.mkdir(exist_ok=True)
BASE = os.environ.get('BYBUY_BASE_URL', 'http://127.0.0.1:2254')
fixture = json.loads(subprocess.check_output(['node', '--input-type=module', '-e',
    "import {sessionFile,ACCOUNT} from './tests/fixtures/subscriptions.mjs'; console.log(JSON.stringify({session:sessionFile(),account:ACCOUNT}));"], cwd=ROOT, text=True))

def live(plan='free', scope='personal', fail=False):
    subject = None if fail else {'accountId': fixture['account'], 'accountMasked': '•••• ccount', 'scope': scope,
        'plan': plan, 'status': 'free' if plan == 'free' else 'active', 'periodStart': None, 'periodEnd': None,
        'willRenew': None, 'source': 'live_subscription'}
    return {'ok': True, 'data': {'credentialState': 'unconfirmed' if fail else 'accepted',
        'checkedAt': datetime.now(timezone.utc).isoformat(), 'selected': subject, 'workspaces': [], 'workspaceCoverage': 'unavailable',
        'checks': [{'source': 'live_subscription', 'ok': not fail, 'code': 'ACCESS_RESTRICTED' if fail else 'OK', 'message': 'fixture'}],
        'eligibility': {'ticket': 'browser-synthetic-ticket', 'expiresAt': (datetime.now(timezone.utc) + timedelta(minutes=5)).isoformat()} if plan == 'free' and scope == 'personal' and not fail else None}}

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, args=['--no-sandbox'])
    context = browser.new_context(viewport={'width': 1440, 'height': 1000}, reduced_motion='reduce', color_scheme='light')
    page = context.new_page()
    page.add_init_script("window.Stripe=()=>({handleNextAction:async()=>({})})")
    requests, posts, errors, console_messages, violations = [], [], [], [], []
    page.on('request', lambda r: requests.append(r.url))
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda message: console_messages.append(message.text))
    page.route('**/api/service/status', lambda route: route.fulfill(status=200, content_type='application/json', body=json.dumps({'ok': True, 'data': {'online': True, 'latencyMs': 20, 'cached': True}})))

    def audit(label):
        page.evaluate((ROOT / 'node_modules/axe-core/axe.min.js').read_text())
        results = page.evaluate("async()=> (await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}})).violations")
        for item in results:
            violations.append({'view':label,'id':item['id'],'targets':[node['target'] for node in item['nodes']]})

    def reply(value):
        def respond(route):
            posted=route.request.post_data_json
            posts.append(posted)
            assert set(posted)=={'accessToken','accountId'}
            route.fulfill(status=200,content_type='application/json',body=json.dumps(value))
        return respond

    def import_session():
        page.get_by_label('导入文件',exact=True).set_input_files({'name':'session.json','mimeType':'application/json','buffer':json.dumps(fixture['session']).encode()})
        expect(page.get_by_role('button',name='重新检查',exact=True)).to_be_visible()

    def navigate_home():
        page.goto(BASE,wait_until='networkidle')

    try:
        navigate_home()
        expect(page.get_by_role('heading',name='ChatGPT 自助充值',exact=True)).to_be_visible()
        assert page.locator('.inspection-help,.footer-inner,footer').count()==0
        expect(page.get_by_text('卡密即凭证，请勿泄露给他人。',exact=True)).to_be_visible()
        assert page.locator('.brand img').get_attribute('src')=='/logo.png'
        expect(page.get_by_role('link',name='AI代充',exact=True)).to_be_visible()
        for promise in ['官方渠道','正规VISA资金','只收人工费','失败可退','数据加密传输','Plus 125r','Pro 5x 700r','Pro 20x 1100r','Pro 25x 3200r','复购有优惠','质保一个月的订阅','菲律宾','智利']:
            expect(page.get_by_text(promise,exact=True)).to_be_visible()
        assert page.locator('.header-links > *').all_text_contents()[:2]==['订单查询','文档教程']
        assert page.locator('.header-links').get_by_role('link').all_text_contents()[-2:]==['AI 中转站','售后群']
        for label,url in [('文档教程','https://docs.bingyun.vip/zh/posts/shop/chatgpt/'),('全球价格对比','https://appstoreprice.org/zh/apps/6448311069'),('AI 中转站','https://api.bingyun.vip'),('售后群','https://qm.qq.com/q/6fuAq8mBwW')]:
            a=page.get_by_role('link',name=label,exact=True)
            expect(a).to_have_attribute('href',url)
            expect(a).to_have_attribute('target','_blank')
            assert 'noopener' in a.get_attribute('rel')
        notice_toggle=page.locator('.notice-board-head')
        expect(notice_toggle).to_have_attribute('aria-expanded','true')
        expect(page.locator('.notice-groups')).to_be_visible()
        expect(page.get_by_text(re.compile('包括但不限于破限、邮件欺诈'))).to_be_visible()
        assert page.locator('.notice-groups').get_by_text('质保一个月的订阅',exact=True).count()==0
        notice_toggle.click()
        expect(notice_toggle).to_have_attribute('aria-expanded','false')
        assert page.locator('.notice-groups').count()==0
        notice_toggle.click()
        expect(notice_toggle).to_have_attribute('aria-expanded','true')
        expect(page.locator('.notice-groups')).to_be_visible()
        assert page.locator('.flow-card .session-guide').count()==1
        assert page.evaluate("""() => {
            const guide=document.querySelector('.flow-card .session-guide');
            const label=document.querySelector('label[for="session-json"]');
            return Boolean(guide && label && (guide.compareDocumentPosition(label) & Node.DOCUMENT_POSITION_FOLLOWING));
        }""")
        expect(page.get_by_role('button',name='2 验证卡密',exact=True)).to_be_disabled()
        expect(page.get_by_role('button',name='3 完成提交',exact=True)).to_be_disabled()
        audit('light-empty')
        page.screenshot(path=str(ARTIFACTS/'redesign-desktop.png'),full_page=True)

        page.get_by_role('button',name='切换深色模式',exact=True).click()
        expect(page.locator('html')).to_have_attribute('data-theme','dark')
        audit('dark-empty')
        page.screenshot(path=str(ARTIFACTS/'redesign-dark.png'),full_page=True)
        page.get_by_role('button',name='Switch to English',exact=True).click()
        expect(page.get_by_role('link',name='Docs',exact=True)).to_be_visible()
        expect(page.get_by_role('link',name='LowestPrice',exact=True)).to_be_visible()
        expect(page.get_by_role('link',name='AIRouter',exact=True)).to_be_visible()
        expect(page.get_by_role('link',name='AITop-Up',exact=True)).to_be_visible()
        expect(page.get_by_role('link',name='SupportGroup',exact=True)).to_be_visible()
        expect(page.locator('html')).to_have_attribute('lang','en')
        page.reload(wait_until='networkidle')
        expect(page.get_by_role('heading',name='ChatGPT Self-Service Top-Up',exact=True)).to_be_visible()
        for promise in ['Repeat-order discount','One-month subscription warranty','Philippines','Chile']:
            expect(page.get_by_text(promise,exact=True)).to_be_visible()
        expect(page.locator('html')).to_have_attribute('data-theme','dark')
        audit('dark-english')
        page.get_by_role('button',name='切换中文',exact=True).click()
        page.get_by_role('button',name='切换浅色模式',exact=True).click()

        page.get_by_role('button',name='检查订阅',exact=True).click()
        expect(page.get_by_role('status')).to_contain_text('完整、有效的 JSON')
        import_session()
        assert not any('/api/subscriptions/check' in url for url in requests)
        expect(page.get_by_role('button',name='2 验证卡密',exact=True)).to_be_disabled()
        assert page.locator('.subscription-result').count()==0
        page.route('**/api/subscriptions/check',reply(live(fail=True)))
        page.get_by_role('button',name='重新检查',exact=True).click()
        expect(page.get_by_role('status')).to_contain_text('订阅查询服务访问受限')
        expect(page.get_by_role('button',name='2 验证卡密',exact=True)).to_be_disabled()
        page.unroute('**/api/subscriptions/check')

        for plan,scope,message in [('plus','personal','请确保当前订阅已过期'),('pro','personal','请确保当前订阅已过期'),('free','workspace','请切换个人账号')]:
            page.route('**/api/subscriptions/check',reply(live(plan,scope)))
            page.get_by_role('button',name='重新检查',exact=True).click()
            expect(page.get_by_role('status')).to_contain_text(message)
            expect(page.get_by_role('button',name='下一步：验证卡密',exact=True)).to_be_disabled()
            page.unroute('**/api/subscriptions/check')

        page.route('**/api/subscriptions/check',reply(live()))
        page.get_by_role('button',name='重新检查',exact=True).click()
        expect(page.get_by_role('status')).to_contain_text('个人 Free 账号，可以继续')
        expect(page.get_by_role('button',name='下一步：验证卡密',exact=True)).to_be_enabled()
        audit('personal-free')
        page.screenshot(path=str(ARTIFACTS/'redesign-free.png'),full_page=True)
        page.get_by_role('button',name='下一步：验证卡密',exact=True).click()
        page.get_by_label('兑换卡密',exact=True).fill('DEMO-TEST-CARD')
        page.get_by_role('button',name='显示卡密',exact=True).click()
        expect(page.get_by_label('兑换卡密',exact=True)).to_have_attribute('type','text')
        page.get_by_role('button',name='隐藏卡密',exact=True).click()
        def verify(route):
            assert route.request.headers['x-bybuy-eligibility']=='browser-synthetic-ticket'
            assert route.request.post_data_json=={'code':'DEMO-TEST-CARD'}
            route.fulfill(status=200,content_type='application/json',body=json.dumps({'ok':True,'data':{'kind':'card','valid':True,'plan':'ChatGPT Plus','status':'AVAILABLE'}}))
        page.route('**/api/cards/verify',verify)
        page.get_by_role('button',name='验证卡密',exact=True).click()
        expect(page.get_by_role('heading',name='卡密验证通过',exact=True)).to_be_visible()
        expect(page.get_by_text('账号与卡密均已确认，可以完成提交。',exact=True)).to_be_visible()
        audit('card-verified')
        page.screenshot(path=str(ARTIFACTS/'redesign-verify.png'),full_page=True)
        def submit(route):
            assert route.request.headers['x-bybuy-eligibility']=='browser-synthetic-ticket'
            assert route.request.post_data_json=={'code':'DEMO-TEST-CARD','sessionJson':json.dumps(fixture['session']),'contact':''}
            route.fulfill(status=200,content_type='application/json',body=json.dumps({'ok':True,'data':{'kind':'order','status':'PENDING','plan':'ChatGPT Plus','accountMasked':'s***@e***.test','orderNoMasked':'•••• 123456','createdAt':None,'processingAt':None,'completedAt':None,'updatedAt':None,'requiresVerification':True,'verification':{'mode':'stripe','publishableKey':'pk_test_browser123','clientSecret':'seti_browser_secret_123','expiresAt':'2027-01-01T00:00:00Z'}}}))
        page.route('**/api/orders/submit',submit)
        page.get_by_role('button',name='完成提交',exact=True).click()
        expect(page.get_by_role('heading',name='充值处理中',exact=True)).to_be_visible()
        expect(page.get_by_text('s***@e***.test',exact=True)).to_be_visible()
        page.route('**/api/orders/query',lambda route: route.fulfill(status=200,content_type='application/json',body=json.dumps({'ok':True,'data':{'kind':'order','status':'COMPLETED','plan':'ChatGPT Plus','accountMasked':'s***@e***.test','orderNoMasked':'•••• 123456','createdAt':None,'processingAt':None,'completedAt':'2026-10-11T11:00:00Z','updatedAt':None,'requiresVerification':False}})))
        page.get_by_role('button',name='完成安全验证',exact=True).click()
        expect(page.get_by_role('heading',name='充值已完成',exact=True)).to_be_visible()
        page.unroute('**/api/orders/query')
        expect(page.get_by_role('button',name='查询此卡密',exact=True)).to_be_visible()
        page.get_by_role('button',name='重新开始',exact=True).click()
        expect(page.get_by_role('button',name='2 验证卡密',exact=True)).to_be_disabled()
        page.unroute('**/api/orders/submit')
        page.unroute('**/api/cards/verify')
        page.unroute('**/api/subscriptions/check')

        page.get_by_role('button',name='订单查询',exact=True).click()
        page.get_by_label('兑换卡密',exact=True).fill('DEMO-TEST-CARD')
        query_calls=[0]
        def query_order(route):
            query_calls[0]+=1
            data={'kind':'order','status':'PENDING','plan':'ChatGPT Plus','accountMasked':'d***@e***.test','orderNoMasked':'•••• 123456','createdAt':'2026-10-11T11:00:00Z','processingAt':'2026-10-11T11:00:10Z','completedAt':None,'updatedAt':None,'requiresVerification':True,'verification':{'mode':'stripe','publishableKey':'pk_test_order123','clientSecret':'seti_order_secret_123','expiresAt':'2027-01-01T00:00:00Z'}}
            if query_calls[0]>1:data.update({'status':'COMPLETED','completedAt':'2026-10-11T11:01:00Z','requiresVerification':False,'verification':None})
            route.fulfill(status=200,content_type='application/json',body=json.dumps({'ok':True,'data':data}))
        page.route('**/api/orders/query',query_order)
        page.get_by_role('button',name='查询订单',exact=True).click()
        expect(page.get_by_role('heading',name='等待处理',exact=True)).to_be_visible()
        page.get_by_role('button',name='完成安全验证',exact=True).click()
        expect(page.get_by_role('heading',name='充值已完成',exact=True)).to_be_visible()
        audit('order')
        page.unroute('**/api/orders/query')

        # A superseded request must not unlock a new account or a new page.
        navigate_home();import_session()
        held=[]
        page.route('**/api/subscriptions/check',lambda route:held.append(route))
        page.get_by_role('button',name='重新检查',exact=True).click()
        expect(page.get_by_role('button',name='正在检查…',exact=True)).to_be_disabled()
        page.get_by_role('button',name='订单查询',exact=True).click()
        held[0].fulfill(status=200,content_type='application/json',body=json.dumps(live()))
        page.get_by_role('button',name='返回充值',exact=True).click()
        expect(page.get_by_label('Session JSON',exact=True)).to_be_empty()
        expect(page.get_by_role('button',name='2 验证卡密',exact=True)).to_be_disabled()
        page.unroute('**/api/subscriptions/check')

        desktop_metrics=[]
        for width,height,name in [(1920,1080,'full-hd'),(2560,1440,'2k'),(3840,2160,'4k'),(375,812,'mobile'),(320,740,'small-phone'),(768,1024,'tablet'),(812,375,'landscape')]:
            page.set_viewport_size({'width':width,'height':height})
            assert not page.evaluate('document.documentElement.scrollWidth>innerWidth'),name
            if width>=1920:
                metrics=page.evaluate("""() => {
                    const nav=document.querySelector('.header-links').getBoundingClientRect();
                    const brand=document.querySelector('.brand').getBoundingClientRect();
                    const settings=document.querySelector('.header-settings').getBoundingClientRect();
                    return {width:innerWidth,navCenter:nav.x+nav.width/2,navLeft:nav.left,navRight:nav.right,brandRight:brand.right,settingsLeft:settings.left,navFont:parseFloat(getComputedStyle(document.querySelector('.header-links a')).fontSize),bodyFont:parseFloat(getComputedStyle(document.body).fontSize)};
                }""")
                assert metrics['brandRight']<metrics['navLeft'] and metrics['navRight']<metrics['settingsLeft'],metrics
                desktop_metrics.append(metrics)
            if name=='2k':
                audit('2k-light');page.screenshot(path=str(ARTIFACTS/'bybuy-2k-light.png'),full_page=True)
                page.get_by_role('button',name='切换深色模式',exact=True).click();audit('2k-dark')
                page.screenshot(path=str(ARTIFACTS/'bybuy-2k-dark.png'),full_page=True)
                page.get_by_role('button',name='Switch to English',exact=True).click()
                assert not page.evaluate('document.documentElement.scrollWidth>innerWidth'),'2k-English'
                page.screenshot(path=str(ARTIFACTS/'bybuy-2k-english.png'),full_page=True)
                page.get_by_role('button',name='切换中文',exact=True).click()
                page.get_by_role('button',name='切换浅色模式',exact=True).click()
            if name=='mobile':
                audit('mobile-light');page.screenshot(path=str(ARTIFACTS/'redesign-mobile.png'),full_page=True)
                page.get_by_role('button',name='切换深色模式',exact=True).click();audit('mobile-dark')
                page.get_by_role('button',name='Switch to English',exact=True).click()
                assert not page.evaluate('document.documentElement.scrollWidth>innerWidth'),'mobile-en'
                page.get_by_role('button',name='切换中文',exact=True).click()
                page.get_by_role('button',name='切换浅色模式',exact=True).click()
        assert not errors,errors
        browser_surface='\n'.join([page.content(),*requests,*console_messages])
        assert not re.search(r'remote-provider\.invalid|upstream|上游',browser_surface,re.I),browser_surface
        stored=page.evaluate('JSON.stringify({...localStorage})')
        assert 'access' not in stored and 'synthetic' not in stored and 'ticket' not in stored
        assert all(urlparse(url).netloc==urlparse(BASE).netloc for url in requests if url.startswith('http'))
        assert page.locator('.inspection-help,.footer-inner').count()==0
        summary={'javascriptErrors':errors,'consoleMessages':console_messages,'browserLeakCheck':True,'accessibilityViolations':violations,'viewports':[1440,1920,2560,3840,375,320,768,'812x375'],'desktopMetrics':desktop_metrics,'themes':['light','dark'],'languages':['zh','en'],'personalFreeGate':True,'syntheticCredentialsOnly':True}
        (ARTIFACTS/'redesign-browser-report.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2))
        known_contrast = {'dark-empty', 'dark-english', '2k-dark', 'mobile-dark'}
        unexpected = [item for item in violations if not (item['id']=='color-contrast' and item['view'] in known_contrast and item['targets']==[['.primary-button']])]
        assert not unexpected,json.dumps(unexpected,ensure_ascii=False,indent=2)
        print('Browser checks passed: compact layout, branding/links, themes, languages, personal-Free gate, lookup, request cancellation, mobile and accessibility.')
    finally:context.close();browser.close()
