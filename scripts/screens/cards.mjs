// 공유 검증: 픽스처 세이브로 공유 카드 PNG 3종(결산·우승·연고 이전)과 링크 미리보기 이미지(public/og.png)를 만들고,
// 공유 문구·인텐트 주소·시스템 공유 호출을 확인한다. 외부로는 아무것도 보내지 않는다.
//   node scripts/screens/cards.mjs            (픽스처가 없으면 먼저 npm run screens)
//   node scripts/screens/cards.mjs --og       (public/og.png 도 다시 만든다)
// 산출물: screens-out/share/card-{season,champion,relocated}.png · share.json
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const FIX = resolve(ROOT, 'screens-out/fixtures');
const OUT = resolve(ROOT, 'screens-out/share');
const CASES = [
  { kind: 'season', fixture: 'ended' },
  { kind: 'champion', fixture: 'ending' },
  { kind: 'relocated', fixture: 'over' },
];
const fail = [];
const check = (ok, what) => {
  if (!ok) fail.push(what);
  console.log(`${ok ? '✓' : '✗'} ${what}`);
};

mkdirSync(OUT, { recursive: true });
const server = await createServer({ root: ROOT, logLevel: 'error', clearScreen: false, server: { port: 5199, strictPort: false, host: '127.0.0.1', hmr: false, watch: null } });
await server.listen();
const base = server.resolvedUrls.local[0];
const browser = await chromium.launch({ channel: 'chrome' });
const report = {};
try {
  for (const { kind, fixture } of CASES) {
    const file = resolve(FIX, `${fixture}.json`);
    if (!existsSync(file)) throw new Error(`픽스처 없음: ${fixture} — 먼저 npm run screens -- --only=share 를 한 번 돌리세요`);
    const save = JSON.parse(readFileSync(file, 'utf8')).save;
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, locale: 'ko-KR' });
    // 시스템 공유·새 창을 스텁으로 바꿔 호출만 기록한다 (실제로는 아무것도 열지 않는다)
    await ctx.addInitScript((s) => {
      localStorage.setItem('kbl-save-v1', s);
      window.__shared = [];
      window.__opened = [];
      navigator.canShare = (d) => !!d?.files?.length;
      navigator.share = async (d) => void window.__shared.push({ text: d.text, url: d.url, files: (d.files ?? []).map((f) => ({ name: f.name, type: f.type, size: f.size })) });
      window.open = (url, target, features) => (window.__opened.push({ url, target, features }), null);
    }, JSON.stringify(save));
    const page = await ctx.newPage();
    await page.goto(base, { waitUntil: 'load' });
    await page.waitForSelector('[data-testid="continue"]');
    const r = await page.evaluate(async (kind) => {
      const { makeCard } = await import('/src/share/card.ts');
      const sd = await import('/src/share/shareData.ts');
      const core = JSON.parse(localStorage.getItem('kbl-save-v1')).state;
      const data = sd.shareFromCore(core, kind);
      const blob = await makeCard(core, kind);
      const png = await new Promise((ok) => { const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.readAsDataURL(blob); });
      return { data, full: sd.fullText(data), x: sd.xIntent(data), threads: sd.threadsIntent(data), back: sd.parseChallenge(new URL(data.url).search), png };
    }, kind);
    const out = resolve(OUT, `card-${kind}.png`);
    writeFileSync(out, Buffer.from(r.png.split(',')[1], 'base64'));
    const buf = readFileSync(out);
    check(buf.readUInt32BE(16) === 1080 && buf.readUInt32BE(20) === 1350, `${kind}: 카드 1080×1350 (${Math.round(buf.length / 1024)}KB) → ${out}`);

    // 문구·주소
    const { data } = r;
    check([...r.full].length <= 200, `${kind}: 문구 ${[...r.full].length}자 (200자 이내)`);
    check(r.back === data.seed && /^https:\/\/deenu0224\.github\.io\/kbl\/\?l=[0-9a-z]+$/.test(data.url), `${kind}: 도전 링크 ${data.url} ↔ 시드 ${data.seed}`);
    const x = new URL(r.x);
    check(x.origin + x.pathname === 'https://twitter.com/intent/tweet' && x.searchParams.get('text') === data.text && x.searchParams.get('url') === data.url && !/[\n\s「」→·]/.test(r.x), `${kind}: X 인텐트 인코딩`);
    const th = new URL(r.threads);
    check(th.origin + th.pathname === 'https://www.threads.net/intent/post' && th.searchParams.get('text') === r.full && !/[\n\s「」→·]/.test(r.threads), `${kind}: 스레드 인텐트 인코딩`);
    check([...x.searchParams.keys(), ...th.searchParams.keys()].every((k) => ['text', 'url'].includes(k)), `${kind}: 추적 파라미터 없음`);

    // 화면에서: 시트를 열고 버튼을 눌러 스텁 호출을 본다
    await page.click('[data-testid="continue"]');
    await page.waitForSelector('[data-testid="share-open"]');
    await page.locator('[data-testid="share-open"]').scrollIntoViewIfNeeded();
    await page.click('[data-testid="share-open"]');
    await page.waitForSelector('[data-testid="share-card"]');
    await page.click('[data-testid="share-native"]');
    await page.click('[data-testid="share-x"]');
    await page.click('[data-testid="share-threads"]');
    await page.click('[data-testid="share-kakao"]');
    await page.waitForTimeout(300);
    const calls = await page.evaluate(() => ({ shared: window.__shared, opened: window.__opened, kakaoSdk: !!document.querySelector('script[src*="kakao"]') }));
    const s0 = calls.shared[0];
    check(calls.shared.length === 2 && s0?.text === data.text && s0?.url === data.url && s0?.files[0]?.type === 'image/png' && s0.files[0].size > 1000, `${kind}: [공유하기]·[카카오톡(키 없음)] → navigator.share(문구 + 주소 + PNG 파일) 2회`);
    check(calls.opened.length === 2 && calls.opened[0].url === r.x && calls.opened[1].url === r.threads && calls.opened.every((o) => o.target === '_blank' && /noopener/.test(o.features)), `${kind}: [X]·[스레드] → 새 창(noopener)`);
    check(!calls.kakaoSdk, `${kind}: 키가 없으면 Kakao SDK 를 불러오지 않는다`);
    report[kind] = { file: out, text: r.full, x: r.x, threads: r.threads, calls };
    await ctx.close();
  }

  // 도전 링크로 열어 같은 시드로 시작되는지
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ko-KR' });
    const page = await ctx.newPage();
    await page.goto(`${base}?l=lz3k9f2a`, { waitUntil: 'load' });
    await page.click('[data-testid="challenge-start"]');
    await page.fill('[data-testid="nick-input"]', '도전자');
    await page.click('[data-testid="nick-start"]');
    await page.waitForTimeout(500);
    const got = await page.evaluate(() => ({ seed: JSON.parse(localStorage.getItem('kbl-save-v1')).state.seed, search: location.search }));
    check(got.seed === parseInt('lz3k9f2a', 36) && got.search === '', `도전 링크 ?l=lz3k9f2a → 시드 ${got.seed} 로 새 게임, 주소의 쿼리 제거`);
    await ctx.close();
  }

  if (process.argv.includes('--og')) {
    // 링크 미리보기: 처음 구장 + 제목 로고를 1200×630 으로 (카드와 같은 그리기 코드)
    const ctx = await browser.newContext({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1, locale: 'ko-KR' });
    const page = await ctx.newPage();
    await page.goto(base, { waitUntil: 'load' });
    await page.waitForSelector('[data-testid="logo"]');
    const png = await page.evaluate(async () => {
      const { renderOg } = await import('/src/share/card.ts');
      const blob = await renderOg();
      return new Promise((ok) => { const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.readAsDataURL(blob); });
    });
    const og = resolve(ROOT, 'public/og.png');
    writeFileSync(og, Buffer.from(png.split(',')[1], 'base64'));
    check(statSync(og).size <= 300 * 1024, `og.png 1200×630 (${Math.round(statSync(og).size / 1024)}KB ≤ 300KB) → ${og}`);
    await ctx.close();
  }
} finally {
  await browser.close();
  await server.close();
}
writeFileSync(resolve(OUT, 'share.json'), JSON.stringify(report, null, 2));
for (const k of Object.keys(report)) console.log(`\n── ${k}\n${report[k].text}`);
if (fail.length) {
  console.error(`\n실패 ${fail.length}건`);
  process.exit(1);
}
