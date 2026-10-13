// 불펜 실측: 경기당 구원 등판 수, 구원 1인당 시즌 등판, 연투 분포, 선발 소화 이닝, 불펜 인원별 유저 팀 성적.
// 실행: npm run bullpen  (인자로 시드 수: npx tsx scripts/bullpen.ts 12)
import type { Core, Player, Team } from '../src/game/types';
import { mulberry32 } from '../src/game/rng';
import { genPlayer, makeCtx, newCore } from '../src/game/generate';
import { advanceDay } from '../src/game/season';
import { ensureObjectives } from '../src/game/campaign';
import { autoLineup } from '../src/game/lineup';
import { userTeam } from '../src/game/economy';
import { shiftOvr } from '../src/game/draft';
import { calcSalary } from '../src/game/ratings';
import { PEN_STYLES, type PenStyle } from '../src/game/sim';

const N_SEEDS = Number(process.argv[2]) || 16;
const X_SEEDS = Number(process.argv[3]) || 48; // 방침 교차표의 시드 수 (차이가 보일 만큼)
const SP_SHIFT = 8; // 교차표의 선발진 강함/약함: 로테이션 전원 OVR ±
const STYLE_KO: Record<PenStyle, string> = { trust: '믿음', balance: '균형', swarm: '벌떼' };
const ADD_OVR = 57; // 불펜 인원 실험에서 더하는 팔: 저가 FA 급 구원

interface Tally {
  teamGames: number;
  relApps: number; // 구원 등판 수
  byTired: number[]; // 등판 시점의 연투 일수 0/1/2/3+
  spOuts: number;
  spStarts: number;
  relOuts: number;
  relEr: number;
  seasonApps: number[]; // 구원 전문(RP·CP) 1인당 시즌 구원 등판
  topApps: number[]; // 팀별 최다 등판 구원
  overDays: number; // 불펜에 쉰 투수가 0명이던 팀-경기 수 (경기 전 기준)
}
const zero = (): Tally => ({ teamGames: 0, relApps: 0, byTired: [0, 0, 0, 0], spOuts: 0, spStarts: 0, relOuts: 0, relEr: 0, seasonApps: [], topApps: [], overDays: 0 });

const penArms = (t: Team): Player[] => {
  const ids = new Set([...t.bullpen, ...(t.closer ? [t.closer] : [])]);
  return t.roster.filter((p) => ids.has(p.id) && !p.farm);
};

/** 유저 팀 불펜(로테이션 밖 1군 투수)을 n 명으로 맞춘다: 넘치면 OVR 낮은 순으로 빼고, 모자라면 저가 구원을 더한다 */
function setPen(core: Core, n: number, seed: number): void {
  const t = userTeam(core);
  autoLineup(t);
  let pen = penArms(t).sort((a, b) => a.ovr - b.ovr);
  while (pen.length > n) {
    const out = pen.shift()!;
    t.roster = t.roster.filter((p) => p.id !== out.id);
  }
  const ctx = makeCtx(mulberry32(seed * 31 + 7), 'bp', core.teams.flatMap((x) => x.roster.map((p) => p.name)));
  while (pen.length < n) {
    const p = genPlayer(ctx, 'RP', ADD_OVR, { age: 30 });
    shiftOvr(p, ADD_OVR);
    p.salary = calcSalary(p);
    t.roster.push(p);
    pen.push(p);
  }
  autoLineup(t);
}

/** 한 시즌을 무개입(사건 카드 없이)으로 돌리며 팀별 집계. pen = 유저 팀 불펜 인원 강제 (없으면 생성 그대로) */
function season(seed: number, pen?: number, style?: PenStyle, spShift = 0): { league: Tally; user: Tally; wins: number; losses: number; penN: number } {
  const rng = mulberry32(seed * 7919 + 13);
  let c = ensureObjectives(newCore(seed), rng);
  autoLineup(userTeam(c)); // 개막 오더만 고친다
  if (pen !== undefined) setPen(c, pen, seed);
  if (spShift) {
    const t = userTeam(c);
    for (const p of t.roster) if (t.rotation.includes(p.id)) shiftOvr(p, p.ovr + spShift);
  }
  if (style) c = { ...c, campaign: { ...c.campaign, penStyle: style } };
  const penN = penArms(userTeam(c)).length;
  const league = zero();
  const user = zero();
  while (c.phase === 'season' && c.day < c.schedule.length) {
    if (c.campaign.event) c = { ...c, campaign: { ...c.campaign, event: null } };
    const before = new Map<string, { g: number; gs: number; outs: number; er: number; tired: number }>();
    const playing = new Set(c.schedule[c.day].flatMap((g) => [g.homeId, g.awayId]));
    for (const t of c.teams) {
      if (!playing.has(t.id)) continue;
      for (const p of t.roster) if (p.kind === 'P') before.set(p.id, { g: p.pit.g, gs: p.pit.gs, outs: p.pit.outs, er: p.pit.er, tired: p.tired ?? 0 });
      const arms = penArms(t).filter((p) => p.injury === 0);
      const over = arms.length > 0 && !arms.some((p) => !(p.tired ?? 0));
      for (const T of t.id === c.userId ? [league, user] : [league]) if (over) T.overDays++;
    }
    c = advanceDay(c, rng).core;
    for (const t of c.teams) {
      if (!playing.has(t.id)) continue;
      const tallies = t.id === c.userId ? [league, user] : [league];
      for (const T of tallies) T.teamGames++;
      for (const p of t.roster) {
        const b = before.get(p.id);
        if (!b || p.pit.g === b.g) continue;
        const outs = p.pit.outs - b.outs;
        const er = p.pit.er - b.er;
        for (const T of tallies) {
          if (p.pit.gs > b.gs) {
            T.spStarts++;
            T.spOuts += outs;
          } else {
            T.relApps++;
            T.byTired[Math.min(3, b.tired)]++;
            T.relOuts += outs;
            T.relEr += er;
          }
        }
      }
    }
  }
  for (const t of c.teams) {
    const apps = t.roster.filter((p) => p.kind === 'P' && p.pos !== 'SP' && !p.farm).map((p) => p.pit.g - p.pit.gs);
    for (const T of t.id === c.userId ? [league, user] : [league]) {
      T.seasonApps.push(...apps);
      if (apps.length) T.topApps.push(Math.max(...apps));
    }
  }
  const u = userTeam(c);
  return { league, user, wins: u.rec.w, losses: u.rec.l, penN };
}

function add(a: Tally, b: Tally): void {
  a.teamGames += b.teamGames; a.relApps += b.relApps; a.spOuts += b.spOuts; a.spStarts += b.spStarts; a.relOuts += b.relOuts; a.relEr += b.relEr; a.overDays += b.overDays;
  b.byTired.forEach((v, i) => (a.byTired[i] += v));
  a.seasonApps.push(...b.seasonApps);
  a.topApps.push(...b.topApps);
}
const mean = (xs: number[]) => (xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : 0);
const q = (xs: number[], p: number) => {
  const s = xs.slice().sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0;
};
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

function line(label: string, t: Tally): string {
  const tot = Math.max(1, t.relApps);
  return [
    label.padEnd(8),
    `경기당 구원 ${(t.relApps / t.teamGames).toFixed(2)}명`,
    `구원 1인 시즌 등판 평균 ${mean(t.seasonApps).toFixed(1)} · 중앙 ${q(t.seasonApps, 0.5)} · 상위10% ${q(t.seasonApps, 0.9)} · 팀 최다 평균 ${mean(t.topApps).toFixed(1)}`,
    `연투 0/1/2/3+일 ${t.byTired.map((v) => pct(v / tot)).join(' / ')} (3연투 이상 ${pct((t.byTired[2] + t.byTired[3]) / tot)})`,
    `선발 평균 ${(t.spOuts / Math.max(1, t.spStarts) / 3).toFixed(2)}이닝`,
    `불펜 ERA ${((t.relEr * 27) / Math.max(1, t.relOuts)).toFixed(2)}`,
    `쉰 불펜 0명인 경기 ${pct(t.overDays / t.teamGames)}`,
  ].join(' | ');
}

console.log(`=== 불펜 실측 × ${N_SEEDS} 시드 (84경기, 무개입 · 유저는 개막 오더만 고침) ===`);
console.log('KBO 기준: kbo.ts 에 불펜 등판 수치 없음(미확인). 상식선 = 필승조 84경기 환산 35~41경기, 3연투는 드물게(전체 등판의 5% 미만)');
const SKIP_BASE = !!process.env.BP_ROW;
const L = zero();
const U = zero();
const penNs: number[] = [];
for (let seed = 1; seed <= N_SEEDS && !SKIP_BASE; seed++) {
  const r = season(seed);
  add(L, r.league);
  add(U, r.user);
  penNs.push(r.penN);
}
console.log(line('리그', L));
console.log(line('유저 팀', U));
console.log(`유저 팀 불펜 인원(마무리 포함) 평균 ${mean(penNs).toFixed(1)}명`);

console.log(`\n=== 불펜 인원별 유저 팀 (같은 시드, 불펜 인원만 변경 · 더하는 팔은 OVR ${ADD_OVR} 구원, 빼는 팔은 OVR 낮은 순) ===`);
for (const n of SKIP_BASE ? [] : [5, 6, 7, 8]) {
  const T = zero();
  let w = 0;
  let l = 0;
  for (let seed = 1; seed <= N_SEEDS; seed++) {
    const r = season(seed, n);
    add(T, r.user);
    w += r.wins;
    l += r.losses;
  }
  console.log(`${line(`불펜 ${n}명`, T)} | 승률 ${(w / (w + l)).toFixed(3)} (${(w / N_SEEDS).toFixed(1)}승)`);
}

console.log(`\n=== 방침 교차표 × ${X_SEEDS} 시드: 유저 팀 평균 승수 (84경기 · 같은 시드 · 선발진 = 로테이션 전원 OVR ±${SP_SHIFT}) · 괄호는 균형 대비 ===`);
console.log(`${'선발진'.padEnd(6)}${'불펜'.padEnd(6)}${PEN_STYLES.map((st) => STYLE_KO[st].padEnd(16)).join('')}경기당 구원(믿/균/벌) · 선발 이닝 · 쉰 불펜 0명`);
const ROW = process.env.BP_ROW; // 한 줄만 돌릴 때: '강함5' (병렬 실행용)
for (const [label, shift] of [['강함', SP_SHIFT], ['약함', -SP_SHIFT]] as const) {
  for (const n of [5, 6, 7, 8]) {
    if (ROW && ROW !== `${label}${n}`) continue;
    const rows = PEN_STYLES.map((st) => {
      const T = zero();
      let w = 0;
      for (let seed = 1; seed <= X_SEEDS; seed++) {
        const r = season(seed, n, st, shift);
        add(T, r.user);
        w += r.wins;
      }
      return { T, w: w / X_SEEDS };
    });
    const base = rows[PEN_STYLES.indexOf('balance')].w;
    const cell = (r: { w: number }, st: PenStyle) => (st === 'balance' ? `${r.w.toFixed(1)}승` : `${r.w.toFixed(1)}승 (${r.w - base >= 0 ? '+' : ''}${(r.w - base).toFixed(1)})`).padEnd(16);
    console.log(
      `${label.padEnd(6)}${`${n}명`.padEnd(6)}${rows.map((r, i) => cell(r, PEN_STYLES[i])).join('')}` +
        `${rows.map((r) => (r.T.relApps / r.T.teamGames).toFixed(1)).join('/')} · ${rows.map((r) => (r.T.spOuts / Math.max(1, r.T.spStarts) / 3).toFixed(1)).join('/')} · ${rows.map((r) => pct(r.T.overDays / r.T.teamGames)).join('/')}`,
    );
  }
}
