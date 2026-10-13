// 2군 자동 운영과 2군 사건 (docs/IDEA_BANK.md B절).
// 유저 방침: 2군 관리는 웬만하면 자동, 유저는 결정할 만한 순간에만 불려 나온다.
// - farmDailyMut: 매 경기 후 2군 코치가 하는 일 (부상 대체 콜업·복귀, 벤치에서 썩는 유망주 2군행)
// - FARM_CARDS / drawFarmEvent: 사건 7장. 일반 카드와 별도 예산(시즌 FARM_EVENT_MAX 장, 서로 FARM_EVENT_GAP 경기)
// 이 파일은 events.ts 를 import 하지 않는다 (events.ts 가 이 파일을 쓴다).
import type { BatPos, Buff, CharId, Core, EventCard, Player, Team } from './types';
import { clamp, pick, type Rng } from './rng';
import { calcOvr } from './ratings';
import { fixLineup, slotValue } from './lineup';
import { PEN_OVER_KEY, bullpenLoad } from './fixes';
import { FARM_CAP, FARM_LOCK, FARM_MAX, MIN_BATTERS, MIN_PITCHERS, ROSTER_MAX, SVC_YEARS, activeRoster, farmGrow, farmRoster, userTeam } from './economy';
import { fmtAvg, fmtEra, fmtMoney } from './format';
import { memoAdd, memoGet, memoNum, memoSet } from './memo';
import { CARD_LINES, CHARACTERS, FARM_COACH_LINE } from './story';
import { POS_NAME } from './script';
import { addNews, marketSalary } from './season';
import { hintMut } from './campaign';
import { svcSalary, svcYearAt } from './contract';
import { batZero, pitZero } from './generate';

export const FARM_EVENT_MAX = 3; // 2군 사건: 시즌 최대 장수 (일반 카드 예산과 별도)
export const FARM_EVENT_GAP = 10; // 2군 사건끼리 최소 경기 수
export const FARM_COACH = '2군 코치: '; // 자동 운영이 남기는 소식의 머리말 (scripts 가 이걸로 센다)

/** 튜닝 수치 (사건의 숫자는 전부 여기) */
export const FARM_N = {
  subInjury: 3, // 이 경기 수 이상 결장하는 부상에만 대체 선수를 올린다
  benchDays: 12, // 벤치에서 이만큼 연속으로 주전이 아니면 2군행
  benchRoom: 6, // 잠재력까지 여지가 이만큼 남은 25세 이하만
  benchAge: 25,
  readyGap: 3, // 콜업 준비 완료: 1군 주전 OVR − 이 값 이상
  readyWait: 24, // "한 달 더": 이 경기 수 뒤 다시 보고
  hypeAvg: 0.34, hypeAb: 60, hypeEra: 2.5, hypeOuts: 90, // 퓨처스 폭격 기준 (타율·타수 / 평균자책·아웃 수)
  hypeGap: 5, hypeSat: 4, hypeWaitSat: -3, hypeGames: 12,
  hotAvg: 0.35, hotOps: 0.9, hotAb: 10, hotEra: 2.5, hotOuts: 9, // 대체 선수의 맹활약 기준 (콜업 이후)
  hotStar: 5, hotBump: 2, hotBackSat: -2,
  armyDay: 60, armyMin: 22, armyMax: 26, armySeasons: 2, armyLo: 0.3, armyHi: 0.5, armyAwayMax: 1,
  convPot: 68, convAge: 23, convGap: 5, convHolderAge: 28, convWeak: 8, convPen: 6, convGames: 40,
  painAge: 25, painGames: 12, painAb: 30, painAvg: 0.2, painOuts: 30, painEra: 6.5, painFix: 12, painGrow: 1.5,
  coachDay: 12, coachCost: 20000, coachGrow: 0.08,
};
const F = FARM_N;

export const farmAutoOn = (core: Pick<Core, 'campaign'>): boolean => core.campaign.farmAuto !== false;

/** 2군 자동 운영 켜기/끄기 */
export function setFarmAuto(core0: Core, on: boolean): Core {
  if (farmAutoOn(core0) === on) return core0;
  const core = structuredClone(core0);
  core.campaign.farmAuto = on;
  addNews(core, on ? '2군 운영을 2군 코치에게 맡겼습니다' : '2군 운영을 직접 챙기기로 했습니다', 'info');
  return core;
}

const posKo = (pos: string): string => POS_NAME[pos] ?? pos;
const sgn = (v: number) => (v > 0 ? `+${v}` : v < 0 ? `−${-v}` : '±0');
const pctTxt = (v: number) => `${Math.round(v * 100)}%`;
const sat = (core: Core, d: number) => (core.fanSat = clamp(Math.round((core.fanSat + d) * 10) / 10, 0, 100));
const lockLeft = (core: Core, p: Player) => (p.farmUntil ? Math.max(0, p.farmUntil - core.day) : 0);
const keySet = (t: Team) => new Set([...t.lineup.map((s) => s.pid), ...t.rotation, ...(t.closer ? [t.closer] : []), ...t.bullpen.slice(0, 3)]);
const isPit = (pos: string) => pos === 'SP' || pos === 'RP' || pos === 'CP';
const era9 = (er: number, outs: number) => (outs > 0 ? (er * 27) / outs : 99);

/** 그 선수가 올라가면 밀어낼 1군 주전: 타자는 제 포지션, 선발은 로테이션 최약, 불펜·마무리는 필승조 최약 */
export function starterFor(t: Team, k: Player): Player | undefined {
  const byId = new Map(t.roster.map((p) => [p.id, p]));
  if (k.kind === 'B') return byId.get(t.lineup.find((s) => s.pos === k.pos)?.pid ?? '');
  const ids = k.pos === 'SP' ? t.rotation : [...t.bullpen.slice(0, 3), ...(t.closer ? [t.closer] : [])];
  return ids.map((id) => byId.get(id)).filter((p): p is Player => !!p && p.id !== k.id).sort((a, b) => a.ovr - b.ovr)[0];
}

/** 1군이 가득일 때 대신 내려갈 선수: 같은 종류의 가장 약한 벤치(타자)·추격조(투수). 부상자·부상 대체 선수는 제외 */
function benchOut(t: Team, kind: 'B' | 'P', keep: string[] = []): Player | null {
  const used = keySet(t);
  return activeRoster(t).filter((p) => p.kind === kind && !used.has(p.id) && !keep.includes(p.id) && p.injury === 0 && !p.subFor).sort((a, b) => a.ovr - b.ovr || b.age - a.age)[0] ?? null;
}

/** 주전 자리의 대안: 그 선수가 빠지면 들어갈 건강한 벤치 */
function altFor(t: Team, p: Player): Player | null {
  const used = keySet(t);
  const cand = activeRoster(t).filter((x) => x.kind === p.kind && x.id !== p.id && x.injury === 0 && !(used.has(x.id) && (p.kind === 'B' || t.rotation.includes(x.id) || t.closer === x.id)));
  if (p.kind === 'B') {
    const pos = (t.lineup.find((s) => s.pid === p.id)?.pos ?? p.pos) as BatPos;
    return cand.filter((x) => !t.lineup.some((s) => s.pid === x.id)).sort((a, b) => slotValue(b, pos) - slotValue(a, pos))[0] ?? null;
  }
  return cand.sort((a, b) => b.ovr - a.ovr)[0] ?? null;
}

const totalBases = (p: Player) => p.bat.h + p.bat.d2 + 2 * p.bat.d3 + 3 * p.bat.hr;

/** 콜업 시점의 기록을 적어 둔다 (그 뒤 성적 = 지금 − 이 값). 시즌 메모 */
export function markUpMut(core: Core, p: Player): void {
  memoSet(core, `up-${p.id}`, [core.day, p.bat.h, p.bat.ab, p.pit.er, p.pit.outs, p.bat.bb, totalBases(p)].join(','));
}

/** 이번 시즌 콜업된 뒤의 1군 성적. 콜업된 적이 없으면 null */
export function sinceUp(core: Core, p: Player): { days: number; h: number; ab: number; er: number; outs: number; ops: number } | null {
  const v = memoGet(core, `up-${p.id}`);
  if (!v) return null;
  const [d, h0, ab0, er, outs, bb0 = 0, tb0 = 0] = v.split(',').map(Number);
  const h = p.bat.h - h0;
  const ab = p.bat.ab - ab0;
  const bb = p.bat.bb - bb0;
  const ops = ab > 0 ? (h + bb) / (ab + bb) + (totalBases(p) - tb0) / ab : 0;
  return { days: core.day - d, h, ab, er: p.pit.er - er, outs: p.pit.outs - outs, ops };
}

/** k 를 cur 의 자리에 세운다 (2군이면 등록도 함께) */
function promoteMut(core: Core, t: Team, k: Player, cur: Player | undefined): void {
  if (k.farm) markUpMut(core, k);
  delete k.farm;
  delete k.farmUntil;
  if (k.kind === 'B') {
    const slot = cur ? t.lineup.find((s) => s.pid === cur.id) : undefined;
    const mine = t.lineup.find((s) => s.pid === k.id);
    if (slot && mine) [slot.pid, mine.pid] = [mine.pid, slot.pid];
    else if (slot) slot.pid = k.id;
  } else {
    t.bullpen = t.bullpen.filter((id) => id !== k.id);
    if (cur && t.rotation.includes(cur.id)) {
      t.rotation[t.rotation.indexOf(cur.id)] = k.id;
      t.bullpen.push(cur.id);
    } else if (cur && t.closer === cur.id) {
      t.closer = k.id;
      t.bullpen.unshift(cur.id);
    } else t.bullpen.unshift(k.id);
  }
  fixLineup(t);
}

function demoteMut(core: Core, t: Team, p: Player, lock: boolean): void {
  p.farm = true;
  delete p.tired;
  delete p.subFor;
  if (lock) p.farmUntil = core.day + FARM_LOCK;
  else delete p.farmUntil;
  fixLineup(t);
}

const say = (core: Core, notes: string[], text: string, tone: 'good' | 'bad' | 'info' = 'info') => {
  notes.push(text);
  addNews(core, text, tone);
};

/** 최소 인원이 깨지면 2군에서 채운다 */
function refillMinMut(core: Core, notes: string[]): void {
  const t = userTeam(core);
  for (const [kind, min] of [['B', MIN_BATTERS], ['P', MIN_PITCHERS]] as const) {
    for (let g = 0; g < 4 && activeRoster(t).filter((p) => p.kind === kind).length < min; g++) {
      const k = farmRoster(t).filter((p) => p.kind === kind && p.injury === 0).sort((a, b) => b.ovr - a.ovr)[0];
      if (!k) break;
      promoteMut(core, t, k, undefined);
      say(core, notes, `${FARM_COACH}1군 인원이 모자라 ${k.name} 콜업`);
    }
  }
}

/** 입대: 로스터·연봉에서 빠져 campaign.away 로 간다 */
function enlistMut(core: Core, p: Player, notes: string[]): void {
  const t = userTeam(core);
  t.roster = t.roster.filter((x) => x.id !== p.id);
  delete p.farm;
  delete p.farmUntil;
  delete p.farmStat;
  delete p.tired;
  delete p.subFor;
  delete p.armyDue;
  unshiftPosMut(p);
  p.injury = 0;
  p.served = true;
  p.away = { until: core.season + F.armySeasons, kind: 'army' };
  (core.campaign.away ??= []).push(p);
  fixLineup(t);
  say(core, notes, `입대: ${p.name} — ${p.away.until}시즌 개막에 돌아옵니다`);
  refillMinMut(core, notes);
}

/** 전향 페널티 해소 (수비 복구) */
function unshiftPosMut(p: Player): void {
  if (!p.posShift) return;
  p.def = clamp(p.def + p.posShift.pen, 20, 99);
  delete p.posShift;
  p.ovr = calcOvr(p);
  p.pot = Math.max(p.pot, p.ovr);
}

function grow(p: Player, rng: Rng, n: number): void {
  const ks = p.kind === 'B' ? (['con', 'pow', 'eye', 'spd', 'def'] as const) : (['stf', 'ctl', 'sta'] as const);
  for (let i = 0; i < n; i++) {
    const k = pick(rng, ks as unknown as ('con' | 'pow' | 'eye' | 'spd' | 'def' | 'stf' | 'ctl' | 'sta')[]);
    p[k] = clamp(p[k] + 1, 20, 99);
  }
  p.ovr = calcOvr(p);
  p.pot = Math.max(p.pot, p.ovr);
}

/** 새 시즌 개막: 전향 페널티를 풀고, 전역한 선수가 돌아온다 (mutate, nextSeason 에서 호출). 반환 = 돌아온 인원 */
export function seasonTurnFarmMut(core: Core, rng: Rng): number {
  const t = userTeam(core);
  for (const p of t.roster) unshiftPosMut(p);
  const away = core.campaign.away ?? [];
  const back = away.filter((p) => (p.away?.until ?? 0) <= core.season);
  if (!back.length) return 0;
  core.campaign.away = away.filter((p) => !back.includes(p));
  for (const p of back) {
    const before = p.ovr;
    p.age += F.armySeasons;
    const target = p.ovr + Math.round(Math.max(0, p.pot - p.ovr) * (F.armyLo + rng() * (F.armyHi - F.armyLo)));
    for (let g = 0; g < 200 && p.ovr < target; g++) grow(p, rng, 1);
    p.salary = marketSalary(p, core.season);
    const yr = svcYearAt(p, core.season);
    if (yr !== null && yr <= SVC_YEARS) p.salary = svcSalary(p.salary, yr);
    else delete p.svc;
    p.bat = batZero();
    p.pit = pitZero();
    delete p.away;
    delete p.rookie;
    if (farmRoster(t).length < FARM_MAX || activeRoster(t).length >= ROSTER_MAX) p.farm = true;
    t.roster.push(p);
    addNews(core, `전역: ${p.name} 복귀 (${p.age}세 · OVR ${before} → ${p.ovr}) — ${p.farm ? '2군 합류' : '1군 합류'}`, 'good');
  }
  fixLineup(t);
  return back.length;
}

/** 성장 확률 보정: 인스트럭터(2군 포지션군 +%p) · 믿고 쓰는 선수(×) */
export function growBonus(core: { campaign?: Core['campaign']; day?: number }, p: Player): { add: number; mult: number } {
  const o = { add: 0, mult: 1 };
  for (const b of core.campaign?.buffs ?? []) {
    if ((core.day ?? 0) >= b.until) continue;
    if (b.kind === 'farmGrow' && p.farm && b.pid === p.kind) o.add += b.value;
    else if (b.kind === 'grow' && b.pid === p.id) o.mult *= b.value;
  }
  return o;
}

// ───────── 2군 정원: 지명 직전의 자동 방출 ─────────

/** 2군이 가득일 때 방출 후보: 가장 나이 많고 여지 없는 2군 선수 (이번 드래프트 지명자는 제외) */
export function farmCutCandidate(core: Core): Player | null {
  const fresh = new Set((core.draft?.log ?? []).map((l) => l.pid));
  const v = (p: Player) => p.age - Math.max(0, p.pot - p.ovr) * 0.5 + (p.pot <= p.ovr ? 10 : 0);
  return farmRoster(userTeam(core)).filter((p) => !fresh.has(p.id)).sort((a, b) => v(b) - v(a) || a.ovr - b.ovr)[0] ?? null;
}

/** 지명 자리를 만들기 위한 자동 방출 (위약금 없음, mutate). 방출한 선수 또는 null */
export function farmCutMut(core: Core): Player | null {
  const p = farmCutCandidate(core);
  if (!p) return null;
  const t = userTeam(core);
  t.roster = t.roster.filter((x) => x.id !== p.id);
  for (const k of ['since', 'svc', 'ask', 'tired', 'farm', 'farmUntil', 'farmStat', 'subFor', 'armyDue'] as const) delete p[k];
  unshiftPosMut(p);
  core.freeAgents.push(p);
  addNews(core, `${FARM_COACH}지명 자리를 위해 ${p.name}(${p.age}세 · OVR ${p.ovr}) 방출`, 'info');
  return p;
}

// ───────── 매 경기 후: 2군 코치의 하루 ─────────

const pending = (core: Core): { sub: string; orig: string; day: number } | null => {
  const v = memoGet(core, 'b3');
  if (!v) return null;
  const [sub, orig, day] = v.split('|');
  return { sub, orig, day: Number(day) };
};

function isHot(core: Core, p: Player): boolean {
  const s = sinceUp(core, p);
  if (!s) return false;
  return p.kind === 'B' ? s.ab >= F.hotAb && (s.h / s.ab >= F.hotAvg || s.ops >= F.hotOps) : s.outs >= F.hotOuts && era9(s.er, s.outs) <= F.hotEra;
}

/** 부상으로 그 자리의 뎁스가 비었는가 */
function depthEmpty(t: Team, inj: Player): boolean {
  const act = activeRoster(t).filter((p) => p.id !== inj.id && p.injury === 0);
  if (inj.kind === 'B') {
    if (!t.lineup.some((s) => s.pid === inj.id)) return false;
    const inLu = new Set(t.lineup.map((s) => s.pid));
    return !act.some((p) => p.kind === 'B' && !inLu.has(p.id) && (inj.pos === 'DH' || p.pos === inj.pos));
  }
  if (t.rotation.includes(inj.id)) return !act.some((p) => p.pos === 'SP' && !t.rotation.includes(p.id));
  if (t.closer !== inj.id && !t.bullpen.slice(0, 4).includes(inj.id)) return false;
  return act.filter((p) => p.kind === 'P' && !t.rotation.includes(p.id)).length < 5;
}

export const SHUTTLE_OVR_GAP = 6; // 셔틀: 올라올 팔이 내려갈 팔보다 이만큼 넘게 처지면 하지 않는다 (10경기를 그 팔로 버텨야 한다)
const SHUTTLE_WEEK = 6; // 주당 1회

/** 셔틀로 올릴 수 있는 2군 구원: 선발 제외, 건강하고 재등록 잠금이 없는 팔 (OVR 순) */
export function shuttleArms(core: Core): Player[] {
  return farmRoster(userTeam(core)).filter((p) => p.kind === 'P' && p.pos !== 'SP' && p.injury === 0 && lockLeft(core, p) === 0).sort((a, b) => b.ovr - a.ovr);
}

/**
 * 2군 셔틀: 1군 불펜의 절반 이상이 이틀 연투면 가장 지친(그리고 OVR 낮은) 추격조 1명을 내리고 2군 최고 구원을 올린다.
 * 필승조(불펜 상위 2명)와 마무리는 대상이 아니다. 내려간 팔은 재등록 잠금을 그대로 받는다 — 그게 셔틀의 대가.
 */
function shuttleMut(core: Core, notes: string[]): void {
  const t = userTeam(core);
  const load = bullpenLoad(t);
  if (!load.arms || load.tired2 * 2 < load.arms) return;
  const week = String(Math.floor(core.day / SHUTTLE_WEEK));
  if (memoGet(core, 'shuttle') === week) return;
  const up = shuttleArms(core)[0];
  if (!up) return;
  const byId = new Map(t.roster.map((p) => [p.id, p]));
  const down = t.bullpen
    .slice(2)
    .map((id) => byId.get(id))
    .filter((p): p is Player => !!p && p.injury === 0 && !p.subFor && (p.tired ?? 0) >= 1)
    .sort((a, b) => (b.tired ?? 0) - (a.tired ?? 0) || a.ovr - b.ovr)[0];
  if (!down || up.ovr < down.ovr - SHUTTLE_OVR_GAP) return;
  markUpMut(core, up);
  delete up.farm;
  delete up.farmUntil;
  t.bullpen[t.bullpen.indexOf(down.id)] = up.id; // 내려간 팔의 자리를 그대로 받는다
  demoteMut(core, t, down, true);
  memoSet(core, 'shuttle', week);
  say(core, notes, `${FARM_COACH}지친 불펜 교대 — ${down.name} ↓ ${up.name} ↑`);
}

/**
 * 매 경기 후 (advanceDay 끝, mutate). 규칙으로 정해진 일(전향 해소·미룬 입대)은 항상,
 * 2군 코치의 일(부상 대체 콜업·복귀, 벤치 유망주 2군행)은 자동 운영이 켜져 있을 때만 한다.
 */
export function farmDailyMut(core: Core, notes: string[]): void {
  const t = userTeam(core);
  for (const p of t.roster) {
    if (p.posShift && core.day >= p.posShift.until) {
      unshiftPosMut(p);
      say(core, notes, `${p.name}, ${posKo(p.pos)} 수비가 몸에 붙었습니다 (OVR ${p.ovr})`, 'good');
    }
  }
  if (core.day >= F.armyDay) {
    for (const p of t.roster.filter((x) => x.armyDue !== undefined && x.armyDue <= core.season)) enlistMut(core, p, notes);
  }
  // 불펜 과부하가 이어진 경기 수 (하루 쉬면 하나 줄어든다 — 'arm' 사건과 브리핑이 읽는다)
  const load = bullpenLoad(t);
  if (load.label === '과부하') memoAdd(core, PEN_OVER_KEY);
  else if (memoNum(core, PEN_OVER_KEY) > 0) memoAdd(core, PEN_OVER_KEY, -1);
  if (!farmAutoOn(core)) return;
  shuttleMut(core, notes);

  // ── 부상자가 돌아오면 대체 선수는 2군으로 (맹활약 중이면 사건 B3 로 넘긴다) ──
  const pend = pending(core);
  for (const p of t.roster.filter((x) => x.subFor && !x.farm)) {
    const orig = t.roster.find((x) => x.id === p.subFor);
    if (orig && !orig.farm && orig.injury > 0) continue;
    if (p.injury > 0) continue; // 부상자는 내릴 수 없다
    const asked = pend?.sub === p.id;
    if (!asked && orig && !orig.farm && isHot(core, p) && farmBudgetOk(core)) {
      memoSet(core, 'b3', `${p.id}|${orig.id}|${core.day}`);
      continue;
    }
    if (asked && pend!.day === core.day) continue;
    if (farmRoster(t).length >= FARM_MAX) {
      delete p.subFor;
      continue;
    }
    demoteMut(core, t, p, false);
    say(core, notes, `${FARM_COACH}${orig ? `${orig.name} 복귀 — ` : ''}대체 선수 ${p.name} 2군 복귀`);
  }

  // ── 부상 공백에 콜업 ──
  for (const inj of activeRoster(t).filter((p) => p.injury >= F.subInjury)) {
    if (t.roster.some((p) => p.subFor === inj.id) || !depthEmpty(t, inj)) continue;
    const pool = farmRoster(t).filter((p) => p.kind === inj.kind && p.injury === 0 && lockLeft(core, p) === 0);
    const same = pool.filter((p) => p.pos === inj.pos).sort((a, b) => b.ovr - a.ovr);
    const pos = (t.lineup.find((s) => s.pid === inj.id)?.pos ?? 'DH') as BatPos;
    const any = pool.slice().sort((a, b) => (inj.kind === 'B' ? slotValue(b, pos) - slotValue(a, pos) : b.ovr - a.ovr));
    const k = same[0] ?? any[0];
    if (!k) continue;
    let tail = '';
    if (activeRoster(t).length >= ROSTER_MAX) {
      const out = benchOut(t, k.kind);
      if (!out) continue;
      demoteMut(core, t, out, false);
      tail = ` (${out.name} 2군행)`;
    }
    markUpMut(core, k);
    delete k.farm;
    delete k.farmUntil;
    k.subFor = inj.id;
    fixLineup(t);
    say(core, notes, `${FARM_COACH}${inj.name} 부상(${inj.injury}경기) 공백에 ${k.name}(${posKo(k.pos)} OVR ${k.ovr}) 콜업${tail}`);
  }

  // ── 벤치에서 썩는 유망주는 2군으로 (하루 한 명) ──
  const inLu = new Set(t.lineup.map((s) => s.pid));
  let nb = activeRoster(t).filter((p) => p.kind === 'B').length;
  let sent = false;
  for (const p of activeRoster(t)) {
    if (p.kind !== 'B' || p.age > F.benchAge || p.pot - p.ovr < F.benchRoom || p.ovr >= FARM_CAP - 1 || p.subFor) continue;
    const key = `bn-${p.id}`;
    if (inLu.has(p.id)) {
      if (memoGet(core, key) !== undefined) memoSet(core, key, 0);
      continue;
    }
    const n = memoAdd(core, key);
    if (sent || n < F.benchDays || p.injury > 0 || nb < MIN_BATTERS + 2 || farmRoster(t).length >= FARM_MAX) continue;
    demoteMut(core, t, p, true);
    memoSet(core, key, 0);
    nb--;
    sent = true;
    say(core, notes, `${FARM_COACH}${p.name} 2군행 — 벤치에서 ${F.benchDays}경기, 2군에서 실전을 뜁니다 (주당 성장 확률 ${pctTxt(farmGrow(core.facilities))})`);
  }
}

// ───────── 사건 7장 ─────────

export interface FarmCardDef {
  id: string;
  prio: number;
  max?: number; // 시즌당 최대 횟수 (기본 1)
  when: (core: Core) => boolean;
  make: (core: Core, rng: Rng) => EventCard | null;
  resolve: (core: Core, idx: number, card: EventCard, rng: Rng) => string;
}

function mk(id: string, lineKey: string, o: Omit<EventCard, 'id' | 'who' | 'line'> & { who?: CharId; line?: string }): EventCard {
  const l = CARD_LINES[lineKey];
  return { id, ...o, who: o.who ?? l?.who ?? 'farm', line: o.line ?? l?.line ?? '' };
}
const find = (core: Core, pid?: string) => (pid ? userTeam(core).roster.find((p) => p.id === pid) : undefined);
const addBuff = (core: Core, b: Buff) => core.campaign.buffs.push(b);
const info = (p: Player) => `${p.name}(${posKo(p.pos)}, ${p.age}세, OVR ${p.ovr} · 잠재 ${p.pot})`;
const full = (t: Team) => activeRoster(t).length >= ROSTER_MAX;
const farmLine = (p: Player) => (p.kind === 'B' ? `${fmtAvg(p.farmStat?.h ?? 0, p.farmStat?.ab ?? 0)} ${p.farmStat?.hr ?? 0}홈런 (${p.farmStat?.ab ?? 0}타수)` : `평균자책 ${fmtEra(p.farmStat?.er ?? 0, p.farmStat?.outs ?? 0)} (${Math.floor((p.farmStat?.outs ?? 0) / 3)}이닝)`);

/** B1: 2군 상한에 닿았고 1군 주전과 겨룰 만한 선수 */
export function readyCase(core: Core): { k: Player; cur: Player; down: Player | null } | null {
  const t = userTeam(core);
  for (const k of farmRoster(t).sort((a, b) => b.ovr - a.ovr)) {
    if (k.ovr < FARM_CAP || k.injury > 0 || lockLeft(core, k) > 0 || memoNum(core, `b1-${k.id}`, -1) > core.day) continue;
    const cur = starterFor(t, k);
    if (!cur || k.ovr < cur.ovr - F.readyGap) continue;
    return { k, cur, down: full(t) ? benchOut(t, k.kind, [cur.id]) : null };
  }
  return null;
}

/** B2: 퓨처스 성적은 리그 최상위인데 OVR 은 1군 주전에 한참 못 미치는 선수 */
export function hypeCase(core: Core): { k: Player; cur: Player; down: Player | null } | null {
  const t = userTeam(core);
  for (const k of farmRoster(t)) {
    const s = k.farmStat;
    if (!s || k.injury > 0 || lockLeft(core, k) > 0 || memoGet(core, `b2-${k.id}`)) continue;
    const hot = k.kind === 'B' ? s.ab >= F.hypeAb && s.h / s.ab >= F.hypeAvg : s.outs >= F.hypeOuts && era9(s.er, s.outs) <= F.hypeEra;
    const cur = starterFor(t, k);
    if (!hot || !cur || cur.ovr - k.ovr < F.hypeGap) continue;
    return { k, cur, down: full(t) ? benchOut(t, k.kind, [cur.id]) : null };
  }
  return null;
}

function subCase(core: Core): { sub: Player; orig: Player } | null {
  const pd = pending(core);
  if (!pd || pd.day !== core.day) return null;
  const sub = find(core, pd.sub);
  const orig = find(core, pd.orig);
  return sub && orig && !sub.farm && sub.subFor === orig.id ? { sub, orig } : null;
}

/** B4: 입대 통지 대상 (시즌당 1명) 과 그가 주전일 때의 전력 손실(OVR) */
export function armyCase(core: Core): { p: Player; loss: number; alt: Player | null } | null {
  if (core.day < F.armyDay || memoGet(core, 'army') || (core.campaign.away?.length ?? 0) >= F.armyAwayMax) return null;
  const t = userTeam(core);
  const p = t.roster
    .filter((x) => !x.foreign && x.age >= F.armyMin && x.age <= F.armyMax && !x.served && x.armyDue === undefined && x.injury === 0 && !x.subFor)
    .sort((a, b) => b.pot - a.pot || b.ovr - a.ovr)[0];
  if (!p) return null;
  const key = !p.farm && (t.lineup.some((s) => s.pid === p.id) || t.rotation.includes(p.id) || t.closer === p.id);
  const alt = key ? altFor(t, p) : null;
  return { p, loss: key ? Math.max(0, p.ovr - (alt?.ovr ?? p.ovr - 10)) : 0, alt };
}

/** B5: 주전이 굳건한 포지션의 2군 유망주와, 그가 옮겨 갈 팀의 약점 포지션 */
export function convCase(core: Core): { k: Player; cur: Player; to: BatPos; weak: Player } | null {
  const t = userTeam(core);
  const byId = new Map(t.roster.map((p) => [p.id, p]));
  for (const k of farmRoster(t).sort((a, b) => b.pot - a.pot)) {
    if (k.kind !== 'B' || k.pos === 'C' || k.pos === 'DH' || k.age > F.convAge || k.pot < F.convPot || k.posShift || memoGet(core, `b5-${k.id}`)) continue;
    const cur = byId.get(t.lineup.find((s) => s.pos === k.pos)?.pid ?? '');
    if (!cur || cur.ovr < k.pot - F.convGap || cur.age > F.convHolderAge) continue;
    const weak = t.lineup
      .filter((s) => s.pos !== 'DH' && s.pos !== 'C' && s.pos !== k.pos)
      .map((s) => ({ s, p: byId.get(s.pid) }))
      .filter((x): x is { s: { pid: string; pos: BatPos }; p: Player } => !!x.p)
      .sort((a, b) => a.p.ovr - b.p.ovr)[0];
    if (!weak || weak.p.ovr > k.pot - F.convWeak) continue;
    return { k, cur, to: weak.s.pos, weak: weak.p };
  }
  return null;
}

/** B6: 이번 시즌 콜업돼 주전이 된 25세 이하의 부진 */
export function painCase(core: Core): { p: Player; alt: Player | null; text: string } | null {
  const t = userTeam(core);
  for (const p of activeRoster(t)) {
    if (p.age > F.painAge || p.injury > 0 || p.subFor || memoGet(core, `b6-${p.id}`)) continue;
    const s = sinceUp(core, p);
    if (!s || s.days < F.painGames) continue;
    const bad =
      p.kind === 'B'
        ? t.lineup.some((x) => x.pid === p.id) && s.ab >= F.painAb && s.h / s.ab < F.painAvg
        : (t.rotation.includes(p.id) || t.closer === p.id) && s.outs >= F.painOuts && era9(s.er, s.outs) > F.painEra;
    if (!bad) continue;
    return { p, alt: altFor(t, p), text: p.kind === 'B' ? `${s.ab}타수 ${s.h}안타 ${fmtAvg(s.h, s.ab)}` : `${Math.floor(s.outs / 3)}이닝 평균자책 ${fmtEra(s.er, s.outs)}` };
  }
  return null;
}

const coachCase = (core: Core) => (core.day < F.coachDay ? (core.campaign.retired ?? []).filter((r) => r.season === core.season - 1).slice(-1)[0] ?? null : null);

/** 올리는 선택지의 공통 처리: (가득이면 한 명 내리고) k 를 cur 자리에 */
function swapUpMut(core: Core, k: Player, cur: Player | undefined, downId: string | undefined): void {
  const t = userTeam(core);
  const down = find(core, downId);
  if (down && !down.farm && full(t) && farmRoster(t).length <= FARM_MAX) demoteMut(core, t, down, true);
  promoteMut(core, t, k, cur);
  hintMut(core, k.kind === 'B' ? 'lineup' : 'pitchers');
}
const upDesc = (k: Player, cur: Player, down: Player | null) =>
  `${posKo(cur.kind === 'B' ? k.pos : cur.pos)} 주전 ${cur.name}(OVR ${cur.ovr}) → ${k.name}(OVR ${k.ovr}) · 전력 ${sgn(k.ovr - cur.ovr)} · ${cur.name}은(는) ${cur.kind === 'B' ? '벤치' : '불펜'}로${down ? ` · ${down.name}(OVR ${down.ovr}) 2군행` : ''}`;
const noRoom = (core: Core, down: Player | null) => (full(userTeam(core)) && !down ? '1군이 가득하고 내릴 선수가 없습니다' : undefined);

export const FARM_CARDS: FarmCardDef[] = [
  // ───────── B3 대체 선수의 깜짝 활약 ─────────
  {
    id: 'f-sub',
    prio: 90,
    when: (c) => farmAutoOn(c) && !!subCase(c),
    make: (c) => {
      const x = subCase(c);
      if (!x) return null;
      const { sub, orig } = x;
      const s = sinceUp(c, sub)!;
      const vet = orig.age >= 32;
      const stat = sub.kind === 'B' ? `${s.ab}타수 ${s.h}안타 ${fmtAvg(s.h, s.ab)} · OPS ${s.ops.toFixed(3)}` : `${Math.floor(s.outs / 3)}이닝 평균자책 ${fmtEra(s.er, s.outs)}`;
      return mk(`f-sub|${orig.id}`, vet ? 'fSubVet' : 'fSub', {
        title: '대체 선수의 깜짝 활약',
        icon: '🔥',
        pid: sub.id,
        body: `${orig.name}(${orig.age}세, OVR ${orig.ovr})의 부상 공백에 올라온 ${sub.name}(${sub.age}세, OVR ${sub.ovr})이 ${stat}. 오늘 ${orig.name}이(가) 돌아왔습니다.`,
        choices: [
          { label: '신예를 그대로 쓴다', desc: `${posKo(orig.pos)} OVR ${orig.ovr} → ${sub.ovr} (전력 ${sgn(sub.ovr - orig.ovr)}) · ${sub.name} 스타성 +${F.hotStar} · 능력치 +${F.hotBump} · ${orig.name}은(는) ${orig.kind === 'B' ? '벤치' : '불펜'}로` },
          { label: '원래 주전에게 돌려준다', desc: `${sub.name} 2군 복귀 (재등록 잠금 없음) · 팬 만족 ${sgn(F.hotBackSat)}` },
        ],
      });
    },
    resolve: (c, i, cd, rng) => {
      const t = userTeam(c);
      const sub = find(c, cd.pid);
      const orig = find(c, cd.id.split('|')[1]);
      memoSet(c, 'b3', '');
      if (!sub) return '없던 일이 되었습니다';
      if (i === 0) {
        delete sub.subFor;
        sub.star = clamp(sub.star + F.hotStar, 0, 100);
        grow(sub, rng, F.hotBump);
        promoteMut(c, t, sub, orig);
        hintMut(c, sub.kind === 'B' ? 'lineup' : 'pitchers');
        return `${sub.name}이(가) 자리를 지켰습니다 — OVR ${sub.ovr}`;
      }
      sat(c, F.hotBackSat);
      if (farmRoster(t).length >= FARM_MAX) {
        delete sub.subFor;
        return `${orig?.name ?? '주전'}이(가) 제자리로 — 2군이 가득해 ${sub.name}은(는) 벤치에 남습니다`;
      }
      demoteMut(c, t, sub, false);
      return `${orig?.name ?? '주전'}이(가) 제자리로, ${sub.name}은(는) 2군으로 돌아갔습니다`;
    },
  },
  // ───────── B7 은퇴 선수의 인스트럭터 합류 ─────────
  {
    id: 'f-coach',
    prio: 80,
    when: (c) => !!coachCase(c),
    make: (c) => {
      const r = coachCase(c);
      if (!r) return null;
      const kind = isPit(r.pos) ? 'P' : 'B';
      const n = farmRoster(userTeam(c)).filter((p) => p.kind === kind).length;
      const base = farmGrow(c.facilities);
      return mk(`f-coach|${kind}`, 'fCoach', {
        title: '인스트럭터 합류',
        icon: '🧢',
        line: FARM_COACH_LINE(r.name),
        body: `지난겨울 유니폼을 벗은 ${r.name}(${posKo(r.pos)})이 2군 ${kind === 'P' ? '투수' : '타격'} 인스트럭터를 자청했습니다.`,
        choices: [
          { label: '맡긴다', desc: `인건비 ${fmtMoney(F.coachCost)} (이번 시즌) · 2군 ${kind === 'P' ? '투수' : '타자'} ${n}명의 주당 성장 확률 ${pctTxt(base)} → ${pctTxt(Math.min(1, base + F.coachGrow))}`, disabled: c.finance.cash < F.coachCost ? `현금 부족 (필요 ${fmtMoney(F.coachCost)})` : undefined },
          { label: '사양한다', desc: '변화 없음' },
        ],
      });
    },
    resolve: (c, i, cd) => {
      if (i !== 0) return '정중히 사양했습니다';
      const kind = cd.id.split('|')[1] === 'P' ? 'P' : 'B';
      c.finance.cash -= F.coachCost;
      c.finance.ledger.upkeep += F.coachCost;
      addBuff(c, { kind: 'farmGrow', value: F.coachGrow, until: 9999, label: `인스트럭터: 2군 ${kind === 'P' ? '투수' : '타자'} 성장 +${Math.round(F.coachGrow * 100)}%p`, pid: kind });
      return `2군 구장에 익숙한 등번호가 돌아왔습니다 — 2군 ${kind === 'P' ? '투수' : '타자'} 성장 +${Math.round(F.coachGrow * 100)}%p`;
    },
  },
  // ───────── B6 성장통 ─────────
  {
    id: 'f-pain',
    prio: 70,
    when: (c) => !!painCase(c),
    make: (c) => {
      const x = painCase(c);
      if (!x) return null;
      const { p, alt } = x;
      const loss = alt ? Math.max(0, alt.ovr - p.ovr) : 0;
      const t = userTeam(c);
      return mk('f-pain', 'fPain', {
        title: '성장통',
        icon: '🌧️',
        pid: p.id,
        body: `올해 1군에 올라온 ${info(p)}이 콜업 뒤 ${x.text}.`,
        choices: [
          { label: '믿고 쓴다', desc: `${F.painFix}경기 ${p.kind === 'B' ? '고정 출전' : '보직 유지'} · 그동안 주당 성장 확률 ×${F.painGrow} · ${alt ? `${alt.name}(OVR ${alt.ovr}) 대신 출전 — 전력 ${sgn(-loss)}` : '대안 없음'}` },
          { label: '내린다', desc: `${p.name} 2군행 · ${FARM_LOCK}경기 재등록 불가 · ${alt ? `${alt.name}(OVR ${alt.ovr}) 주전 — 전력 ${sgn(alt.ovr - p.ovr)}` : '빈자리는 감독이 메운다'} · 2군 주당 성장 확률 ${pctTxt(p.ovr >= FARM_CAP ? 0 : farmGrow(c.facilities))}`, disabled: farmRoster(t).length >= FARM_MAX ? '2군이 가득 찼습니다' : undefined },
        ],
      });
    },
    resolve: (c, i, cd) => {
      const p = find(c, cd.pid);
      if (!p) return '없던 일이 되었습니다';
      memoSet(c, `b6-${p.id}`, 1);
      if (i === 0) {
        if (p.kind === 'B') addBuff(c, { kind: 'fixed', value: 1, until: c.day + F.painFix, label: `${p.name} 고정 출전`, pid: p.id });
        addBuff(c, { kind: 'grow', value: F.painGrow, until: c.day + F.painFix, label: `${p.name} 성장 확률 ×${F.painGrow}`, pid: p.id });
        return `${p.name}에게 ${F.painFix}경기를 더 주기로 했습니다`;
      }
      demoteMut(c, userTeam(c), p, true);
      hintMut(c, p.kind === 'B' ? 'lineup' : 'pitchers');
      return `${p.name}을(를) 2군으로 내렸습니다 — ${FARM_LOCK}경기 뒤 다시 올릴 수 있습니다`;
    },
  },
  // ───────── B1 콜업 준비 완료 ─────────
  {
    id: 'f-ready',
    prio: 60,
    max: 2,
    when: (c) => farmAutoOn(c) && !!readyCase(c),
    make: (c) => {
      const x = readyCase(c);
      if (!x) return null;
      const { k, cur, down } = x;
      return mk(`f-ready|${cur.id}|${down?.id ?? ''}`, 'fReady', {
        title: '콜업 준비 완료',
        icon: '📣',
        pid: k.id,
        body: `${info(k)}이 2군 상한(OVR ${FARM_CAP})에 닿았습니다. 퓨처스 ${farmLine(k)}.`,
        choices: [
          { label: '올린다', desc: upDesc(k, cur, down), disabled: noRoom(c, down) },
          { label: '한 달 더', desc: `2군에서는 더 자라지 않습니다 (상한 OVR ${FARM_CAP}) · ${F.readyWait}경기 뒤 다시 보고` },
        ],
      });
    },
    resolve: (c, i, cd) => {
      const k = find(c, cd.pid);
      if (!k) return '없던 일이 되었습니다';
      const [, curId, downId] = cd.id.split('|');
      if (i !== 0) {
        memoSet(c, `b1-${k.id}`, c.day + F.readyWait);
        return `${k.name}은(는) 한 달 더 2군에서 기다립니다`;
      }
      memoSet(c, `b1-${k.id}`, 9999);
      swapUpMut(c, k, find(c, curId), downId);
      return `${k.name} 1군 등록 — 주전으로 나섭니다`;
    },
  },
  // ───────── B5 포지션 전향 ─────────
  {
    id: 'f-conv',
    prio: 50,
    when: (c) => !!convCase(c),
    make: (c) => {
      const x = convCase(c);
      if (!x) return null;
      const { k, cur, to, weak } = x;
      const after = calcOvr({ ...k, def: clamp(k.def - F.convPen, 20, 99) });
      return mk(`f-conv|${to}`, 'fConv', {
        title: '포지션 전향',
        icon: '🧤',
        pid: k.id,
        body: `${info(k)}의 자리에는 ${cur.name}(${cur.age}세, OVR ${cur.ovr})이 버티고 있습니다. 팀에서 가장 약한 자리는 ${posKo(to)}(${weak.name}, OVR ${weak.ovr})입니다.`,
        choices: [
          { label: '전향시킨다', desc: `${k.name} ${posKo(k.pos)} → ${posKo(to)} · ${F.convGames}경기 동안 수비 −${F.convPen} (OVR ${k.ovr} → ${after}) · ${posKo(to)} 뎁스: ${weak.name} ${weak.ovr} / ${k.name} ${after}(잠재 ${k.pot})` },
          { label: '그대로 둔다', desc: `${posKo(k.pos)} 뎁스: ${cur.name} ${cur.ovr} / ${k.name} ${k.ovr}(잠재 ${k.pot}) — 자리가 날 때까지 기다린다` },
        ],
      });
    },
    resolve: (c, i, cd) => {
      const k = find(c, cd.pid);
      if (!k) return '없던 일이 되었습니다';
      memoSet(c, `b5-${k.id}`, 1);
      if (i !== 0) return `${k.name}은(는) 제 포지션에서 기다립니다`;
      const to = cd.id.split('|')[1] as BatPos;
      const pen = Math.min(F.convPen, k.def - 20);
      k.posShift = { from: k.pos, pen, until: c.day + F.convGames };
      k.pos = to;
      k.def -= pen;
      k.ovr = calcOvr(k);
      return `${k.name}, ${posKo(to)} 글러브를 받았습니다 — ${F.convGames}경기 동안 수비 −${pen}`;
    },
  },
  // ───────── B2 퓨처스 폭격 ─────────
  {
    id: 'f-hype',
    prio: 40,
    when: (c) => !!hypeCase(c),
    make: (c) => {
      const x = hypeCase(c);
      if (!x) return null;
      const { k, cur, down } = x;
      return mk(`f-hype|${cur.id}|${down?.id ?? ''}`, 'fHype', {
        title: '퓨처스 폭격',
        icon: '💥',
        pid: k.id,
        body: `${info(k)}이 퓨처스에서 ${farmLine(k)}. 팬 게시판이 "왜 안 올리느냐"로 뒤덮였습니다.`,
        choices: [
          { label: '여론대로 올린다', desc: `팬 만족 ${sgn(F.hypeSat)} · ${k.name} ${k.kind === 'B' ? `${F.hypeGames}경기 고정 출전` : `${cur.name}의 보직`} · ${upDesc(k, cur, down)}`, disabled: noRoom(c, down) },
          { label: '기다린다', desc: `팬 만족 ${sgn(F.hypeWaitSat)} · 2군 주당 성장 확률 ${pctTxt(farmGrow(c.facilities))} 유지` },
        ],
      });
    },
    resolve: (c, i, cd) => {
      const k = find(c, cd.pid);
      if (!k) return '없던 일이 되었습니다';
      memoSet(c, `b2-${k.id}`, 1);
      if (i !== 0) {
        sat(c, F.hypeWaitSat);
        return `${k.name}은(는) 2군에서 더 익힙니다 — 게시판은 한동안 시끄럽습니다`;
      }
      const [, curId, downId] = cd.id.split('|');
      const cur = find(c, curId);
      sat(c, F.hypeSat);
      swapUpMut(c, k, cur, downId);
      if (k.kind === 'B' && cur) {
        memoSet(c, `fx-${k.id}`, cur.id); // 고정 출전이 끝나면 원래 주전이 돌아온다
        addBuff(c, { kind: 'fixed', value: 1, until: c.day + F.hypeGames, label: `${k.name} 고정 출전`, pid: k.id });
      }
      return `${k.name} 1군 데뷔 — 관중석이 그의 이름을 부릅니다`;
    },
  },
  // ───────── B4 입대 통지 ─────────
  {
    id: 'f-army',
    prio: 30,
    when: (c) => !!armyCase(c),
    make: (c) => {
      const x = armyCase(c);
      if (!x) return null;
      const { p, loss, alt } = x;
      const room = Math.max(0, p.pot - p.ovr);
      const back = c.season + F.armySeasons;
      const cost = p.farm ? '1군 전력 변화 없음' : loss > 0 || alt ? `${posKo(p.pos)} 주전 공백: OVR ${p.ovr} → ${alt?.ovr ?? '?'} (전력 ${sgn(-loss)})` : '1군 전력 변화 없음 (벤치)';
      const gain = `복귀 때 OVR +${Math.round(room * F.armyLo)}~${Math.round(room * F.armyHi)} 예상`;
      return mk('f-army', 'fArmy', {
        title: '입대 통지',
        icon: '🪖',
        pid: p.id,
        body: `${info(p)}에게 입영 통지서가 나왔습니다.${p.farm ? ' 지금은 2군에 있습니다.' : ''}`,
        choices: [
          { label: '지금 보낸다', desc: `오늘부터 이탈 · ${back}시즌 개막 복귀 (${p.age + F.armySeasons}세) · 그동안 연봉 없음 · ${gain} · ${cost}` },
          { label: '한 시즌 미룬다', desc: `내년 ${F.armyDay}경기 뒤 선택 없이 입대 · ${back + 1}시즌 개막 복귀 (${p.age + 1 + F.armySeasons}세) · 올해는 그대로 뛴다` },
        ],
      });
    },
    resolve: (c, i, cd) => {
      const p = find(c, cd.pid);
      memoSet(c, 'army', 1);
      if (!p) return '없던 일이 되었습니다';
      if (i === 0) {
        const notes: string[] = [];
        enlistMut(c, p, notes);
        hintMut(c, p.kind === 'B' ? 'lineup' : 'pitchers');
        return `${p.name}이(가) 머리를 깎았습니다 — ${p.away?.until}시즌에 돌아옵니다`;
      }
      p.armyDue = c.season + 1;
      return `${p.name}의 입대를 한 해 미뤘습니다 — 내년에는 미룰 수 없습니다`;
    },
  },
];

const FARM_BY_PRIO = () => FARM_CARDS.slice().sort((a, b) => b.prio - a.prio);
export const farmCardDef = (baseId: string): FarmCardDef | undefined => FARM_CARDS.find((d) => d.id === baseId);

/** 2군 사건 예산: 시즌 FARM_EVENT_MAX 장, 서로 FARM_EVENT_GAP 경기 */
export function farmBudgetOk(core: Core): boolean {
  return memoNum(core, 'fevN') < FARM_EVENT_MAX && core.day - memoNum(core, 'fevDay', -99) >= FARM_EVENT_GAP;
}

/** 매 경기 후: 일반 카드가 없는 날, 조건이 맞는 2군 사건 1장을 campaign.event 에 둔다. 해당 없으면 원본 반환 */
export function drawFarmEvent(core0: Core, rng: Rng): Core {
  if (core0.phase !== 'season' || core0.campaign.event || core0.day >= core0.schedule.length) return core0;
  if (!farmBudgetOk(core0) || memoNum(core0, 'evDay', -99) === core0.day) return core0;
  for (const d of FARM_BY_PRIO()) {
    if (memoNum(core0, `fc-${d.id}`) >= (d.max ?? 1) || !d.when(core0)) continue;
    const core = structuredClone(core0);
    const cd = d.make(core, rng);
    if (!cd) continue;
    core.campaign.event = cd;
    memoAdd(core, 'fevN');
    memoAdd(core, `fc-${d.id}`);
    memoSet(core, 'fevDay', core.day);
    const who = cd.who && cd.who !== 'player' ? `${CHARACTERS[cd.who].name} ${CHARACTERS[cd.who].title} — ` : '';
    addNews(core, `${cd.icon} ${who}${cd.title}`, 'info');
    return core;
  }
  return core0;
}
