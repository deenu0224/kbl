// 내년 살림 미리보기: "다음 시즌 연봉 총액이 얼마나 오르고, 이대로면 영업손익이 어떻게 되는가". 순수 함수만 — 난수도, core 변경도 없다.
//
// 연봉 (season.ts nextSeason 의 재산정을 그대로 따라 한다)
//  · 능력은 지금 그대로, 한 살 더 먹고 시즌이 바뀐다고 보고 marketSalary 를 다시 계산한다 — 무작위 성장·노쇠는 넣지 않는다("예상").
//  · 보유 기간 안의 드래프트 출신은 내년 차수의 할인율(SVC_RATE), 그 밖의 선수는 재계약 프리미엄(renewPremium) × 요구 배율(ask).
//  · FA 자격을 얻는 선수는 재계약한다(요구 연봉 = 시장가 × resignAsk 배율)고 보고 총액에 넣는다. 보내면 빠지는 연봉은 fa 에 따로.
//  · 은퇴(40세)는 같은 자리 신인(최저연봉)으로, 전역 선수는 지금 능력의 시장가(보유 기간이면 할인)로 돌아온다고 본다.
//  · 드래프트 지명(DRAFT_ROUNDS 명 · 2군 정원까지)은 최저연봉으로 2군에 들어온다. 이미 드래프트를 마쳤으면 명단에 있다.
// 영업손익 (runway.ts 와 같은 가정: 지금 가격·시설·팬 규모가 이어진다)
//  · 수입 = 이번 시즌 입장·매점·굿즈·분배금 실적. 시즌 중이면 지금까지의 실적을 시즌 길이로 늘린다. 가을야구 배당금은 뺀다.
//  · 지출 = 위 연봉 + 시설 유지비(홈 경기) + 훈련장·운영비·2군 운영비 + 이자(지금 부채 기준) + 경쟁균형세 예상.
//  · 계약금·선수 매각·시설 투자·이벤트 카드는 넣지 않는다.
import type { Core, Player } from './types';
import {
  AUDIT, FOOD_LV, LUX_TAX, LUX_TAX_BIG, RESIGN_ASK_MAX, SEAT_LV, SVC_RATE, SVC_YEARS, TRAIN_LV,
  FARM_UPKEEP, farmMax, farmRoster, loanInterest, luxTax, opsCost, salaryInflation, userTeam,
} from './economy';
import { BASE_TEAMS, leagueSize, perGame } from './league';
import { memoGet } from './memo';
import { marketSalary, renewPremium } from './season';
import { svcSalary, svcYearAt } from './contract';
import { projectFx } from './projects';
import { MIN_SALARY } from './ratings';
import { clamp } from './rng';
import { DRAFT_ROUNDS } from './draft';
import { POST_DIVIDEND } from './campaign';
import { fmtMoney } from './format';

const RETIRE_AGE = 40; // season.ts 와 같다

export type RaiseWhy = 'svc' | 'rate';
export interface PayRaise {
  pid: string;
  name: string;
  now: number;
  next: number;
  why: RaiseWhy; // svc = 보유 기간 할인이 줄거나 끝남 · rate = 능력·나이·리그 인상률에 맞춘 연봉 재평가
}
export interface PayForecast {
  season: number; // 예측하는 시즌 (다음 시즌)
  now: { active: number; farm: number; total: number }; // 지금 연봉 총액 (1군 = 2군이 아닌 모두 · 재활 포함)
  next: { active: number; farm: number; total: number };
  parts: { rate: number; svc: number; retire: number; back: number; draft: number }; // 증감의 이유별 분해 (합 = next.total − now.total)
  fa: { n: number; salary: number }; // FA 자격 선수: 보내면 빠지는 다음 시즌 연봉 (총액에는 재계약한다고 보고 들어 있다)
  farmN: { now: number; next: number };
  lux: { cap: number; tax: number } | null; // 경쟁균형세 (없는 리그면 null)
  income: number; // 수입 예상 (이번 시즌 실적)
  upkeep: number; // 시설 유지·운영비·2군 운영비
  interest: number;
  profit: number; // 영업손익 예상 = 수입 − 연봉 − 유지·운영 − 이자 − 경쟁균형세
  top: PayRaise[]; // 연봉이 가장 많이 오르는 선수 3명
  scaled: boolean; // 시즌 중: 수입을 지금까지의 실적으로 늘려 잡았다
}

const r100 = (v: number) => Math.round(v / 100) * 100;
const svcRate = (yr: number) => SVC_RATE[clamp(yr, 1, SVC_YEARS) - 1];

/** 한 선수의 다음 시즌 연봉 예상 (능력 그대로, 한 살 더). svc = 보유 기간 할인 변화분 */
function nextSalary(core: Core, p: Player, premium: number): { next: number; svc: number; fa: boolean } {
  const season = core.season + 1;
  const aged = { ...p, age: p.age + 1 };
  const m = marketSalary(aged, season);
  const yr0 = AUDIT.svc ? svcYearAt(p, core.season) : null;
  const yr1 = AUDIT.svc ? svcYearAt(p, season) : null;
  if (yr1 !== null && yr1 <= SVC_YEARS) {
    const next = svcSalary(m, yr1);
    return { next, svc: yr0 !== null ? next - svcSalary(m, yr0) : 0, fa: false };
  }
  if (yr1 !== null) {
    // FA 자격: 재계약 요구(resignAsk 의 배율 — 다음 시즌 시장가 × 1~1.15) 뒤 시즌 전환에서 재계약 프리미엄이 붙는다
    const mult = Math.round((1 + RESIGN_ASK_MAX * clamp((p.star - 30) / 50, 0, 1) + (p.lever ?? 0)) * 100) / 100;
    const next = r100(m * premium * mult);
    return { next, svc: next - (yr0 !== null && yr0 <= SVC_YEARS ? svcSalary(m, yr0) : m), fa: true };
  }
  return { next: r100(m * premium * (p.ask ?? 1)), svc: 0, fa: false };
}

/** 다음 시즌 연봉 총액·영업손익 예상. 시즌 중·결산 후·드래프트 중 어디서 불러도 된다 */
export function nextSeasonForecast(core: Core): PayForecast {
  const t = userTeam(core);
  const premium = renewPremium(core);
  const len = core.schedule.length || 1;
  const now = { active: 0, farm: 0, total: 0 };
  const next = { active: 0, farm: 0, total: 0 };
  const parts = { rate: 0, svc: 0, retire: 0, back: 0, draft: 0 };
  const fa = { n: 0, salary: 0 };
  const raises: PayRaise[] = [];
  const add = (o: typeof now, farm: boolean, v: number) => {
    o.total += v;
    if (farm) o.farm += v;
    else o.active += v;
  };
  const tourPid = memoGet(core, 'retire');
  const drafted = new Set((core.draft?.log ?? []).map((l) => l.pid));
  let farmN = farmRoster(t).length;
  for (const p of t.roster) {
    const farm = !!p.farm && !p.il;
    add(now, farm, p.salary);
    if (drafted.has(p.id)) {
      // 이번 드래프트 지명: 연봉 재산정 없이 데뷔
      add(next, farm, p.salary);
      continue;
    }
    if (p.age + 1 >= RETIRE_AGE || p.id === tourPid) {
      add(next, farm, MIN_SALARY);
      parts.retire += MIN_SALARY - p.salary;
      continue;
    }
    const n = nextSalary(core, p, premium);
    add(next, farm, n.next);
    parts.svc += n.svc;
    parts.rate += n.next - p.salary - n.svc;
    if (n.fa) {
      fa.n++;
      fa.salary += n.next;
    }
    if (n.next > p.salary) raises.push({ pid: p.id, name: p.name, now: p.salary, next: n.next, why: n.svc > (n.next - p.salary) / 2 ? 'svc' : 'rate' });
  }
  // 전역 복귀 (지금 능력 그대로의 시장가 · 보유 기간이면 할인)
  for (const p of core.campaign.away ?? []) {
    if ((p.away?.until ?? 0) > core.season + 1) continue;
    const m = marketSalary({ ...p, age: p.age + 1 }, core.season + 1);
    const yr = svcYearAt(p, core.season + 1);
    const v = yr !== null && yr <= SVC_YEARS ? svcSalary(m, yr) : m;
    const farm = farmN < farmMax(core);
    if (farm) farmN++;
    add(next, farm, v);
    parts.back += v;
  }
  // 드래프트 지명 (아직이면): 2군 정원까지 최저연봉
  if (core.phase !== 'draft') {
    const picks = Math.max(0, Math.min(DRAFT_ROUNDS, farmMax(core) - farmN));
    farmN += picks;
    add(next, true, picks * MIN_SALARY);
    parts.draft += picks * MIN_SALARY;
  }

  // 경쟁균형세: 다음 시즌 상한 = 지금 상한을 리그 연봉 인상률만큼 올린 값 (10구단 상한은 내려가지 않는다)
  let lux: PayForecast['lux'] = null;
  const l = luxTax(core);
  if (l.on) {
    const big = leagueSize(core) > BASE_TEAMS;
    const k = big ? LUX_TAX_BIG : LUX_TAX;
    const cap = r100((l.cap * salaryInflation(core.season + 1)) / salaryInflation(core.season));
    lux = { cap, tax: r100(Math.max(0, next.total - cap) * k.rate) };
  }

  // 수입: 이번 시즌 실적 (시즌 중이면 시즌 길이로 늘린다 · 가을야구 배당금은 뺀다)
  const L = core.finance.ledger;
  const played = core.phase === 'season' ? core.day : len;
  const scaled = core.phase === 'season' && core.day < len;
  const div = core.phase === 'season' ? 0 : POST_DIVIDEND[core.post?.userFinish ?? 'none'] ?? 0;
  const gross = L.ticket + L.food + L.merch + L.league - div;
  const income = Math.round(scaled ? (gross * len) / Math.max(1, played) : gross);
  // 지출: 지금 시설·팬 규모·부채 그대로
  const homes = core.schedule.filter((d) => d.some((g) => g.homeId === core.userId)).length;
  const farmUp = farmN * (AUDIT.farmUpkeep >= 0 ? AUDIT.farmUpkeep : FARM_UPKEEP);
  const upkeep = Math.round(
    homes * (SEAT_LV[core.facilities.seats].upkeep + FOOD_LV[core.facilities.food].upkeep + projectFx({ campaign: core.campaign, season: core.season + 1 }).upkeep) +
      len * perGame(core, TRAIN_LV[core.facilities.training].upkeep + farmUp + opsCost(core)),
  );
  const interest = Math.round(loanInterest(core, core.finance.debt));
  const profit = income - next.total - upkeep - interest - (lux?.tax ?? 0);

  raises.sort((a, b) => b.next - b.now - (a.next - a.now));
  return {
    season: core.season + 1,
    now,
    next,
    parts,
    fa,
    farmN: { now: farmRoster(t).length, next: farmN },
    lux,
    income,
    upkeep,
    interest,
    profit,
    top: raises.slice(0, 3),
    scaled,
  };
}

// ───────── 문구 ─────────

/** "+9.7억" / "−7억" (0 은 "±0") */
export function signedMoney(v: number): string {
  if (Math.round(v / 1000) === 0) return '±0';
  return v < 0 ? `−${fmtMoney(-v)}` : `+${fmtMoney(v)}`;
}

const PART_LABEL: [keyof PayForecast['parts'], string][] = [
  ['rate', '연봉 재평가'],
  ['svc', '보유 기간 할인 줄어듦'],
  ['draft', '드래프트 2군'],
  ['back', '전역 복귀'],
  ['retire', '은퇴'],
];
/** 증감의 이유별 조각: ["연봉 재평가 +7.2억", "보유 기간 할인 줄어듦 +3.1억", ...] (0.1억 미만은 뺀다) */
export function payParts(f: PayForecast): string[] {
  return PART_LABEL.filter(([k]) => Math.abs(f.parts[k]) >= 1000).map(([k, label]) => `${label} ${signedMoney(f.parts[k])}`);
}

export const RAISE_WHY: Record<RaiseWhy, string> = { svc: '보유 기간 할인 끝', rate: '연봉 재평가' };
/** 보유 기간 할인이 끝나는가(FA 자격 · 마지막 해) — 줄어들기만 하면 "할인 줄어듦" */
export function raiseWhyText(core: Core, r: PayRaise): string {
  if (r.why !== 'svc') return RAISE_WHY.rate;
  const p = userTeam(core).roster.find((x) => x.id === r.pid);
  const yr = p ? svcYearAt(p, core.season + 1) : null;
  return yr !== null && yr <= SVC_YEARS ? '보유 기간 할인 줄어듦' : RAISE_WHY.svc;
}

/** 시즌 후반 재무 탭·할 일에 띄우는가: 남은 경기가 1/3 이하 */
export const PAY_SHOW_LEFT = 1 / 3;
export function payForecastShown(core: Pick<Core, 'phase' | 'day' | 'schedule'>): boolean {
  const len = core.schedule.length;
  return core.phase === 'season' && len > 0 && len - core.day <= len * PAY_SHOW_LEFT;
}

/** 할 일: 내년 적자 예상이 이만큼 이상이고 시즌 마지막 PAY_TODO_LAST 경기 안이면 */
export const PAY_TODO_LOSS = -50000; // −5억
export const PAY_TODO_LAST = 10;
