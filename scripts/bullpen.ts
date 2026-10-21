// 불펜 실측: 경기당 구원 등판 수, 구원 1인당 시즌 등판, 연투 분포, 선발 소화 이닝, 불펜 인원별 유저 팀 성적.
// 실행: npm run bullpen  (인자로 시드 수: npx tsx scripts/bullpen.ts 12 384 · 병렬: BP_JOBS=8 · 상수 덮어쓰기: BP_SIM='{"TIRED_1":10}')
import type { Core, Player, Team } from '../src/game/types';
import { mulberry32 } from '../src/game/rng';
import { genPlayer, makeCtx, newCore } from '../src/game/generate';
import { advanceDay } from '../src/game/season';
import { ensureObjectives } from '../src/game/campaign';
import { autoLineup } from '../src/game/lineup';
import { userTeam } from '../src/game/economy';
import { shiftOvr } from '../src/game/draft';
import { calcSalary } from '../src/game/ratings';
import { execFile } from 'node:child_process';
import { PEN_STYLES, SIM, type PenStyle } from '../src/game/sim';

// 튜닝용: BP_SIM='{"TIRED_1":10}' 으로 SIM 상수를 덮어쓰고 잰다
if (process.env.BP_SIM) Object.assign(SIM, JSON.parse(process.env.BP_SIM));

const N_SEEDS = Number(process.argv[2]) || 16;
const X_SEEDS = Number(process.argv[3]) || 48; // 방침 교차표의 시드 수 (차이가 보일 만큼)
const SP_SHIFT = 8; // 교차표의 선발진 강함/약함: 로테이션 전원 OVR ±
const STYLE_KO: Record<PenStyle, string> = { trust: '믿음', balance: '균형', swarm: '벌떼' };
const KEEP_REF = 7; // '평균 OVR 유지' 변형의 기준 인원
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
function setPen(core: Core, n: number, seed: number, keepAvg = false): void {
  if (keepAvg) {
    // 평균 OVR 유지: KEEP_REF 명일 때의 불펜 평균 OVR 에 맞춰 남은 팔 전원을 같은 폭으로 옮긴다 (인원 효과만 본다)
    const ref = structuredClone(core);
    setPen(ref, KEEP_REF, seed);
    const target = mean(penArms(userTeam(ref)).map((p) => p.ovr));
    setPen(core, n, seed);
    const arms = penArms(userTeam(core));
    const d = target - mean(arms.map((p) => p.ovr));
    // 반올림 오차가 한쪽으로 쌓이지 않게 누적 오차를 넘긴다
    let carry = 0;
    for (const p of arms) {
      const to = Math.round(p.ovr + d + carry);
      carry += p.ovr + d - to;
      shiftOvr(p, to);
    }
    autoLineup(userTeam(core));
    return;
  }
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
function season(seed: number, pen?: number, style?: PenStyle, spShift = 0, keepAvg = false): { league: Tally; user: Tally; wins: number; losses: number; penN: number } {
  const rng = mulberry32(seed * 7919 + 13);
  let c = ensureObjectives(newCore(seed), rng);
  autoLineup(userTeam(c)); // 개막 오더만 고친다
  if (pen !== undefined) setPen(c, pen, seed, keepAvg);
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

const se = (xs: number[]) => {
  const m = mean(xs);
  return xs.length > 1 ? Math.sqrt(xs.reduce((a, v) => a + (v - m) ** 2, 0) / (xs.length - 1) / xs.length) : 0;
};
const signed = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}`;

// 병렬 실행: BP_JOBS=8 이면 표의 줄마다 자식 프로세스(BP_ROW=줄 이름)로 나눠 돌리고 순서대로 찍는다
const ROW = process.env.BP_ROW; // 한 줄만 돌릴 때: '기본' · '인원5' · '강함5'
const JOBS = Number(process.env.BP_JOBS) || 0;
const SIZES = [5, 6, 7, 8];
const SP_ROWS = [['강함', SP_SHIFT], ['약함', -SP_SHIFT]] as const;

function baseRows(): string[] {
  const L = zero();
  const U = zero();
  const penNs: number[] = [];
  for (let seed = 1; seed <= N_SEEDS; seed++) {
    const r = season(seed);
    add(L, r.league);
    add(U, r.user);
    penNs.push(r.penN);
  }
  return [line('리그', L), line('유저 팀', U), `유저 팀 불펜 인원(마무리 포함) 평균 ${mean(penNs).toFixed(1)}명`];
}

/** 균형 방침에서 불펜 인원만 바꾼다. 두 방식: OVR 낮은 팔부터 뺀다 / 평균 OVR 을 유지한다. 괄호는 같은 방식의 7명 대비 */
function sizeRow(n: number): string {
  const out: string[] = [];
  let T0 = zero();
  for (const keep of [false, true]) {
    const T = zero();
    const w: number[] = [];
    const d: number[] = [];
    for (let seed = 1; seed <= X_SEEDS; seed++) {
      const r = season(seed, n, 'balance', 0, keep);
      add(T, r.user);
      w.push(r.wins);
      if (n !== KEEP_REF) d.push(r.wins - season(seed, KEEP_REF, 'balance', 0, keep).wins);
    }
    if (!keep) T0 = T;
    out.push(`${keep ? '평균 OVR 유지' : '낮은 팔부터'} ${mean(w).toFixed(1)}승${d.length ? ` (${KEEP_REF}명 대비 ${signed(mean(d))} ±${se(d).toFixed(2)})` : ''}`);
  }
  return `${line(`불펜 ${n}명`, T0)} | ${out.join(' | ')}`;
}

function crossRow(label: string, shift: number, n: number): string {
  const rows = PEN_STYLES.map((st) => {
    const T = zero();
    const w: number[] = [];
    for (let seed = 1; seed <= X_SEEDS; seed++) {
      const r = season(seed, n, st, shift);
      add(T, r.user);
      w.push(r.wins);
    }
    return { T, w };
  });
  const base = rows[PEN_STYLES.indexOf('balance')].w;
  const cell = (r: { w: number[] }, st: PenStyle) =>
    (st === 'balance' ? `${mean(r.w).toFixed(1)}승` : `${mean(r.w).toFixed(1)}승 (${signed(mean(r.w) - mean(base))} ±${se(r.w.map((v, i) => v - base[i])).toFixed(2)})`).padEnd(22);
  return (
    `${label.padEnd(6)}${`${n}명`.padEnd(6)}${rows.map((r, i) => cell(r, PEN_STYLES[i])).join('')}` +
    `${rows.map((r) => (r.T.relApps / r.T.teamGames).toFixed(1)).join('/')} · ${rows.map((r) => (r.T.spOuts / Math.max(1, r.T.spStarts) / 3).toFixed(1)).join('/')} · ${rows.map((r) => pct(r.T.overDays / r.T.teamGames)).join('/')}`
  );
}

const TASKS: { key: string; run: () => string[] }[] = [
  { key: '기본', run: baseRows },
  ...SIZES.map((n) => ({ key: `인원${n}`, run: () => [sizeRow(n)] })),
  ...SP_ROWS.flatMap(([label, shift]) => SIZES.map((n) => ({ key: `${label}${n}`, run: () => [crossRow(label, shift, n)] }))),
];

function child(key: string): Promise<string[]> {
  return new Promise((res, rej) =>
    execFile(process.execPath, [...process.execArgv, ...process.argv.slice(1)], { env: { ...process.env, BP_ROW: key, BP_JOBS: '' }, maxBuffer: 1 << 24 }, (err, out) =>
      err ? rej(err) : res(out.split('\n').filter(Boolean)),
    ),
  );
}

async function main(): Promise<void> {
  if (ROW) {
    for (const t of TASKS) if (t.key === ROW) console.log(t.run().join('\n'));
    return;
  }
  const res = new Map<string, string[]>();
  if (JOBS > 1) {
    const queue = TASKS.slice().reverse(); // 무거운 교차표 줄부터
    await Promise.all(
      Array.from({ length: JOBS }, async () => {
        for (let t = queue.shift(); t; t = queue.shift()) res.set(t.key, await child(t.key));
      }),
    );
  }
  const get = (key: string) => (res.get(key) ?? TASKS.find((t) => t.key === key)!.run()).join('\n');
  console.log(`=== 불펜 실측 × ${N_SEEDS} 시드 (84경기, 무개입 · 유저는 개막 오더만 고침) ===`);
  console.log('KBO 기준: kbo.ts 에 불펜 등판 수치 없음(미확인). 상식선 = 필승조 84경기 환산 35~41경기, 3연투는 드물게(전체 등판의 5% 미만)');
  console.log(get('기본'));
  console.log(`\n=== 불펜 인원별 유저 팀 × ${X_SEEDS} 시드 (균형 방침 · 같은 시드, 불펜 인원만 변경 · 더하는 팔은 OVR ${ADD_OVR} 구원) · 승수 차이는 같은 시드 짝 비교 ±표준오차 ===`);
  for (const n of SIZES) console.log(get(`인원${n}`));
  console.log(`\n=== 방침 교차표 × ${X_SEEDS} 시드: 유저 팀 평균 승수 (84경기 · 같은 시드 · 선발진 = 로테이션 전원 OVR ±${SP_SHIFT}) · 괄호는 균형 대비 ±표준오차 ===`);
  console.log(`${'선발진'.padEnd(6)}${'불펜'.padEnd(6)}${PEN_STYLES.map((st) => STYLE_KO[st].padEnd(22)).join('')}경기당 구원(믿/균/벌) · 선발 이닝 · 쉰 불펜 0명`);
  for (const [label] of SP_ROWS) for (const n of SIZES) console.log(get(`${label}${n}`));
}
void main();
