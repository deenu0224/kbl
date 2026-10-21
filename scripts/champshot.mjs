// 우승 세리머니 확인: node scripts/champshot.mjs <outDir> [--bench]
//   기본: 구장 미리보기에서 fx 시간을 고정한 프레임(?fxT=) + 실제 시간으로 흐르는 프레임 몇 장을 찍는다
//   --bench: 폰 폭(390px)에서 drawFrame 100회 평균 시간을 잰다 (CPU 4배 느리게 한 값도 함께)
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
const out = process.argv[2] ?? 'screens-out/champ';
const bench = process.argv.includes('--bench');
const PORT = 5198;
const server = await createServer({ root: process.cwd(), server: { port: PORT, host: '127.0.0.1', hmr: false }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ channel: 'chrome' });
const base = `http://127.0.0.1:${PORT}/src/stadium/preview.html`;
try {
  if (bench) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });
    await page.goto(`${base}?lv=3&phone=1`);
    await page.waitForTimeout(600);
    const run = () =>
      page.evaluate(async () => {
        const dl = await import('/src/stadium/dynamicLayer.ts');
        const sl = await import('/src/stadium/staticLayer.ts');
        const fac = { seats: 3, food: 3, training: 3 };
        const layers = sl.buildStatic(fac, '#ff8a1f', '#1b5e3a');
        const cv = document.createElement('canvas');
        cv.width = 640;
        cv.height = 420;
        const ctx = cv.getContext('2d');
        const scene = (fx, extra = {}) => ({ facilities: fac, homeColor: '#ff8a1f', homeColor2: '#1b5e3a', awayColor: '#c0263a', fill: 0.95, weather: 'sunny', night: true, playing: true, homeBatting: false, fx, fxKey: 7, banners: 1, oldBanner: true, cheerLv: 3, ...extra });
        const night = dl.buildNightTint();
        const time = (sc) => {
          for (let i = 0; i < 10; i++) dl.drawFrame({ ctx, scene: sc, layers, t: i / 14, fxT: 1 + i * 0.07, night });
          const t0 = performance.now();
          for (let i = 0; i < 100; i++) dl.drawFrame({ ctx, scene: sc, layers, t: i / 14, fxT: 0.5 + i * 0.065, night });
          return (performance.now() - t0) / 100;
        };
        return {
          none: time(scene({ kind: 'none' })),
          win: time(scene({ kind: 'win' })),
          champion: time(scene({ kind: 'champion', away: false, c1: '#ff8a1f', c2: '#1b5e3a' })),
          championAway: time(scene({ kind: 'champion', away: true, c1: '#c0263a', c2: '#ffffff' }, { awayFans: 0.25, oldBanner: false, cheerLv: 1 })),
        };
      });
    const fast = await run();
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    const slow = await run();
    const f = (o) => Object.entries(o).map(([k, v]) => `${k} ${v.toFixed(2)}ms`).join(' · ');
    console.log(`drawFrame 100회 평균 (이 기기): ${f(fast)}`);
    console.log(`drawFrame 100회 평균 (CPU ×4 느리게): ${f(slow)}`);
  } else {
    const shots = [
      ['home-0.3', 'lv=3&fill=0.9&cheer=2&wall=2&fx=11&fxT=0.3'],
      ['home-1.2', 'lv=3&fill=0.9&cheer=2&wall=2&fx=11&fxT=1.2'],
      ['home-2.0', 'lv=3&fill=0.9&cheer=2&wall=2&fx=11&fxT=2.0'],
      ['home-3.7', 'lv=3&fill=0.9&cheer=2&wall=2&fx=11&fxT=3.7'],
      ['away-2.0', 'lv=3&fill=0.8&cheer=1&fx=12&fxT=2.0'],
      ['calm', 'lv=3&fill=0.9&cheer=2&fx=13&fxT=2.0'],
      ['wall1', 'lv=1&fill=0.5&wall=1'],
    ];
    for (const [name, q] of shots) {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
      await page.goto(`${base}?${q}`);
      await page.waitForTimeout(900);
      await page.locator('#stage canvas').screenshot({ path: `${out}/${name}.png` });
      await page.close();
    }
    // 실제 시간: 우승 fx 버튼을 눌러 처음부터 재생하고 0.4초 간격으로 찍는다 (fxT 고정 없음)
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
    await page.goto(`${base}?lv=3&fill=0.9&cheer=2`);
    await page.waitForTimeout(600);
    await page.getByRole('button', { name: '우승(홈)', exact: true }).click();
    for (let i = 0; i < 6; i++) {
      await page.waitForTimeout(i === 0 ? 250 : 450);
      await page.locator('#stage canvas').screenshot({ path: `${out}/live-${i}.png` });
    }
    await page.close();
  }
} finally {
  await browser.close();
  await server.close();
}
