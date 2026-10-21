// 결과 유형별 정적 공유 페이지: dist/s/{code}/index.html (OG 메타 + 게임으로 넘기기) 와 dist/s/{code}.png (1200×630 미리보기 그림).
//   npm run share:pages                 (dist 가 없으면 만든다. 배포 때는 scripts/deploy.sh 가 build 뒤에 부른다)
//   node scripts/share/pages.mjs --out=/tmp/x --only=w6,x4,p3-post
// 그림은 게임과 같은 그리기 코드(src/share/card.ts renderOgFor)를 설치된 Chrome 에서 돌려 뽑는다. 생성물은 커밋하지 않는다.
import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')).map(([k, v]) => [k, v ?? true]));
const OUT = resolve(ROOT, typeof args.out === 'string' ? args.out : 'dist', 's');
const ONLY = typeof args.only === 'string' ? args.only.split(',') : null;
const PNG_MAX = 150 * 1024;
const TOTAL_MAX = 25 * 1024 * 1024;
const DESC = '답답해서 내가 야구 단장을 해도 될까? · 너라면 몇 시즌 만에?';
const esc = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** 스크레이퍼는 OG 메타만 읽고, 사람은 곧바로 게임(?from={code})으로 넘어간다 */
export function pageHtml({ code, title }, base) {
  const url = `${base}s/${code}/`;
  const img = `${base}s/${code}.png`;
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${esc(title)}</title>
<meta name="description" content="${esc(DESC)}" />
<meta name="robots" content="noindex" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="답답해서 내가" />
<meta property="og:title" content="${esc(title)}" />
<meta property="og:description" content="${esc(DESC)}" />
<meta property="og:url" content="${url}" />
<meta property="og:image" content="${img}" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta property="og:locale" content="ko_KR" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${esc(title)}" />
<meta name="twitter:description" content="${esc(DESC)}" />
<meta name="twitter:image" content="${img}" />
<script>
location.replace('../../?from=${code}');
</script>
<noscript><meta http-equiv="refresh" content="0;url=../../?from=${code}" /></noscript>
</head>
<body style="margin:0;background:#f6efe0;color:#2a2420;font-family:sans-serif;text-align:center;padding:48px 16px">
<p>${esc(title)}</p>
<p><a href="../../?from=${code}">답답해서 내가 야구 단장을 해도 될까? — 게임 열기</a></p>
</body>
</html>
`;
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const server = await createServer({ root: ROOT, logLevel: 'error', clearScreen: false, server: { port: 5197, strictPort: false, host: '127.0.0.1', hmr: false, watch: null } });
  await server.listen();
  const browser = await chromium.launch({ channel: 'chrome' });
  let total = 0;
  let n = 0;
  const big = [];
  try {
    const page = await (await browser.newContext({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1, locale: 'ko-KR' })).newPage();
    await page.goto(server.resolvedUrls.local[0], { waitUntil: 'load' });
    await page.waitForSelector('[data-testid="logo"]');
    const { list, base } = await page.evaluate(async () => {
      const sd = await import('/src/share/shareData.ts');
      const { SHARE_BASE } = await import('/src/share/config.ts');
      return { list: sd.allCodes().map((code) => ({ code, title: sd.codeInfo(code).title })), base: SHARE_BASE };
    });
    for (const it of list.filter((x) => !ONLY || ONLY.includes(x.code))) {
      const png = await page.evaluate(async (code) => {
        const { renderOgFor } = await import('/src/share/card.ts');
        const blob = await renderOgFor(code);
        return new Promise((ok) => { const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.readAsDataURL(blob); });
      }, it.code);
      const buf = Buffer.from(png.split(',')[1], 'base64');
      if (buf.readUInt32BE(16) !== 1200 || buf.readUInt32BE(20) !== 630) throw new Error(`${it.code}: 그림 크기가 1200×630 이 아니다`);
      mkdirSync(resolve(OUT, it.code), { recursive: true });
      writeFileSync(resolve(OUT, `${it.code}.png`), buf);
      const html = pageHtml(it, base);
      writeFileSync(resolve(OUT, it.code, 'index.html'), html);
      total += buf.length + Buffer.byteLength(html);
      if (buf.length > PNG_MAX) big.push(`${it.code} ${Math.round(buf.length / 1024)}KB`);
      n++;
    }
  } finally {
    await browser.close();
    await server.close();
  }
  console.log(`공유 페이지 ${n}종 → ${OUT} (총 ${(total / 1024 / 1024).toFixed(1)}MB, 그림 평균 ${Math.round(total / Math.max(1, n) / 1024)}KB)`);
  if (big.length) throw new Error(`그림이 150KB 를 넘는다: ${big.join(', ')}`);
  if (total > TOTAL_MAX) throw new Error('전체 용량이 25MB 를 넘는다');
  if (!statSync(OUT).isDirectory()) throw new Error('출력 폴더 없음');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
