import type { Matchup } from './types';
import { shuffle, type Rng } from './rng';

export const GAMES = 84;
const SERIES_LEN = 3; // 3연전 (화~목 / 금~일)

/**
 * 84일 × 4경기. 7라운드 풀리그(원형 방식)를 3연전으로 4바퀴 돈다.
 * 홀수 바퀴는 홈/원정을 뒤집어 상대별 12경기(홈 6), 팀당 홈 42경기가 된다.
 */
export function buildSchedule(teamIds: string[], rng: Rng): Matchup[][] {
  const ids = shuffle(rng, teamIds);
  const n = ids.length;
  if (n % 2 !== 0) throw new Error('구단 수는 짝수여야 합니다');
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
  const cycles = Math.round(GAMES / ((n - 1) * SERIES_LEN));
  for (let c = 0; c < cycles; c++) {
    for (const round of shuffle(rng, rounds)) {
      const games = round.map((g) => (c % 2 === 1 ? { homeId: g.awayId, awayId: g.homeId } : { ...g }));
      for (let k = 0; k < SERIES_LEN; k++) days.push(shuffle(rng, games).map((g) => ({ ...g })));
    }
  }
  return days;
}
