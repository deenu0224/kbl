import { josa } from './format';
// 사건은 생긴다 (docs/LEVEL_DESIGN.md 5절). 카드는 무작위 덱이 아니라 지금 상태의 결과다.
// 카드마다 when(core)·우선순위·인물이 있고, 매 경기 후 검사해 1장을 낸다.
// 카드 id 는 "기본id" 또는 "기본id|payload…" 형태 (eventsSeen 에는 기본id 만 기록).
import { RESIGN_ID, resolveResignMut } from './contract';
import type { BatPos, Buff, CharId, Core, EventCard, Player } from './types';
import { clamp, pick, randInt, type Rng } from './rng';
import { calcOvr } from './ratings';
import { fixLineup, slotNewcomer, slotValue } from './lineup';
import { PEN_OVER_KEY, PEN_OVER_SUM } from './fixes';
import { MIN_BATTERS, MIN_PITCHERS, ROSTER_MAX, TRAIN_LV, activeRoster, farmMax, farmRoster, userTeam } from './economy';
import { fmtMoney } from './format';
import { addNews } from './season';
import { flagForecast, flagOnTrack, hintMut, MID_FAIL_TRUST, MID_UP_FAIL_TRUST, MID_UP_MULT, stageOf } from './campaign';
import { rowAdd, rowCash, rowFans, rowInfo, rowMult, rowNone, rowOvr, rowPayroll, rowSat, rowTrust, satAfter } from './eventRows';
import { SIM, tiredPenalty } from './sim';
import { teamParts } from './ratings';
import { winDelta } from './briefing';
import { beatOn, midDay, POS_NAME, userGame } from './script';
import { dayAt } from './league';
import { cardRested, markCardMut, memoGet, memoNum, memoSet, seenCards } from './memo';
import { CARD_LINES, CHARACTERS, NEWS, STAGE_STORY, TRUST_LABEL } from './story';
import { batLeaders, era, ops, pitLeaders } from './leaders';
import { isFranchise } from './franchise';
import { drawFarmEvent, farmCardDef } from './farm';
import { drawSubCard, resolveSubCard } from './subpick';
import { positionReport } from './analysis';
import { SCANDAL_CARDS } from './scandal';
import { RELIEF_CARDS } from './relief';
import { MLB_ID, resolveMlbMut } from './posting';
import { TRADE_ID, drawTrade, parseOffer, resolveTradeMut, tradeBlocked } from './trade';
import { DEBT_SALE_ID, drawDebtSale, resolveDebtSaleMut } from './debt';

const posKo = (pos: string): string => POS_NAME[pos] ?? pos;

// ── 튜닝 상수 ──
export const EVENT_GAP = 8; // 카드 간 최소 경기 수
export const EVENT_MAX = 5; // 시즌 최대 장수 (중간 점검·장의 대본 카드는 따로)
export const FOREIGN_MAX = 3;
const STAGE_SCALE = 0.3; // 금액 스케일 = 1 + stage × 0.3 + fans / FAN_SCALE
const FAN_SCALE = 40000;
const BUFF_GAMES = 6;
const BUFF_LONG = 12;

const N = {
  vetGames: 12, // 베테랑 복귀: 고정 출전 경기 수
  vetFocus: 1,
  holdSat: -6,
  holdFocus: -2,
  analystCost: 30000,
  trustYouth: 2, // 팀장을 믿어 주면 다음 드래프트 풀 품질
  coldYouth: -2, // 팀장과 서먹해지면
  crackCostMin: 10000, // 단속 비용: 팬 규모 비례, 최소 1억
  crackCostPerFan: 1.5,
  crackSat: 4,
  crackFans: 100,
  crackDemand: 0.95, // 검문 대기로 다음 홈경기 수요가 준다
  crackGames: 3,
  ignoreSat: -4,
  hikeTicket: 1.12, // 가격 인상 안내: 암표 웃돈을 정가로 흡수
  hikeGames: 5,
  hikeSat: -7,
  meetTicket: 0.8,
  meetSat: 8,
  silentSat: -6,
  goodsCostMin: 15000, // 굿즈 콜라보 투자: 팬 규모 비례, 최소 1.5억
  goodsCostPerFan: 2.5,
  goodsMult: 3,
  goodsFans: 0.05, // 한정판을 사러 온 새 팬 (팬 규모 대비)
  goodsStar: 70,
  tourDemand: 1.15, // 관광객 패키지
  tourTicket: 0.9,
  tourSat: -3,
  weekendFill: 0.8,
  raiseRate: 0.2,
  refuseStar: -10,
  refuseAbil: -2,
  refuseFans: -200,
  earlyGames: 8, // 조기 복귀: 이만큼 이상 결장하는 핵심 선수만
  earlyTop: 3, // 타자는 팀 내 오버롤 상위 이 인원, 투수는 1~2선발
  armApps: 10, // 혹사: 최근 15경기 중 이만큼 이상 구원 등판하면 '팔은 소모품이 아니다'
  armAppsSwarm: 9, // 벌떼 방침이면 이만큼
  armRest: 6, // 쉬게 한다: 등판 제외 경기 수
  armRisk: 3, // 계속 쓴다: 부상 확률 배율
  armRiskGames: 12,
  armOut: [12, 30], // 혹사 기간에 다치면 결장 경기 수
  armStf: -3, // 계속 쓴다: 구위 (고를 때마다 누적)
  reinjury: 0.3,
  pushGain: 3,
  pushSlump: -3,
  benchSat: -2,
  retireDemand: 1.2,
  retireAge: 37, // 은퇴를 꺼내는 나이 (KBO 스타들은 대개 38~41세에 은퇴). 40세가 되면 season.ts 가 은퇴시킨다
  stayAge: 38, // 이 나이까지는 '한 해 더'를 권할 수 있다
  tourDay: 48,
  stayBonus: 0.2, // '한 해 더' 설득 비용 (연봉 대비)
  staySat: 2,
  retireStar: 50,
  retireCost: 4000, // 기념 경기 행사 비용 (스케일 적용)
  quietSat: -3,
  typhoonTired: 2,
  typhoonFocus: -3,
  typhoonGames: 3,
  domeTrust: 10,
  domeCash: 200000,
  dealTrust: -25,
  dealSat: -10,
};

interface CardDef {
  id: string;
  prio: number; // 높을수록 먼저
  forced?: boolean; // 중간 점검·장의 대본 카드: 간격·상한 예외
  when: (core: Core) => boolean;
  make: (core: Core, rng: Rng) => EventCard | null;
  resolve: (core: Core, idx: number, card: EventCard, rng: Rng) => string;
}

const scale = (core: Core) => 1 + core.campaign.stage * STAGE_SCALE + core.fans / FAN_SCALE;
const money = (core: Core, v: number) => Math.round((v * scale(core)) / 1000) * 1000;
const fanCost = (core: Core, min: number, perFan: number) => Math.max(min, Math.round((core.fans * perFan) / 1000) * 1000);
const goodsCut = (m: number) => 1 + (m - 1) / 2;
const cashGate = (core: Core, cost: number): string | undefined => (core.finance.cash < cost ? `현금 부족 (필요 ${fmtMoney(cost)})` : undefined);

/**
 * 이 선택지가 지금 막혀 있는가. 현금이 드는 선택은 카드를 만든 때가 아니라 **지금 현금**으로 다시 본다
 * (카드를 띄워 둔 채 대출을 받거나 선수를 팔면 풀려야 한다). 예전 세이브의 카드는 금액이 없어 사유 문구에서 읽는다.
 */
export function choiceBlocked(core: Pick<Core, 'finance'>, ch: { disabled?: string; cashNeed?: number }): string | undefined {
  if (ch.cashNeed !== undefined) return core.finance.cash < ch.cashNeed ? `현금 부족 (필요 ${fmtMoney(ch.cashNeed)})` : ch.disabled?.startsWith('현금 부족') ? undefined : ch.disabled;
  const m = ch.disabled?.match(/^현금 부족 \(필요 ([0-9.,]+)(억|만)\)$/);
  if (m) {
    const need = Number(m[1].replace(/,/g, '')) * (m[2] === '억' ? 10000 : 1);
    return core.finance.cash >= need * 1.03 ? undefined : ch.disabled; // 반올림된 표기라 3% 여유를 둔다
  }
  return ch.disabled;
}

// ───────── 선택지를 지금 상태로 다시 본다 ─────────
// 카드를 띄워 둔 채 [이적 창구 ⤢]로 선수단을 바꿀 수 있으니, 인원·현금이 걸린 막힘은 카드를 만든 때가 아니라 지금 상태로 본다.
// (전에는 만든 때의 사유가 굳어: 자리를 비워도 계속 막히고, 반대로 최소 인원을 깨고도 "보낸다"가 통했다)
// 카드 id 와 선택지 이름으로 고른다 — 이미 세이브에 있는 카드에도 통한다. null = 다시 볼 규칙이 없다(만든 때 사유 그대로)

const gone = '이미 팀을 떠난 선수입니다';
function leaveWhy(core: Core, pid: string | undefined): string | undefined {
  const t = userTeam(core);
  const p = pid ? t.roster.find((x) => x.id === pid) : undefined;
  if (!p) return gone;
  if (p.farm) return undefined;
  const same = activeRoster(t).filter((x) => x.kind === p.kind).length;
  if (p.kind === 'B' && same <= MIN_BATTERS) return `1군 타자는 최소 ${MIN_BATTERS}명이 필요합니다`;
  if (p.kind === 'P' && same <= MIN_PITCHERS) return `1군 투수는 최소 ${MIN_PITCHERS}명이 필요합니다`;
  return undefined;
}
const actFull = (core: Core) => activeRoster(userTeam(core)).length >= ROSTER_MAX;

function liveRule(core: Core, card: EventCard, i: number): string | undefined | null {
  const ch = card.choices[i];
  const [base, sub2, sub3] = card.id.split('|');
  if (base === TRADE_ID) {
    if (i === 1) return undefined;
    const of = parseOffer(card.id);
    if (!of) return null;
    if (i === 2 && of.fair === of.cash) return '더 조정할 여지가 없습니다';
    return tradeBlocked(core, of, i === 2 ? of.fair : of.cash);
  }
  if (base === RESIGN_ID) {
    if (!userTeam(core).roster.some((x) => x.id === sub2)) return gone;
    return i === 1 ? leaveWhy(core, sub2) : undefined;
  }
  if (base === MLB_ID && sub2 === 'post') return i === 0 ? leaveWhy(core, sub3) : userTeam(core).roster.some((x) => x.id === sub3) ? undefined : gone;
  if (base === MLB_ID && sub2 === 'back') {
    const t = userTeam(core);
    return i === 0 && actFull(core) && farmRoster(t).length >= farmMax(core) ? '1군·2군이 가득 찼습니다' : undefined;
  }
  if (base === 'oldeye' && sub2 === 'unsigned' && i === 0) {
    const p = core.freeAgents.find((x) => x.id === card.pid);
    if (!p) return '이미 시장을 떠난 선수입니다';
    if (actFull(core)) return '1군이 가득 찼습니다';
    if (p.foreign && userTeam(core).roster.filter((x) => x.foreign).length >= FOREIGN_MAX) return `외국인 선수는 최대 ${FOREIGN_MAX}명까지 보유할 수 있습니다`;
    return undefined;
  }
  if (base === 'oldeye' && ch?.label === '데이터 분석원을 채용한다') return cashGate(core, N.analystCost); // 예전 세이브의 카드에는 cashNeed 가 없다
  if (base === 'f-pain' && ch?.label === '내린다') {
    const t = userTeam(core);
    if (farmRoster(t).length >= farmMax(core)) return '2군이 가득 찼습니다';
    return leaveWhy(core, card.pid);
  }
  if ((base === 'f-ready' || base === 'f-hype') && i === 0) {
    const down = sub3 ? userTeam(core).roster.find((x) => x.id === sub3 && !x.farm) : undefined;
    return actFull(core) && !down ? '1군이 가득하고 내릴 선수가 없습니다' : undefined;
  }
  if ((base === 'dope' && ch?.label === '조용히 내보낸다') || (base === 'fix' && ch?.label === '전면 협조한다')) return leaveWhy(core, card.pid);
  return null;
}

/** 이 카드의 i번째 선택지가 **지금** 막혀 있는가 (화면 · 고를 때 같은 판정). 현금은 choiceBlocked 대로 */
export function cardChoiceBlocked(core: Core, card: EventCard, i: number): string | undefined {
  const ch = card.choices[i];
  if (!ch) return '잘못된 선택입니다';
  const live = liveRule(core, card, i);
  if (live === null) return choiceBlocked(core, ch);
  // 인원 사유는 지금 상태로 바꾸고, 현금 사유만 예전 판정(cashNeed · 문구)대로 덧붙인다
  return live ?? choiceBlocked(core, { cashNeed: ch.cashNeed, disabled: ch.disabled?.startsWith('현금 부족') ? ch.disabled : undefined });
}

const sat = (core: Core, d: number) => (core.fanSat = satAfter(core, d));
const spend = (core: Core, v: number) => {
  core.finance.cash -= v;
  core.finance.ledger.upkeep += v;
};
const addBuff = (core: Core, b: Buff) => core.campaign.buffs.push(b);
const findUser = (core: Core, pid?: string) => (pid ? userTeam(core).roster.find((p) => p.id === pid) : undefined);
const parts = (card: EventCard) => card.id.split('|');
const sgn = (v: number) => (v >= 0 ? `+${v}` : `${v}`);
const pctTxt = (m: number) => `${m >= 1 ? '+' : '−'}${Math.abs(Math.round((m - 1) * 100))}%`;
/** 방금 치른 경기일 */
const lastDay = (core: Core) => core.day - 1;

type AbilKey = 'con' | 'pow' | 'eye' | 'spd' | 'def' | 'stf' | 'ctl' | 'sta';
const keysOf = (p: Player): AbilKey[] => (p.kind === 'B' ? ['con', 'pow', 'eye', 'spd', 'def'] : ['stf', 'ctl', 'sta']);
function bump(p: Player, rng: Rng, d: number, n: number): void {
  const ks = keysOf(p);
  for (let i = 0; i < n; i++) {
    const k = pick(rng, ks);
    p[k] = clamp(p[k] + d, 20, 99);
  }
  p.ovr = calcOvr(p);
  p.pot = Math.max(p.pot, p.ovr);
}

/** 카드 공통 필드: 인물·대사는 story.ts 에서 */
function card(id: string, lineKey: string | null, o: Omit<EventCard, 'id' | 'who' | 'line'> & { who?: CharId; line?: string }): EventCard {
  const l = lineKey ? CARD_LINES[lineKey] : undefined;
  return { id, ...o, ...(o.who ?? l?.who ? { who: o.who ?? l!.who } : {}), ...(o.line ?? l?.line ? { line: o.line ?? l!.line } : {}) };
}

const lineupIds = (core: Core) => new Set(userTeam(core).lineup.map((s) => s.pid));
const keyIds = (core: Core) => {
  const t = userTeam(core);
  return new Set([...t.lineup.map((s) => s.pid), ...t.rotation, ...(t.closer ? [t.closer] : [])]);
};
const benchBatters = (core: Core) => {
  const ids = lineupIds(core);
  return userTeam(core).roster.filter((p) => p.kind === 'B' && !p.farm && !ids.has(p.id) && p.injury === 0);
};
/** 그 자리에 들어갈 가장 나은 벤치 타자 */
const benchFor = (core: Core, pos: BatPos): Player | null => {
  const b = benchBatters(core);
  return b.length ? b.reduce((a, x) => (slotValue(a, pos) >= slotValue(x, pos) ? a : x)) : null;
};
const penArms = (core: Core) => {
  const t = userTeam(core);
  const ids = new Set([...t.bullpen, ...(t.closer ? [t.closer] : [])]);
  return t.roster.filter((p) => ids.has(p.id) && !p.farm && p.injury === 0);
};
const STYLE_KO = { trust: '믿음', balance: '균형', swarm: '벌떼' } as const;
const NONE = { rows: [rowNone()] };
/** 간판의 인상 뒤 연봉 */
const raised = (p: Player) => Math.round(p.salary * (1 + N.raiseRate));
const stayCost = (p: Player) => Math.round(p.salary * N.stayBonus);

// ── 카드별 보조 ──

/** 베테랑 복귀 요구의 대상: 벤치의 30세 이상 타자 중 이름값이 가장 큰 선수와, 그가 밀어낼 자리 */
function veteranCase(core: Core): { vet: Player; slot: number; out: Player } | null {
  const t = userTeam(core);
  const vets = benchBatters(core).filter((p) => p.age >= 30);
  if (!vets.length) return null;
  const vet = vets.reduce((a, b) => (a.age + a.salary / 10000 >= b.age + b.salary / 10000 ? a : b));
  const byId = new Map(t.roster.map((p) => [p.id, p]));
  const cands = t.lineup.map((s, i) => ({ i, s, p: byId.get(s.pid) })).filter((x): x is { i: number; s: { pid: string; pos: BatPos }; p: Player } => !!x.p);
  if (!cands.length) return null;
  const same = cands.filter((x) => x.s.pos === vet.pos || x.s.pos === 'DH');
  const tgt = (same.length ? same : cands).reduce((a, b) => (a.p.age <= b.p.age ? a : b));
  // 감독이 미는 건 이름값이다 — 실력이 더 나은 선수를 벤치에 둔 경우(전임 체제의 유산)는 이 갈등이 아니다
  if (slotValue(vet, tgt.s.pos) >= slotValue(tgt.p, tgt.s.pos)) return null;
  return { vet, slot: tgt.i, out: tgt.p };
}

/** 스카우트 팀장이 고른 선수의 상태 */
function scoutPickCase(core: Core): { p: Player; state: 'unsigned' | 'slump' } | null {
  const pid = memoGet(core, 'scoutPick');
  if (!pid) return null;
  const fa = core.freeAgents.find((p) => p.id === pid);
  if (fa) return { p: fa, state: 'unsigned' };
  const mine = findUser(core, pid);
  if (!mine) return null;
  const slump = mine.kind === 'B' ? mine.bat.pa >= 30 && ops(mine) < 0.66 : mine.pit.outs >= 30 && era(mine) > 5.0;
  return slump ? { p: mine, state: 'slump' } : null;
}

function recentSellouts(core: Core): number {
  return (memoGet(core, 'so') ?? '').slice(-5).split('').filter((ch) => ch === '1').length;
}

/** 간판(star 최고) 선수가 타이틀 3위 이내인가 */
function titleRace(core: Core): Player | null {
  const t = userTeam(core);
  const act = t.roster.filter((x) => !x.farm);
  if (!act.length) return null;
  const p = act.reduce((a, b) => (a.star >= b.star ? a : b));
  if (p.star < 55) return null;
  const top3 = (rows: { pid: string }[]) => rows.some((r) => r.pid === p.id);
  const hit =
    p.kind === 'B'
      ? (['avg', 'hr', 'rbi', 'sb'] as const).some((c) => top3(batLeaders(core, c, 3)))
      : (['era', 'w', 'sv', 'so'] as const).some((c) => top3(pitLeaders(core, c, 3)));
  return hit ? p : null;
}

/** 조기 복귀를 꺼낼 만한 부상자: 팀 내 오버롤 상위 3명(타자) 또는 1~2선발 (징계 중인 선수는 아니다) */
const hurtStarters = (core: Core) => {
  const t = userTeam(core);
  const top = t.roster.filter((p) => p.kind === 'B' && !p.farm).sort((a, b) => b.ovr - a.ovr).slice(0, N.earlyTop);
  const ids = new Set([...top.map((p) => p.id), ...t.rotation.slice(0, 2)]);
  return t.roster.filter((p) => ids.has(p.id) && p.injury >= N.earlyGames && !p.ban);
};

/** 세대교체 구간에서 새로 주전에 오른 23세 이하 */
function promotedYoung(core: Core): Player | null {
  const before = new Set((memoGet(core, 'lu48') ?? '').split(','));
  if (before.size <= 1) return null;
  const t = userTeam(core);
  const ids = lineupIds(core);
  return t.roster.find((p) => ids.has(p.id) && p.age <= 23 && !before.has(p.id)) ?? null;
}

const appsOf = (p: Player) => (p.apps ?? '').split('').filter((ch) => ch === '1').length;
// 혹사: 방침과 무관하게, 최근 15경기 중 10경기(벌떼는 9경기) 이상 등판한 1군 구원 (이미 쉬는 중이면 제외)
const overworked = (core: Core) => {
  const t = userTeam(core);
  const ids = new Set([...t.bullpen, ...(t.closer ? [t.closer] : [])]);
  const need = core.campaign.penStyle === 'swarm' ? N.armAppsSwarm : N.armApps;
  const resting = new Set(core.campaign.buffs.filter((b) => b.kind === 'rest' && b.pid).map((b) => b.pid));
  return t.roster.filter((p) => ids.has(p.id) && !p.farm && p.injury === 0 && !resting.has(p.id) && appsOf(p) >= need).sort((a, b) => appsOf(b) - appsOf(a) || b.ovr - a.ovr);
};
/** 그 투수를 불펜에서 뺐을 때의 불펜 전력과 경기당 승수 변화 (표시용) */
function penWithout(core: Core, p: Player): { a: number; b: number; wins: number } {
  const t = userTeam(core);
  const c = structuredClone(t);
  c.roster = c.roster.filter((x) => x.id !== p.id);
  fixLineup(c);
  const pa = teamParts(t);
  const pb = teamParts(c);
  return { a: pa.pen, b: pb.pen, wins: winDelta(pa, pb) };
}
const retiree = (core: Core) =>
  userTeam(core)
    .roster.filter((p) => !p.farm && p.age >= N.retireAge && p.star >= N.retireStar)
    .sort((a, b) => b.star - a.star)[0];

export const CARDS: CardDef[] = [
  // ───────── FA 자격 재계약 (스토브리그. 시즌 중에는 뽑히지 않고 contract.ts drawResign 이 올린다) ─────────
  { id: RESIGN_ID, prio: 0, forced: true, when: () => false, make: () => null, resolve: (c, i, cd) => resolveResignMut(c, i, cd) },
  // ───────── 부채 한도 초과: 매각 카드 (debt.ts drawDebtSale 이 올린다. 일반 카드 예산과 별도) ─────────
  { id: DEBT_SALE_ID, prio: 0, forced: true, when: () => false, make: () => null, resolve: (c, i, cd) => resolveDebtSaleMut(c, i, cd) },
  // ───────── 중간 점검 (42경기 직후, 매 시즌, 조합장) ─────────
  {
    id: 'midcheck',
    prio: 100,
    forced: true,
    when: (c) => c.day >= midDay(c) && c.day < midDay(c) + 6,
    make: (c) => {
      const ahead = flagOnTrack(c);
      const st = stageOf(c);
      const story = STAGE_STORY[clamp(c.campaign.stage, 0, STAGE_STORY.length - 1)];
      const flag = c.campaign.objectives.find((o) => o.main)?.text ?? st.name;
      return card(`midcheck|${ahead ? 'ahead' : 'behind'}`, null, {
        title: '조합장 면담',
        icon: '🍊',
        who: 'chair',
        line: ahead ? story.midAhead : story.midBehind,
        body: `${ahead ? `시즌 절반. 지금 페이스면 「${flag}」에 닿습니다.` : `시즌 절반. 지금 페이스로는 「${flag}」에 닿지 못합니다.`}${flagForecast(c).text === '—' ? '' : ` ${flagForecast(c).text}`}`,
        choices: ahead
          ? [
              {
                label: '목표 상향을 약속한다',
                desc: `달성 지원금 ×${MID_UP_MULT} · 실패 시 ${TRUST_LABEL} −${MID_UP_FAIL_TRUST} 더`,
                detail: {
                  rows: [
                    rowInfo('목표 달성 지원금', fmtMoney(st.reward.cash * MID_UP_MULT), fmtMoney(st.reward.cash), 'good'),
                    rowInfo(`목표 실패 시 ${TRUST_LABEL}`, `−${st.failTrust + MID_UP_FAIL_TRUST}`, `−${st.failTrust}`, 'bad'),
                  ],
                  lasts: '이번 시즌 결산',
                },
              },
              { label: '사양한다', desc: '변화 없음', detail: { rows: [rowInfo('목표 달성 지원금', fmtMoney(st.reward.cash), fmtMoney(st.reward.cash)), rowInfo(`목표 실패 시 ${TRUST_LABEL}`, `−${st.failTrust}`, `−${st.failTrust}`)] } },
            ]
          : [
              {
                label: '조합원 특별 출자를 받는다',
                desc: `현금 +${fmtMoney(st.midCash)} · 실패 시 ${TRUST_LABEL} −${MID_FAIL_TRUST} 더`,
                detail: { rows: [rowCash(c, st.midCash), rowInfo(`목표 실패 시 ${TRUST_LABEL}`, `−${st.failTrust + MID_FAIL_TRUST}`, `−${st.failTrust}`, 'bad')], lasts: '이번 시즌 결산' },
              },
              { label: '지금대로 간다', desc: '변화 없음', detail: { rows: [rowCash(c, 0), rowInfo(`목표 실패 시 ${TRUST_LABEL}`, `−${st.failTrust}`, `−${st.failTrust}`)] } },
            ],
      });
    },
    resolve: (c, i, cd) => {
      const ahead = parts(cd)[1] === 'ahead';
      if (i !== 0) return ahead ? '약속은 아껴 두었습니다' : '조합원들의 주머니는 건드리지 않았습니다';
      if (ahead) {
        memoSet(c, 'mid', 'up');
        return '조합장에게 더 높은 곳을 약속했습니다';
      }
      const v = stageOf(c).midCash;
      c.finance.cash += v;
      c.finance.ledger.league += v;
      memoSet(c, 'mid', 'loan');
      hintMut(c, 'finance');
      return `조합원 특별 출자 — 현금 +${fmtMoney(v)}`;
    },
  },

  // ───────── 장의 대본 카드 ─────────
  {
    id: 'dome',
    prio: 95,
    forced: true,
    when: (c) => c.campaign.stage === 4 && !!beatOn(c, c.day, 'dome'),
    make: (c) =>
      card('dome', 'dome', {
        title: '돔구장의 제안',
        icon: '🏟️',
        body: '육지의 한 도시가 신축 돔구장과 이전 지원금을 내밀었습니다. 우승을 눈앞에 둔 지금.',
        choices: [
          { label: '거절한다', desc: `${TRUST_LABEL} ${sgn(N.domeTrust)}`, detail: { rows: [rowTrust(c, N.domeTrust), rowCash(c, 0)] } },
          {
            label: '협상 테이블에 앉는다',
            desc: `현금 +${fmtMoney(N.domeCash)} · ${TRUST_LABEL} ${N.dealTrust}`,
            detail: { rows: [rowCash(c, N.domeCash), rowTrust(c, N.dealTrust), rowSat(c, N.dealSat), rowInfo('엔딩', '협상 테이블이 남는다', '섬에 남는다', 'bad')] },
          },
        ],
      }),
    resolve: (c, i) => {
      if (i === 0) {
        c.campaign.trust = clamp(c.campaign.trust + N.domeTrust, 0, 100);
        return '"이 팀은 섬의 것입니다" — 제안을 돌려보냈습니다';
      }
      c.finance.cash += N.domeCash;
      c.finance.ledger.league += N.domeCash;
      c.campaign.trust = clamp(c.campaign.trust + N.dealTrust, 0, 100);
      c.campaign.dealt = true;
      sat(c, N.dealSat);
      return '협상 테이블에 앉았습니다 — 소문은 하루 만에 섬을 돌았습니다';
    },
  },
  {
    id: 'veteran',
    prio: 90,
    forced: true,
    when: (c) => c.campaign.stage === 0 && !c.campaign.managerYielded && !!beatOn(c, lastDay(c), 'road-trip') && userTeam(c).rec.streak <= -3 && !!veteranCase(c),
    make: (c) => {
      const v = veteranCase(c);
      if (!v) return null;
      return card(`veteran|${v.slot}`, 'veteran', {
        title: '베테랑 복귀 요구',
        icon: '🧓',
        pid: v.vet.id,
        body: `원정 ${-userTeam(c).rec.streak}연패. 감독이 벤치의 ${v.vet.name}(${v.vet.age}세, 오버롤 ${v.vet.ovr})을 ${v.out.name}(${v.out.age}세, 오버롤 ${v.out.ovr}) 자리에 쓰겠다고 합니다.`,
        choices: [
          {
            label: '복귀시킨다',
            desc: `${v.vet.name} ${N.vetGames}경기 고정 출전 · 집중력 ${sgn(N.vetFocus)}`,
            detail: {
              rows: [rowOvr(`${posKo(userTeam(c).lineup[v.slot].pos)} 주전`, v.out.ovr, v.vet.ovr), rowAdd('집중력', N.vetFocus), rowInfo(v.out.name, `벤치 (${N.vetGames}경기 뒤 복귀)`, '주전', 'bad')],
              pids: [v.vet.id, v.out.id],
              compare: [v.vet.id, v.out.id],
              lasts: `고정 출전 ${N.vetGames}경기 · 집중력 ${BUFF_GAMES}경기`,
            },
          },
          {
            label: '지금 타순을 고수한다',
            desc: `팬 만족도 ${N.holdSat} · 집중력 ${N.holdFocus}`,
            detail: {
              rows: [rowSat(c, N.holdSat), rowAdd('집중력', N.holdFocus), rowInfo('감독', '편성에서 손을 뗀다', '기용에 반발', 'good')],
              pids: [v.vet.id, v.out.id],
              compare: [v.vet.id, v.out.id],
              lasts: `집중력 ${BUFF_GAMES}경기`,
            },
          },
        ],
      });
    },
    resolve: (c, i, cd) => {
      const t = userTeam(c);
      const vet = findUser(c, cd.pid);
      if (i === 0) {
        const slot = t.lineup[Number(parts(cd)[1])];
        if (vet && slot && !t.lineup.some((s) => s.pid === vet.id)) {
          memoSet(c, `fx-${vet.id}`, slot.pid); // 고정 출전이 끝나면 밀려난 선수가 제자리로 돌아온다
          slot.pid = vet.id;
        }
        if (vet) addBuff(c, { kind: 'fixed', value: 1, until: c.day + N.vetGames, label: `${vet.name} 고정 출전`, pid: vet.id });
        addBuff(c, { kind: 'focus', value: N.vetFocus, until: c.day + BUFF_GAMES, label: `라커룸 안정 집중력 ${sgn(N.vetFocus)}` });
        hintMut(c, 'lineup');
        return `${vet?.name ?? '베테랑'} 선발 복귀 — 감독의 얼굴이 폈습니다`;
      }
      sat(c, N.holdSat);
      addBuff(c, { kind: 'focus', value: N.holdFocus, until: c.day + BUFF_GAMES, label: `라커룸 동요 집중력 ${N.holdFocus}` });
      c.campaign.managerYielded = true;
      addNews(c, NEWS.managerYield, 'info');
      return '타순을 지켰습니다 — 감독은 말없이 수첩을 덮었습니다';
    },
  },
  {
    id: 'notyet',
    prio: 90,
    forced: true,
    when: (c) => c.campaign.stage === 2 && !!beatOn(c, lastDay(c), 'gen-change') && !!promotedYoung(c),
    make: (c) => {
      const p = promotedYoung(c);
      if (!p) return null;
      return card('notyet', 'notyet', {
        title: '아직 이릅니다',
        icon: '🌱',
        pid: p.id,
        body: `${p.name}(${p.age}세, 오버롤 ${p.ovr} · 잠재력 ${p.pot})이 주전 명단에 올랐습니다. 2군 코치가 찾아왔습니다.`,
        choices: [
          {
            label: '밀어붙인다',
            desc: `50% 능력치 합 +${N.pushGain * 2} · 50% ${BUFF_LONG}경기 슬럼프`,
            detail: {
              rows: [rowInfo('성공 50%', `능력치 합 +${N.pushGain * 2} (영구)`, undefined, 'good'), rowInfo('실패 50%', `능력치 ${N.pushSlump} (${BUFF_LONG}경기)`, undefined, 'bad'), rowInfo('잠재력까지', `${Math.max(0, p.pot - p.ovr)}`, undefined)],
              pids: [p.id],
              risk: `슬럼프 50%: ${BUFF_LONG}경기 능력치 ${N.pushSlump}`,
            },
          },
          (() => {
            const pos = userTeam(c).lineup.find((s) => s.pid === p.id)?.pos;
            const alt = pos ? benchFor(c, pos) : null;
            return {
              label: '내린다',
              desc: `${p.name} 벤치로 · 팬 만족도 ${N.benchSat}`,
              detail: {
                rows: [rowSat(c, N.benchSat), ...(pos && alt ? [rowOvr(`${posKo(pos)} 주전`, p.ovr, alt.ovr), rowInfo('들어오는 선수', `${alt.name} (${alt.age}세)`)] : [rowInfo('벤치', '대신할 타자 없음 — 그대로 출전')])],
                pids: [p.id, ...(alt ? [alt.id] : [])],
                ...(alt ? { compare: [alt.id, p.id] as [string, string] } : {}),
              },
            };
          })(),
        ],
      });
    },
    resolve: (c, i, cd, rng) => {
      const p = findUser(c, cd.pid);
      if (!p) return '없던 일이 되었습니다';
      if (i === 0) {
        if (rng() < 0.5) {
          const before = p.ovr;
          bump(p, rng, 1, N.pushGain * 2);
          return `${p.name}, 1군 무대에서 껍질을 깼습니다 — 오버롤 ${before} → ${p.ovr}`;
        }
        addBuff(c, { kind: 'slump', value: N.pushSlump, until: c.day + BUFF_LONG, label: `${p.name} 슬럼프`, pid: p.id });
        return `${p.name}, 1군의 벽에 부딪혔습니다 — ${BUFF_LONG}경기 슬럼프`;
      }
      const t = userTeam(c);
      const slot = t.lineup.find((s) => s.pid === p.id);
      const alt = slot ? benchFor(c, slot.pos) : null;
      if (slot && alt) slot.pid = alt.id;
      sat(c, N.benchSat);
      return `${josa(p.name, '을', '를')} 벤치로 내렸습니다`;
    },
  },
  {
    id: 'arm',
    prio: 85,
    forced: true,
    // 장의 대본 카드처럼 일반 예산 밖이지만, 한 번 나오면 다음 시즌은 쉰다 (memo.ts CARD_REST_OF)
    when: (c) => cardRested(c, 'arm') && overworked(c).length > 0,
    make: (c) => {
      const p = overworked(c)[0];
      if (!p) return null;
      markCardMut(c, 'arm');
      const loss = penWithout(c, p);
      const lossWins = Math.round(loss.wins * N.armRest * 10) / 10;
      const after = { ...p, stf: clamp(p.stf + N.armStf, 20, 99) };
      const risk = armOdds(c);
      const riskTxt = `부상 확률 ${pct1(risk.base)} → ${pct1(risk.pushed)}`;
      return card('arm', 'arm', {
        title: '팔은 소모품이 아니다',
        icon: '💪',
        pid: p.id,
        body: `${p.name}(${posKo(p.pos)}, 오버롤 ${p.ovr})이 최근 ${(p.apps ?? '').length}경기 중 ${appsOf(p)}경기에 등판했습니다. 불펜 방침은 ${STYLE_KO[c.campaign.penStyle ?? 'balance']}.`,
        choices: [
          {
            label: '쉬게 한다',
            desc: `${p.name} ${N.armRest}경기 등판 제외 · 불펜 ${loss.a} → ${loss.b}`,
            detail: {
              rows: [
                rowInfo('불펜 전력', `${loss.b}`, `${loss.a}`, loss.b < loss.a ? 'bad' : 'info'),
                rowInfo(`예상 승수 (${N.armRest}경기)`, lossWins ? `−${Math.abs(lossWins).toFixed(1)}` : '±0.0', '±0.0', lossWins ? 'bad' : 'info'),
                rowInfo(`${p.name} 연투`, '0일 (구위 ±0)', `${p.tired ?? 0}일 (구위 −${tiredPenalty(p.tired)})`, 'good'),
                rowInfo('등판 가능 불펜', `${penArms(c).length - 1}명`, `${penArms(c).length}명`, 'bad'),
              ],
              pids: [p.id],
              lasts: `${N.armRest}경기`,
            },
          },
          {
            label: '계속 쓴다',
            desc: `${riskTxt} · 구위 ${N.armStf}`,
            detail: {
              rows: [
                rowInfo('불펜 전력', `${loss.a}`, `${loss.a}`),
                rowInfo(`${p.name} 구위`, `${after.stf}`, `${p.stf}`, 'bad'),
                rowInfo(`${p.name} 오버롤`, `${calcOvr(after)}`, `${p.ovr}`, 'bad'),
                rowInfo(`부상 확률 (${N.armRiskGames}경기)`, pct1(risk.pushed), pct1(risk.base), 'bad'),
                rowInfo('다치면 결장', `${N.armOut[0]}~${N.armOut[1]}경기`, '3~16경기', 'bad'),
              ],
              pids: [p.id],
              risk: `${riskTxt} (×${N.armRisk}, 등판하지 않는 날에도) · 다치면 ${N.armOut[0]}~${N.armOut[1]}경기 결장 · 구위 하락은 남습니다`,
              lasts: `${N.armRiskGames}경기`,
            },
          },
        ],
      });
    },
    resolve: (c, i, cd) => {
      const p = findUser(c, cd.pid);
      memoSet(c, PEN_OVER_KEY, 0);
      memoSet(c, PEN_OVER_SUM, 0);
      if (!p) return '없던 일이 되었습니다';
      p.apps = '';
      if (i === 0) {
        addBuff(c, { kind: 'rest', value: 1, until: c.day + N.armRest, label: `${p.name} 휴식 보장`, pid: p.id });
        delete p.tired;
        return `${p.name}에게 ${N.armRest}경기 휴식을 주었습니다`;
      }
      p.stf = clamp(p.stf + N.armStf, 20, 99);
      p.ovr = calcOvr(p);
      addBuff(c, { kind: 'armRisk', value: N.armRisk, until: c.day + N.armRiskGames, label: `${p.name} 혹사 (부상 확률 ×${N.armRisk})`, pid: p.id });
      hintMut(c, 'pitchers');
      return `${josa(p.name, '은', '는')} 오늘도 불펜에서 몸을 풉니다 — 구위 ${p.stf}`;
    },
  },
  {
    id: 'typhoon',
    prio: 80,
    forced: true,
    when: (c) => {
      const b = beatOn(c, c.day, 'rainy');
      // 섬을 떠나는 날만: 오늘이 원정이고 직전 경기가 홈 (이미 원정 중이면 비행기를 탈 일이 없다)
      return !!b && c.day >= b.from + 2 && userGame(c, c.day)?.home === false && userGame(c, c.day - 1)?.home !== false;
    },
    make: (c) =>
      card('typhoon', null, {
        title: '태풍 결항',
        icon: '🌀',
        body: '태풍으로 육지행 비행기가 전부 결항되었습니다. 다음 원정 경기를 어떻게든 치러야 합니다.',
        choices: [
          {
            label: '경기를 연기한다',
            desc: `더블헤더 · 불펜 전원 연투 ${N.typhoonTired}일`,
            detail: {
              rows: [rowInfo('연투 중인 불펜', `${penArms(c).length}명 (전원 ${N.typhoonTired}일)`, `${penArms(c).filter((p) => (p.tired ?? 0) >= 1).length}명`, 'bad'), rowInfo('다음 등판 구위', `−${tiredPenalty(N.typhoonTired)}`, '±0', 'bad'), rowAdd('집중력', 0)],
              lasts: '하루 쉬면 1일씩 회복',
            },
          },
          {
            label: '배편으로 강행한다',
            desc: `집중력 ${N.typhoonFocus} · ${N.typhoonGames}경기`,
            detail: { rows: [rowAdd('집중력', N.typhoonFocus), rowInfo('연투 중인 불펜', '변화 없음')], lasts: `${N.typhoonGames}경기` },
          },
        ],
      }),
    resolve: (c, i) => {
      if (i === 0) {
        const t = userTeam(c);
        const ids = new Set([...t.bullpen, ...(t.closer ? [t.closer] : [])]);
        for (const p of t.roster) if (ids.has(p.id)) p.tired = Math.max(p.tired ?? 0, N.typhoonTired);
        hintMut(c, 'pitchers');
        return '경기 연기 — 더블헤더로 불펜이 바닥났습니다';
      }
      addBuff(c, { kind: 'focus', value: N.typhoonFocus, until: c.day + N.typhoonGames, label: `뱃멀미 집중력 ${N.typhoonFocus}` });
      return '밤배를 탔습니다 — 선수단 얼굴이 하얗습니다';
    },
  },
  {
    id: 'oldeye',
    prio: 75,
    forced: true,
    when: (c) => c.campaign.stage === 0 && c.day >= dayAt(c, 24) && c.day < midDay(c) && !!scoutPickCase(c),
    make: (c) => {
      const s = scoutPickCase(c);
      if (!s) return null;
      const { p } = s;
      const t = userTeam(c);
      const hired = !!c.campaign.analyst;
      // 2지선다: 믿어 준다 / 데이터 분석원 채용. 이미 채용했거나 현금이 모자라면 둘째는 "수첩을 밀어낸다"(항상 고를 수 있다)
      const hire = !hired && !cashGate(c, N.analystCost);
      const second = [
        hire
          ? {
              label: '데이터 분석원을 채용한다',
              desc: `비용 ${fmtMoney(N.analystCost)} · 드래프트 등급 정확`,
              cashNeed: N.analystCost, // 카드를 띄워 둔 채 영입으로 현금을 쓰면 막혀야 한다 (음수 현금이 됐다)
              detail: { rows: [rowCash(c, -N.analystCost), rowInfo('드래프트 등급', '정확', '흐림', 'good'), rowAdd('다음 드래프트 풀 품질', N.coldYouth)], pids: [p.id], lasts: '분석원은 계속 · 품질은 다음 드래프트' },
            }
          : {
              label: hired ? '분석원의 보고서를 따른다' : '수첩을 밀어낸다',
              desc: `다음 드래프트 풀 품질 ${N.coldYouth}`,
              detail: { rows: [rowAdd('다음 드래프트 풀 품질', N.coldYouth), rowPayroll(c, 0)], pids: [p.id], lasts: '다음 드래프트' },
            },
      ];
      const tail = hire ? 'hire' : 'cold';
      if (s.state === 'unsigned') {
        const dis = t.roster.filter((x) => !x.farm).length >= ROSTER_MAX ? '1군이 가득 찼습니다' : undefined;
        return card(`oldeye|unsigned|${tail}`, 'oldeyeUnsigned', {
          title: '옛날 눈',
          icon: '📓',
          pid: p.id,
          body: `팀장이 명단 맨 위에 올린 ${p.name}(${posKo(p.pos)}, ${p.age}세, 오버롤 ${p.ovr}, 스타성 ${p.star})은 아직 시장에 있습니다.`,
          choices: [
            (() => {
              const cur = p.kind === 'B' ? t.roster.find((x) => x.id === t.lineup.find((s) => s.pos === p.pos)?.pid) : undefined;
              return {
                label: '믿어 준다',
                desc: `${p.name} 영입 · 연봉 ${fmtMoney(p.salary)}`,
                disabled: dis,
                detail: {
                  rows: [
                    rowPayroll(c, p.salary),
                    rowInfo('계약금', '면제', undefined, 'good'),
                    rowFans(c, p.star * 2),
                    rowAdd('다음 드래프트 풀 품질', N.trustYouth),
                    ...(cur ? [rowInfo(`지금 ${posKo(p.pos)} 주전`, `${cur.name} ${cur.ovr}`)] : []),
                  ],
                  pids: [p.id, ...(cur ? [cur.id] : [])],
                  ...(cur ? { compare: [p.id, cur.id] as [string, string] } : {}),
                },
              };
            })(),
            ...second,
          ],
        });
      }
      return card(`oldeye|slump|${tail}`, 'oldeyeSlump', {
        title: '옛날 눈',
        icon: '📓',
        pid: p.id,
        body: `팀장이 민 ${p.name}(${p.age}세, 오버롤 ${p.ovr})이 부진합니다.`,
        choices: [
          {
            label: '믿어 준다',
            desc: `${p.name} ${N.vetGames}경기 고정 출전 · 다음 드래프트 풀 품질 ${sgn(N.trustYouth)}`,
            detail: {
              rows: [rowInfo(p.name, `${N.vetGames}경기 고정 출전`, p.kind === 'B' ? `OPS ${ops(p).toFixed(3)}` : `평균자책점 ${era(p).toFixed(2)}`, 'bad'), rowAdd('다음 드래프트 풀 품질', N.trustYouth)],
              pids: [p.id],
              lasts: `고정 출전 ${N.vetGames}경기 · 품질은 다음 드래프트`,
            },
          },
          ...second,
        ],
      });
    },
    resolve: (c, i, cd) => {
      const t = userTeam(c);
      if (i === 0) {
        addBuff(c, { kind: 'youth', value: N.trustYouth, until: 9999, label: '스카우트 팀장의 신뢰 (드래프트 품질↑)' });
        if (parts(cd)[1] === 'unsigned') {
          const p = c.freeAgents.find((x) => x.id === cd.pid);
          if (!p) return '그 사이 다른 팀이 데려갔습니다';
          c.freeAgents = c.freeAgents.filter((x) => x.id !== p.id);
          p.since = c.season;
          p.from = 'fa';
          t.roster.push(p);
          const role = slotNewcomer(t, p);
          c.fans += p.star * 2;
          hintMut(c, 'lineup');
          return `${p.name} 입단 (${role}) — 팀장이 오랜만에 웃었습니다`;
        }
        const p = findUser(c, cd.pid);
        if (p) addBuff(c, { kind: 'fixed', value: 1, until: c.day + N.vetGames, label: `${p.name} 고정 출전`, pid: p.id });
        return '한 번 더 믿어 보기로 했습니다';
      }
      addBuff(c, { kind: 'youth', value: N.coldYouth, until: 9999, label: '스카우트 팀장과 서먹 (드래프트 품질↓)' });
      if (c.campaign.analyst || parts(cd)[2] !== 'hire') return '팀장의 수첩을 조용히 밀어냈습니다';
      spend(c, N.analystCost);
      c.campaign.analyst = true;
      return '데이터 분석원 채용 — 드래프트 보고서의 등급이 정확해집니다';
    },
  },

  // ───────── 상태가 만드는 카드 (카드 간 8경기, 시즌 5장) ─────────
  {
    id: 'meeting',
    prio: 60,
    when: (c) => userTeam(c).rec.streak <= -5,
    make: (c) =>
      card('meeting', 'meeting', {
        title: '팬 간담회',
        icon: '🙇',
        body: `${-userTeam(c).rec.streak}연패. 팬들이 간담회를 요구합니다.`,
        choices: [
          { label: '사과 + 할인', desc: `팬 만족도 ${sgn(N.meetSat)} · 입장 수입 ${pctTxt(N.meetTicket)}`, detail: { rows: [rowSat(c, N.meetSat), rowMult('입장 수입', N.meetTicket)], lasts: `할인 ${BUFF_GAMES}홈경기` } },
          { label: '침묵', desc: `팬 만족도 ${N.silentSat}`, detail: { rows: [rowSat(c, N.silentSat), rowMult('입장 수입', 1)] } },
        ],
      }),
    resolve: (c, i) => {
      if (i === 0) {
        sat(c, N.meetSat);
        addBuff(c, { kind: 'ticket', value: N.meetTicket, until: 9999, left: BUFF_GAMES, label: `사과 할인 입장 수입 ${pctTxt(N.meetTicket)}` });
        return '진심 어린 사과 — 팬심이 조금 누그러졌습니다';
      }
      sat(c, N.silentSat);
      return '침묵… 팬들의 실망이 커집니다';
    },
  },
  {
    id: 'scalper',
    prio: 55,
    when: (c) => recentSellouts(c) >= 4,
    make: (c) => {
      const cost = fanCost(c, N.crackCostMin, N.crackCostPerFan);
      return card('scalper', 'scalper', {
        title: '암표 소동',
        icon: '🎟️',
        body: '매진이 이어지자 게이트 앞에 암표상이 나타났습니다.',
        choices: [
          {
            label: '단속한다',
            desc: `비용 ${fmtMoney(cost)} · 팬 만족도 ${sgn(N.crackSat)}`,
            cashNeed: cost, disabled: cashGate(c, cost),
            detail: { rows: [rowCash(c, -cost), rowSat(c, N.crackSat), rowFans(c, N.crackFans), rowMult('관중 수요', N.crackDemand)], lasts: `검문 대기 ${N.crackGames}홈경기` },
          },
          { label: '방치한다', desc: `비용 없음 · 팬 만족도 ${N.ignoreSat}`, detail: { rows: [rowCash(c, 0), rowSat(c, N.ignoreSat)] } },
          {
            label: '가격 인상을 안내한다',
            desc: `입장 수입 ${pctTxt(N.hikeTicket)} · 팬 만족도 ${N.hikeSat}`,
            detail: { rows: [rowMult('입장 수입', N.hikeTicket), rowSat(c, N.hikeSat)], lasts: `인상 ${N.hikeGames}홈경기` },
          },
        ],
      });
    },
    resolve: (c, i) => {
      if (i === 0) {
        spend(c, fanCost(c, N.crackCostMin, N.crackCostPerFan));
        sat(c, N.crackSat);
        c.fans += N.crackFans;
        addBuff(c, { kind: 'demand', value: N.crackDemand, until: 9999, left: N.crackGames, label: `게이트 검문 수요 ${pctTxt(N.crackDemand)}` });
        return '암표 단속 — 정가에 표를 산 팬들이 박수를 보냅니다';
      }
      if (i === 1) {
        sat(c, N.ignoreSat);
        return '암표상이 활개 칩니다 — 팬들의 불만이 쌓입니다';
      }
      addBuff(c, { kind: 'ticket', value: N.hikeTicket, until: 9999, left: N.hikeGames, label: `인상 안내 입장 수입 ${pctTxt(N.hikeTicket)}` });
      sat(c, N.hikeSat);
      hintMut(c, 'stadium');
      return '웃돈이 매표소로 들어옵니다 — 정가를 믿던 팬들은 씁쓸합니다';
    },
  },
  {
    id: 'early',
    prio: 50,
    when: (c) => hurtStarters(c).length > 0,
    make: (c) => {
      const p = hurtStarters(c).sort((a, b) => b.ovr - a.ovr)[0];
      if (!p) return null;
      return card('early', 'early', {
        title: '조기 복귀',
        icon: '🩹',
        pid: p.id,
        body: `${p.name}(오버롤 ${p.ovr})이 ${p.injury}경기 남은 재활을 건너뛰고 뛰겠다고 합니다.`,
        choices: [
          {
            label: '강행',
            desc: `즉시 복귀 · 재부상 ${Math.round(N.reinjury * 100)}%`,
            detail: {
              rows: [rowInfo('성공 70%: 결장', '0경기', `${p.injury}경기`, 'good'), rowInfo(`실패 ${Math.round(N.reinjury * 100)}%: 결장`, `${p.injury + 4}~${p.injury + 10}경기`, `${p.injury}경기`, 'bad')],
              pids: [p.id],
              risk: `재부상 ${Math.round(N.reinjury * 100)}%: 4~10경기 추가 결장`,
            },
          },
          { label: '대기', desc: `재활 계속 · ${p.injury}경기 결장`, detail: { rows: [rowInfo('결장', `${p.injury}경기`, `${p.injury}경기`)], pids: [p.id] } },
        ],
      });
    },
    resolve: (c, i, cd, rng) => {
      const p = findUser(c, cd.pid);
      if (i !== 0 || !p) return '재활을 끝까지 마치기로 했습니다';
      const left = p.injury;
      if (rng() < N.reinjury) {
        p.injury = left + randInt(rng, 4, 10);
        return `${p.name} 복귀 훈련 중 재부상… ${p.injury}경기 결장`;
      }
      p.injury = 0;
      fixLineup(userTeam(c));
      return `${p.name} 조기 복귀!`;
    },
  },
  {
    id: 'goods',
    prio: 45,
    when: (c) => userTeam(c).rec.streak >= 4 && userTeam(c).roster.some((p) => p.star >= N.goodsStar),
    make: (c) => {
      const cost = fanCost(c, N.goodsCostMin, N.goodsCostPerFan);
      const fans = Math.round(c.fans * N.goodsFans);
      return card('goods', 'goods', {
        title: '굿즈 콜라보',
        icon: '🧢',
        body: `${userTeam(c).rec.streak}연승. 캐릭터 브랜드가 한정판 굿즈 콜라보를 제안했습니다.`,
        choices: [
          {
            label: '투자',
            desc: `비용 ${fmtMoney(cost)} · 굿즈 매출 ×${N.goodsMult}`,
            cashNeed: cost, disabled: cashGate(c, cost),
            detail: { rows: [rowCash(c, -cost), rowMult('굿즈 매출', N.goodsMult), rowFans(c, fans)], risk: `연승이 끊기면 남은 기간 ×${goodsCut(N.goodsMult)}`, lasts: `${BUFF_LONG}경기` },
          },
          { label: '패스', desc: '변화 없음', detail: { rows: [rowCash(c, 0), rowMult('굿즈 매출', 1)] } },
        ],
      });
    },
    resolve: (c, i) => {
      if (i !== 0) return '콜라보는 패스했습니다';
      spend(c, fanCost(c, N.goodsCostMin, N.goodsCostPerFan));
      c.fans += Math.round(c.fans * N.goodsFans);
      // pid 'streak' = 연승이 이어지는 동안의 표시. 끊기면 cutGoodsMut 이 효과를 절반으로 줄인다
      addBuff(c, { kind: 'merch', value: N.goodsMult, until: c.day + BUFF_LONG, label: `굿즈 콜라보 ×${N.goodsMult}`, pid: 'streak' });
      return '한정판 굿즈 출시!';
    },
  },
  // ───────── 트레이드 제안 (trade.ts drawTrade 가 올린다. 일반 카드와 별도 예산) ─────────
  { id: TRADE_ID, prio: 0, forced: true, when: () => false, make: () => null, resolve: (c, i, cd, rng) => resolveTradeMut(c, i, cd, rng) },
  // 메이저리그 포스팅·복귀 (스토브리그. posting.ts drawMlb 가 올린다)
  { id: MLB_ID, prio: 0, forced: true, when: () => false, make: () => null, resolve: (c, i, cd) => resolveMlbMut(c, i, cd) },
  {
    id: 'tourist',
    prio: 35,
    when: (c) => {
      const d = lastDay(c);
      const m = c.schedule[d]?.find((g) => g.homeId === c.userId);
      return !!m && d % 6 >= 4 && !!c.crowd && c.crowd.capacity > 0 && c.crowd.attendance / c.crowd.capacity < N.weekendFill;
    },
    make: (c) =>
      card('tourist', 'tourist', {
        title: '관광객 패키지',
        icon: '🧳',
        body: '여행사가 "야구장 포함 제주 패키지"를 제안했습니다.',
        choices: [
          {
            label: '여행사와 제휴한다',
            desc: `관중 수요 ${pctTxt(N.tourDemand)} · 입장 수입 ${pctTxt(N.tourTicket)}`,
            detail: { rows: [rowMult('관중 수요', N.tourDemand), rowMult('입장 수입', N.tourTicket), rowSat(c, N.tourSat)], lasts: `${BUFF_LONG}홈경기` },
          },
          { label: '거절한다', desc: '변화 없음', detail: { rows: [rowMult('관중 수요', 1), rowSat(c, 0)] } },
        ],
      }),
    resolve: (c, i) => {
      if (i !== 0) return '도민의 야구장으로 남기로 했습니다';
      sat(c, N.tourSat);
      addBuff(c, { kind: 'demand', value: N.tourDemand, until: 9999, left: BUFF_LONG, label: `관광객 패키지 수요 ${pctTxt(N.tourDemand)}` });
      addBuff(c, { kind: 'ticket', value: N.tourTicket, until: 9999, left: BUFF_LONG, label: `패키지 할인 입장 수입 ${pctTxt(N.tourTicket)}` });
      return '관광버스가 주차장을 채우기 시작했습니다';
    },
  },
  {
    id: 'tour',
    prio: 30,
    when: (c) => c.day >= N.tourDay && !!retiree(c),
    make: (c) => {
      const p = retiree(c);
      if (!p) return null;
      const fr = isFranchise(p, c.season);
      const cost = money(c, N.retireCost);
      // 고정 출전의 값: 그가 밀어낼 주전과의 OVR 차 (이미 주전이면 손해 없음)
      const t = userTeam(c);
      const cur = t.lineup.some((s) => s.pid === p.id) || t.rotation.includes(p.id) || p.kind !== 'B' ? null : t.lineup.find((s) => s.pos === p.pos) ?? t.lineup.find((s) => s.pos === 'DH');
      const out = cur ? t.roster.find((x) => x.id === cur.pid) : undefined;
      const fixRow = out ? [rowOvr(`${posKo(cur!.pos)} 주전`, out.ovr, p.ovr)] : [rowInfo('전력', '손해 없음')];
      const endRow = rowInfo('시즌 뒤', fr ? '은퇴 (영구결번)' : '은퇴', `${p.age}세`);
      const who2 = { pids: [p.id, ...(out ? [out.id] : [])], ...(out ? { compare: [p.id, out.id] as [string, string] } : {}) };
      return card('tour', 'tour', {
        title: '은퇴 투어',
        icon: '🎖️',
        pid: p.id,
        body: `${p.name}(${p.age}세, 오버롤 ${p.ovr})이 올해를 끝으로 유니폼을 벗겠다고 합니다.`,
        choices: [
          {
            label: '기념 경기',
            desc: `비용 ${fmtMoney(cost)} · 관중 수요 ${pctTxt(N.retireDemand)}`,
            cashNeed: cost, disabled: cashGate(c, cost),
            detail: { rows: [rowCash(c, -cost), rowMult('관중 수요', N.retireDemand), ...fixRow, endRow], ...who2, lasts: `${BUFF_GAMES}홈경기 (그동안 ${p.name} 고정 출전)` },
          },
          { label: '조용히', desc: `비용 없음 · 팬 만족도 ${N.quietSat}`, detail: { rows: [rowCash(c, 0), rowSat(c, N.quietSat), endRow], pids: [p.id] } },
          ...(p.age <= N.stayAge
            ? [
                {
                  label: '한 해 더',
                  desc: `잔류 보너스 ${fmtMoney(stayCost(p))} · 은퇴하지 않음`,
                  cashNeed: stayCost(p), disabled: cashGate(c, stayCost(p)),
                  detail: { rows: [rowCash(c, -stayCost(p)), rowSat(c, N.staySat), rowInfo('시즌 뒤', `잔류 (내년 ${p.age + 1}세, 능력치 하락)`, `${p.age}세`)], pids: [p.id] },
                },
              ]
            : []),
        ],
      });
    },
    resolve: (c, i, cd) => {
      const p = findUser(c, cd.pid);
      if (!p) return '조용히 시즌을 이어갑니다';
      if (i === 2) {
        spend(c, stayCost(p));
        sat(c, N.staySat);
        return `${josa(p.name, '이', '가')} 한 해 더 뛰기로 했습니다`;
      }
      memoSet(c, 'retire', p.id);
      if (i === 0) {
        spend(c, money(c, N.retireCost));
        addBuff(c, { kind: 'demand', value: N.retireDemand, until: 9999, left: BUFF_GAMES, label: `${p.name} 은퇴 투어`, pid: p.id });
        return `${p.name} 은퇴 투어 시작 — 마지막을 보러 팬들이 모입니다`;
      }
      sat(c, N.quietSat);
      return `${josa(p.name, '은', '는')} 인사 없이 마지막 시즌을 보냅니다`;
    },
  },
  {
    id: 'raise',
    prio: 25,
    when: (c) => c.day >= dayAt(c, 30) && !!titleRace(c),
    make: (c) => {
      const p = titleRace(c);
      if (!p) return null;
      return card('raise', 'raise', {
        title: '간판의 연봉 요구',
        icon: '💼',
        pid: p.id,
        body: `타이틀 경쟁 중인 ${p.name}의 에이전트가 연봉 ${Math.round(N.raiseRate * 100)}% 인상을 요구합니다.`,
        choices: [
          {
            label: '인상',
            desc: `연봉 ${fmtMoney(p.salary)} → ${fmtMoney(raised(p))}`,
            detail: { rows: [rowInfo(`${p.name} 연봉`, fmtMoney(raised(p)), fmtMoney(p.salary), 'bad'), rowPayroll(c, raised(p) - p.salary), rowInfo('스타성', `${p.star}`, `${p.star}`)], pids: [p.id], lasts: '계약이 끝날 때까지' },
          },
          {
            label: '거절',
            desc: `스타성 ${N.refuseStar} · 팬 ${N.refuseFans}`,
            detail: {
              rows: [rowInfo('스타성', `${clamp(p.star + N.refuseStar, 0, 100)}`, `${p.star}`, 'bad'), rowInfo('능력치', `무작위 1개 ${N.refuseAbil}`, undefined, 'bad'), rowFans(c, N.refuseFans), rowPayroll(c, 0)],
              pids: [p.id],
            },
          },
        ],
      });
    },
    resolve: (c, i, cd, rng) => {
      const p = findUser(c, cd.pid);
      if (!p) return '협상이 흐지부지되었습니다';
      if (i === 0) {
        p.salary = raised(p);
        hintMut(c, 'finance');
        return `${p.name} 연봉 인상 합의 — ${fmtMoney(p.salary)}`;
      }
      p.star = clamp(p.star + N.refuseStar, 0, 100);
      bump(p, rng, N.refuseAbil, 1);
      c.fans = Math.max(1000, c.fans + N.refuseFans);
      return `${p.name} 인상 거절 — 불만이 쌓입니다`;
    },
  },
];

const baseId = (id: string) => id.split('|')[0];
// 스캔들 카드(scandal.ts)까지 합친 목록. 모듈 순환을 피하려고 처음 쓸 때 만든다
let ALL: { def: Map<string, CardDef>; prio: CardDef[] } | null = null;
const all = () => (ALL ??= ((cs: CardDef[]) => ({ def: new Map(cs.map((d) => [d.id, d])), prio: cs.slice().sort((a, b) => b.prio - a.prio) }))([...CARDS, ...SCANDAL_CARDS, ...RELIEF_CARDS]));

/** 매 경기 후: 조건이 맞는 카드 중 우선순위가 가장 높은 1장을 campaign.event 에 둔다. 해당 없으면 원본 반환. */
export function maybeDrawEvent(core0: Core, rng: Rng): Core {
  if (core0.phase !== 'season' || core0.campaign.event || core0.day >= core0.schedule.length) return core0;
  // 주전 부상: 대체 선수를 고르는 카드가 먼저다 (예산·간격과 무관. subpick.ts)
  const sub = drawSubCard(core0);
  if (sub.campaign.event) return sub;
  core0 = sub;
  const sale = drawDebtSale(core0);
  if (sale) return sale;
  const seen = new Set(seenCards(core0));
  const DEF = all().def;
  const normalSeen = [...seen].filter((id) => DEF.has(id) && !DEF.get(id)!.forced).length;
  const normalOk = core0.day - memoNum(core0, 'evDay', -99) >= EVENT_GAP && normalSeen < EVENT_MAX;
  for (const d of all().prio) {
    if (seen.has(d.id) || (!d.forced && (!normalOk || !cardRested(core0, d.id))) || !d.when(core0)) continue;
    const core = structuredClone(core0);
    const cd = d.make(core, rng);
    if (!cd) continue;
    core.campaign.event = cd;
    core.campaign.eventsSeen.push(d.id);
    if (!d.forced) markCardMut(core, d.id);
    memoSet(core, 'evDay', core.day);
    return core;
  }
  // 일반 카드가 없는 날: 트레이드 제안(별도 예산: trade.ts) → 2군 사건(별도 예산: farm.ts)
  const traded = drawTrade(core0, rng);
  return traded.campaign.event ? traded : drawFarmEvent(traded, rng);
}

export function resolveEvent(core0: Core, choiceIdx: number, rng: Rng): { core: Core; error?: string; result: string } {
  const card0 = core0.campaign.event;
  if (!card0) return { core: core0, error: '처리할 이벤트가 없습니다', result: '' };
  const ch = card0.choices[choiceIdx];
  if (!ch) return { core: core0, error: '잘못된 선택입니다', result: '' };
  const blocked = cardChoiceBlocked(core0, card0, choiceIdx);
  if (blocked) return { core: core0, error: blocked, result: '' };
  const def = all().def.get(baseId(card0.id)) ?? farmCardDef(baseId(card0.id));
  const core = structuredClone(core0);
  const cd = core.campaign.event!;
  core.campaign.event = null;
  const result = baseId(cd.id) === 'sub' ? resolveSubCard(core, choiceIdx, cd) : def ? def.resolve(core, choiceIdx, cd, rng) : '이벤트가 지나갔습니다';
  core.fans = Math.max(1000, Math.round(core.fans));
  // 부상자가 팀을 떠났으면(매각·트레이드) 그 자리를 메우던 선수의 대체 표시를 지운다
  const ut = userTeam(core);
  for (const p of ut.roster) {
    if (p.subFor && !ut.roster.some((x) => x.id === p.subFor)) {
      delete p.subFor;
      delete p.subFrom;
    }
  }
  addNews(core, `${cd.icon} ${cd.title}: ${result}`, 'info');
  // 같은 날 다친 주전이 더 있으면 다음 카드로
  return { core: drawSubCard(core), result };
}

/** 혹사 기간의 경기당 추가 부상 확률: 기본 판정(등판한 날)의 (N.armRisk − 1)배를 기간 내내 고르게 건다 */
const armExtra = (core: Core) => SIM.INJ_RATE * TRAIN_INJ(core) * ARM_USE * (N.armRisk - 1);
const ARM_USE = N.armApps / 15; // 혹사 중인 구원의 등판 빈도
/** 표시용: 혹사 기간(N.armRiskGames 경기) 동안 다칠 확률 — 평소대로 쓸 때와 계속 쓸 때. armTickMut 과 같은 식 */
export function armOdds(core: Core): { base: number; pushed: number } {
  const keep = Math.pow(1 - SIM.INJ_RATE * TRAIN_INJ(core) * ARM_USE, N.armRiskGames);
  return { base: 1 - keep, pushed: 1 - keep * Math.pow(1 - armExtra(core), N.armRiskGames) };
}
const pct1 = (v: number) => `${(v * 100).toFixed(1)}%`;

/** 매 경기 후 (mutate): 혹사를 강행한 투수는 그 기간 내내(등판하지 않은 날에도) 다칠 확률이 N.armRisk 배이고, 다치면 오래 빠진다 */
export function armTickMut(core: Core, rng: Rng): void {
  for (const b of core.campaign.buffs) {
    if (b.kind !== 'armRisk' || !b.pid || core.day > b.until || b.value <= 1) continue;
    const p = findUser(core, b.pid);
    if (!p || p.ban) continue;
    // 이 기간에 경기 중 다친 경우(sim 의 기본 판정)도 혹사 부상으로 길어진다
    if (p.injury === 0 && rng() >= armExtra(core)) continue;
    p.injury = Math.max(p.injury, randInt(rng, N.armOut[0], N.armOut[1]));
    b.value = 1; // 한 번 다치면 끝
    fixLineup(userTeam(core));
    hintMut(core, 'pitchers');
    addNews(core, `${p.name}, 팔꿈치를 잡고 내려왔습니다 — ${p.injury}경기 결장`, 'bad');
  }
}
const TRAIN_INJ = (core: Core) => TRAIN_LV[core.facilities.training].inj;

/** 표시용: 이벤트 카드 종류 수 */
/** 굿즈 콜라보: 연승이 끊기면 남은 기간 효과가 절반이 된다 (mutate, 매 경기 후) */
export function cutGoodsMut(core: Core): void {
  if (userTeam(core).rec.streak > 0) return;
  for (const b of core.campaign.buffs) {
    if (b.kind !== 'merch' || b.pid !== 'streak') continue;
    b.value = goodsCut(b.value);
    b.label = `굿즈 콜라보 ×${b.value} (연승 끝)`;
    delete b.pid;
  }
}

export const EVENT_POOL_SIZE = CARDS.length;
