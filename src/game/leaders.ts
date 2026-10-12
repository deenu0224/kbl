// 개인 기록 순위 · 시즌 시상 · 리그 평균 환경. 순수 함수 (Core 를 바꾸지 않는다).
import type { BatPos, Core, Player, Team } from './types';
import { fmtAvg, fmtEra, fmtInt, fmtOps, fmtWhip } from './format';

export interface LeaderRow {
  pid: string;
  name: string;
  teamId: string;
  value: number;
  text: string;
}
export type BatCat = 'avg' | 'hr' | 'rbi' | 'sb' | 'ops' | 'h' | 'r';
export type PitCat = 'era' | 'w' | 'sv' | 'so' | 'whip';

const BAT_POS: BatPos[] = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH'];
const PA_PER_GAME = 3.1; // KBO 규정타석 계수
const OUTS_PER_GAME = 3; // 규정이닝 = 경기당 1이닝

const teamGames = (t: Team) => t.rec.w + t.rec.l + t.rec.t;
function leagueGames(core: Core): number {
  return core.teams.reduce((m, t) => Math.max(m, teamGames(t)), 0);
}

/** 규정타석 = 팀 경기수 × 3.1 (소수점 버림). teamId 를 주면 그 팀 경기수 기준, 없으면 리그 최다 경기 팀 기준 */
export function qualPA(core: Core, teamId?: string): number {
  const t = teamId ? core.teams.find((x) => x.id === teamId) : undefined;
  return Math.floor((t ? teamGames(t) : leagueGames(core)) * PA_PER_GAME);
}
/** 규정이닝(아웃카운트) = 팀 경기수 × 1.0 이닝 */
export function qualOuts(core: Core, teamId?: string): number {
  const t = teamId ? core.teams.find((x) => x.id === teamId) : undefined;
  return (t ? teamGames(t) : leagueGames(core)) * OUTS_PER_GAME;
}

// ── 비율 기록 (시뮬은 사구를 볼넷에 합쳐 기록한다) ──
export function avg(p: Player): number {
  return p.bat.ab > 0 ? p.bat.h / p.bat.ab : 0;
}
export function obp(p: Player): number {
  const d = p.bat.ab + p.bat.bb + sacFlies(p);
  return d > 0 ? (p.bat.h + p.bat.bb) / d : 0;
}
export function slg(p: Player): number {
  const b = p.bat;
  if (b.ab <= 0) return 0;
  const tb = b.h + b.d2 + b.d3 * 2 + b.hr * 3;
  return tb / b.ab;
}
export function ops(p: Player): number {
  return obp(p) + slg(p);
}
export function era(p: Player): number {
  return p.pit.outs > 0 ? (p.pit.er * 27) / p.pit.outs : 0;
}
export function whip(p: Player): number {
  return p.pit.outs > 0 ? ((p.pit.h + p.pit.bb) * 3) / p.pit.outs : 0;
}
/** 희생플라이는 따로 기록되지 않으므로 PA − AB − BB 로 복원 */
function sacFlies(p: Player): number {
  return Math.max(0, p.bat.pa - p.bat.ab - p.bat.bb);
}

interface Owned {
  p: Player;
  teamId: string;
}
function everyone(core: Core): Owned[] {
  return core.teams.flatMap((t) => t.roster.map((p) => ({ p, teamId: t.id })));
}
const row = (o: Owned, value: number, text: string): LeaderRow => ({ pid: o.p.id, name: o.p.name, teamId: o.teamId, value, text });

const BAT_DEF: Record<BatCat, { get: (p: Player) => number; rate: boolean; fmt: (p: Player) => string }> = {
  avg: { get: avg, rate: true, fmt: (p) => fmtAvg(p.bat.h, p.bat.ab) },
  ops: { get: ops, rate: true, fmt: (p) => fmtOps(ops(p)) },
  hr: { get: (p) => p.bat.hr, rate: false, fmt: (p) => `${p.bat.hr}` },
  rbi: { get: (p) => p.bat.rbi, rate: false, fmt: (p) => `${p.bat.rbi}` },
  sb: { get: (p) => p.bat.sb, rate: false, fmt: (p) => `${p.bat.sb}` },
  h: { get: (p) => p.bat.h, rate: false, fmt: (p) => fmtInt(p.bat.h) },
  r: { get: (p) => p.bat.r, rate: false, fmt: (p) => `${p.bat.r}` },
};
const PIT_DEF: Record<PitCat, { get: (p: Player) => number; rate: boolean; fmt: (p: Player) => string }> = {
  era: { get: era, rate: true, fmt: (p) => fmtEra(p.pit.er, p.pit.outs) },
  whip: { get: whip, rate: true, fmt: (p) => fmtWhip(p.pit.h + p.pit.bb, p.pit.outs) },
  w: { get: (p) => p.pit.w, rate: false, fmt: (p) => `${p.pit.w}승` },
  sv: { get: (p) => p.pit.sv, rate: false, fmt: (p) => `${p.pit.sv}` },
  so: { get: (p) => p.pit.so, rate: false, fmt: (p) => `${p.pit.so}` },
};

/** 타격 순위. 비율 기록(타율·OPS)은 규정타석 이상만 */
export function batLeaders(core: Core, cat: BatCat, n = 10): LeaderRow[] {
  const d = BAT_DEF[cat];
  return everyone(core)
    .filter((o) => o.p.kind === 'B' && o.p.bat.pa > 0 && (!d.rate || o.p.bat.pa >= qualPA(core, o.teamId)))
    .map((o) => ({ o, v: d.get(o.p) }))
    .filter((x) => d.rate || x.v > 0)
    .sort((a, b) => b.v - a.v || b.o.p.bat.pa - a.o.p.bat.pa)
    .slice(0, n)
    .map((x) => row(x.o, x.v, d.fmt(x.o.p)));
}

/** 투수 순위. 비율 기록(평균자책·WHIP)은 규정이닝 이상만, 낮을수록 위 */
export function pitLeaders(core: Core, cat: PitCat, n = 10): LeaderRow[] {
  const d = PIT_DEF[cat];
  return everyone(core)
    .filter((o) => o.p.kind === 'P' && o.p.pit.g > 0 && (!d.rate || o.p.pit.outs >= qualOuts(core, o.teamId)))
    .map((o) => ({ o, v: d.get(o.p) }))
    .filter((x) => d.rate || x.v > 0)
    .sort((a, b) => (d.rate ? a.v - b.v : b.v - a.v) || b.o.p.pit.outs - a.o.p.pit.outs)
    .slice(0, n)
    .map((x) => row(x.o, x.v, d.fmt(x.o.p)));
}

/** 현재 리그 평균 환경 */
export function leagueEnv(core: Core): { avg: number; obp: number; slg: number; era: number; rpg: number; hrPerGame: number; sbPerGame: number } {
  let pa = 0, ab = 0, h = 0, tb = 0, bb = 0, hr = 0, sb = 0, er = 0, outs = 0, runs = 0, games = 0;
  for (const t of core.teams) {
    runs += t.rec.rs;
    games += teamGames(t);
    for (const p of t.roster) {
      const b = p.bat;
      pa += b.pa; ab += b.ab; h += b.h; bb += b.bb; hr += b.hr; sb += b.sb;
      tb += b.h + b.d2 + b.d3 * 2 + b.hr * 3;
      er += p.pit.er; outs += p.pit.outs;
    }
  }
  const sf = Math.max(0, pa - ab - bb);
  return {
    avg: ab ? h / ab : 0,
    obp: pa ? (h + bb) / (ab + bb + sf) : 0,
    slg: ab ? tb / ab : 0,
    era: outs ? (er * 27) / outs : 0,
    rpg: games ? runs / games : 0,
    hrPerGame: games ? hr / games : 0,
    sbPerGame: games ? sb / games : 0,
  };
}

// ── 시상 ──
export interface LeagueAwards {
  mvp: LeaderRow | null;
  rookie: LeaderRow | null;
  goldenGlove: Record<BatPos, LeaderRow | null>;
  titles: { cat: string; label: string; row: LeaderRow }[];
}

/** 대략적인 평균 대비 득점 기여 (MVP·신인왕 비교용, 단위 ≈ 점) */
function value(p: Player, env: ReturnType<typeof leagueEnv>): number {
  if (p.kind === 'B') {
    const b = p.bat;
    if (b.pa === 0) return -Infinity;
    const lgOps = env.obp + env.slg;
    return b.pa * (ops(p) - lgOps) * 0.3 + b.sb * 0.2 - b.cs * 0.4 + (p.def - 60) * 0.05 * (b.g / 84);
  }
  if (p.pit.outs === 0) return -Infinity;
  return ((env.era - era(p)) * p.pit.outs) / 27 + p.pit.sv * 0.3;
}

function valueText(p: Player): string {
  if (p.kind === 'B') {
    const b = p.bat;
    return `${fmtAvg(b.h, b.ab)} ${b.hr}홈런 ${b.rbi}타점${b.sb >= 10 ? ` ${b.sb}도루` : ''} OPS ${fmtOps(ops(p))}`;
  }
  const s = p.pit;
  const role = s.sv >= 10 ? ` ${s.sv}세이브` : '';
  return `${s.w}승 ${s.l}패${role} ERA ${fmtEra(s.er, s.outs)} ${s.so}K`;
}

const BAT_TITLES: { cat: BatCat; label: string }[] = [
  { cat: 'avg', label: '타격왕' },
  { cat: 'hr', label: '홈런왕' },
  { cat: 'rbi', label: '타점왕' },
  { cat: 'r', label: '득점왕' },
  { cat: 'h', label: '최다안타' },
  { cat: 'sb', label: '도루왕' },
];
const PIT_TITLES: { cat: PitCat; label: string }[] = [
  { cat: 'era', label: '평균자책 1위' },
  { cat: 'w', label: '다승왕' },
  { cat: 'so', label: '탈삼진왕' },
  { cat: 'sv', label: '세이브왕' },
];

/** 시즌 종료 시 시상. 신인왕은 Player.rookie === true 인 선수 중에서 */
export function leagueAwards(core: Core): LeagueAwards {
  const env = leagueEnv(core);
  const all = everyone(core);
  const qualified = (o: Owned) =>
    o.p.kind === 'B' ? o.p.bat.pa >= qualPA(core, o.teamId) : o.p.pit.outs >= qualOuts(core, o.teamId) || o.p.pit.sv >= 15;

  const best = (cands: Owned[]): LeaderRow | null => {
    let top: Owned | undefined;
    let topV = -Infinity;
    for (const o of cands) {
      const v = value(o.p, env);
      if (v > topV) {
        topV = v;
        top = o;
      }
    }
    return top ? row(top, Math.round(topV * 10) / 10, valueText(top.p)) : null;
  };

  const mvp = best(all.filter(qualified));
  const rookie = best(all.filter((o) => o.p.rookie === true && (o.p.bat.pa > 0 || o.p.pit.outs > 0)));

  // 골든글러브: 주 포지션 기준, 규정타석의 2/3 이상. 공격(OPS) + 수비
  const goldenGlove = {} as Record<BatPos, LeaderRow | null>;
  for (const pos of BAT_POS) {
    let top: Owned | undefined;
    let topV = -Infinity;
    for (const o of all) {
      if (o.p.kind !== 'B' || o.p.pos !== pos) continue;
      if (o.p.bat.pa < qualPA(core, o.teamId) * (2 / 3)) continue;
      const v = ops(o.p) + (pos === 'DH' ? 0 : (o.p.def - 60) * 0.004);
      if (v > topV) {
        topV = v;
        top = o;
      }
    }
    goldenGlove[pos] = top ? row(top, Math.round(topV * 1000) / 1000, valueText(top.p)) : null;
  }

  const titles: LeagueAwards['titles'] = [];
  for (const t of BAT_TITLES) {
    const r = batLeaders(core, t.cat, 1)[0];
    if (r) titles.push({ cat: t.cat, label: t.label, row: r });
  }
  for (const t of PIT_TITLES) {
    const r = pitLeaders(core, t.cat, 1)[0];
    if (r) titles.push({ cat: t.cat, label: t.label, row: r });
  }
  return { mvp, rookie, goldenGlove, titles };
}
