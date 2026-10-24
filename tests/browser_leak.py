import os
import re
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright, expect


BASE = os.environ.get('BYBUY_BASE_URL', 'http://127.0.0.1:2254')
FORBIDDEN = re.compile(r'remote-provider\.invalid|upstream|上游', re.I)


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True, args=['--no-sandbox'])
    page = browser.new_page(viewport={'width': 1440, 'height': 1000}, locale='zh-CN')
    console_messages = []
    page_errors = []
    requests = []
    asset_bodies = {}

    page.on('console', lambda message: console_messages.append(message.text))
    page.on('pageerror', lambda error: page_errors.append(str(error)))
    page.on('request', lambda request: requests.append(request.url))
    def capture_asset(response):
        if response.request.resource_type in {'script', 'stylesheet'} and urlparse(response.url).netloc == urlparse(BASE).netloc:
            try:
                asset_bodies[response.url] = response.text()
            except Exception:
                pass
    page.on('response', capture_asset)
    page.route('**/api/service/status*', lambda route: route.fulfill(
        status=200,
        content_type='application/json',
        body='{"ok":true,"data":{"online":true,"latencyMs":20,"cached":true}}',
    ))
    page.route('**/api/team/availability', lambda route: route.fulfill(
        status=200,
        content_type='application/json',
        body='{"ok":true,"data":{"inviteSeatsRemaining":45,"readyAccountsRemaining":21}}',
    ))

    snapshots = []
    for route in ['/', '/chatgpt', '/chatgpt/order', '/team', '/order']:
        page.goto(f'{BASE}{route}', wait_until='networkidle')
        expect(page.locator('.service-status')).to_be_visible()
        assert page.locator('.upstream-status').count() == 0
        snapshots.append(page.content())

    page.goto(BASE, wait_until='networkidle')
    page.get_by_role('button', name='Switch to English', exact=True).click()
    snapshots.append(page.content())

    browser_surface = '\n'.join([*snapshots, *asset_bodies.values(), *console_messages, *requests])
    assert not FORBIDDEN.search(browser_surface), 'Browser-visible service details were found.'
    assert not page_errors, page_errors

    base_host = urlparse(BASE).netloc
    allowed_static_hosts = {base_host, 'cdn.jsdelivr.net'}
    assert all(urlparse(url).netloc in allowed_static_hosts for url in requests if url.startswith(('http://', 'https://'))), requests

    browser.close()

print('Browser leak check passed: DOM, assets, Console, and Network are clean.')
