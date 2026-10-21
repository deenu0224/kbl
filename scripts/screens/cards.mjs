// 공유 검증: 픽스처 세이브로 기록 카드 PNG 3종(결산·우승·연고 이전)과 링크 미리보기 이미지(public/og.png)를 만들고,
// 올라갈 글·결과 주소·인텐트 주소·복사·시스템 공유 호출을 확인한다. 외부로는 아무것도 보내지 않는다.
//   node scripts/screens/cards.mjs            (픽스처가 없으면 먼저 npm run screens)
//   node scripts/screens/cards.mjs --og       (public/og.png 도 다시 만든다)
// 산출물: screens-out/share/card-{season,champion,relocated}.png · card-sparse.png(빈 칸이 많은 첫 시즌) · share.json
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
      window.__copied = [];
      Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (t) => void window.__copied.push(t) }, configurable: true });
      navigator.canShare = (d) => !!d?.files?.length;
      navigator.share = async (d) => void window.__shared.push({ text: d.text, url: d.url, files: (d.files ?? []).map((f) => ({ name: f.name, type: f.type, size: f.size })) });
      window.open = (url, target, features) => (window.__opened.push({ url, target, features }), null);
    }, JSON.stringify(save));
    const page = await ctx.newPage();
    await page.goto(base, { waitUntil: 'load' });
    await page.waitForSelector('[data-testid="continue"]');
    const NOTE = '답답해서 내가 해 봤다';
    const r = await page.evaluate(async ([kind, note]) => {
      const { makeCard } = await import('/src/share/card.ts');
      const sd = await import('/src/share/shareData.ts');
      const st = await import('/src/share/story.ts');
      const core = JSON.parse(localStorage.getItem('kbl-save-v1')).state;
      const data = sd.shareFromCore(core, kind);
      const blob = await makeCard(core, kind);
      const png = await new Promise((ok) => { const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.readAsDataURL(blob); });
      // 빈 칸이 많은 첫 시즌: 명장면·천적·밥·가을야구가 없는 1시즌째 카드 (결산 픽스처에서 줄을 지워 만든다)
      let sparse = null;
      if (kind === 'season') {
        const { renderCard, cardScene } = await import('/src/share/card.ts');
        const f = data.rec.card;
        const thin = { ...data, rec: { ...data.rec, seasons: 1, card: { nth: 1, name: '부임 첫해', w: f.w, l: f.l, t: f.t, rank: f.rank, gb: f.gb, months: f.months, streak: f.streak, mvp: f.mvp } } };
        const b = await renderCard(thin, cardScene(core, kind));
        sparse = await new Promise((ok) => { const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.readAsDataURL(b); });
      }
      const lines = (await import('/src/share/card.ts')).cardLines(data);
      const text = st.shareText(data);
      const noted = st.shareText(data, note);
      const longest = st.shareText(data, '가'.repeat(60));
      return { data, text, noted, w: st.xWeight(text), wLong: st.xWeight(longest), x: st.xIntent(noted), threads: st.threadsIntent(noted), info: sd.codeInfo(data.code), png, sparse, lines, gmLine: data.rec.gm ? sd.gmLineOf(data.rec.gm) : null };
    }, [kind, NOTE]);
    const out = resolve(OUT, `card-${kind}.png`);
    writeFileSync(out, Buffer.from(r.png.split(',')[1], 'base64'));
    const buf = readFileSync(out);
    check(buf.readUInt32BE(16) === 1080 && buf.readUInt32BE(20) === 1080, `${kind}: 기록 카드 1080×1080 (${Math.round(buf.length / 1024)}KB) → ${out}`);

    if (r.sparse) {
      const sp = resolve(OUT, 'card-sparse.png');
      writeFileSync(sp, Buffer.from(r.sparse.split(',')[1], 'base64'));
      check(readFileSync(sp).readUInt32BE(16) === 1080, `빈 칸이 많은 첫 시즌 카드 → ${sp}`);
    }
    // 카드의 줄: 단장 점수 한 줄 · 성적 · (엔딩) 단장 경력
    check(!!r.gmLine && /^단장 (경력 )?(SS|S|A\+|A|B\+|B|C|D|F) · .+ · \d+점$/.test(r.gmLine), `${kind}: 단장 점수 줄 "${r.gmLine}"`);
    check(!!r.lines.record, `${kind}: 성적 줄 "${r.lines.record}" ${r.lines.gb ?? ''}`);
    check(kind === 'season' ? !r.lines.career : !!r.lines.career, `${kind}: 단장 경력 줄 ${r.lines.career ?? '(결산은 없음)'}`);
    console.log(`  올해의 선수 ${r.lines.mvp?.join(' / ') ?? '(없음)'} · 줄 ${r.lines.marks.join(' | ') || '(명장면·천적·밥 없음)'} · ${r.lines.post ?? '(가을야구 없음)'}`);

    // 글·주소
    const { data } = r;
    check(r.w <= 280 && r.wLong <= 280, `${kind}: 글 길이 ${r.w} (소감 60자일 때 ${r.wLong}) ≤ X 280`);
    check(r.text.endsWith(data.url) && r.noted.startsWith(`${NOTE}\n`), `${kind}: 글은 주소로 끝나고, 소감은 맨 앞 줄`);
    check(!!r.info && data.url === `https://ddhsido.app/s/${data.code}/`, `${kind}: 결과 주소 ${data.url} · 유형 ${data.code}`);
    check(data.pct.pct >= 1 && data.pct.pct <= 99 && data.pct.n > 0 && !!data.pct.basis, `${kind}: 상위 ${data.pct.pct}% (시뮬레이션 단장 ${data.pct.n}명 대비, ${data.pct.basis})`);
    const x = new URL(r.x);
    check(x.origin + x.pathname === 'https://twitter.com/intent/tweet' && x.searchParams.get('text') === r.noted && !/[\n\s·]/.test(r.x), `${kind}: X 인텐트 인코딩`);
    const th = new URL(r.threads);
    check(th.origin + th.pathname === 'https://www.threads.net/intent/post' && th.searchParams.get('text') === r.noted && !/[\n\s·]/.test(r.threads), `${kind}: 스레드 인텐트 인코딩`);
    check([...x.searchParams.keys(), ...th.searchParams.keys()].every((k) => k === 'text'), `${kind}: 추적 파라미터 없음`);

    // 화면에서: 공유 화면을 열고 소감을 쓴 뒤 버튼을 눌러 스텁 호출을 본다
    await page.click('[data-testid="continue"]');
    await page.waitForSelector('[data-testid="share-open"]');
    await page.locator('[data-testid="share-open"]').scrollIntoViewIfNeeded();
    await page.click('[data-testid="share-open"]');
    await page.waitForSelector('[data-testid="share-card"]');
    const input = await page.evaluate(() => { const el = document.querySelector('[data-testid="share-note-input"]'); return { size: parseFloat(getComputedStyle(el).fontSize), max: el.maxLength }; });
    check(input.size >= 16 && input.max === 60, `${kind}: 소감 입력칸 글자 ${input.size}px · 최대 ${input.max}자`);
    await page.fill('[data-testid="share-note-input"]', NOTE);
    await page.click('[data-testid="share-copy"]');
    await page.click('[data-testid="share-x"]');
    await page.click('[data-testid="share-threads"]');
    await page.click('[data-testid="share-native"]');
    await page.waitForTimeout(300);
    const calls = await page.evaluate(() => ({ shared: window.__shared, opened: window.__opened, copied: window.__copied, shown: document.querySelector('[data-testid="share-text"]').textContent, kakao: !!document.querySelector('script[src*="kakao"]') || !!document.querySelector('[data-testid="share-kakao"]') }));
    check(calls.copied.length === 1 && calls.copied[0] === r.noted && calls.shown === r.noted, `${kind}: [글과 링크 복사] → 화면의 글과 같은 글(소감 포함)`);
    const s0 = calls.shared[0];
    check(calls.shared.length === 1 && s0?.text === r.noted && s0?.files[0]?.type === 'image/png' && s0.files[0].size > 1000, `${kind}: [다른 앱으로 보내기] → navigator.share(글 + PNG 파일)`);
    check(calls.opened.length === 2 && calls.opened[0].url === r.x && calls.opened[1].url === r.threads && calls.opened.every((o) => o.target === '_blank' && /noopener/.test(o.features)), `${kind}: [X에 올리기]·[스레드에 올리기] → 새 창(noopener)`);
    check(!calls.kakao, `${kind}: 카카오 SDK·버튼 없음`);
    report[kind] = { file: out, code: data.code, pct: data.pct, text: r.text, noted: r.noted, x: r.x, threads: r.threads, calls };
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
