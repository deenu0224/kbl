import type { Core, Facilities } from '../../game/types';
import { TEAM_DEFS } from '../../game/generate';

/**
 * 원정 응원단 크기 (0~1, 관중석에서 차지하는 몫).
 * 팬 수에 완만하게 비례: 팬 5천 → 0.03, 3만 → 0.2 (그 사이는 직선), 상한 0.3.
 *   share = clamp(0.03 + (fans − 5000) × 0.17 / 25000, 0.01, 0.3)
 */
export function awayFanShare(fans: number): number {
  const v = 0.03 + ((fans - 5000) * 0.17) / 25000;
  return Math.max(0.01, Math.min(0.3, v));
}

/** 상대 구장의 시설 단계: 구단 전력 tier 에서 유도한 고정값 (관중석 2~4) */
export function awayFacilities(teamId: string): Facilities {
  const tier = TEAM_DEFS.find((d) => d.id === teamId)?.tier ?? 57;
  const seats = tier >= 61 ? 4 : tier >= 58 ? 3 : 2;
  return { seats, food: seats - 1, training: seats - 1 };
}

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
