// 주간 브리핑: 6경기마다 스태프가 "실행 가능한 제안"을 예상 숫자와 함께 들고 온다.
// 순수 함수만 — 난수를 쓰지 않는다(브리핑은 경기 로직의 수치를 바꾸지 않는다). 실행은 season.ts 의 기존 액션을 재사용한다.
import type { BatPos, BriefDetail, BriefDone, BriefMemo, BriefMove, BriefOffer, BriefResult, Briefing, CharId, Core, Player, Team } from './types';
import { SIM, rotPenGap, type PenStyle } from './sim';
import { teamParts, type TeamParts } from './ratings';
import { BENCH_GROW, FARM_CAP, FARM_LOCK, farmMax, FOOD_LV, LOAN_STEP, LOAN_WARN, loanInterest, loanLimit, MIN_BATTERS, MIN_PITCHERS, ROSTER_MAX, SEAT_LV, TRAIN_LV, activeRoster, farmRoster, capacityOf, opProfit, payroll, previewDemand, bonusText, faHeatWhy, signingBonusFor, upgradeCost, userTeam } from './economy';
import { FOREIGN_MAX } from './events';
import { farmAutoOn, shuttleArms } from './farm';
import { PLAY_GROW, PLAY_GROW_AGE, TRAIN_MAX_AGE, callUp, farmLockLeft, farmStatText, growChance, sendDown, borrow, rankOf, releasePlayer, repay, setTicketPrice, signPlayer, upgradeFacility } from './season';
import { RUNWAY_DANGER, debtMoodText, runway, runwayAfter, runwayPieceOf, type Runway } from './runway';
import { dayAt } from './league';
import { isFranchise } from './franchise';
import { PEN_OVER_KEY, applyFixes, bullpenLoad, orderIssues, ploc, pput, tiredFront, todayIssues } from './fixes';
import { stageOf } from './campaign';
import { memoGet, memoNum, memoSet } from './memo';
import { fmtAvg, fmtEra, fmtInt, fmtMoney } from './format';
import { CHARACTERS } from './story';

export const BRIEF_EVERY = 6; // 경기
export const BRIEF_MAX = 2; // 한 번에 내는 제안 수
export const SKIP_QUIET = 12; // 넘긴 자금 대응 제안은 이 경기 수(2주) 동안 다시 내지 않는다
// ── 조용한 브리핑 (실제 유저 피드백: "뺐다 넣었다, 올렸다 내렸다") ──
export const NO_REVERSE = 36; // 번복 금지: 제안했거나 유저가 직접 한 조작의 반대 방향은 6주(36경기) 동안 내지 않는다
export const KIND_GAP_DONE = 18; // 같은 종류의 제안 간격: 실행한 뒤 3주
export const KIND_GAP_SKIP = 24; // 넘긴 뒤 4주 (자금 대응은 예외)
export const MIN_FIX_WINS = 1.5; // 편성 제안: 남은 경기 환산 승수가 이만큼 오를 때만
export const MIN_GATE_INCOME = 0.05; // 티켓값·관중석: 홈경기당 수입 +5% 이상이거나
export const MIN_GATE_ATT = 0.08; // 관중 +8% 이상일 때만
export const MIN_SIGN_PART = 3; // 영입: 해당 전력 칸이 +3 이상 오를 때만
export const REST_MIN_TIRED = 2; // 휴식: 이틀 이상 연투한 팔만
export const PROMOTE_MAX_LOSS = 1.5; // 유망주 기용: 환산 승수 손실이 이 안쪽이고
export const PROMOTE_MIN_POT = 3; // 잠재력이 지금 주전보다 이만큼 높을 때만
const SIGN_RUNWAY_MIN = 20; // 영입 제안: 실행 뒤 금고가 이 경기 수 안에 비면 내지 않는다
const EARLY_DAYS = 12; // 시즌 첫 2주
const EARLY_SALARY = 30000; // 첫 2주의 영입 제안은 연봉 3억 이하만
const CASH_KEEP = 30000; // 시설·상환 제안은 실행 후에도 현금이 이만큼 남을 때만 (3억)

const POS_NAME: Record<string, string> = { C: '포수', '1B': '1루수', '2B': '2루수', '3B': '3루수', SS: '유격수', LF: '좌익수', CF: '중견수', RF: '우익수', DH: '지명타자', SP: '선발', RP: '불펜', CP: '마무리' };
const PART_NAME: [keyof TeamParts, string][] = [['bat', '타선'], ['def', '수비'], ['rot', '선발'], ['pen', '불펜']];
const sign = (v: number, unit = '') => `${v >= 0 ? '+' : '−'}${fmtInt(Math.abs(v))}${unit}`;
const signMoney = (v: number) => `${v >= 0 ? '+' : '−'}${fmtMoney(Math.abs(v))}`;

/**
 * 전력 4칸의 차이 → 경기당 승률 차이(근사).
 * 근거: 시드 3개 × 8구단 총당(84쌍 × 240경기)을 시뮬해 승률 차이를 전력 4칸 차이에 회귀한 계수(R² 0.93):
 * 타선 1점 ≈ 0.94%p, 수비 1점 ≈ 0.40%p, 선발 1점 ≈ 1.01%p. 불펜은 선발과 같이 움직여 계수가 0 근처로 나와(−0.13%p)
 * 보수적으로 0.2%p 를 준다. 매번 1200경기를 돌리는 forecast.winChance 대신 제안 카드에서 쓰는 싼 환산이다.
 */
const WIN_PER_PART: TeamParts = { bat: 0.0094, def: 0.004, rot: 0.0101, pen: 0.002 };
export function winDelta(a: TeamParts, b: TeamParts): number {
  return PART_NAME.reduce((s, [k]) => s + (b[k] - a[k]) * WIN_PER_PART[k], 0);
}
const gamesLeft = (core: Core) => Math.max(0, core.schedule.length - core.day);
const homeLeft = (core: Core) => core.schedule.slice(core.day).filter((d) => d.some((g) => g.homeId === core.userId)).length;
const homeTotal = (core: Core) => core.schedule.filter((d) => d.some((g) => g.homeId === core.userId)).length;
const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((s, v) => s + v, 0) / xs.length) : 0);

function partsText(a: TeamParts, b: TeamParts, max = 2): string {
  return PART_NAME.map(([k, label]) => ({ label, a: a[k], b: b[k], d: b[k] - a[k] }))
    .filter((x) => x.d !== 0)
    .sort((x, y) => Math.abs(y.d) - Math.abs(x.d))
    .slice(0, max)
    .map((x) => `${x.label} ${x.a} → ${x.b}`)
    .join(' · ');
}

/** 깃발 단위로 본 예상 한 조각: 순위·가을야구 장은 예상 승수, 관중 장은 예상 평균 관중 */
function flagPiece(core: Core, o: { win?: number; att?: number }): string | undefined {
  const kind = stageOf(core).main.kind;
  if (kind === 'avgAtt') {
    if (o.att === undefined) return undefined;
    const d = Math.round((o.att * homeLeft(core)) / Math.max(1, homeTotal(core)));
    return d ? `예상 평균 관중 ${sign(d, '명')}` : undefined;
  }
  if (o.win === undefined) return undefined;
  const w = Math.round(o.win * gamesLeft(core) * 10) / 10;
  if (Math.abs(w) < 0.5) return undefined;
  return `예상 승수 ${w >= 0 ? '+' : '−'}${Math.abs(Math.round(w))}`;
}

/** 예상 결과 줄 끝에 붙는 자금 조각: 실행 뒤 금고가 30경기 안에 비거나 비는 시점이 달라질 때만 */
function cashTail(before: Core, after: Core): string {
  const s = runwayPieceOf(before, after);
  return s ? ` · ${s}` : '';
}

function memoOf(core: Core): BriefMemo {
  const m = core.campaign.briefMemo;
  return m && m.season === core.season ? m : { season: core.season, done: [], skipped: {} };
}

type Cand = BriefOffer & { score: number };

// ───────── 번복 금지 · 같은 종류 간격 ─────────

/** 주전 자리: 타순 9칸 · 선발 로테이션 · 마무리 (선수 id → 자리) */
function starters(t: Team): Record<string, string> {
  const m: Record<string, string> = {};
  for (const l of t.lineup) m[l.pid] = l.pos;
  for (const id of t.rotation) m[id] = 'SP';
  if (t.closer) m[t.closer] = 'CP';
  return m;
}
/** 두 편성 사이에 주전에 들어간(+1) 선수와 빠진(−1) 선수 */
function movesOf(a: Team, b: Team): BriefMove[] {
  const sa = starters(a);
  const sb = starters(b);
  return [...Object.keys(sb).filter((id) => !(id in sa)).map((t) => ({ t, d: 1 as const })), ...Object.keys(sa).filter((id) => !(id in sb)).map((t) => ({ t, d: -1 as const }))];
}
/** 이 제안이 최근 6주 안의 제안·조작을 되돌리는가 */
function reverses(m: BriefMemo, day: number, moves: BriefMove[] | undefined): boolean {
  return !!moves?.some((x) => (m.log ?? []).some((l) => l.t === x.t && l.d === -x.d && day - l.day <= NO_REVERSE));
}
const withLog = (m: BriefMemo, day: number, moves: BriefMove[]): BriefMemo['log'] => {
  const log = (m.log ?? []).filter((l) => day - l.day <= NO_REVERSE);
  for (const x of moves) if (!log.some((l) => l.t === x.t && l.d === x.d && l.day === day)) log.push({ ...x, day });
  return log;
};
const stateOf = (core: Core): NonNullable<BriefMemo['state']> => ({ price: core.finance.ticketPrice, seat: starters(userTeam(core)) });
/**
 * 지난 주 시점과 비교해 유저가 직접 한 조작(티켓값·주전 교체)을 적는다. 제안을 실행한 것도 같은 길로 잡힌다.
 * 부상으로 빠진 선수와 그 자리를 메운 선수는 유저의 결정이 아니므로 적지 않는다.
 */
function observe(core: Core, m: BriefMemo): BriefMemo {
  const now = stateOf(core);
  const prev = m.state;
  if (!prev) return { ...m, state: now };
  const moves: BriefMove[] = [];
  if (now.price !== prev.price) moves.push({ t: 'price', d: now.price > prev.price ? 1 : -1 });
  const t = userTeam(core);
  const byId = new Map(t.roster.map((p) => [p.id, p]));
  const ins = Object.keys(now.seat).filter((id) => !(id in prev.seat));
  const outs = Object.keys(prev.seat).filter((id) => !(id in now.seat));
  const cover = new Set<string>();
  for (const id of outs) {
    if ((byId.get(id)?.injury ?? 0) > 0) {
      const sub = ins.find((x) => !cover.has(x) && now.seat[x] === prev.seat[id]);
      if (sub) cover.add(sub);
      continue;
    }
    moves.push({ t: id, d: -1 });
  }
  for (const id of ins) if (!cover.has(id)) moves.push({ t: id, d: 1 });
  return { ...m, state: now, log: withLog(m, core.day, moves) };
}

const offer = (score: number, id: string, kind: string, who: CharId, line: string, effect: string, action: BriefOffer['action'], flag?: string, moves?: BriefMove[]): Cand => ({ score, id, kind, who, line, effect, action, ...(flag ? { flag } : {}), ...(moves?.length ? { moves } : {}) });

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** 스카우트 팀장: 최약 자리에 FA 1명. 절반은 옛 명성(나이·이름값)을 고른다 — 숫자는 현재 OVR 그대로 */
function scoutOffer(core: Core, m: BriefMemo): Cand | null {
  const t = userTeam(core);
  if (activeRoster(t).length >= ROSTER_MAX) return null;
  const byId = new Map(t.roster.map((p) => [p.id, p]));
  const foreignFull = t.roster.filter((p) => p.foreign).length >= FOREIGN_MAX;
  const can = (p: Player) => signingBonusFor(core, p) <= core.finance.cash && !(p.foreign && foreignFull) && p.injury === 0 && (core.day > EARLY_DAYS || p.salary <= EARLY_SALARY);
  // 자리별 현재 주전: 타순 9칸 + 선발 로테이션 맨 뒤
  const spots: { pos: string; cur: Player }[] = [];
  for (const l of t.lineup) {
    const p = byId.get(l.pid);
    if (p) spots.push({ pos: l.pos, cur: p });
  }
  const rot = t.rotation.map((id) => byId.get(id)).filter((p): p is Player => !!p);
  if (rot.length) spots.push({ pos: 'SP', cur: rot.reduce((a, b) => (a.ovr <= b.ovr ? a : b)) });
  const before = teamParts(t);
  let best: Cand | null = null;
  for (const s of spots.sort((a, b) => a.cur.ovr - b.cur.ovr).slice(0, 3)) {
    const pool = core.freeAgents.filter((p) => can(p) && p.ovr >= s.cur.ovr + 3 && (s.pos === 'DH' ? p.kind === 'B' : p.pos === s.pos));
    if (!pool.length) continue;
    // 그의 수첩 맨 위: 짝수 주에는 이름값(연봉·나이)이 큰 선수, 홀수 주에는 OVR 대비 싼 선수
    const oldEye = hash(`${core.seed}/${core.season}/${core.day}/scout`) % 2 === 0;
    const fame = (p: Player) => p.salary + p.age * 400 + p.star * 150;
    const value = (p: Player) => p.ovr * 1000 - p.salary * 0.6 - Math.max(0, p.age - 31) * 1500;
    const p = pool.slice().sort((a, b) => (oldEye ? fame(b) - fame(a) : value(b) - value(a)))[0];
    const r = signPlayer(core, p.id);
    if (r.error) continue;
    const after = teamParts(userTeam(r.core));
    const dw = winDelta(before, after);
    if (dw <= 0) continue;
    // 효과 문턱: 전력 칸 하나가 +3 이상 오를 때만
    if (Math.max(...PART_NAME.map(([k]) => after[k] - before[k])) < MIN_SIGN_PART) continue;
    const moves = movesOf(t, userTeam(r.core));
    if (!moves.some((x) => x.t === p.id)) moves.push({ t: p.id, d: 1 });
    if (reverses(m, core.day, moves)) continue;
    // 금액 상한: 이 영입으로 금고가 20경기 안에 비게 되면 들고 오지 않는다
    const out = runway(r.core).cashOut;
    if (out !== null && out <= SIGN_RUNWAY_MIN) continue;
    const pos = POS_NAME[s.pos] ?? s.pos;
    const c = offer(
      30 + dw * 1000,
      `sign:${s.pos}`,
      'sign',
      'scout',
      oldEye ? `${pos} 자리엔 ${p.name}입니다. ${p.age}세, 제가 한창때부터 본 선수입니다.` : `${pos} 자리가 비어 보입니다. ${p.name}, ${p.age}세면 아직 쓸 만합니다.`,
      `영입: ${pos} ${s.cur.ovr} → ${p.ovr} · ${partsText(before, after) || '전력 변화 없음'} · 연봉 +${fmtMoney(p.salary)} · ${bonusText(core, p)}${cashTail(core, r.core)}`,
      { t: 'sign', pid: p.id },
      flagPiece(core, { win: dw }),
      moves,
    );
    if (!best || c.score > best.score) best = c;
  }
  return best;
}

/** 마케팅 팀장: 매진·수요 초과면 증축 또는 인상, 빈 좌석이 많으면 인하 */
function marketingOffer(core: Core): Cand | null {
  const recent = core.attHistory.slice(-3);
  if (recent.length < 3) return null;
  const cap = capacityOf(core);
  const so = (memoGet(core, 'so') ?? '').slice(-3).split('').filter((c) => c === '1').length;
  const fill = avg(recent) / Math.max(1, cap);
  const price = core.finance.ticketPrice;
  const perGame = (c: Core) => {
    const att = Math.min(capacityOf(c), previewDemand(c));
    return { att, income: Math.round(att * (c.finance.ticketPrice + FOOD_LV[c.facilities.food].spend)) };
  };
  const now = perGame(core);
  const passGate = (a: { att: number; income: number }, b: { att: number; income: number }) => b.income - a.income >= a.income * MIN_GATE_INCOME || b.att - a.att >= a.att * MIN_GATE_ATT;
  const priceOffer = (to: number, line: string, score: number): Cand | null => {
    const next = setTicketPrice(core, to);
    if (next === core) return null;
    const then = perGame(next);
    const up = to > price;
    if (!passGate(now, then)) return null;
    return offer(
      score,
      `price:${up ? 'up' : 'down'}`,
      'gate',
      'marketing',
      line,
      `티켓값 ${price.toFixed(1)} → ${next.finance.ticketPrice.toFixed(1)}만: 홈경기당 수입 ${signMoney(then.income - now.income)} · 관중 ${sign(then.att - now.att, '명')}`,
      { t: 'price', value: next.finance.ticketPrice },
      flagPiece(core, { att: then.att - now.att }),
      [{ t: 'price', d: up ? 1 : -1 }],
    );
  };
  // 문턱을 넘는 가장 작은 폭 (0.2 → 0.4)
  const priceStep = (dir: 1 | -1, line: string, score: number) => priceOffer(price + dir * 0.2, line, score) ?? priceOffer(price + dir * 0.4, line, score);
  if (so >= 2) {
    const cost = upgradeCost('seats', core.facilities);
    if (cost !== null && core.finance.cash >= cost) {
      const lv = SEAT_LV[core.facilities.seats + 1];
      const add = lv.cap - SEAT_LV[core.facilities.seats].cap;
      const r = upgradeFacility(core, 'seats');
      const then = perGame(r.core);
      // 증축으로 금고가 20경기 안에 비게 되면 들고 오지 않는다
      const out = runway(r.core).cashOut;
      if (passGate(now, then) && !(out !== null && out <= SIGN_RUNWAY_MIN)) return offer(
        45,
        'seats',
        'gate',
        'marketing',
        '문 앞에서 돌아간 분들이 있었어요. 자리를 늘리면 다 들어오실 거예요!',
        `관중석 증축 ${fmtMoney(cost)}: ${sign(add, '석')} · 최근 발길 돌린 팬 ${fmtInt(core.crowd?.turnedAway ?? 0)}명 · 홈경기당 수입 ${signMoney(then.income - now.income)} · 유지비 +${fmtMoney(lv.upkeep - SEAT_LV[core.facilities.seats].upkeep)}${cashTail(core, r.core)}`,
        { t: 'upgrade', kind: 'seats' },
        flagPiece(core, { att: then.att - now.att }),
      );
    }
    return priceStep(1, '표가 모자라요. 조금 올려도 오실 분들은 오세요.', 38);
  }
  if (fill < 0.7) return priceStep(-1, '빈자리가 자꾸 눈에 밟혀요. 표값을 내리면 채울 수 있어요!', 36);
  return null;
}

export const PEN_OFFER_DAYS = 2; // 불펜 보강 제안: 과부하가 이만큼 이어졌거나 지금 과부하일 때
export const PEN_SIGN_SALARY = 15000; // 보강용 FA 는 연봉 1.5억 이하의 구원만
const PEN_SIGN_GAP = 4; // 불펜 최약 팔보다 이만큼 넘게 처지는 FA 는 들고 오지 않는다

/** 투수 코치: 불펜이 과부하면 팔을 하나 늘린다 — 2군 구원 콜업(공짜)이 먼저, 없으면 저가 FA 구원 */
function penOffer(core: Core): Cand | null {
  const t = userTeam(core);
  const load = bullpenLoad(t);
  if (load.label !== '과부하' && memoNum(core, PEN_OVER_KEY) < PEN_OFFER_DAYS) return null;
  if (activeRoster(t).length >= ROSTER_MAX) return null;
  const line = `불펜이 쉬지를 못합니다. 등판 가능한 투수가 ${load.rested}명입니다 — 한 명만 더 있으면 돌아갑니다.`;
  const up = shuttleArms(core)[0];
  if (up) {
    const r = callUp(core, up.id);
    if (!r.error) return { ...offer(44, 'pen', 'pen', 'pitching', line, `불펜 1명 보강: 2군 ${up.name}(오버롤 ${up.ovr}) 콜업 — 불펜 과부하 해소 · 불펜 ${load.arms} → ${load.arms + 1}명`, { t: 'fix' }, undefined, [{ t: up.id, d: 1 }]), farm: { up: up.id } };
  }
  const byId = new Map(t.roster.map((p) => [p.id, p]));
  const floor = Math.min(...t.bullpen.map((id) => byId.get(id)?.ovr ?? 99)) - PEN_SIGN_GAP;
  const foreignFull = t.roster.filter((p) => p.foreign).length >= FOREIGN_MAX;
  const fa = core.freeAgents
    .filter((p) => p.kind === 'P' && p.pos !== 'SP' && p.injury === 0 && p.salary <= PEN_SIGN_SALARY && p.ovr >= floor && signingBonusFor(core, p) <= core.finance.cash && !(p.foreign && foreignFull))
    .sort((a, b) => b.ovr - a.ovr || a.salary - b.salary)[0];
  if (!fa) return null;
  const r = signPlayer(core, fa.id);
  if (r.error) return null;
  const out = runway(r.core).cashOut;
  if (out !== null && out <= SIGN_RUNWAY_MIN) return null;
  return offer(40, 'pen', 'pen', 'pitching', line, `불펜 1명 보강: FA ${fa.name}(오버롤 ${fa.ovr}) 영입 — 불펜 과부하 해소 · 불펜 ${load.arms} → ${load.arms + 1}명 · 연봉 +${fmtMoney(fa.salary)} · ${bonusText(core, fa)}${cashTail(core, r.core)}`, { t: 'sign', pid: fa.id }, undefined, [{ t: fa.id, d: 1 }]);
}

const STYLE_KO: Record<PenStyle, string> = { trust: '믿음', balance: '균형', swarm: '벌떼' };
const styleMove = (style: PenStyle, d: 1 | -1): BriefMove => ({ t: `penStyle:${style}`, d });

/** 불펜 운영 방침을 바꾼다. 유저가 고른 방침은 6주 동안 되돌리자고 하지 않는다 (번복 금지 기록) */
export function changePenStyle(core0: Core, style: PenStyle): Core {
  const m = memoOf(core0);
  return { ...core0, campaign: { ...core0.campaign, penStyle: style, briefMemo: { ...m, log: withLog(m, core0.day, [styleMove(style, 1)]) } } };
}

/** 투수 코치: 방침과 로스터가 어긋나면 한 장 — 벌떼인데 불펜이 얇으면 구원 콜업(없으면 균형으로), 믿음인데 선발이 불펜보다 약하면 균형으로 */
function penStyleOffer(core: Core): Cand | null {
  const t = userTeam(core);
  const style = core.campaign.penStyle ?? 'balance';
  const arms = bullpenLoad(t).arms;
  if (style === 'swarm' && arms < SIM.AI_SWARM_ARMS) {
    const line = `벌떼인데 불펜 ${arms}명입니다. 이 인원으로는 팔이 남아나지 않습니다.`;
    const up = arms === SIM.AI_SWARM_ARMS - 1 && activeRoster(t).length < ROSTER_MAX ? shuttleArms(core)[0] : undefined;
    if (up && !callUp(core, up.id).error) return { ...offer(46, 'penStyle', 'penStyle', 'pitching', line, `벌떼인데 불펜 ${arms}명: 과부하 위험 — 구원 1명 콜업: 2군 ${up.name}(오버롤 ${up.ovr}) · 불펜 ${arms} → ${arms + 1}명`, { t: 'fix' }, undefined, [{ t: up.id, d: 1 }]), farm: { up: up.id } };
    return { ...offer(46, 'penStyle', 'penStyle', 'pitching', line, `벌떼인데 불펜 ${arms}명: 과부하 위험 — 균형으로`, { t: 'fix' }, undefined, [styleMove('swarm', -1)]), penStyle: 'balance' };
  }
  if (style === 'trust' && (rotPenGap(t)?.gap ?? 0) <= -SIM.AI_STYLE_GAP)
    return { ...offer(42, 'penStyle', 'penStyle', 'pitching', '믿음인데 선발이 불펜보다 약합니다. 오래 끌수록 점수를 줍니다.', `믿음인데 선발 평균 오버롤이 불펜보다 ${SIM.AI_STYLE_GAP} 이상 낮음 — 균형으로`, { t: 'fix' }, undefined, [styleMove('trust', -1)]), penStyle: 'balance' };
  return null;
}

/** 감독: 고칠 곳(칩)을 한 번에. 투수 코치: 연투한 팔을 뒤로 */
function fieldOffers(core: Core): Cand[] {
  const t = userTeam(core);
  const out: Cand[] = [];
  const iss = orderIssues(t);
  const n = todayIssues(t) - (tiredFront(t) ? 1 : 0);
  if (n > 0) {
    const c = structuredClone(t);
    applyFixes(c);
    const a = teamParts(t);
    const b = teamParts(c);
    const kinds = [iss.lineup ? '▲벤치/⇄원래 자리로' : '', iss.pitchers ? '▲불펜' : ''].filter(Boolean).join('/') || '부상자 교체';
    // 전력이 그대로이거나(경기 전에 저절로 메워지는 부상자 자리뿐) 환산 승률이 오르지 않는 수리는 제안으로 내지 않는다
    // 효과 문턱: 남은 경기로 환산한 승수가 +1.5 이상일 때만
    if (winDelta(a, b) * gamesLeft(core) >= MIN_FIX_WINS) out.push(
      offer(50 + n * 5, 'fix', 'fix', 'manager', '오더에 손볼 데가 있습니다. 제 눈에도 보입니다.', `${kinds} ${n}곳 적용: ${partsText(a, b, 3) || '전력 유지(부상자 교체)'}`, { t: 'fix' }, flagPiece(core, { win: winDelta(a, b) }), movesOf(t, c)),
    );
  }
  const tf = tiredFront(t);
  if (tf?.fresh && (tf.tired.tired ?? 0) >= REST_MIN_TIRED) {
    const d = (tf.tired.tired ?? 0) >= 2 ? 9 : 4;
    out.push(
      offer(
        42,
        'rest',
        'rest',
        'pitching',
        `${tf.tired.name}은 어제도 그제도 던졌습니다. 오늘은 뒤로 돌리시지요.`,
        `휴식: ${tf.tired.name} 연투 ${tf.tired.tired}일(구위 −${d}) ↔ ${tf.fresh.name} ${tf.fresh.ovr} 보직 교대`,
        { t: 'rest', pid: tf.tired.id, withPid: tf.fresh.id },
        undefined,
        [{ t: tf.tired.id, d: -1 }, { t: tf.fresh.id, d: 1 }],
      ),
    );
  }
  return out;
}

export const CALLUP_MIN_OVR = 2; // 콜업 제안: 그 자리 1군 주전보다 OVR 이 이만큼 높을 때만
export const SENDDOWN_MIN_ROOM = 6; // 내려보내기 제안: 잠재력까지 여지가 이만큼 남은 25세 이하 벤치만
const pctText = (v: number) => `${Math.round(v * 100)}%`;

/** 2군 이동을 복제본에 적용: 내려보내기 → 콜업 */
function farmMove(core0: Core, up?: string, down?: string): { core: Core; error?: string } {
  let core = core0;
  if (down) {
    const r = sendDown(core, down);
    if (r.error) return { core: core0, error: r.error };
    core = r.core;
  }
  if (up) {
    const r = callUp(core, up);
    if (r.error) return { core: core0, error: r.error };
    core = r.core;
  }
  return { core };
}

/** 1군이 가득일 때 대신 내릴 선수: 같은 종류의 가장 약한 벤치(타자) · 추격조(투수). 부상자는 못 내린다 */
function downFor(t: Team, up: Player): Player | null {
  const used = new Set([...t.lineup.map((l) => l.pid), ...t.rotation, ...(t.closer ? [t.closer] : []), ...t.bullpen.slice(0, 3)]);
  return activeRoster(t).filter((p) => p.kind === up.kind && !used.has(p.id) && p.injury === 0).sort((a, b) => a.ovr - b.ovr || b.age - a.age)[0] ?? null;
}

/** 2군 코치: 콜업 · 2군 졸업 · 벤치에서 썩는 유망주 내려보내기 */
function farmMoveOffer(core: Core, phase: 'up' | 'down'): Cand | null {
  const t = userTeam(core);
  const byId = new Map(t.roster.map((p) => [p.id, p]));
  const full = activeRoster(t).length >= ROSTER_MAX;
  const a = teamParts(t);
  if (phase === 'up') {
    const ready = farmRoster(t).filter((p) => p.injury === 0 && farmLockLeft(core, p) === 0).sort((x, y) => y.ovr - x.ovr);
    for (const k of ready) {
      // 그 자리의 1군 주전: 타자는 제 포지션, 선발은 로테이션 최약, 불펜·마무리는 필승조 최약
      const curId = k.kind === 'B' ? t.lineup.find((l) => l.pos === k.pos)?.pid : (k.pos === 'SP' ? t.rotation : [...t.bullpen.slice(0, 3), ...(t.closer ? [t.closer] : [])]).slice().sort((x, y) => (byId.get(x)?.ovr ?? 0) - (byId.get(y)?.ovr ?? 0))[0];
      const cur = curId ? byId.get(curId) : undefined;
      const better = !!cur && k.ovr >= cur.ovr + CALLUP_MIN_OVR;
      const grad = k.ovr >= FARM_CAP && k.ovr < k.pot;
      if (!better && !grad) continue;
      const down = full ? downFor(t, k) : null;
      if (full && !down) continue;
      const r = farmMove(core, k.id, down?.id);
      if (r.error) continue;
      const b = teamParts(userTeam(r.core));
      const dw = winDelta(a, b);
      if (better && dw <= 0 && !grad) continue;
      const stat = farmStatText(k);
      const who = `${k.name}(${stat ? `퓨처스 ${stat}, ` : ''}오버롤 ${k.ovr})`;
      const swap = down ? ` ↔ ${down.name} 내려보내기` : '';
      const parts = partsText(a, b) || '전력 변화 없음';
      const moves: BriefMove[] = [{ t: k.id, d: 1 }, ...(down ? [{ t: down.id, d: -1 as const }] : []), ...(better && cur && cur.id !== down?.id ? [{ t: cur.id, d: -1 as const }] : [])];
      return {
        ...offer(
          better ? 30 : 27,
          `callup:${k.id}`,
          'farm',
          'farm',
          better ? `${k.name}, 2군에서 준비가 끝났습니다. 지금 1군 자리보다 낫습니다.` : `${k.name}은 2군에서 배울 건 다 배웠습니다. 이제 위에서 부딪혀야 큽니다.`,
          better ? `콜업 ${who}${swap}: ${POS_NAME[k.pos] ?? k.pos} ${cur!.ovr} → ${k.ovr} · ${parts}` : `콜업 ${who}${swap}: 2군 상한 오버롤 ${FARM_CAP} 도달 · 1군에서만 더 자랍니다(잠재 ${k.pot}) · ${parts}`,
          { t: 'fix' },
          flagPiece(core, { win: dw }),
          moves,
        ),
        farm: { up: k.id, ...(down ? { down: down.id } : {}) },
      };
    }
    return null;
  }
  // 1군 벤치에서 썩는 25세 이하 → 2군에서 실전 경험
  if (farmRoster(t).length >= farmMax(core)) return null;
  const inPlay = new Set([...t.lineup.map((l) => l.pid), ...t.rotation, ...(t.closer ? [t.closer] : []), ...t.bullpen.slice(0, 3)]);
  const nb = activeRoster(t).filter((p) => p.kind === 'B').length;
  const np = activeRoster(t).length - nb;
  const rot = activeRoster(t)
    .filter((p) => !inPlay.has(p.id) && p.injury === 0 && p.age <= PLAY_GROW_AGE && p.pot - p.ovr >= SENDDOWN_MIN_ROOM && p.ovr < FARM_CAP - 1 && (p.kind === 'B' ? nb > MIN_BATTERS + 1 : np > MIN_PITCHERS + 1))
    .sort((x, y) => y.pot - y.ovr - (x.pot - x.ovr));
  for (const k of rot) {
    const r = farmMove(core, undefined, k.id);
    if (r.error) continue;
    const b = teamParts(userTeam(r.core));
    const dw = winDelta(a, b);
    if (dw * gamesLeft(core) < -0.5) continue;
    const now = growChance(core, t, k);
    const then = growChance(r.core, userTeam(r.core), userTeam(r.core).roster.find((x) => x.id === k.id)!);
    return {
      ...offer(
        22,
        `senddown:${k.id}`,
        'farm',
        'farm',
        `${k.name}, ${k.age}세입니다. 벤치에 앉혀 두면 썩습니다. 내려보내 실전을 뛰게 합시다.`,
        `2군으로 ${k.name}(오버롤 ${k.ovr} · 잠재 ${k.pot}): 주당 성장 확률 ${pctText(now)} → ${pctText(then)} · ${partsText(a, b) || '전력 변화 없음'} · ${FARM_LOCK}경기 동안 재등록 불가`,
        { t: 'fix' },
        undefined,
        [{ t: k.id, d: -1 }],
      ),
      farm: { down: k.id },
    };
  }
  return null;
}

/** 2군 코치: 콜업 → 훈련장 → 유망주 기용 → 내려보내기 */
function farmOffer(core: Core): Cand | null {
  // 자동 운영 중에는 콜업·내려보내기를 묻지 않는다 (2군 코치가 알아서 하고, 주전이 바뀌는 콜업은 사건 B1 이 묻는다)
  if (farmAutoOn(core)) return coachOffer(core);
  return farmMoveOffer(core, 'up') ?? coachOffer(core) ?? farmMoveOffer(core, 'down');
}

function coachOffer(core: Core): Cand | null {
  const t = userTeam(core);
  const lv = core.facilities.training;
  const cost = upgradeCost('training', core.facilities);
  const growable = t.roster.filter((p) => p.age <= TRAIN_MAX_AGE && p.ovr < p.pot).length;
  if (cost !== null && core.finance.cash >= cost + CASH_KEEP && growable >= 4) {
    const a = TRAIN_LV[lv];
    const b = TRAIN_LV[lv + 1];
    return offer(
      28,
      'training',
      'farm',
      'farm',
      '아이들이 칠 곳이 없습니다. 지금 지어야 내년에 씁니다.',
      `훈련장 ${fmtMoney(cost)}: 주간 성장 ${Math.round(a.grow * 100)}% → ${Math.round(b.grow * 100)}% · 자랄 선수 ${growable}명 · 부상 −${Math.round((1 - b.inj) * 100)}% · 유지비 +${fmtMoney(b.upkeep - a.upkeep)}/경기${cashTail(core, upgradeFacility(core, 'training').core)}`,
      { t: 'upgrade', kind: 'training' },
    );
  }
  // 유망주: 25세 이하 · 잠재력이 지금 주전의 OVR 보다 높은 벤치 타자를 제 포지션(또는 지명타자) 주전으로
  const byId = new Map(t.roster.map((p) => [p.id, p]));
  const inLineup = new Set(t.lineup.map((l) => l.pid));
  const kids = t.roster.filter((p) => p.kind === 'B' && !p.farm && !inLineup.has(p.id) && p.injury === 0 && p.age <= PLAY_GROW_AGE && p.pot - p.ovr >= 6).sort((a, b) => b.pot - a.pot);
  for (const k of kids) {
    const slot = t.lineup.findIndex((l) => l.pos === (k.pos as BatPos));
    const cur = slot >= 0 ? byId.get(t.lineup[slot].pid) : undefined;
    if (!cur || k.pot - cur.ovr < PROMOTE_MIN_POT || cur.ovr - k.ovr > 12) continue;
    const c: Team = { ...t, lineup: t.lineup.map((l, i) => (i === slot ? { ...l, pid: k.id } : l)) };
    const a = teamParts(t);
    const b = teamParts(c);
    if (winDelta(a, b) * gamesLeft(core) < -PROMOTE_MAX_LOSS) continue;
    const g = TRAIN_LV[lv].grow;
    return offer(
      24,
      `promote:${k.id}`,
      'farm',
      'farm',
      `${k.name}, ${k.age}세입니다. 지금 쓰면 흔들리겠지만 안 쓰면 썩습니다.`,
      `유망주 기용: ${POS_NAME[k.pos] ?? k.pos} ${cur.ovr} → ${k.ovr}(잠재 ${k.pot}) · ${partsText(a, b) || '전력 변화 없음'} · 주간 성장 확률 ${Math.round(g * BENCH_GROW * 100)}% → ${Math.round(g * PLAY_GROW * 100)}%`,
      { t: 'promote', pid: k.id, slot },
      flagPiece(core, { win: winDelta(a, b) }),
      [{ t: k.id, d: 1 }, { t: cur.id, d: -1 }],
    );
  }
  return null;
}

/** 조합장: 현금이 넉넉한데 부채가 있으면 상환 */
function chairOffer(core: Core): Cand | null {
  const f = core.finance;
  if (f.debt <= 0) return null;
  // 금고가 곧 빈다는 경고가 떠 있으면 갚자고 하지 않는다 (같은 브리핑에 "빌리자"와 "갚자"가 함께 뜨던 문제)
  if (cashAlert(core)) return null;
  const amt = Math.min(LOAN_STEP, f.debt);
  if (f.cash < amt + CASH_KEEP) return null;
  const perSeason = Math.round(loanInterest(core, f.debt) - loanInterest(core, f.debt - amt));
  return offer(20, 'repay', 'repay', 'chair', '빚이 있으면 조합원들이 잠을 못 잡니다. 여유가 있을 때 갚읍시다.', `${fmtMoney(amt)} 상환: 이자 시즌당 −${fmtMoney(perSeason)} · 남는 현금 ${fmtMoney(f.cash - amt)}`, { t: 'repay' });
}

// ───────── 자금 경고 (조합장) ─────────

/** 지금 급한 쪽: 금고가 이미 비었으면(또는 다음 경기에 비면) 한도 초과까지, 아니면 바닥까지 */
function cashMetric(core: Core, r: Runway): { n: number | null; label: string; sale: boolean } {
  const sale = r.forcedSale !== null && (core.finance.cash <= 0 || (r.cashOut !== null && r.cashOut <= 1));
  return sale ? { n: r.forcedSale, label: '한도 초과까지', sale } : { n: r.cashOut, label: '바닥까지', sale };
}

const MOOD_WARN_DAY = 54; // 빚더미 경고: 84경기 기준 이 경기째부터 (시즌 후반 — 남은 경기 안에 갚을 수 있을 때)
const MOOD_WARN_KEY = 'moodWarn';
/** 조합장의 빚더미 경고 (10구단 리그): 시즌 후반에 부채가 문턱을 넘은 채일 때 시즌에 한 번 */
export function moodAlert(core: Core): string | null {
  if (core.phase !== 'season' || core.day < dayAt(core, MOOD_WARN_DAY) || memoNum(core, MOOD_WARN_KEY) > 0) return null;
  const m = debtMoodText(core);
  if (!m) return null;
  const left = core.schedule.length - core.day;
  const pct = Math.round((core.finance.debt / loanLimit(core)) * 100);
  return m.cut > 0
    ? `빚이 한도의 ${pct}%입니다. 남은 ${left}경기를 이대로 마치면 도민 지지가 ${m.cut} 깎입니다. 조합원들 볼 낯이 없습니다.`
    : `빚이 한도의 ${pct}%입니다. 남은 ${left}경기를 이대로 마치면 조합에서 말이 나옵니다. 내년에도 이러면 도민 지지가 깎입니다.`;
}

/** 조합장의 한 줄: 12경기 안에 금고가 비거나 부채가 한도를 넘을 때, 또는 부채가 한도의 절반을 넘었을 때 (한 줄로 통합) */
export function cashAlert(core: Core): string | null {
  const r = runway(core);
  const lim = loanLimit(core);
  const debt = core.finance.debt;
  if (debt > lim) return `빚이 한도를 넘었습니다. 부채 ${fmtMoney(debt)} / 한도 ${fmtMoney(lim)} — 누군가를 보내야 합니다.`;
  if (core.finance.cash <= 0 && r.cashOut !== null && (r.forcedSale === null || r.forcedSale > RUNWAY_DANGER)) return '금고가 비었습니다. 경기마다 빚이 쌓이고 있습니다.';
  if (r.forcedSale !== null && r.forcedSale <= RUNWAY_DANGER) {
    return r.cashOut !== null && r.cashOut > 1 && r.cashOut < r.forcedSale
      ? `이대로면 ${r.cashOut}경기 뒤에 금고가 빕니다. ${r.forcedSale}경기 뒤엔 선수를 내줘야 합니다.`
      : `이대로면 ${r.forcedSale}경기 뒤에 빚이 한도를 넘습니다. 선수를 내줘야 합니다.`;
  }
  if (r.cashOut !== null && r.cashOut <= RUNWAY_DANGER) return `이대로면 ${r.cashOut}경기 뒤에 금고가 빕니다. 조합원들 볼 낯이 없습니다.`;
  const mood = moodAlert(core);
  if (mood) return mood;
  if (debt >= lim * LOAN_WARN) return `빚이 한도의 ${Math.round((debt / lim) * 100)}%입니다. 부채 ${fmtMoney(debt)} / 한도 ${fmtMoney(lim)} — 이자가 시즌당 ${fmtMoney(Math.round(loanInterest(core, debt)))}입니다.`;
  return null;
}

/** 가장 효과 큰 대응 1장: 고연봉 저효율 선수 방출 / 티켓값 조정 / 대출 중 금고를 가장 오래 버티게 하는 것 */
function rescueOffer(core: Core, m: BriefMemo): Cand | null {
  const now = runway(core);
  const m0 = cashMetric(core, now);
  if (m0.n === null) return null;
  const t = userTeam(core);
  const val = (r: Runway) => (m0.sale ? r.forcedSale : r.cashOut) ?? 999;
  const tail = (r: Runway) => `${m0.label} ${m0.n} → ${val(r) >= 999 ? '시즌 끝까지 안전' : `${val(r)}경기`}`;
  const before = teamParts(t);
  let best: { gain: number; c: Cand } | null = null;
  const take = (gain: number, c: Cand) => {
    // 자금 대응도 번복은 하지 않는다 (방금 데려온 선수를 내보내라거나, 올린 표값을 내리라거나)
    if (gain > 0 && (!best || gain > best.gain) && !reverses(m, core.day, c.moves)) best = { gain, c };
  };
  // 방출: 연봉이 크고 OVR 대비 비싼 순으로 4명만 따져 본다 (프랜차이즈 스타는 건드리지 않는다)
  const pricey = t.roster
    .filter((p) => p.salary >= 8000 && !isFranchise(p, core.season))
    .sort((a, b) => b.salary / Math.max(5, b.ovr - 45) - a.salary / Math.max(5, a.ovr - 45))
    .slice(0, 4);
  for (const p of pricey) {
    const r = releasePlayer(core, p.id);
    if (r.error) continue;
    const after = teamParts(userTeam(r.core));
    const rw = runway(r.core);
    const dw = winDelta(before, after);
    const moved = PART_NAME.map(([k, label]) => ({ label, d: after[k] - before[k] })).filter((x) => x.d !== 0).sort((a, b) => Math.abs(b.d) - Math.abs(a.d))[0];
    const cost = core.finance.cash - r.core.finance.cash;
    take(
      val(rw) - m0.n + dw * 100,
      {
        ...offer(200, `rescue:release:${p.id}`, 'rescue', 'chair', `${p.name}의 연봉이 살림에 비해 큽니다. 미안하지만 보내야겠습니다.`, `방출 ${p.name}: 연봉 −${fmtMoney(p.salary)} · ${moved ? `${moved.label} ${sign(moved.d)}` : '전력 변화 없음'}${cost ? ` · 잔여 연봉 지급 ${fmtMoney(cost)}` : ''} · ${tail(rw)}`, { t: 'fix' }, flagPiece(core, { win: dw }), [{ t: p.id, d: -1 }]),
        rescue: { t: 'release', pid: p.id },
      },
    );
  }
  // 티켓값: 홈경기당 수입이 늘어나는 쪽으로 0.2 만
  const income = (c: Core) => Math.min(capacityOf(c), previewDemand(c)) * (c.finance.ticketPrice + FOOD_LV[c.facilities.food].spend);
  const share = homeLeft(core) / Math.max(1, gamesLeft(core));
  for (const d of [0.2, -0.2]) {
    const next = setTicketPrice(core, core.finance.ticketPrice + d);
    if (next === core) continue;
    const inc = Math.round(income(next) - income(core));
    if (inc <= 0) continue;
    const rw = runwayAfter(core, { perGame: inc * share });
    take(
      val(rw) - m0.n,
      offer(200, `rescue:price:${d > 0 ? 'up' : 'down'}`, 'rescue', 'chair', d > 0 ? '표값을 조금 올립시다. 오실 분들은 오십니다.' : '표값을 내려 자리를 채웁시다. 빈자리는 돈이 안 됩니다.', `티켓값 ${core.finance.ticketPrice.toFixed(1)} → ${next.finance.ticketPrice.toFixed(1)}만: 홈경기당 수입 ${signMoney(inc)} · ${tail(rw)}`, { t: 'price', value: next.finance.ticketPrice }, undefined, [{ t: 'price', d: d > 0 ? 1 : -1 }]),
    );
  }
  // 대출: 시간을 벌 뿐이다 — 방출·티켓값으로 버틸 길이 하나도 없을 때만 내미는 마지막 카드
  const b = borrow(core);
  if (!b.error && !m0.sale && !best) {
    const rw = runway(b.core);
    take(
      (val(rw) - m0.n) / 2,
      { ...offer(200, 'rescue:borrow', 'rescue', 'chair', '급한 불부터 끕시다. 다만 빚은 빚입니다.', `대출 +${fmtMoney(LOAN_STEP)}: 이자 시즌당 +${fmtMoney(Math.round(loanInterest(core, core.finance.debt + LOAN_STEP) - loanInterest(core, core.finance.debt)))} · ${tail(rw)}`, { t: 'fix' }), rescue: { t: 'borrow' } },
    );
  }
  return (best as { gain: number; c: Cand } | null)?.c ?? null;
}

const STAGE_WHO: CharId[][] = [['manager', 'scout'], ['marketing'], ['farm'], ['pitching'], [], []];

// ───────── 지난주 실행한 제안의 결과 ─────────

function resultLine(core: Core, d: BriefDone): string | null {
  const t = userTeam(core);
  const n = d.n ?? [];
  const p = d.pid ? t.roster.find((x) => x.id === d.pid) : undefined;
  const parts = teamParts(t);
  const wl = (memoGet(core, 'wl') ?? '').slice(d.day);
  const rec = `${wl.split('W').length - 1}승 ${wl.split('L').length - 1}패`;
  const home = core.attHistory.slice(n[0] ?? core.attHistory.length);
  switch (d.kind) {
    case 'sign': {
      if (!p) return null;
      const key = p.kind === 'B' ? 'bat' : p.pos === 'SP' ? 'rot' : 'pen';
      const label = PART_NAME.find(([k]) => k === key)![1];
      const stat = p.kind === 'B' ? `${p.bat.g - n[1]}경기 ${fmtAvg(p.bat.h - n[2], p.bat.ab - n[3])} ${p.bat.hr - n[4]}홈런` : `${p.pit.g - n[1]}경기 평균자책점 ${fmtEra(p.pit.er - n[2], p.pit.outs - n[3])}`;
      return `지난주 ${d.label}: ${stat} · ${label} ${n[0]} → ${parts[key]}`;
    }
    case 'price':
    case 'seats': {
      if (!home.length) return `지난주 ${d.label}: 아직 홈경기가 없었습니다`;
      const att = avg(home);
      if (d.kind === 'seats') return `지난주 ${d.label}: 홈 ${home.length}경기 평균 관중 ${fmtInt(n[1])} → ${fmtInt(att)}명`;
      const inc = Math.round(att * (n[3] / 10) - n[1] * (n[2] / 10));
      return `지난주 ${d.label}: 홈 ${home.length}경기 경기당 입장 수입 ${signMoney(inc)} · 관중 ${sign(att - n[1], '명')}`;
    }
    case 'penStyle':
      return `지난주 ${d.label}: 이후 ${rec} · 불펜 ${bullpenLoad(userTeam(core)).label}`;
    case 'fix':
      return `지난주 ${d.label}: 이후 ${rec} · ${PART_NAME.map(([k, l], i) => ({ l, a: n[i], b: parts[k] })).filter((x) => x.a !== x.b).slice(0, 2).map((x) => `${x.l} ${x.a} → ${x.b}`).join(' · ') || `타선 ${parts.bat} 그대로`}`;
    case 'rest':
      return p ? `지난주 ${d.label}: ${p.name} ${(p.tired ?? 0) > 0 ? `연투 ${p.tired}일` : '피로 회복'} · 이후 ${rec}` : null;
    case 'training':
      return `지난주 ${d.label}: 이번 주 훈련 성과 ${Math.max(0, memoNum(core, 'grow') - n[0])}회`;
    case 'callup':
      if (!p) return null;
      return `지난주 ${d.label}: ${p.farm ? '다시 2군' : p.kind === 'B' ? `1군 ${p.bat.g - n[1]}경기 ${fmtAvg(p.bat.h - n[2], p.bat.ab - n[3])}` : `1군 ${p.pit.g - n[1]}경기 평균자책점 ${fmtEra(p.pit.er - n[2], p.pit.outs - n[3])}`} · 오버롤 ${n[0]} → ${p.ovr}`;
    case 'senddown':
      return p ? `지난주 ${d.label}: ${p.farm ? `퓨처스 ${farmStatText(p) || '기록 없음'}` : '1군 복귀'} · 오버롤 ${n[0]} → ${p.ovr}` : null;
    case 'promote':
      return p ? `지난주 ${d.label}: ${p.bat.g - n[1]}경기 ${fmtAvg(p.bat.h - n[2], p.bat.ab - n[3])} · 오버롤 ${n[0]} → ${p.ovr}` : null;
    case 'rescue': {
      const r = runway(core);
      return `지난주 ${d.label}: 경기당 손익 ${signMoney(r.perGame)} · ${r.cashOut === null ? '이번 시즌 금고는 버팁니다' : `바닥까지 ${r.cashOut}경기`}`;
    }
    case 'repay':
      return `지난주 ${d.label}: 남은 부채 ${fmtMoney(core.finance.debt)} · 이자 경기당 ${fmtMoney(Math.round(loanInterest(core, core.finance.debt) / Math.max(1, core.schedule.length)))}`;
  }
  return null;
}

// ───────── 제안 상세 (탭하면 뜨는 시트의 재료) ─────────

const partsArr = (p: TeamParts) => PART_NAME.map(([k]) => p[k]);
export const PART_LABELS = PART_NAME.map(([, l]) => l);

/** 선수 id → 지금 맡은 자리 이름 */
function seats(t: Team): Map<string, string> {
  const m = new Map<string, string>();
  for (const p of t.roster) m.set(p.id, p.kind === 'B' ? '벤치' : '대기 투수');
  t.bullpen.forEach((id, i) => m.set(id, i < 3 ? `필승조 ${i + 1}` : '불펜'));
  t.rotation.forEach((id, i) => m.set(id, `선발 ${i + 1}`));
  if (t.closer) m.set(t.closer, '마무리');
  t.lineup.forEach((l, i) => m.set(l.pid, `${i + 1}번 ${POS_NAME[l.pos] ?? l.pos}`));
  for (const p of t.roster) if (p.farm) m.set(p.id, '2군');
  return m;
}

/** 실행 전후의 두 상태를 비교해 상세 시트의 표를 만든다: 자리 이동 · 전력 4칸 · 가격/관중/수입 · 현금/연봉/부채 · 자금 예측 */
function detailOf(a: Core, b: Core, o: BriefOffer): BriefDetail {
  const ta = userTeam(a);
  const tb = userTeam(b);
  const sa = seats(ta);
  const sb = seats(tb);
  const names = new Map([...a.freeAgents, ...ta.roster, ...tb.roster].map((p) => [p.id, p.name]));
  const shifts = [...new Set([...sa.keys(), ...sb.keys()])]
    .map((id) => ({ name: names.get(id) ?? id, from: sa.get(id) ?? 'FA', to: sb.get(id) ?? '방출' }))
    .filter((x) => x.from !== x.to)
    .sort((x, y) => Number(/벤치|불펜|대기|FA/.test(x.to)) - Number(/벤치|불펜|대기|FA/.test(y.to)))
    .slice(0, 8);
  const pa = partsArr(teamParts(ta));
  const pb = partsArr(teamParts(tb));
  type Row = NonNullable<BriefDetail['rows']>[number];
  const rows: Row[] = [];
  const num = (label: string, x: number, y: number, fmt: (v: number) => string, better: 1 | -1 | 0 = 1) => {
    rows.push({ label, a: fmt(x), b: fmt(y), ...(better && x !== y ? { tone: (y - x) * better > 0 ? ('good' as const) : ('bad' as const) } : {}) });
  };
  const money = (v: number) => (v < 0 ? `−${fmtMoney(-v)}` : fmtMoney(v));
  const gate = (c: Core) => {
    const demand = previewDemand(c);
    const att = Math.min(capacityOf(c), demand);
    return { demand, att, ticket: Math.round(att * c.finance.ticketPrice), food: Math.round(att * FOOD_LV[c.facilities.food].spend) };
  };
  const ga = gate(a);
  const gb = gate(b);
  const priced = a.finance.ticketPrice !== b.finance.ticketPrice;
  const gated = priced || a.facilities.seats !== b.facilities.seats || a.facilities.food !== b.facilities.food;
  if (o.action.t === 'sign' && !o.rescue) {
    const p = a.freeAgents.find((x) => x.id === (o.action as { pid: string }).pid);
    if (p) rows.push({ label: faHeatWhy(a) ? `계약금 (${faHeatWhy(a)})` : '계약금', a: '—', b: `−${fmtMoney(signingBonusFor(a, p))}`, tone: 'bad' }, { label: '이 선수 연봉/시즌', a: '—', b: fmtMoney(p.salary) });
  }
  if (priced) num('티켓값', a.finance.ticketPrice, b.finance.ticketPrice, (v) => `${v.toFixed(1)}만`, 0);
  if (a.facilities.seats !== b.facilities.seats) num('좌석', capacityOf(a), capacityOf(b), (v) => `${fmtInt(v)}석`);
  if (gated) {
    num('예상 수요', ga.demand, gb.demand, (v) => `${fmtInt(v)}명`);
    num('예상 관중', ga.att, gb.att, (v) => `${fmtInt(v)}명`);
    num('홈경기당 입장 수입', ga.ticket, gb.ticket, money);
    num('홈경기당 매점 수입', ga.food, gb.food, money);
  }
  if (a.facilities.training !== b.facilities.training) {
    num('주간 성장 확률', TRAIN_LV[a.facilities.training].grow, TRAIN_LV[b.facilities.training].grow, (v) => `${Math.round(v * 100)}%`);
    num('부상 위험', TRAIN_LV[a.facilities.training].inj, TRAIN_LV[b.facilities.training].inj, (v) => `${Math.round(v * 100)}%`, -1);
  }
  if (o.action.t === 'promote' && !o.rescue) {
    const g = TRAIN_LV[a.facilities.training].grow;
    rows.push({ label: '이 선수 주간 성장 확률', a: `${Math.round(g * 100)}%`, b: `${Math.round(g * PLAY_GROW * 100)}%`, tone: 'good' });
  }
  if (a.finance.cash !== b.finance.cash) num('현금', a.finance.cash, b.finance.cash, money);
  if (payroll(ta) !== payroll(tb)) num('연봉 총액/시즌', payroll(ta), payroll(tb), money, -1);
  if (a.finance.debt !== b.finance.debt) {
    num('부채', a.finance.debt, b.finance.debt, money, -1);
    num('이자/시즌', Math.round(loanInterest(a, a.finance.debt)), Math.round(loanInterest(b, b.finance.debt)), money, -1);
  }
  // 자금 예측: runway 는 최근 관중 실적으로 보므로, 관중이 달라지는 조작은 예상 수입 차이를 얹는다
  const ra = runway(a);
  const share = homeLeft(a) / Math.max(1, gamesLeft(a));
  const inc = gated ? (gb.ticket + gb.food - ga.ticket - ga.food) * share : 0;
  const rb = priced ? runwayAfter(a, { perGame: inc, cash: b.finance.cash - a.finance.cash }) : gated ? runwayAfter(b, { perGame: inc }) : runway(b);
  if (ra.perGame !== rb.perGame || rows.length) {
    num('경기당 손익', ra.perGame, rb.perGame, (v) => signMoney(v));
    num('시즌 말 예상 현금', ra.seasonEnd, rb.seasonEnd, money);
    if (ra.cashOut !== null || rb.cashOut !== null) rows.push({ label: '금고 바닥까지', a: ra.cashOut === null ? '안전' : `${ra.cashOut}경기`, b: rb.cashOut === null ? '안전' : `${rb.cashOut}경기`, ...(ra.cashOut !== rb.cashOut ? { tone: (rb.cashOut ?? 999) > (ra.cashOut ?? 999) ? ('good' as const) : ('bad' as const) } : {}) });
  }
  const d: BriefDetail = { parts: { a: pa, b: pb } };
  if (rows.length) d.rows = rows;
  if (shifts.length) d.shifts = shifts;
  if (o.rescue?.t === 'release') d.pid = o.rescue.pid;
  else if (o.action.t === 'sign' && !o.rescue) {
    d.pid = o.action.pid;
    const out = shifts.find((x) => /벤치|불펜|대기/.test(x.to) && !/벤치|불펜|대기|FA/.test(x.from));
    const vs = out && ta.roster.find((p) => p.name === out.name && sa.get(p.id) === out.from);
    if (vs) d.vsPid = vs.id;
  } else if (o.action.t === 'promote') {
    d.pid = o.action.pid;
    d.vsPid = ta.lineup[o.action.slot]?.pid;
  }
  return d;
}

// ───────── 브리핑 ─────────

const snapOf = (core: Core) => ({ day: core.day, rank: rankOf(core.teams, core.userId), profit: opProfit(core.finance.ledger), attN: core.attHistory.length });

/** 지금 상태의 주간 브리핑 (순수). 문턱을 넘은 제안만, 예상 효과가 큰 순 + 그 장의 인물 우선, 같은 종류는 한 장, 최대 2장 */
export function weeklyBriefing(core: Core): Briefing {
  const m = memoOf(core);
  const wl = (memoGet(core, 'wl') ?? '').slice(-BRIEF_EVERY);
  const cnt = (c: string) => wl.split(c).length - 1;
  const rank = rankOf(core.teams, core.userId);
  const snap = m.snap;
  const profit = opProfit(core.finance.ledger) - (snap?.profit ?? 0);
  const home = core.attHistory.slice(snap?.attN ?? 0);
  const ties = cnt('T');
  const summary = [
    `${cnt('W')}승 ${cnt('L')}패${ties ? ` ${ties}무` : ''}`,
    snap && snap.rank !== rank ? `${snap.rank}위 → ${rank}위` : `${rank}위`,
    `손익 ${signMoney(profit)}`,
    home.length ? `평균 관중 ${fmtInt(avg(home))}` : '홈경기 없음',
  ].join(' · ');

  const cands = [scoutOffer(core, m), marketingOffer(core), ...fieldOffers(core), penOffer(core), penStyleOffer(core), farmOffer(core), chairOffer(core)].filter((c): c is Cand => !!c);
  const themed = STAGE_WHO[Math.min(core.campaign.stage, STAGE_WHO.length - 1)] ?? [];
  const kinds = new Set<string>();
  const picked: Cand[] = [];
  const recent = (id: string, gap: number) => m.skipped[id] !== undefined && core.day - m.skipped[id] <= gap;
  // 금고가 12경기 안에 비면 조합장이 먼저 말하고, 가장 효과 큰 대응 한 장이 맨 위에 온다 (같은 종류 간격의 예외)
  const alert = cashAlert(core);
  const rescue = alert ? rescueOffer(core, m) : null;
  if (rescue && !recent(rescue.id, SKIP_QUIET)) {
    picked.push(rescue);
    kinds.add('rescue');
  }
  for (const c of cands.sort((a, b) => b.score + (themed.includes(b.who) ? 100 : 0) - (a.score + (themed.includes(a.who) ? 100 : 0)))) {
    if (picked.length >= BRIEF_MAX) break;
    if (kinds.has(c.kind) || core.day < (m.quiet?.[c.kind] ?? 0) || reverses(m, core.day, c.moves)) continue;
    // 같은 브리핑 안에서도 서로 반대인 제안은 내지 않는다
    if (picked.some((o) => o.moves?.some((x) => c.moves?.some((y) => y.t === x.t && y.d === -x.d)))) continue;
    kinds.add(c.kind);
    picked.push(c);
  }
  const offers: BriefOffer[] = picked.map(({ score: _score, ...o }) => {
    const r = applyOffer(core, o);
    return r.error ? o : { ...o, detail: detailOf(core, r.core, o) };
  });
  const now = partsArr(teamParts(userTeam(core)));
  const resultInfo: BriefResult[] = [];
  for (const d of m.done) {
    const text = d.day < core.day ? resultLine(core, d) : null;
    if (text) resultInfo.push({ text, label: d.label, ...(d.expect ? { expect: d.expect } : {}), ...(d.parts && d.partsExp ? { parts: { a: d.parts, b: d.partsExp, now } } : {}) });
  }
  return { day: core.day, summary, results: resultInfo.map((r) => r.text), resultInfo, offers, ...(alert ? { alert } : {}) };
}

/** 브리핑을 열 차례인가: 정규시즌 6경기마다, 그날 이미 닫지 않았을 때 */
export function briefingDue(core: Core): boolean {
  if (core.phase !== 'season' || core.day <= 0 || core.day % BRIEF_EVERY !== 0 || core.day >= core.schedule.length || core.campaign.briefing) return false;
  const m = core.campaign.briefMemo;
  return !(m && m.season === core.season && m.snap?.day === core.day);
}

const offeredLog = (m: BriefMemo, day: number, b: Briefing) => withLog(m, day, b.offers.flatMap((o) => o.moves ?? []));

/**
 * 매 경기 후(이벤트 카드 뽑기 뒤): 차례면 브리핑을 campaign.briefing 에 둔다. 아니면 원본 반환.
 * 문턱을 넘은 제안도, 지난주 실행 결과도 없는 주는 띄우지 않고 지난주 수치만 적어 둔다(일괄 진행도 멈추지 않는다).
 */
export function drawBriefing(core0: Core): Core {
  if (!briefingDue(core0)) return core0;
  const core = structuredClone(core0);
  core.campaign.briefMemo = observe(core, memoOf(core));
  const b = weeklyBriefing(core);
  const m = memoOf(core);
  if (!b.offers.length && !b.results.length) {
    core.campaign.briefMemo = { ...m, done: m.done.filter((d) => d.day >= core.day), snap: snapOf(core) };
    return core;
  }
  // 빚더미 경고는 시즌에 한 번만 낸다 (다음 브리핑부터는 평소의 부채 한 줄)
  const moodShown = !!b.alert && b.alert === moodAlert(core);
  core.campaign.briefing = b;
  core.campaign.briefMemo = { ...m, shown: (m.shown ?? 0) + b.offers.length, log: offeredLog(m, core.day, b) };
  if (moodShown) memoSet(core, MOOD_WARN_KEY, core.day);
  return core;
}

/** 이벤트 카드를 처리한 뒤: 대기 중인 브리핑을 바뀐 상태로 다시 만든다 */
export function refreshBriefing(core0: Core): Core {
  if (!core0.campaign.briefing) return core0;
  const core = structuredClone(core0);
  const m = memoOf(core);
  const b = weeklyBriefing(core);
  core.campaign.briefMemo = { ...m, shown: (m.shown ?? 0) - core0.campaign.briefing.offers.length + b.offers.length, log: offeredLog(m, core.day, b) };
  core.campaign.briefing = b;
  return core;
}

/** 제안을 지금 상태에 적용한 결과 (순수). 실행과 상세 시트의 "후" 계산이 같은 길을 쓴다 */
function applyOffer(core0: Core, o: BriefOffer): { core: Core; error?: string; done?: BriefDone } {
  const t0 = userTeam(core0);
  const before = teamParts(t0);
  const a = o.action;
  const attN = core0.attHistory.length;
  const attBefore = avg(core0.attHistory.slice(-3));
  let core: Core;
  let done: BriefDone;
  const mk = (label: string, n: number[] = [], pid?: string): BriefDone => ({ id: o.id, kind: o.kind, day: core0.day, label, n, ...(pid ? { pid } : {}) });
  if (o.rescue) {
    const p = o.rescue.t === 'release' ? t0.roster.find((x) => x.id === (o.rescue as { pid: string }).pid) : undefined;
    const r = o.rescue.t === 'release' ? releasePlayer(core0, o.rescue.pid) : borrow(core0);
    if (r.error) return { core: core0, error: r.error };
    core = r.core;
    done = { ...mk(p ? `방출 ${p.name}` : '대출'), kind: 'rescue' };
  } else if (o.penStyle && !o.farm) {
    core = { ...structuredClone(core0), campaign: { ...structuredClone(core0.campaign), penStyle: o.penStyle } };
    done = { ...mk(`불펜 방침 ${STYLE_KO[o.penStyle]}`), kind: 'penStyle' };
  } else if (o.farm) {
    const up = o.farm.up ? t0.roster.find((x) => x.id === o.farm!.up) : undefined;
    const down = o.farm.down ? t0.roster.find((x) => x.id === o.farm!.down) : undefined;
    const r = farmMove(core0, o.farm.up, o.farm.down);
    if (r.error) return { core: core0, error: r.error };
    core = r.core;
    const p = up ?? down!;
    done = { ...mk(up ? `콜업 ${up.name}` : `2군행 ${down!.name}`, p.kind === 'B' ? [p.ovr, p.bat.g, p.bat.h, p.bat.ab] : [p.ovr, p.pit.g, p.pit.er, p.pit.outs], p.id), kind: up ? 'callup' : 'senddown' };
  } else
  switch (a.t) {
    case 'sign': {
      const p = core0.freeAgents.find((x) => x.id === a.pid);
      const r = signPlayer(core0, a.pid);
      if (r.error || !p) return { core: core0, error: r.error ?? '영입 가능한 선수가 아닙니다' };
      core = r.core;
      const key = p.kind === 'B' ? 'bat' : p.pos === 'SP' ? 'rot' : 'pen';
      done = { ...mk(`영입 ${p.name}`, p.kind === 'B' ? [before[key], p.bat.g, p.bat.h, p.bat.ab, p.bat.hr] : [before[key], p.pit.g, p.pit.er, p.pit.outs], p.id), kind: 'sign' };
      break;
    }
    case 'price': {
      const from = core0.finance.ticketPrice;
      core = setTicketPrice(core0, a.value);
      if (core === core0) return { core: core0, error: '티켓값이 이미 그 값입니다' };
      core = structuredClone(core);
      done = { ...mk(`티켓값 ${a.value > from ? '인상' : '인하'}`, [attN, attBefore, Math.round(from * 10), Math.round(a.value * 10)]), kind: 'price' };
      break;
    }
    case 'upgrade': {
      const r = upgradeFacility(core0, a.kind);
      if (r.error) return { core: core0, error: r.error };
      core = r.core;
      done = a.kind === 'seats' ? { ...mk('관중석 증축', [attN, attBefore]), kind: 'seats' } : { ...mk('훈련장 공사', [memoNum(core0, 'grow')]), kind: 'training' };
      break;
    }
    case 'fix': {
      core = structuredClone(core0);
      applyFixes(userTeam(core));
      done = { ...mk('편성 수리', PART_NAME.map(([k]) => before[k])), kind: 'fix' };
      break;
    }
    case 'rest': {
      core = structuredClone(core0);
      const t = userTeam(core);
      const la = ploc(t, a.pid);
      const lb = ploc(t, a.withPid);
      if (!la || !lb) return { core: core0, error: '보직이 바뀌어 교대할 수 없습니다' };
      pput(t, la, a.withPid);
      pput(t, lb, a.pid);
      done = { ...mk('투수 휴식', [], a.pid), kind: 'rest' };
      break;
    }
    case 'promote': {
      core = structuredClone(core0);
      const t = userTeam(core);
      const p = t.roster.find((x) => x.id === a.pid);
      if (!p || !t.lineup[a.slot] || t.lineup.some((l) => l.pid === a.pid)) return { core: core0, error: '타순이 바뀌어 기용할 수 없습니다' };
      t.lineup[a.slot] = { ...t.lineup[a.slot], pid: a.pid };
      done = { ...mk(`유망주 ${p.name}`, [p.ovr, p.bat.g, p.bat.h, p.bat.ab], p.id), kind: 'promote' };
      break;
    }
    case 'repay': {
      const r = repay(core0);
      if (r.error) return { core: core0, error: r.error };
      core = r.core;
      done = { ...mk('대출 상환', []), kind: 'repay' };
      break;
    }
  }
  done = { ...done, expect: `${o.effect}${o.flag ? ` · ${o.flag}` : ''}`, parts: partsArr(before), partsExp: partsArr(teamParts(userTeam(core))) };
  return { core, done };
}

/** 제안 실행: 기존 액션을 그대로 부른다. 실행 기록은 다음 주 결과 줄의 재료가 된다 */
export function runOffer(core0: Core, id: string): { core: Core; error?: string; text?: string } {
  const b0 = core0.campaign.briefing;
  const o = b0?.offers.find((x) => x.id === id);
  if (!b0 || !o) return { core: core0, error: '실행할 제안이 없습니다' };
  if (o.state) return { core: core0, error: '이미 처리한 제안입니다' };
  const before = teamParts(userTeam(core0));
  const r = applyOffer(core0, o);
  if (r.error || !r.done) return { core: core0, error: r.error ?? '실행할 수 없습니다' };
  const { core, done } = r;
  const m = memoOf(core);
  core.campaign.briefMemo = { ...m, done: [...m.done, done], quiet: { ...m.quiet, [o.kind]: core.day + KIND_GAP_DONE } };
  const b = core.campaign.briefing!;
  core.campaign.briefing = { ...b, offers: b.offers.map((x) => (x.id === id ? { ...x, state: 'done' as const } : x)) };
  const after = teamParts(userTeam(core));
  const moved = partsText(before, after, 3);
  return { core, text: `${done.label} 완료${moved ? ` — ${moved}` : ''}` };
}

/** 제안 넘기기: 같은 종류의 제안은 4주 동안 다시 오지 않는다 */
export function skipOffer(core0: Core, id: string): Core {
  const b = core0.campaign.briefing;
  const o = b?.offers.find((x) => x.id === id);
  if (!b || !o || o.state) return core0;
  const core = structuredClone(core0);
  const m = memoOf(core);
  core.campaign.briefMemo = { ...m, skipped: { ...m.skipped, [id]: core.day }, quiet: { ...m.quiet, [o.kind]: core.day + KIND_GAP_SKIP } };
  core.campaign.briefing = { ...b, offers: b.offers.map((x) => (x.id === id ? { ...x, state: 'skipped' as const } : x)) };
  return core;
}

/** 브리핑 닫기: 답하지 않은 제안은 넘긴 것으로 치고, 지난주 수치를 적어 둔다 */
export function closeBriefing(core0: Core): Core {
  const b = core0.campaign.briefing;
  if (!b) return core0;
  const core = structuredClone(core0);
  const m = memoOf(core);
  const skipped = { ...m.skipped };
  const quiet = { ...m.quiet };
  for (const o of b.offers) {
    if (o.state) continue;
    skipped[o.id] = core.day;
    quiet[o.kind] = core.day + KIND_GAP_SKIP;
  }
  core.campaign.briefMemo = { ...m, skipped, quiet, done: m.done.filter((d) => d.day >= core.day), snap: snapOf(core) };
  core.campaign.briefing = null;
  return core;
}

export const briefWho = (o: BriefOffer) => CHARACTERS[o.who];
