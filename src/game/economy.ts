import type { Core, Facilities, FacilityKind, Ledger, Player, Team, Weather } from './types';
import { clamp } from './rng';
import { BASE_TEAMS, dayAt, leagueSize, rankUnits, seasonGames } from './league';
import { activeBuffs } from './campaign';
import { isFranchise } from './franchise';
import { projectFx } from './projects';

// ── 시설 단계 (cost = 그 단계로 올리는 비용, upkeep = 만원/경기) ──
export const SEAT_LV: { cap: number; cost: number; upkeep: number; name: string; desc: string }[] = [
  { cap: 6000, cost: 0, upkeep: 300, name: '동네 야구장', desc: '6,000석 · 낡은 내야 스탠드' },
  { cap: 9000, cost: 100000, upkeep: 460, name: '확장 내야석', desc: '9,000석 · 내야 스탠드 확장' },
  { cap: 13000, cost: 220000, upkeep: 900, name: '지붕 스탠드', desc: '13,000석 · 지붕 덮인 내야석 (비 오는 날에도 덜 빠진다)' },
  { cap: 18000, cost: 450000, upkeep: 1800, name: '외야석 개장', desc: '18,000석 · 외야 관중석 신설' },
  { cap: 24000, cost: 850000, upkeep: 3500, name: '2층 스타디움', desc: '24,000석 · 복층 대형 구장' },
];

export const FOOD_LV: { spend: number; sat: number; cost: number; upkeep: number; name: string; desc: string }[] = [
  { spend: 0.22, sat: 0, cost: 0, upkeep: 80, name: '포장마차', desc: '1인당 매점 지출 2,200원 · 어묵과 컵라면' },
  { spend: 0.32, sat: 4, cost: 35000, upkeep: 170, name: '간이 매점', desc: '1인당 매점 지출 3,200원 · 만족도 +4' },
  { spend: 0.4, sat: 8, cost: 80000, upkeep: 340, name: '차양 매장', desc: '1인당 매점 지출 4,000원 · 만족도 +8' },
  { spend: 0.48, sat: 12, cost: 160000, upkeep: 600, name: '파라솔 푸드코트', desc: '1인당 매점 지출 4,800원 · 만족도 +12' },
  { spend: 0.56, sat: 16, cost: 380000, upkeep: 1000, name: '네온 푸드홀', desc: '1인당 매점 지출 5,600원 · 만족도 +16 · 비가 와도 매출 유지' },
];

export const TRAIN_LV: { grow: number; inj: number; cost: number; upkeep: number; name: string; desc: string }[] = [
  { grow: 0.04, inj: 1.0, cost: 0, upkeep: 0, name: '공터', desc: '훈련 시설 없음' },
  { grow: 0.12, inj: 0.9, cost: 40000, upkeep: 120, name: '배팅 케이지', desc: '주간 성장 12% · 부상 -10%' },
  { grow: 0.2, inj: 0.8, cost: 90000, upkeep: 280, name: '불펜 마운드', desc: '주간 성장 20% · 부상 -20%' },
  { grow: 0.28, inj: 0.65, cost: 180000, upkeep: 550, name: '실내 훈련장', desc: '주간 성장 28% · 부상 -35%' },
  { grow: 0.36, inj: 0.5, cost: 450000, upkeep: 1000, name: '퍼포먼스 센터', desc: '주간 성장 36% · 부상 -50%' },
];

export * from './loan';
export const ROSTER_MAX = 28; // 1군 등록 정원
// 아래 두 마감은 84경기 기준값이다. 실제 마감일은 tradeDeadline(core)·regDeadline(core) — 시즌 길이에 비례한다 (league.ts dayAt)
export const TRADE_DEADLINE = 54; // 트레이드 마감: 이 경기 수를 치른 뒤에는 트레이드 제안·시장 등록 불가 (스토브리그에 다시 열린다)
export const DEADLINE_WARN = 6; // 마감 이 경기 전부터 일정표 예보·할 일에 올린다
export const REG_DEADLINE = 72; // 선수 등록 마감: 이 경기 수를 치른 뒤와 포스트시즌에는 외부 영입 불가 (1군·2군 이동은 가능)

type Cal = Pick<Core, 'phase' | 'day' | 'schedule'>;
/** 이 리그의 트레이드 마감일 (84경기 리그 54, 81경기 리그 52) */
export const tradeDeadline = (core: { schedule: unknown[] }): number => dayAt(core, TRADE_DEADLINE);
/** 이 리그의 선수 등록 마감일 (84경기 리그 72, 81경기 리그 69) */
export const regDeadline = (core: { schedule: unknown[] }): number => dayAt(core, REG_DEADLINE);
/** 지금 외부 영입(FA·트레이드)이 가능한가. 스토브리그(결산~드래프트)에는 다시 열린다 */
export function signingOpen(core: Cal): boolean {
  if (core.phase === 'post') return false;
  if (core.phase === 'season') return core.day < regDeadline(core);
  return true;
}
/** 외부 영입이 닫힌 사유 (열려 있으면 null) */
export function signingClosedWhy(core: Cal): string | null {
  if (signingOpen(core)) return null;
  return core.phase === 'post' ? '포스트시즌 — 선수 등록 마감 (스토브리그에 다시 열립니다)' : `선수 등록 마감 (${regDeadline(core)}경기) — 스토브리그에 다시 열립니다`;
}
/** 트레이드 시장에 선수를 내놓을 수 없는 사유 (열려 있으면 null). 마감 전과 스토브리그에는 열려 있다 */
export function blockClosedWhy(core: Cal): string | null {
  if (core.phase === 'post') return '포스트시즌 — 트레이드 마감 (스토브리그에 다시 열립니다)';
  if (core.phase === 'season' && core.day >= tradeDeadline(core)) return `트레이드 마감 (${tradeDeadline(core)}경기) — 스토브리그에 다시 열립니다`;
  return null;
}
export interface Deadline {
  id: 'trade' | 'reg';
  day: number;
  left: number; // 남은 경기 수
  label: string;
  icon: string;
}
/** 다가온 마감 (정규시즌, 마감 DEADLINE_WARN 경기 전부터 마감 전까지). 일정표 예보와 할 일이 같이 쓴다 */
export function deadlinesSoon(core: Cal): Deadline[] {
  if (core.phase !== 'season') return [];
  const all: Deadline[] = [
    { id: 'trade', day: tradeDeadline(core), left: tradeDeadline(core) - core.day, label: '트레이드 마감', icon: '🔄' },
    { id: 'reg', day: regDeadline(core), left: regDeadline(core) - core.day, label: '선수 등록 마감', icon: '📋' },
  ];
  return all.filter((d) => d.left > 0 && d.left <= DEADLINE_WARN);
}
export const FARM_MAX = 20; // 2군(퓨처스) 정원 (기본. 실제 정원은 farmMax — 육성 아카데미가 있으면 FARM_MAX_ACADEMY)
export const FARM_MAX_ACADEMY = 25;
/** 2군 정원: 육성 아카데미가 있으면 25명 */
export function farmMax(core: Partial<Pick<Core, 'campaign'>>): number {
  return (core.campaign?.projects?.academy ?? 0) > 0 ? FARM_MAX_ACADEMY : FARM_MAX;
}
export const FARM_CAP = 64; // 2군에서는 이 OVR 까지만 자란다 (그 위는 1군에서만)
export const FARM_GROW = 2.2; // 2군의 주간 성장 확률 = 훈련장 확률 × 이 값
export const FARM_GROW_MIN = 0.25; // 훈련장이 없어도 2군은 실전으로 이만큼은 자란다
export const BENCH_GROW = 0.5; // 1군 벤치의 25세 이하: 안 쓰면 썩는다
export const FARM_LOCK = 10; // 2군으로 내린 뒤 재등록까지 걸리는 경기 수
export const FARM_UPKEEP = 12; // 2군 운영비 (만원/경기 · 선수 1명당. 20명이면 시즌 약 2억)
// 보유 기간(서비스 타임): 유저 팀의 드래프트 출신은 입단 후 SVC_YEARS 시즌 동안 연봉 = 시장가 × SVC_RATE[n년차−1] (0 = 최저연봉). 그 뒤 FA 자격
export const SVC_YEARS = 6;
export const SVC_RATE = [0, 0.25, 0.4, 0.55, 0.7, 0.85];
export const RESIGN_ASK_MAX = 0.15; // FA 자격 재계약 요구: 시장가 × (1 ~ 1 + 이 값), 스타성이 높을수록 많이 부른다
export const RESIGN_LEAVE_FANS = 8; // 프랜차이즈 스타를 FA 로 보내면 팬 − star × 이 값, 만족도 RESIGN_LEAVE_SAT
export const RESIGN_LEAVE_SAT = -8;
// 감사용 스위치 (scripts/economy.ts 가 하나씩 끄고 재실행한다. 게임에서는 전부 켜 둔다)
export const AUDIT = { benchHalf: true, farmBatBig: true, svc: true, penGrow: true, farmUpkeep: -1 };
// 경쟁균형세(샐러리캡 · KBO 규정): 연봉 총액이 상한(리그 연봉 상위 3구단 평균 × capRate)을 넘으면 초과분 × rate 를 시즌 말 제재금으로 낸다.
// 8구단 리그는 꺼 둔다 (LUX_TAX_ON. 스크립트는 환경 변수 LUX=1 로 LUX_TAX.on 을 켜고 잰다).
// 구단이 8개보다 많은 리그는 LUX_TAX_BIG 으로 켠다 (docs/TEN_TEAMS.md 5단계): 상한은 "우리 구단을 뺀" 상위 3구단 평균 — 우리 연봉이 상한을 끌어올리지 않게
export const LUX_TAX_ON = false;
export const LUX_TAX = { on: LUX_TAX_ON, top: 3, capRate: 1.2, rate: 0.5 };
export const LUX_TAX_BIG = { on: true, top: 3, capRate: 1.15, rate: 0.5, keep: true };
export interface LuxTax { cap: number; payroll: number; tax: number; on?: boolean }
/** 이 리그에 경쟁균형세가 있는가 */
export function luxOn(core: Pick<Core, 'teams'>): boolean {
  return leagueSize(core) > BASE_TEAMS ? LUX_TAX_BIG.on : LUX_TAX.on;
}
/** 상한을 정하는 규칙 한 줄 ("우리를 뺀 리그 상위 3구단 평균의 120%") */
export function luxRule(core: Pick<Core, 'teams'>): string {
  const big = leagueSize(core) > BASE_TEAMS;
  const k = big ? LUX_TAX_BIG : LUX_TAX;
  return `${big ? '우리를 뺀 ' : ''}리그 연봉 상위 ${k.top}구단 평균의 ${Math.round(k.capRate * 100)}%`;
}
/** 경쟁균형세: 상한 · 유저 연봉 총액 · 낼 제재금 (꺼져 있으면 tax 0). add = 가정한 연봉 증가분(영입·재계약 미리 보기) */
export function luxTax(core: Pick<Core, 'teams' | 'userId'> & Partial<Pick<Core, 'campaign'>>, add = 0): LuxTax {
  const big = leagueSize(core) > BASE_TEAMS;
  const k = big ? LUX_TAX_BIG : LUX_TAX;
  const pays = core.teams.filter((t) => !big || t.id !== core.userId).map(payroll).sort((a, b) => b - a).slice(0, k.top);
  // 10구단 리그의 상한은 내려가지 않는다 (campaign.luxCap = 지난 결산까지의 최고 상한) — 후반에 다른 구단 연봉이 줄어도 상한이 따라 내려가지 않게
  const cap = Math.max(Math.round(((pays.reduce((s, v) => s + v, 0) / Math.max(1, pays.length)) * k.capRate) / 100) * 100, big && LUX_TAX_BIG.keep ? core.campaign?.luxCap ?? 0 : 0);
  const mine = payroll(core.teams.find((t) => t.id === core.userId) ?? { roster: [] } as unknown as Team) + add;
  return { cap, payroll: mine, tax: k.on ? Math.round((Math.max(0, mine - cap) * k.rate) / 100) * 100 : 0, on: k.on };
}
export const MIN_BATTERS = 10;
export const MIN_PITCHERS = 8;

// ── 수요·수입 밸런스 상수 ──
export const DEMAND_K = 0.83; // 팬층 대비 기본 내장률
export const PRICE_ELASTICITY = 1.3;
export const PRICE_ELASTICITY_OVER = 2.0; // 적정가보다 비싼 표는 더 가파르게 빠진다
export const DOW_MULT = [1, 1, 1, 1.1, 1.3, 1.25]; // 화 수 목 금 토 일
export const WEATHER_MULT: Record<Weather, number> = { sunny: 1, cloudy: 0.95, rain: 0.6 }; // rain = 지붕 없는 구장
export const RAIN_ROOF = 0.85; // 지붕(관중석 Lv3+) 있는 구장의 비 오는 날 수요
export const ROOF_SEATS = 2; // facilities.seats 가 이 값 이상이면 지붕
export const RAIN_PRICE_EXP = 0.9; // 비 오는 날은 적정가보다 비싼 표가 더 빠진다
export const LOYAL_BASE = 0.35; // 충성 팬: 성적 계수와 무관하게 오는 비율
export const LOYAL_MAX = 0.5;
export const LOYAL_PER_FAN = 1 / 150000; // 팬 1명당 충성 비율 증가 (START_FANS 초과분)
export const LOYAL_PER_SEASON = 0.012;
export const LOYAL_FAN_REF = 5200;
export const OPENING_GAMES = 3; // 개막 효과: 시즌 첫 홈 3연전
export const OPENING_MULT = 1.15;
export const FRANCHISE_MULT = 1.3; // 프랜차이즈 스타의 팬 효과
export const STAR_BASE = 0.8; // 스타 계수 = STAR_BASE + (상위 3명 star 합) / STAR_DIV
export const STAR_DIV = 420;
export const OPS_COST = 1050; // 구단 운영비 기본 (만원/경기)
export const OPS_FAN2 = 1.8e-5; // 팬 규모에 따라 커지는 운영비: (팬 − OPS_FAN_FREE)² × 이 값 (만원/경기) — 프런트·안전·홍보 인력. 큰 구단일수록 가파르다
export const OPS_FAN_FREE = 5200;
export const OPS_FAN_CAP = 24000; // 운영비가 따라 커지는 팬 규모의 상한 (최대 구장 24,000석 — 자리가 없는 팬까지 프런트가 커지지는 않는다). 없으면 팬 3만에서 운영비만 시즌 100억
export const SALARY_INFLATION = 0.07; // 리그 연봉 인플레 (시즌당, 스타급일수록 크게 — season.ts develop)
export const SALARY_INFLATION_MAX = 0.8;
// 재계약 프리미엄: 가을야구를 한 팀의 선수는 비싸진다. 최근 RENEW_SEASONS 시즌의 성적별 가산을 더한다 (유저 구단 연봉에만)
export const RENEW_PREMIUM: Record<string, number> = { none: 0, WC: 0.02, SPO: 0.03, PO: 0.05, KS: 0.08, champion: 0.1 };
export const RENEW_SEASONS = 2; // 3시즌 합산(최대 +36%)은 왕조 팀의 연봉을 시즌마다 40억씩 올렸다 — 2시즌(최대 +20%)
export const LEAGUE_BASE = 2400; // 리그 분배금·스폰서 기본 (만원/경기)
export const LEAGUE_PER_FAN = 0.04;
export const LEAGUE_PER_RANK = 45; // 순위 한 계단당
// 구단이 8개보다 많은 리그의 분배: 균등 몫이 크고 팬 비례 몫이 작다 (docs/TEN_TEAMS.md 3단계).
// 팬 5,000 에서 경기당 +200(시즌 +1.7억 — 개막 오더만 고친 무개입의 손익을 +8억 위로), 팬 25,000 에서 8구단과 같아지고 그 위로는 적다
export const LEAGUE_BASE_BIG = 2650;
export const LEAGUE_PER_FAN_BIG = 0.03;

/** 리그 분배금·스폰서: 84경기 기준 경기당 금액 (만원). 정산에서는 perGame·징계 배율을 곱한다 */
export function leagueShare(core: Pick<Core, 'teams' | 'fans'>, rank: number): number {
  const big = leagueSize(core) > BASE_TEAMS;
  return (big ? LEAGUE_BASE_BIG : LEAGUE_BASE) + core.fans * (big ? LEAGUE_PER_FAN_BIG : LEAGUE_PER_FAN) + rankUnits(core, rank) * LEAGUE_PER_RANK;
}
export const MERCH_K = 0.03; // 팬 1명 × 스타합/100 당 (만원/경기)
export const RAIN_FOOD = 0.8;
export const SIGN_BONUS_RATE = 0.25;
export const RELEASE_RATE = 0.2;
export const FORCED_SALE_RATE = 0.5;

const LEVELS: Record<FacilityKind, { cost: number }[]> = { seats: SEAT_LV, food: FOOD_LV, training: TRAIN_LV };

/** 적정 티켓가(만원). 구장이 좋아질수록 더 받을 수 있다. */
export function refPrice(f: Facilities, core?: Pick<Core, 'campaign' | 'season'>): number {
  return Math.round((1.1 + f.seats * 0.03 + f.food * 0.03 + (core ? projectFx(core).refPrice : 0)) * 100) / 100;
}

/** 1군 등록 선수 (경기에 관한 모든 것은 이 명단만 본다) */
export function activeRoster(t: Team): Player[] {
  return t.roster.some((p) => p.farm) ? t.roster.filter((p) => !p.farm) : t.roster;
}

/** 2군(퓨처스) 선수. 부상자 명단(재활)은 세지 않는다 — rehabRoster */
export function farmRoster(t: Team): Player[] {
  return t.roster.filter((p) => p.farm && !p.il);
}

export const IL_MIN = 10; // 부상자 명단: 말소 뒤 최소 이 경기 수는 복귀할 수 없다 (KBO 부상자 명단 10일)
export const IL_AUTO = 10; // 자동 운영: 이 경기 수 이상 결장하는 부상이면 그날 말소한다
export const IL_AUTO_BAN = 20; // 자동 운영: 징계는 이 경기 수 이상일 때

/** 부상자 명단(재활 중): 부상·징계로 말소된 선수. 1군 정원에도 2군 정원에도 들지 않는다 */
export function rehabRoster(t: Team): Player[] {
  return t.roster.filter((p) => p.farm && p.il);
}

/** 2군 운영비 (만원/경기) */
export function farmUpkeep(t: Team): number {
  return farmRoster(t).length * (AUDIT.farmUpkeep >= 0 ? AUDIT.farmUpkeep : FARM_UPKEEP);
}

/** 2군의 주간 성장 확률 */
export function farmGrow(f: Facilities): number {
  return Math.min(1, Math.max(FARM_GROW_MIN, TRAIN_LV[f.training].grow * FARM_GROW));
}

export function payroll(t: Team): number {
  return t.roster.reduce((s, p) => s + p.salary, 0);
}

export function signingBonus(p: Player): number {
  return Math.round(p.salary * SIGN_BONUS_RATE);
}

export function releaseCost(p: Player, core: Core): number {
  const total = seasonGames(core);
  const remain = clamp((total - core.day) / total, 0, 1);
  return Math.round(p.salary * remain * RELEASE_RATE);
}

/** 버프 반영 수용 인원 */
export function capacityOf(core: Core): number {
  const pj = projectFx(core);
  return Math.round((SEAT_LV[core.facilities.seats].cap + pj.seats) * pj.capMult * activeBuffs(core).capacity);
}

export function upgradeCost(kind: FacilityKind, f: Facilities): number | null {
  const next = LEVELS[kind][f[kind] + 1];
  return next ? next.cost : null;
}

/** 구단 운영비 (만원/경기). 팬 규모가 커질수록 프런트가 커진다 */
export function opsCost(core: Pick<Core, 'fans'>): number {
  const over = Math.max(0, Math.min(core.fans, OPS_FAN_CAP) - OPS_FAN_FREE);
  return Math.round(OPS_COST + over * over * OPS_FAN2);
}

/** 연봉 인플레 배율 (시즌 1 = 1.0) */
export function salaryInflation(season: number): number {
  return 1 + Math.min(SALARY_INFLATION_MAX, Math.max(0, season - 1) * SALARY_INFLATION);
}

/** 충성 팬 비율: 져도 오는 팬. 팬 규모와 시즌 수에 따라 자란다 */
export function loyalShare(core: Pick<Core, 'fans' | 'season'>): number {
  return clamp(LOYAL_BASE + Math.max(0, core.fans - LOYAL_FAN_REF) * LOYAL_PER_FAN + (core.season - 1) * LOYAL_PER_SEASON, LOYAL_BASE, LOYAL_MAX);
}

export function hasRoof(f: Facilities): boolean {
  return f.seats >= ROOF_SEATS;
}

/** 날씨 수요 계수: 비 × 지붕 × 표값 */
export function weatherMult(core: Pick<Core, 'facilities' | 'finance'> & Partial<Pick<Core, 'campaign' | 'season'>>, weather: Weather, priceMult = 1): number {
  if ((core as Partial<Core>).campaign && projectFx(core as Partial<Core>).noWeather) return 1; // 돔: 날씨 무관
  if (weather !== 'rain') return WEATHER_MULT[weather];
  const base = hasRoof(core.facilities) ? RAIN_ROOF : WEATHER_MULT.rain;
  const over = (core.finance.ticketPrice * priceMult) / refPrice(core.facilities, core as Pick<Core, 'campaign' | 'season'>);
  return base * (over > 1 ? clamp(Math.pow(1 / over, RAIN_PRICE_EXP), 0.5, 1) : 1);
}

/** 비 오는 날 매점 계수 (푸드홀 Lv5 는 감소 없음) */
export function rainFood(f: Facilities, weather: Weather, core?: Pick<Core, 'campaign' | 'season'>): number {
  if (core && projectFx(core).noWeather) return 1;
  return weather === 'rain' && f.food < FOOD_LV.length - 1 ? RAIN_FOOD : 1;
}

/** 간판 선수 상위 3명의 스타성 합. season 을 주면 프랜차이즈 스타(5시즌+ · star 60+)는 ×1.3 */
export function starPower(t: Team, season?: number): number {
  return activeRoster(t)
    .map((p) => (season !== undefined && isFranchise(p, season) ? p.star * FRANCHISE_MULT : p.star))
    .sort((a, b) => b - a)
    .slice(0, 3)
    .reduce((s, v) => s + v, 0);
}

// 원정 응원단: 팬이 많으면 원정에서도 우리 응원석이 찬다 → 상대 홈 이점의 일부를 상쇄
export const AWAY_FAN_MIN = 5000; // 이 팬 수부터 원정 응원단이 생긴다
export const AWAY_FAN_FULL = 30000; // 이 팬 수에서 상한
export const AWAY_SUPPORT_MAX = 0.35; // 상대 홈 이점(SIM.HOME_EDGE)의 최대 35% 상쇄

/** 원정 응원단의 힘: 원정 경기에서 상대 홈 이점을 상쇄하는 비율 (0 ~ AWAY_SUPPORT_MAX, 팬 수에 선형) */
export function awaySupport(core: Pick<Core, 'fans'>): number {
  return clamp((core.fans - AWAY_FAN_MIN) / (AWAY_FAN_FULL - AWAY_FAN_MIN), 0, 1) * AWAY_SUPPORT_MAX;
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
  const loyal = loyalShare(core);
  perf = loyal + (1 - loyal) * perf; // 충성 팬은 성적과 무관하게 온다
  const star = STAR_BASE + starPower(t, core.season) / STAR_DIV;
  const opening = core.phase === 'season' && core.attHistory.length < OPENING_GAMES ? OPENING_MULT : 1;
  const opp = 0.9 + 0.26 * clamp(c.oppPop, 0, 1);
  const ratio = refPrice(core.facilities, core) / Math.max(0.1, core.finance.ticketPrice * fx.price);
  const price = clamp(Math.pow(ratio, ratio < 1 ? PRICE_ELASTICITY_OVER : PRICE_ELASTICITY), 0.2, 2.5);
  const sat = 0.8 + core.fanSat / 250;
  const v = core.fans * DEMAND_K * perf * star * opp * DOW_MULT[c.dow % 6] * weatherMult(core, c.weather, fx.price) * price * sat * c.noise * fx.demand * projectFx(core).demand * opening * (c.mult ?? 1);
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
