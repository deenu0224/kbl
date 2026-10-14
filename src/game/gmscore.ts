// 단장 점수(0~1000)와 랭크 9단계 · 명장면 · 시즌 기록 장치 (기록 카드·결산·명예의 전당이 읽는다).
// 점수는 순수 함수, 기록 장치(…Mut)는 경기 결과를 옮겨 적기만 한다 — 난수를 쓰지 않고 게임 수치를 바꾸지 않는다.
import type { Core, GameResult, GameScene, GmParts, PostFinish, PostRound, SeasonDiary, SeasonRecord, VsRec } from './types';
import { pastRanks } from './story';
import RANK_TABLE from '../share/rank.json';

// ───────── 점수 ─────────

/** 한 시즌 점수의 재료 (결산 때 core 에서 모은다. 빠진 값은 중립으로 본다) */
export interface GmCtx {
  teams: number;
  startRank: number; // 시즌 시작 때의 순위 (지난 시즌 순위, 첫 시즌은 부임 전 마지막 순위)
  debt0?: number; // 시즌 시작 부채 (없으면 증감 0)
  debt?: number; // 결산 부채
  fill?: number; // 홈 평균 관중 / 좌석 수 (0~1)
  sellouts?: number;
  homeGames?: number;
  luxTax?: boolean; // 경쟁균형세를 냈다
  debtBad?: boolean; // 부채 한도 초과 또는 빚더미 여론
  trust?: number; // 시즌 말 도민 지지 0~100
  stars?: number; // 이번 시즌에 딴 별 수
}

/** 성적 450 = 최종 순위 220 + 순위 상승 100 + 가을야구 130 */
export const GM_MAX = { s: 450, p: 300, m: 250 } as const;
const POST_PTS: Record<PostFinish, number> = { none: 0, WC: 40, SPO: 60, PO: 85, KS: 110, champion: 130 };
const RISE_PER = 25; // 한 계단 오를 때마다 (최대 100)
const PROFIT_FULL = 200000; // 영업 손익 ±20억이면 끝 (0~120, 0원 = 60)
const DEBT_FULL = 250000; // 부채 ±25억이면 끝 (0~60, 그대로 = 30)
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * 한 시즌 단장 점수.
 * 성적 450: 최종 순위 220(1위 220 ~ 꼴찌 0) · 시작 대비 상승 100(한 계단 25) · 가을야구 130(WC 40 → 준PO 60 → PO 85 → KS 110 → 우승 130)
 * 살림 300: 영업 손익 120 · 부채 증감 60 · 관중 60(점유율) + 매진 20(홈경기 중 매진 비율) · 경쟁균형세 안 냄 20 + 빚더미 여론 피함 20
 * 민심 250: 시즌 말 도민 지지 150(지지 × 1.5) · 깃발 달성 60 · 별 한 개 20(최대 40)
 */
export function gmScore(r: Pick<SeasonRecord, 'rank' | 'post' | 'profit' | 'cleared'>, x: GmCtx): GmParts {
  const span = Math.max(1, x.teams - 1);
  const place = (220 * (x.teams - clamp(r.rank, 1, x.teams))) / span;
  const rise = Math.min(100, Math.max(0, x.startRank - r.rank) * RISE_PER);
  const s = place + rise + POST_PTS[r.post];
  const profit = 60 + clamp(r.profit / PROFIT_FULL, -1, 1) * 60;
  const debt = x.debt0 === undefined || x.debt === undefined ? 30 : 30 - clamp((x.debt - x.debt0) / DEBT_FULL, -1, 1) * 30;
  const crowd = clamp(x.fill ?? 0.5, 0, 1) * 60 + (x.homeGames ? clamp((x.sellouts ?? 0) / x.homeGames, 0, 1) * 20 : 0);
  const p = profit + debt + crowd + (x.luxTax ? 0 : 20) + (x.debtBad ? 0 : 20);
  const m = clamp(x.trust ?? 50, 0, 100) * 1.5 + (r.cleared ? 60 : 0) + Math.min(2, x.stars ?? 0) * 20;
  return { s: Math.round(clamp(s, 0, GM_MAX.s)), p: Math.round(clamp(p, 0, GM_MAX.p)), m: Math.round(clamp(m, 0, GM_MAX.m)) };
}
export const gmTotal = (g: GmParts): number => g.s + g.p + g.m;

/**
 * 단장 경력 점수 (우승·연고 이전 엔딩 카드): 시즌 점수 평균 + 우승 한 번에 60(최대 3번) + 첫 우승이 빠를수록 (11 − 첫 우승 시즌) × 10.
 * 점수가 남은 시즌이 없으면 null
 */
export function careerScore(h: Pick<SeasonRecord, 'gm' | 'post'>[]): number | null {
  const gs = h.filter((x) => x.gm).map((x) => gmTotal(x.gm!));
  if (!gs.length) return null;
  const mean = gs.reduce((a, b) => a + b, 0) / gs.length;
  const titles = h.filter((x) => x.post === 'champion').length;
  const first = h.findIndex((x) => x.post === 'champion') + 1;
  const speed = first > 0 ? Math.max(0, 11 - first) * 10 : 0;
  return Math.round(clamp(mean + Math.min(3, titles) * 60 + speed, 0, 1000));
}

// ───────── 랭크 ─────────

export interface GmRank {
  id: string; // 'SS' | 'S' | 'A+' | 'A' | 'B+' | 'B' | 'C' | 'D' | 'F'
  name: string;
  pct: number; // 목표 비율 (%)
  color: string;
}
export const RANKS: GmRank[] = [
  { id: 'SS', name: '명예의 전당', pct: 0.5, color: '#ffd84a' },
  { id: 'S', name: '전설의 단장', pct: 2, color: '#ffc83a' },
  { id: 'A+', name: '우승 청부사', pct: 4, color: '#6ee07a' },
  { id: 'A', name: '명단장', pct: 8, color: '#8fe68a' },
  { id: 'B+', name: '믿을 만한 단장', pct: 12, color: '#7fd3ff' },
  { id: 'B', name: '쓸만한 단장', pct: 18, color: '#a5def5' },
  { id: 'C', name: '초보 단장', pct: 25, color: '#f0c35a' },
  { id: 'D', name: '방구석 단장', pct: 20, color: '#f0a35a' },
  { id: 'F', name: '해체 위기', pct: 10.5, color: '#ff6b6b' },
];

/** 랭크 경계표 (scripts/share/bench.ts 가 봇 단장 분포로 만든다): cuts = SS·S·A+·A·B+·B·C·D 의 최저 점수 8개 */
interface RankCuts {
  n: number; // 표본 수
  cuts: number[];
}
interface RankLeague {
  season: RankCuts[]; // [1시즌째, 2시즌째, …, 6시즌째 이상]
  career: RankCuts;
}
const TABLE = RANK_TABLE as unknown as { [teams: string]: RankLeague };
export const SEASON_GROUPS = 6;
const leagueOf = (teams: number): RankLeague => TABLE[teams <= 8 ? '8' : '10'] ?? TABLE['10'];
const byCuts = (score: number, cuts: number[]): GmRank => RANKS[cuts.findIndex((c) => score >= c) < 0 ? RANKS.length - 1 : cuts.findIndex((c) => score >= c)];

/** 시즌 점수 → 랭크. nth = 단장 몇 시즌째(1부터, 6 이상은 한 묶음) */
export function seasonRank(score: number, nth: number, teams: number): GmRank {
  const t = leagueOf(teams).season;
  return byCuts(score, t[clamp(nth, 1, t.length) - 1].cuts);
}
export function careerRank(score: number, teams: number): GmRank {
  return byCuts(score, leagueOf(teams).career.cuts);
}

/** 화면·카드에 쓰는 한 줄: "단장 A · 명단장 · 742점" */
export const gmLine = (rank: GmRank, score: number): string => `단장 ${rank.id} · ${rank.name} · ${score}점`;

export interface GmView {
  score: number;
  parts: GmParts;
  rank: GmRank;
}
/** 기록의 i번째(0-based) 시즌 → 점수·랭크. 점수가 없는 옛 기록이면 null */
export function seasonView(h: SeasonRecord[], i: number, teams: number): GmView | null {
  const g = h[i]?.gm;
  if (!g) return null;
  const score = gmTotal(g);
  return { score, parts: g, rank: seasonRank(score, i + 1, teams) };
}

// ───────── 명장면 ─────────

/** 명장면 순위 (희귀한 것부터). 표는 docs/DESIGN.md 공유 절 */
export const SCENE_KO = ['', '노히트 노런', '완봉승', '7점 차 이상 역전승', '끝내기 홈런', '끝내기', '한 경기 20득점', '10연승 이상'];
const ROUND_KO: Record<PostRound, string> = { WC: '와일드카드', SPO: '준플레이오프', PO: '플레이오프', KS: '한국시리즈' };

/** 우리가 가장 크게 끌려간 점수 차 (이닝 득점으로 반 이닝마다 따진다) */
function maxDeficit(res: GameResult, isHome: boolean): number {
  let me = 0;
  let op = 0;
  let worst = 0;
  const [a, h] = res.line;
  for (let i = 0; i < Math.max(a.length, h.length); i++) {
    if (isHome) op += a[i] ?? 0;
    else me += a[i] ?? 0;
    worst = Math.max(worst, op - me);
    if (isHome) me += h[i] ?? 0;
    else op += h[i] ?? 0;
    worst = Math.max(worst, op - me);
  }
  return worst;
}

/** 한 경기의 장면 판정 (이기지 못했으면 없음) */
export function sceneOf(res: GameResult, isHome: boolean, oppName: string, round?: PostRound): GameScene | null {
  const me = isHome ? res.home : res.away;
  const op = isHome ? res.away : res.home;
  if (me <= op) return null;
  const side = isHome ? 1 : 0;
  const pit = res.box?.[side].pit ?? [];
  const solo = pit.length === 1 ? pit[0].name : null;
  const walk = isHome ? res.events.find((e) => e.type === 'walkoff' && e.teamId === res.homeId) : undefined;
  const deficit = maxDeficit(res, isHome);
  const head = round ? `${ROUND_KO[round]} ` : '';
  const vs = `${oppName}전 `;
  let k = 0;
  let text = '';
  if (res.hits[isHome ? 0 : 1] === 0) {
    k = 1;
    text = `${solo ? `${solo} ` : '이어 던진 '}노히트 노런 (${vs.trim()} ${me}:0)`;
  } else if (op === 0 && solo) {
    k = 2;
    text = `${solo} 완봉승 (${vs.trim()} ${me}:0)`;
  } else if (deficit >= 7) {
    k = 3;
    text = walk ? `${vs}${walk.inning}회말 ${deficit}점 차 뒤집은 끝내기` : `${vs}${deficit}점 차 뒤집은 역전승`;
  } else if (walk && /홈런/.test(walk.text)) {
    k = 4;
    text = `${vs}${walk.inning}회말 ${walk.text.replace(/!$/, '')}`;
  } else if (walk) {
    k = 5;
    text = `${vs}${walk.inning}회말 ${walk.pid ? walk.text.replace(/!$/, '') : '연장 끝내기'}`;
  } else if (me >= 20) {
    k = 6;
    text = `${vs}${me}득점 폭발 (${me}:${op})`;
  } else return null;
  return { k: round ? k - 0.5 : k, text: head + text };
}

/** 같은 순위면 먼저 나온 장면을 남긴다 */
const rarer = (a: GameScene | undefined, b: GameScene | null): GameScene | undefined => (b && (!a || b.k < a.k) ? b : a);

/** 이번 시즌 기록장 (없거나 지난 시즌 것이면 새로) */
function diaryOf(core: Core): SeasonDiary {
  const c = core.campaign;
  if (!c.diary || c.diary.season !== core.season) c.diary = { season: core.season, vs: {}, debt0: core.finance.debt };
  return c.diary;
}

/** 유저 경기 하나를 기록장에 옮겨 적는다: 정규시즌은 상대 전적 + 명장면, 가을야구는 명장면만 */
export function diaryMut(core: Core, res: GameResult, isHome: boolean, round?: PostRound): void {
  const d = diaryOf(core);
  const oppId = isHome ? res.awayId : res.homeId;
  const me = isHome ? res.home : res.away;
  const op = isHome ? res.away : res.home;
  if (!round) {
    const v = (d.vs[oppId] ??= [0, 0, 0]);
    v[me > op ? 0 : me < op ? 1 : 2]++;
  }
  const opp = core.teams.find((t) => t.id === oppId);
  d.scene = rarer(d.scene, sceneOf(res, isHome, opp?.name ?? '', round));
}

// ───────── 결산 때 시즌 기록으로 옮기기 ─────────

/** 경기별 결과 (1 승 · 0 패 · 0.5 무) → 6구간 승률 */
export function monthsOf(results: number[], parts = 6): number[] {
  if (!results.length) return [];
  return Array.from({ length: parts }, (_, i) => {
    const xs = results.slice(Math.floor((i * results.length) / parts), Math.floor(((i + 1) * results.length) / parts));
    return xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 1000) / 1000 : 0;
  });
}
export function longestWin(results: number[]): number {
  let best = 0;
  let cur = 0;
  for (const x of results) {
    cur = x === 1 ? cur + 1 : 0;
    best = Math.max(best, cur);
  }
  return best;
}

/** 상대 전적 → 천적(가장 나쁨)·밥(가장 좋음). 승패 차가 3 미만이면 없음 */
export function foeAndPrey(core: Pick<Core, 'teams'>, vs: SeasonDiary['vs']): { foe?: VsRec; prey?: VsRec } {
  const rows = Object.entries(vs).map(([id, [w, l, t]]) => ({ name: core.teams.find((x) => x.id === id)?.name ?? '', w, l, t }));
  const diff = (r: VsRec) => r.w - r.l;
  const foe = [...rows].sort((a, b) => diff(a) - diff(b) || b.l - a.l)[0];
  const prey = [...rows].sort((a, b) => diff(b) - diff(a) || b.w - a.w)[0];
  return { ...(foe && diff(foe) <= -3 ? { foe } : {}), ...(prey && diff(prey) >= 3 ? { prey } : {}) };
}

/** 지난 시즌 기록과 부임 전 순위로 시즌 시작 순위를 정한다 */
export const startRankOf = (prev: SeasonRecord[], teams: number): number => prev[prev.length - 1]?.rank ?? pastRanks(teams)[pastRanks(teams).length - 1];

/** 기록장의 명장면에 시즌 연승(10연승 이상)을 견줘 그 시즌의 명장면을 정한다 */
export function seasonScene(d: SeasonDiary | undefined, streak: number): GameScene | undefined {
  return rarer(d?.scene, streak >= 10 ? { k: 7, text: `${streak}연승 질주` } : null);
}
