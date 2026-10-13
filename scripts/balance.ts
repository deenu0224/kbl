// 밸런스 검증: 시드 여러 개로 무개입 시즌을 돌려 리그 지표·유저 경영 지표를 출력한다.
// 실행: npm run balance  (인자로 시드 개수 지정 가능: npx tsx scripts/balance.ts 12)
import type { Core, Player } from '../src/game/types';
import { mulberry32 } from '../src/game/rng';
import { newCore } from '../src/game/generate';
import { advanceDay, rankOf, signPlayer, upgradeFacility } from '../src/game/season';
import { opProfit, payroll, previewDemand, signingBonus, userTeam } from '../src/game/economy';
import { fmtMoney } from '../src/game/format';
import { teamStrength } from '../src/game/ratings';
import { SIM_TALLY } from '../src/game/sim';
import { autoLineup } from '../src/game/lineup';
import { ensureObjectives } from '../src/game/campaign';
import { KBO_AVG, scaleToSeason, scaleToTeams } from '../src/game/kbo';
import { batLeaders, pitLeaders, qualPA } from '../src/game/leaders';

const N_SEEDS = Number(process.argv[2]) || 16;
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
  kbo: Record<string, number>;
}

/** 시즌 종료 Core → KBO 비교 지표 (tally = 이 시즌의 병살·실책 출루 수) */
function kboMetrics(end: Core, tally: { dp: number; roe: number }): Record<string, number> {
  const all: Player[] = end.teams.flatMap((t) => t.roster);
  const sum = (f: (p: Player) => number) => all.reduce((s, p) => s + f(p), 0);
  const pa = sum((p) => p.bat.pa), ab = sum((p) => p.bat.ab), h = sum((p) => p.bat.h), bb = sum((p) => p.bat.bb);
  const d2 = sum((p) => p.bat.d2), d3 = sum((p) => p.bat.d3), hr = sum((p) => p.bat.hr), so = sum((p) => p.bat.so);
  const sb = sum((p) => p.bat.sb), cs = sum((p) => p.bat.cs);
  const sf = pa - ab - bb;
  const outs = sum((p) => p.pit.outs), er = sum((p) => p.pit.er), ph = sum((p) => p.pit.h), pbb = sum((p) => p.pit.bb);
  const teamGames = end.teams.reduce((s, t) => s + t.rec.w + t.rec.l + t.rec.t, 0);
  const runs = end.teams.reduce((s, t) => s + t.rec.rs, 0);
  const ties = end.teams.reduce((s, t) => s + t.rec.t, 0) / 2;
  const obp = (h + bb) / (ab + bb + sf);
  const slg = (h + d2 + 2 * d3 + 3 * hr) / ab;
  const bat = all.filter((p) => p.kind === 'B');
  const pit = all.filter((p) => p.kind === 'P');
  const qpa = qualPA(end);
  const qual = bat.filter((p) => p.bat.pa >= qpa);
  const top = (xs: number[]) => Math.max(0, ...xs);
  return {
    avg: h / ab,
    obp,
    slg,
    ops: obp + slg,
    rpg: runs / teamGames,
    era: (er * 27) / outs,
    whipHbp: ((ph + pbb) * 3) / outs,
    walkPct: bb / pa,
    kPct: so / pa,
    hrPct: hr / pa,
    babip: (h - hr) / (ab - so - hr + sf),
    d2OfHits: d2 / h,
    d3OfHits: d3 / h,
    hrPerGame: hr / teamGames,
    sbaPerGame: (sb + cs) / teamGames,
    sbPct: sb / (sb + cs),
    gdpPerGame: tally.dp / teamGames,
    runsPerEr: runs / er,
    tieRate: ties / (teamGames / 2),
    avgTop: batLeaders(end, 'avg', 1)[0]?.value ?? 0,
    hrTop: top(bat.map((p) => p.bat.hr)),
    rbiTop: top(bat.map((p) => p.bat.rbi)),
    sbTop: top(bat.map((p) => p.bat.sb)),
    wTop: top(pit.map((p) => p.pit.w)),
    eraTop: pitLeaders(end, 'era', 1)[0]?.value ?? 0,
    svTop: top(pit.map((p) => p.pit.sv)),
    soTop: top(pit.map((p) => p.pit.so)),
    n300: qual.filter((p) => p.bat.h / p.bat.ab >= 0.3).length,
    n20hr: bat.filter((p) => p.bat.hr >= Math.ceil(scaleToSeason(20))).length,
    n10w: pit.filter((p) => p.pit.w >= Math.ceil(scaleToSeason(10))).length,
    qualBat: qual.length,
  };
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
    kbo: {},
  };
}

/** 시즌을 돌리면서 매진·입장 못한 팬을 직접 집계 */
function play(core: Core, seed: number, start: Core = core, fixed = false): Summary {
  const rng = mulberry32(seed * 7919 + 13);
  let c = core;
  if (fixed) {
    // 리그 지표 보정용: 0장의 고장 난 편성을 고친 정상 운영 (한 번도 안 고친 팀이 리그 평균을 끌고 가지 않게)
    c = structuredClone(ensureObjectives(c, rng));
    autoLineup(userTeam(c));
  }
  let sellouts = 0;
  let turnedAway = 0;
  SIM_TALLY.dp = 0;
  SIM_TALLY.roe = 0;
  while (c.phase === 'season') {
    const { core: next, report } = advanceDay(c, rng);
    if (report.crowd?.soldOut) sellouts++;
    turnedAway += report.crowd?.turnedAway ?? 0;
    c = next;
  }
  const s = summarize(start, c);
  s.sellouts = sellouts;
  s.turnedAway = turnedAway;
  s.kbo = kboMetrics(c, SIM_TALLY);
  return s;
}

const f3 = (v: number) => v.toFixed(3).replace(/^0/, '');
const pad = (s: string | number, n: number) => String(s).padStart(n);
const mean = (xs: number[]) => xs.reduce((s, v) => s + v, 0) / xs.length;

console.log(`\n=== 무개입 시즌 × ${N_SEEDS} 시드 ===`);
console.log('seed |  AVG   ERA   R/G | HR1 .300+ .340+ 최고타율 다승 세이브 무 | 순위  전적     | 손익     연봉총액 | 평균관중 매진 못들어옴 | 팬    만족');
const base: Summary[] = [];
// KBO 대비 리그 지표는 편성을 고친 시즌으로 잰다
const kboBase: Summary[] = [];
for (let seed = 1; seed <= N_SEEDS; seed++) kboBase.push(play(newCore(seed), seed, undefined, true));
for (let seed = 1; seed <= N_SEEDS; seed++) {
  const s = play(newCore(seed), seed);
  base.push(s);
  console.log(
    `${pad(seed, 4)} | ${f3(s.avg)} ${s.era.toFixed(2)} ${s.rpg.toFixed(2)} | ${pad(s.hrTop, 3)} ${pad(s.n300, 5)} ${pad(s.n340, 5)} ${pad(f3(s.avgTop), 8)} ${pad(s.winsTop, 4)} ${pad(s.svTop, 6)} ${pad(s.ties, 2)} | ${pad(s.rank, 3)}위 ${pad(s.rec, 9)} | ${pad(fmtMoney(s.profit), 7)} ${pad(fmtMoney(s.payroll), 8)} | ${pad(Math.round(s.avgAtt), 8)} ${pad(s.sellouts, 4)} ${pad(s.turnedAway, 8)} | ${pad(s.fans, 5)} ${s.fanSat.toFixed(0)}`,
  );
}
console.log('---- 평균 (목표: AVG .265~.275 / ERA 4.2~4.8 / R/G 4.6~5.2 / HR1 20~27 / 순위 7~8 / 손익 +8억~+18억 — 손익은 아래 [개막 오더만 고친 무개입] 기준, 이 줄은 완전 방치)');
console.log(
  `AVG ${f3(mean(base.map((s) => s.avg)))} · ERA ${mean(base.map((s) => s.era)).toFixed(2)} · R/G ${mean(base.map((s) => s.rpg)).toFixed(2)} · HR1 ${mean(base.map((s) => s.hrTop)).toFixed(1)} · .300+ ${mean(base.map((s) => s.n300)).toFixed(1)}명 · .340+ ${mean(base.map((s) => s.n340)).toFixed(1)}명`,
);
console.log(
  `유저 순위 ${mean(base.map((s) => s.rank)).toFixed(2)} [${base.map((s) => s.rank).join(',')}] · 손익 ${fmtMoney(mean(base.map((s) => s.profit)))} (min ${fmtMoney(Math.min(...base.map((s) => s.profit)))} / max ${fmtMoney(Math.max(...base.map((s) => s.profit)))}) · 평균 관중 ${Math.round(mean(base.map((s) => s.avgAtt)))} · 매진 ${mean(base.map((s) => s.sellouts)).toFixed(1)}회 · 입장 못한 팬 ${Math.round(mean(base.map((s) => s.turnedAway)))}명`,
);
// 무개입의 두 번째 정의: 개막 오더만 자동 최적 편성으로 고치고 나머지는 아무것도 하지 않는다 — 손익 목표(+8억~+18억)는 이 기준으로 본다
console.log(
  `[개막 오더만 고친 무개입] 유저 순위 ${mean(kboBase.map((s) => s.rank)).toFixed(2)} · 손익 ${fmtMoney(mean(kboBase.map((s) => s.profit)))} (min ${fmtMoney(Math.min(...kboBase.map((s) => s.profit)))} / max ${fmtMoney(Math.max(...kboBase.map((s) => s.profit)))}) (목표 +8억~+18억) · 평균 관중 ${Math.round(mean(kboBase.map((s) => s.avgAtt)))} · 완전 방치 대비 손익 ${fmtMoney(mean(kboBase.map((s) => s.profit)) - mean(base.map((s) => s.profit)))}`,
);
console.log('홈런왕:', base.map((s) => `${s.hrTopName} ${s.hrTop}`).join(' / '));
console.log('최종 순위 예시(seed 1):', base[0].rankOrder);

// ── KBO 실제 vs 시뮬 ──
// 비율 지표 ±5%, 타이틀 규모 ±15% (84경기·8구단 환산). '참고' 행은 판정에서 제외.
type Cmp = { key: string; label: string; kbo: number; tol: number | null; fmt: (v: number) => string };
const T = KBO_AVG.titles;
const r3 = (v: number) => v.toFixed(3);
const r2 = (v: number) => v.toFixed(2);
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const r1 = (v: number) => v.toFixed(1);
const RATE = 0.05;
const TITLE = 0.15;
const CMP: { group: string; rows: Cmp[] }[] = [
  {
    group: '리그 환경 (비율 ±5%)',
    rows: [
      { key: 'avg', label: '타율', kbo: KBO_AVG.avg, tol: RATE, fmt: r3 },
      { key: 'obp', label: '출루율', kbo: KBO_AVG.obp, tol: RATE, fmt: r3 },
      { key: 'slg', label: '장타율', kbo: KBO_AVG.slg, tol: RATE, fmt: r3 },
      { key: 'ops', label: 'OPS', kbo: KBO_AVG.ops, tol: RATE, fmt: r3 },
      { key: 'rpg', label: '팀 경기당 득점', kbo: KBO_AVG.rpg, tol: RATE, fmt: r2 },
      { key: 'era', label: '평균자책', kbo: KBO_AVG.era, tol: RATE, fmt: r2 },
      { key: 'whipHbp', label: 'WHIP(사구 포함)', kbo: KBO_AVG.whipHbp, tol: RATE, fmt: r2 },
      { key: 'walkPct', label: '볼넷+사구 / 타석', kbo: KBO_AVG.walkPct, tol: RATE, fmt: pct },
      { key: 'kPct', label: '삼진 / 타석', kbo: KBO_AVG.kPct, tol: RATE, fmt: pct },
      { key: 'hrPct', label: '홈런 / 타석', kbo: KBO_AVG.hrPct, tol: RATE, fmt: pct },
      { key: 'babip', label: 'BABIP', kbo: KBO_AVG.babip, tol: RATE, fmt: r3 },
      { key: 'd2OfHits', label: '안타 중 2루타', kbo: KBO_AVG.d2OfHits, tol: RATE, fmt: pct },
      { key: 'd3OfHits', label: '안타 중 3루타', kbo: KBO_AVG.d3OfHits, tol: RATE, fmt: pct },
      { key: 'hrPerGame', label: '팀 경기당 홈런', kbo: KBO_AVG.hrPerGame, tol: RATE, fmt: r2 },
      { key: 'sbaPerGame', label: '팀 경기당 도루 시도', kbo: KBO_AVG.sbaPerGame, tol: RATE, fmt: r2 },
      { key: 'sbPct', label: '도루 성공률', kbo: KBO_AVG.sbPct, tol: RATE, fmt: pct },
      { key: 'gdpPerGame', label: '팀 경기당 병살', kbo: KBO_AVG.gdpPerGame, tol: RATE, fmt: r2 },
      { key: 'runsPerEr', label: '총실점 / 자책점', kbo: KBO_AVG.runsPerEr, tol: RATE, fmt: r3 },
      { key: 'tieRate', label: '무승부 비율 (참고)', kbo: KBO_AVG.tieRate, tol: null, fmt: pct },
    ],
  },
  {
    group: '타이틀 규모 (84경기 환산, ±15% · 타율 1위는 비율이라 ±5%)',
    rows: [
      { key: 'avgTop', label: '타율 1위', kbo: T.avgTop, tol: RATE, fmt: r3 },
      { key: 'hrTop', label: '홈런 1위', kbo: scaleToSeason(T.hrTop), tol: TITLE, fmt: r1 },
      { key: 'rbiTop', label: '타점 1위', kbo: scaleToSeason(T.rbiTop), tol: TITLE, fmt: r1 },
      { key: 'sbTop', label: '도루 1위', kbo: scaleToSeason(T.sbTop), tol: TITLE, fmt: r1 },
      { key: 'wTop', label: '다승 1위', kbo: scaleToSeason(T.wTop), tol: TITLE, fmt: r1 },
      { key: 'eraTop', label: '평균자책 1위', kbo: T.eraTop, tol: TITLE, fmt: r2 },
      { key: 'svTop', label: '세이브 1위', kbo: scaleToSeason(T.svTop), tol: TITLE, fmt: r1 },
      { key: 'soTop', label: '탈삼진 1위', kbo: scaleToSeason(T.soTop), tol: TITLE, fmt: r1 },
    ],
  },
  {
    group: '분포 (8구단 환산 인원, ±15%)',
    rows: [
      { key: 'n300', label: '규정타석 3할 타자', kbo: scaleToTeams(T.n300), tol: TITLE, fmt: r1 },
      { key: 'n20hr', label: `20홈런급 타자 (≥${Math.ceil(scaleToSeason(20))}개)`, kbo: scaleToTeams(T.n20hr), tol: TITLE, fmt: r1 },
      // 우리 구단 투수는 10명뿐(KBO 는 시즌 중 20명 이상 등판) → 승리가 소수에 몰려 인원 비교가 구조적으로 불가
      { key: 'n10w', label: `10승급 투수 (≥${Math.ceil(scaleToSeason(10))}승, 참고)`, kbo: scaleToTeams(T.n10w), tol: null, fmt: r1 },
      { key: 'qualBat', label: '규정타석 타자 수 (참고)', kbo: scaleToTeams(T.qualBat), tol: null, fmt: r1 },
    ],
  },
];
console.log(`\n=== KBO 실제(2022~2025 평균) vs 시뮬(${N_SEEDS}시드 평균) ===`);
const wide = (str: string, n: number) => str + ' '.repeat(Math.max(0, n - [...str].reduce((w, ch) => w + (ch.charCodeAt(0) > 0x2e80 ? 2 : 1), 0)));
let fails = 0;
for (const g of CMP) {
  console.log(`-- ${g.group}`);
  console.log(`${wide('지표', 30)} ${'KBO'.padStart(8)} ${'시뮬'.padStart(7)} ${'오차'.padStart(8)}  판정`);
  for (const c of g.rows) {
    const sim = mean(kboBase.map((s) => s.kbo[c.key]));
    const err = (sim - c.kbo) / c.kbo;
    const ok = c.tol === null ? '-' : Math.abs(err) <= c.tol ? '✓' : '✗';
    if (ok === '✗') fails++;
    console.log(`${wide(c.label, 30)} ${c.fmt(c.kbo).padStart(8)} ${c.fmt(sim).padStart(8)} ${((err >= 0 ? '+' : '') + (err * 100).toFixed(1) + '%').padStart(8)}  ${ok}`);
  }
}
console.log(fails ? `허용오차 밖 지표 ${fails}개` : '모든 판정 지표가 허용오차 안');

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


