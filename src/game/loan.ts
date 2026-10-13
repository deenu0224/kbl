// 대출 규칙 (잎 모듈: 타입만 가져온다 — projects.ts 가 economy.ts 를 거치지 않고 쓸 수 있게)
import type { Core, Ledger } from './types';

export const LOAN_LIMIT = 500000; // 50억: 대출 한도의 바닥 (실제 한도는 loanLimit — 구단 규모에 따라 커진다)
export const LOAN_REV_SHARE = 0.5; // 한도 = 직전 시즌 매출(입장+매점+굿즈+분배금) × 이 값 (바닥 LOAN_LIMIT)
export const LOAN_STEP = 50000; // 5억
export const LOAN_RATE = 0.08; // 연이율: 한도의 LOAN_TIER 까지
export const LOAN_RATE_HI = 0.12; // 연이율: 그 초과분
export const LOAN_TIER = 0.5;
export const LOAN_WARN = 0.5; // 부채가 한도의 이 비율 이상이면 할 일·브리핑에 올린다
export const LOAN_DANGER = 0.8; // 이 비율 이상이면 재무 화면 상단 빨강
export const OVER_LIMIT_ERR = '부채가 한도를 넘었습니다 — 선수 매각으로 부채를 줄이세요';
export const DEBT_SALE_RATE = 0.6; // 한도 초과 매각 카드: 매각 대금 = 시장 연봉 × 이 값
export const BAILOUT_TRUST = 15; // 조합 특별 출자: 지지 −15, 부채를 한도까지 탕감 (시즌 1회)
export const DEBT_OVER_TRUST = 8; // 한도 초과로 결산: 지지 −8
export const DEBT_OVER_TRUST2 = 30; // 두 시즌 연속 한도 초과로 결산: 지지 −30

/** 대출 한도: 구단 규모(직전 시즌 매출)에 맞춘다. 첫 시즌은 바닥(50억) */
export function loanLimit(core: Pick<Core, 'campaign'>): number {
  return Math.max(LOAN_LIMIT, Math.round(((core.campaign?.prevRevenue ?? 0) * LOAN_REV_SHARE) / 1000) * 1000);
}
/** 시즌당 이자(구간별): 한도의 50% 까지 연 8%, 초과분 연 12% */
export function loanInterest(core: Pick<Core, 'campaign'>, debt: number): number {
  const tier = loanLimit(core) * LOAN_TIER;
  const d = Math.max(0, debt);
  return Math.min(d, tier) * LOAN_RATE + Math.max(0, d - tier) * LOAN_RATE_HI;
}
/** 부채가 한도를 넘었다: 영입·투자·대출이 막히고 매각 카드가 온다 */
export function overLimit(core: Pick<Core, 'campaign' | 'finance'>): boolean {
  return core.finance.debt > loanLimit(core);
}
/** 매출: 입장 + 매점 + 굿즈 + 분배금 */
export function revenueOf(l: Ledger): number {
  return l.ticket + l.food + l.merch + l.league;
}
