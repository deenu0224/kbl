// 밸런스 검증: 시드 여러 개로 무개입 시즌을 돌려 리그 지표·유저 경영 지표를 출력한다.
// 실행: npm run balance  (인자로 시드 개수 지정 가능: npx tsx scripts/balance.ts 12)
import type { Core, Player } from '../src/game/types';
import { mulberry32 } from '../src/game/rng';
import { newCore } from '../src/game/generate';
import { advanceDay, rankOf, signPlayer, upgradeFacility } from '../src/game/season';
import { opProfit, payroll, previewDemand, signingBonus, userTeam } from '../src/game/economy';
import { fmtMoney } from '../src/game/format';
import { teamStrength } from '../src/game/ratings';

const N_SEEDS = Number(process.argv[2]) || 8;
const QUAL_PA = 260; // 규정타석 (84경기 × 3.1)

interface Summary {
  avg: number;
  era: number;
  rpg: number;
  hrTop: number;
  hrTopName: string;
  avgTop: number;
  n300: number;
  n340: number;
  winsTop: number;
  svTop: number;
  ties: number;
  rank: number;
  wins: number;
  rec: string;
  profit: number;
  cashDelta: number;
  payroll: number;
  avgAtt: number;
  sellouts: number;
  turnedAway: number;
  fans: number;
  fanSat: number;
  userStr: number;
  rankOrder: string;
}

function summarize(start: Core, end: Core): Summary {
  const all: Player[] = end.teams.flatMap((t) => t.roster);
  const bat = all.filter((p) => p.kind === 'B');
  const pit = all.filter((p) => p.kind === 'P');
  const sum = (xs: number[]) => xs.reduce((s, v) => s + v, 0);
  const h = sum(bat.map((p) => p.bat.h));
  const ab = sum(bat.map((p) => p.bat.ab));
  const er = sum(pit.map((p) => p.pit.er));
  const outs = sum(pit.map((p) => p.pit.outs));
  const teamGames = sum(end.teams.map((t) => t.rec.w + t.rec.l + t.rec.t));
  const runs = sum(end.teams.map((t) => t.rec.rs));
  const qual = bat.filter((p) => p.bat.pa >= QUAL_PA);
  const hrKing = bat.slice().sort((a, b) => b.bat.hr - a.bat.hr)[0];
  const u = userTeam(end);
  const att = end.attHistory;
  // 매진·입장 못한 팬은 play() 가 DayReport 에서 직접 집계해 채운다
  return {
    avg: h / ab,
    era: (er * 27) / outs,
    rpg: runs / teamGames,
    hrTop: hrKing.bat.hr,
    hrTopName: `${hrKing.name}${hrKing.tag ? `(${hrKing.tag})` : ''}`,
    avgTop: Math.max(...qual.map((p) => p.bat.h / p.bat.ab)),
    n300: qual.filter((p) => p.bat.h / p.bat.ab >= 0.3).length,
    n340: qual.filter((p) => p.bat.h / p.bat.ab >= 0.34).length,
    winsTop: Math.max(...pit.map((p) => p.pit.w)),
    svTop: Math.max(...pit.map((p) => p.pit.sv)),
    ties: sum(end.teams.map((t) => t.rec.t)) / 2,
    rank: rankOf(end.teams, end.userId),
    wins: u.rec.w,
    rec: `${u.rec.w}-${u.rec.l}-${u.rec.t}`,
    profit: opProfit(end.finance.ledger),
    cashDelta: end.finance.cash - end.finance.debt - (start.finance.cash - start.finance.debt),
    payroll: payroll(u),
    avgAtt: att.length ? sum(att) / att.length : 0,
    sellouts: 0,
    turnedAway: 0,
    fans: end.fans,
    fanSat: end.fanSat,
    userStr: teamStrength(userTeam(start)),
    rankOrder: end.teams
      .slice()
      .sort((a, b) => rankOf(end.teams, a.id) - rankOf(end.teams, b.id))
      .map((t) => `${t.id}${t.rec.w}`)
      .join(' '),
  };
}

/** 시즌을 돌리면서 매진·입장 못한 팬을 직접 집계 */
function play(core: Core, seed: number, start: Core = core): Summary {
  const rng = mulberry32(seed * 7919 + 13);
  let c = core;
  let sellouts = 0;
  let turnedAway = 0;
  while (c.phase === 'season') {
    const { core: next, report } = advanceDay(c, rng);
    if (report.crowd?.soldOut) sellouts++;
    turnedAway += report.crowd?.turnedAway ?? 0;
    c = next;
  }
  const s = summarize(start, c);
  s.sellouts = sellouts;
  s.turnedAway = turnedAway;
  return s;
}

const f3 = (v: number) => v.toFixed(3).replace(/^0/, '');
const pad = (s: string | number, n: number) => String(s).padStart(n);
const mean = (xs: number[]) => xs.reduce((s, v) => s + v, 0) / xs.length;

console.log(`\n=== 무개입 시즌 × ${N_SEEDS} 시드 ===`);
console.log('seed |  AVG   ERA   R/G | HR1 .300+ .340+ 최고타율 다승 세이브 무 | 순위  전적     | 손익     연봉총액 | 평균관중 매진 못들어옴 | 팬    만족');
const base: Summary[] = [];
for (let seed = 1; seed <= N_SEEDS; seed++) {
  const s = play(newCore(seed), seed);
  base.push(s);
  console.log(
    `${pad(seed, 4)} | ${f3(s.avg)} ${s.era.toFixed(2)} ${s.rpg.toFixed(2)} | ${pad(s.hrTop, 3)} ${pad(s.n300, 5)} ${pad(s.n340, 5)} ${pad(f3(s.avgTop), 8)} ${pad(s.winsTop, 4)} ${pad(s.svTop, 6)} ${pad(s.ties, 2)} | ${pad(s.rank, 3)}위 ${pad(s.rec, 9)} | ${pad(fmtMoney(s.profit), 7)} ${pad(fmtMoney(s.payroll), 8)} | ${pad(Math.round(s.avgAtt), 8)} ${pad(s.sellouts, 4)} ${pad(s.turnedAway, 8)} | ${pad(s.fans, 5)} ${s.fanSat.toFixed(0)}`,
  );
}
console.log('---- 평균 (목표: AVG .265~.275 / ERA 4.2~4.8 / R/G 4.6~5.2 / HR1 20~27 / 순위 7~8 / 손익 +8억~+18억)');
console.log(
  `AVG ${f3(mean(base.map((s) => s.avg)))} · ERA ${mean(base.map((s) => s.era)).toFixed(2)} · R/G ${mean(base.map((s) => s.rpg)).toFixed(2)} · HR1 ${mean(base.map((s) => s.hrTop)).toFixed(1)} · .300+ ${mean(base.map((s) => s.n300)).toFixed(1)}명 · .340+ ${mean(base.map((s) => s.n340)).toFixed(1)}명`,
);
console.log(
  `유저 순위 ${mean(base.map((s) => s.rank)).toFixed(2)} [${base.map((s) => s.rank).join(',')}] · 손익 ${fmtMoney(mean(base.map((s) => s.profit)))} (min ${fmtMoney(Math.min(...base.map((s) => s.profit)))} / max ${fmtMoney(Math.max(...base.map((s) => s.profit)))}) · 평균 관중 ${Math.round(mean(base.map((s) => s.avgAtt)))} · 매진 ${mean(base.map((s) => s.sellouts)).toFixed(1)}회 · 입장 못한 팬 ${Math.round(mean(base.map((s) => s.turnedAway)))}명`,
);
console.log('홈런왕:', base.map((s) => `${s.hrTopName} ${s.hrTop}`).join(' / '));
console.log('최종 순위 예시(seed 1):', base[0].rankOrder);

// ── 개입 시나리오: 개막 전 스타 FA 1명 영입 (+ 관중석 1단계 증설) ──
console.log(`\n=== 개입 시나리오 × ${N_SEEDS} 시드 (A 무개입 / B 스타 FA 영입 / C 스타 FA + 관중석 증설) ===`);
console.log('seed | 영입 선수               | 수요예상 A→B | 평균관중 A / B / C      | 매진 A/B/C | 못들어옴 A / B / C    | 순위 A/B/C | 손익 A / B / C');
const rows: { a: Summary; b: Summary; c: Summary }[] = [];
for (let seed = 1; seed <= N_SEEDS; seed++) {
  const c0 = newCore(seed);
  // 계약금을 낼 수 있는 FA 중 스타성이 가장 높은 선수
  const target = c0.freeAgents
    .filter((p) => signingBonus(p) + 100000 <= c0.finance.cash)
    .sort((x, y) => y.star - x.star)[0];
  const signed = signPlayer(c0, target.id);
  if (signed.error) throw new Error(signed.error);
  const up = upgradeFacility(signed.core, 'seats');
  if (up.error) throw new Error(up.error);
  const a = base[seed - 1];
  const b = play(signed.core, seed, c0);
  const c = play(up.core, seed, c0);
  rows.push({ a, b, c });
  const who = `${target.name} ${target.pos} OVR${target.ovr} ★${target.star}`;
  console.log(
    `${pad(seed, 4)} | ${who.padEnd(22)} | ${pad(previewDemand(c0), 5)}→${pad(previewDemand(signed.core), 5)} | ${pad(Math.round(a.avgAtt), 5)} / ${pad(Math.round(b.avgAtt), 5)} / ${pad(Math.round(c.avgAtt), 5)} | ${pad(a.sellouts, 2)}/${pad(b.sellouts, 2)}/${pad(c.sellouts, 2)}   | ${pad(a.turnedAway, 6)} / ${pad(b.turnedAway, 6)} / ${pad(c.turnedAway, 6)} | ${a.rank}/${b.rank}/${c.rank}      | ${fmtMoney(a.profit)} / ${fmtMoney(b.profit)} / ${fmtMoney(c.profit)}`,
  );
}
const m = (k: keyof Summary, w: 'a' | 'b' | 'c') => mean(rows.map((r) => r[w][k] as number));
console.log('---- 평균');
for (const [w, label] of [['a', 'A 무개입        '], ['b', 'B 스타 FA       '], ['c', 'C 스타 FA + 증설']] as const) {
  console.log(
    `${label} | 평균 관중 ${pad(Math.round(m('avgAtt', w)), 5)} · 매진 ${m('sellouts', w).toFixed(1).padStart(4)}회 · 입장 못한 팬 ${pad(Math.round(m('turnedAway', w)), 6)}명 · 순위 ${m('rank', w).toFixed(2)} (${m('wins', w).toFixed(1)}승) · 영업손익 ${fmtMoney(m('profit', w))} · 순자산 변화 ${fmtMoney(m('cashDelta', w))} · 시즌 말 팬 ${Math.round(m('fans', w))}`,
  );
}
console.log('(영업손익 = 입장+매점+굿즈+분배금+매각 − 연봉 − 유지비 − 이자 − 계약금. 순자산 변화는 시설 투자 10억 포함)\n');


