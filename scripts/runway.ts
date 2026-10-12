// 자금 예측(runway.ts) 검증: greedy 봇(스타 FA 올인 + 대출)의 첫 시즌에서
// "cashOut 예측 N" 이 나온 날부터 실제로 긴급 대출이 처음 터진 날까지의 차이를 모은다.
// 실행: npx tsx scripts/runway.ts
import type { Core, EventCard } from '../src/game/types';
import { mulberry32 } from '../src/game/rng';
import { newCore } from '../src/game/generate';
import { advanceDay, borrow, signPlayer, upgradeFacility } from '../src/game/season';
import { LOAN_LIMIT, LOAN_STEP, ROSTER_MAX, signingBonus, upgradeCost, userTeam } from '../src/game/economy';
import { ensureObjectives } from '../src/game/campaign';
import { maybeDrawEvent, resolveEvent, FOREIGN_MAX } from '../src/game/events';
import { closeBriefing, drawBriefing } from '../src/game/briefing';
import { autoLineup } from '../src/game/lineup';
import { runway } from '../src/game/runway';

const SEEDS = Number(process.argv[2] ?? 24);
const enabled = (card: EventCard, i: number) => !!card.choices[i] && !card.choices[i].disabled;
const pickChoice = (card: EventCard) => [0, 1, 2, 3].find((i) => enabled(card, i)) ?? 0;

/** stars 명까지 스타 FA 를 빚을 내서라도 영입하고, 남은 한도로 관중석을 올린다 */
function greedy(c0: Core, stars: number): Core {
  let c = c0;
  for (let n = 0; n < stars; n++) {
    const t = userTeam(c);
    if (t.roster.length >= ROSTER_MAX) break;
    const foreign = t.roster.filter((p) => p.foreign).length;
    const star = c.freeAgents.filter((p) => !p.foreign || foreign < FOREIGN_MAX).sort((a, b) => b.star - a.star || b.ovr - a.ovr)[0];
    if (!star) break;
    while (c.finance.cash < signingBonus(star) && c.finance.debt + LOAN_STEP <= LOAN_LIMIT) c = borrow(c).core;
    const r = signPlayer(c, star.id);
    if (r.error) break;
    c = r.core;
  }
  const cost = upgradeCost('seats', c.facilities);
  if (cost !== null) {
    while (c.finance.cash < cost && c.finance.debt + LOAN_STEP <= LOAN_LIMIT) c = borrow(c).core;
    const r = upgradeFacility(c, 'seats');
    if (!r.error) c = r.core;
  }
  c = structuredClone(c);
  autoLineup(userTeam(c));
  return c;
}

interface Pt { pred: number; actual: number }
const pts: Pt[] = [];
const salePts: Pt[] = [];
let seasons = 0, outs = 0, sales = 0, falseAlarm = 0, alarmSeasons = 0, missed = 0;

for (const stars of [0, 1, 3, 6, 9]) {
  for (let seed = 1; seed <= SEEDS; seed++) {
    const rng = mulberry32(seed * 7919 + 101);
    let c = greedy(ensureObjectives(newCore(seed), rng), stars);
    const preds: { day: number; out: number | null; sale: number | null }[] = [];
    let outDay: number | null = null;
    let saleDay: number | null = null;
    let guard = 0;
    while (c.phase === 'season' && ++guard < 400) {
      if (c.campaign.event) { c = resolveEvent(c, pickChoice(c.campaign.event), rng).core; continue; }
      if (c.campaign.briefing) { c = closeBriefing(c); continue; }
      const r0 = runway(c);
      if (outDay === null) preds.push({ day: c.day, out: r0.cashOut, sale: r0.forcedSale });
      else if (saleDay === null) preds.push({ day: c.day, out: null, sale: r0.forcedSale });
      const r = advanceDay(c, rng);
      if (outDay === null && r.report.notes.some((n) => n.includes('긴급 대출'))) outDay = r.report.day;
      if (saleDay === null && r.report.notes.some((n) => n.includes('강제 매각'))) saleDay = r.report.day;
      c = drawBriefing(maybeDrawEvent(r.core, rng));
      if (saleDay !== null) break;
    }
    seasons++;
    if (outDay !== null) outs++;
    if (saleDay !== null) sales++;
    const alarmed = preds.some((p) => p.out !== null && p.out <= 12);
    if (alarmed) alarmSeasons++;
    if (alarmed && outDay === null) falseAlarm++;
    if (outDay !== null && !preds.some((p) => p.out !== null && p.day <= outDay! - 6)) missed++;
    for (const p of preds) {
      if (p.out !== null && outDay !== null && p.day <= outDay) pts.push({ pred: p.out, actual: outDay - p.day + 1 });
      if (p.sale !== null && saleDay !== null && p.day <= saleDay) salePts.push({ pred: p.sale, actual: saleDay - p.day + 1 });
    }
  }
}

function dist(label: string, xs: Pt[]): void {
  if (!xs.length) return console.log(`${label}: 표본 없음`);
  const e = xs.map((x) => x.pred - x.actual).sort((a, b) => a - b);
  const q = (p: number) => e[Math.min(e.length - 1, Math.floor(p * e.length))];
  const mae = e.reduce((s, v) => s + Math.abs(v), 0) / e.length;
  const within = (k: number) => Math.round((e.filter((v) => Math.abs(v) <= k).length / e.length) * 100);
  console.log(`${label}: n=${e.length} · 오차(예측−실제) 중앙 ${q(0.5)} · 10%~90% ${q(0.1)}~${q(0.9)} · 최소 ${e[0]} 최대 ${e[e.length - 1]} · 평균 절대오차 ${mae.toFixed(1)} · ±2 이내 ${within(2)}% · ±5 이내 ${within(5)}%`);
}

console.log(`시즌 ${seasons}개 (greedy 스타 0/1/3/6/9명 × 시드 ${SEEDS}) — 긴급 대출 발생 ${outs} · 강제 매각 발생 ${sales}`);
dist('바닥까지 전체', pts);
dist('  예측 1~6경기', pts.filter((p) => p.pred <= 6));
dist('  예측 7~12경기', pts.filter((p) => p.pred > 6 && p.pred <= 12));
dist('  예측 13~30경기', pts.filter((p) => p.pred > 12 && p.pred <= 30));
dist('  예측 31경기+', pts.filter((p) => p.pred > 30));
dist('강제 매각까지 전체', salePts);
dist('  예측 1~12경기', salePts.filter((p) => p.pred <= 12));
dist('  예측 13경기+', salePts.filter((p) => p.pred > 12));
console.log(`12경기 이내 경고가 뜬 시즌 ${alarmSeasons}개 중 실제로는 안 비고 끝난 시즌 ${falseAlarm}개 · 실제로 비었는데 6경기 전까지 한 번도 예측하지 못한 시즌 ${missed}개`);
