// 주간 브리핑: 6경기마다 스태프가 "실행 가능한 제안"을 예상 숫자와 함께 들고 온다.
// 순수 함수만 — 난수를 쓰지 않는다(브리핑은 경기 로직의 수치를 바꾸지 않는다). 실행은 season.ts 의 기존 액션을 재사용한다.
import type { BatPos, BriefAction, BriefDone, BriefMemo, BriefOffer, Briefing, CharId, Core, Player, Team } from './types';
import { teamParts, type TeamParts } from './ratings';
import { FOOD_LV, LOAN_RATE, LOAN_STEP, ROSTER_MAX, SEAT_LV, TRAIN_LV, capacityOf, opProfit, previewDemand, signingBonus, upgradeCost, userTeam } from './economy';
import { FOREIGN_MAX } from './events';
import { PLAY_GROW, PLAY_GROW_AGE, TRAIN_MAX_AGE, borrow, rankOf, releasePlayer, repay, setTicketPrice, signPlayer, upgradeFacility } from './season';
import { RUNWAY_DANGER, runway, runwayAfter, runwayPieceOf, type Runway } from './runway';
import { isFranchise } from './franchise';
import { applyFixes, orderIssues, ploc, pput, tiredFront, todayIssues } from './fixes';
import { stageOf } from './campaign';
import { memoGet, memoNum } from './memo';
import { fmtAvg, fmtEra, fmtInt, fmtMoney } from './format';
import { CHARACTERS } from './story';

export const BRIEF_EVERY = 6; // 경기
export const BRIEF_MAX = 3; // 한 번에 내는 제안 수
export const SKIP_QUIET = 12; // 넘긴 제안은 이 경기 수(2주) 동안 다시 내지 않는다
const SIGN_RUNWAY_MIN = 20; // 영입 제안: 실행 뒤 금고가 이 경기 수 안에 비면 내지 않는다
const EARLY_DAYS = 12; // 시즌 첫 2주
const EARLY_SALARY = 30000; // 첫 2주의 영입 제안은 연봉 3억 이하만
const CASH_KEEP = 30000; // 시설·상환 제안은 실행 후에도 현금이 이만큼 남을 때만 (3억)

const POS_NAME: Record<string, string> = { C: '포수', '1B': '1루', '2B': '2루', '3B': '3루', SS: '유격', LF: '좌익', CF: '중견', RF: '우익', DH: '지명', SP: '선발', RP: '불펜', CP: '마무리' };
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
const offer = (score: number, id: string, kind: string, who: CharId, line: string, effect: string, action: BriefAction, flag?: string): Cand => ({ score, id, kind, who, line, effect, action, ...(flag ? { flag } : {}) });

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** 스카우트 팀장: 최약 자리에 FA 1명. 절반은 옛 명성(나이·이름값)을 고른다 — 숫자는 현재 OVR 그대로 */
function scoutOffer(core: Core): Cand | null {
  const t = userTeam(core);
  if (t.roster.length >= ROSTER_MAX) return null;
  const byId = new Map(t.roster.map((p) => [p.id, p]));
  const foreignFull = t.roster.filter((p) => p.foreign).length >= FOREIGN_MAX;
  const can = (p: Player) => signingBonus(p) <= core.finance.cash && !(p.foreign && foreignFull) && p.injury === 0 && (core.day > EARLY_DAYS || p.salary <= EARLY_SALARY);
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
      `영입: ${pos} ${s.cur.ovr} → ${p.ovr} · ${partsText(before, after) || '전력 변화 없음'} · 연봉 +${fmtMoney(p.salary)} · 계약금 ${fmtMoney(signingBonus(p))}${cashTail(core, r.core)}`,
      { t: 'sign', pid: p.id },
      flagPiece(core, { win: dw }),
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
  const priceOffer = (to: number, line: string, score: number): Cand | null => {
    const next = setTicketPrice(core, to);
    if (next === core) return null;
    const then = perGame(next);
    const up = to > price;
    return offer(
      score,
      `price:${up ? 'up' : 'down'}`,
      'gate',
      'marketing',
      line,
      `티켓값 ${price.toFixed(1)} → ${next.finance.ticketPrice.toFixed(1)}만: 홈경기당 수입 ${signMoney(then.income - now.income)} · 관중 ${sign(then.att - now.att, '명')}`,
      { t: 'price', value: next.finance.ticketPrice },
      flagPiece(core, { att: then.att - now.att }),
    );
  };
  if (so >= 2) {
    const cost = upgradeCost('seats', core.facilities);
    if (cost !== null && core.finance.cash >= cost) {
      const lv = SEAT_LV[core.facilities.seats + 1];
      const add = lv.cap - SEAT_LV[core.facilities.seats].cap;
      const r = upgradeFacility(core, 'seats');
      const then = perGame(r.core);
      return offer(
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
    return priceOffer(price + 0.2, '표가 모자라요. 조금 올려도 오실 분들은 오세요.', 38);
  }
  if (fill < 0.7) return priceOffer(price - 0.2, '빈자리가 자꾸 눈에 밟혀요. 표값을 내리면 채울 수 있어요!', 36);
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
    const kinds = [iss.lineup ? '▲벤치/⇄제자리' : '', iss.pitchers ? '▲불펜' : ''].filter(Boolean).join('/') || '부상자 교체';
    // 전력이 그대로이거나(경기 전에 저절로 메워지는 부상자 자리뿐) 환산 승률이 오르지 않는 수리는 제안으로 내지 않는다
    if (winDelta(a, b) > 0) out.push(
      offer(50 + n * 5, 'fix', 'fix', 'manager', '오더에 손볼 데가 있습니다. 제 눈에도 보입니다.', `${kinds} ${n}곳 적용: ${partsText(a, b, 3) || '전력 유지(부상자 교체)'}`, { t: 'fix' }, flagPiece(core, { win: winDelta(a, b) })),
    );
  }
  const tf = tiredFront(t);
  if (tf?.fresh) {
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
      ),
    );
  }
  return out;
}

/** 2군 코치: 훈련장 또는 유망주 기용 */
function farmOffer(core: Core): Cand | null {
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
  const kids = t.roster.filter((p) => p.kind === 'B' && !inLineup.has(p.id) && p.injury === 0 && p.age <= PLAY_GROW_AGE && p.pot - p.ovr >= 6).sort((a, b) => b.pot - a.pot);
  for (const k of kids) {
    const slot = t.lineup.findIndex((l) => l.pos === (k.pos as BatPos));
    const cur = slot >= 0 ? byId.get(t.lineup[slot].pid) : undefined;
    if (!cur || k.pot <= cur.ovr || cur.ovr - k.ovr > 12) continue;
    const c: Team = { ...t, lineup: t.lineup.map((l, i) => (i === slot ? { ...l, pid: k.id } : l)) };
    const a = teamParts(t);
    const b = teamParts(c);
    const g = TRAIN_LV[lv].grow;
    return offer(
      24,
      `promote:${k.id}`,
      'farm',
      'farm',
      `${k.name}, ${k.age}세입니다. 지금 쓰면 흔들리겠지만 안 쓰면 썩습니다.`,
      `유망주 기용: ${POS_NAME[k.pos] ?? k.pos} ${cur.ovr} → ${k.ovr}(잠재 ${k.pot}) · ${partsText(a, b) || '전력 변화 없음'} · 주간 성장 확률 ${Math.round(g * 100)}% → ${Math.round(g * PLAY_GROW * 100)}%`,
      { t: 'promote', pid: k.id, slot },
      flagPiece(core, { win: winDelta(a, b) }),
    );
  }
  return null;
}

/** 조합장: 현금이 넉넉한데 부채가 있으면 상환 */
function chairOffer(core: Core): Cand | null {
  const f = core.finance;
  if (f.debt <= 0) return null;
  const amt = Math.min(LOAN_STEP, f.debt);
  if (f.cash < amt + CASH_KEEP) return null;
  const perSeason = Math.round(amt * LOAN_RATE);
  return offer(20, 'repay', 'repay', 'chair', '빚이 있으면 조합원들이 잠을 못 잡니다. 여유가 있을 때 갚읍시다.', `${fmtMoney(amt)} 상환: 이자 시즌당 −${fmtMoney(perSeason)} · 남는 현금 ${fmtMoney(f.cash - amt)}`, { t: 'repay' });
}

// ───────── 자금 경고 (조합장) ─────────

/** 지금 급한 쪽: 금고가 이미 비었으면(또는 다음 경기에 비면) 강제 매각까지, 아니면 바닥까지 */
function cashMetric(core: Core, r: Runway): { n: number | null; label: string; sale: boolean } {
  const sale = r.forcedSale !== null && (core.finance.cash <= 0 || (r.cashOut !== null && r.cashOut <= 1));
  return sale ? { n: r.forcedSale, label: '강제 매각까지', sale } : { n: r.cashOut, label: '바닥까지', sale };
}

/** 조합장의 한 줄: 12경기 안에 금고가 비거나 강제 매각이 올 때만 */
export function cashAlert(core: Core): string | null {
  const r = runway(core);
  if (core.finance.cash <= 0 && r.cashOut !== null && (r.forcedSale === null || r.forcedSale > RUNWAY_DANGER)) return '금고가 비었습니다. 경기마다 빚이 쌓이고 있습니다.';
  if (r.forcedSale !== null && r.forcedSale <= RUNWAY_DANGER) {
    return r.cashOut !== null && r.cashOut > 1 && r.cashOut < r.forcedSale
      ? `이대로면 ${r.cashOut}경기 뒤에 금고가 빕니다. ${r.forcedSale}경기 뒤엔 선수를 내줘야 합니다.`
      : `이대로면 ${r.forcedSale}경기 뒤에 빚이 한도를 넘습니다. 선수를 내줘야 합니다.`;
  }
  if (r.cashOut !== null && r.cashOut <= RUNWAY_DANGER) return `이대로면 ${r.cashOut}경기 뒤에 금고가 빕니다. 조합원들 볼 낯이 없습니다.`;
  return null;
}

/** 가장 효과 큰 대응 1장: 고연봉 저효율 선수 방출 / 티켓값 조정 / 대출 중 금고를 가장 오래 버티게 하는 것 */
function rescueOffer(core: Core): Cand | null {
  const now = runway(core);
  const m0 = cashMetric(core, now);
  if (m0.n === null) return null;
  const t = userTeam(core);
  const val = (r: Runway) => (m0.sale ? r.forcedSale : r.cashOut) ?? 999;
  const tail = (r: Runway) => `${m0.label} ${m0.n} → ${val(r) >= 999 ? '시즌 끝까지 안전' : `${val(r)}경기`}`;
  const before = teamParts(t);
  let best: { gain: number; c: Cand } | null = null;
  const take = (gain: number, c: Cand) => {
    if (gain > 0 && (!best || gain > best.gain)) best = { gain, c };
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
        ...offer(200, `rescue:release:${p.id}`, 'rescue', 'chair', `${p.name}의 연봉이 살림에 비해 큽니다. 미안하지만 보내야겠습니다.`, `방출 ${p.name}: 연봉 −${fmtMoney(p.salary)} · ${moved ? `${moved.label} ${sign(moved.d)}` : '전력 변화 없음'}${cost ? ` · 위약금 ${fmtMoney(cost)}` : ''} · ${tail(rw)}`, { t: 'fix' }, flagPiece(core, { win: dw })),
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
      offer(200, `rescue:price:${d > 0 ? 'up' : 'down'}`, 'rescue', 'chair', d > 0 ? '표값을 조금 올립시다. 오실 분들은 오십니다.' : '표값을 내려 자리를 채웁시다. 빈자리는 돈이 안 됩니다.', `티켓값 ${core.finance.ticketPrice.toFixed(1)} → ${next.finance.ticketPrice.toFixed(1)}만: 홈경기당 수입 ${signMoney(inc)} · ${tail(rw)}`, { t: 'price', value: next.finance.ticketPrice }),
    );
  }
  // 대출: 시간을 벌 뿐이다 — 방출·티켓값으로 버틸 길이 하나도 없을 때만 내미는 마지막 카드
  const b = borrow(core);
  if (!b.error && !m0.sale && !best) {
    const rw = runway(b.core);
    take(
      (val(rw) - m0.n) / 2,
      { ...offer(200, 'rescue:borrow', 'rescue', 'chair', '급한 불부터 끕시다. 다만 빚은 빚입니다.', `대출 +${fmtMoney(LOAN_STEP)}: 이자 시즌당 ${fmtMoney(Math.round(LOAN_STEP * LOAN_RATE))} · ${tail(rw)}`, { t: 'fix' }), rescue: { t: 'borrow' } },
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
      const stat = p.kind === 'B' ? `${p.bat.g - n[1]}경기 ${fmtAvg(p.bat.h - n[2], p.bat.ab - n[3])} ${p.bat.hr - n[4]}홈런` : `${p.pit.g - n[1]}경기 평균자책 ${fmtEra(p.pit.er - n[2], p.pit.outs - n[3])}`;
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
    case 'fix':
      return `지난주 ${d.label}: 이후 ${rec} · ${PART_NAME.map(([k, l], i) => ({ l, a: n[i], b: parts[k] })).filter((x) => x.a !== x.b).slice(0, 2).map((x) => `${x.l} ${x.a} → ${x.b}`).join(' · ') || `타선 ${parts.bat} 그대로`}`;
    case 'rest':
      return p ? `지난주 ${d.label}: ${p.name} ${(p.tired ?? 0) > 0 ? `연투 ${p.tired}일` : '피로 회복'} · 이후 ${rec}` : null;
    case 'training':
      return `지난주 ${d.label}: 이번 주 훈련 성과 ${Math.max(0, memoNum(core, 'grow') - n[0])}회`;
    case 'promote':
      return p ? `지난주 ${d.label}: ${p.bat.g - n[1]}경기 ${fmtAvg(p.bat.h - n[2], p.bat.ab - n[3])} · OVR ${n[0]} → ${p.ovr}` : null;
    case 'rescue': {
      const r = runway(core);
      return `지난주 ${d.label}: 경기당 손익 ${signMoney(r.perGame)} · ${r.cashOut === null ? '이번 시즌 금고는 버팁니다' : `바닥까지 ${r.cashOut}경기`}`;
    }
    case 'repay':
      return `지난주 ${d.label}: 남은 부채 ${fmtMoney(core.finance.debt)} · 이자 경기당 ${fmtMoney(Math.round((core.finance.debt * LOAN_RATE) / Math.max(1, core.schedule.length)))}`;
  }
  return null;
}

// ───────── 브리핑 ─────────

/** 지금 상태의 주간 브리핑 (순수). 제안은 예상 효과가 큰 순 + 그 장의 인물 우선, 같은 종류는 한 장, 최대 3장 */
export function weeklyBriefing(core: Core): Briefing {
  const m = memoOf(core);
  const t = userTeam(core);
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

  const cands = [scoutOffer(core), marketingOffer(core), ...fieldOffers(core), farmOffer(core), chairOffer(core)].filter((c): c is Cand => !!c);
  const themed = STAGE_WHO[Math.min(core.campaign.stage, STAGE_WHO.length - 1)] ?? [];
  const kinds = new Set<string>();
  const offers: BriefOffer[] = [];
  // 금고가 12경기 안에 비면 조합장이 먼저 말하고, 가장 효과 큰 대응 한 장이 맨 위에 온다
  const alert = cashAlert(core);
  const rescue = alert ? rescueOffer(core) : null;
  if (rescue) {
    const { score: _s, ...o } = rescue;
    offers.push(o);
    kinds.add('rescue');
  }
  for (const c of cands.sort((a, b) => b.score + (themed.includes(b.who) ? 100 : 0) - (a.score + (themed.includes(a.who) ? 100 : 0)))) {
    if (offers.length >= BRIEF_MAX) break;
    const skippedAt = m.skipped[c.id];
    if (kinds.has(c.kind) || (skippedAt !== undefined && core.day - skippedAt <= SKIP_QUIET)) continue;
    kinds.add(c.kind);
    const { score: _score, ...o } = c;
    offers.push(o);
  }
  void t;
  const results = m.done.filter((d) => d.day < core.day).map((d) => resultLine(core, d)).filter((s): s is string => !!s);
  return { day: core.day, summary, results, offers, ...(alert ? { alert } : {}) };
}

/** 브리핑을 열 차례인가: 정규시즌 6경기마다, 그날 이미 닫지 않았을 때 */
export function briefingDue(core: Core): boolean {
  if (core.phase !== 'season' || core.day <= 0 || core.day % BRIEF_EVERY !== 0 || core.day >= core.schedule.length || core.campaign.briefing) return false;
  const m = core.campaign.briefMemo;
  return !(m && m.season === core.season && m.snap?.day === core.day);
}

/** 매 경기 후(이벤트 카드 뽑기 뒤): 차례면 브리핑을 campaign.briefing 에 둔다. 아니면 원본 반환 */
export function drawBriefing(core0: Core): Core {
  if (!briefingDue(core0)) return core0;
  const core = structuredClone(core0);
  const b = weeklyBriefing(core);
  const m = memoOf(core);
  core.campaign.briefing = b;
  core.campaign.briefMemo = { ...m, shown: (m.shown ?? 0) + b.offers.length };
  return core;
}

/** 이벤트 카드를 처리한 뒤: 대기 중인 브리핑을 바뀐 상태로 다시 만든다 */
export function refreshBriefing(core0: Core): Core {
  if (!core0.campaign.briefing) return core0;
  const core = structuredClone(core0);
  const m = memoOf(core);
  const b = weeklyBriefing(core);
  core.campaign.briefMemo = { ...m, shown: (m.shown ?? 0) - core0.campaign.briefing.offers.length + b.offers.length };
  core.campaign.briefing = b;
  return core;
}

/** 제안 실행: 기존 액션을 그대로 부른다. 실행 기록은 다음 주 결과 줄의 재료가 된다 */
export function runOffer(core0: Core, id: string): { core: Core; error?: string; text?: string } {
  const b0 = core0.campaign.briefing;
  const o = b0?.offers.find((x) => x.id === id);
  if (!b0 || !o) return { core: core0, error: '실행할 제안이 없습니다' };
  if (o.state) return { core: core0, error: '이미 처리한 제안입니다' };
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
  const m = memoOf(core);
  core.campaign.briefMemo = { ...m, done: [...m.done, done] };
  const b = core.campaign.briefing!;
  core.campaign.briefing = { ...b, offers: b.offers.map((x) => (x.id === id ? { ...x, state: 'done' as const } : x)) };
  const after = teamParts(userTeam(core));
  const moved = partsText(before, after, 3);
  return { core, text: `${done.label} 완료${moved ? ` — ${moved}` : ''}` };
}

/** 제안 넘기기: 2주 동안 같은 제안은 다시 오지 않는다 */
export function skipOffer(core0: Core, id: string): Core {
  const b = core0.campaign.briefing;
  const o = b?.offers.find((x) => x.id === id);
  if (!b || !o || o.state) return core0;
  const core = structuredClone(core0);
  const m = memoOf(core);
  core.campaign.briefMemo = { ...m, skipped: { ...m.skipped, [id]: core.day } };
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
  for (const o of b.offers) if (!o.state) skipped[o.id] = core.day;
  core.campaign.briefMemo = {
    ...m,
    skipped,
    done: m.done.filter((d) => d.day >= core.day),
    snap: { day: core.day, rank: rankOf(core.teams, core.userId), profit: opProfit(core.finance.ledger), attN: core.attHistory.length },
  };
  core.campaign.briefing = null;
  return core;
}

export const briefWho = (o: BriefOffer) => CHARACTERS[o.who];
