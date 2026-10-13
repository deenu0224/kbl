import type { Matchup } from './types';
import { shuffle, type Rng } from './rng';
import { BASE_GAMES, SERIES_LEN, cyclesFor } from './league';

/** 기준 시즌 길이 (8구단 84경기). 실제 시즌 길이는 core.schedule.length — league.ts seasonGames(core) 를 쓴다 */
export const GAMES = BASE_GAMES;

/**
 * 풀리그(원형 방식)를 3연전으로 여러 바퀴 돈다. 바퀴 수는 구단 수에서 유도한다 (league.ts cyclesFor: 시즌이 84경기에 가장 가까운 수).
 * - 8구단: 7라운드 × 4바퀴 = 84일 × 4경기. 홀수 바퀴는 홈/원정을 뒤집어 상대별 12경기(홈 6), 팀당 홈 42경기.
 * - 10구단: 9라운드 × 3바퀴 = 81일 × 5경기. 상대별 9경기(3연전 3번 — 홈 2번·원정 1번 또는 그 반대),
 *   팀당 홈 3연전이 13 또는 14번. favorId(유저 구단)는 항상 14번(홈 42 · 원정 39)이 된다.
 */
export function buildSchedule(teamIds: string[], rng: Rng, favorId?: string): Matchup[][] {
  const n = teamIds.length;
  if (n % 2 !== 0) throw new Error('구단 수는 짝수여야 합니다');
  const cycles = cyclesFor(n);
  if (cycles % 2 === 1) return buildOdd(teamIds, rng, cycles, favorId);
  const ids = shuffle(rng, teamIds);
  const rounds: Matchup[][] = [];
  const rest = ids.slice(1);
  for (let r = 0; r < n - 1; r++) {
    const arr = [ids[0], ...rest.slice(r), ...rest.slice(0, r)];
    const games: Matchup[] = [];
    for (let i = 0; i < n / 2; i++) {
      const a = arr[i];
      const b = arr[n - 1 - i];
      const aHome = i === 0 ? r % 2 === 0 : i % 2 === 1;
      games.push(aHome ? { homeId: a, awayId: b } : { homeId: b, awayId: a });
    }
    rounds.push(games);
  }
  const days: Matchup[][] = [];
  for (let c = 0; c < cycles; c++) {
    for (const round of shuffle(rng, rounds)) {
      const games = round.map((g) => (c % 2 === 1 ? { homeId: g.awayId, awayId: g.homeId } : { ...g }));
      for (let k = 0; k < SERIES_LEN; k++) days.push(shuffle(rng, games).map((g) => ({ ...g })));
    }
  }
  return days;
}

/**
 * 바퀴 수가 홀수인 리그(10구단 3바퀴). 한 바퀴의 홈/원정을 "균형 방향"으로 정한다:
 * 앞의 n−1 팀은 원형으로 놓고 시계 방향으로 가까운 절반을 홈에서 맞는다(각자 홈 (n−2)/2 번),
 * 마지막 팀은 짝수 번째 팀을 홈에서 맞는다. 그러면 한 바퀴에 마지막 팀과 홀수 번째 팀은 홈이 n/2 번, 짝수 번째 팀은 n/2−1 번.
 * 짝수 바퀴는 이 방향, 홀수 바퀴는 뒤집는다 → 바퀴가 홀수 개면 "이 방향"이 한 번 더 온다.
 * favorId 를 마지막 자리에 두므로 그 팀의 홈 3연전은 항상 많은 쪽(10구단 14번)이다.
 */
function buildOdd(teamIds: string[], rng: Rng, cycles: number, favorId?: string): Matchup[][] {
  const n = teamIds.length;
  let ids = shuffle(rng, teamIds);
  if (favorId && ids.includes(favorId)) ids = [...ids.filter((id) => id !== favorId), favorId];
  const idx = new Map(ids.map((id, i) => [id, i]));
  const last = n - 1;
  const aHosts = (a: string, b: string): boolean => {
    const i = idx.get(a)!;
    const j = idx.get(b)!;
    if (i === last) return j % 2 === 0;
    if (j === last) return i % 2 === 1;
    const d = (j - i + last) % last;
    return d >= 1 && d <= (n - 2) / 2;
  };
  const rounds: Matchup[][] = [];
  const rest = ids.slice(0, last);
  for (let r = 0; r < n - 1; r++) {
    const arr = [ids[last], ...rest.slice(r), ...rest.slice(0, r)];
    const games: Matchup[] = [];
    for (let i = 0; i < n / 2; i++) {
      const a = arr[i];
      const b = arr[n - 1 - i];
      games.push(aHosts(a, b) ? { homeId: a, awayId: b } : { homeId: b, awayId: a });
    }
    rounds.push(games);
  }
  const days: Matchup[][] = [];
  for (let c = 0; c < cycles; c++) {
    for (const round of shuffle(rng, rounds)) {
      const games = round.map((g) => (c % 2 === 1 ? { homeId: g.awayId, awayId: g.homeId } : { ...g }));
      for (let k = 0; k < SERIES_LEN; k++) days.push(shuffle(rng, games).map((g) => ({ ...g })));
    }
  }
  return days;
}
