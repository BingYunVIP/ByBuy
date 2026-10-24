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

    page.on('console', lambda message: console_messages.append(message.text))
    page.on('pageerror', lambda error: page_errors.append(str(error)))
    page.on('request', lambda request: requests.append(request.url))
    page.route('**/api/service/status', lambda route: route.fulfill(
        status=200,
        content_type='application/json',
        body='{"ok":true,"data":{"online":true,"latencyMs":20,"cached":true}}',
    ))

    snapshots = []
    for route in ['/', '/order']:
        page.goto(f'{BASE}{route}', wait_until='networkidle')
        expect(page.locator('.service-status')).to_be_visible()
        assert page.locator('.upstream-status').count() == 0
        snapshots.append(page.content())

    page.goto(BASE, wait_until='networkidle')
    page.get_by_role('button', name='Switch to English', exact=True).click()
    snapshots.append(page.content())

    asset_text = page.evaluate(r"""async () => {
      const urls = [...document.querySelectorAll('script[src],link[rel="stylesheet"]')]
        .map(node => node.src || node.href);
      return (await Promise.all(urls.map(async url => await (await fetch(url)).text()))).join('\n');
    }""")

    browser_surface = '\n'.join([*snapshots, asset_text, *console_messages, *requests])
    assert not FORBIDDEN.search(browser_surface), 'Browser-visible service details were found.'
    assert not page_errors, page_errors

    base_host = urlparse(BASE).netloc
    assert all(urlparse(url).netloc == base_host for url in requests if url.startswith(('http://', 'https://'))), requests

    browser.close()

print('Browser leak check passed: DOM, assets, Console, and Network are clean.')
