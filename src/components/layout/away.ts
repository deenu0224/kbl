import type { Core } from '../../game/types';

// 원정 응원단·상대 구장 시설은 원정 입장 몫 모델(game/gate.ts)과 같이 쓴다
export { awayFacilities, awayFanShare } from '../../game/gate';

export interface TripInfo {
  home: boolean;
  oppId: string;
  len: number; // 이 연전의 길이
  no: number; // 그중 몇 차전 (1-based)
  toHome: number; // 원정일 때: 다음 홈경기까지 남은 경기 수 (오늘 포함). 일정 끝까지 원정이면 남은 경기 수
}

/** 정규시즌 day 의 경기가 몇 연전의 몇 차전인지, 원정이면 귀항까지 몇 경기인지 */
export function tripInfo(s: Pick<Core, 'schedule' | 'userId'>, day: number): TripInfo | null {
  const at = (d: number) => {
    const m = s.schedule[d]?.find((x) => x.homeId === s.userId || x.awayId === s.userId);
    if (!m) return null;
    const home = m.homeId === s.userId;
    return { home, oppId: home ? m.awayId : m.homeId };
  };
  const cur = at(day);
  if (!cur) return null;
  const same = (d: number) => {
    const o = at(d);
    return !!o && o.home === cur.home && o.oppId === cur.oppId;
  };
  let a = day;
  while (a > 0 && same(a - 1)) a--;
  let b = day;
  while (same(b + 1)) b++;
  let toHome = 0;
  if (!cur.home) {
    let d = day;
    while (at(d) && !at(d)!.home) d++;
    toHome = d - day;
  }
  return { ...cur, len: b - a + 1, no: day - a + 1, toHome };
}
