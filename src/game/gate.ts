// 입장 수입 나누기 (KBO 규정: 홈 72 : 원정 28). 순수 함수만 — 난수도, core 변경도 없다.
//
//  · 홈경기: 유저가 받는 입장 수입 = 관중 × 표값 × HOME_GATE (나머지는 원정팀 몫). 매점·굿즈는 그대로 홈 100%.
//  · 원정경기: 유저가 받는 몫 = 상대 홈 구장의 그 경기 입장 수입 × AWAY_GATE.
//    상대 구장의 입장 수입은 엔진에 없으므로 결정적인 모델로 추정한다(난수를 뽑지 않는다 — 경기 결과·난수 소비 불변):
//      관중 = 좌석(awayFacilities 의 관중석 단계) × 점유율
//      점유율 = (AWAY_FILL_BASE + AWAY_FILL_POP × 상대 인기) × 순위 계수 × 요일 계수 × 날씨 평균 × (1 + 우리 원정 응원단 × AWAY_FAN_PULL), 상한 1
//      표값 = 리그 기본 표값(START_PRICE). 포스트시즌은 수요·가격 배율을 곱한다
import type { Core, Facilities } from './types';
import { DOW_MULT, SEAT_LV, WEATHER_MULT } from './economy';
import { START_PRICE, teamDef } from './generate';
import { leagueSize } from './league';

export const HOME_GATE = 0.72;
export const AWAY_GATE = 1 - HOME_GATE;
export const AWAY_FILL_BASE = 0.3;
export const AWAY_FILL_POP = 0.45;
export const AWAY_RANK_SPREAD = 0.2; // 1위 ×1.1 ~ 꼴찌 ×0.9
export const AWAY_FAN_PULL = 0.5; // 우리 원정 응원단 몫의 절반만큼 상대 관중이 는다
// 원정 날씨는 뽑지 않는다: 맑음 60 · 흐림 25 · 비 15(상대 구장은 지붕 있는 셈 치지 않는다)의 평균.
// 함수로 둔다 — economy.ts 와 순환 import 라 모듈 로드 시점에는 WEATHER_MULT 가 아직 없을 수 있다
export const awayWeather = (): number => 0.6 * WEATHER_MULT.sunny + 0.25 * WEATHER_MULT.cloudy + 0.15 * WEATHER_MULT.rain;

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
  const tier = teamDef(teamId)?.tier ?? 57;
  const seats = tier >= 61 ? 4 : tier >= 58 ? 3 : 2;
  return { seats, food: seats - 1, training: seats - 1 };
}

export interface AwayGate {
  attendance: number; // 상대 구장 관중 (추정)
  gross: number; // 상대 구장 입장 수입 (만원)
  share: number; // 우리 몫 = gross × AWAY_GATE
}

/**
 * 원정 경기 상대 구장의 입장 수입 추정. oppRank = 경기 전 상대 순위(1-based), dow = 0(화)~5(일).
 * mult = 포스트시즌 배율 (demand = 관중 수요, price = 정산 가격)
 */
export function awayGate(core: Pick<Core, 'teams' | 'fans'>, oppId: string, oppRank: number, dow: number, mult: { demand?: number; price?: number } = {}): AwayGate {
  const cap = SEAT_LV[awayFacilities(oppId).seats].cap;
  const pop = core.teams.find((t) => t.id === oppId)?.pop ?? teamDef(oppId)?.pop ?? 0.6;
  const n = Math.max(2, leagueSize(core));
  const rankF = 1 + AWAY_RANK_SPREAD * (0.5 - (Math.min(n, Math.max(1, oppRank)) - 1) / (n - 1));
  const fill = (AWAY_FILL_BASE + AWAY_FILL_POP * pop) * rankF * DOW_MULT[dow % DOW_MULT.length] * awayWeather() * (1 + awayFanShare(core.fans) * AWAY_FAN_PULL) * (mult.demand ?? 1);
  const attendance = Math.round(cap * Math.min(1, fill));
  const gross = Math.round(attendance * START_PRICE * (mult.price ?? 1));
  return { attendance, gross, share: Math.round(gross * AWAY_GATE) };
}
