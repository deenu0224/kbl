// 자금 예측: "이 페이스면 몇 경기 뒤에 금고가 비는가". 순수 함수만 — 난수도, core 변경도 없다.
//
// 방법
//  · 지출은 현재 조건에서 그대로 계산한다(advanceDay 의 재정 정산과 같은 식): 연봉 총액/경기 수, 시설 유지비(홈만),
//    훈련장 유지비, 구단 운영비, 이자(부채 × 연이율 / 경기 수).
//  · 수입은 "최근 실적 × 현재 가격"으로 잡는다: 최근 홈 6경기(≈ 최근 12경기) 평균 관중 × (티켓값 + 매점 객단가),
//    굿즈·분배금은 현재 팬 수·순위·스타성으로 계산. 홈 3경기를 치르기 전(시즌 초)에는 관중을 previewDemand ×
//    요일·날씨 평균 계수로 대신한다. 입장 수입은 홈 72%, 원정은 그날 상대 구장 입장 수입 추정(gate.ts)의 28%.
//  · 남은 일정을 홈/원정 순서대로 한 경기씩 굴려 현금이 0 아래로 내려가는 경기(cashOut)와, 그 뒤 긴급 대출이 쌓여
//    부채가 한도(loanLimit)를 넘는 경기(forcedSale)를 찾는다. 이자는 불어난 부채에 맞춰 매 경기 구간별로 다시 계산한다.
//  · DayReport.money.net 은 저장되지 않고, cashHistory 의 차분에는 계약금·시설 투자·대출·이벤트 카드가 섞여 있어
//    걸러낼 수 없다. 그래서 차분 대신 위 식을 쓴다.
// 한계
//  · 이벤트 버프(수입 배율·임시 유지비), 이벤트 카드의 일회성 현금, 시즌 결산 보상은 넣지 않는다.
//  · 관중은 최근 평균이 이어진다고 본다 — 연승·연패, 팬 수 증감, 날씨·요일 편차, 가격 변경 직후의 수요 변화는 늦게 반영된다.
//  · 정규시즌 남은 경기까지만 본다(포스트시즌·다음 시즌 연봉 재산정은 예측 밖).
import { leagueMult } from './scandal';
import type { Core, Player } from './types';
import {
  DOW_MULT, FOOD_LV, leagueShare, MERCH_K, MIN_BATTERS, MIN_PITCHERS, RAIN_FOOD, SEAT_LV, TRAIN_LV, WEATHER_MULT,
  capacityOf, debtMood, loanInterest, loanLimit, luxTax, opsCost, payroll, previewDemand, starPower, userTeam,
} from './economy';
import { fmtMoney } from './format';
import { WEEK, rankOf, standings } from './season';
import { HOME_GATE, awayGate } from './gate';
import { perGame, rankUnits } from './league';

export interface Runway {
  perGame: number; // 경기당 평균 손익(만원): 남은 일정(홈/원정)의 평균. 최근 홈 관중 실적 × 현재 가격·연봉·유지비·이자
  cashOut: number | null; // 현금이 0 이 되기까지 남은 경기 수 (흑자이거나 이번 시즌 안에 안 비면 null)
  forcedSale: number | null; // 부채 한도 초과(영입·투자 차단 · 매각 카드)까지 남은 경기 수 (이미 넘었으면 0, 해당 없으면 null)
  seasonEnd: number; // 이 페이스로 시즌 말 예상 현금(부채 차감 전)
}

export const RUNWAY_SHOW = 30; // 이 경기 수 이내일 때만 화면에 띄운다
export const RUNWAY_DANGER = 12; // 빨강 · 조합장이 나선다
export const RUNWAY_STOP = 6; // 일괄 진행이 한 번 멈춘다
const RECENT_HOME = 6; // 최근 홈 6경기 ≈ 최근 12경기
const MIN_HOME = 3;
// 홈 3경기 전: previewDemand(평일·맑음)에 요일 평균 × 날씨 평균을 곱해 평균 홈경기로 환산
const AVG_DOW = DOW_MULT.reduce((s, v) => s + v, 0) / DOW_MULT.length;
const AVG_WEATHER = 0.6 * WEATHER_MULT.sunny + 0.25 * WEATHER_MULT.cloudy + 0.15 * WEATHER_MULT.rain;
const RAIN_P = 0.15;

/** 이자를 뺀 경기당 손익 (홈 / 원정) */
function baseNet(core: Core): { home: number; away: number } {
  const t = userTeam(core);
  const len = core.schedule.length || 1;
  const cap = capacityOf(core);
  const recent = core.attHistory.slice(-RECENT_HOME);
  const att = recent.length >= MIN_HOME ? recent.reduce((s, v) => s + v, 0) / recent.length : Math.min(cap, previewDemand(core) * AVG_DOW * AVG_WEATHER);
  const rank = rankOf(core.teams, core.userId);
  const food = FOOD_LV[core.facilities.food].spend * (core.facilities.food < FOOD_LV.length - 1 ? 1 - RAIN_P * (1 - RAIN_FOOD) : 1);
  const gate = Math.min(cap, att) * (core.finance.ticketPrice * HOME_GATE + food);
  const merch = core.fans * MERCH_K * (starPower(t, core.season) / 100);
  const league = perGame(core, leagueShare(core, rank) * leagueMult(core));
  const fixed = payroll(t) / len + perGame(core, TRAIN_LV[core.facilities.training].upkeep + opsCost(core));
  return {
    home: gate + merch * 1.4 + league - fixed - SEAT_LV[core.facilities.seats].upkeep - FOOD_LV[core.facilities.food].upkeep,
    away: merch * 0.6 + league - fixed,
  };
}

function project(core: Core, d: { cash?: number; perGame?: number; debt?: number }, path?: number[]): Runway {
  const len = core.schedule.length || 1;
  const cash0 = core.finance.cash + (d.cash ?? 0);
  const debt0 = Math.max(0, core.finance.debt + (d.debt ?? 0));
  if (core.phase !== 'season' || core.day >= core.schedule.length) return { perGame: 0, cashOut: null, forcedSale: null, seasonEnd: cash0 };
  const net = baseNet(core);
  const limit = loanLimit(core);
  const add = d.perGame ?? 0;
  let cash = cash0;
  let debt = debt0;
  let sum = 0;
  let cashOut: number | null = null;
  let forcedSale: number | null = debt0 > limit ? 0 : null;
  const left = core.schedule.length - core.day;
  const ranks = new Map(standings(core.teams).map((t, i) => [t.id, i + 1]));
  for (let k = 1; k <= left; k++) {
    const day = core.day + k - 1;
    const g = core.schedule[day].find((x) => x.homeId === core.userId || x.awayId === core.userId);
    const home = !g || g.homeId === core.userId;
    const awayG = g && !home ? awayGate(core, g.homeId, ranks.get(g.homeId) ?? 0, day % WEEK).share : 0;
    const n = (home ? net.home : net.away + awayG) + add - loanInterest(core, debt) / len;
    sum += n;
    cash += n;
    if (cash < 0) {
      if (cashOut === null) cashOut = k;
      debt += -cash;
      cash = 0;
    }
    if (debt > limit && forcedSale === null) forcedSale = k;
    path?.push(Math.round(cash - (debt - debt0)));
  }
  return { perGame: Math.round(sum / left), cashOut, forcedSale, seasonEnd: Math.round(cash0 + sum) };
}

/** 지금 페이스의 자금 예측 */
export function runway(core: Core): Runway {
  return project(core, {});
}

/** 지출·연봉 증가·대출을 가정한 예측. d 는 지금 상태에 더하는 값: 현금(만원), 경기당 손익(만원), 부채(만원) */
export function runwayAfter(core: Core, d: { cash?: number; perGame?: number; debt?: number }): Runway {
  return project(core, d);
}

/** 남은 경기의 예상 현금 경로 (그래프의 점선용). 금고가 빈 뒤에는 새로 쌓이는 긴급 대출만큼 0 아래로 내려간다 */
export function runwayPath(core: Core): number[] {
  const path: number[] = [];
  project(core, {}, path);
  return path;
}

/** 조합에 맡기면 팔릴 선수 (최소 인원을 지키는 선에서 최고 연봉. debt.ts saleCandidates().auto 와 같은 기준) */
export function forcedSaleTarget(core: Core): Player | null {
  const t = userTeam(core);
  const nb = t.roster.filter((p) => p.kind === 'B' && !p.farm).length;
  const np = t.roster.filter((p) => p.kind === 'P' && !p.farm).length;
  return t.roster.filter((p) => p.farm || (p.kind === 'B' ? nb > MIN_BATTERS : np > MIN_PITCHERS)).sort((a, b) => b.salary - a.salary)[0] ?? null;
}

// ───────── 결과를 미리 말한다: 빚더미 구단 여론 · 경쟁균형세 (10구단 리그. 8구단이면 전부 null) ─────────

/** "부채가 대출 한도의 83% — 이대로 시즌을 마치면 도민 지지 −6". debt = 가정한 부채(대출 미리 보기). 문턱 아래·한도 초과(다른 경고가 맡는다)면 null */
export function debtMoodText(core: Pick<Core, 'campaign' | 'teams' | 'finance'>, debt = core.finance.debt): { text: string; cut: number } | null {
  const m = debtMood(core, debt);
  if (!m || !m.heavy || debt > m.limit) return null;
  const head = `부채가 대출 한도의 ${m.pct}%`;
  return m.trust > 0
    ? { text: `${head} — 이대로 시즌을 마치면 도민 지지 −${m.trust}`, cut: m.trust }
    : { text: `${head} — 이대로 시즌을 마치면 조합장 경고 (다음 시즌에도 이대로면 도민 지지 −${m.next})`, cut: 0 };
}
/** 대출 버튼 옆: "빌리면 한도의 90% → 시즌 말 도민 지지 −6 예상" (빌려도 문턱 아래면 null) */
export function borrowMoodText(core: Pick<Core, 'campaign' | 'teams' | 'finance'>, add: number): string | null {
  const m = debtMood(core, core.finance.debt + add);
  if (!m || !m.heavy || core.finance.debt + add > m.limit) return null;
  return m.trust > 0 ? `빌리면 한도의 ${m.pct}% → 시즌 말 도민 지지 −${m.trust} 예상` : `빌리면 한도의 ${m.pct}% → 시즌 말 조합장 경고 (다음 시즌에도 이대로면 도민 지지 −${m.next})`;
}
/** 재무 탭의 한 줄: "연봉 총액 92억 / 경쟁균형세 상한 95억" (+ 넘었으면 예상 제재금). 경쟁균형세가 없는 리그면 null */
export function luxLine(core: Pick<Core, 'teams' | 'userId'>): { text: string; over: boolean } | null {
  const l = luxTax(core);
  if (!l.on) return null;
  return { text: `연봉 총액 ${fmtMoney(l.payroll)} / 경쟁균형세 상한 ${fmtMoney(l.cap)}${l.tax > 0 ? ` — 이대로 시즌을 마치면 제재금 ${fmtMoney(l.tax)}` : ''}`, over: l.tax > 0 };
}
/** 영입·재계약 줄: "연봉 총액 92억 → 101억 · 경쟁균형세 상한 95억 초과 — 시즌 말 제재금 3억 예상". add = 연봉 증가분. 실행 뒤에도 상한 안이면 null */
export function luxPiece(core: Pick<Core, 'teams' | 'userId'>, add: number, short = false): string | null {
  const a = luxTax(core);
  const b = luxTax(core, add);
  if (!b.on || b.tax <= 0 || add <= 0) return null;
  // short: 연봉 총액 변화가 바로 윗줄에 있는 자리(이적 창구 요약) — 한 줄에 들어가게 줄인다
  if (short) return `경쟁균형세 상한 ${fmtMoney(b.cap)} 초과 — 제재금 ${fmtMoney(b.tax)} 예상`;
  return `연봉 총액 ${fmtMoney(a.payroll)} → ${fmtMoney(b.payroll)} · 경쟁균형세 상한 ${fmtMoney(b.cap)} 초과 — 시즌 말 제재금 ${a.tax > 0 ? `${fmtMoney(a.tax)} → ` : ''}${fmtMoney(b.tax)} 예상`;
}

/** 상단 경고: 30경기 이내에 금고가 비거나 부채가 한도를 넘을 때만. danger = 12경기 이내. 그런 경고가 없고 빚더미 문턱을 넘었으면 그 결과를 */
export function runwayAlert(core: Pick<Core, 'finance'> & Partial<Pick<Core, 'campaign' | 'teams'>>, r: Runway): { text: string; danger: boolean } | null {
  if (core.finance.debt > 0 && r.forcedSale !== null && r.forcedSale <= RUNWAY_SHOW && (r.cashOut === null || r.cashOut <= 1 || r.forcedSale <= RUNWAY_DANGER)) {
    return { text: r.forcedSale <= 0 ? '부채 한도 초과' : `한도 초과까지 ${r.forcedSale}경기`, danger: r.forcedSale <= RUNWAY_DANGER };
  }
  if (r.cashOut !== null && core.finance.cash <= 0) return { text: '금고 바닥 · 빚 증가 중', danger: true };
  if (r.cashOut !== null && r.cashOut <= RUNWAY_SHOW) return { text: `${r.cashOut}경기 뒤 바닥`, danger: r.cashOut <= RUNWAY_DANGER };
  if (core.campaign && core.teams) {
    const m = debtMood(core as Pick<Core, 'campaign' | 'teams'>, core.finance.debt);
    if (m?.heavy && core.finance.debt <= m.limit) return { text: m.trust > 0 ? `부채 한도의 ${m.pct}% · 시즌 말 지지 −${m.trust}` : `부채 한도의 ${m.pct}% · 시즌 말 경고`, danger: m.trust > 0 };
  }
  return null;
}

const outText = (n: number | null) => (n === null ? '—' : `${n}경기`);

/**
 * 지출 버튼 위 예상 결과 줄에 붙이는 조각: "현금 15억 → 9.5억 · 바닥까지 — → 14경기".
 * 실행 뒤 30경기 이내에 금고가 비거나, 비는 시점이 달라질 때만 낸다(안전하면 null — 줄이 길어지지 않게).
 */
export function runwayPiece(before: Runway, after: Runway, cashBefore: number, cashAfter: number): string | null {
  const near = (n: number | null) => n !== null && n <= RUNWAY_SHOW;
  if (!near(after.cashOut) && !(near(before.cashOut) && before.cashOut !== after.cashOut)) return null;
  const cash = cashBefore !== cashAfter ? `현금 ${fmtMoney(cashBefore)} → ${fmtMoney(cashAfter)} · ` : '';
  return `${cash}바닥까지 ${outText(before.cashOut)} → ${outText(after.cashOut)}`;
}

/** 실행 전후의 core 로 만든 조각 (실행 결과 core 가 있을 때) */
export function runwayPieceOf(before: Core, after: Core): string | null {
  return runwayPiece(runway(before), runway(after), before.finance.cash, after.finance.cash);
}
