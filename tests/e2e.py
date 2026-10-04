"""Test de bout en bout dans Chromium (émulation mobile) : démo, mesures, monture, STL."""
import asyncio, os, sys, time
from playwright.async_api import async_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:8080/index.html'
OUT = os.environ.get('OUT', '/tmp/optiframe-shots') + '/'
os.makedirs(OUT, exist_ok=True)

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
        dev = p.devices['Pixel 7']
        ctx = await b.new_context(**dev, accept_downloads=True)
        page = await ctx.new_page()
        logs = []
        page.on('console', lambda m: logs.append(f'[{m.type}] {m.text}'))
        page.on('pageerror', lambda e: logs.append(f'[pageerror] {e}'))
        await page.goto(URL)
        await page.wait_for_timeout(1500)
        await page.screenshot(path=OUT + '01_home.png', full_page=True)
        t0 = time.time()
        await page.click('#demoBtn')
        # attendre les deux analyses
        await page.wait_for_function("document.querySelectorAll('.shots table').length >= 2 || document.querySelectorAll('.msg.err').length >= 1", timeout=180000)
        await page.wait_for_timeout(800)
        print('demo time', round(time.time() - t0, 1), 's')
        await page.screenshot(path=OUT + '02_lenses.png', full_page=True)
        vals = await page.eval_on_selector_all('.lens-card', "els => els.map(e => [e.querySelector('.vA').textContent, e.querySelector('.vB').textContent, e.querySelector('.lc-msgs').textContent])")
        print('measures', vals)
        await page.click('#nav-frame')
        await page.wait_for_function("!document.querySelector('#dlStl').disabled", timeout=120000)
        await page.wait_for_timeout(1500)
        await page.screenshot(path=OUT + '03_frame.png', full_page=True)
        stats = await page.inner_text('#frameStats')
        print('frame stats', stats.replace('\n', ' | '))
        print('fit', (await page.inner_text('#fitNums')).replace('\n', ' | '))
        async with page.expect_download() as dl:
            await page.click('#dlStl')
        d = await dl.value
        await d.save_as(OUT + 'monture.stl')
        async with page.expect_download() as dl:
            await page.click('#dlSvg')
        d = await dl.value
        await d.save_as(OUT + 'contours.svg')
        await page.click('#nav-steps')
        await page.wait_for_timeout(500)
        await page.screenshot(path=OUT + '04_steps.png', full_page=True)
        await page.click('#nav-help')
        await page.wait_for_timeout(300)
        await page.screenshot(path=OUT + '05_help.png', full_page=True)
        await page.click('#langBtn')
        await page.click('#nav-lenses')
        await page.wait_for_timeout(300)
        await page.screenshot(path=OUT + '06_lenses_en.png', full_page=False)
        await page.click('#shareBtn')
        await page.wait_for_timeout(500)
        await page.screenshot(path=OUT + '07_share.png')
        print('\n'.join(logs[-30:]))
        await b.close()

asyncio.run(main())
