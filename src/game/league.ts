// 리그 규모(구단 수·시즌 경기 수)에서 유도하는 값들. docs/TEN_TEAMS.md
// 구단 수와 경기 수는 세이브에서 읽는다: 기존 8구단 세이브는 8구단·84경기, 새 게임은 10구단·81경기.
// 다른 게임 모듈을 import 하지 않는다 (어디서든 순환 없이 쓸 수 있게).
import type { Core, PostRound } from './types';

export const BASE_GAMES = 84; // "n경기째" 상수와 KBO 환산치의 기준 시즌 길이
export const BASE_TEAMS = 8; // 리그 규모 비례 상수(FA 풀·드래프트 풀 등)의 기준 구단 수
export const SERIES_LEN = 3; // 3연전 (화~목 / 금~일)
const WC_MIN_TEAMS = 10; // 이 구단 수부터 와일드카드 결정전(5팀 포스트시즌)

/** 한 바퀴(상대 전부와 3연전 한 번씩)를 몇 번 도는가: 시즌이 BASE_GAMES 에 가장 가까워지는 바퀴 수 (8팀 4바퀴, 10팀 3바퀴) */
export function cyclesFor(teams: number): number {
  return Math.max(1, Math.round(BASE_GAMES / ((teams - 1) * SERIES_LEN)));
}
/** 구단 수 → 시즌 경기 수 (8팀 84, 10팀 81) */
export function gamesFor(teams: number): number {
  return (teams - 1) * SERIES_LEN * cyclesFor(teams);
}

/** 구단 수 */
export function leagueSize(core: Pick<Core, 'teams'>): number {
  return core.teams.length;
}
/** 시즌 경기 수 (일정이 비어 있으면 구단 수에서 유도) */
export function seasonGames(core: { schedule: unknown[]; teams?: unknown[] }): number {
  return core.schedule.length || gamesFor(core.teams?.length || BASE_TEAMS);
}
/** 84경기 기준의 "n경기째"를 이 리그의 시즌 길이로 환산 (84경기 리그에서는 그대로) */
export function dayAt(core: { schedule: unknown[]; teams?: unknown[] }, day84: number): number {
  return Math.round((day84 * seasonGames(core)) / BASE_GAMES);
}
/** dayAt 과 같되 3연전 경계에 맞춘다 (6연전 구간의 시작처럼 블록 단위로 놓이는 값) */
export function blockDayAt(core: { schedule: unknown[]; teams?: unknown[] }, day84: number): number {
  return Math.round((day84 * seasonGames(core)) / BASE_GAMES / SERIES_LEN) * SERIES_LEN;
}
/** 기준 구단 수(8)에 맞춘 개수를 이 리그 규모로 환산 (8구단이면 그대로) */
export function perLeague(core: Pick<Core, 'teams'>, n8: number): number {
  return Math.round((n8 * leagueSize(core)) / BASE_TEAMS);
}

/** 포스트시즌 진출 팀 수 (8구단 4팀, 10구단 5팀) */
export function postTeamsFor(teams: number): number {
  return teams >= WC_MIN_TEAMS ? 5 : 4;
}
export function postTeams(core: Pick<Core, 'teams'>): number {
  return postTeamsFor(leagueSize(core));
}
/** 포스트시즌 라운드 순서 (앞에서부터) */
export function postRounds(core: Pick<Core, 'teams'>): PostRound[] {
  return postTeams(core) >= 5 ? ['WC', 'SPO', 'PO', 'KS'] : ['SPO', 'PO', 'KS'];
}
/** 가을야구 진출권 순위인가 */
export function inPost(core: Pick<Core, 'teams'>, rank: number): boolean {
  return rank <= postTeams(core);
}
/** 와일드카드 결정전 자리인가 (5팀 포스트시즌의 4·5위. 4팀 포스트시즌에는 없다) */
export function inWildcard(core: Pick<Core, 'teams'>, rank: number): boolean {
  return postTeams(core) >= 5 && rank >= postTeams(core) - 1 && rank <= postTeams(core);
}
/** 하위권인가 (아래에서 두 팀 — 순위를 빨갛게 적는 기준. 8구단 7·8위, 10구단 9·10위) */
export function inCellar(core: Pick<Core, 'teams'>, rank: number): boolean {
  return rank > leagueSize(core) - 2;
}
/** 꼴찌인가 (순위 = 구단 수) */
export function isLast(core: Pick<Core, 'teams'>, rank: number): boolean {
  return rank >= leagueSize(core);
}

/** 84경기 기준의 경기당 금액을 시즌 합계가 같도록 이 리그의 경기당 금액으로 (84경기 리그에서는 그대로) */
export function perGame(core: { schedule: unknown[]; teams?: unknown[] }, v84: number): number {
  return (v84 * BASE_GAMES) / seasonGames(core);
}
/** 순위에 따른 몫의 단위 수: 꼴찌 0 ~ 1위 7 (8구단 기준 눈금에 맞춘다. 8구단이면 구단 수 − 순위 그대로) */
export function rankUnits(core: Pick<Core, 'teams'>, rank: number): number {
  const n = leagueSize(core);
  return n > 1 ? ((n - rank) * (BASE_TEAMS - 1)) / (n - 1) : 0;
}
