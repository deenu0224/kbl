// 0장 기 구간 검증: "고장 난 채 12경기" vs "최적 편성으로 12경기"의 승률 차.
// 실행: npx tsx scripts/firstgames.ts [시드 수]
import { mulberry32 } from '../src/game/rng';
import { newCore } from '../src/game/generate';
import { advanceDay } from '../src/game/season';
import { ensureObjectives } from '../src/game/campaign';
import { maybeDrawEvent, resolveEvent } from '../src/game/events';
import { autoLineup, BROKEN } from '../src/game/lineup';
import { userTeam } from '../src/game/economy';
import { teamParts } from '../src/game/ratings';

const N = Number(process.argv[2] ?? 200);
const GAMES = 12;
if (process.env.BROKEN) Object.assign(BROKEN, JSON.parse(process.env.BROKEN)); // 고장의 정도를 바꿔 가며 재 볼 때

function run(seed: number, fix: boolean) {
  const rng = mulberry32(seed * 7919 + 13);
  let c = ensureObjectives(newCore(seed), rng);
  if (fix) autoLineup(userTeam(c));
  const parts = teamParts(userTeam(c));
  let home = 0;
  let open5 = 0;
  let sunny = 0;
  while (c.day < GAMES) {
    if (c.campaign.event) { c = resolveEvent(c, 0, rng).core; continue; }
    const r = advanceDay(c, rng);
    if (r.report.isHome) home++;
    if (r.report.day < 3 && r.report.crowd?.weather === 'sunny') sunny++;
    if (r.report.day < 5 && r.report.won === false) open5++;
    c = maybeDrawEvent(r.core, rng);
  }
  const t = userTeam(c);
  return { w: t.rec.w, l: t.rec.l, t: t.rec.t, parts, home, lost5: open5 === 5, sunny };
}

for (const fix of [false, true]) {
  let w = 0, l = 0, t = 0, home = 0, lost5 = 0, sunny = 0, le2 = 0, ge6 = 0;
  const p = { bat: 0, def: 0, rot: 0, pen: 0 };
  for (let s = 1; s <= N; s++) {
    const r = run(s, fix);
    w += r.w; l += r.l; t += r.t; home += r.home; sunny += r.sunny;
    if (r.lost5) lost5++;
    if (r.w <= 2) le2++;
    if (r.w >= 6) ge6++;
    for (const k of Object.keys(p) as (keyof typeof p)[]) p[k] += r.parts[k];
  }
  const f = (v: number) => (v / N).toFixed(1);
  console.log(
    `${fix ? '수리(최적 편성)' : '고장 난 채   '} ${N}시드 × ${GAMES}경기: 승률 ${(w / (w + l)).toFixed(3)} (${f(w)}승 ${f(l)}패 ${f(t)}무) · 2승 이하 ${Math.round((le2 / N) * 100)}% · 6승 이상 ${Math.round((ge6 / N) * 100)}% · 개막 5연패 ${Math.round((lost5 / N) * 100)}% · 홈 ${f(home)} · 개막 맑음 ${f(sunny)}/3 · 전력 타선 ${f(p.bat)} 수비 ${f(p.def)} 선발 ${f(p.rot)} 불펜 ${f(p.pen)}`,
  );
}
