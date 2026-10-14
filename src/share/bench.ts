import table from './bench.json';
import table8 from './bench8.json';

/** 가상 단장 분포표 (scripts/share/bench.ts 가 만든다: 봇 4종 × 시드 × 15시즌) */
interface BenchTable {
  n: number;
  seasons: number;
  champ: number[]; // champ[s-1] = s 시즌째에 첫 우승한 단장 수
  over: number[]; // over[s-1] = s 시즌째에 연고 이전된 단장 수
  progress: number[][][]; // progress[s-1] = [도달한 장(연고 이전 = -1), 최고 순위, 단장 수][]
  teams?: number; // 표를 만든 리그의 구단 수 (없으면 8 — 10구단 체제 전에 만든 표)
}
/** 새 게임(10구단) 난이도의 표 */
export const BENCH = table as BenchTable;
/** 원년 8구단 리그의 표 (10구단 체제 전에 만든 것 — 8구단 세이브와 옛 명예의 전당 기록은 이 표에 견준다) */
export const BENCH8 = table8 as BenchTable;
/** 기록의 구단 수에 맞는 표 (ShareRecord.teams · HofClub.teams — 없으면 8) */
export const benchFor = (teams = 8): BenchTable => (teams <= (BENCH8.teams ?? 8) ? BENCH8 : BENCH);

export interface Percentile {
  pct: number; // 상위 n% (작을수록 좋다. 1~99)
  n: number; // 표본 수
  basis: string; // 무엇으로 줄을 세웠는가
}
export interface BenchInput {
  seasons: number;
  champAt: number | null; // 첫 우승 시즌
  relocated: boolean;
  stage: number; // 도달한 장 (0-based)
  best: number; // 최고 순위
  teams?: number; // 그 기록의 리그 구단 수 (없으면 8)
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
/** 가상 단장 중 연고 이전으로 끝난 비율(%). 표에 값이 없으면 null */
export function relocatedPct(t: BenchTable = BENCH): number | null {
  if (!t || !(t.n > 0) || !Array.isArray(t.over)) return null;
  return Math.round((sum(t.over) / t.n) * 100);
}
/** 나보다 잘한 단장 + 나와 같은 단장의 절반 → 상위 % */
const rankPct = (better: number, equal: number, n: number) => Math.max(1, Math.min(99, Math.round(((better + equal / 2) / Math.max(1, n)) * 100)));
/** 진행도 점수: 장이 먼저, 그다음 최고 순위. 순위는 구단 수가 달라도 견줄 수 있게 8구단 눈금(꼴찌 0 ~ 1위 7)으로 맞춘다 */
const score = (stage: number, best: number, teams = 8) => stage * 10 + Math.round((((teams - best) * 7) / Math.max(1, teams - 1)) * 100) / 100;

/** 가상 단장들 사이의 자리. 우승했으면 우승까지 걸린 시즌 수, 연고 이전이면 버틴 시즌 수, 아니면 같은 시즌 시점의 진행도(장 → 최고 순위) */
export function percentile(r: BenchInput, t: BenchTable = benchFor(r.teams)): Percentile {
  const n = t.n;
  if (r.champAt) {
    const s = Math.min(r.champAt, t.seasons + 1);
    const better = sum(t.champ.slice(0, s - 1));
    const equal = s <= t.seasons ? t.champ[s - 1] : n - sum(t.champ);
    return { pct: rankPct(better, equal, n), n, basis: '우승까지 걸린 시즌 수 기준' };
  }
  if (r.relocated) {
    const s = Math.min(Math.max(1, r.seasons), t.seasons);
    const better = n - sum(t.over.slice(0, s));
    return { pct: rankPct(better, t.over[s - 1], n), n, basis: '버틴 시즌 수 기준' };
  }
  const s = Math.min(Math.max(1, r.seasons), t.seasons);
  const mine = score(r.stage, r.best, r.teams);
  let better = 0;
  let equal = 0;
  for (const [stage, best, k] of t.progress[s - 1] ?? []) {
    const v = score(stage, best, t.teams);
    if (v > mine) better += k;
    else if (v === mine) equal += k;
  }
  return { pct: rankPct(better, equal, n), n, basis: `${s}시즌 시점의 진행도 기준` };
}
