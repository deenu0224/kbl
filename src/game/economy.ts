import type { Core, Facilities, FacilityKind, Ledger, Player, Team, Weather } from './types';
import { clamp } from './rng';
import { GAMES } from './schedule';
import { activeBuffs } from './campaign';

// ── 시설 단계 (cost = 그 단계로 올리는 비용, upkeep = 만원/경기) ──
export const SEAT_LV: { cap: number; cost: number; upkeep: number; name: string; desc: string }[] = [
  { cap: 6000, cost: 0, upkeep: 300, name: '동네 야구장', desc: '6,000석 · 낡은 내야 스탠드' },
  { cap: 9000, cost: 100000, upkeep: 420, name: '확장 내야석', desc: '9,000석 · 내야 스탠드 확장' },
  { cap: 13000, cost: 220000, upkeep: 580, name: '지붕 스탠드', desc: '13,000석 · 지붕 덮인 내야석' },
  { cap: 18000, cost: 400000, upkeep: 800, name: '외야석 개장', desc: '18,000석 · 외야 관중석 신설' },
  { cap: 24000, cost: 700000, upkeep: 1100, name: '2층 스타디움', desc: '24,000석 · 복층 대형 구장' },
];

export const FOOD_LV: { spend: number; sat: number; cost: number; upkeep: number; name: string; desc: string }[] = [
  { spend: 0.22, sat: 0, cost: 0, upkeep: 80, name: '포장마차', desc: '객단가 2,200원 · 어묵과 컵라면' },
  { spend: 0.38, sat: 4, cost: 35000, upkeep: 150, name: '간이 매점', desc: '객단가 3,800원 · 만족도 +4' },
  { spend: 0.58, sat: 8, cost: 80000, upkeep: 260, name: '차양 매장', desc: '객단가 5,800원 · 만족도 +8' },
  { spend: 0.82, sat: 12, cost: 160000, upkeep: 420, name: '파라솔 푸드코트', desc: '객단가 8,200원 · 만족도 +12' },
  { spend: 1.1, sat: 16, cost: 300000, upkeep: 650, name: '네온 푸드홀', desc: '객단가 11,000원 · 만족도 +16' },
];

export const TRAIN_LV: { grow: number; inj: number; cost: number; upkeep: number; name: string; desc: string }[] = [
  { grow: 0.04, inj: 1.0, cost: 0, upkeep: 0, name: '공터', desc: '훈련 시설 없음' },
  { grow: 0.1, inj: 0.9, cost: 40000, upkeep: 120, name: '배팅 케이지', desc: '주간 성장 10% · 부상 -10%' },
  { grow: 0.16, inj: 0.8, cost: 90000, upkeep: 240, name: '불펜 마운드', desc: '주간 성장 16% · 부상 -20%' },
  { grow: 0.23, inj: 0.65, cost: 180000, upkeep: 420, name: '실내 훈련장', desc: '주간 성장 23% · 부상 -35%' },
  { grow: 0.31, inj: 0.5, cost: 350000, upkeep: 700, name: '퍼포먼스 센터', desc: '주간 성장 31% · 부상 -50%' },
];

export const LOAN_LIMIT = 500000; // 50억
export const LOAN_STEP = 50000; // 5억
export const LOAN_RATE = 0.08; // 연이율
export const ROSTER_MAX = 28;
export const MIN_BATTERS = 10;
export const MIN_PITCHERS = 8;

// ── 수요·수입 밸런스 상수 ──
export const DEMAND_K = 0.79; // 팬층 대비 기본 내장률
export const PRICE_ELASTICITY = 1.3;
export const DOW_MULT = [1, 1, 1, 1.1, 1.3, 1.25]; // 화 수 목 금 토 일
export const WEATHER_MULT: Record<Weather, number> = { sunny: 1, cloudy: 0.95, rain: 0.6 };
export const STAR_BASE = 0.8; // 스타 계수 = STAR_BASE + (상위 3명 star 합) / STAR_DIV
export const STAR_DIV = 340;
export const OPS_COST = 1050; // 구단 운영비 (만원/경기)
export const LEAGUE_BASE = 2020; // 리그 분배금·스폰서 기본 (만원/경기)
export const LEAGUE_PER_FAN = 0.04;
export const LEAGUE_PER_RANK = 45; // 순위 한 계단당
export const MERCH_K = 0.03; // 팬 1명 × 스타합/100 당 (만원/경기)
export const RAIN_FOOD = 0.8;
export const SIGN_BONUS_RATE = 0.25;
export const RELEASE_RATE = 0.2;
export const FORCED_SALE_RATE = 0.5;

const LEVELS: Record<FacilityKind, { cost: number }[]> = { seats: SEAT_LV, food: FOOD_LV, training: TRAIN_LV };

/** 적정 티켓가(만원). 구장이 좋아질수록 더 받을 수 있다. */
export function refPrice(f: Facilities): number {
  return Math.round((1.1 + f.seats * 0.12 + f.food * 0.06) * 100) / 100;
}

export function payroll(t: Team): number {
  return t.roster.reduce((s, p) => s + p.salary, 0);
}

export function signingBonus(p: Player): number {
  return Math.round(p.salary * SIGN_BONUS_RATE);
}

export function releaseCost(p: Player, core: Core): number {
  const total = core.schedule.length || GAMES;
  const remain = clamp((total - core.day) / total, 0, 1);
  return Math.round(p.salary * remain * RELEASE_RATE);
}

/** 버프 반영 수용 인원 */
export function capacityOf(core: Core): number {
  return Math.round(SEAT_LV[core.facilities.seats].cap * activeBuffs(core).capacity);
}

export function upgradeCost(kind: FacilityKind, f: Facilities): number | null {
  const next = LEVELS[kind][f[kind] + 1];
  return next ? next.cost : null;
}

/** 간판 선수 상위 3명의 스타성 합 */
export function starPower(t: Team): number {
  return t.roster
    .map((p) => p.star)
    .sort((a, b) => b - a)
    .slice(0, 3)
    .reduce((s, v) => s + v, 0);
}

export function userTeam(core: Core): Team {
  const t = core.teams.find((x) => x.id === core.userId);
  if (!t) throw new Error('유저 구단을 찾을 수 없습니다');
  return t;
}

export interface DemandCtx {
  dow: number; // 0=화 … 5=일
  weather: Weather;
  oppPop: number;
  noise: number; // 1 = 노이즈 없음
  mult?: number; // 추가 배율 (포스트시즌 열기 등)
}

/** 홈경기 관중 수요 (수용 인원과 무관한 "오고 싶어한" 인원). 이벤트 버프(수요·체감 가격)를 반영한다. */
export function calcDemand(core: Core, c: DemandCtx): number {
  const fx = activeBuffs(core);
  const t = userTeam(core);
  const l10 = t.rec.last10;
  const pct = l10.length ? l10.reduce((s, v) => s + v, 0) / l10.length : 0.5;
  let perf = 0.75 + 0.5 * pct;
  if (t.rec.streak >= 3) perf *= 1 + 0.02 * Math.min(t.rec.streak, 6);
  const star = STAR_BASE + starPower(t) / STAR_DIV;
  const opp = 0.9 + 0.26 * clamp(c.oppPop, 0, 1);
  const price = clamp(Math.pow(refPrice(core.facilities) / Math.max(0.1, core.finance.ticketPrice * fx.price), PRICE_ELASTICITY), 0.2, 2.5);
  const sat = 0.8 + core.fanSat / 250;
  const v = core.fans * DEMAND_K * perf * star * opp * DOW_MULT[c.dow % 6] * WEATHER_MULT[c.weather] * price * sat * c.noise * fx.demand * (c.mult ?? 1);
  return Math.max(0, Math.round(v));
}

/** 현재 조건(평일·맑음·평균 인기 상대)의 예상 관중 수요 */
export function previewDemand(core: Core): number {
  const others = core.teams.filter((t) => t.id !== core.userId);
  const oppPop = others.length ? others.reduce((s, t) => s + t.pop, 0) / others.length : 0.7;
  return calcDemand(core, { dow: 0, weather: 'sunny', oppPop, noise: 1 });
}

/** 영업 손익 (시설 투자 제외) */
export function opProfit(l: Ledger): number {
  return l.ticket + l.food + l.merch + l.league + l.sales - l.salary - l.upkeep - l.interest - l.signing;
}
