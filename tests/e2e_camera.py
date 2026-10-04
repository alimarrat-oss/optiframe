"""Test de la caméra intégrée avec un flux vidéo simulé (fichier y4m) dans Chromium."""
import asyncio, os, sys
from playwright.async_api import async_playwright
URL = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:8080/index.html'
OUT = os.environ.get('OUT', '/tmp/optiframe-shots') + '/'
os.makedirs(OUT, exist_ok=True)
Y4M = OUT + 'fakecam.y4m'
if not os.path.exists(Y4M):  # flux vidéo simulé (1080 x 1440) à partir de la photo de démo
    import cv2
    im = cv2.resize(cv2.imread(os.path.join(os.path.dirname(__file__), '..', 'assets', 'demo', 'verre_teinte_OG.jpg')), (1080, 1440), interpolation=cv2.INTER_AREA)
    yuv = cv2.cvtColor(im, cv2.COLOR_BGR2YUV_I420)
    with open(Y4M, 'wb') as f:
        f.write(b'YUV4MPEG2 W1080 H1440 F15:1 Ip A1:1 C420jpeg\n')
        for _ in range(10):
            f.write(b'FRAME\n'); f.write(yuv.tobytes())
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', f'--use-file-for-fake-video-capture={Y4M}', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'])
        ctx = await b.new_context(**p.devices['iPhone 13'], permissions=['camera'])
        page = await ctx.new_page()
        logs = []
        page.on('console', lambda m: logs.append(f'[{m.type}] {m.text}'))
        page.on('pageerror', lambda e: logs.append(f'[pageerror] {e}'))
        await page.goto(URL)
        await page.wait_for_timeout(1000)
        await page.click('#card-OG .act-cam')
        await page.wait_for_timeout(2500)
        await page.screenshot(path=OUT + '10_camera.png')
        print('status:', await page.inner_text('#camera .cam-status'))
        await page.click('#camera .cam-shutter')
        await page.wait_for_function("document.querySelector('#card-OG .shots table') || document.querySelector('#card-OG .msg.err')", timeout=120000)
        await page.wait_for_timeout(500)
        print('OG:', (await page.inner_text('#card-OG .measures')).replace('\n', ' '), '|', await page.inner_text('#card-OG .lc-msgs'))
        await page.screenshot(path=OUT + '11_after_camera.png')
        print('\n'.join(l for l in logs if 'GPU stall' not in l)[-2000:])
        await b.close()
asyncio.run(main())
