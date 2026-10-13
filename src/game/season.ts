import type { BatStats, BoxSide, PitStats, Core, Crowd, DayReport, FacilityKind, FarmStat, GameResult, Player, Team, Weather } from './types';
import { clamp, gauss, randInt, pick, type Rng } from './rng';
import { calcOvr, calcSalary, teamStrength } from './ratings';
import { autoLineup, fixLineup, slotNewcomer } from './lineup';
import { buildSchedule } from './schedule';
import { simulateGame, type PenStyle } from './sim';
import { fmtAvg, fmtEra, fmtInt, fmtMoney } from './format';
import { projectFx, projectSeasonOpenMut } from './projects';
import {
  FOOD_LV, SEAT_LV, TRAIN_LV, LOAN_STEP, OVER_LIMIT_ERR, loanInterest, loanLimit, overLimit, farmMax, ROSTER_MAX, MIN_BATTERS, MIN_PITCHERS,
  LEAGUE_BASE, LEAGUE_PER_FAN, LEAGUE_PER_RANK, MERCH_K, RENEW_PREMIUM, RENEW_SEASONS,
  BENCH_GROW, FARM_CAP, FARM_LOCK, IL_MIN, SVC_YEARS, AUDIT, activeRoster, farmGrow, farmRoster, farmUpkeep,
  awaySupport, calcDemand, capacityOf, opProfit, opsCost, payroll, rainFood, refPrice, releaseCost, salaryInflation, signingBonus, signingOpen, starPower, upgradeCost, userTeam,
} from './economy';
import { baseStar, batZero, genFreeAgents, genPlayer, ledgerZero, makeCtx, pitZero, recZero } from './generate';
import { activeBuffs, fillObjectivesMut, hintMut, refreshProgressMut, resetSeasonCampaignMut, tickBuffs } from './campaign';
import { JETLAG_FOCUS, POS_NAME, beatById, jetLag, scriptTickMut, weatherFor } from './script';
import { memoAdd, memoGet, memoSet } from './memo';
import { NEWS, OVER_LABEL } from './story';
import { isFranchise } from './franchise';
import { afterRegularSeasonMut, playPostDayMut } from './postseason';
import { isDraftDone } from './draft';
import { armTickMut, cutGoodsMut, FOREIGN_MAX } from './events';
import { leagueMult, scandalTickMut } from './scandal';
import { tradeTickMut } from './trade';
import { svcSalary, svcYearAt } from './contract';
import { farmDailyMut, subEnqueueMut, growBonus, ilAutoMut, markUpMut, seasonTurnFarmMut } from './farm';
import { perGame, rankUnits } from './league';

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
export const WEEK = 6;
export const ALUMNI_STAR = 50; // 이 스타성 이상으로 35세 넘어 은퇴한 유저 팀 선수는 인스트럭터 후보
export const ALUMNI_AGE = 35;
export const TRAIN_MAX_AGE = 28;
export const DECLINE_AGE = 33;
export const DECLINE_RATE = 0.06;
const NEWS_MAX = 80;
const RETIRE_AGE = 40;
const FRANCHISE_LEAVE_FANS = 8; // 프랜차이즈 스타 방출·트레이드 시 팬 감소 = star × 이 값
const FRANCHISE_LEAVE_SAT = -8;
const ROOKIE_CAMP_DAYS = 12; // 2장 기: 지난 드래프트 신인의 훈련 성과 1회 확정 기한
export const PLAY_GROW = 1.6; // 주전으로 뛰는 젊은 선수의 주간 성장 확률 배율
export const PLAY_GROW_AGE = 25;
const TIRED_HINT = 2; // 이 이상 연투한 투수가 생기면 투수 탭 배지
const DOW_NAME = ['화', '수', '목', '금', '토', '일'];
// 스토브리그 (AI 구단)
const AI_ROSTER = 25; // AI 구단 로스터 정원 (초과분 방출)
const AI_ROSTER_B = 13; // 타자 / 투수 기준 구성 (투수 12 = SP5·RP6·CP1)
const AI_SIGN_MIN = 0; // AI 구단당 FA 영입 수 (0~1, 리그 전력 인플레 방지)
const AI_SIGN_EXTRA = 0.5; // 1명 영입 확률
const AI_SIGN_MARGIN = 2; // 기존 주전 최저 OVR 보다 이만큼 나아야 영입
const AI_SIGN_TIER = 3; // 팀 전력 + 이 값을 넘는 FA 는 영입하지 않음
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

export function addNews(core: Core, text: string, tone: 'good' | 'bad' | 'info'): void {
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

export function rollWeather(rng: Rng): Weather {
  const x = rng();
  return x < 0.6 ? 'sunny' : x < 0.85 ? 'cloudy' : 'rain';
}

/** 현금이 음수면 긴급 대출(부채 한도에 포함). 한도를 넘으면 다음 카드 판정에서 매각 카드가 온다 (debt.ts) */
export function settleCash(core: Core, notes: string[]): void {
  const f = core.finance;
  if (f.cash >= 0) return;
  const need = -f.cash;
  const was = overLimit(core);
  f.debt += need;
  f.cash = 0;
  const msg = `현금 부족 — ${fmtMoney(need)} 긴급 대출로 전환`;
  notes.push(msg);
  addNews(core, msg, 'bad');
  if (!was && overLimit(core)) {
    const over = `부채 한도 초과! 부채 ${fmtMoney(f.debt)} / 한도 ${fmtMoney(loanLimit(core))}`;
    notes.push(over);
    addNews(core, over, 'bad');
  }
}

/** 선수의 주간 성장 확률: 2군(실전) > 1군 주전 > 1군 벤치. 자랄 수 없으면 0 */
export function growChance(core: Pick<Core, 'facilities'> & Partial<Pick<Core, 'campaign' | 'day'>>, t: Team, p: Player): number {
  if (p.age > TRAIN_MAX_AGE || p.ovr >= p.pot) return 0;
  // 2군 사건의 보정: 인스트럭터(2군 +%p) · 믿고 쓰는 선수(×)
  if (p.farm && p.il) return 0; // 재활 중에는 자라지 않는다
  const fb = growBonus(core, p);
  const pj = projectFx(core); // 왕조 프로젝트: 아카데미(2군 +%p) · 전지훈련(1군 +%p)
  const grow = Math.min(1, TRAIN_LV[core.facilities.training].grow * fb.mult + pj.mainGrow);
  if (p.farm) return p.ovr >= FARM_CAP ? 0 : Math.min(1, farmGrow(core.facilities) + fb.add + pj.farmGrow);
  if (p.age > PLAY_GROW_AGE) return grow;
  const playing = t.lineup.some((x) => x.pid === p.id) || t.rotation.includes(p.id) || t.closer === p.id;
  // 불펜 투수는 벤치가 아니다: 등판하는 투수이므로 훈련장 확률 그대로 자란다
  if (!playing && ((p.kind === 'P' && AUDIT.penGrow) || !AUDIT.benchHalf)) return grow;
  return Math.min(1, grow * (playing ? PLAY_GROW : BENCH_GROW));
}

/** 퓨처스 성적 한 줄 (".338 5홈런" / "평균자책 3.21 · 24이닝"). 기록이 없으면 '' */
export function farmStatText(p: Player): string {
  const s = p.farmStat;
  if (!s) return '';
  if (p.kind === 'B') return s.ab > 0 ? `${fmtAvg(s.h, s.ab)} ${s.hr}홈런` : '';
  return s.outs > 0 ? `평균자책점 ${fmtEra(s.er, s.outs)} · ${Math.floor(s.outs / 3)}이닝` : '';
}

const farmStatZero = (): FarmStat => ({ g: 0, ab: 0, h: 0, hr: 0, outs: 0, er: 0 });

/** 퓨처스 한 주 기록: 경기를 돌리지 않고 능력치에서 뽑는다 (2군 리그는 1군보다 수준이 낮다) */
function farmWeekMut(p: Player, rng: Rng): void {
  const s = (p.farmStat ??= farmStatZero());
  if (p.injury > 0) return;
  if (p.kind === 'B') {
    const ab = randInt(rng, 16, 22);
    const avg = clamp(0.265 + (p.con - 50) * 0.0034 + (p.eye - 50) * 0.0008, 0.15, 0.42);
    const hrRate = clamp(0.022 + (p.pow - 50) * 0.0013, 0.002, 0.09);
    let h = 0;
    let hr = 0;
    for (let i = 0; i < ab; i++) {
      if (rng() < avg) {
        h++;
        if (rng() < hrRate / avg) hr++;
      }
    }
    s.g += 5;
    s.ab += ab;
    s.h += h;
    s.hr += hr;
  } else {
    const sp = p.pos === 'SP';
    const outs = sp ? randInt(rng, 14, 20) : randInt(rng, 6, 12);
    const era = clamp(4.4 - (p.stf - 50) * 0.075 - (p.ctl - 50) * 0.055, 1.2, 9.5);
    const er = Math.max(0, Math.round((era * outs) / 27 + gauss(rng) * (sp ? 1.3 : 0.9)));
    s.g += sp ? 1 : 3;
    s.outs += outs;
    s.er += er;
  }
}

/** 주간 훈련: 젊은 선수 성장, 노장 소폭 노쇠 */
function weeklyTraining(core: Core, rng: Rng, notes: string[]): void {
  const t = userTeam(core);
  // 2장 기: 지난 드래프트 신인은 첫 2주 안에 훈련 성과가 한 번은 난다
  const camp = !!beatById(core, 'rookie-camp') && core.day < ROOKIE_CAMP_DAYS && memoGet(core, 'camp') === undefined;
  if (camp) memoSet(core, 'camp', 1);
  for (const p of t.roster) {
    if (p.farm && !p.il) farmWeekMut(p, rng);
    const keys = p.kind === 'B' ? BAT_KEYS : PIT_KEYS;
    const sure = camp && !!p.rookie && p.ovr < p.pot;
    // 2군은 실전으로 가장 빨리 자라고(OVR 상한), 1군 주전인 25세 이하가 그다음, 1군 벤치의 25세 이하는 썩는다
    const g = growChance(core, t, p);
    if (p.age <= TRAIN_MAX_AGE && p.ovr < p.pot && (rng() < g || sure)) {
      memoAdd(core, 'grow');
      const k = pick(rng, keys);
      // 2군 타자는 매일 타석에 서므로 한 번의 성과가 크다 (능력치가 다섯이라 OVR 로는 투수와 비슷해진다 — scripts/farmgrowth.ts)
      const big = !!p.farm && p.kind === 'B' && AUDIT.farmBatBig;
      const d = randInt(rng, 1, 2) + (big ? 1 : 0);
      p[k] = clamp(p[k] + d, 20, 99);
      p.ovr = calcOvr(p);
      // 한 번의 성과는 주 능력치 +1~2 와 다른 능력치 +1
      const k2 = pick(rng, keys.filter((x) => x !== k));
      p[k2] = clamp(p[k2] + (big ? randInt(rng, 1, 2) : 1), 20, 99);
      if (big) {
        const k3 = pick(rng, keys.filter((x) => x !== k && x !== k2));
        p[k3] = clamp(p[k3] + 1, 20, 99);
      }
      p.ovr = calcOvr(p);
      const msg = `${p.farm ? '퓨처스 성과' : '훈련 성과'}: ${p.name} ${ABIL_KO[k]}+${d} · ${ABIL_KO[k2]}+1`;
      if (p.farm && p.ovr >= FARM_CAP && p.ovr < p.pot) addNews(core, `${p.name}: 2군에서 배울 건 다 배웠습니다 (오버롤 ${p.ovr})`, 'info');
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

type AbilKeyAll = AbilKey;
const ALL_KEYS: AbilKeyAll[] = [...BAT_KEYS, ...PIT_KEYS];

/** 이벤트 집중력 버프: 경기 중에만 능력치를 가감하고 되돌리는 함수를 반환 */
function applyFocus(t: Team, d: number, per: Record<string, number> = {}): () => void {
  const saved = t.roster.map((p) => ALL_KEYS.map((k) => p[k]));
  for (const p of t.roster) for (const k of p.kind === 'B' ? BAT_KEYS : PIT_KEYS) p[k] = clamp(p[k] + d + (per[p.id] ?? 0), 20, 99);
  return () => t.roster.forEach((p, i) => ALL_KEYS.forEach((k, j) => (p[k] = saved[i][j])));
}

/** 은퇴 투어 등 고정 출전 선수를 타선에 넣는다 */
/** 고정 출전 선수를 선발 명단에 넣는다. 반환: 그에게 밀려난 선수 pid */
function forceStarter(t: Team, pid: string): string | null {
  const p = t.roster.find((x) => x.id === pid);
  if (!p || p.farm || p.kind !== 'B' || p.injury > 0 || t.lineup.some((s) => s.pid === pid)) return null;
  const slot = t.lineup.find((s) => s.pos === p.pos) ?? t.lineup.find((s) => s.pos === 'DH');
  if (!slot) return null;
  const out = slot.pid;
  slot.pid = pid;
  return out;
}

/** 유저 팀이 오늘 원정 6연전 뒤 첫 홈경기를 치르는가 (정규시즌만) */
function userJetLag(core: Core, home: Team): boolean {
  return core.phase === 'season' && home.id === core.userId && jetLag(core, core.day);
}

function boxOf(team: Team, lineup: Team['lineup'], before: Map<string, { bat: BatStats; pit: PitStats }>, res: GameResult, side: 0 | 1): BoxSide {
  const pos = new Map(lineup.map((l) => [l.pid, l.pos as string]));
  const rank = new Map(lineup.map((l, i) => [l.pid, i]));
  const bat: BoxSide['bat'] = [];
  const pit: BoxSide['pit'] = [];
  for (const p of team.roster) {
    const b0 = before.get(p.id);
    if (!b0) continue;
    const pa = p.bat.pa - b0.bat.pa;
    if (pa > 0 || rank.has(p.id)) {
      const d = (k: keyof BatStats) => p.bat[k] - b0.bat[k];
      bat.push({ pid: p.id, name: p.name, pos: pos.get(p.id) ?? '대타', ab: d('ab'), h: d('h'), hr: d('hr'), rbi: d('rbi'), bb: d('bb'), so: d('so'), r: d('r') });
    }
    if (p.pit.g - b0.pit.g > 0 || p.pit.outs - b0.pit.outs > 0) {
      const d = (k: keyof PitStats) => p.pit[k] - b0.pit[k];
      pit.push({ pid: p.id, name: p.name, outs: d('outs'), h: d('h'), er: d('er'), bb: d('bb'), so: d('so'), dec: res.winP === p.id ? 'W' : res.lossP === p.id ? 'L' : res.saveP === p.id ? 'S' : undefined });
    }
  }
  bat.sort((a, b) => (rank.get(a.pid) ?? 99) - (rank.get(b.pid) ?? 99));
  const starter = res.starters[side];
  // 등판 순서대로 (sim 이 실어 준다. 없으면 선발만 앞으로)
  const turn = new Map((res.pitOrder?.[side] ?? [starter]).map((id, i) => [id, i]));
  pit.sort((a, b) => (turn.get(a.pid) ?? 99) - (turn.get(b.pid) ?? 99));
  return { bat, pit };
}

/**
 * 한 경기 시뮬 (정규시즌·포스트시즌 공용). core 가 있으면 유저 구단에 훈련장 부상 보정과
 * 이벤트 버프(집중력·고정 출전)를 적용한다. 팀/선수는 simulateGame 과 같이 mutate.
 */
export function playGame(core: Core | null, home: Team, away: Team, rng: Rng, track: boolean): GameResult {
  const injMult: Record<string, number> = {};
  let restore: (() => void) | null = null;
  let rest: Set<string> | undefined;
  const awayEdge: Record<string, number> = {};
  let penStyle: Record<string, PenStyle> | undefined;
  if (core) {
    penStyle = { [core.userId]: core.campaign?.penStyle ?? 'balance' };
    if (away.id === core.userId) awayEdge[core.userId] = awaySupport(core); // 원정 응원단
    injMult[core.userId] = TRAIN_LV[core.facilities.training].inj * projectFx(core).inj;
    const ut = home.id === core.userId ? home : away.id === core.userId ? away : null;
    if (ut) {
      const fx = activeBuffs(core);
      for (const pid of fx.fixed) {
        const out = forceStarter(ut, pid);
        if (out && !memoGet(core, `fx-${pid}`)) memoSet(core, `fx-${pid}`, out); // 고정 출전이 끝나면 되돌린다
      }
      const focus = fx.focus + (userJetLag(core, home) ? JETLAG_FOCUS : 0);
      if (focus || Object.keys(fx.slump).length) restore = applyFocus(ut, focus, fx.slump);
      if (fx.rest.length) rest = new Set(fx.rest);
    }
  }
  // 선수별 기록은 경기 전후의 시즌 누적을 빼서 만든다 (유저 경기만)
  const before = track ? new Map([...away.roster, ...home.roster].map((p) => [p.id, { bat: { ...p.bat }, pit: { ...p.pit } }])) : null;
  const order = track ? ([away, home].map((t) => t.lineup.map((l) => ({ ...l }))) as [Team['lineup'], Team['lineup']]) : null;
  const res = simulateGame(home, away, rng, { track, injMult, focusId: core?.userId, rest, awayEdge, penStyle });
  restore?.();
  if (before && order) res.box = [boxOf(away, order[0], before, res, 0), boxOf(home, order[1], before, res, 1)];
  return res;
}

export function advanceDay(core0: Core, rng: Rng): { core: Core; report: DayReport } {
  if (core0.campaign?.event) throw new Error('이벤트 카드를 먼저 처리하세요');
  if (core0.phase === 'post') {
    const core = structuredClone(core0);
    fillObjectivesMut(core, rng);
    const report = playPostDayMut(core, rng);
    return { core, report };
  }
  if (core0.phase !== 'season' || core0.day >= core0.schedule.length) {
    throw new Error('시즌이 이미 종료되었습니다');
  }
  const core = structuredClone(core0);
  fillObjectivesMut(core, rng);
  const fx = activeBuffs(core);
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
    const weather = weatherFor(core, day, rng);
    const demand = calcDemand(core, { dow, weather, oppPop: opp.pop, noise: clamp(1 + gauss(rng) * NOISE_SD, 0.8, 1.2) });
    const capacity = capacityOf(core);
    const attendance = Math.min(capacity, demand);
    crowd = { attendance, capacity, demand, turnedAway: Math.max(0, demand - capacity), soldOut: demand >= capacity, weather };
  }

  // ── 경기 ──
  const injuredBefore = new Set<string>();
  for (const t of core.teams) {
    fixLineup(t);
    for (const p of t.roster) if (p.injury > 0) injuredBefore.add(p.id);
  }
  let result: DayReport['result'] | undefined;
  const others: DayReport['others'] = [];
  for (const g of games) {
    const home = byId.get(g.homeId)!;
    const away = byId.get(g.awayId)!;
    const isMine = g === mine;
    const res = playGame(core, home, away, rng, isMine);
    applyResult(home, res.home, res.away);
    applyResult(away, res.away, res.home);
    if (isMine) result = res;
    else others.push({ homeId: g.homeId, awayId: g.awayId, home: res.home, away: res.away });
  }
  const res = result!;
  const myRuns = isHome ? res.home : res.away;
  const oppRuns = isHome ? res.away : res.home;
  const won = myRuns === oppRuns ? null : myRuns > oppRuns;
  memoSet(core, 'wl', (memoGet(core, 'wl') ?? '') + (won === null ? 'T' : won ? 'W' : 'L'));
  if (isHome && jetLag(core, day)) notes.push(NEWS.jetLag);

  // ── 부상 회복 / 신규 부상 ──
  for (const t of core.teams) {
    for (const p of t.roster) {
      if (!injuredBefore.has(p.id)) continue;
      p.injury = Math.max(0, p.injury - 1);
      const banned = !!p.ban;
      if (p.ban && (p.ban = Math.min(p.ban - 1, p.injury)) <= 0) delete p.ban;
      if (p.injury === 0 && t.id === core.userId) {
        const msg = banned ? `징계 해제: ${p.name}` : `부상 복귀: ${p.name}`;
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
    hintMut(core, user.roster.find((p) => p.id === j.pid)?.kind === 'P' ? 'pitchers' : 'lineup');
  }
  // 연투 피로가 쌓인 팔이 생기면 투수 탭에 배지 (한 주에 한 번)
  if (user.roster.some((p) => (p.tired ?? 0) >= TIRED_HINT) && (core.campaign.hints?.pitchers ?? 0) < 2 && memoGet(core, 'tiredWeek') !== String(Math.floor(day / WEEK))) {
    memoSet(core, 'tiredWeek', Math.floor(day / WEEK));
    hintMut(core, 'pitchers');
  }

  // ── 재정 ──
  const rankNow = rankOf(core.teams, core.userId);
  const price = f.ticketPrice;
  const att = crowd ? crowd.attendance : 0;
  const ticket = Math.round(att * price * fx.ticket);
  const food = crowd ? Math.round(att * FOOD_LV[core.facilities.food].spend * fx.food * rainFood(core.facilities, crowd.weather, core)) : 0;
  const merch = Math.round(core.fans * MERCH_K * (starPower(user, core.season) / 100) * (isHome ? 1.4 : 0.6) * fx.merch);
  const league = Math.round(perGame(core, (LEAGUE_BASE + core.fans * LEAGUE_PER_FAN + rankUnits(core, rankNow) * LEAGUE_PER_RANK) * leagueMult(core)));
  const salary = Math.round(payroll(user) / core.schedule.length);
  const upkeep =
    (isHome ? SEAT_LV[core.facilities.seats].upkeep + FOOD_LV[core.facilities.food].upkeep + fx.upkeep + projectFx(core).upkeep : 0) +
    Math.round(perGame(core, TRAIN_LV[core.facilities.training].upkeep + farmUpkeep(user) + opsCost(core)));
  const interest = Math.round(loanInterest(core, f.debt) / core.schedule.length);
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
    if (crowd.soldOut) {
      dFans += FAN_SELLOUT;
      core.campaign.sellouts++;
    }
    memoSet(core, 'so', (memoGet(core, 'so') ?? '') + (crowd.soldOut ? '1' : '0'));
    dFans += (core.fanSat - 50) * FAN_SAT_K;
    const l10 = user.rec.last10;
    const form = l10.reduce((s, v) => s + v, 0) / Math.max(1, l10.length);
    const fill = crowd.attendance / crowd.capacity;
    const priceFit = clamp((refPrice(core.facilities, core) / Math.max(0.1, price) - 1) * 40, -15, 10);
    const heat = fill >= 0.95 ? 6 : fill >= 0.8 ? 3 : fill < 0.5 ? -3 : 0;
    const target = clamp(SAT_BASE + FOOD_LV[core.facilities.food].sat + (form - 0.5) * 24 + priceFit + heat, 0, 100);
    core.fanSat = Math.round((core.fanSat + (target - core.fanSat) * SAT_CONVERGE) * 10) / 10;
    core.crowd = crowd;
    core.attHistory.push(crowd.attendance);
    if (crowd.turnedAway > 0) {
      const msg = `매진! 자리가 없어 ${fmtInt(crowd.turnedAway)}명이 발길을 돌렸습니다`;
      notes.push(msg);
      addNews(core, msg, 'info');
      if ((core.campaign.hints?.stadium ?? 0) < 3) hintMut(core, 'stadium');
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

  const debtBefore = f.debt;
  settleCash(core, notes);
  if (f.debt > debtBefore) hintMut(core, 'finance');

  // ── 마무리 ──
  core.day = day + 1;
  const rankAfter = rankOf(core.teams, core.userId);
  if (day >= 8 && rankAfter !== rankBefore) {
    notes.push(rankAfter < rankBefore ? `순위 상승: ${rankBefore}위 → ${rankAfter}위` : `순위 하락: ${rankBefore}위 → ${rankAfter}위`);
  }
  cutGoodsMut(core);
  tickBuffs(core, isHome);
  if (core.day >= core.schedule.length) {
    addNews(core, `정규시즌 ${core.season} 종료 — 최종 ${rankAfter}위 (${user.rec.w}승 ${user.rec.l}패 ${user.rec.t}무)`, 'info');
    refreshProgressMut(core);
    afterRegularSeasonMut(core, rng); // 'post' 또는 (자동 시뮬 후) 'ended' + 결산
  }
  if (core.phase === 'season') subEnqueueMut(core, res.injuries.filter((j) => j.teamId === core.userId).map((j) => j.pid)); // 주전 부상: 대체 선수는 카드에서 고른다
  if (core.phase === 'season') farmDailyMut(core, notes); // 2군 코치의 하루
  if (core.phase === 'season') scriptTickMut(core, rng);
  if (core.phase === 'season') scandalTickMut(core, rng);
  tradeTickMut(core);
  if (core.phase === 'season') armTickMut(core, rng);
  if (core.phase === 'season') ilAutoMut(core, notes); // 경기 뒤 사건으로 생긴 장기 결장도 그날 명단으로
  if (core.phase === 'season' || core.phase === 'post') refreshProgressMut(core);
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
  if (!signingOpen(core0)) return { core: core0, error: '등록 마감 — 스토브리그에 다시 열립니다' };
  if (activeRoster(userTeam(core0)).length >= ROSTER_MAX) return { core: core0, error: `1군이 가득 찼습니다 (${ROSTER_MAX}명) — 먼저 한 명을 2군으로 내리거나 방출하세요` };
  if (fa.foreign && userTeam(core0).roster.filter((p) => p.foreign).length >= FOREIGN_MAX) {
    return { core: core0, error: `외국인 선수는 최대 ${FOREIGN_MAX}명까지 보유할 수 있습니다` };
  }
  if (overLimit(core0)) return { core: core0, error: OVER_LIMIT_ERR };
  const bonus = signingBonus(fa);
  if (core0.finance.cash < bonus) return { core: core0, error: `계약금이 부족합니다 (필요 ${fmtMoney(bonus)})` };

  const core = structuredClone(core0);
  const t = userTeam(core);
  const p = core.freeAgents.find((x) => x.id === pid)!;
  core.freeAgents = core.freeAgents.filter((x) => x.id !== pid);
  core.finance.cash -= bonus;
  core.finance.ledger.signing += bonus;
  p.since = core.season;
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
  const same = p0.farm ? 99 : activeRoster(t0).filter((p) => p.kind === p0.kind).length;
  if (p0.kind === 'B' && same <= MIN_BATTERS) return { core: core0, error: `타자는 최소 ${MIN_BATTERS}명이 필요합니다` };
  if (p0.kind === 'P' && same <= MIN_PITCHERS) return { core: core0, error: `투수는 최소 ${MIN_PITCHERS}명이 필요합니다` };
  const cost = releaseCost(p0, core0);
  if (core0.finance.cash < cost) return { core: core0, error: `잔여 연봉 지급액이 부족합니다 (필요 ${fmtMoney(cost)})` };

  const core = structuredClone(core0);
  const t = userTeam(core);
  const p = t.roster.find((x) => x.id === pid)!;
  t.roster = t.roster.filter((x) => x.id !== pid);
  if (isFranchise(p, core.season)) {
    // 프랜차이즈 스타를 내보내면 팬이 등을 돌린다
    core.fans = Math.max(1000, core.fans - p.star * FRANCHISE_LEAVE_FANS);
    core.fanSat = clamp(core.fanSat + FRANCHISE_LEAVE_SAT, 0, 100);
    addNews(core, NEWS.franchiseGone(p.name), 'bad');
  }
  delete p.since;
  delete p.svc;
  delete p.ask;
  delete p.tired;
  delete p.farm;
  delete p.il;
  delete p.farmUntil;
  delete p.farmStat;
  delete p.subFor;
  delete p.subFrom;
  delete p.armyDue;
  delete p.lever;
  if (p.ban) {
    delete p.ban;
    p.injury = 0;
  }
  if (p.posShift) {
    p.def = clamp(p.def + p.posShift.pen, 20, 99);
    delete p.posShift;
    p.ovr = calcOvr(p);
  }
  core.freeAgents.push(p);
  core.finance.cash -= cost;
  core.finance.ledger.signing += cost;
  fixLineup(t);
  addNews(core, `방출: ${p.name} (잔여 연봉 지급 ${fmtMoney(cost)})`, 'info');
  return { core };
}

/** 1군 → 2군. 내려간 선수는 FARM_LOCK 경기 동안 다시 등록할 수 없다. 부상·징계 중이면 부상자 명단(재활)으로: 2군 정원에 들지 않고, 나을 때까지(최소 IL_MIN 경기) 복귀할 수 없다 */
export function sendDown(core0: Core, pid: string): { core: Core; error?: string } {
  const t0 = userTeam(core0);
  const p0 = t0.roster.find((p) => p.id === pid);
  if (!p0) return { core: core0, error: '우리 팀 선수가 아닙니다' };
  if (p0.farm) return { core: core0, error: '이미 2군에 있습니다' };
  const il = p0.injury > 0;
  if (!il && farmRoster(t0).length >= farmMax(core0)) return { core: core0, error: `2군이 가득 찼습니다 (${farmMax(core0)}명) — 2군에서 한 명을 올리거나 방출하세요` };
  const same = activeRoster(t0).filter((p) => p.kind === p0.kind).length;
  if (p0.kind === 'B' && same <= MIN_BATTERS) return { core: core0, error: `1군 타자는 최소 ${MIN_BATTERS}명이 필요합니다` };
  if (p0.kind === 'P' && same <= MIN_PITCHERS) return { core: core0, error: `1군 투수는 최소 ${MIN_PITCHERS}명이 필요합니다` };
  const core = structuredClone(core0);
  const t = userTeam(core);
  const p = t.roster.find((x) => x.id === pid)!;
  p.farm = true;
  delete p.tired;
  delete p.subFor;
  delete p.subFrom;
  if (il) {
    p.il = true;
    if (core.phase === 'season') p.farmUntil = core.day + ilLock(p);
    fixLineup(t);
    addNews(core, `말소: ${p.name} ${p.ban ? '징계 말소' : '부상자 명단'}${p.farmUntil ? ` (${ilLock(p)}경기 뒤 복귀 가능)` : ''} — 1군 자리 +1`, 'info');
    return { core };
  }
  delete p.il;
  if (core.phase === 'season') p.farmUntil = core.day + FARM_LOCK;
  fixLineup(t);
  addNews(core, `말소: ${p.name} 2군행${p.farmUntil ? ` (${FARM_LOCK}경기 뒤 재등록 가능)` : ''}`, 'info');
  return { core };
}

/** 부상자 명단에 올리면 복귀까지 걸리는 경기 수: 나을 때까지, 최소 IL_MIN */
export const ilLock = (p: Pick<Player, 'injury'>): number => Math.max(IL_MIN, p.injury);

/** 재등록까지 남은 경기 수 (0 = 지금 올릴 수 있다) */
export function farmLockLeft(core: Pick<Core, 'day' | 'phase'>, p: Player): number {
  return core.phase === 'season' && p.farmUntil ? Math.max(0, p.farmUntil - core.day) : 0;
}

/** 2군 → 1군. 1군이 가득이면 먼저 누군가를 내려야 한다 */
export function callUp(core0: Core, pid: string): { core: Core; error?: string } {
  const t0 = userTeam(core0);
  const p0 = t0.roster.find((p) => p.id === pid);
  if (!p0) return { core: core0, error: '우리 팀 선수가 아닙니다' };
  if (!p0.farm) return { core: core0, error: '이미 1군에 있습니다' };
  const left = farmLockLeft(core0, p0);
  if (left > 0) return { core: core0, error: p0.il ? `부상자 명단: ${left}경기 뒤 복귀할 수 있습니다` : `말소 후 ${FARM_LOCK}경기가 지나야 합니다 (${left}경기 남음)` };
  if (activeRoster(t0).length >= ROSTER_MAX) return { core: core0, error: `1군이 가득 찼습니다 (${ROSTER_MAX}명) — 누구를 내릴지 먼저 고르세요` };
  const core = structuredClone(core0);
  const t = userTeam(core);
  const p = t.roster.find((x) => x.id === pid)!;
  const back = !!p.il;
  delete p.farm;
  delete p.il;
  delete p.farmUntil;
  delete p.subFor;
  delete p.subFrom;
  if (!back) markUpMut(core, p);
  const role = slotNewcomer(t, p);
  addNews(core, `${back ? '복귀' : '콜업'}: ${p.name} 1군 등록 (${role})`, 'good');
  return { core };
}

export function upgradeFacility(core0: Core, kind: FacilityKind): { core: Core; error?: string } {
  const cost = upgradeCost(kind, core0.facilities);
  if (cost === null) return { core: core0, error: '이미 최고 단계입니다' };
  if (overLimit(core0)) return { core: core0, error: OVER_LIMIT_ERR };
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
  if (overLimit(core0)) return { core: core0, error: OVER_LIMIT_ERR };
  if (core0.finance.debt + LOAN_STEP > loanLimit(core0)) return { core: core0, error: `대출 한도(${fmtMoney(loanLimit(core0))})를 넘을 수 없습니다` };
  const core = structuredClone(core0);
  core.finance.cash += LOAN_STEP;
  core.finance.debt += LOAN_STEP;
  addNews(core, `${fmtMoney(LOAN_STEP)} 대출 실행 (이자 시즌당 ${fmtMoney(Math.round(loanInterest(core, core.finance.debt)))})`, 'info');
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

/** 그 시즌의 시장 연봉: 리그 인플레는 스타급일수록 크게 붙는다 (OVR 60 이하는 1/4, OVR 80 이상은 전부) */
export function marketSalary(p: Player, season: number): number {
  const w = clamp((p.ovr - 60) / 20, 0.25, 1);
  return Math.round((calcSalary(p) * (1 + (salaryInflation(season) - 1) * w)) / 100) * 100;
}

/** 재계약 프리미엄 배율: 최근 시즌의 가을야구 성적만큼 유저 구단 선수의 몸값이 오른다 */
export function renewPremium(core: Pick<Core, 'campaign'>): number {
  return 1 + core.campaign.history.slice(-RENEW_SEASONS).reduce((s, h) => s + (RENEW_PREMIUM[h.post] ?? 0), 0);
}

/** 나이 +1 과 그에 따른 성장/노쇠, 기록 리셋 */
function develop(p: Player, rng: Rng, season: number): void {
  p.age++;
  delete p.tired;
  delete p.apps;
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
  p.salary = marketSalary(p, season);
  p.star = clamp(Math.round(p.star * 0.75 + (baseStar(p.ovr) + 6) * 0.25), 0, 100);
  p.injury = 0;
  // 뛴 기록이 있으면 지난 시즌 기록으로 옮겨 적는다 (선수 카드)
  if (p.bat.pa > 0 || p.pit.outs > 0) p.prev = { season: season - 1, bat: p.bat, pit: p.pit };
  p.bat = batZero();
  p.pit = pitZero();
}

/** AI 구단 스토브리그: 남은 FA 중 전력 보강 1~2명 영입 후 정원 초과 최하위 방출 (mutate) */
function aiStoveLeague(core: Core, rng: Rng, ctx: Parameters<typeof genPlayer>[0]): void {
  const pool = core.freeAgents.slice().sort((a, b) => b.ovr - a.ovr);
  // 약한 팀부터 고른다 (리그 평준화)
  const ais = standings(core.teams).reverse().filter((t) => t.id !== core.userId);
  for (const t of ais) {
    const n = AI_SIGN_MIN + (rng() < AI_SIGN_EXTRA ? 1 : 0);
    for (let k = 0; k < n; k++) {
      const foreign = t.roster.filter((p) => p.foreign).length;
      const weakest = (kind: 'B' | 'P') => {
        const ids = kind === 'B' ? t.lineup.map((s) => s.pid) : [...t.rotation, ...(t.closer ? [t.closer] : [])];
        const ovrs = t.roster.filter((p) => ids.includes(p.id)).map((p) => p.ovr);
        return ovrs.length ? Math.min(...ovrs) : 0;
      };
      // 전력 tier 에 맞게: 주전 평균보다 크게 뛰어난 대어는 데려가지 않는다
      const tier = teamStrength(t) + AI_SIGN_TIER;
      const i = pool.findIndex((p) => (!p.foreign || foreign < FOREIGN_MAX) && p.ovr >= weakest(p.kind) + AI_SIGN_MARGIN && p.ovr <= tier);
      if (i < 0) break;
      const [p] = pool.splice(i, 1);
      t.roster.push(p);
      autoLineup(t);
      addNews(core, `스토브리그: ${t.name}, FA ${p.name}(${POS_NAME[p.pos] ?? p.pos} 오버롤 ${p.ovr}) 영입`, 'info');
    }
    // 투수가 기준 구성에 못 미치면(투수 10명 시절의 세이브 포함) 남은 FA 구원, 없으면 신인 구원으로 불펜을 채운다
    for (let g = 0; g < 4 && t.roster.filter((p) => p.kind === 'P').length < AI_ROSTER - AI_ROSTER_B; g++) {
      const i = pool.findIndex((p) => p.kind === 'P' && p.pos !== 'SP' && !p.foreign && p.ovr <= teamStrength(t));
      const p = i >= 0 ? pool.splice(i, 1)[0] : genPlayer(ctx, 'RP', 50, { age: randInt(rng, 20, 24), tag: '신인' });
      t.roster.push(p);
    }
    // 정원 초과 → 남는 쪽(타자/투수)의 최하위부터 방출
    while (t.roster.length > AI_ROSTER) {
      const nb = t.roster.filter((p) => p.kind === 'B').length;
      const np = t.roster.length - nb;
      const kind: 'B' | 'P' = nb - AI_ROSTER_B >= np - (AI_ROSTER - AI_ROSTER_B) ? 'B' : 'P';
      if ((kind === 'B' && nb <= MIN_BATTERS) || (kind === 'P' && np <= MIN_PITCHERS)) break;
      const worst = t.roster.filter((p) => p.kind === kind).sort((a, b) => a.ovr - b.ovr || b.age - a.age)[0];
      t.roster = t.roster.filter((p) => p.id !== worst.id);
    }
    autoLineup(t);
  }
}

export function nextSeason(core0: Core, rng: Rng): Core {
  if (core0.phase === 'over') throw new Error(`${OVER_LABEL}이 확정되어 더 이상 시즌을 진행할 수 없습니다`);
  if (core0.phase === 'draft' && !isDraftDone(core0)) throw new Error('드래프트가 아직 끝나지 않았습니다');
  const core = structuredClone(core0);
  const drafted = new Set((core.draft?.log ?? []).map((l) => l.pid));
  const tourPid = memoGet(core, 'retire'); // 은퇴 투어를 한 선수는 나이와 무관하게 유니폼을 벗는다
  const endedSeason = core.season;
  core.season++;
  core.day = 0;
  core.phase = 'season';

  const names = [...core.teams.flatMap((t) => t.roster.map((p) => p.name)), ...core.freeAgents.map((p) => p.name)];
  const ctx = makeCtx(rng, `s${core.season}-`, names);
  const retired: string[] = [];
  const premium = renewPremium(core);
  for (const t of core.teams) {
    t.roster = t.roster.map((p) => {
      if (drafted.has(p.id)) {
        // 갓 지명된 신인: 성장/연봉 재산정 없이 데뷔
        p.rookie = true;
        return p;
      }
      delete p.rookie;
      delete p.farmUntil;
      delete p.farmStat;
      delete p.scout;
      delete p.subFor;
      delete p.subFrom;
  delete p.subFrom;
      if (p.posShift) {
        // 포지션 전향의 수비 페널티는 시즌을 넘기지 않는다
        p.def = clamp(p.def + p.posShift.pen, 20, 99);
        delete p.posShift;
      }
      const franchise = t.id === core.userId && isFranchise(p, endedSeason);
      const alumnus = t.id === core.userId && p.star >= ALUMNI_STAR && p.age >= ALUMNI_AGE - 1;
      const ban = p.ban;
      develop(p, rng, core.season);
      if (ban) p.injury = ban; // 징계는 시즌을 넘겨 이월된다
      if (t.id === core.userId) {
        // 보유 기간 안의 드래프트 출신은 시장가의 일부만 받는다. FA 자격을 얻고도 재계약 카드를 거치지 않았으면 시장가로 자동 재계약
        const yr = AUDIT.svc ? svcYearAt(p, core.season) : null;
        if (yr !== null && yr <= SVC_YEARS) p.salary = svcSalary(p.salary, yr);
        else {
          delete p.svc;
          p.salary = Math.round((p.salary * premium * (p.ask ?? 1)) / 100) * 100;
        }
      }
      if (p.age < RETIRE_AGE && !(t.id === core.userId && p.id === tourPid)) return p;
      // 은퇴 → 같은 포지션 신인으로 충원. 프랜차이즈 스타는 영구결번
      if (t.id === core.userId) {
        retired.push(p.name);
        if (alumnus) core.campaign.alumni = [...(core.campaign.alumni ?? []).slice(-4), { name: p.name, season: endedSeason, pos: p.pos }];
        if (franchise) {
          core.campaign.retired = [...(core.campaign.retired ?? []), { name: p.name, season: endedSeason, pos: p.pos }];
          addNews(core, NEWS.retiredNumber(p.name), 'good');
        }
      }
      const nw = genPlayer(ctx, p.pos, 50, { age: randInt(rng, 19, 22), tag: '신인' });
      if (t.id === core.userId) {
        nw.since = core.season;
        nw.svc = core.season; // 구단이 키우는 신인: 보유 기간 적용
      }
      if (p.farm && (!p.il || activeRoster(t).length >= ROSTER_MAX)) nw.farm = true;
      return nw;
    });
    t.rec = recZero();
    t.nextStarter = 0;
    if (t.id === core.userId) fixLineup(t);
    else autoLineup(t);
  }
  seasonTurnFarmMut(core, rng); // 전역 선수 복귀
  // 지난 시즌 남은 FA 로 AI 스토브리그 → 새 FA 시장
  for (const p of core.freeAgents) develop(p, rng, core.season);
  aiStoveLeague(core, rng, ctx);
  core.freeAgents = genFreeAgents(ctx);
  for (const p of core.freeAgents) p.salary = marketSalary(p, core.season);
  core.schedule = buildSchedule(core.teams.map((t) => t.id), rng);
  core.crowd = null; // 관중 칩·게이트 줄은 개막 전으로
  core.finance.ledger = ledgerZero();
  core.attHistory = [];
  core.cashHistory = [core.finance.cash];
  core.fanSat = Math.round((core.fanSat * 0.7 + 50 * 0.3) * 10) / 10;
  core.post = null;
  core.draft = null;
  for (const n of retired) addNews(core, `${n} 은퇴 — 신인 선수가 자리를 채웁니다`, 'info');
  addNews(core, NEWS.seasonOpen(core.season), 'info');
  projectSeasonOpenMut(core);
  resetSeasonCampaignMut(core, rng);
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
  let pts = Math.round(rankUnits(core, rank)) + 1; // 8구단 눈금 (1위 8점 ~ 꼴찌 1점)
  pts += profit >= 150000 ? 2 : profit >= 50000 ? 1 : profit < -150000 ? -2 : profit < 0 ? -1 : 0;
  if (avgAtt / cap >= 0.9) pts += 1;
  const grade = pts >= 9 ? 'S' : pts >= 7 ? 'A' : pts >= 4 ? 'B' : pts >= 2 ? 'C' : 'D';
  const comment = {
    S: '우승 경쟁에 흑자 경영까지 — 조합원들이 더 바랄 게 없습니다.',
    A: '성적과 살림 모두 훌륭한 시즌. 팬들이 내년을 기다립니다.',
    B: '가능성을 보여준 시즌. 한두 군데만 더 보강하면 가을야구가 보입니다.',
    C: '아직 갈 길이 멉니다. 간판스타와 구장 투자 중 하나에 집중해 보세요.',
    D: '성적도 살림도 빨간불. 연봉 구조와 티켓 가격부터 점검이 필요합니다.',
  }[grade];
  return { mvpBat, mvpPit, grade, comment };
}
