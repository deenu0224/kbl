#!/bin/sh
# GitHub Pages 배포: ddhsido.app(루트 기준)으로 빌드해 gh-pages 브랜치에 올린다. 실행: npm run deploy
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"
npx tsc --noEmit
# 버전: package.json 의 version 과 업데이트 소식(src/releaseNotes.ts) 맨 위가 같아야 한다. 이미 배포한 버전이면 경고
VER=$(node -p "require('./package.json').version")
grep -q "version: '$VER'" src/releaseNotes.ts || { echo "업데이트 소식에 v$VER 항목이 없습니다 (src/releaseNotes.ts)"; exit 1; }
if git rev-parse -q --verify "refs/tags/v$VER" >/dev/null; then echo "경고: v$VER 는 이미 배포한 버전입니다 — 버전을 올리지 않고 다시 배포합니다"; fi
npx vite build --base=/
node scripts/share/pages.mjs   # 결과 유형별 공유 페이지(dist/s/{code}/ · {code}.png)
OUT=$(mktemp -d)
cp -R dist/. "$OUT/"
rm -f "$OUT"/assets/*.ttf   # woff2 만으로 충분 (용량 40MB → 7MB)
touch "$OUT/.nojekyll"
echo "ddhsido.app" > "$OUT/CNAME"   # GitHub Pages 사용자 지정 도메인
cd "$OUT"
git init -q -b gh-pages
git add -A
git commit -qm "Pages 배포: $(git -C "$ROOT" rev-parse --short HEAD)"
git push -f -q "$(git -C "$ROOT" remote get-url origin)" gh-pages
rm -rf "$OUT"
cd "$ROOT"
git tag -f "v$VER" >/dev/null && git push -f -q origin "v$VER" 2>/dev/null || true
echo "배포 완료: v$VER https://ddhsido.app/ (반영까지 1분쯤)"
