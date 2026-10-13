import { josa } from './format';
// 트레이드: AI 구단의 제안(사건 카드)과 유저가 시장에 내놓은 선수(campaign.block).
// - makeOffer: 서로의 필요를 맞춘 패키지 한 건 (순수 함수)
// - tradePreview / applyTradeMut: 표시와 적용이 같은 길을 쓴다 (eventRows 패턴)
// - drawTrade: 트레이드 기간(정규시즌 TR.from~TR.to)에 시즌 1~2건. 일반 카드와 별도 예산
// - drawStoveTrade: 스토브리그(결산 후 · 드래프트 전)의 제안 1건
import type { Core, EventCard, EventDetail, Player, Team } from './types';
import { clamp, pick, randInt, type Rng } from './rng';
import { farmMax, loanLimit, blockClosedWhy, MIN_BATTERS, MIN_PITCHERS, ROSTER_MAX, SVC_YEARS, activeRoster, farmRoster, payroll, userTeam } from './economy';
import { fmtMoney } from './format';
import { isFranchise } from './franchise';
import { autoLineup, fixLineup, slotNewcomer } from './lineup';
import { calcOvr, teamParts, type TeamParts } from './ratings';
import { POS_LABEL, positionReport, type PosKey } from './analysis';
import { winDelta } from './briefing';
import { GAMES } from './schedule';
import { addNews, marketSalary } from './season';
import { memoAdd, memoGet, memoNum, memoSet } from './memo';
import { rowCash, rowFans, rowInfo, rowPayroll, rowSat, satAfter, type Row } from './eventRows';
import { CHARACTERS, NEWS } from './story';

// ── 튜닝 상수 ──
export const TR = {
  from: 18, // 트레이드 기간: 이 경기 뒤부터
  to: 54, // 마감일 (economy.ts TRADE_DEADLINE 과 같은 값 — 모듈 순환을 피하려고 따로 둔다)
  warn: 6, // 마감 이 경기 전에 뉴스 한 줄
  max: 2, // AI 가 먼저 거는 제안: 시즌 최대 장수
  gap: 12, // 제안끼리 최소 경기 수
  second: 0.3, // 두 번째 제안이 올 확률
  stove: 0.5, // 스토브리그에 제안이 올 확률 (내놓은 선수가 있으면 항상 답이 온다)
  edge: [0.1, 0.25], // 상대에 유리한 폭 (오가는 가치 합 대비)
  burden: 2, // 시장가보다 비싼 잔여 계약: 초과 연봉 × 이 값만큼 가치에서 뺀다 (떠안는 쪽의 부담)
  debtShy: 0.5, // 유저 부채가 대출 한도의 이 비율 이상이면 상대는 현금을 얹어 주지 않는다 (현금을 받는 제안 없음)
  churnFrom: 2, // 같은 시즌에 이 번째 트레이드부터 선수단이 동요한다
  churnSat: -3,
  churnFocus: -3,
  churnGames: 6,
  counter: 0.5, // 역제안(유리 폭 0) 수락 확률
  weakRank: 5, // 이 순위 이하인 포지션이 "필요"
  up: 3, // 받는 선수는 우리 주전보다 오버롤이 이만큼 이상 높다
  worth: 1.25, // 선수의 값어치 = 시장가 × 이 값 (연봉을 뺀 나머지가 가치)
  potHalf: 0.5, // 25세 이하: 잠재력 여지의 이만큼을 지금 오버롤에 얹어 값을 매긴다
  oldFrom: 33, // 이 나이부터 해마다 값어치 감산
  oldRate: 0.15,
  oldMin: 0.4,
  prospectAge: 25,
  prospectGap: 5,
  dumpSalary: 25000, // 연봉 덤프: 이 연봉 이상의 33세 이상
  cashMax: 150000, // 현금 조정 상한
  blockMax: 2, // 트레이드 시장에 내놓을 수 있는 인원
  blockWithin: [2, 6], // 내놓은 뒤 이 경기 안에 답이 온다
  frFans: 8, // 프랜차이즈 스타를 보내면 팬 −star × 이 값
  frSat: -8,
};

// 감사용 스위치 (scripts/campaign.ts 의 TRADE=off 가 끈다. 게임에서는 켜 둔다)
export const TRADE_AUDIT = { offers: true };

export type TradeKind = 'now' | 'future' | 'dump' | 'cash';
export const TRADE_KIND_KO: Record<TradeKind, string> = { now: '즉전감 맞교환', future: '지금 이기기 ↔ 미래', dump: '연봉 떠안기', cash: '현금 트레이드' };
export interface TradeOffer {
  kind: TradeKind;
  teamId: string;
  get: string[]; // 우리가 받는 선수
  give: string[]; // 우리가 보내는 선수
  cash: number; // 우리가 받는 현금 (음수 = 우리가 낸다). 상대에 유리한 조건
  fair: number; // 유리 폭 0 의 현금 (역제안)
  src: 'ai' | 'block' | 'stove';
}
export const TRADE_ID = 'trade';

// ───────── 가치 ─────────

/** 선수의 트레이드 가치: 앞으로 몇 해 동안 (값어치 − 연봉). 젊고 잠재력이 남았으면 높고, 33세부터 깎이고, 보유 기간의 싼 연봉은 그만큼 얹힌다 */
export function tradeValue(p: Player, season: number): number {
  const m = marketSalary(p, season);
  const grown = p.age <= TR.prospectAge ? { ...p, ovr: Math.round(p.ovr + Math.max(0, p.pot - p.ovr) * TR.potHalf) } : p;
  const old = p.age >= TR.oldFrom ? Math.max(TR.oldMin, 1 - TR.oldRate * (p.age - TR.oldFrom + 1)) : 1;
  const worth = marketSalary(grown, season) * TR.worth * old;
  const years = p.age <= 25 ? 4 : p.age <= 29 ? 3 : p.age <= 32 ? 2 : 1;
  const held = p.svc !== undefined ? clamp(SVC_YEARS - (season - p.svc), 0, years) : 0; // 잔여 보유 기간
  const v = p.svc !== undefined ? (worth - p.salary) * held + (worth - m) * (years - held) : (worth - p.salary) * years;
  const over = Math.max(0, p.salary - m) * years * TR.burden; // 시장가보다 비싼 계약은 떠안는 쪽의 짐이다
  return Math.round((v - over) / 100) * 100;
}

// ───────── 필요 ─────────

const KEYS: PosKey[] = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'SP', 'RP', 'CP'];
const mean = (xs: number[]) => (xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : 0);
function unit(t: Team, key: PosKey): Player[] {
  const byId = new Map(t.roster.map((p) => [p.id, p]));
  const ids = key === 'SP' ? t.rotation : key === 'RP' ? t.bullpen.slice(0, 4) : key === 'CP' ? [t.closer] : [t.lineup.find((s) => s.pos === key)?.pid];
  return ids.map((id) => (id ? byId.get(id) : undefined)).filter((p): p is Player => !!p);
}
/** 그 자리에서 밀어내야 하는 오버롤 (주전 중 가장 낮은 선수) */
const bar = (t: Team, key: PosKey): number => {
  const u = unit(t, key);
  return u.length ? Math.min(...u.map((p) => p.ovr)) : 0;
};
function rankAt(core: Core, t: Team, key: PosKey): number {
  const mine = mean(unit(t, key).map((p) => p.ovr));
  return 1 + core.teams.filter((x) => mean(unit(x, key).map((p) => p.ovr)) > mine + 1e-9).length;
}
const isKey = (pos: string): pos is PosKey => (KEYS as string[]).includes(pos);
const starterIds = (t: Team) => new Set([...t.lineup.map((s) => s.pid), ...t.rotation, ...(t.closer ? [t.closer] : [])]);
const movable = (p: Player) => p.injury === 0 && !p.ban && !p.armyDue && !p.subFor && !p.rookie;
export const isProspect = (p: Player) => p.age <= TR.prospectAge && p.pot - p.ovr >= TR.prospectGap;

/** 우리의 필요: 리그 5위 이하인 포지션을 약한 순서로 (없으면 순위가 낮은 순서 전부) */
function ourNeeds(core: Core): { key: PosKey; rank: number }[] {
  const rows = positionReport(core)
    .filter((r) => r.key !== 'DH')
    .sort((a, b) => b.rank - a.rank || a.diff - b.diff);
  const weak = rows.filter((r) => r.rank >= TR.weakRank);
  return (weak.length ? weak : rows.slice(0, 4)).map((r) => ({ key: r.key, rank: r.rank }));
}

// ───────── 제안 만들기 ─────────

const round = (v: number) => Math.round(v / 1000) * 1000;
/** 빚이 많은 구단인가: 상대는 현금을 받는 쪽으로만 거래한다 */
export const debtShy = (core: Pick<Core, 'finance' | 'campaign'>): boolean => core.finance.debt >= loanLimit(core) * TR.debtShy;
/** 이번 시즌에 성사된 트레이드 수 · 다음 트레이드가 선수단을 흔드는가 */
export const tradesDone = (core: Core): number => memoNum(core, 'trDone');
export const tradeChurn = (core: Core): boolean => tradesDone(core) + 1 >= TR.churnFrom;
function price(core: Core, rng: Rng, get: Player[], give: Player[]): { cash: number; fair: number } | null {
  const vg = get.reduce((s, p) => s + tradeValue(p, core.season), 0);
  const vo = give.reduce((s, p) => s + tradeValue(p, core.season), 0);
  const gross = [...get, ...give].reduce((s, p) => s + Math.abs(tradeValue(p, core.season)), 0);
  const edge = TR.edge[0] + rng() * (TR.edge[1] - TR.edge[0]);
  const shy = debtShy(core);
  const fair = shy ? Math.min(0, round(vo - vg)) : round(vo - vg);
  const cash = Math.min(fair - 1000, round(vo - vg - edge * gross)); // AI 는 손해 보는 제안을 하지 않는다
  if (Math.abs(cash) > TR.cashMax || -cash > core.finance.cash * 0.6) return null;
  if (shy && cash > 0) return null; // 빚이 많은 구단에는 현금을 얹어 주지 않는다
  return { cash, fair };
}

interface Cand {
  offer: TradeOffer;
  score: number;
}

function aiOffers(core: Core, rng: Rng, kind: TradeKind): Cand[] {
  const u = userTeam(core);
  const needs = ourNeeds(core);
  const out: Cand[] = [];
  const uStart = starterIds(u);
  for (const t of core.teams) {
    if (t.id === core.userId) continue;
    for (const need of needs) {
      const b = bar(u, need.key);
      if (kind === 'dump') {
        const vets = t.roster.filter((p) => p.pos === need.key && movable(p) && p.age >= TR.oldFrom && p.salary >= TR.dumpSalary && p.ovr >= b + 1 && tradeValue(p, core.season) < 0);
        for (const v of vets) {
          const pr = price(core, rng, [v], []);
          if (pr && pr.cash > 0) out.push({ offer: { kind, teamId: t.id, get: [v.id], give: [], ...pr, src: 'ai' }, score: need.rank * 2 + (v.ovr - b) });
        }
        continue;
      }
      const gets = t.roster
        .filter((p) => p.pos === need.key && movable(p) && p.ovr >= b + TR.up && (kind !== 'now' || tradeValue(p, core.season) > 0))
        .sort((a, c) => c.ovr - a.ovr)
        .slice(0, 2);
      for (const g of gets) {
        const vg = tradeValue(g, core.season);
        const gives =
          kind === 'now'
            ? activeRoster(u).filter((p) => p.pos !== need.key && isKey(p.pos) && movable(p) && rankAt(core, t, p.pos) >= TR.weakRank && p.ovr >= bar(t, p.pos) + 1)
            : farmRoster(u).filter((p) => movable(p) && isProspect(p));
        const best = gives
          .map((p) => ({ p, d: Math.abs(tradeValue(p, core.season) - vg) + (uStart.has(p.id) ? vg * 0.3 : 0) }))
          .sort((a, c) => a.d - c.d)[0];
        if (!best) continue;
        const pr = price(core, rng, [g], [best.p]);
        if (pr) out.push({ offer: { kind, teamId: t.id, get: [g.id], give: [best.p.id], ...pr, src: 'ai' }, score: need.rank * 2 + (g.ovr - b) - Math.abs(pr.cash) / 20000 });
      }
    }
  }
  return out;
}

/** 내놓은 선수(want)를 원하는 구단의 제안. 상대 필요와 맞을 때만 */
function blockOffers(core: Core, rng: Rng, want: Player): Cand[] {
  const u = userTeam(core);
  const needs = ourNeeds(core).filter((n) => n.key !== want.pos);
  const out: Cand[] = [];
  for (const t of core.teams) {
    if (t.id === core.userId || !isKey(want.pos)) continue;
    const rank = rankAt(core, t, want.pos);
    const fits = isProspect(want) ? rank >= 4 : rank >= TR.weakRank && want.ovr >= bar(t, want.pos) + 1;
    if (!fits) continue;
    const vw = tradeValue(want, core.season);
    const st = starterIds(t);
    // 우리 약점 포지션의 선수 → 유망주 → 현금
    let get: Player | undefined;
    let kind: TradeKind = 'cash';
    for (const n of needs) {
      get = t.roster
        .filter((p) => p.pos === n.key && movable(p) && p.ovr >= bar(u, n.key) + 1 && tradeValue(p, core.season) <= Math.max(vw, 0) * 1.5 + 20000)
        .sort((a, c) => c.ovr - a.ovr)[0];
      if (get) break;
    }
    if (get) kind = 'now';
    else {
      get = t.roster.filter((p) => !st.has(p.id) && movable(p) && p.age <= 24 && p.pot - p.ovr >= TR.prospectGap + 1).sort((a, c) => c.pot - a.pot)[0];
      if (get && rng() < 0.6) kind = 'future';
      else get = undefined;
    }
    const pr = price(core, rng, get ? [get] : [], [want]);
    if (pr) out.push({ offer: { kind, teamId: t.id, get: get ? [get.id] : [], give: [want.id], ...pr, src: 'block' }, score: rank + pr.cash / 20000 + (kind === 'now' ? 2 : 0) });
  }
  return out;
}

const KIND_ORDER: TradeKind[] = ['now', 'future', 'dump'];
/** 제안 한 건. kind 를 주면 그 유형부터(안 되면 다음 유형), want 를 주면 그 선수를 원하는 구단의 제안 */
export function makeOffer(core: Core, rng: Rng, o: { kind?: TradeKind; want?: string; src?: TradeOffer['src'] } = {}): TradeOffer | null {
  const top = (cs: Cand[]): TradeOffer | null => {
    const ok = cs.filter((c) => !tradeBlocked(core, c.offer, c.offer.cash) || !tradeBlocked(core, c.offer, c.offer.fair)).sort((a, b) => b.score - a.score);
    return ok.length ? { ...pick(rng, ok.slice(0, 3)).offer, ...(o.src ? { src: o.src } : {}) } : null;
  };
  if (o.want) {
    const p = userTeam(core).roster.find((x) => x.id === o.want);
    return p && movable(p) ? top(blockOffers(core, rng, p)) : null;
  }
  const i0 = Math.max(0, KIND_ORDER.indexOf(o.kind ?? 'now'));
  for (let k = 0; k < KIND_ORDER.length; k++) {
    const got = top(aiOffers(core, rng, KIND_ORDER[(i0 + k) % KIND_ORDER.length]));
    if (got) return got;
  }
  return null;
}

// ───────── 적용 · 미리보기 ─────────

function findAll(core: Core, of: TradeOffer): { t: Team; get: Player[]; give: Player[] } | null {
  const t = core.teams.find((x) => x.id === of.teamId);
  const u = userTeam(core);
  if (!t) return null;
  const get = of.get.map((id) => t.roster.find((p) => p.id === id));
  const give = of.give.map((id) => u.roster.find((p) => p.id === id));
  if (get.some((p) => !p) || give.some((p) => !p)) return null;
  return { t, get: get as Player[], give: give as Player[] };
}
/** 받는 선수가 갈 곳: 1군에 자리가 있으면 1군, 가득이면 25세 이하는 2군 */
const toFarm = (core: Core, of: TradeOffer, p: Player, x: { give: Player[] }): boolean => {
  const u = userTeam(core);
  const act = activeRoster(u).length - x.give.filter((g) => !g.farm).length;
  return act >= ROSTER_MAX && p.age <= TR.prospectAge && farmRoster(u).length - x.give.filter((g) => g.farm).length < farmMax(core);
};

/** 지금 이 조건으로 할 수 없는 사유. 할 수 있으면 undefined */
export function tradeBlocked(core: Core, of: TradeOffer, cash: number): string | undefined {
  const x = findAll(core, of);
  if (!x) return '상대 구단 사정으로 무산되었습니다';
  const u = userTeam(core);
  if (cash < 0 && core.finance.cash < -cash) return `현금 부족 (필요 ${fmtMoney(-cash)})`;
  const foreign = u.roster.filter((p) => p.foreign).length + x.get.filter((p) => p.foreign).length - x.give.filter((p) => p.foreign).length;
  if (foreign > FOREIGN_LIMIT && x.get.some((p) => p.foreign)) return `외국인 선수는 ${FOREIGN_LIMIT}명까지입니다`;
  const up = x.get.filter((p) => !toFarm(core, of, p, x));
  const act = activeRoster(u);
  if (act.length - x.give.filter((p) => !p.farm).length + up.length > ROSTER_MAX) return '1군이 가득 찼습니다';
  for (const [kind, min, ko] of [['B', MIN_BATTERS, '타자'], ['P', MIN_PITCHERS, '투수']] as const) {
    const n = act.filter((p) => p.kind === kind).length - x.give.filter((p) => !p.farm && p.kind === kind).length + up.filter((p) => p.kind === kind).length;
    if (n < min) return `1군 ${ko}는 최소 ${min}명이 필요합니다`;
  }
  return undefined;
}
const FOREIGN_LIMIT = 3; // events.ts FOREIGN_MAX 와 같은 값 (모듈 순환을 피하려고 따로 둔다)

/** 트레이드를 실제로 적용한다 (mutate). 표시(tradePreview)도 이 함수를 복제본에 돌린다 */
export function applyTradeMut(core: Core, of: TradeOffer, cash: number, quiet = false): boolean {
  const x = findAll(core, of);
  if (!x) return false;
  const u = userTeam(core);
  const farmIds = new Set(x.get.filter((p) => toFarm(core, of, p, x)).map((p) => p.id));
  for (const p of x.give) {
    if (isFranchise(p, core.season)) {
      core.fans = Math.max(1000, core.fans - p.star * TR.frFans);
      core.fanSat = satAfter(core, TR.frSat);
      if (!quiet) addNews(core, NEWS.franchiseGone(p.name), 'bad');
    }
    // 포지션 전향 중이면 수비 페널티를 풀어 보낸다 (방출과 같다. 표시만 지우면 깎인 수비가 영영 남는다)
    if (p.posShift) {
      p.def = clamp(p.def + p.posShift.pen, 20, 99);
      p.ovr = calcOvr(p);
    }
    // 이적하면 보유 기간의 할인은 사라진다 — 새 팀에서는 시장가
    for (const k of ['since', 'svc', 'ask', 'lever', 'tired', 'farm', 'il', 'farmUntil', 'farmStat', 'posShift', 'apps'] as const) delete p[k];
    p.salary = Math.max(p.salary, marketSalary(p, core.season));
  }
  u.roster = u.roster.filter((p) => !of.give.includes(p.id));
  x.t.roster = x.t.roster.filter((p) => !of.get.includes(p.id));
  x.t.roster.push(...x.give);
  for (const p of x.get) {
    p.since = core.season;
    // 받는 선수도 새 팀에서는 시장가 (보유 할인·약속된 요구는 따라오지 않는다)
    for (const k of ['svc', 'ask', 'lever', 'tired'] as const) delete p[k];
    p.salary = Math.max(p.salary, marketSalary(p, core.season));
    if (farmIds.has(p.id)) p.farm = true;
    u.roster.push(p);
  }
  fixLineup(u);
  for (const p of x.get) if (!p.farm) slotNewcomer(u, p);
  autoLineup(x.t);
  core.finance.cash += cash;
  if (cash > 0) core.finance.ledger.sales += cash;
  else core.finance.ledger.signing += -cash;
  if (core.campaign.block) core.campaign.block = core.campaign.block.filter((id) => !of.give.includes(id));
  // 잦은 트레이드: 같은 시즌 TR.churnFrom 번째부터 선수단이 동요한다
  if (memoAdd(core, 'trDone') >= TR.churnFrom) {
    core.fanSat = satAfter(core, TR.churnSat);
    core.campaign.buffs.push({ kind: 'focus', value: TR.churnFocus, until: core.day + TR.churnGames, label: `잦은 트레이드로 선수단 동요 집중력 ${TR.churnFocus}` });
    if (!quiet) addNews(core, `잦은 트레이드로 선수단이 동요합니다 — 팬 만족도 ${TR.churnSat} · 집중력 ${TR.churnFocus} (${TR.churnGames}경기)`, 'bad');
  }
  return true;
}

export interface TradePreview {
  ok: boolean;
  parts: { a: TeamParts; b: TeamParts };
  wins: number; // 예상 승수 변화 (남은 경기 기준, 스토브리그는 한 시즌)
  games: number;
  ranks: { key: string; label: string; a: number; b: number }[];
  payroll: { a: number; b: number };
  cash: number;
  net: number; // 가치 기준 우리 손익 (받는 가치 − 보내는 가치 + 현금)
  get: Player[];
  give: Player[];
  fans: number;
  churn: boolean; // 잦은 트레이드로 선수단이 동요하는가
}
export function tradePreview(core: Core, of: TradeOffer, cash: number): TradePreview {
  const x = findAll(core, of);
  const after = structuredClone(core);
  const ok = !!x && applyTradeMut(after, of, cash, true);
  const pa = teamParts(userTeam(core));
  const pb = teamParts(userTeam(after));
  const inSeason = core.phase === 'season' && core.day < core.schedule.length;
  const games = inSeason ? core.schedule.length - core.day : core.schedule.length || GAMES;
  const r0 = positionReport(core);
  const r1 = positionReport(after);
  const val = (ps: Player[]) => ps.reduce((s, p) => s + tradeValue(p, core.season), 0);
  return {
    ok,
    parts: { a: pa, b: pb },
    wins: Math.round(winDelta(pa, pb) * games * 10) / 10,
    games,
    ranks: r0.map((r, i) => ({ key: r.key, label: r.label, a: r.rank, b: r1[i].rank })).filter((r) => r.a !== r.b),
    payroll: { a: payroll(userTeam(core)), b: payroll(userTeam(after)) },
    cash,
    net: x ? val(x.get) - val(x.give) + cash : 0,
    get: x?.get ?? [],
    give: x?.give ?? [],
    fans: after.fans - core.fans,
    churn: ok && tradeChurn(core),
  };
}

// ───────── 카드 ─────────

const PART_KO: [keyof TeamParts, string][] = [['bat', '타선'], ['def', '수비'], ['rot', '선발'], ['pen', '불펜']];
const sgn1 = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(v).toFixed(1)}`;
const posKo = (p: Player) => POS_LABEL[p.pos as PosKey] ?? p.pos;
const tag = (p: Player) => `${p.name}(${posKo(p)} ${p.ovr}, ${p.age}세)`;

function detailOf(core: Core, of: TradeOffer, cash: number): EventDetail {
  const pv = tradePreview(core, of, cash);
  const u = userTeam(core);
  const rows: Row[] = [];
  // 전력 4칸: 타선 · 수비 · 선발 · 불펜
  for (const [k, ko] of PART_KO) {
    const d = pv.parts.b[k] - pv.parts.a[k];
    rows.push({ label: ko, before: `${pv.parts.a[k]}`, after: `${pv.parts.b[k]}${d ? ` (${d > 0 ? '+' : '−'}${Math.abs(d)})` : ''}`, tone: d > 0 ? 'good' : d < 0 ? 'bad' : 'info' });
  }
  for (const r of pv.ranks.slice(0, 3)) rows.push(rowInfo(`${r.label} 순위`, `${r.b}위`, `${r.a}위`, r.b < r.a ? 'good' : 'bad'));
  rows.push(rowPayroll(core, pv.payroll.b - pv.payroll.a), rowCash(core, cash));
  rows.push(rowInfo('예상 승수', sgn1(pv.wins), '±0.0', pv.wins > 0 ? 'good' : pv.wins < 0 ? 'bad' : 'info'));
  if (pv.fans) rows.push(rowFans(core, pv.fans));
  if (pv.fans || pv.churn) rows.push(rowSat(core, (pv.fans ? TR.frSat : 0) + (pv.churn ? TR.churnSat : 0)));
  if (pv.churn) rows.push(rowInfo(`집중력 (${TR.churnGames}경기)`, `${TR.churnFocus}`, '±0', 'bad'));
  const g = pv.get[0];
  const o = pv.give[0];
  // 비교: 오가는 주요 선수 2명. 한쪽이 비면 그 자리의 지금 주전과
  const cur = g && isKey(g.pos) ? unit(u, g.pos).sort((a, b) => a.ovr - b.ovr)[0] : undefined;
  const pair = g && o ? [g.id, o.id] : g && cur ? [g.id, cur.id] : null;
  return {
    rows,
    pids: [...of.get, ...of.give, ...(cur && !of.give.includes(cur.id) ? [cur.id] : [])],
    ...(pair ? { compare: pair as [string, string] } : {}),
    lasts: `예상 승수는 ${core.phase === 'season' ? '남은' : '다음 시즌'} ${pv.games}경기 기준`,
    ...(pv.churn
      ? { risk: `이번 시즌 ${tradesDone(core) + 1}번째 트레이드 — 잦은 트레이드로 선수단이 동요합니다` }
      : pv.give.some((p) => p.svc !== undefined)
        ? { risk: '보내는 선수의 보유 기간 할인은 상대 팀에서 사라집니다' }
        : {}),
  };
}

const cashTxt = (cash: number) => (cash > 0 ? `현금 +${fmtMoney(cash)}` : cash < 0 ? `현금 −${fmtMoney(-cash)}` : '현금 없음');
export function encodeOffer(of: TradeOffer): string {
  return [TRADE_ID, of.teamId, of.kind, of.get.join(','), of.give.join(','), of.cash, of.fair, of.src].join('|');
}
export function parseOffer(id: string): TradeOffer | null {
  const [base, teamId, kind, get, give, cash, fair, src] = id.split('|');
  if (base !== TRADE_ID || !teamId) return null;
  const ids = (s: string) => (s ? s.split(',') : []);
  return { kind: kind as TradeKind, teamId, get: ids(get), give: ids(give), cash: Number(cash) || 0, fair: Number(fair) || 0, src: (src as TradeOffer['src']) ?? 'ai' };
}

export function tradeCard(core: Core, of: TradeOffer): EventCard | null {
  const x = findAll(core, of);
  if (!x) return null;
  const t = x.t;
  const pv = tradePreview(core, of, of.cash);
  const gets = x.get.map(tag).join(', ');
  const gives = x.give.map(tag).join(', ');
  const wins = `예상 승수 ${sgn1(pv.wins)}`;
  const body =
    of.kind === 'dump'
      ? `${t.city} ${josa(t.name, '이', '가')} ${gets}의 연봉 ${fmtMoney(x.get[0].salary)}을 넘기려 합니다. 받아 주면 현금 ${fmtMoney(of.cash)}을 얹어 줍니다.`
      : of.kind === 'cash'
        ? `${t.city} ${josa(t.name, '이', '가')} 시장에 나온 ${josa(gives, '을', '를')} 원합니다. 조건은 ${cashTxt(of.cash)}.`
        : `${t.city} ${t.name}의 제안: ${josa(gets, '을', '를')} 내주고 ${josa(gives, '을', '를')} 받겠다고 합니다. ${cashTxt(of.cash)}.`;
  const none: EventDetail = { rows: [rowInfo('전력', '변화 없음'), rowPayroll(core, 0), rowCash(core, 0)], pids: [...of.get, ...of.give] };
  const same = of.fair === of.cash;
  return {
    id: encodeOffer(of),
    title: of.src === 'block' ? '트레이드 문의' : `트레이드 제안 — ${TRADE_KIND_KO[of.kind]}`,
    icon: '🔄',
    ...(of.give[0] ?? of.get[0] ? { pid: of.give[0] ?? of.get[0] } : {}),
    who: 'scout',
    line: of.kind === 'future' ? '올해 이기려면 받을 만합니다. 다만 그 아이는 제가 뽑은 아이입니다.' : of.kind === 'dump' ? '공짜는 아닙니다. 연봉은 우리가 냅니다.' : '저쪽이 먼저 전화했습니다. 숫자는 저쪽에 조금 유리합니다.',
    body,
    choices: [
      { label: '수락', desc: `${wins} · ${cashTxt(of.cash)}`, ...(tradeBlocked(core, of, of.cash) ? { disabled: tradeBlocked(core, of, of.cash) } : {}), detail: detailOf(core, of, of.cash) },
      { label: '거절', desc: '현 전력 유지', detail: none },
      {
        label: '역제안: 현금 조정',
        desc: `${cashTxt(of.fair)} · 수락 ${Math.round(TR.counter * 100)}%`,
        ...(same ? { disabled: '더 조정할 여지가 없습니다' } : tradeBlocked(core, of, of.fair) ? { disabled: tradeBlocked(core, of, of.fair) } : {}),
        detail: { ...detailOf(core, of, of.fair), risk: `상대가 받아들일 확률 ${Math.round(TR.counter * 100)}% — 거절하면 트레이드는 결렬됩니다` },
      },
    ],
  };
}

/** 카드 선택 처리 (events.ts 의 카드 정의가 부른다) */
export function resolveTradeMut(core: Core, idx: number, card: EventCard, rng: Rng): string {
  const of = parseOffer(card.id);
  if (!of) return '없던 일이 되었습니다';
  const unblock = () => {
    if (of.src === 'block' && core.campaign.block) core.campaign.block = core.campaign.block.filter((id) => !of.give.includes(id));
  };
  if (idx === 1) {
    unblock();
    return '트레이드 제안을 거절했습니다';
  }
  if (idx === 2 && rng() >= TR.counter) {
    unblock();
    return '역제안 결렬 — 상대 단장이 전화를 끊었습니다';
  }
  const cash = idx === 2 ? of.fair : of.cash;
  const x = findAll(core, of);
  if (!x || tradeBlocked(core, of, cash)) return '상대 구단 사정으로 트레이드가 무산되었습니다';
  const names = `${x.give.map((p) => p.name).join('·') || '현금'} ↔ ${x.get.map((p) => p.name).join('·') || '현금'}`;
  const tname = x.t.name;
  const first = x.get[0]?.name;
  applyTradeMut(core, of, cash);
  addNews(core, `트레이드: ${names}(${tname})${cash ? ` · ${cashTxt(cash)}` : ''}`, 'info');
  core.campaign.hints = { ...(core.campaign.hints ?? {}), lineup: (core.campaign.hints?.lineup ?? 0) + 1 };
  return `${idx === 2 ? '역제안 수락 — ' : ''}트레이드 성사${first ? ` — ${first} 합류` : ''}${cash ? ` (${cashTxt(cash)})` : ''}`;
}

// ───────── 뽑기 ─────────

/** 트레이드 기간인가 · 마감까지 남은 경기 */
export const tradeOpen = (core: Pick<Core, 'phase' | 'day'>): boolean => core.phase === 'season' && core.day >= TR.from && core.day < TR.to;
export const tradeLeft = (core: Pick<Core, 'day'>): number => Math.max(0, TR.to - core.day);

function put(core0: Core, of: TradeOffer): Core | null {
  const core = structuredClone(core0);
  const cd = tradeCard(core, of);
  if (!cd) return null;
  core.campaign.event = cd;
  addNews(core, `${cd.icon} ${CHARACTERS.scout.name} ${CHARACTERS.scout.title} — ${cd.title}`, 'info');
  return core;
}

/** 매 경기 후: 트레이드 기간이면 예정된 날에 제안 1건을 campaign.event 에 둔다. 해당 없으면 원본 반환 */
export function drawTrade(core0: Core, rng: Rng): Core {
  if (!TRADE_AUDIT.offers || !tradeOpen(core0) || core0.campaign.event) return core0;
  // 유저가 내놓은 선수: 답이 오는 날을 정해 두고, 그날 원하는 구단을 찾는다
  const block = core0.campaign.block ?? [];
  if (block.length) {
    const due = memoNum(core0, 'blkDue', -1);
    if (due < 0) {
      const core = structuredClone(core0);
      memoSet(core, 'blkDue', core.day + randInt(rng, TR.blockWithin[0], TR.blockWithin[1]) - 1);
      return core;
    }
    if (core0.day >= due) {
      const core = structuredClone(core0);
      memoSet(core, 'blkDue', -1);
      for (const pid of block) {
        const of = makeOffer(core, rng, { want: pid });
        const made = of && put(core, of);
        if (made) return made;
        const p = userTeam(core).roster.find((x) => x.id === pid);
        addNews(core, `트레이드 시장: ${p?.name ?? '선수'}에게 관심을 보인 구단이 없습니다`, 'info');
        core.campaign.block = (core.campaign.block ?? []).filter((id) => id !== pid);
      }
      return core;
    }
  }
  // AI 가 먼저 거는 제안: 시즌 1~2건, 서로 TR.gap 경기 이상
  let plan = memoGet(core0, 'trPlan');
  let core = core0;
  if (plan === undefined) {
    core = structuredClone(core0);
    const d1 = randInt(rng, TR.from, TR.from + 12);
    const d2 = rng() < TR.second ? d1 + randInt(rng, TR.gap, TR.gap + 8) : 999;
    plan = `${d1},${d2}`;
    memoSet(core, 'trPlan', plan);
  }
  const n = memoNum(core, 'trN');
  const dueDay = Number(plan.split(',')[n] ?? 999);
  if (n >= TR.max || core.day < dueDay || core.day - memoNum(core, 'trDay', -99) < TR.gap) return core;
  const of = makeOffer(core, rng, { kind: KIND_ORDER[(core.season + n) % KIND_ORDER.length] });
  const made = of && put(core, of);
  if (!made) return core;
  memoSet(made, 'trN', n + 1);
  memoSet(made, 'trDay', made.day);
  return made;
}

/** 스토브리그(결산 후 · 드래프트 전): 제안 1건. 내놓은 선수가 있으면 그 선수부터 */
export function drawStoveTrade(core0: Core, rng: Rng): Core {
  if (!TRADE_AUDIT.offers || core0.phase !== 'ended' || core0.campaign.event || memoGet(core0, 'trStove')) return core0;
  const core = structuredClone(core0);
  memoSet(core, 'trStove', 1);
  for (const pid of core.campaign.block ?? []) {
    const of = makeOffer(core, rng, { want: pid, src: 'block' });
    const made = of && put(core, of);
    if (made) return made;
    const p = userTeam(core).roster.find((x) => x.id === pid);
    addNews(core, `트레이드 시장: ${p?.name ?? '선수'}에게 관심을 보인 구단이 없습니다`, 'info');
  }
  core.campaign.block = [];
  if (rng() >= TR.stove) return core;
  const of = makeOffer(core, rng, { kind: KIND_ORDER[(core.season + 2) % KIND_ORDER.length], src: 'stove' });
  return (of && put(core, of)) || core;
}

/** 매 경기 후 (mutate): 마감 임박 · 마감 뉴스 */
export function tradeTickMut(core: Core): void {
  if (core.phase !== 'season') return;
  if (core.day === TR.to - TR.warn) addNews(core, `트레이드 마감 임박 — ${TR.warn}경기 남았습니다`, 'info');
  if (core.day === TR.to) addNews(core, '트레이드 마감 — 다음 창은 스토브리그에 열립니다', 'info');
}

/** 이적 창구의 [트레이드 시장에] 토글 */
export function toggleBlock(core0: Core, pid: string): { core: Core; error?: string } {
  const cur = core0.campaign.block ?? [];
  const p = userTeam(core0).roster.find((x) => x.id === pid);
  if (!p) return { core: core0, error: '우리 선수가 아닙니다' };
  const on = cur.includes(pid);
  const closed = blockClosedWhy(core0);
  if (!on && closed) return { core: core0, error: closed };
  if (!on && cur.length >= TR.blockMax) return { core: core0, error: `트레이드 시장에는 ${TR.blockMax}명까지 내놓을 수 있습니다` };
  if (!on && !movable(p)) return { core: core0, error: p.rookie ? '올해 입단한 신인은 내놓을 수 없습니다' : '부상·징계·입대 예정 선수는 내놓을 수 없습니다' };
  const core = structuredClone(core0);
  core.campaign.block = on ? cur.filter((id) => id !== pid) : [...cur, pid];
  return { core };
}
