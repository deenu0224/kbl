#!/bin/sh
# GitHub Pages 배포: /kbl/ 기준으로 빌드해 gh-pages 브랜치에 올린다. 실행: npm run deploy
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"
npx tsc --noEmit
npx vite build --base=/kbl/
node scripts/share/pages.mjs   # 결과 유형별 공유 페이지(dist/s/{code}/ · {code}.png)
OUT=$(mktemp -d)
cp -R dist/. "$OUT/"
rm -f "$OUT"/assets/*.ttf   # woff2 만으로 충분 (용량 40MB → 7MB)
touch "$OUT/.nojekyll"
cd "$OUT"
git init -q -b gh-pages
git add -A
git commit -qm "Pages 배포: $(git -C "$ROOT" rev-parse --short HEAD)"
git push -f -q "$(git -C "$ROOT" remote get-url origin)" gh-pages
rm -rf "$OUT"
echo "배포 완료: https://deenu0224.github.io/kbl/ (반영까지 1분쯤)"
