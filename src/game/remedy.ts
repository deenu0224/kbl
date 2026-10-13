// "할 일"의 조치: 항목마다 지금 실제로 가능한 조치를 결과 숫자와 함께 낸다 (순수 함수).
// 원칙: 조치 버튼이 없는 알림은 띄우지 않는다 — todo.ts 가 remedies() 로 걸러 낸다.
import type { BatPos, Core, Player, Team } from './types';
import {
  FARM_LOCK, FOOD_LV, LOAN_RATE, LOAN_STEP, MIN_BATTERS, MIN_PITCHERS, RAIN_ROOF, ROOF_SEATS, ROSTER_MAX, SEAT_LV, SVC_YEARS, WEATHER_MULT,
  activeRoster, capacityOf, farmRoster, hasRoof, previewDemand, releaseCost, signingBonus, upgradeCost, userTeam,
} from './economy';
import { svcYear } from './contract';
import { FOREIGN_MAX } from './events';
import { farmAutoOn, shuttleArms } from './farm';
import { applyFixes, bullpenLoad, orderIssues, ploc, pput } from './fixes';
import { fmtInt, fmtMoney } from './format';
import { isFranchise } from './franchise';
import { slotValue } from './lineup';
import { memoGet } from './memo';
import { teamParts, type TeamParts } from './ratings';
import { runway, runwayAfter, type Runway } from './runway';
import { POS_NAME } from './script';
import { borrow, callUp, farmLockLeft, releasePlayer, sendDown, setTicketPrice, signPlayer, upgradeFacility } from './season';
import { tiredPenalty } from './sim';

export type RemedyGo = 'order' | 'pitchers' | 'market' | 'finance' | 'seats' | 'league' | 'squad';
/** 직렬화 가능한 액션 서술. 대상은 실행 시점의 core 에서 다시 찾는다 */
export type RemedyAction =
  | { t: 'sub' } // 부상 주전·선발 자리에 1군 대체 선수를 넣는다
  | { t: 'callupSub'; pid: string; down?: string } // 2군 선수를 올려 부상 자리에 넣는다 (1군이 가득이면 down 을 내린다)
  | { t: 'fixAll' } // 오더 추천 전부 적용
  | { t: 'callup'; pid: string; down?: string }
  | { t: 'sign'; pid: string }
  | { t: 'down'; pid: string }
  | { t: 'release'; pid: string }
  | { t: 'price'; value: number }
  | { t: 'borrow' }
  | { t: 'seats' } // 관중석 증축
  | { t: 'penStyle' } // 불펜 방침을 균형으로
  | { t: 'go'; to: RemedyGo; sub?: 'lineup' | 'pitchers' } // 화면 이동 (core 는 그대로 — 화면이 처리한다)
  | { t: 'dismiss' } // 확인하고 닫기
  | { t: 'none' }; // 그대로 둔다

export interface Remedy {
  id: string;
  label: string;
  effect: string; // 결과 한 줄(숫자)
  run: RemedyAction;
  tone?: 'good' | 'warn' | 'bad';
}

export const REMEDY_MAX = 4; // "그대로 둔다" 포함
const CALLUP_GAIN = 2; // 자동 운영이 켜져 있을 때: 2군 선수가 벤치 대체보다 이만큼 나아야 알린다
const PEN_SIGN_SALARY = 15000; // 불펜 보강용 FA: 연봉 1.5억 이하의 구원 (briefing.ts 와 같은 기준)

type Res = { core: Core; error?: string };
const sgn = (v: number, unit = '') => (v > 0 ? `+${fmtInt(v)}${unit}` : v < 0 ? `−${fmtInt(-v)}${unit}` : `±0${unit}`);
const sgnMoney = (v: number) => (v >= 0 ? `+${fmtMoney(v)}` : `−${fmtMoney(-v)}`);
const posKo = (pos: string) => POS_NAME[pos] ?? pos;
const PARTS: [keyof TeamParts, string][] = [['bat', '타선'], ['def', '수비'], ['rot', '선발'], ['pen', '불펜']];
function partsDelta(a: TeamParts, b: TeamParts): string {
  const d = PARTS.map(([k, l]) => ({ l, d: b[k] - a[k] })).filter((x) => x.d !== 0);
  return d.length ? d.map((x) => `${x.l} ${sgn(x.d)}`).join(' · ') : '전력 그대로';
}
const keySet = (t: Team) => new Set([...t.lineup.map((s) => s.pid), ...t.rotation, ...(t.closer ? [t.closer] : []), ...t.bullpen.slice(0, 3)]);
/** 내리거나 내보내도 주전이 흔들리지 않는 선수: 주전·로테이션·필승조가 아닌 건강한 1군 (약한 순) */
function spare(t: Team, kind?: 'B' | 'P'): Player[] {
  const used = keySet(t);
  return activeRoster(t).filter((p) => (!kind || p.kind === kind) && !used.has(p.id) && p.injury === 0).sort((a, b) => a.ovr - b.ovr || b.age - a.age);
}
/** 차례로 실행한다. 하나라도 막히면 원본과 사유를 돌려준다 */
function chain(core: Core, steps: ((c: Core) => Res)[]): Res {
  let cur = core;
  for (const s of steps) {
    const r = s(cur);
    if (r.error) return { core, error: r.error };
    cur = r.core;
  }
  return { core: cur };
}
function mutTeam(core0: Core, fn: (t: Team) => void): Core {
  const core = structuredClone(core0);
  fn(userTeam(core));
  return core;
}

// ───────── 부상 ─────────

interface Swap { out: Player; in: Player; where: string }
/** 부상 주전·선발 자리에 1군의 건강한 대체 선수를 넣는다 (mutate). 경기 중 자동 대체(sim)와 같은 기준 */
function subHurtMut(t: Team): Swap[] {
  const byId = new Map(t.roster.map((p) => [p.id, p]));
  const out: Swap[] = [];
  t.lineup.forEach((s, i) => {
    const h = byId.get(s.pid);
    if (!h || h.injury === 0) return;
    const inLu = new Set(t.lineup.map((l) => l.pid));
    const c = activeRoster(t).filter((p) => p.kind === 'B' && p.injury === 0 && !inLu.has(p.id)).sort((a, b) => slotValue(b, s.pos) - slotValue(a, s.pos))[0];
    if (!c) return;
    t.lineup[i] = { ...s, pid: c.id };
    out.push({ out: h, in: c, where: `${i + 1}번 ${posKo(s.pos)}` });
  });
  t.rotation.forEach((id, i) => {
    const h = byId.get(id);
    if (!h || h.injury === 0) return;
    const c = t.bullpen.map((x) => byId.get(x)).filter((p): p is Player => !!p && p.injury === 0).sort((a, b) => (b.pos === 'SP' ? 100 : 0) + b.ovr - ((a.pos === 'SP' ? 100 : 0) + a.ovr))[0];
    if (!c) return;
    const lc = ploc(t, c.id);
    t.rotation[i] = c.id;
    pput(t, lc, h.id);
    out.push({ out: h, in: c, where: `${i + 1}선발` });
  });
  return out;
}

export interface InjuryPlan {
  hurt: Player[]; // 주전·로테이션의 부상자
  subs: Swap[]; // 1군 대체
  covered: boolean; // 부상자 전원에게 1군 대체가 있다 (경기마다 자동으로 메워진다)
  farm: { k: Player; h: Player; gain: number; down: Player | null } | null; // 2군의 더 나은 대체
  farmBlock: string | null; // 2군에 더 나은 선수가 있는데 못 올리는 사유
}
export function injuryPlan(core: Core): InjuryPlan {
  const t = userTeam(core);
  const byId = new Map(t.roster.map((p) => [p.id, p]));
  const hurtB = t.lineup.map((l) => byId.get(l.pid)).filter((p): p is Player => !!p && p.injury > 0);
  const hurtP = t.rotation.map((id) => byId.get(id)).filter((p): p is Player => !!p && p.injury > 0);
  const hurt = [...hurtB, ...hurtP];
  const subs = hurt.length ? subHurtMut(structuredClone(t)) : [];
  const covered = subs.length >= hurt.length;
  let farm: InjuryPlan['farm'] = null;
  let farmBlock: string | null = null;
  // 결장이 가장 긴 부상자 한 명의 자리를 2군에서 메울 수 있는지
  const h = hurt.slice().sort((a, b) => b.injury - a.injury)[0];
  if (h) {
    const pool = farmRoster(t).filter((p) => p.kind === h.kind && p.injury === 0 && farmLockLeft(core, p) === 0);
    const sub = subs.find((s) => s.out.id === h.id)?.in;
    let k: Player | undefined;
    let gain = 0;
    if (h.kind === 'B') {
      const pos = (t.lineup.find((s) => s.pid === h.id)?.pos ?? 'DH') as BatPos;
      k = pool.sort((a, b) => slotValue(b, pos) - slotValue(a, pos))[0];
      gain = k ? Math.round(slotValue(k, pos) - (sub ? slotValue(sub, pos) : 0)) : 0;
    } else {
      k = pool.filter((p) => p.pos === 'SP').sort((a, b) => b.ovr - a.ovr)[0];
      gain = k ? k.ovr - (sub ? sub.ovr - (sub.pos === 'SP' ? 0 : 100) : 0) : 0;
    }
    if (k && gain > 0) {
      const full = activeRoster(t).length >= ROSTER_MAX;
      const down = full ? (spare(t, k.kind).filter((p) => p.id !== sub?.id)[0] ?? null) : null;
      if (full && !down) farmBlock = '1군이 가득 차 올릴 자리 없음';
      else farm = { k, h, gain, down };
    }
  }
  return { hurt, subs, covered, farm, farmBlock };
}

/** 부상 항목을 할 일에 올릴지와 붙일 이유. 자동 운영이 켜져 있으면 벤치가 메우는 부상은 알리지 않는다 */
export function injuryNotice(core: Core): { show: boolean; why: string } {
  const pl = injuryPlan(core);
  if (!pl.hurt.length) return { show: false, why: '' };
  if (!farmAutoOn(core)) return { show: pl.subs.length > 0 || !!pl.farm, why: '' };
  if (!pl.covered) return { show: pl.subs.length > 0 || !!pl.farm, why: pl.farm ? '벤치에 대체 선수 없음' : (pl.farmBlock ?? '올릴 2군 선수 없음') };
  if (pl.farm && pl.farm.gain >= CALLUP_GAIN) return { show: true, why: '2군에 더 나은 대체' };
  return { show: false, why: '' };
}

function applyCallupSub(core: Core, pid: string, down?: string): Res {
  const r = chain(core, [...(down ? [(c: Core) => sendDown(c, down)] : []), (c) => callUp(c, pid)]);
  if (r.error) return r;
  return { core: mutTeam(r.core, (t) => void subHurtMut(t)) };
}

function injuryRemedies(core: Core): Remedy[] {
  const t = userTeam(core);
  const pl = injuryPlan(core);
  if (!pl.hurt.length) return [];
  const before = teamParts(t);
  const out: Remedy[] = [];
  if (pl.subs.length) {
    const c = structuredClone(t);
    subHurtMut(c);
    const s = pl.subs[0];
    out.push({
      id: 'sub', run: { t: 'sub' }, tone: 'good',
      label: `대체 선수 넣기 — ${s.in.name} → ${s.where}${pl.subs.length > 1 ? ` 외 ${pl.subs.length - 1}명` : ''}`,
      effect: `${partsDelta(before, teamParts(c))} · ${s.out.name} ${s.out.injury}경기 결장`,
    });
  }
  if (pl.farm) {
    const { k, h, down } = pl.farm;
    const r = applyCallupSub(core, k.id, down?.id);
    if (!r.error) {
      out.push({
        id: `up-${k.id}`, run: { t: 'callupSub', pid: k.id, ...(down ? { down: down.id } : {}) }, tone: 'good',
        label: `2군 ${k.name} 콜업 후 투입 — ${posKo(k.pos)} 오버롤 ${k.ovr}`,
        effect: `${partsDelta(before, teamParts(userTeam(r.core)))} · ${h.name} 자리${down ? ` · ${down.name} 2군행` : ''}`,
      });
    }
  }
  if (!out.length) return [];
  const auto = pl.subs[0]?.in;
  out.push({ id: 'none', run: { t: 'none' }, label: '그대로 둔다', effect: auto ? `경기마다 자동 대체(${auto.name})${pl.subs.length < pl.hurt.length ? ' · 대체가 없는 자리는 부상자가 출전' : ''}` : '대체 선수가 없어 부상자가 그대로 출전' });
  return out;
}

// ───────── 오더 점검 ─────────

function fixRemedies(core: Core): Remedy[] {
  const t = userTeam(core);
  const o = orderIssues(t);
  if (o.lineup + o.pitchers === 0) return [];
  const c = structuredClone(t);
  const n = applyFixes(c);
  const a = teamParts(t);
  const b = teamParts(c);
  return [
    { id: 'fixAll', run: { t: 'fixAll' }, tone: 'good', label: `추천 ${n}건 전부 적용`, effect: partsDelta(a, b) },
    { id: 'edit', run: { t: 'go', to: 'order', sub: o.lineup ? 'lineup' : 'pitchers' }, label: '오더 편집기 열기', effect: `직접 고친다 — ${[o.lineup ? `타선 ${o.lineup}곳` : '', o.pitchers ? `투수 ${o.pitchers}곳` : ''].filter(Boolean).join(' · ')}` },
    { id: 'none', run: { t: 'none' }, label: '그대로 둔다', effect: `지금 오더로 경기 — 타선 ${a.bat} · 수비 ${a.def} · 선발 ${a.rot} · 불펜 ${a.pen}` },
  ];
}

// ───────── 불펜 과부하 ─────────

const penStyleOf = (core: Core): string | undefined => (core.campaign as { penStyle?: string }).penStyle;

/** 자동 운영의 2군 코치가 다음 경기 뒤에 스스로 교대할 수 있는가 (farm.ts shuttleMut 과 같은 조건) */
export function coachShuttles(core: Core): boolean {
  if (!farmAutoOn(core)) return false;
  const t = userTeam(core);
  const load = bullpenLoad(t);
  if (!load.arms || load.tired2 * 2 < load.arms) return false;
  if (memoGet(core, 'shuttle') === String(Math.floor(core.day / 6))) return false;
  const up = shuttleArms(core)[0];
  if (!up) return false;
  const byId = new Map(t.roster.map((p) => [p.id, p]));
  return t.bullpen.slice(2).map((id) => byId.get(id)).some((p) => !!p && p.injury === 0 && !p.subFor && (p.tired ?? 0) >= 1 && up.ovr >= p.ovr - 6);
}

function penRemedies(core: Core): Remedy[] {
  const t = userTeam(core);
  const load = bullpenLoad(t);
  const out: Remedy[] = [];
  const byId = new Map(t.roster.map((p) => [p.id, p]));
  const full = activeRoster(t).length >= ROSTER_MAX;
  const restedOf = (c: Core) => bullpenLoad(userTeam(c)).rested;
  const after = (c: Core) => (bullpenLoad(userTeam(c)).label === '과부하' ? '과부하는 남는다' : '과부하 해소');
  const up = shuttleArms(core)[0];
  if (up) {
    // 1군이 가득이면 가장 지친 추격조를 내린다
    const down = full
      ? t.bullpen.slice(2).map((id) => byId.get(id)).filter((p): p is Player => !!p && p.injury === 0).sort((a, b) => (b.tired ?? 0) - (a.tired ?? 0) || a.ovr - b.ovr)[0]
      : undefined;
    if (!full || down) {
      const r = chain(core, [...(down ? [(c: Core) => sendDown(c, down.id)] : []), (c) => callUp(c, up.id)]);
      // 등판 가능 인원이 실제로 늘 때만 낸다
      if (!r.error && restedOf(r.core) > load.rested) {
        out.push({
          id: `up-${up.id}`, run: { t: 'callup', pid: up.id, ...(down ? { down: down.id } : {}) }, tone: 'good',
          label: `2군 ${up.name} 콜업 — 등판 가능 ${load.rested} → ${restedOf(r.core)}명`,
          effect: `${after(r.core)} · ${posKo(up.pos)} 오버롤 ${up.ovr}${down ? ` · ${down.name} 2군행(${FARM_LOCK}경기 재등록 불가)` : ` · 1군 ${activeRoster(t).length} → ${activeRoster(t).length + 1}명`}`,
        });
      }
    }
  }
  if (!full) {
    const foreignFull = t.roster.filter((p) => p.foreign).length >= FOREIGN_MAX;
    const fa = core.freeAgents
      .filter((p) => p.kind === 'P' && p.pos !== 'SP' && p.injury === 0 && p.salary <= PEN_SIGN_SALARY && signingBonus(p) <= core.finance.cash && !(p.foreign && foreignFull))
      .sort((a, b) => b.ovr - a.ovr || a.salary - b.salary)[0];
    const r = fa ? signPlayer(core, fa.id) : null;
    if (fa && r && !r.error && restedOf(r.core) > load.rested) {
      out.push({
        id: `sign-${fa.id}`, run: { t: 'sign', pid: fa.id },
        label: `FA 구원 ${fa.name} 영입 — 등판 가능 ${sgn(restedOf(r.core) - load.rested)}`,
        effect: `${after(r.core)} · 오버롤 ${fa.ovr} · 연봉 +${fmtMoney(fa.salary)} · 계약금 ${fmtMoney(signingBonus(fa))}`,
      });
    }
  }
  // 방침: 다른 워커가 만드는 campaign.penStyle. store 에 setPenStyle 이 생기면 그쪽을 쓰도록 바꾼다
  const style = penStyleOf(core);
  if (style === 'swarm' || style === 'trust') {
    out.push({ id: 'penStyle', run: { t: 'penStyle' }, label: '불펜 방침을 균형으로', effect: style === 'swarm' ? '경기당 등판 투수 수가 줄어 쉬는 투수가 생긴다' : '필승조에 몰린 등판을 나눈다' });
  }
  if (!out.length) return [];
  const pen = [...t.bullpen, ...(t.closer ? [t.closer] : [])].map((id) => byId.get(id)).filter((p): p is Player => !!p && p.injury === 0);
  const least = pen.length ? Math.min(...pen.map((p) => p.tired ?? 0)) : 0;
  out.push({ id: 'none', run: { t: 'none' }, tone: 'warn', label: '그대로 둔다', effect: least > 0 ? `다음 경기 구위가 떨어진 투수 등판 — 연투 ${least}일 구위 −${tiredPenalty(least)}` : `다음 경기 등판 가능 ${load.rested}명으로 버틴다` });
  return out;
}

// ───────── 1군 정원 ─────────

function overRemedies(core: Core): Remedy[] {
  const t = userTeam(core);
  const n = activeRoster(t).length;
  if (n <= ROSTER_MAX) return [];
  const out: Remedy[] = [];
  const cand = spare(t);
  const d = cand.find((p) => !sendDown(core, p.id).error);
  if (d) out.push({ id: `down-${d.id}`, run: { t: 'down', pid: d.id }, tone: 'good', label: `2군으로: ${d.name}`, effect: `${posKo(d.pos)} 오버롤 ${d.ovr} · 1군 ${n} → ${n - 1}명 · ${FARM_LOCK}경기 뒤 재등록 가능` });
  const r = cand.find((p) => !isFranchise(p, core.season) && !releasePlayer(core, p.id).error);
  if (r) out.push({ id: `rel-${r.id}`, run: { t: 'release', pid: r.id }, label: `방출: ${r.name} — 잔여 연봉 지급 ${fmtMoney(releaseCost(r, core))}`, effect: `${posKo(r.pos)} 오버롤 ${r.ovr} · 연봉 −${fmtMoney(r.salary)} · 1군 ${n} → ${n - 1}명` });
  if (!out.length) return [];
  out.push({ id: 'none', run: { t: 'none' }, tone: 'bad', label: '그대로 둔다', effect: `1군 ${n}/${ROSTER_MAX} — ${n - ROSTER_MAX}명 초과가 남는다` });
  return out;
}

function fewRemedies(core: Core, kind: 'B' | 'P'): Remedy[] {
  const t = userTeam(core);
  const min = kind === 'B' ? MIN_BATTERS : MIN_PITCHERS;
  const n = activeRoster(t).filter((p) => p.kind === kind).length;
  if (n >= min) return [];
  const word = kind === 'B' ? '타자' : '투수';
  const out: Remedy[] = [];
  const up = farmRoster(t).filter((p) => p.kind === kind && p.injury === 0).sort((a, b) => b.ovr - a.ovr).find((p) => !callUp(core, p.id).error);
  if (up) out.push({ id: `up-${up.id}`, run: { t: 'callup', pid: up.id }, tone: 'good', label: `2군 ${up.name} 콜업`, effect: `${posKo(up.pos)} 오버롤 ${up.ovr} · 1군 ${word} ${n} → ${n + 1}명` });
  const fa = core.freeAgents.filter((p) => p.kind === kind && p.injury === 0).sort((a, b) => a.salary - b.salary || b.ovr - a.ovr).find((p) => !signPlayer(core, p.id).error);
  if (fa) out.push({ id: `sign-${fa.id}`, run: { t: 'sign', pid: fa.id }, label: `FA 최저 연봉 ${fa.name} 영입`, effect: `${posKo(fa.pos)} 오버롤 ${fa.ovr} · 연봉 +${fmtMoney(fa.salary)} · 계약금 ${fmtMoney(signingBonus(fa))} · 1군 ${word} ${n} → ${n + 1}명` });
  if (!out.length) return [];
  out.push({ id: 'none', run: { t: 'none' }, tone: 'bad', label: '그대로 둔다', effect: `1군 ${word} ${n}명 — 최소 ${min}명에 ${min - n}명 모자란다` });
  return out;
}

// ───────── 자금 경고 ─────────

/** 지금 급한 쪽: 금고가 이미 비었으면 강제 매각까지, 아니면 바닥까지 (briefing.ts cashMetric 과 같은 기준) */
function cashMetric(core: Core, r: Runway): { n: number | null; label: string; sale: boolean } {
  const sale = r.forcedSale !== null && (core.finance.cash <= 0 || (r.cashOut !== null && r.cashOut <= 1));
  return sale ? { n: r.forcedSale, label: '강제 매각까지', sale } : { n: r.cashOut, label: '바닥까지', sale };
}
const gateIncome = (c: Core) => Math.min(capacityOf(c), previewDemand(c)) * (c.finance.ticketPrice + FOOD_LV[c.facilities.food].spend);
function homeShare(core: Core): number {
  const left = core.schedule.slice(core.day);
  return left.length ? left.filter((d) => d.some((g) => g.homeId === core.userId)).length / left.length : 0;
}

function cashRemedies(core: Core): Remedy[] {
  if (core.phase !== 'season') return [];
  const now = runway(core);
  const m0 = cashMetric(core, now);
  if (m0.n === null) return [];
  const t = userTeam(core);
  const val = (r: Runway) => (m0.sale ? r.forcedSale : r.cashOut) ?? 999;
  const tail = (r: Runway) => `${m0.label} ${m0.n} → ${val(r) >= 999 ? '시즌 끝까지 안전' : `${val(r)}경기`}`;
  const before = teamParts(t);
  const cands: { gain: number; r: Remedy }[] = [];
  // 방출: 연봉이 크고 오버롤 대비 비싼 순으로 (프랜차이즈 스타는 건드리지 않는다)
  const pricey = t.roster
    .filter((p) => p.salary >= 8000 && !isFranchise(p, core.season))
    .sort((a, b) => b.salary / Math.max(5, b.ovr - 45) - a.salary / Math.max(5, a.ovr - 45))
    .slice(0, 4);
  let rel: { gain: number; r: Remedy } | null = null;
  for (const p of pricey) {
    const r = releasePlayer(core, p.id);
    if (r.error) continue;
    const rw = runway(r.core);
    const gain = val(rw) - m0.n;
    if (gain <= 0 || (rel && rel.gain >= gain)) continue;
    rel = {
      gain,
      r: { id: `rel-${p.id}`, run: { t: 'release', pid: p.id }, label: `방출: ${p.name} — ${tail(rw)}`, effect: `연봉 −${fmtMoney(p.salary)} · 잔여 연봉 지급 ${fmtMoney(core.finance.cash - r.core.finance.cash)} · ${partsDelta(before, teamParts(userTeam(r.core)))}` },
    };
  }
  if (rel) cands.push(rel);
  // 티켓값: 홈경기당 수입이 늘어나는 쪽으로 0.2 만
  for (const d of [0.2, -0.2]) {
    const next = setTicketPrice(core, core.finance.ticketPrice + d);
    if (next === core) continue;
    const inc = Math.round(gateIncome(next) - gateIncome(core));
    if (inc <= 0) continue;
    const rw = runwayAfter(core, { perGame: inc * homeShare(core) });
    const gain = val(rw) - m0.n;
    if (gain <= 0) continue;
    cands.push({ gain, r: { id: `price-${d > 0 ? 'up' : 'down'}`, run: { t: 'price', value: next.finance.ticketPrice }, label: `티켓값 ${core.finance.ticketPrice.toFixed(1)} → ${next.finance.ticketPrice.toFixed(1)}만 — ${tail(rw)}`, effect: `홈경기당 수입 ${sgnMoney(inc)} · 예상 관중 ${sgn(Math.min(capacityOf(next), previewDemand(next)) - Math.min(capacityOf(core), previewDemand(core)), '명')}` } });
  }
  // 대출: 시간을 벌 뿐이다 (강제 매각이 문제일 때는 답이 아니다)
  const b = borrow(core);
  if (!b.error && !m0.sale) {
    const rw = runway(b.core);
    const gain = val(rw) - m0.n;
    if (gain > 0) cands.push({ gain: gain / 2, r: { id: 'borrow', run: { t: 'borrow' }, tone: 'warn', label: `대출 +${fmtMoney(LOAN_STEP)} — ${tail(rw)}`, effect: `이자 시즌당 ${fmtMoney(Math.round(LOAN_STEP * LOAN_RATE))} · 부채 ${fmtMoney(core.finance.debt)} → ${fmtMoney(b.core.finance.debt)}` } });
  }
  if (!cands.length) return [];
  const out = cands.sort((a, b2) => b2.gain - a.gain).slice(0, REMEDY_MAX - 1).map((c) => c.r);
  out.push({ id: 'none', run: { t: 'none' }, tone: 'bad', label: '그대로 둔다', effect: m0.sale ? `${m0.n}경기 뒤 빚이 한도를 넘어 선수를 내준다` : core.finance.cash <= 0 ? '금고 바닥 — 경기마다 빚이 쌓인다' : `${m0.n}경기 뒤 금고가 빈다 · 경기당 ${sgnMoney(now.perGame)}` });
  return out;
}

// ───────── 확인 항목 ─────────

const CLOSE: Remedy = { id: 'dismiss', run: { t: 'dismiss' }, label: '확인하고 닫기', effect: '이 알림을 목록에서 지운다' };

function awayRemedies(core: Core): Remedy[] {
  const away = core.crowd?.turnedAway ?? 0;
  const out: Remedy[] = [];
  const cost = upgradeCost('seats', core.facilities);
  if (cost !== null) {
    const r = upgradeFacility(core, 'seats');
    const add = SEAT_LV[core.facilities.seats + 1].cap - SEAT_LV[core.facilities.seats].cap;
    if (!r.error) out.push({ id: 'seats', run: { t: 'seats' }, tone: 'good', label: `관중석 증축 ${fmtMoney(cost)}: ${sgn(add, '석')}`, effect: `지난 홈경기 ${fmtInt(away)}명이 돌아감 · 유지비 +${fmtMoney(SEAT_LV[core.facilities.seats + 1].upkeep - SEAT_LV[core.facilities.seats].upkeep)}/홈경기 · 현금 ${fmtMoney(core.finance.cash)} → ${fmtMoney(r.core.finance.cash)}` });
  }
  const next = setTicketPrice(core, core.finance.ticketPrice + 0.2);
  if (next !== core) {
    const att = (c: Core) => Math.min(capacityOf(c), previewDemand(c));
    const inc = Math.round(gateIncome(next) - gateIncome(core));
    if (inc > 0) out.push({ id: 'price-up', run: { t: 'price', value: next.finance.ticketPrice }, label: `티켓값 ${core.finance.ticketPrice.toFixed(1)} → ${next.finance.ticketPrice.toFixed(1)}만`, effect: `예상 관중 ${sgn(att(next) - att(core), '명')} · 홈경기당 수입 ${sgnMoney(inc)}` });
  }
  return [...out, CLOSE];
}

function scoutRemedies(core: Core): Remedy[] {
  const ids = (memoGet(core, 'scoutList') ?? '').split(',');
  const ps = core.freeAgents.filter((p) => ids.includes(p.id)).sort((a, b) => b.ovr - a.ovr);
  if (!ps.length) return [CLOSE];
  return [{ id: 'go', run: { t: 'go', to: 'market' }, tone: 'good', label: `이적 창구 열기 — 추천 ${ps.length}명`, effect: ps.slice(0, 2).map((p) => `${p.name}(${posKo(p.pos)} 오버롤 ${p.ovr} · 연봉 ${fmtMoney(p.salary)})`).join(' · ') }, CLOSE];
}

function faRemedies(core: Core): Remedy[] {
  const t = userTeam(core);
  const fa = t.roster.filter((p) => (svcYear(core, p) ?? 0) >= SVC_YEARS).sort((a, b) => b.ovr - a.ovr);
  if (!fa.length) return [CLOSE];
  return [{ id: 'go', run: { t: 'go', to: 'squad' }, label: `선수단 열기 — 재계약 대기 ${fa.length}명`, effect: `${fa.slice(0, 2).map((p) => `${p.name}(오버롤 ${p.ovr} · 연봉 ${fmtMoney(p.salary)})`).join(' · ')} — 시즌이 끝나면 조건을 부른다` }, CLOSE];
}

const pct = (v: number) => `${Math.round(Math.abs(v) * 100)}%`;
/** 예보 항목의 구간 종류 ('beat-{season}-{id}-{from}') */
function beatKind(todoId: string): string {
  return todoId.split('-').slice(2, -1).join('-');
}
/** 예보의 영향 한 줄 */
function beatImpact(core: Core, kind: string): string {
  if (kind === 'rainy') return hasRoof(core.facilities) ? `장마: 지붕이 있어 비 오는 날 관중 −${pct(1 - RAIN_ROOF)}` : `장마: 지붕 없는 구장은 비 오는 날 관중 −${pct(1 - WEATHER_MULT.rain)}`;
  if (kind === 'road-trip') return `원정 연전: 그동안 입장 수입 없음 · 현금 ${fmtMoney(core.finance.cash)}`;
  if (kind === 'home-stand') return `홈 연전: 예상 관중 ${fmtInt(previewDemand(core))}명 / 좌석 ${fmtInt(capacityOf(core))}석`;
  if (kind.startsWith('rivals')) return '순위가 붙은 팀과의 연전: 한 경기가 두 경기 몫';
  return '일정에 이름 붙은 구간이 다가온다';
}

function beatRemedies(core: Core, todoId: string): Remedy[] {
  const kind = beatKind(todoId);
  const out: Remedy[] = [];
  if (kind === 'rainy' && !hasRoof(core.facilities)) {
    let cost = 0;
    for (let lv = core.facilities.seats + 1; lv <= ROOF_SEATS; lv++) cost += SEAT_LV[lv].cost;
    const one = core.facilities.seats + 1 === ROOF_SEATS && !upgradeFacility(core, 'seats').error;
    out.push(
      one
        ? { id: 'seats', run: { t: 'seats' }, tone: 'good', label: `관중석 Lv${ROOF_SEATS + 1}(지붕) 증축 ${fmtMoney(cost)}`, effect: `비 오는 날 관중 −${pct(1 - WEATHER_MULT.rain)} → −${pct(1 - RAIN_ROOF)} · 현금 ${fmtMoney(core.finance.cash)} → ${fmtMoney(core.finance.cash - cost)}` }
        : { id: 'go', run: { t: 'go', to: 'seats' }, label: '구장 화면 열기', effect: `지붕(관중석 Lv${ROOF_SEATS + 1})까지 ${fmtMoney(cost)} · 현금 ${fmtMoney(core.finance.cash)}` },
    );
  } else if (kind === 'home-stand') out.push({ id: 'go', run: { t: 'go', to: 'seats' }, label: '구장 화면 열기', effect: '관중석·티켓값을 연전 전에 맞춘다' });
  else if (kind === 'road-trip') out.push({ id: 'go', run: { t: 'go', to: 'finance' }, label: '재무 화면 열기', effect: `경기당 ${sgnMoney(runway(core).perGame)} · 현금 ${fmtMoney(core.finance.cash)}` });
  else out.push({ id: 'go', run: { t: 'go', to: 'league' }, label: '리그 화면 열기', effect: '일정과 순위를 본다' });
  return [...out, CLOSE];
}

// ───────── 공개 함수 ─────────

/** 그 할 일에 지금 가능한 조치 (효과 큰 순, 0~4개). 마지막은 항상 "그대로 둔다"(확인 항목은 "확인하고 닫기") */
export function remedies(core: Core, todoId: string): Remedy[] {
  const id = todoId.split('-')[0];
  const list =
    id === 'hurt' || id === 'injury' ? injuryRemedies(core)
    : id === 'fix' ? fixRemedies(core)
    : id === 'pen' ? penRemedies(core)
    : id === 'over' ? overRemedies(core)
    : id === 'fewB' ? fewRemedies(core, 'B')
    : id === 'fewP' ? fewRemedies(core, 'P')
    : id === 'cash' ? cashRemedies(core)
    : id === 'away' ? awayRemedies(core)
    : id === 'scout' ? scoutRemedies(core)
    : id === 'fa' ? faRemedies(core)
    : id === 'beat' ? beatRemedies(core, todoId)
    : [];
  return list.length > REMEDY_MAX ? [...list.slice(0, REMEDY_MAX - 1), list[list.length - 1]] : list;
}

/** 조치 시트의 "지금:" 줄 — 현재 상태 숫자 */
export function remedyNow(core: Core, todoId: string): string {
  const id = todoId.split('-')[0];
  const t = userTeam(core);
  const p = teamParts(t);
  const act = activeRoster(t);
  switch (id) {
    case 'hurt':
    case 'injury': {
      const pl = injuryPlan(core);
      return `${pl.hurt.map((h) => `${h.name} ${h.injury}경기 결장`).join(' · ')} · 타선 ${p.bat} · 선발 ${p.rot}`;
    }
    case 'fix':
      return `타선 ${p.bat} · 수비 ${p.def} · 선발 ${p.rot} · 불펜 ${p.pen}`;
    case 'pen': {
      const l = bullpenLoad(t);
      return `등판 가능 ${l.rested}/${l.arms}명 · 이틀 이상 연투 ${l.tired2}명 · 1군 ${act.length}/${ROSTER_MAX}`;
    }
    case 'over':
    case 'fewB':
    case 'fewP': {
      const nb = act.filter((x) => x.kind === 'B').length;
      return `1군 ${act.length}/${ROSTER_MAX}명 (타자 ${nb} · 투수 ${act.length - nb}) · 2군 ${farmRoster(t).length}명`;
    }
    case 'cash': {
      const r = runway(core);
      return `현금 ${fmtMoney(core.finance.cash)} · 경기당 ${sgnMoney(r.perGame)}${core.finance.debt > 0 ? ` · 부채 ${fmtMoney(core.finance.debt)}` : ''}`;
    }
    case 'away':
      return `좌석 ${fmtInt(capacityOf(core))}석 · 티켓값 ${core.finance.ticketPrice.toFixed(1)}만 · 현금 ${fmtMoney(core.finance.cash)}`;
    case 'scout':
      return `현금 ${fmtMoney(core.finance.cash)} · 1군 ${act.length}/${ROSTER_MAX}명`;
    case 'fa':
      return `남은 경기 ${core.schedule.length - core.day} · 현금 ${fmtMoney(core.finance.cash)}`;
    case 'beat':
      return beatImpact(core, beatKind(todoId));
  }
  return '';
}

/** 조치를 실행한다. 화면 이동·닫기·그대로 두기는 core 를 건드리지 않는다 (화면이 처리) */
export function applyRemedy(core: Core, r: Remedy): Res {
  const a = r.run;
  switch (a.t) {
    case 'sub':
      return { core: mutTeam(core, (t) => void subHurtMut(t)) };
    case 'callupSub':
      return applyCallupSub(core, a.pid, a.down);
    case 'fixAll':
      return { core: mutTeam(core, (t) => void applyFixes(t)) };
    case 'callup':
      return chain(core, [...(a.down ? [(c: Core) => sendDown(c, a.down!)] : []), (c) => callUp(c, a.pid)]);
    case 'sign':
      return signPlayer(core, a.pid);
    case 'down':
      return sendDown(core, a.pid);
    case 'release':
      return releasePlayer(core, a.pid);
    case 'price': {
      const next = setTicketPrice(core, a.value);
      return next === core ? { core, error: '티켓값이 이미 그 값입니다' } : { core: next };
    }
    case 'borrow':
      return borrow(core);
    case 'seats':
      return upgradeFacility(core, 'seats');
    case 'penStyle': {
      // TODO: store 에 setPenStyle 이 생기면 그 액션을 쓴다
      const next = structuredClone(core);
      (next.campaign as { penStyle?: string }).penStyle = 'balance';
      return { core: next };
    }
    default:
      return { core };
  }
}
