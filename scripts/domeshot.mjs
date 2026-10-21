// 구장 미리보기 스크린샷 (돔 단계 확인용): node scripts/domeshot.mjs <outDir> [query ...]
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
const [out, ...qs] = process.argv.slice(2);
const server = await createServer({ server: { port: 5199, host: '127.0.0.1' }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ channel: 'chrome' });
for (const q of qs) {
  const phone = q.includes('phone=1');
  const page = await browser.newPage({ viewport: phone ? { width: 390, height: 844 } : { width: 1280, height: 900 }, deviceScaleFactor: 2 });
  await page.goto(`http://127.0.0.1:5199/src/stadium/preview.html?${q}`);
  await page.waitForTimeout(900);
  await page.locator('#stage').screenshot({ path: `${out}/${q.replace(/[^a-z0-9]+/gi, '_')}.png` });
  await page.close();
}
await browser.close();
await server.close();
