import { chromium } from 'playwright-core';
import { createServer } from 'vite';
const out = process.argv[2];
const server = await createServer({ root: process.cwd(), server: { port: 5198, host: '127.0.0.1', hmr: false }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ channel: 'chrome' });
try {
  for (const [name, q] of [
    ['home-0.3', 'lv=3&fill=0.9&cheer=2&wall=2&fx=11&fxT=0.3'],
    ['home-1.2', 'lv=3&fill=0.9&cheer=2&wall=2&fx=11&fxT=1.2'],
    ['home-2.0', 'lv=3&fill=0.9&cheer=2&wall=2&fx=11&fxT=2.0'],
    ['home-3.7', 'lv=3&fill=0.9&cheer=2&wall=2&fx=11&fxT=3.7'],
    ['away-2.0', 'lv=3&fill=0.8&cheer=1&fx=12&fxT=2.0'],
    ['calm', 'lv=3&fill=0.9&cheer=2&fx=13&fxT=2.0'],
    ['wall1', 'lv=1&fill=0.5&wall=1'],
  ]) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
    await page.goto(`http://127.0.0.1:5198/src/stadium/preview.html?${q}`);
    await page.waitForTimeout(900);
    await page.locator('#stage canvas').screenshot({ path: `${out}/${name}.png` });
    await page.close();
  }
} finally {
  await browser.close();
  await server.close();
}
