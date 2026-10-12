import type { Core, Crowd, DayReport, FacilityKind, Player, Team, Weather } from './types';
import { clamp, gauss, randInt, pick, type Rng } from './rng';
import { calcOvr, calcSalary } from './ratings';
import { autoLineup, fixLineup, slotNewcomer } from './lineup';
import { buildSchedule } from './schedule';
import { simulateGame } from './sim';
import { fmtInt, fmtMoney } from './format';
import {
  FOOD_LV, SEAT_LV, TRAIN_LV, LOAN_LIMIT, LOAN_RATE, LOAN_STEP, ROSTER_MAX, MIN_BATTERS, MIN_PITCHERS,
  OPS_COST, LEAGUE_BASE, LEAGUE_PER_FAN, LEAGUE_PER_RANK, MERCH_K, RAIN_FOOD, FORCED_SALE_RATE,
  calcDemand, opProfit, payroll, refPrice, releaseCost, signingBonus, starPower, upgradeCost, userTeam,
} from './economy';
import { baseStar, batZero, genFreeAgents, genPlayer, ledgerZero, makeCtx, pitZero, recZero } from './generate';

// ── 밸런스 상수 ──
const FAN_WIN = 25;
const FAN_LOSS = -12;
const FAN_TIE = 4;
const FAN_SELLOUT = 10;
const FAN_SAT_K = 0.6; // (fanSat-50) × K / 홈경기
const FAN_STAR_SIGN = 4; // 스타 영입 시 star × 4
const STAR_SIGN_MIN = 50; // 이 이상이어야 "스타 영입" 효과
const SAT_BASE = 45;
const SAT_CONVERGE = 0.15;
const NOISE_SD = 0.06;
const WEEK = 6;
const TRAIN_MAX_AGE = 28;
const DECLINE_AGE = 33;
const DECLINE_RATE = 0.06;
const NEWS_MAX = 80;
const RETIRE_AGE = 40;
const DOW_NAME = ['화', '수', '목', '금', '토', '일'];
const FAC_NAME: Record<FacilityKind, string> = { seats: '관중석', food: '매점', training: '훈련장' };
const ABIL_KO: Record<string, string> = {
  con: '컨택', pow: '파워', eye: '선구안', spd: '주력', def: '수비', stf: '구위', ctl: '제구', sta: '체력',
};
type AbilKey = 'con' | 'pow' | 'eye' | 'spd' | 'def' | 'stf' | 'ctl' | 'sta';
const BAT_KEYS: AbilKey[] = ['con', 'pow', 'eye', 'spd', 'def'];
const PIT_KEYS: AbilKey[] = ['stf', 'ctl', 'sta'];

const pct = (t: Team) => (t.rec.w + t.rec.l > 0 ? t.rec.w / (t.rec.w + t.rec.l) : 0);

/** 승률순 (동률은 득실차 → 승수 → id) */
export function standings(teams: Team[]): Team[] {
  return teams.slice().sort(
    (a, b) =>
      pct(b) - pct(a) ||
      b.rec.rs - b.rec.ra - (a.rec.rs - a.rec.ra) ||
      b.rec.w - a.rec.w ||
      (a.id < b.id ? -1 : 1),
  );
}

export function rankOf(teams: Team[], id: string): number {
  const i = standings(teams).findIndex((t) => t.id === id);
  return i < 0 ? teams.length : i + 1;
}

function addNews(core: Core, text: string, tone: 'good' | 'bad' | 'info'): void {
  core.news.unshift({ id: core.newsSeq++, season: core.season, day: core.day, text, tone });
  if (core.news.length > NEWS_MAX) core.news.length = NEWS_MAX;
}

function applyResult(t: Team, rs: number, ra: number): void {
  const r = t.rec;
  r.rs += rs;
  r.ra += ra;
  if (rs > ra) {
    r.w++;
    r.streak = r.streak > 0 ? r.streak + 1 : 1;
    r.last10.push(1);
  } else if (rs < ra) {
    r.l++;
    r.streak = r.streak < 0 ? r.streak - 1 : -1;
    r.last10.push(0);
  } else {
    r.t++;
    r.last10.push(0.5);
  }
  if (r.last10.length > 10) r.last10.shift();
}

function rollWeather(rng: Rng): Weather {
  const x = rng();
  return x < 0.6 ? 'sunny' : x < 0.85 ? 'cloudy' : 'rain';
}

/** 현금이 음수면 긴급 대출, 부채 한도 초과면 최고 연봉 선수 강제 매각 */
function settleCash(core: Core, notes: string[]): void {
  const f = core.finance;
  if (f.cash < 0) {
    const need = -f.cash;
    f.debt += need;
    f.cash = 0;
    const msg = `현금 부족 — ${fmtMoney(need)} 긴급 대출로 전환`;
    notes.push(msg);
    addNews(core, msg, 'bad');
  }
  const t = userTeam(core);
  for (let guard = 0; guard < 3 && f.debt > LOAN_LIMIT; guard++) {
    const nb = t.roster.filter((p) => p.kind === 'B').length;
    const np = t.roster.filter((p) => p.kind === 'P').length;
    const sellable = t.roster
      .filter((p) => (p.kind === 'B' ? nb > MIN_BATTERS : np > MIN_PITCHERS))
      .sort((a, b) => b.salary - a.salary);
    const p = sellable[0];
    if (!p) break;
    const price = Math.round(p.salary * FORCED_SALE_RATE);
    t.roster = t.roster.filter((x) => x.id !== p.id);
    f.ledger.sales += price;
    f.debt -= price;
    if (f.debt < 0) {
      f.cash += -f.debt;
      f.debt = 0;
    }
    fixLineup(t);
    const msg = `부채 한도 초과! ${p.name} 강제 매각 (${fmtMoney(price)})`;
    notes.push(msg);
    addNews(core, msg, 'bad');
  }
}

/** 주간 훈련: 젊은 선수 성장, 노장 소폭 노쇠 */
function weeklyTraining(core: Core, rng: Rng, notes: string[]): void {
  const t = userTeam(core);
  const grow = TRAIN_LV[core.facilities.training].grow;
  for (const p of t.roster) {
    const keys = p.kind === 'B' ? BAT_KEYS : PIT_KEYS;
    if (p.age <= TRAIN_MAX_AGE && p.ovr < p.pot && rng() < grow) {
      const k = pick(rng, keys);
      const d = randInt(rng, 1, 2);
      p[k] = clamp(p[k] + d, 20, 99);
      p.ovr = calcOvr(p);
      const msg = `훈련 성과: ${p.name} ${ABIL_KO[k]}+${d}`;
      notes.push(msg);
      addNews(core, msg, 'good');
    } else if (p.age >= DECLINE_AGE && rng() < DECLINE_RATE) {
      const k = p.kind === 'B' ? pick(rng, ['spd', 'spd', 'def', 'con'] as AbilKey[]) : pick(rng, ['sta', 'stf'] as AbilKey[]);
      p[k] = clamp(p[k] - 1, 20, 99);
      p.ovr = calcOvr(p);
      notes.push(`세월의 무게: ${p.name} ${ABIL_KO[k]}-1`);
    }
  }
}

export function advanceDay(core0: Core, rng: Rng): { core: Core; report: DayReport } {
  if (core0.phase !== 'season' || core0.day >= core0.schedule.length) {
    throw new Error('시즌이 이미 종료되었습니다');
  }
  const core = structuredClone(core0);
  const day = core.day;
  const dow = day % WEEK;
  const night = dow < 4;
  const user = userTeam(core);
  const byId = new Map(core.teams.map((t) => [t.id, t]));
  const notes: string[] = [];
  const rankBefore = rankOf(core.teams, core.userId);
  const games = core.schedule[day];
  const mine = games.find((g) => g.homeId === core.userId || g.awayId === core.userId);
  if (!mine) throw new Error('유저 구단의 경기가 없는 날입니다');
  const isHome = mine.homeId === core.userId;
  const opp = byId.get(isHome ? mine.awayId : mine.homeId)!;
  const f = core.finance;

  // ── 관중 (경기 전 상태 기준) ──
  let crowd: Crowd | null = null;
  if (isHome) {
    const weather = rollWeather(rng);
    const demand = calcDemand(core, { dow, weather, oppPop: opp.pop, noise: clamp(1 + gauss(rng) * NOISE_SD, 0.8, 1.2) });
    const capacity = SEAT_LV[core.facilities.seats].cap;
    const attendance = Math.min(capacity, demand);
    crowd = { attendance, capacity, demand, turnedAway: Math.max(0, demand - capacity), soldOut: demand >= capacity, weather };
  }

  // ── 경기 ──
  const injuredBefore = new Set<string>();
  for (const t of core.teams) {
    fixLineup(t);
    for (const p of t.roster) if (p.injury > 0) injuredBefore.add(p.id);
  }
  const injMult = { [core.userId]: TRAIN_LV[core.facilities.training].inj };
  let result: DayReport['result'] | undefined;
  const others: DayReport['others'] = [];
  for (const g of games) {
    const home = byId.get(g.homeId)!;
    const away = byId.get(g.awayId)!;
    const isMine = g === mine;
    const res = simulateGame(home, away, rng, { track: isMine, injMult, focusId: core.userId });
    applyResult(home, res.home, res.away);
    applyResult(away, res.away, res.home);
    if (isMine) result = res;
    else others.push({ homeId: g.homeId, awayId: g.awayId, home: res.home, away: res.away });
  }
  const res = result!;
  const myRuns = isHome ? res.home : res.away;
  const oppRuns = isHome ? res.away : res.home;
  const won = myRuns === oppRuns ? null : myRuns > oppRuns;

  // ── 부상 회복 / 신규 부상 ──
  for (const t of core.teams) {
    for (const p of t.roster) {
      if (!injuredBefore.has(p.id)) continue;
      p.injury = Math.max(0, p.injury - 1);
      if (p.injury === 0 && t.id === core.userId) {
        const msg = `부상 복귀: ${p.name}`;
        notes.push(msg);
        addNews(core, msg, 'good');
      }
    }
  }
  for (const j of res.injuries) {
    if (j.teamId !== core.userId) continue;
    const msg = `부상: ${j.name} ${j.games}경기 결장`;
    notes.push(msg);
    addNews(core, msg, 'bad');
  }

  // ── 재정 ──
  const rankNow = rankOf(core.teams, core.userId);
  const price = f.ticketPrice;
  const att = crowd ? crowd.attendance : 0;
  const ticket = Math.round(att * price);
  const food = crowd ? Math.round(att * FOOD_LV[core.facilities.food].spend * (crowd.weather === 'rain' ? RAIN_FOOD : 1)) : 0;
  const merch = Math.round(core.fans * MERCH_K * (starPower(user) / 100) * (isHome ? 1.4 : 0.6));
  const league = Math.round(LEAGUE_BASE + core.fans * LEAGUE_PER_FAN + (core.teams.length - rankNow) * LEAGUE_PER_RANK);
  const salary = Math.round(payroll(user) / core.schedule.length);
  const upkeep =
    (isHome ? SEAT_LV[core.facilities.seats].upkeep + FOOD_LV[core.facilities.food].upkeep : 0) +
    TRAIN_LV[core.facilities.training].upkeep +
    OPS_COST;
  const interest = Math.round((f.debt * LOAN_RATE) / core.schedule.length);
  const net = ticket + food + merch + league - salary - upkeep - interest;
  f.cash += net;
  const L = f.ledger;
  L.ticket += ticket;
  L.food += food;
  L.merch += merch;
  L.league += league;
  L.salary += salary;
  L.upkeep += upkeep;
  L.interest += interest;

  // ── 팬 ──
  let dFans = won === null ? FAN_TIE : won ? FAN_WIN : FAN_LOSS;
  if (crowd) {
    if (crowd.soldOut) dFans += FAN_SELLOUT;
    dFans += (core.fanSat - 50) * FAN_SAT_K;
    const l10 = user.rec.last10;
    const form = l10.reduce((s, v) => s + v, 0) / Math.max(1, l10.length);
    const fill = crowd.attendance / crowd.capacity;
    const priceFit = clamp((refPrice(core.facilities) / Math.max(0.1, price) - 1) * 40, -15, 10);
    const heat = fill >= 0.95 ? 6 : fill >= 0.8 ? 3 : fill < 0.5 ? -3 : 0;
    const target = clamp(SAT_BASE + FOOD_LV[core.facilities.food].sat + (form - 0.5) * 24 + priceFit + heat, 0, 100);
    core.fanSat = Math.round((core.fanSat + (target - core.fanSat) * SAT_CONVERGE) * 10) / 10;
    core.crowd = crowd;
    core.attHistory.push(crowd.attendance);
    if (crowd.turnedAway > 0) {
      const msg = `매진! 자리가 없어 ${fmtInt(crowd.turnedAway)}명이 발길을 돌렸습니다 — 관중석 증설을 검토하세요`;
      notes.push(msg);
      addNews(core, msg, 'info');
    } else if (crowd.soldOut) {
      notes.push('매진! 만원 관중이 들어찼습니다');
    }
  }
  core.fans = Math.max(1000, Math.round(core.fans + dFans));

  // ── 경기 뉴스 ──
  const vs = `${DOW_NAME[dow]} ${isHome ? '홈' : '원정'} ${opp.name}전`;
  if (won === null) addNews(core, `${vs} ${myRuns}:${oppRuns} 무승부`, 'info');
  else addNews(core, `${vs} ${myRuns}:${oppRuns} ${won ? '승리' : '패배'}${res.mvp && won ? ` · MVP ${res.mvp.name}` : ''}`, won ? 'good' : 'bad');
  if (user.rec.streak === 3 || user.rec.streak === 5 || user.rec.streak === 7) {
    const msg = `${user.rec.streak}연승 질주! 팬들의 관심이 뜨거워집니다`;
    notes.push(msg);
    addNews(core, msg, 'good');
  } else if (user.rec.streak === -5 || user.rec.streak === -8) {
    const msg = `${-user.rec.streak}연패 수렁… 관중석이 식어갑니다`;
    notes.push(msg);
    addNews(core, msg, 'bad');
  }

  // ── 주간 훈련 ──
  if ((day + 1) % WEEK === 0) weeklyTraining(core, rng, notes);

  settleCash(core, notes);

  // ── 마무리 ──
  core.day = day + 1;
  const rankAfter = rankOf(core.teams, core.userId);
  if (day >= 8 && rankAfter !== rankBefore) {
    notes.push(rankAfter < rankBefore ? `순위 상승: ${rankBefore}위 → ${rankAfter}위` : `순위 하락: ${rankBefore}위 → ${rankAfter}위`);
  }
  if (core.day >= core.schedule.length) {
    core.phase = 'ended';
    addNews(core, `시즌 ${core.season} 종료 — 최종 ${rankAfter}위 (${user.rec.w}승 ${user.rec.l}패 ${user.rec.t}무)`, 'info');
  }
  core.cashHistory.push(f.cash);

  const report: DayReport = {
    day,
    result: res,
    isHome,
    oppId: opp.id,
    won,
    night,
    crowd,
    money: { ticket, food, merch, league, salary, upkeep, interest, net },
    rankBefore,
    rankAfter,
    others,
    notes,
  };
  return { core, report };
}

// ───────── 유저 액션 (error 가 있으면 core 는 원본 그대로) ─────────

export function signPlayer(core0: Core, pid: string): { core: Core; error?: string } {
  const fa = core0.freeAgents.find((p) => p.id === pid);
  if (!fa) return { core: core0, error: '영입 가능한 선수가 아닙니다' };
  if (userTeam(core0).roster.length >= ROSTER_MAX) return { core: core0, error: `로스터가 가득 찼습니다 (최대 ${ROSTER_MAX}명)` };
  const bonus = signingBonus(fa);
  if (core0.finance.cash < bonus) return { core: core0, error: `계약금이 부족합니다 (필요 ${fmtMoney(bonus)})` };

  const core = structuredClone(core0);
  const t = userTeam(core);
  const p = core.freeAgents.find((x) => x.id === pid)!;
  core.freeAgents = core.freeAgents.filter((x) => x.id !== pid);
  core.finance.cash -= bonus;
  core.finance.ledger.signing += bonus;
  t.roster.push(p);
  const role = slotNewcomer(t, p);
  if (p.star >= STAR_SIGN_MIN) {
    const gain = p.star * FAN_STAR_SIGN;
    core.fans += gain;
    addNews(core, `스타 영입! ${p.name} 입단 (${role}) — 팬 +${fmtInt(gain)}`, 'good');
  } else {
    addNews(core, `영입: ${p.name} 입단 (${role})`, 'info');
  }
  return { core };
}

export function releasePlayer(core0: Core, pid: string): { core: Core; error?: string } {
  const t0 = userTeam(core0);
  const p0 = t0.roster.find((p) => p.id === pid);
  if (!p0) return { core: core0, error: '우리 팀 선수가 아닙니다' };
  const same = t0.roster.filter((p) => p.kind === p0.kind).length;
  if (p0.kind === 'B' && same <= MIN_BATTERS) return { core: core0, error: `타자는 최소 ${MIN_BATTERS}명이 필요합니다` };
  if (p0.kind === 'P' && same <= MIN_PITCHERS) return { core: core0, error: `투수는 최소 ${MIN_PITCHERS}명이 필요합니다` };
  const cost = releaseCost(p0, core0);
  if (core0.finance.cash < cost) return { core: core0, error: `위약금이 부족합니다 (필요 ${fmtMoney(cost)})` };

  const core = structuredClone(core0);
  const t = userTeam(core);
  const p = t.roster.find((x) => x.id === pid)!;
  t.roster = t.roster.filter((x) => x.id !== pid);
  core.freeAgents.push(p);
  core.finance.cash -= cost;
  core.finance.ledger.signing += cost;
  fixLineup(t);
  addNews(core, `방출: ${p.name} (위약금 ${fmtMoney(cost)})`, 'info');
  return { core };
}

export function upgradeFacility(core0: Core, kind: FacilityKind): { core: Core; error?: string } {
  const cost = upgradeCost(kind, core0.facilities);
  if (cost === null) return { core: core0, error: '이미 최고 단계입니다' };
  if (core0.finance.cash < cost) return { core: core0, error: `자금이 부족합니다 (필요 ${fmtMoney(cost)})` };
  const core = structuredClone(core0);
  core.finance.cash -= cost;
  core.finance.ledger.facility += cost;
  core.facilities[kind]++;
  const lv = core.facilities[kind];
  const name = kind === 'seats' ? SEAT_LV[lv].name : kind === 'food' ? FOOD_LV[lv].name : TRAIN_LV[lv].name;
  addNews(core, `${FAC_NAME[kind]} 업그레이드 완료: Lv${lv + 1} ${name}`, 'good');
  return { core };
}

/** 0.5~4.0, 0.1 단위 */
export function setTicketPrice(core0: Core, price: number): Core {
  const v = clamp(Math.round((Number.isFinite(price) ? price : core0.finance.ticketPrice) * 10) / 10, 0.5, 4.0);
  if (v === core0.finance.ticketPrice) return core0;
  const core = structuredClone(core0);
  core.finance.ticketPrice = v;
  return core;
}

export function borrow(core0: Core): { core: Core; error?: string } {
  if (core0.finance.debt + LOAN_STEP > LOAN_LIMIT) return { core: core0, error: `대출 한도(${fmtMoney(LOAN_LIMIT)})를 넘을 수 없습니다` };
  const core = structuredClone(core0);
  core.finance.cash += LOAN_STEP;
  core.finance.debt += LOAN_STEP;
  addNews(core, `${fmtMoney(LOAN_STEP)} 대출 실행 (연 ${Math.round(LOAN_RATE * 100)}%)`, 'info');
  return { core };
}

export function repay(core0: Core): { core: Core; error?: string } {
  if (core0.finance.debt <= 0) return { core: core0, error: '상환할 부채가 없습니다' };
  const amt = Math.min(LOAN_STEP, core0.finance.debt);
  if (core0.finance.cash < amt) return { core: core0, error: `상환할 현금이 부족합니다 (필요 ${fmtMoney(amt)})` };
  const core = structuredClone(core0);
  core.finance.cash -= amt;
  core.finance.debt -= amt;
  addNews(core, `${fmtMoney(amt)} 대출 상환`, 'info');
  return { core };
}

// ───────── 시즌 전환 ─────────

/** 나이 +1 과 그에 따른 성장/노쇠, 기록 리셋 */
function develop(p: Player, rng: Rng): void {
  p.age++;
  const keys = p.kind === 'B' ? BAT_KEYS : PIT_KEYS;
  for (const k of keys) {
    let d: number;
    if (p.age <= 25) d = p.ovr < p.pot ? randInt(rng, 0, 3) : randInt(rng, -1, 1);
    else if (p.age <= 30) d = randInt(rng, -1, 1);
    else if (p.age <= 33) d = randInt(rng, -2, 1);
    else d = randInt(rng, -3, 0);
    if (p.age >= 31 && (k === 'spd' || k === 'sta')) d -= 1;
    p[k] = clamp(p[k] + d, 20, 99);
  }
  p.ovr = calcOvr(p);
  p.pot = Math.max(p.pot, p.ovr);
  p.salary = calcSalary(p);
  p.star = clamp(Math.round(p.star * 0.75 + (baseStar(p.ovr) + 6) * 0.25), 0, 100);
  p.injury = 0;
  p.bat = batZero();
  p.pit = pitZero();
}

export function nextSeason(core0: Core, rng: Rng): Core {
  const core = structuredClone(core0);
  core.season++;
  core.day = 0;
  core.phase = 'season';

  const names = core.teams.flatMap((t) => t.roster.map((p) => p.name));
  const ctx = makeCtx(rng, `s${core.season}-`, names);
  const retired: string[] = [];
  for (const t of core.teams) {
    t.roster = t.roster.map((p) => {
      develop(p, rng);
      if (p.age < RETIRE_AGE) return p;
      // 은퇴 → 같은 포지션 신인으로 충원
      if (t.id === core.userId) retired.push(p.name);
      return genPlayer(ctx, p.pos, 50, { age: randInt(rng, 19, 22), tag: '신인' });
    });
    t.rec = recZero();
    t.nextStarter = 0;
    if (t.id === core.userId) fixLineup(t);
    else autoLineup(t);
  }
  core.freeAgents = genFreeAgents(ctx);
  core.schedule = buildSchedule(core.teams.map((t) => t.id), rng);
  core.finance.ledger = ledgerZero();
  core.attHistory = [];
  core.cashHistory = [core.finance.cash];
  core.fanSat = Math.round((core.fanSat * 0.7 + 50 * 0.3) * 10) / 10;
  for (const n of retired) addNews(core, `${n} 은퇴 — 신인 선수가 자리를 채웁니다`, 'info');
  addNews(core, `시즌 ${core.season} 개막! 연봉이 재산정되고 새 FA 시장이 열렸습니다`, 'info');
  return core;
}

export function seasonAwards(core: Core): {
  mvpBat: Player | null;
  mvpPit: Player | null;
  grade: 'S' | 'A' | 'B' | 'C' | 'D';
  comment: string;
} {
  const t = userTeam(core);
  const top = (ps: Player[], score: (p: Player) => number): Player | null => {
    let bestP: Player | null = null;
    let bestV = -Infinity;
    for (const p of ps) {
      const v = score(p);
      if (v > bestV) {
        bestV = v;
        bestP = p;
      }
    }
    return bestP;
  };
  const mvpBat = top(
    t.roster.filter((p) => p.kind === 'B' && p.bat.pa > 0),
    (p) => p.bat.h + p.bat.hr * 3 + p.bat.rbi + p.bat.r * 0.5 + p.bat.bb * 0.4 - (p.bat.ab - p.bat.h) * 0.25,
  );
  const mvpPit = top(
    t.roster.filter((p) => p.kind === 'P' && p.pit.outs > 0),
    (p) => p.pit.outs / 3 - p.pit.er * 1.3 + p.pit.w * 3 + p.pit.sv * 2 + p.pit.so * 0.15,
  );

  const rank = rankOf(core.teams, core.userId);
  const profit = opProfit(core.finance.ledger);
  const cap = SEAT_LV[core.facilities.seats].cap;
  const avgAtt = core.attHistory.length ? core.attHistory.reduce((s, v) => s + v, 0) / core.attHistory.length : 0;
  let pts = core.teams.length + 1 - rank;
  pts += profit >= 150000 ? 2 : profit >= 50000 ? 1 : profit < -150000 ? -2 : profit < 0 ? -1 : 0;
  if (avgAtt / cap >= 0.9) pts += 1;
  const grade = pts >= 9 ? 'S' : pts >= 7 ? 'A' : pts >= 4 ? 'B' : pts >= 2 ? 'C' : 'D';
  const comment = {
    S: '우승 경쟁에 흑자 경영까지 — 구단주가 더 바랄 게 없습니다.',
    A: '성적과 살림 모두 훌륭한 시즌. 팬들이 내년을 기다립니다.',
    B: '가능성을 보여준 시즌. 한두 군데만 더 보강하면 가을야구가 보입니다.',
    C: '아직 갈 길이 멉니다. 간판스타와 구장 투자 중 하나에 집중해 보세요.',
    D: '성적도 살림도 빨간불. 연봉 구조와 티켓 가격부터 점검이 필요합니다.',
  }[grade];
  return { mvpBat, mvpPit, grade, comment };
}
