// 캠페인 봇 검증 (docs/LEVEL_DESIGN.md 11절). 순수 함수만 사용 — 스토어 미사용.
// 실행: npm run campaign  (인자: 시드 수, 시즌 수 → npx tsx scripts/campaign.ts 12 12)
//
// 4봇:
//   passive  — 아무것도 안 한다 (감독에게 맡김)
//   sensible — 그 장(과 지나온 장)의 주제 동사를 상식적으로 쓴다
//   greedy   — 스타 FA 올인 + 대출 한도
//   off-verb — 그 장의 주제 동사만 빼고 다 한다 (주제 동사가 실제 열쇠인지 검증)
// 동사: lineup(타순·편성) · sign(영입) · gate(가격·관중석·매점) · youth(훈련장·지명·젊은 선수 기용) · pitch(투수 운용)
import type { Core, EventCard, FacilityKind, Player, Team } from '../src/game/types';
import { mulberry32, type Rng } from '../src/game/rng';
import { newCore } from '../src/game/generate';
import { advanceDay, borrow, nextSeason, rankOf, releasePlayer, repay, setTicketPrice, signPlayer, upgradeFacility } from '../src/game/season';
import {
  FOOD_LV, LEAGUE_BASE, LEAGUE_PER_FAN, LEAGUE_PER_RANK, LOAN_LIMIT, LOAN_STEP, MERCH_K, ROSTER_MAX, SEAT_LV, TRAIN_LV,
  capacityOf, opsCost, payroll, previewDemand, refPrice, signingBonus, starPower, upgradeCost, userTeam,
} from '../src/game/economy';
import { ensureObjectives, STAGES } from '../src/game/campaign';
import { maybeDrawEvent, resolveEvent, FOREIGN_MAX } from '../src/game/events';
import { closeBriefing, drawBriefing } from '../src/game/briefing';
import { beginDraft, draftPick, draftSkip, isDraftDone, isUserTurn } from '../src/game/draft';
import { autoBatting, autoPitching, slotValue } from '../src/game/lineup';
import { fmtMoney } from '../src/game/format';

const N_SEEDS = Number(process.argv[2]) || 12;
const N_SEASONS = Number(process.argv[3]) || 12;
const AB_REPS = process.argv[4] !== undefined ? Number(process.argv[4]) : 2; // A/B 분기 반복 수 (0 = 끔)

// ───────── 동사 ─────────

type Verb = 'lineup' | 'sign' | 'gate' | 'youth' | 'pitch';
const ALL_VERBS: Verb[] = ['lineup', 'sign', 'gate', 'youth', 'pitch'];
// 장별 주제 동사 (4·5장은 전부)
const THEME: Verb[][] = [['lineup', 'sign'], ['gate'], ['youth'], ['pitch'], ALL_VERBS, ALL_VERBS];
const themeOf = (c: Core) => THEME[Math.min(c.campaign.stage, THEME.length - 1)];

const ok = (r: { core: Core; error?: string }, c: Core) => (r.error ? c : r.core);
const enabled = (card: EventCard, i: number) => !!card.choices[i] && !card.choices[i].disabled;
const firstEnabled = (card: EventCard, pref: number[]) => pref.find((i) => enabled(card, i)) ?? card.choices.map((_, i) => i).reverse().find((i) => enabled(card, i)) ?? 0;
const SCOUT_V: Record<string, number> = { A: 84, B: 74, C: 65, D: 57 };
const baseId = (card: EventCard) => card.id.split('|')[0];
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
  for (let g = 0; g < 10 && userTeam(core).roster.length > target; g++) {
    const t = userTeam(core);
    const inUse = new Set([...t.lineup.map((s) => s.pid), ...t.rotation, ...(t.closer ? [t.closer] : [])]);
    const cand = t.roster.filter((p) => !inUse.has(p.id)).sort((a, b) => a.ovr + (a.pot - a.ovr) * 0.5 - a.age * 0.5 - (b.ovr + (b.pot - b.ovr) * 0.5 - b.age * 0.5))[0];
    if (!cand) break;
    const r = releasePlayer(core, cand.id);
    if (r.error) break;
    core = r.core;
  }
  return core;
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
    const young = t.roster.filter((p) => p.kind === 'B' && !inLu.has(p.id) && p.age <= 25 && p.pot >= p.ovr + 5 && p.injury === 0).sort((a, b) => b.pot - a.pot);
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
    if (userTeam(c).roster.length >= ROSTER_MAX) c = trimRoster(c, ROSTER_MAX - 1);
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
  if (t.roster.length >= ROSTER_MAX) core = trimRoster(core, ROSTER_MAX - 1);
  return ok(signPlayer(core, cand.id), core);
}

function bestProspect(c: Core, score: (p: Player) => number): string | null {
  if (!c.draft || userTeam(c).roster.length >= ROSTER_MAX) return null;
  const p = c.draft.pool.slice().sort((a, b) => score(b) - score(a))[0];
  return p ? p.id : null;
}

// ───────── 봇 정의 ─────────

interface Bot {
  name: string;
  preseason(c: Core): Core;
  daily(c: Core): Core; // 매 경기 전
  event(c: Core, card: EventCard): number;
  beforeDraft(c: Core): Core;
  draft(c: Core): string | null; // pid 또는 패스
}

const passive: Bot = {
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
      const skip = SKIP[id];
      if (skip && !v.has(skip.verb)) return firstEnabled(card, skip.pick);
      return firstEnabled(card, USE[id] ?? [card.choices.length - 1]);
    },
    // 시즌이 끝난 직후(위약금 없음)에 내년 몸값을 내다보고 정리한다
    beforeDraft: (c) => trimRoster(verbs(c).has('sign') ? shedPayroll(c, 1.12) : c, 25),
    // 지명은 매년 돌아오는 일이라 주제와 무관하게 한다. youth 를 쓰는 봇은 잠재력을, 아니면 즉전감을 본다
    draft: (c) => (drafts(c) ? bestProspect(c, (p) => (verbs(c).has('youth') ? SCOUT_V[p.scout ?? 'C'] * 0.65 + p.ovr * 0.35 : SCOUT_V[p.scout ?? 'C'] * 0.4 + p.ovr * 0.6)) : null),
  };
}

// sensible: 지금 장과 지나온 장의 주제 동사
const sensible = verbBot('sensible', (c) => new Set(THEME.slice(0, Math.min(c.campaign.stage, THEME.length - 1) + 1).flat()), () => true);
// off-verb: 지금 장의 주제 동사만 빼고 전부
const offVerb = verbBot('off-verb', (c) => new Set(ALL_VERBS.filter((v) => !themeOf(c).includes(v))), (c) => !themeOf(c).includes('youth'));

function greedySign(c0: Core): Core {
  let c = c0;
  for (let n = 0; n < 3; n++) {
    if (userTeam(c).roster.length >= ROSTER_MAX) c = trimRoster(c, ROSTER_MAX - 1);
    const star = c.freeAgents.filter((p) => !p.foreign || foreignN(c) < FOREIGN_MAX).sort((a, b) => b.star - a.star || b.ovr - a.ovr)[0];
    if (!star || star.star < 60) break;
    while (c.finance.cash < signingBonus(star) && c.finance.debt + LOAN_STEP <= LOAN_LIMIT) c = ok(borrow(c), c);
    const r = signPlayer(c, star.id);
    if (r.error) break;
    c = r.core;
  }
  return c;
}

const greedy: Bot = {
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

const BOTS = [passive, sensible, greedy, offVerb];

// ───────── 실행 ─────────

interface SeasonSnap {
  rank: number;
  cash: number;
  debt: number;
  fans: number;
  seats: number;
  trust: number;
  stage: number; // 그 시즌에 치른 장
  cleared: boolean;
  avgAtt: number;
  payroll: number;
  profit: number;
  name: string;
}

interface Run {
  reach: (number | null)[]; // reach[k] = 장 k 에 처음 도달한 시즌 (k=1..5)
  champ: number | null;
  over: number | null;
  forcedSale: boolean;
  snaps: SeasonSnap[];
  stars: string[];
  events: number;
  cards: Record<string, number>;
  postGames: number;
  drafted: number;
  retired: number;
  crash: string | null;
}

// 주간 브리핑 실측: 시즌당 유저에게 오는 결정 수 (브리핑 제안 + 이벤트 카드)
const BRIEF = { seasons: 0, briefs: 0, offers: 0, byWho: {} as Record<string, { seasons: number; offers: number; cards: number }> };
process.on('exit', () => {
  if (!BRIEF.seasons) return;
  console.log(`\n주간 브리핑(전부 넘김): 시즌당 브리핑 ${(BRIEF.briefs / BRIEF.seasons).toFixed(1)}회 · 제안 ${(BRIEF.offers / BRIEF.seasons).toFixed(1)}장`);
  for (const [k, v] of Object.entries(BRIEF.byWho)) console.log(`  ${k}: 시즌당 제안 ${(v.offers / v.seasons).toFixed(1)}장 + 카드 ${(v.cards / v.seasons).toFixed(1)}장 = 결정 ${((v.offers + v.cards) / v.seasons).toFixed(1)}회 (${v.seasons}시즌)`);
});

/** 한 시즌(정규 + 포스트시즌)을 끝까지. 결산이 끝난 Core 를 돌려준다 */
function playSeason(bot: Bot, c0: Core, rng: Rng, run?: Run): Core {
  let c = bot.preseason(c0);
  let guard = 0;
  while (c.phase === 'season' || c.phase === 'post') {
    if (++guard > 400) throw new Error('무한 루프 의심');
    if (c.campaign.event) {
      const card = c.campaign.event;
      const r = resolveEvent(c, bot.event(c, card), rng);
      if (r.error) throw new Error(`이벤트 해소 실패: ${card.id} ${r.error}`);
      c = r.core;
      (BRIEF.byWho[bot.name] = BRIEF.byWho[bot.name] ?? { seasons: 0, offers: 0, cards: 0 }).cards++;
      if (run) {
        run.events++;
        run.cards[baseId(card)] = (run.cards[baseId(card)] ?? 0) + 1;
      }
      continue;
    }
    // 주간 브리핑: 봇은 제안을 전부 넘긴다 (브리핑은 로직 수치를 바꾸지 않는다)
    if (c.campaign.briefing) {
      BRIEF.briefs++;
      BRIEF.offers += c.campaign.briefing.offers.length;
      BRIEF.byWho[bot.name] = BRIEF.byWho[bot.name] ?? { seasons: 0, offers: 0, cards: 0 };
      BRIEF.byWho[bot.name].offers += c.campaign.briefing.offers.length;
      c = closeBriefing(c);
      continue;
    }
    if (c.phase === 'season') c = bot.daily(c);
    const r = advanceDay(c, rng);
    if (run && r.report.post) run.postGames++;
    if (run && r.report.notes.some((n) => n.includes('강제 매각'))) run.forcedSale = true;
    c = drawBriefing(maybeDrawEvent(r.core, rng));
  }
  BRIEF.seasons++;
  (BRIEF.byWho[bot.name] = BRIEF.byWho[bot.name] ?? { seasons: 0, offers: 0, cards: 0 }).seasons++;
  return c;
}

// A/B 분기: sensible 이 도달한 각 시즌의 출발 상태에서, 그 한 시즌만 sensible / off-verb 로 따로 돌려 깃발 달성을 비교한다
const AB: { stage: number; a: boolean; b: boolean }[] = [];

function runOne(bot: Bot, seed: number): Run {
  const rng: Rng = mulberry32(seed * 7919 + 101);
  const run: Run = { reach: [null, null, null, null, null, null], champ: null, over: null, forcedSale: false, snaps: [], stars: [], events: 0, cards: {}, postGames: 0, drafted: 0, retired: 0, crash: null };
  let c = ensureObjectives(newCore(seed), rng);
  try {
    for (let s = 1; s <= N_SEASONS; s++) {
      if (bot === sensible) {
        const last = (x: Core) => x.campaign.history[x.campaign.history.length - 1].cleared;
        for (let k = 0; k < AB_REPS; k++) {
          const fa = playSeason(sensible, c, mulberry32(seed * 104729 + s * 977 + k * 31));
          const fb = playSeason(offVerb, c, mulberry32(seed * 104729 + s * 977 + k * 31));
          AB.push({ stage: c.campaign.stage, a: last(fa), b: last(fb) });
        }
      }
      c = playSeason(bot, c, rng, run);
      const h = c.campaign.history[c.campaign.history.length - 1];
      run.snaps.push({
        rank: rankOf(c.teams, c.userId),
        cash: c.finance.cash,
        debt: c.finance.debt,
        fans: c.fans,
        seats: c.facilities.seats,
        trust: c.campaign.trust,
        stage: h.stage,
        cleared: h.cleared,
        avgAtt: h.avgAtt,
        payroll: payroll(userTeam(c)),
        profit: h.profit,
        name: h.name ?? '',
      });
      for (let k = 1; k <= 5; k++) if (run.reach[k] === null && c.campaign.stage >= k) run.reach[k] = s;
      if (run.champ === null && c.campaign.titles > 0) run.champ = s;
      run.stars = c.campaign.achievements.slice();
      run.retired = c.campaign.retired?.length ?? 0;
      if (c.phase === 'over') {
        run.over = s;
        break;
      }
      if (s === N_SEASONS) break;
      c = bot.beforeDraft(c);
      const d = beginDraft(c, rng);
      if (d.error) throw new Error(`드래프트 시작 실패: ${d.error}`);
      c = d.core;
      for (let g = 0; !isDraftDone(c) && g < 10; g++) {
        if (!isUserTurn(c)) throw new Error('드래프트 진행 멈춤');
        const pid = bot.draft(c);
        const r = pid ? draftPick(c, pid, rng) : draftSkip(c, rng);
        c = r.error ? draftSkip(c, rng).core : r.core;
      }
      run.drafted += c.draft?.mine.length ?? 0;
      c = nextSeason(c, rng);
    }
  } catch (e) {
    run.crash = `seed ${seed}: ${(e as Error).message}\n${(e as Error).stack?.split('\n').slice(1, 5).join('\n')}`;
  }
  return run;
}

const pad = (s: string | number, n: number) => String(s).padStart(n);
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const median = (xs: number[]) => {
  if (!xs.length) return NaN;
  const a = xs.slice().sort((x, y) => x - y);
  return a.length % 2 ? a[(a.length - 1) / 2] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2;
};
const pct = (a: number, b: number) => (b ? `${pad(Math.round((a / b) * 100), 3)}%` : '   —');
const fmtReach = (xs: (number | null)[]) => {
  const got = xs.filter((x): x is number => x !== null);
  if (!got.length) return '        —          ';
  return `${pct(got.length, xs.length)} 중앙${pad(median(got).toFixed(1), 4)} (${Math.min(...got)}~${Math.max(...got)})`.padEnd(19);
};

console.log(`\n=== 캠페인 봇 검증: ${N_SEEDS} 시드 × ${N_SEASONS} 시즌 ===`);
console.log(`장: ${STAGES.map((s, i) => `${i}.${s.name}`).join(' → ')}`);
const t0 = Date.now();
const all: Record<string, Run[]> = {};
for (const bot of BOTS) {
  const runs: Run[] = [];
  for (let seed = 1; seed <= N_SEEDS; seed++) runs.push(runOne(bot, seed));
  all[bot.name] = runs;
}

console.log('\n── 장 도달 시즌 분포 (도달률 · 도달 시즌 중앙값 · 최소~최대) / 우승 / 연고 이전 ──');
console.log('봇        | 1장 도달            | 2장 도달            | 3장 도달            | 4장 도달            | 우승(5장 도달)      | 연고 이전 (평균 시즌) | 강제매각 | 크래시');
for (const bot of BOTS) {
  const runs = all[bot.name];
  const over = runs.filter((r) => r.over !== null);
  console.log(
    `${bot.name.padEnd(9)} | ${[1, 2, 3, 4, 5].map((k) => fmtReach(runs.map((r) => r.reach[k]))).join(' | ')} | ${pct(over.length, runs.length)} (${over.length ? mean(over.map((r) => r.over!)).toFixed(1) : ' — '})          | ${pct(runs.filter((r) => r.forcedSale).length, runs.length)}     | ${runs.filter((r) => r.crash).length}`,
  );
}

console.log('\n── 장별 깃발 달성률 (달성 시즌 / 그 장에서 치른 시즌) · 장당 평균 시즌(통과한 런) ──');
console.log('봇        | ' + STAGES.map((s, i) => `${i}.${s.name}`.padEnd(20)).join(' | '));
const flagRate: Record<string, number[]> = {};
for (const bot of BOTS) {
  const runs = all[bot.name];
  const cells: string[] = [];
  flagRate[bot.name] = [];
  for (let st = 0; st < STAGES.length; st++) {
    const played = runs.flatMap((r) => r.snaps.filter((x) => x.stage === st));
    const cleared = played.filter((x) => x.cleared).length;
    // 장당 시즌: 그 장을 통과한 런에서 그 장에 머문 시즌 수
    const spans = runs.map((r) => ({ n: r.snaps.filter((x) => x.stage === st).length, passed: r.snaps.some((x) => x.stage === st && x.cleared) })).filter((x) => x.passed);
    flagRate[bot.name][st] = played.length ? cleared / played.length : NaN;
    cells.push(`${pct(cleared, played.length)} (${pad(cleared, 2)}/${pad(played.length, 3)}) ${spans.length ? mean(spans.map((x) => x.n)).toFixed(1) + '시즌' : '  —  '}`.padEnd(20));
  }
  console.log(`${bot.name.padEnd(9)} | ${cells.join(' | ')}`);
}
console.log('── A/B 분기 (sensible 이 도달한 시즌의 같은 출발 상태에서 그 한 시즌만 sensible vs off-verb) ──');
console.log(
  STAGES.map((_, st) => {
    const xs = AB.filter((x) => x.stage === st);
    if (!xs.length) return `${st}장 —`;
    const a = xs.filter((x) => x.a).length;
    const b = xs.filter((x) => x.b).length;
    return `${st}장 sensible ${pct(a, xs.length).trim()} / off-verb ${pct(b, xs.length).trim()} (n=${xs.length}, 비 ${a ? (b / a).toFixed(2) : '—'})`;
  }).join(' · ') + '  (목표: 비 ≤ 0.50)',
);
console.log(
  `(참고) 독립 런의 off-verb / sensible 깃발 달성률 비: ${STAGES.map((_, st) => (Number.isFinite(flagRate['off-verb'][st]) && flagRate.sensible[st] > 0 ? `${st}장 ${(flagRate['off-verb'][st] / flagRate.sensible[st]).toFixed(2)}` : `${st}장 —`)).join(' · ')}  (목표 ≤ 0.50)`,
);

console.log('\n── 별 획득 (그 장을 치른 런 기준 평균 개수 · 3개 전부 딴 런 비율) ──');
for (const bot of BOTS) {
  const runs = all[bot.name];
  const cells: string[] = [];
  let tot = 0;
  let n = 0;
  for (let st = 0; st < STAGES.length; st++) {
    const rs = runs.filter((r) => r.snaps.some((x) => x.stage === st));
    const cnt = rs.map((r) => r.stars.filter((a) => a.startsWith(`s${st}-`)).length);
    if (st < 5) {
      tot += cnt.reduce((a, b) => a + b, 0);
      n += rs.length;
    }
    const each = [1, 2, 3].map((k) => rs.filter((r) => r.stars.includes(`s${st}-${k}`)).length);
    cells.push(rs.length ? `${st}장 ${mean(cnt).toFixed(2)}개 [★${each.join('/')}] 올3 ${pct(cnt.filter((x) => x === 3).length, rs.length).trim()}` : `${st}장 —`);
  }
  console.log(`${bot.name.padEnd(9)} | ${cells.join(' | ')} | 장당 평균 ${n ? (tot / n).toFixed(2) : '—'}개`);
}

console.log('\n── 시즌별 평균 (생존 런 기준) ──');
for (const bot of BOTS) {
  console.log(`[${bot.name}]`);
  console.log(' 시즌 | 생존 | 순위 |   현금 (최대)      |   부채   |   팬   | 관중석 | 평균관중 |  연봉총액 | 영업손익 | 지지 | 장');
  const runs = all[bot.name];
  for (let s = 0; s < N_SEASONS; s++) {
    const sn = runs.map((r) => r.snaps[s]).filter((x): x is SeasonSnap => !!x);
    if (!sn.length) break;
    console.log(
      ` ${pad(s + 1, 4)} | ${pad(sn.length, 4)} | ${pad(mean(sn.map((x) => x.rank)).toFixed(1), 4)} | ${pad(fmtMoney(mean(sn.map((x) => x.cash))), 8)} (${pad(fmtMoney(Math.max(...sn.map((x) => x.cash))), 7)}) | ${pad(fmtMoney(mean(sn.map((x) => x.debt))), 8)} | ${pad(Math.round(mean(sn.map((x) => x.fans))), 6)} | ${pad('Lv' + (mean(sn.map((x) => x.seats)) + 1).toFixed(1), 6)} | ${pad(Math.round(mean(sn.map((x) => x.avgAtt))), 8)} | ${pad(fmtMoney(mean(sn.map((x) => x.payroll))), 9)} | ${pad(fmtMoney(mean(sn.map((x) => x.profit))), 8)} | ${pad(Math.round(mean(sn.map((x) => x.trust))), 4)} | ${mean(sn.map((x) => x.stage)).toFixed(2)}`,
    );
  }
}

console.log('\n── 통과 확인 (런 합계) ──');
for (const bot of BOTS) {
  const runs = all[bot.name];
  const cards: Record<string, number> = {};
  for (const r of runs) for (const [k, v] of Object.entries(r.cards)) cards[k] = (cards[k] ?? 0) + v;
  const seasons = runs.reduce((a, r) => a + r.snaps.length, 0);
  console.log(
    `${bot.name.padEnd(9)} 카드 ${pad(runs.reduce((a, r) => a + r.events, 0), 4)}장 (시즌당 ${(runs.reduce((a, r) => a + r.events, 0) / Math.max(1, seasons)).toFixed(1)}) · 포스트시즌 유저 경기 ${pad(runs.reduce((a, r) => a + r.postGames, 0), 4)} · 드래프트 지명 ${pad(runs.reduce((a, r) => a + r.drafted, 0), 4)}명 · 영구결번 ${runs.reduce((a, r) => a + r.retired, 0)} · 우승 경험 ${runs.filter((r) => r.champ !== null).length}/${runs.length}`,
  );
  console.log(`          카드별: ${Object.entries(cards).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
}
const names: Record<string, number> = {};
for (const bot of BOTS) for (const r of all[bot.name]) for (const x of r.snaps) names[x.name] = (names[x.name] ?? 0) + 1;
console.log(`\n시즌 이름 분포: ${Object.entries(names).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(' · ')}`);

const champS = all.sensible.map((r) => r.champ).filter((x): x is number => x !== null);
const sStars = (() => {
  const runs = all.sensible;
  let tot = 0;
  let n = 0;
  let all3 = 0;
  for (let st = 0; st < 5; st++) {
    const rs = runs.filter((r) => r.snaps.some((x) => x.stage === st));
    const cnt = rs.map((r) => r.stars.filter((a) => a.startsWith(`s${st}-`)).length);
    tot += cnt.reduce((a, b) => a + b, 0);
    n += rs.length;
    all3 += cnt.filter((x) => x === 3).length;
  }
  return { avg: n ? tot / n : NaN, all3: n ? all3 / n : NaN };
})();
const spanS = (() => {
  const xs: number[] = [];
  for (let st = 0; st < 5; st++) for (const r of all.sensible) if (r.snaps.some((x) => x.stage === st && x.cleared)) xs.push(r.snaps.filter((x) => x.stage === st).length);
  return mean(xs);
})();
const overRate = (b: string) => all[b].filter((r) => r.over !== null).length / all[b].length;
const overAvg = (b: string) => mean(all[b].filter((r) => r.over !== null).map((r) => r.over!));
const maxCash = Math.max(...Array.from({ length: N_SEASONS }, (_, s) => mean(all.sensible.map((r) => r.snaps[s]).filter((x): x is SeasonSnap => !!x).map((x) => x.cash))).filter((v) => Number.isFinite(v)));
console.log('\n── 목표 대비 (LEVEL_DESIGN 11절) ──');
console.log(`passive  연고 이전 평균 시즌 ${overAvg('passive').toFixed(1)} (목표 3~4) · 이전율 ${Math.round(overRate('passive') * 100)}%`);
console.log(`sensible 장당 평균 ${spanS.toFixed(2)}시즌 (목표 1.3~1.8) · 우승 ${champS.length}/${N_SEEDS} 중앙 시즌 ${champS.length ? median(champS).toFixed(1) : '—'} (목표 7~10) · 이전율 ${Math.round(overRate('sensible') * 100)}% (목표 <15%)`);
console.log(`sensible 별 장당 평균 ${sStars.avg.toFixed(2)}개 (목표 1.0~1.5) · 3개 전부 ${Math.round(sStars.all3 * 100)}% (목표 <10%) · 시즌 말 평균 현금 최대 ${fmtMoney(maxCash)} (목표 ≤100억)`);
console.log(`greedy   2장 도달 중앙 ${median(all.greedy.map((r) => r.reach[2]).filter((x): x is number => x !== null)).toFixed(1)} · 3장 도달률 ${Math.round((all.greedy.filter((r) => r.reach[3] !== null).length / N_SEEDS) * 100)}% · 이전율 ${Math.round(overRate('greedy') * 100)}% (목표 30%+)`);

const crashes = BOTS.flatMap((b) => all[b.name].filter((r) => r.crash).map((r) => `[${b.name}] ${r.crash}`));
if (crashes.length) {
  console.log('\n!! 크래시:');
  for (const x of crashes) console.log(x);
  process.exitCode = 1;
}
console.log(`\n(${((Date.now() - t0) / 1000).toFixed(1)}초)`);
