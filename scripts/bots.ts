// 캠페인 봇 4종 (docs/LEVEL_DESIGN.md 11절). scripts/campaign.ts · scripts/economy.ts 가 함께 쓴다.
import type { Core, EventCard, FacilityKind, Player, Team } from '../src/game/types';
import { borrow, callUp, farmLockLeft, releasePlayer, sendDown, repay, setTicketPrice, signPlayer, upgradeFacility } from '../src/game/season';
import {
  FARM_MAX, activeRoster, farmRoster,
  FOOD_LV, LEAGUE_BASE, LEAGUE_PER_FAN, LEAGUE_PER_RANK, LOAN_LIMIT, LOAN_STEP, MERCH_K, ROSTER_MAX, SEAT_LV, TRAIN_LV,
  capacityOf, opsCost, payroll, previewDemand, refPrice, signingBonus, starPower, upgradeCost, userTeam,
} from '../src/game/economy';
import { FOREIGN_MAX } from '../src/game/events';
import { autoBatting, autoPitching, slotValue } from '../src/game/lineup';

// ───────── 동사 ─────────

export type Verb = 'lineup' | 'sign' | 'gate' | 'youth' | 'pitch';
const ALL_VERBS: Verb[] = ['lineup', 'sign', 'gate', 'youth', 'pitch'];
// 장별 주제 동사 (4·5장은 전부)
const THEME: Verb[][] = [['lineup', 'sign'], ['gate'], ['youth'], ['pitch'], ALL_VERBS, ALL_VERBS];
const themeOf = (c: Core) => THEME[Math.min(c.campaign.stage, THEME.length - 1)];

const ok = (r: { core: Core; error?: string }, c: Core) => (r.error ? c : r.core);
const enabled = (card: EventCard, i: number) => !!card.choices[i] && !card.choices[i].disabled;
const firstEnabled = (card: EventCard, pref: number[]) => pref.find((i) => enabled(card, i)) ?? card.choices.map((_, i) => i).reverse().find((i) => enabled(card, i)) ?? 0;
const SCOUT_V: Record<string, number> = { A: 84, B: 74, C: 65, D: 57 };
export const baseId = (card: EventCard) => card.id.split('|')[0];
const foreignN = (c: Core) => userTeam(c).roster.filter((p) => p.foreign).length;
const mutTeam = (c0: Core, fn: (t: Team, c: Core) => void): Core => {
  const c = structuredClone(c0);
  fn(userTeam(c), c);
  return c;
};

/** 가장 약한 주전 OVR (타선 / 선발 로테이션 / 불펜+마무리) */
function weakest(c: Core, p: Player): number {
  const t = userTeam(c);
  const ids = p.kind === 'B' ? t.lineup.map((s) => s.pid) : p.pos === 'SP' ? t.rotation : [...t.bullpen.slice(0, 4), ...(t.closer ? [t.closer] : [])];
  const ovrs = t.roster.filter((x) => ids.includes(x.id)).map((x) => x.ovr);
  return ovrs.length ? Math.min(...ovrs) : 0;
}

/** 로스터 정리: 시즌 종료 후(위약금 0) 노장·저능력 선수를 target 명까지 방출 */
function trimRoster(c: Core, target: number): Core {
  let core = c;
  for (let g = 0; g < 10 && activeRoster(userTeam(core)).length > target; g++) {
    const t = userTeam(core);
    const inUse = new Set([...t.lineup.map((s) => s.pid), ...t.rotation, ...(t.closer ? [t.closer] : [])]);
    const cand = activeRoster(t).filter((p) => !inUse.has(p.id)).sort((a, b) => a.ovr + (a.pot - a.ovr) * 0.5 - a.age * 0.5 - (b.ovr + (b.pot - b.ovr) * 0.5 - b.age * 0.5))[0];
    if (!cand) break;
    const r = releasePlayer(core, cand.id);
    if (r.error) break;
    core = r.core;
  }
  return core;
}

/** 2군 운영 (sensible): 2군 선수가 그 자리 1군 주전보다 나아지면 콜업. 1군이 가득이면 가장 약한 벤치를 내리거나 방출한다 */
function farmMoves(c0: Core): Core {
  let c = c0;
  for (const k of farmRoster(userTeam(c)).sort((a, b) => b.ovr - a.ovr)) {
    const t = userTeam(c);
    if (k.injury > 0 || farmLockLeft(c, k) > 0) continue;
    const cur = k.kind === 'B' ? (t.roster.find((p) => p.id === t.lineup.find((s) => s.pos === k.pos)?.pid)?.ovr ?? 0) : weakest(c, k);
    if (k.ovr <= cur) continue;
    if (activeRoster(t).length >= ROSTER_MAX) {
      const inUse = new Set([...t.lineup.map((s) => s.pid), ...t.rotation, ...t.bullpen.slice(0, 4), ...(t.closer ? [t.closer] : [])]);
      const out = activeRoster(t).filter((p) => p.kind === k.kind && !inUse.has(p.id) && p.injury === 0).sort((a, b) => a.ovr - b.ovr)[0];
      if (!out) continue;
      const young = out.age <= 25 && out.pot > out.ovr + 3;
      const r = young ? sendDown(c, out.id) : releasePlayer(c, out.id);
      const r2 = r.error && !young ? sendDown(c, out.id) : r;
      if (r2.error) continue;
      c = r2.core;
    }
    c = ok(callUp(c, k.id), c);
  }
  return c;
}

/** 2군 정리 (sensible, 시즌 종료 후): 지명할 자리를 남기고 가망 없는 2군 선수를 방출 */
function trimFarm(c0: Core, target: number): Core {
  let c = c0;
  for (let g = 0; g < 10 && farmRoster(userTeam(c)).length > target; g++) {
    const out = farmRoster(userTeam(c)).sort((a, b) => a.pot - a.age - (b.pot - b.age))[0];
    const r = releasePlayer(c, out.id);
    if (r.error) break;
    c = r.core;
  }
  return c;
}

const RESERVE = 50000; // 5억 비상금
// 연봉 상한: 기본 30억 + 장 보정 + 여유 현금(15억 초과분)의 절반까지 — 빚은 내지 않는다
/** 이번 시즌 예상 수입 − 고정비 (연봉 제외). 지금 구장·팬·표값 기준의 어림 */
function expectedMargin(c: Core): number {
  const t = userTeam(c);
  const att = Math.min(capacityOf(c), previewDemand(c) * 1.08);
  const gate = 42 * att * (c.finance.ticketPrice + FOOD_LV[c.facilities.food].spend);
  const league = 84 * (LEAGUE_BASE + c.fans * LEAGUE_PER_FAN + 3 * LEAGUE_PER_RANK);
  const merch = 84 * c.fans * MERCH_K * (starPower(t, c.season) / 100);
  const fixed = 42 * (SEAT_LV[c.facilities.seats].upkeep + FOOD_LV[c.facilities.food].upkeep) + 84 * (TRAIN_LV[c.facilities.training].upkeep + opsCost(c)) + c.finance.debt * 0.08;
  return gate + league + merch - fixed;
}
// 연봉 상한: 초반엔 보수적으로(기본 38억 + 장 보정 + 여유 현금의 60%), 커진 뒤엔 벌이 안에서(예상 수입 − 고정비 + 쌓아 둔 현금 40억 초과분의 절반). 빚은 내지 않는다
const PAYROLL_CAP = (c: Core) =>
  Math.min(
    380000 + c.campaign.stage * 70000 + Math.max(0, c.finance.cash - 150000) * 0.6 + Math.max(0, c.finance.cash - 600000) * 0.4,
    Math.max(380000, expectedMargin(c) * 0.95) + Math.max(0, c.finance.cash - 400000) * 0.5,
  );

/** 연봉이 상한을 넘으면(인플레·재계약 프리미엄) 비싼 비주전부터, 그다음 몸값 못 하는 주전을 내보낸다. grow = 다음 시즌 예상 인상률 */
function shedPayroll(c0: Core, grow = 1): Core {
  let c = c0;
  for (let g = 0; g < 8 && payroll(userTeam(c)) * grow > PAYROLL_CAP(c) * 1.03; g++) {
    const t = userTeam(c);
    const key = new Set([...t.lineup.map((s) => s.pid), ...t.rotation, ...(t.closer ? [t.closer] : [])]);
    const idle = t.roster.filter((p) => !key.has(p.id) && p.salary >= 10000).sort((a, b) => b.salary - a.salary);
    const over = t.roster.filter((p) => key.has(p.id) && p.salary >= 50000).sort((a, b) => b.salary / Math.pow(Math.max(1, b.ovr - 55), 1.5) - a.salary / Math.pow(Math.max(1, a.ovr - 55), 1.5));
    const cand = idle[0] ?? over[0];
    if (!cand) break;
    const r = releasePlayer(c, cand.id);
    if (r.error) break;
    c = r.core;
  }
  return c;
}

/** lineup: 타순을 실력대로. pitch 동사를 쓰지 않으면 투수 보직은 건드리지 않는다 (0장의 고장 난 편성은 예외로 한 번 고친다) */
function doLineup(c: Core, pitching: boolean): Core {
  return mutTeam(c, (t) => {
    autoBatting(t);
    if (pitching) {
      autoPitching(t);
      coverRotation(t);
    }
  });
}

/** pitch: 부상 중인 선발의 순번을 건강한 투수(선발 자원 우선)로 메운다 — 임시 선발로 불펜을 태우지 않는다 */
function coverRotation(t: Team): void {
  const byId = new Map(t.roster.map((p) => [p.id, p]));
  t.rotation.forEach((id, i) => {
    if ((byId.get(id)?.injury ?? 0) === 0) return;
    const pen = t.bullpen.map((x) => byId.get(x)).filter((p): p is Player => !!p && p.injury === 0);
    const sub = pen.sort((a, b) => (b.pos === 'SP' ? 100 : 0) + b.sta + b.ovr * 0.5 - ((a.pos === 'SP' ? 100 : 0) + a.sta + a.ovr * 0.5))[0];
    if (!sub || (sub.pos !== 'SP' && pen.length <= 3)) return;
    t.rotation[i] = sub.id;
    t.bullpen[t.bullpen.indexOf(sub.id)] = id;
  });
}

/** youth: 주전과 OVR 차이가 작은 25세 이하 유망주를 그 자리에 쓴다 */
function playYoung(c: Core): Core {
  return mutTeam(c, (t) => {
    const byId = new Map(t.roster.map((p) => [p.id, p]));
    const inLu = new Set(t.lineup.map((s) => s.pid));
    const young = t.roster.filter((p) => p.kind === 'B' && !p.farm && !inLu.has(p.id) && p.age <= 25 && p.pot >= p.ovr + 5 && p.injury === 0).sort((a, b) => b.pot - a.pot);
    for (const y of young.slice(0, 2)) {
      const slot = t.lineup.find((s) => {
        const cur = byId.get(s.pid);
        return !!cur && cur.age > 25 && (s.pos === y.pos || s.pos === 'DH') && slotValue(cur, s.pos) - slotValue(y, s.pos) <= 5;
      });
      if (slot) slot.pid = y.id;
    }
  });
}

/** sign: 약한 자리를 메우는 준척 위주. 연봉 상한과 비상금을 지킨다 */
function doSign(c0: Core, n: number, only?: 'B' | 'P'): Core {
  let c = c0;
  for (let k = 0; k < n; k++) {
    if (activeRoster(userTeam(c)).length >= ROSTER_MAX) c = trimRoster(c, ROSTER_MAX - 1);
    const pay = payroll(userTeam(c));
    // 가을의 끝을 노리는 장(3장~)에서는 여윳돈이 덜 쌓여도 대어를 본다
    const rich = c.finance.cash > (c.campaign.stage >= 3 ? 250000 : 400000);
    const score = (p: Player) => (p.ovr - weakest(c, p)) * (p.kind === 'B' || p.pos === 'SP' ? 1 : 0.45) - (rich ? 0 : p.salary / 15000);
    const cand = c.freeAgents
      .filter((p) => !only || p.kind === only)
      .filter((p) => !p.foreign || foreignN(c) < FOREIGN_MAX)
      .filter((p) => p.ovr >= weakest(c, p) + 5)
      .filter((p) => pay + p.salary <= PAYROLL_CAP(c) && c.finance.cash - signingBonus(p) >= RESERVE)
      // 주전 타자·선발의 구멍을 먼저(불펜은 덜 급하다). 살림이 빠듯하면 연봉 1.5억을 OVR 1 로 친다
      .sort((a, b) => score(b) - score(a));
    if (!cand.length) break;
    const r = signPlayer(c, cand[0].id);
    if (r.error) break;
    c = r.core;
  }
  return c;
}

const recentFull = (c: Core) => c.attHistory.length >= 4 && c.attHistory.slice(-8).filter((a) => a >= capacityOf(c) * 0.97).length >= Math.min(4, c.attHistory.slice(-8).length / 2);

/** gate: 표값을 수요에 맞추고, 자리가 모자라면 관중석을, 여유가 있으면 매점을 올린다 */
function doGate(c0: Core): Core {
  let c = c0;
  const flag = c.campaign.objectives.find((o) => o.main);
  const needCap = flag?.kind === 'avgAtt' ? flag.target : 0;
  for (let g = 0; g < 3; g++) {
    const cost = upgradeCost('seats', c.facilities);
    const cap = SEAT_LV[c.facilities.seats].cap;
    const want = cap < needCap * 1.15 || recentFull(c) || previewDemand(setTicketPrice(c, refPrice(c.facilities))) > cap * 1.1;
    if (cost === null || !want || c.finance.cash - cost < RESERVE) break;
    c = ok(upgradeFacility(c, 'seats'), c);
  }
  const fcost = upgradeCost('food', c.facilities);
  if (fcost !== null && c.facilities.food <= c.facilities.seats && c.finance.cash - fcost >= RESERVE * 2) c = ok(upgradeFacility(c, 'food'), c);
  // 현금이 넉넉히 쌓였으면 다음 단계 관중석을 미리 올린다
  const scost = upgradeCost('seats', c.facilities);
  if (scost !== null && c.finance.cash - scost >= 500000) c = ok(upgradeFacility(c, 'seats'), c);
  // 표값: 적정가에서 시작해 수요가 좌석을 넘으면 올리고, 많이 비면 내린다
  const ref = refPrice(c.facilities);
  let price = ref;
  const cap = capacityOf(c);
  while (price < ref * 1.4 && previewDemand(setTicketPrice(c, price + 0.1)) > cap * 1.05) price += 0.1;
  // 깃발이 관중 수라면 표값을 내려서라도 채운다. 아니면 많이 빌 때만 조금 내린다
  const fill = needCap ? Math.min(cap, needCap * 1.12) : cap * 0.7;
  const floor = needCap ? ref * 0.6 : ref * 0.9;
  while (price > floor && previewDemand(setTicketPrice(c, price)) < fill) price -= 0.1;
  return setTicketPrice(c, price);
}

/** youth: 훈련장 */
function doTraining(c: Core): Core {
  const cost = upgradeCost('training', c.facilities);
  if (cost === null || c.finance.cash - cost < RESERVE) return c;
  return ok(upgradeFacility(c, 'training'), c);
}

/** pitch: 불펜 깊이 — 불펜 5번째 팔보다 나은 구원 FA 를 한 명 채운다 */
function doPen(c: Core): Core {
  const t = userTeam(c);
  if (t.roster.filter((p) => p.kind === 'P').length >= 13) return c;
  const pen = t.roster.filter((p) => t.bullpen.includes(p.id)).sort((a, b) => b.ovr - a.ovr);
  const bar = pen[4]?.ovr ?? 0;
  const cand = c.freeAgents
    .filter((p) => p.kind === 'P' && p.pos !== 'SP' && p.ovr >= bar + 4 && (!p.foreign || foreignN(c) < FOREIGN_MAX))
    .filter((p) => payroll(t) + p.salary <= PAYROLL_CAP(c) + 30000 && c.finance.cash - signingBonus(p) >= RESERVE)
    .sort((a, b) => b.ovr - a.ovr)[0];
  if (!cand) return c;
  let core = c;
  if (activeRoster(t).length >= ROSTER_MAX) core = trimRoster(core, ROSTER_MAX - 1);
  return ok(signPlayer(core, cand.id), core);
}

function bestProspect(c: Core, score: (p: Player) => number): string | null {
  if (!c.draft || farmRoster(userTeam(c)).length >= FARM_MAX) return null;
  const p = c.draft.pool.slice().sort((a, b) => score(b) - score(a))[0];
  return p ? p.id : null;
}

// ───────── 봇 정의 ─────────

export interface Bot {
  name: string;
  preseason(c: Core): Core;
  daily(c: Core): Core; // 매 경기 전
  event(c: Core, card: EventCard): number;
  beforeDraft(c: Core): Core;
  draft(c: Core): string | null; // pid 또는 패스
}

export const passive: Bot = {
  name: 'passive',
  preseason: (c) => c,
  daily: (c) => c,
  // 감독·팀장이 하자는 대로(첫 선택지), 그 외에는 아무것도 하지 않는 쪽(마지막)
  event: (_c, card) => firstEnabled(card, baseId(card) === 'veteran' ? [0] : [card.choices.length - 1]),
  beforeDraft: (c) => c,
  draft: () => null,
};

const PLEDGE_TRUST = 70; // 이 지지 이상일 때만 중간 점검에서 목표 상향을 약속한다
// 카드별 선택 (기본) — 동사를 쓰는 쪽
const USE: Record<string, number[]> = {
  midcheck: [0],
  dome: [0], veteran: [1], oldeye: [1], notyet: [0], arm: [0], typhoon: [1],
  meeting: [0], scalper: [0, 2], early: [1], goods: [0, 1], trade: [0], tourist: [0], tour: [0, 1], raise: [0],
};
// 그 동사를 쓰지 않을 때의 선택
const SKIP: Record<string, { verb: Verb; pick: number[] }> = {
  veteran: { verb: 'lineup', pick: [0] },
  oldeye: { verb: 'sign', pick: [1] },
  trade: { verb: 'sign', pick: [1] },
  scalper: { verb: 'gate', pick: [1] },
  tourist: { verb: 'gate', pick: [1] },
  notyet: { verb: 'youth', pick: [1] },
  arm: { verb: 'pitch', pick: [1] },
};

function verbBot(name: string, verbs: (c: Core) => Set<Verb>, drafts: (c: Core) => boolean): Bot {
  const act = (c0: Core, pre: boolean): Core => {
    const v = verbs(c0);
    let c = c0;
    const day = c.day;
    const weekly = pre || day % 6 === 0;
    if (!weekly && day !== 13) return c;
    if (pre) while (c.finance.debt > 0 && c.finance.cash > RESERVE * 3) c = ok(repay(c), c);
    if (pre && v.has('sign')) c = shedPayroll(c);
    if (v.has('gate') && (pre || day % 12 === 0)) c = doGate(c);
    if (v.has('youth') && (pre || day % 12 === 0)) c = doTraining(c);
    if (v.has('sign') && (pre || day === 13 || day === 42)) c = doSign(c, pre ? 3 : 1);
    if (v.has('pitch') && (pre || day === 42)) c = doPen(c);
    // 투수 보직은 3장 전까지는 "편성"(lineup)의 일부, 3장부터는 "투수 운용"(pitch)의 일
    const pitchVerb: Verb = c.campaign.stage < 3 ? 'lineup' : 'pitch';
    if (v.has('lineup')) c = doLineup(c, v.has(pitchVerb));
    else if (v.has(pitchVerb))
      c = mutTeam(c, (t) => {
        autoPitching(t);
        coverRotation(t);
      });
    if (name === 'sensible') c = farmMoves(c);
    if (v.has('youth') && v.has('lineup') && c.campaign.stage >= 2) c = playYoung(c);
    return c;
  };
  return {
    name,
    preseason: (c) => act(c, true),
    daily: (c) => act(c, false),
    event: (c, card) => {
      const id = baseId(card);
      const v = verbs(c);
      // 목표 상향 약속은 실패하면 지지를 크게 잃는다 — 지지에 여유가 있을 때만 건다
      if (id === 'midcheck') return firstEnabled(card, card.id.endsWith('ahead') ? (c.campaign.trust >= PLEDGE_TRUST ? [0] : [1]) : [1]);
      // FA 자격 재계약: 주전·필승조이거나 그 자리 주전보다 나으면 잡고, 아니면 보낸다
      if (id === 'resign') {
        const t = userTeam(c);
        const p = t.roster.find((x) => x.id === card.pid);
        const key = new Set([...t.lineup.map((s) => s.pid), ...t.rotation, ...t.bullpen.slice(0, 4), ...(t.closer ? [t.closer] : [])]);
        return firstEnabled(card, p && (key.has(p.id) || p.ovr >= weakest(c, p)) ? [0] : [1, 0]);
      }
      const skip = SKIP[id];
      if (skip && !v.has(skip.verb)) return firstEnabled(card, skip.pick);
      return firstEnabled(card, USE[id] ?? [card.choices.length - 1]);
    },
    // 시즌이 끝난 직후(위약금 없음)에 내년 몸값을 내다보고 정리한다
    beforeDraft: (c) => (name === 'sensible' ? trimFarm(trimRoster(verbs(c).has('sign') ? shedPayroll(c, 1.12) : c, 26), FARM_MAX - 3) : trimRoster(verbs(c).has('sign') ? shedPayroll(c, 1.12) : c, 25)),
    // 지명은 매년 돌아오는 일이라 주제와 무관하게 한다. youth 를 쓰는 봇은 잠재력을, 아니면 즉전감을 본다
    draft: (c) => (drafts(c) ? bestProspect(c, (p) => (verbs(c).has('youth') ? SCOUT_V[p.scout ?? 'C'] * 0.65 + p.ovr * 0.35 : SCOUT_V[p.scout ?? 'C'] * 0.4 + p.ovr * 0.6)) : null),
  };
}

// sensible: 지금 장과 지나온 장의 주제 동사
export const sensible = verbBot('sensible', (c) => new Set(THEME.slice(0, Math.min(c.campaign.stage, THEME.length - 1) + 1).flat()), () => true);
// off-verb: 지금 장의 주제 동사만 빼고 전부
export const offVerb = verbBot('off-verb', (c) => new Set(ALL_VERBS.filter((v) => !themeOf(c).includes(v))), (c) => !themeOf(c).includes('youth'));

function greedySign(c0: Core): Core {
  let c = c0;
  for (let n = 0; n < 3; n++) {
    if (activeRoster(userTeam(c)).length >= ROSTER_MAX) c = trimRoster(c, ROSTER_MAX - 1);
    const star = c.freeAgents.filter((p) => !p.foreign || foreignN(c) < FOREIGN_MAX).sort((a, b) => b.star - a.star || b.ovr - a.ovr)[0];
    if (!star || star.star < 60) break;
    while (c.finance.cash < signingBonus(star) && c.finance.debt + LOAN_STEP <= LOAN_LIMIT) c = ok(borrow(c), c);
    const r = signPlayer(c, star.id);
    if (r.error) break;
    c = r.core;
  }
  return c;
}

export const greedy: Bot = {
  name: 'greedy',
  preseason: (c0) => {
    let c = setTicketPrice(c0, refPrice(c0.facilities) * 1.1);
    c = greedySign(c);
    const cost = upgradeCost('seats', c.facilities);
    if (cost !== null) {
      while (c.finance.cash < cost && c.finance.debt + LOAN_STEP <= LOAN_LIMIT) c = ok(borrow(c), c);
      c = ok(upgradeFacility(c, 'seats'), c);
    }
    return doLineup(c, true);
  },
  daily: (c) => (c.day === 42 ? doLineup(greedySign(c), true) : c.day % 12 === 0 ? doLineup(c, true) : c),
  event: (_c, card) => firstEnabled(card, [0]),
  beforeDraft: (c) => trimRoster(c, 25),
  draft: (c) => bestProspect(c, (p) => p.ovr),
};

export const BOTS = [passive, sensible, greedy, offVerb];
