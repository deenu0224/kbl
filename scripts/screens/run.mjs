// 고정된 화면 검증 도구: 픽스처 세이브를 주입해 화면을 순회하며 스크린샷과 자동 검사를 남긴다.
//   npm run screens
//   npm run screens -- --only=draft,ended --viewport=390
//   npm run screens -- --only=home --dump        (탐색: 스텝 뒤에 누를 수 있는 것들을 출력)
//   --keep-fixtures  픽스처를 다시 만들지 않는다
// 산출물: screens-out/{viewport}/{id}.png · report.json · report.md · index.html · sheet-{viewport}-{n}.png
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer as netServer } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import { ALLOW, SCREENS } from './screens.mjs';
import { dumpTargets, findTarget, pageChecks } from './checks.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = resolve(ROOT, 'screens-out');
const FIX = resolve(OUT, 'fixtures');
const SAVE_KEY = 'kbl-save-v1';

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')).map(([k, v]) => [k, v ?? true]));
const only = typeof args.only === 'string' ? args.only.split(',') : null;
const MOBILE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const VIEWPORTS = [
  { name: '390', width: 390, height: 844, mobile: true },
  { name: '360', width: 360, height: 640, mobile: true },
  { name: '1280', width: 1280, height: 800, mobile: false },
  // 큰 모니터(자동 확대)는 --viewport=1920 으로 부를 때만
  { name: '1920', width: 1920, height: 1000, mobile: false, extra: true },
].filter((v) => (typeof args.viewport !== 'string' ? !v.extra : args.viewport.split(',').includes(v.name)));
// --size=s|l|xl: 글자 크기 설정을 켠 채로 찍는다
const UI_SIZE = typeof args.size === 'string' ? args.size : null;

const SEVERITY = {
  vertical: '높음', hscroll: '높음', console: '높음', pageerror: '높음', requestfailed: '높음', missing: '높음',
  wrap: '중간', clip: '중간', offscreen: '중간', overlap: '중간',
  smallfont: '낮음', touch: '낮음', ellipsis: '낮음',
};
const KIND_KO = {
  vertical: '세로로 꺾인 글', hscroll: '가로 넘침', console: '콘솔 에러', pageerror: '페이지 오류', requestfailed: '실패한 요청', missing: '못 연 화면',
  wrap: '뜻밖의 줄바꿈', clip: '잘림', offscreen: '화면 밖 요소', overlap: '겹침',
  smallfont: '작은 글자', touch: '작은 터치 타깃', ellipsis: '말줄임',
};

const freePort = () =>
  new Promise((ok, no) => {
    const s = netServer();
    s.once('error', no);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => ([5180, 64822].includes(port) ? freePort().then(ok, no) : ok(port)));
    });
  });

// Math.random 을 고정해 경기 결과·이벤트가 실행마다 같게 한다
function initScript({ entries, seed }) {
  try {
    localStorage.clear();
    for (const [k, v] of entries) localStorage.setItem(k, v);
  } catch { /* 무시 */ }
  let a = seed >>> 0;
  Math.random = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function runStep(page, step, vp) {
  if (step.when && step.when !== (vp.mobile ? 'mobile' : 'desktop')) return;
  if (step.dblclick) {
    const pt = await page.evaluate(findTarget, { target: step.dblclick, nth: 0 });
    if (!pt) throw new Error(`클릭 대상 없음: ${step.dblclick}`);
    await page.mouse.dblclick(pt.x, pt.y);
    return void (await page.waitForTimeout(500));
  }
  if (step.wait) return void (await page.waitForTimeout(step.wait));
  if (step.fill) {
    const loc = page.locator(`[data-testid="${step.fill}"]`).first();
    if (!(await loc.count())) throw new Error(`입력칸 없음: ${step.fill}`);
    await loc.fill(step.text ?? '');
    return void (await page.waitForTimeout(150));
  }
  if (step.key) return void (await page.keyboard.press(step.key));
  if (step.scroll) {
    // 화면에서 가장 큰 세로 스크롤 상자를 끝(또는 처음)으로
    await page.evaluate(({ to, testid }) => {
      const els = testid ? [...document.querySelectorAll(`[data-testid="${testid}"]`)] : [...document.querySelectorAll('*')];
      const cand = els.filter((el) => el.scrollHeight > el.clientHeight + 8 && ['auto', 'scroll'].includes(getComputedStyle(el).overflowY));
      cand.sort((a, b) => b.clientHeight * b.clientWidth - a.clientHeight * a.clientWidth);
      const hit = (el) => { const r = el.getBoundingClientRect(); const h = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!h && el.contains(h); };
      const el = cand.find(hit) ?? cand[0];
      if (el) el.scrollTop = to === 'bottom' ? el.scrollHeight : 0;
    }, { to: step.scroll, testid: step.in });
    return void (await page.waitForTimeout(250));
  }
  if (step.click) {
    let pt = null;
    for (let i = 0; i < (step.optional ? 2 : 8) && !pt; i++) {
      pt = await page.evaluate(findTarget, { target: step.click, nth: step.nth ?? 0 });
      if (!pt) await page.waitForTimeout(200);
    }
    if (!pt) {
      if (step.optional) return;
      throw new Error(`클릭 대상 없음: ${step.click}`);
    }
    await page.mouse.click(pt.x, pt.y);
    return void (await page.waitForTimeout(step.then ?? 350));
  }
}

async function shoot(browser, base, vp, screen, fixtures) {
  const rec = { id: screen.id, viewport: vp.name, fixture: screen.fixture ?? null, file: `${vp.name}/${screen.id}.png`, missing: null, issues: [] };
  const fx = screen.fixture ? fixtures[screen.fixture] : null;
  if (screen.fixture && !fx) {
    rec.missing = `픽스처 없음: ${screen.fixture}`;
    rec.file = null;
    return rec;
  }
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 1,
    isMobile: vp.mobile,
    hasTouch: vp.mobile,
    ...(vp.mobile ? { userAgent: MOBILE_UA } : {}),
    locale: 'ko-KR',
    reducedMotion: 'reduce',
  });
  const entries = fx ? [[SAVE_KEY, JSON.stringify(fx.save)], ...Object.entries(fx.ui ?? {})] : [];
  for (const [k, v] of Object.entries(screen.ui ?? {})) entries.push([k, v]);
  if (UI_SIZE) entries.push(['kbl-ui-size', UI_SIZE]);
  await ctx.addInitScript(initScript, { entries, seed: 20261013 });
  const page = await ctx.newPage();
  const push = (kind, text) => rec.issues.push({ kind, text: String(text).replace(/\s+/g, ' ').slice(0, 120), x: 0, y: 0, w: 0, h: 0 });
  page.on('console', (m) => m.type() === 'error' && push('console', m.text()));
  page.on('pageerror', (e) => push('pageerror', e.message));
  page.on('requestfailed', (r) => !r.url().includes('favicon') && push('requestfailed', `${r.url().replace(base, '')} ${r.failure()?.errorText ?? ''}`));
  try {
    await page.goto(base + (screen.query ?? ''), { waitUntil: 'load' });
    await page.waitForSelector('#root > *', { timeout: 20000 });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(300);
    for (const step of screen.steps ?? []) {
      try {
        await runStep(page, step, vp);
      } catch (e) {
        rec.missing = e.message;
        break;
      }
    }
    if (args.dump) console.log(`\n── ${screen.id} @${vp.name}${rec.missing ? ` (missing: ${rec.missing})` : ''}\n  ` + (await page.evaluate(dumpTargets)).join('\n  '));
    mkdirSync(resolve(OUT, vp.name), { recursive: true });
    await page.screenshot({ path: resolve(OUT, rec.file) });
    if (!rec.missing) rec.issues.push(...(await page.evaluate(pageChecks, { mobile: vp.mobile, allow: [...ALLOW, ...(screen.allow ?? [])] })));
  } catch (e) {
    rec.missing = rec.missing ?? `오류: ${e.message.split('\n')[0]}`;
  }
  if (rec.missing) rec.issues.unshift({ kind: 'missing', text: rec.missing.slice(0, 120), x: 0, y: 0, w: 0, h: 0 });
  await ctx.close();
  return rec;
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const mdCell = (s) => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');
const sev = (i) => SEVERITY[i.kind] ?? '낮음';

function writeReports(results, fixtureIndex) {
  const flat = results.flatMap((r) => r.issues.map((i) => ({ screen: r.id, viewport: r.viewport, severity: sev(i), ...i })));
  const ids = [...new Set(results.map((r) => r.id))];
  const missing = results.filter((r) => r.missing);
  const counts = {};
  for (const i of flat) {
    counts[i.kind] = counts[i.kind] ?? { n: 0, vp: {} };
    counts[i.kind].n++;
    counts[i.kind].vp[i.viewport] = (counts[i.kind].vp[i.viewport] ?? 0) + 1;
  }
  const high = flat.filter((i) => i.severity === '높음').length;
  const summary = { screens: ids.length, shots: results.filter((r) => r.file).length, viewports: VIEWPORTS.map((v) => v.name), missing: missing.map((r) => ({ id: r.id, viewport: r.viewport, why: r.missing })), counts, high, fixturesMissing: fixtureIndex.missing ?? [] };
  writeFileSync(resolve(OUT, 'report.json'), JSON.stringify({ summary, issues: flat, results }, null, 2));

  const md = [];
  md.push('# 화면 검증 보고', '');
  md.push(`- 화면 정의 ${ids.length}개 × 뷰포트 ${VIEWPORTS.map((v) => v.name).join(' · ')} = 스크린샷 ${summary.shots}장`);
  md.push(`- 높음 ${high}건 · 중간 ${flat.filter((i) => i.severity === '중간').length}건 · 낮음 ${flat.filter((i) => i.severity === '낮음').length}건`);
  md.push(`- 못 만든 픽스처: ${summary.fixturesMissing.length ? summary.fixturesMissing.join(', ') : '없음'}`);
  md.push(`- 못 연 화면(missing): ${missing.length ? '' : '없음'}`);
  for (const r of missing) md.push(`  - \`${r.id}\` @${r.viewport} — ${r.missing}`);
  md.push('', '## 종류별', '', `| 심각도 | 종류 | 합계 | ${VIEWPORTS.map((v) => v.name).join(' | ')} |`, `|---|---|---:|${VIEWPORTS.map(() => '---:').join('|')}|`);
  for (const s of ['높음', '중간', '낮음']) {
    for (const k of Object.keys(SEVERITY).filter((x) => SEVERITY[x] === s)) {
      const c = counts[k];
      md.push(`| ${s} | ${KIND_KO[k]} (${k}) | ${c?.n ?? 0} | ${VIEWPORTS.map((v) => c?.vp[v.name] ?? 0).join(' | ')} |`);
    }
  }
  for (const s of ['높음', '중간']) {
    md.push('', `## ${s} 문제 전부`, '');
    const list = flat.filter((i) => i.severity === s);
    if (!list.length) md.push('없음');
    else {
      md.push('| 화면 | 뷰포트 | 종류 | 요소 글 | 위치(x,y w×h) |', '|---|---|---|---|---|');
      for (const i of list) md.push(`| ${i.screen} | ${i.viewport} | ${KIND_KO[i.kind]} | ${mdCell(i.text)} | ${i.x},${i.y} ${i.w}×${i.h} |`);
    }
  }
  md.push('', '## 낮음 문제 (화면별 건수)', '', '| 화면 | 뷰포트 | 작은 글자 | 작은 터치 타깃 | 말줄임 |', '|---|---|---:|---:|---:|');
  for (const r of results) {
    const n = (k) => r.issues.filter((i) => i.kind === k).length;
    if (n('smallfont') + n('touch') + n('ellipsis')) md.push(`| ${r.id} | ${r.viewport} | ${n('smallfont')} | ${n('touch')} | ${n('ellipsis')} |`);
  }
  md.push('', '낮음 문제의 요소별 목록은 report.json 과 index.html 에 있다.', '');
  writeFileSync(resolve(OUT, 'report.md'), md.join('\n'));

  // index.html: 뷰포트별 썸네일 격자. ?sheet=390&n=0 으로 열면 그 뷰포트의 n번째 12장만 남긴다 (접지 촬영용)
  const cell = (r) => {
    const hi = r.issues.some((i) => sev(i) === '높음');
    const mid = r.issues.some((i) => sev(i) === '중간');
    const items = r.issues.slice(0, 40).map((i) => `<li class="s-${sev(i)}"><b>${KIND_KO[i.kind]}</b> ${esc(i.text)} <i>${i.x},${i.y} ${i.w}×${i.h}</i></li>`).join('');
    return `<div class="cell ${hi ? 'hi' : mid ? 'mid' : ''}">${r.file ? `<a href="${r.file}" target="_blank"><img loading="eager" src="${r.file}"></a>` : '<div class="noimg">없음</div>'}<div class="id">${esc(r.id)}${r.issues.length ? ` <span>${r.issues.length}</span>` : ''}</div>${items ? `<ul>${items}${r.issues.length > 40 ? `<li>… 외 ${r.issues.length - 40}건</li>` : ''}</ul>` : ''}</div>`;
  };
  const html = `<!doctype html><html lang="ko"><meta charset="utf-8"><title>KBL 화면 검증</title>
<style>
body{margin:0;padding:16px;background:#141a29;color:#dfe6f5;font:13px/1.4 system-ui,sans-serif}
h1{font-size:18px;margin:0 0 4px} h2{font-size:15px;margin:24px 0 8px} .sum{color:#9fb0d0;margin-bottom:8px}
.grid{display:grid;gap:10px;grid-template-columns:repeat(auto-fill,minmax(var(--tw),1fr))}
.cell{background:#1d2538;border:2px solid #2c3852;border-radius:4px;padding:4px;min-width:0}
.cell.mid{border-color:#c79a2b}.cell.hi{border-color:#e5484d}
.cell img{width:100%;display:block;background:#000}.noimg{aspect-ratio:1;display:grid;place-items:center;color:#e5484d}
.id{font:12px ui-monospace,monospace;padding:3px 2px;word-break:break-all}.id span{background:#34405e;border-radius:8px;padding:0 6px}
ul{margin:0;padding:0 0 0 14px;font-size:11px;max-height:160px;overflow:auto}li i{color:#7f8db0;font-style:normal}
.s-높음{color:#ff8a8d}.s-중간{color:#f0c96a}.s-낮음{color:#9fb0d0}
body.sheet{padding:8px;width:max-content}body.sheet h1,body.sheet .sum,body.sheet ul,body.sheet section:not(.on) ,body.sheet h2{display:none}
body.sheet .grid{grid-template-columns:repeat(var(--cols),var(--tw))}body.sheet .cell.off{display:none}
</style>
<h1>KBL 화면 검증</h1><div class="sum">화면 ${ids.length}개 · 스크린샷 ${summary.shots}장 · 높음 ${high}건 · missing ${missing.length}건 — <a href="report.md" style="color:#8ab4ff">report.md</a></div>
${VIEWPORTS.map((v) => `<section data-vp="${v.name}" style="--tw:${v.mobile ? 200 : 380}px;--cols:${v.mobile ? 6 : 4}"><h2>${v.width}×${v.height}</h2><div class="grid">${results.filter((r) => r.viewport === v.name).map(cell).join('')}</div></section>`).join('')}
<script>
const q=new URLSearchParams(location.search);
if(q.has('sheet')){document.body.classList.add('sheet');const n=+q.get('n')||0;
for(const s of document.querySelectorAll('section')){if(s.dataset.vp!==q.get('sheet'))continue;s.classList.add('on');
[...s.querySelectorAll('.cell')].forEach((c,i)=>{if(i<n*12||i>=n*12+12)c.classList.add('off')});}}
</script></html>`;
  writeFileSync(resolve(OUT, 'index.html'), html);
  return summary;
}

async function contactSheets(browser, results) {
  const files = [];
  const page = await browser.newPage({ viewport: { width: 1700, height: 1200 }, deviceScaleFactor: 1 });
  for (const v of VIEWPORTS) {
    const n = Math.ceil(results.filter((r) => r.viewport === v.name).length / 12);
    for (let i = 0; i < n; i++) {
      await page.goto(`${pathToFileURL(resolve(OUT, 'index.html')).href}?sheet=${v.name}&n=${i}`);
      await page.evaluate(() => Promise.all([...document.images].filter((im) => im.offsetParent).map((im) => im.decode().catch(() => {}))));
      const file = `sheet-${v.name}-${i + 1}.png`;
      await page.locator('section.on .grid').screenshot({ path: resolve(OUT, file) });
      files.push(file);
    }
  }
  await page.close();
  return files;
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  if (!args['keep-fixtures'] || !existsSync(resolve(FIX, 'index.json'))) {
    const r = spawnSync('npx', ['tsx', 'scripts/screens/fixtures.ts'], { cwd: ROOT, stdio: args.dump ? 'ignore' : 'inherit' });
    if (r.status !== 0) throw new Error('픽스처 생성 실패');
  }
  const fixtureIndex = JSON.parse(readFileSync(resolve(FIX, 'index.json'), 'utf8'));
  const fixtures = Object.fromEntries(Object.keys(fixtureIndex.fixtures).map((k) => [k, JSON.parse(readFileSync(resolve(FIX, `${k}.json`), 'utf8'))]));
  const screens = SCREENS.filter((s) => !only || only.some((o) => s.id === o || s.id.startsWith(o)));
  if (!screens.length) throw new Error('해당하는 화면 정의가 없습니다');
  const dup = SCREENS.map((s) => s.id).filter((id, i, a) => a.indexOf(id) !== i);
  if (dup.length) throw new Error(`화면 id 중복: ${dup.join(', ')}`);
  if (!only) for (const v of VIEWPORTS) rmSync(resolve(OUT, v.name), { recursive: true, force: true });

  const port = await freePort();
  const server = await createServer({ root: ROOT, logLevel: 'error', clearScreen: false, server: { port, strictPort: true, host: '127.0.0.1', hmr: false, watch: null } });
  await server.listen();
  const base = `http://127.0.0.1:${port}/`;
  const browser = await chromium.launch({ channel: 'chrome' });
  let summary, sheets;
  try {
    // 예열 (의존성 최적화가 끝난 뒤에 재도록)
    const warm = await browser.newPage();
    await warm.goto(base, { waitUntil: 'networkidle' });
    await warm.close();

    const jobs = VIEWPORTS.flatMap((vp) => screens.filter((s) => !s.only || s.only === (vp.mobile ? 'mobile' : 'desktop')).map((screen) => ({ vp, screen })));
    const results = new Array(jobs.length);
    let next = 0;
    const worker = async () => {
      for (let i = next++; i < jobs.length; i = next++) {
        results[i] = await shoot(browser, base, jobs[i].vp, jobs[i].screen, fixtures);
        if (!args.dump) process.stdout.write(results[i].missing ? 'x' : results[i].issues.some((x) => sev(x) === '높음') ? '!' : '.');
      }
    };
    await Promise.all(Array.from({ length: Number(args.jobs) || 6 }, worker));
    process.stdout.write('\n');
    summary = writeReports(results, fixtureIndex);
    sheets = await contactSheets(browser, results);
  } finally {
    await browser.close();
    await server.close();
  }
  console.log(`화면 ${summary.screens}개 · 스크린샷 ${summary.shots}장 · 높음 ${summary.high}건 · missing ${summary.missing.length}건`);
  for (const [k, c] of Object.entries(summary.counts)) console.log(`  ${SEVERITY[k]} ${KIND_KO[k]}: ${c.n}`);
  console.log(`보고: screens-out/report.md · screens-out/index.html · 접지 ${sheets.length}장 (screens-out/sheet-*.png)`);
  process.exitCode = summary.high > 0 ? 1 : 0;
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
