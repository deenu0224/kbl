import { josa } from './format';
// 2군 자동 운영과 2군 사건 (docs/IDEA_BANK.md B절).
// 유저 방침: 2군 관리는 웬만하면 자동, 유저는 결정할 만한 순간에만 불려 나온다.
// - farmDailyMut: 매 경기 후 2군 코치가 하는 일 (부상 대체 콜업·복귀, 벤치에서 썩는 유망주 2군행)
// - FARM_CARDS / drawFarmEvent: 사건 7장. 일반 카드와 별도 예산(시즌 FARM_EVENT_MAX 장, 서로 FARM_EVENT_GAP 경기)
// 이 파일은 events.ts 를 import 하지 않는다 (events.ts 가 이 파일을 쓴다).
import type { BatPos, Buff, CharId, Core, EventCard, Player, Team } from './types';
import { clamp, pick, type Rng } from './rng';
import { calcOvr } from './ratings';
import { fixLineup, slotNewcomer, slotValue } from './lineup';
import { PEN_OVER_KEY, PEN_OVER_SUM, bullpenLoad } from './fixes';
import { FARM_CAP, FARM_LOCK, farmMax, IL_AUTO, IL_AUTO_BAN, IL_MIN, MIN_BATTERS, MIN_PITCHERS, ROSTER_MAX, SVC_YEARS, activeRoster, farmGrow, farmRoster, rehabRoster, userTeam } from './economy';
import { fmtAvg, fmtEra, fmtMoney } from './format';
import { cardRested, markCardMut, memoAdd, memoGet, memoNum, memoSet } from './memo';
import { CARD_LINES, CHARACTERS, FARM_COACH_LINE } from './story';
import { POS_NAME } from './script';
import { addNews, marketSalary } from './season';
import { hintMut } from './campaign';
import { dayAt } from './league';
import { svcSalary, svcYearAt } from './contract';
import { batZero, pitZero } from './generate';
import { rowCash, rowInfo, rowOvr, rowPayroll, rowSat, type Row } from './eventRows';

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
  hotAvg: 0.32, hotOps: 0.85, hotAb: 8, hotEra: 3.0, hotOuts: 9, // 대체 선수의 맹활약 기준 (콜업 이후)
  hotStar: 5, hotBump: 2, hotBackSat: -2,
  armyDay: 60, armyMin: 22, armyMax: 26, armySeasons: 2, armyLo: 0.3, armyHi: 0.5, armyAwayMax: 1,
  convPot: 68, convAge: 23, convGap: 5, convHolderAge: 28, convWeak: 8, convPen: 6, convGames: 40,
  painAge: 25, painGames: 12, painAb: 30, painAvg: 0.2, painOuts: 30, painEra: 6.5, painFix: 12, painGrow: 1.5,
  coachDay: 30, coachCost: 20000, coachGrow: 0.08,
};
const F = FARM_N;

export const farmAutoOn = (core: Pick<Core, 'campaign'>): boolean => core.campaign.farmAuto !== false;

// ── 부상 대체 선택 (subpick.ts): 카드로 물을 부상자의 대기열. 여기 있는 동안에는 자동 말소·자동 콜업을 미룬다 ──
export const subAutoOn = (core: Pick<Core, 'campaign'>): boolean => core.campaign.subAuto === true;
export const subQueue = (core: Core): string[] => (memoGet(core, 'subq') ?? '').split(',').filter(Boolean);
export const subQueueSet = (core: Core, ids: string[]): void => memoSet(core, 'subq', ids.join(','));
export const subSlotKey = (id: string) => `subslot-${id}`;
export type SubRole = { k: 'L'; i: number; pos: BatPos } | { k: 'R' | 'B'; i: number } | { k: 'C' };

/** 카드를 띄울 자리: 타순 9명 · 선발 로테이션 · 마무리 · 필승조(불펜 상위 2명) */
export function subRole(t: Team, p: Player): SubRole | null {
  const li = t.lineup.findIndex((s) => s.pid === p.id);
  if (li >= 0) return { k: 'L', i: li, pos: t.lineup[li].pos };
  const ri = t.rotation.indexOf(p.id);
  if (ri >= 0) return { k: 'R', i: ri };
  if (t.closer === p.id) return { k: 'C' };
  const bi = t.bullpen.indexOf(p.id);
  return bi >= 0 && bi < 2 ? { k: 'B', i: bi } : null;
}

/** 오늘 다친 주전을 대기열에 올린다 (advanceDay, mutate). "감독에게 맡기기"면 올리지 않는다 */
export function subEnqueueMut(core: Core, pids: string[]): void {
  if (subAutoOn(core) || core.phase !== 'season' || core.day >= core.schedule.length) return;
  const t = userTeam(core);
  const add = pids.filter((id) => {
    const p = t.roster.find((x) => x.id === id);
    return !!p && !p.farm && p.injury > 0 && !p.ban && !!subRole(t, p);
  });
  if (add.length) subQueueSet(core, [...new Set([...subQueue(core), ...add])]);
}

/** 부상자가 돌아왔다: 대체 선수가 맡던 칸을 원래 주인에게 돌려준다 (mutate). 유저가 그 사이 편성을 바꿨으면 건드리지 않는다 */
function restoreSlotMut(core: Core, t: Team, orig: Player, sub: Player, force = false): void {
  restoreSlotStep(core, t, orig, sub, force);
  // 넘겨받은 단계(via)를 되돌린 뒤 바깥 단계가 조건에 걸려 멈추면, 그사이 명단에 오른(2군·재활) 선수가 편성에 남는다 — 그 칸은 정리한다
  const placed = [...t.lineup.map((x) => x.pid), ...t.rotation, ...t.bullpen, ...(t.closer ? [t.closer] : [])];
  if (placed.some((id) => t.roster.find((x) => x.id === id)?.farm)) fixLineup(t);
}
function restoreSlotStep(core: Core, t: Team, orig: Player, sub: Player, force: boolean): void {
  const v = memoGet(core, subSlotKey(orig.id));
  if (!v) return;
  memoSet(core, subSlotKey(orig.id), '');
  const [k, , pos, mover, mpos, via] = v.split('~');
  if (!force && (orig.farm || orig.injury > 0)) return;
  // 대체 선수도 다쳐 그 칸을 다른 선수가 넘겨받았으면(subHandoverMut), 그 단계부터 되돌린 뒤 원래 주인을 세운다
  const mid = via ? t.roster.find((x) => x.id === via) : undefined;
  if (mid) {
    restoreSlotStep(core, t, mid, sub, true);
    if (k === 'L' ? t.lineup.some((x) => x.pid === mid.id) : k === 'R' ? t.rotation.includes(mid.id) : k === 'C' ? t.closer === mid.id : t.bullpen.slice(0, 2).includes(mid.id)) sub = mid;
  }
  if (k === 'L') {
    const s = t.lineup.find((x) => x.pid === sub.id);
    if (!s || t.lineup.some((x) => x.pid === orig.id)) return;
    s.pid = orig.id;
    const ms = mover ? t.lineup.find((x) => x.pid === mover) : undefined;
    if (ms && ms.pos === pos && s.pos === mpos) [ms.pos, s.pos] = [s.pos, ms.pos];
  } else if (k === 'R') {
    const i = t.rotation.indexOf(sub.id);
    if (i < 0 || t.rotation.includes(orig.id)) return;
    t.bullpen = t.bullpen.filter((id) => id !== orig.id);
    if (t.closer === orig.id) t.closer = null;
    t.rotation[i] = orig.id;
    t.bullpen.push(sub.id);
  } else if (k === 'C') {
    if (t.closer !== sub.id || t.rotation.includes(orig.id)) return;
    t.bullpen = t.bullpen.filter((id) => id !== orig.id);
    t.closer = orig.id;
    t.bullpen.unshift(sub.id);
  } else {
    const i = t.bullpen.indexOf(sub.id);
    if (i < 0 || i >= 2 || t.rotation.includes(orig.id) || t.closer === orig.id) return;
    t.bullpen = t.bullpen.filter((id) => id !== orig.id && id !== sub.id);
    t.bullpen.splice(i, 0, orig.id);
    t.bullpen.splice(Math.min(2, t.bullpen.length), 0, sub.id);
  }
  if (!force) fixLineup(t);
}

/**
 * 대체 선수 mid 가 또 다쳐 다른 선수가 그 칸을 넘겨받는다 (mutate): 원래 주인 root 의 칸 메모 끝에 mid 를 이어 둔다.
 * root 가 돌아오면 restoreSlotMut 이 mid 의 단계부터 차례로 되돌린다. 칸 메모가 없으면(자동 콜업) false
 */
export function subHandoverMut(core: Core, root: Player, mid: Player): boolean {
  let key = subSlotKey(root.id);
  const v0 = memoGet(core, key);
  if (!v0) return false;
  let v: string = v0;
  for (let g = 0; g < 8; g++) {
    const via: string | undefined = v.split('~')[5];
    const next: string | undefined = via ? memoGet(core, subSlotKey(via)) : undefined;
    if (!via || !next) break;
    key = subSlotKey(via);
    v = next;
  }
  const f = v.split('~');
  while (f.length < 5) f.push('');
  f[5] = mid.id;
  memoSet(core, key, f.join('~'));
  return true;
}

/** 카드에서 고른 1군 벤치·불펜 대체 선수: 부상자가 돌아오면 원래 자리(벤치·불펜)로 (mutate. 자동 운영과 무관) */
function subBackMut(core: Core, notes: string[]): void {
  const t = userTeam(core);
  for (const p of t.roster.filter((x) => x.subFor && x.subFrom === 'bench')) {
    const orig = t.roster.find((x) => x.id === p.subFor);
    if (!p.farm && orig && (orig.injury > 0 || orig.farm)) continue;
    if (orig && !p.farm) {
      restoreSlotMut(core, t, orig, p);
      say(core, notes, `${orig.name} 복귀 — ${josa(p.name, '은', '는')} ${p.kind === 'B' ? '벤치' : '불펜'}로`, 'good');
    }
    delete p.subFor;
    delete p.subFrom;
  }
}

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
export const subBenchOut = (t: Team, kind: 'B' | 'P', keep: string[] = []): Player | null => benchOut(t, kind, keep);
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
  delete k.il;
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
  delete p.il;
  delete p.tired;
  delete p.subFor;
  delete p.subFrom;
  if (lock) p.farmUntil = core.day + FARM_LOCK;
  else delete p.farmUntil;
  fixLineup(t);
}

const say = (core: Core, notes: string[], text: string, tone: 'good' | 'bad' | 'info' = 'info') => {
  notes.push(text);
  addNews(core, text, tone);
};

/** p 를 2군으로 내려도 1군 최소 인원(타자·투수)이 지켜지는가 — 대체 선수를 돌려보내는 사이에 다른 선수가 빠졌으면(입대·방출·트레이드) 벤치에 남긴다 */
const spareOnActive = (t: Team, p: Player): boolean => activeRoster(t).filter((x) => x.kind === p.kind).length > (p.kind === 'B' ? MIN_BATTERS : MIN_PITCHERS);

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
  delete p.il;
  delete p.farmUntil;
  delete p.farmStat;
  delete p.tired;
  delete p.subFor;
  delete p.subFrom;
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
  // 겨울을 난 재활 선수는 개막에 맞춰 돌아온다 (징계가 남았으면 그대로 명단에. 1군이 가득이면 개막 뒤 2군 코치가 자리를 낸다)
  for (const p of rehabRoster(t)) {
    if (p.injury > 0 || activeRoster(t).length >= ROSTER_MAX) continue;
    delete p.farm;
    delete p.il;
    slotNewcomer(t, p);
  }
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
    if (farmRoster(t).length < farmMax(core) || activeRoster(t).length >= ROSTER_MAX) p.farm = true;
    t.roster.push(p);
    addNews(core, `전역: ${p.name} 복귀 (${p.age}세 · 오버롤 ${before} → ${p.ovr}) — ${p.farm ? '2군 합류' : '1군 합류'}`, 'good');
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
  for (const k of ['since', 'svc', 'ask', 'tired', 'farm', 'farmUntil', 'farmStat', 'subFor', 'subFrom', 'armyDue'] as const) delete p[k];
  unshiftPosMut(p);
  core.freeAgents.push(p);
  addNews(core, `${FARM_COACH}지명 자리를 위해 ${p.name}(${p.age}세 · 오버롤 ${p.ovr}) 방출`, 'info');
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

/** 부상자 자리에 올릴 2군 선수: 같은 포지션의 최고, 없으면 그 자리에 가장 맞는 선수 */
export const subFarmPick = (core: Core, t: Team, inj: Player): Player | undefined => subPick(core, t, inj);
function subPick(core: Core, t: Team, inj: Player): Player | undefined {
  const pool = farmRoster(t).filter((p) => p.kind === inj.kind && p.injury === 0 && lockLeft(core, p) === 0);
  const same = pool.filter((p) => p.pos === inj.pos).sort((a, b) => b.ovr - a.ovr);
  const pos = (t.lineup.find((s) => s.pid === inj.id)?.pos ?? 'DH') as BatPos;
  const any = pool.slice().sort((a, b) => (inj.kind === 'B' ? slotValue(b, pos) - slotValue(a, pos) : b.ovr - a.ovr));
  return same[0] ?? any[0];
}

/** 재활을 마쳐 복귀할 수 있는 선수 (다 나았고 명단 잠금이 풀렸다) */
export function rehabReady(core: Core): Player[] {
  return rehabRoster(userTeam(core)).filter((p) => p.injury === 0 && lockLeft(core, p) === 0);
}

/** 복귀 선수에게 자리를 내줄 1군 선수: 같은 종류의 가장 약한 벤치, 없으면 최소 인원이 남는 쪽의 벤치 */
function returnOut(t: Team, back: Player): Player | null {
  const same = benchOut(t, back.kind);
  if (same) return same;
  const other = back.kind === 'B' ? 'P' : 'B';
  const out = benchOut(t, other);
  return out && activeRoster(t).filter((p) => p.kind === other).length > (other === 'B' ? MIN_BATTERS : MIN_PITCHERS) ? out : null;
}

/** 복귀 대기: 재활은 끝났는데 1군이 가득하고 내릴 선수도 없다 (할 일에 올린다) */
export function rehabWaiting(core: Core): Player[] {
  const t = userTeam(core);
  return activeRoster(t).length >= ROSTER_MAX ? rehabReady(core) : [];
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
      say(core, notes, `${p.name}, ${posKo(p.pos)} 수비가 몸에 붙었습니다 (오버롤 ${p.ovr})`, 'good');
    }
  }
  if (core.day >= dayAt(core, F.armyDay)) {
    for (const p of t.roster.filter((x) => x.armyDue !== undefined && x.armyDue <= core.season)) enlistMut(core, p, notes);
  }
  // 불펜 과부하가 이어진 경기 수 (하루 쉬면 하나 줄어든다 — 'arm' 사건과 브리핑이 읽는다)
  const load = bullpenLoad(t);
  if (load.label === '과부하') {
    memoAdd(core, PEN_OVER_KEY);
    memoAdd(core, PEN_OVER_SUM);
  }
  else if (memoNum(core, PEN_OVER_KEY) > 0) memoAdd(core, PEN_OVER_KEY, -1);
  if (!farmAutoOn(core)) {
    subBackMut(core, notes);
    return;
  }
  shuttleMut(core, notes);

  // ── 재활을 마친 선수는 1군으로 (대체 선수가 맹활약 중이면 둘 다 1군에 두고 사건 B3 로 넘긴다) ──
  const pend = pending(core);
  for (const p of rehabReady(core)) {
    const sub = t.roster.find((x) => x.subFor === p.id && !x.farm && x.subFrom !== 'bench');
    let tail = '';
    if (activeRoster(t).length >= ROSTER_MAX) {
      const room = farmRoster(t).length < farmMax(core);
      const ask = !!sub && sub.injury === 0 && pend?.sub !== sub.id && isHot(core, sub) && farmBudgetOk(core);
      const out = !room ? null : ((ask ? null : sub && sub.injury === 0 ? sub : null) ?? returnOut(t, p) ?? (sub && sub.injury === 0 ? sub : null));
      if (!out) continue; // 자리가 없다 — 복귀 대기 (할 일에 뜬다)
      demoteMut(core, t, out, false);
      tail = ` — ${out.name} 2군행`;
    }
    delete p.farm;
    delete p.il;
    delete p.farmUntil;
    slotNewcomer(t, p);
    memoAdd(core, 'ilBack');
    say(core, notes, `${FARM_COACH}${p.name} 복귀${tail}`, 'good');
  }

  subBackMut(core, notes);

  // ── 부상자가 돌아오면 대체 선수는 2군으로 (맹활약 중이면 사건 B3 로 넘긴다) ──
  let askedNow = false;
  for (const p of t.roster.filter((x) => x.subFor && !x.farm && x.subFrom !== 'bench')) {
    const orig = t.roster.find((x) => x.id === p.subFor);
    if (orig && (orig.injury > 0 || (orig.farm && orig.il))) continue; // 아직 결장 중이거나 재활 명단에서 복귀를 기다린다
    if (p.injury > 0) {
      if (orig && !orig.farm && orig.injury === 0) restoreSlotMut(core, t, orig, p); // 칸은 바로 돌려준다
      continue; // 다친 대체 선수는 나은 뒤에 내린다
    }
    const asked = pend?.sub === p.id;
    if (!asked && !askedNow && orig && !orig.farm && isHot(core, p) && farmBudgetOk(core)) {
      memoSet(core, 'b3', `${p.id}|${orig.id}|${core.day}`);
      askedNow = true; // 하루에 한 명만 묻는다
      continue;
    }
    if (asked && pend!.day === core.day) continue;
    if (orig) restoreSlotMut(core, t, orig, p);
    if (farmRoster(t).length >= farmMax(core) || !spareOnActive(t, p)) {
      delete p.subFor;
      continue;
    }
    demoteMut(core, t, p, false);
    say(core, notes, `${FARM_COACH}${orig ? `${orig.name} 복귀 — ` : ''}대체 선수 ${p.name} 2군 복귀`);
  }

  ilAutoMut(core, notes);
  subGapMut(core, notes);
  benchKidsMut(core, notes);
}

/** 부상 공백에 콜업 (명단에 올리지 않는 짧은 부상: 뎁스가 빌 때만). 카드로 물을 부상자는 건너뛴다 */
export function subGapMut(core: Core, notes: string[]): void {
  if (!farmAutoOn(core)) return;
  const t = userTeam(core);
  const q = subQueue(core);
  for (const inj of activeRoster(t).filter((p) => p.injury >= F.subInjury)) {
    if (q.includes(inj.id) || t.roster.some((p) => p.subFor === inj.id) || !depthEmpty(t, inj)) continue;
    const k = subPick(core, t, inj);
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
    say(core, notes, `${FARM_COACH}${inj.name} 부상(${inj.injury}경기) 공백에 ${k.name}(${posKo(k.pos)} 오버롤 ${k.ovr}) 콜업${tail}`);
  }
}

/** 부상자 명단으로 옮긴다 (mutate. 편성 정리는 부르는 쪽이) */
export function ilMoveMut(core: Core, inj: Player): void {
  inj.farm = true;
  inj.il = true;
  inj.farmUntil = core.day + Math.max(IL_MIN, inj.injury);
  delete inj.tired;
  delete inj.subFor;
  delete inj.subFrom;
  memoAdd(core, 'ilOut');
}

/**
 * 자동 운영: 장기 결장(부상 IL_AUTO · 징계 IL_AUTO_BAN 경기 이상)은 그날 부상자 명단으로, 빈 1군 자리에는 2군에서 한 명 (mutate).
 * 경기 뒤의 사건(혹사·징계)으로 생긴 결장도 놓치지 않도록 advanceDay 끝에서 한 번 더 부른다.
 */
export function ilAutoMut(core: Core, notes: string[]): void {
  if (!farmAutoOn(core)) return;
  const t = userTeam(core);
  const q = subQueue(core);
  for (const inj of activeRoster(t).filter((p) => p.injury >= (p.ban ? IL_AUTO_BAN : IL_AUTO))) {
    if (q.includes(inj.id)) continue; // 대체 선수를 고른 뒤에 옮긴다 (subpick.ts)
    const has = t.roster.find((p) => p.subFor === inj.id && !p.farm);
    const k = has ? undefined : subPick(core, t, inj);
    const min = inj.kind === 'B' ? MIN_BATTERS : MIN_PITCHERS;
    // 최소 인원 규칙: 올릴 선수가 없어 1군이 모자라게 되면 말소하지 않는다
    if (!k && activeRoster(t).filter((p) => p.kind === inj.kind).length - 1 < min) continue;
    const slotPos = t.lineup.find((s) => s.pid === inj.id)?.pos;
    const games = inj.injury;
    ilMoveMut(core, inj);
    if (k) {
      markUpMut(core, k);
      delete k.farm;
      delete k.farmUntil;
      k.subFor = inj.id;
      // 같은 자리의 주전이었으면 대체 선수가 그 칸을 받는다 (더 나은 벤치가 있으면 감독이 다시 짠다)
      const slot = slotPos && k.kind === 'B' ? t.lineup.find((s) => s.pid === inj.id) : undefined;
      if (slot && !activeRoster(t).some((x) => x.kind === 'B' && x.injury === 0 && !t.lineup.some((s) => s.pid === x.id) && slotValue(x, slot.pos) > slotValue(k, slot.pos))) slot.pid = k.id;
    }
    fixLineup(t);
    say(core, notes, `${FARM_COACH}${inj.name} ${inj.ban ? '징계 말소' : '부상자 명단'}(${games}경기)${k ? ` — ${k.name} 콜업` : has ? '' : ' — 올릴 2군 선수 없음'}`);
  }

}

/** 벤치에서 썩는 유망주는 2군으로 (하루 한 명) */
function benchKidsMut(core: Core, notes: string[]): void {
  const t = userTeam(core);
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
    if (sent || n < F.benchDays || p.injury > 0 || nb < MIN_BATTERS + 2 || farmRoster(t).length >= farmMax(core)) continue;
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
const info = (p: Player) => `${p.name}(${posKo(p.pos)}, ${p.age}세, 오버롤 ${p.ovr} · 잠재력 ${p.pot})`;
const pair = (a: Player, b?: Player | null) => ({ pids: [a.id, ...(b ? [b.id] : [])], ...(b ? { compare: [a.id, b.id] as [string, string] } : {}) });
const seat = (p: Player) => (p.kind === 'B' ? '벤치' : '불펜');
const growRow = (core: Core, k: Player): Row => rowInfo('2군 성장 확률(주)', pctTxt(k.ovr >= FARM_CAP ? 0 : farmGrow(core.facilities)), pctTxt(k.ovr >= FARM_CAP ? 0 : farmGrow(core.facilities)));
/** 포지션 전향의 수비 페널티와 전향 직후 오버롤 (make 와 resolve 가 같이 쓴다) */
const convPen = (k: Player) => Math.min(F.convPen, k.def - 20);
const convOvr = (k: Player, to: BatPos) => calcOvr({ ...k, pos: to, def: k.def - convPen(k) });
/** 올리는 선택지의 상세 행: 주전 교체·밀려나는 선수·2군행 */
const upRows = (k: Player, cur: Player, down: Player | null): Row[] => [
  rowOvr(`${posKo(cur.kind === 'B' ? k.pos : cur.pos)} 주전`, cur.ovr, k.ovr),
  rowInfo(cur.name, seat(cur), '주전', 'bad'),
  ...(down ? [rowInfo(down.name, '2군행', '1군', 'bad')] : []),
];
const full = (t: Team) => activeRoster(t).length >= ROSTER_MAX;
const farmLine = (p: Player) => (p.kind === 'B' ? `${fmtAvg(p.farmStat?.h ?? 0, p.farmStat?.ab ?? 0)} ${p.farmStat?.hr ?? 0}홈런 (${p.farmStat?.ab ?? 0}타수)` : `평균자책점 ${fmtEra(p.farmStat?.er ?? 0, p.farmStat?.outs ?? 0)} (${Math.floor((p.farmStat?.outs ?? 0) / 3)}이닝)`);

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
  if (core.day < dayAt(core, F.armyDay) || memoGet(core, 'army') || (core.campaign.away?.length ?? 0) >= F.armyAwayMax) return null;
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
    return { p, alt: altFor(t, p), text: p.kind === 'B' ? `${s.ab}타수 ${s.h}안타 ${fmtAvg(s.h, s.ab)}` : `${Math.floor(s.outs / 3)}이닝 평균자책점 ${fmtEra(s.er, s.outs)}` };
  }
  return null;
}

// 인스트럭터 후보: 지난겨울 유니폼을 벗은 영구결번 또는 스타성 50+ 은퇴 선수 (campaign.alumni)
const coachCase = (core: Core) => (core.day < dayAt(core, F.coachDay) ? [...(core.campaign.alumni ?? []), ...(core.campaign.retired ?? [])].filter((r) => r.season === core.season - 1).slice(-1)[0] ?? null : null);

/** 올리는 선택지의 공통 처리: (가득이면 한 명 내리고) k 를 cur 자리에 */
function swapUpMut(core: Core, k: Player, cur: Player | undefined, downId: string | undefined): void {
  const t = userTeam(core);
  const down = find(core, downId);
  if (down && !down.farm && full(t) && farmRoster(t).length <= farmMax(core)) demoteMut(core, t, down, true);
  promoteMut(core, t, k, cur);
  hintMut(core, k.kind === 'B' ? 'lineup' : 'pitchers');
}
const upDesc = (k: Player, cur: Player) => `${posKo(cur.kind === 'B' ? k.pos : cur.pos)} 주전 ${cur.ovr} → ${k.ovr} (${sgn(k.ovr - cur.ovr)})`;
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
      const stat = sub.kind === 'B' ? `${s.ab}타수 ${s.h}안타 ${fmtAvg(s.h, s.ab)} · OPS ${s.ops.toFixed(3)}` : `${Math.floor(s.outs / 3)}이닝 평균자책점 ${fmtEra(s.er, s.outs)}`;
      return mk(`f-sub|${orig.id}`, vet ? 'fSubVet' : 'fSub', {
        title: '대체 선수의 깜짝 활약',
        icon: '🔥',
        pid: sub.id,
        body: `${orig.name}(${orig.age}세, 오버롤 ${orig.ovr})의 부상 공백에 올라온 ${sub.name}(${sub.age}세, 오버롤 ${sub.ovr})이 ${stat}. 오늘 ${josa(orig.name, '이', '가')} 돌아왔습니다.`,
        choices: [
          {
            label: '신예를 그대로 쓴다',
            desc: `${posKo(orig.pos)} 주전 ${orig.ovr} → ${sub.ovr} · 스타성 +${F.hotStar}`,
            detail: {
              rows: [
                rowOvr(`${posKo(orig.pos)} 주전`, orig.ovr, sub.ovr),
                rowInfo(`${sub.name} 스타성`, `${clamp(sub.star + F.hotStar, 0, 100)}`, `${sub.star}`, 'good'),
                rowInfo(`${sub.name} 능력치`, `합 +${F.hotBump} (영구)`, undefined, 'good'),
                rowInfo(orig.name, seat(orig), '주전', 'bad'),
                rowSat(c, 0),
              ],
              ...pair(sub, orig),
            },
          },
          {
            label: '원래 주전에게 돌려준다',
            desc: `${sub.name} 2군 복귀 · 팬 만족도 ${sgn(F.hotBackSat)}`,
            detail: {
              rows: [
                rowOvr(`${posKo(orig.pos)} 주전`, orig.ovr, orig.ovr),
                rowInfo(sub.name, farmRoster(userTeam(c)).length >= farmMax(c) ? '벤치 (2군 가득)' : '2군 (재등록 잠금 없음)', '1군'),
                rowSat(c, F.hotBackSat),
              ],
              ...pair(sub, orig),
            },
          },
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
        return `${josa(sub.name, '이', '가')} 자리를 지켰습니다 — 오버롤 ${sub.ovr}`;
      }
      sat(c, F.hotBackSat);
      if (orig) restoreSlotMut(c, t, orig, sub);
      if (farmRoster(t).length >= farmMax(c)) {
        delete sub.subFor;
        return `${josa(orig?.name ?? '주전', '이', '가')} 원래 자리로 — 2군이 가득해 ${josa(sub.name, '은', '는')} 벤치에 남습니다`;
      }
      if (!spareOnActive(t, sub)) {
        delete sub.subFor;
        return `${josa(orig?.name ?? '주전', '이', '가')} 원래 자리로 — 1군 인원이 모자라 ${josa(sub.name, '은', '는')} 벤치에 남습니다`;
      }
      demoteMut(c, t, sub, false);
      return `${josa(orig?.name ?? '주전', '이', '가')} 원래 자리로, ${josa(sub.name, '은', '는')} 2군으로 돌아갔습니다`;
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
          {
            label: '맡긴다',
            desc: `인건비 ${fmtMoney(F.coachCost)} · 2군 ${kind === 'P' ? '투수' : '타자'} 성장 확률 ${pctTxt(base)} → ${pctTxt(Math.min(1, base + F.coachGrow))}`,
            disabled: c.finance.cash < F.coachCost ? `현금 부족 (필요 ${fmtMoney(F.coachCost)})` : undefined,
            detail: {
              rows: [rowCash(c, -F.coachCost), rowInfo(`2군 ${kind === 'P' ? '투수' : '타자'} 성장 확률(주)`, pctTxt(Math.min(1, base + F.coachGrow)), pctTxt(base), 'good'), rowInfo('대상', `${n}명`)],
              pids: farmRoster(userTeam(c)).filter((p) => p.kind === kind).sort((a, b) => b.pot - a.pot).slice(0, 4).map((p) => p.id),
              lasts: '이번 시즌',
            },
          },
          { label: '사양한다', desc: '변화 없음', detail: { rows: [rowCash(c, 0), rowInfo(`2군 ${kind === 'P' ? '투수' : '타자'} 성장 확률(주)`, pctTxt(base), pctTxt(base))] } },
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
          {
            label: '믿고 쓴다',
            desc: p.kind === 'B' ? `${F.painFix}경기 고정 출전 · 성장 확률 ×${F.painGrow}` : `${F.painFix}경기 동안 성장 확률 ×${F.painGrow}`,
            detail: {
              rows: [
                rowInfo('주전', `${p.name} ${p.ovr}`, `${p.name} ${p.ovr}`),
                rowInfo('쓰지 않는 대안', alt ? `${alt.name} ${alt.ovr} (전력 ${sgn(-loss)})` : '없음', undefined, loss > 0 ? 'bad' : 'info'),
                rowInfo(`${p.name} 성장 확률(주)`, `×${F.painGrow}`, '×1', 'good'),
                rowInfo('잠재력까지', `${Math.max(0, p.pot - p.ovr)}`),
              ],
              ...pair(p, alt),
              lasts: `${F.painFix}경기`,
            },
          },
          {
            label: '내린다',
            desc: `${p.name} 2군행 · ${alt ? `주전 ${p.ovr} → ${alt.ovr}` : `${FARM_LOCK}경기 재등록 불가`}`,
            disabled: farmRoster(t).length >= farmMax(c) ? '2군이 가득 찼습니다' : undefined,
            detail: {
              rows: [alt ? rowOvr('주전', p.ovr, alt.ovr) : rowInfo('주전', '빈자리는 감독이 메운다', `${p.name} ${p.ovr}`), rowInfo(`${p.name} 재등록`, `${FARM_LOCK}경기 불가`, undefined, 'bad'), growRow(c, p)],
              ...pair(p, alt),
              lasts: `잠금 ${FARM_LOCK}경기`,
            },
          },
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
      return `${josa(p.name, '을', '를')} 2군으로 내렸습니다 — ${FARM_LOCK}경기 뒤 다시 올릴 수 있습니다`;
    },
  },
  // ───────── B1 콜업 준비 완료 ─────────
  {
    id: 'f-ready',
    prio: 60,
    when: (c) => farmAutoOn(c) && !!readyCase(c),
    make: (c) => {
      const x = readyCase(c);
      if (!x) return null;
      const { k, cur, down } = x;
      return mk(`f-ready|${cur.id}|${down?.id ?? ''}`, 'fReady', {
        title: '콜업 준비 완료',
        icon: '📣',
        pid: k.id,
        body: `${info(k)}이 2군 상한(오버롤 ${FARM_CAP})에 닿았습니다. 퓨처스 ${farmLine(k)}.`,
        choices: [
          {
            label: '올린다',
            desc: `${upDesc(k, cur)}${down ? ` · ${down.name} 2군행` : ` · ${cur.name} ${seat(cur)}로`}`,
            disabled: noRoom(c, down),
            detail: { rows: [...upRows(k, cur, down), rowInfo(`${k.name} 성장`, '1군에서 계속', `멈춤 (상한 ${FARM_CAP})`, 'good')], pids: [k.id, cur.id, ...(down ? [down.id] : [])], compare: [k.id, cur.id] },
          },
          {
            label: '한 달 더',
            desc: `2군 성장 멈춤 (상한 ${FARM_CAP}) · ${F.readyWait}경기 뒤 다시 보고`,
            detail: {
              rows: [rowOvr(`${posKo(cur.kind === 'B' ? k.pos : cur.pos)} 주전`, cur.ovr, cur.ovr), rowInfo(`${k.name} 성장`, `멈춤 (상한 ${FARM_CAP})`, `멈춤 (상한 ${FARM_CAP})`, 'bad'), rowInfo('다시 보고', `${F.readyWait}경기 뒤`)],
              ...pair(k, cur),
            },
          },
        ],
      });
    },
    resolve: (c, i, cd) => {
      const k = find(c, cd.pid);
      if (!k) return '없던 일이 되었습니다';
      const [, curId, downId] = cd.id.split('|');
      if (i !== 0) {
        memoSet(c, `b1-${k.id}`, c.day + F.readyWait);
        return `${josa(k.name, '은', '는')} 한 달 더 2군에서 기다립니다`;
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
      const after = convOvr(k, to);
      return mk(`f-conv|${to}`, 'fConv', {
        title: '포지션 전향',
        icon: '🧤',
        pid: k.id,
        body: `${info(k)}의 자리에는 ${cur.name}(${cur.age}세, 오버롤 ${cur.ovr})이 버티고 있습니다. 팀에서 가장 약한 자리는 ${posKo(to)}(${weak.name}, 오버롤 ${weak.ovr})입니다.`,
        choices: [
          {
            label: '전향시킨다',
            desc: `${posKo(k.pos)} → ${posKo(to)} · 수비 −${convPen(k)} (${F.convGames}경기)`,
            detail: {
              rows: [
                rowInfo('포지션', posKo(to), posKo(k.pos)),
                rowInfo(`${k.name} 수비`, `${k.def - convPen(k)}`, `${k.def}`, 'bad'),
                rowOvr(`${k.name} 오버롤`, k.ovr, after),
                rowInfo('막고 있는 주전', `${weak.name} ${weak.ovr} (${weak.age}세)`, `${cur.name} ${cur.ovr} (${cur.age}세)`, 'good'),
                rowInfo('잠재력', `${k.pot}`, `${k.pot}`),
              ],
              pids: [k.id, weak.id, cur.id],
              compare: [k.id, weak.id],
              lasts: `수비 페널티 ${F.convGames}경기`,
            },
          },
          {
            label: '그대로 둔다',
            desc: `${posKo(k.pos)} 주전 ${cur.name} ${cur.ovr} · ${k.name} ${k.ovr}`,
            detail: {
              rows: [rowInfo('포지션', posKo(k.pos), posKo(k.pos)), rowInfo('막고 있는 주전', `${cur.name} ${cur.ovr} (${cur.age}세)`, `${cur.name} ${cur.ovr} (${cur.age}세)`), rowInfo('잠재력', `${k.pot}`, `${k.pot}`)],
              pids: [k.id, cur.id, weak.id],
              compare: [k.id, cur.id],
            },
          },
        ],
      });
    },
    resolve: (c, i, cd) => {
      const k = find(c, cd.pid);
      if (!k) return '없던 일이 되었습니다';
      memoSet(c, `b5-${k.id}`, 1);
      if (i !== 0) return `${josa(k.name, '은', '는')} 제 포지션에서 기다립니다`;
      const to = cd.id.split('|')[1] as BatPos;
      const pen = convPen(k);
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
          {
            label: '여론대로 올린다',
            desc: `팬 만족도 ${sgn(F.hypeSat)} · ${upDesc(k, cur)}`,
            disabled: noRoom(c, down),
            detail: {
              rows: [rowSat(c, F.hypeSat), ...upRows(k, cur, down)],
              pids: [k.id, cur.id, ...(down ? [down.id] : [])],
              compare: [k.id, cur.id],
              lasts: k.kind === 'B' ? `고정 출전 ${F.hypeGames}경기 (뒤에 ${cur.name} 복귀)` : `${cur.name}의 보직을 맡는다`,
            },
          },
          {
            label: '기다린다',
            desc: `팬 만족도 ${sgn(F.hypeWaitSat)} · 2군 성장 계속`,
            detail: { rows: [rowSat(c, F.hypeWaitSat), rowOvr(`${posKo(cur.kind === 'B' ? k.pos : cur.pos)} 주전`, cur.ovr, cur.ovr), growRow(c, k), rowInfo('잠재력까지', `${Math.max(0, k.pot - k.ovr)}`)], ...pair(k, cur) },
          },
        ],
      });
    },
    resolve: (c, i, cd) => {
      const k = find(c, cd.pid);
      if (!k) return '없던 일이 되었습니다';
      memoSet(c, `b2-${k.id}`, 1);
      if (i !== 0) {
        sat(c, F.hypeWaitSat);
        return `${josa(k.name, '은', '는')} 2군에서 더 익힙니다 — 게시판은 한동안 시끄럽습니다`;
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
      const gap: Row = p.farm ? rowInfo('1군 전력', '변화 없음 (2군)') : loss > 0 || alt ? rowInfo(`${posKo(p.pos)} 주전`, `${alt ? `${alt.name} ${alt.ovr}` : '공백'} (${sgn(-loss)})`, `${p.name} ${p.ovr}`, loss > 0 ? 'bad' : 'info') : rowInfo('1군 전력', '변화 없음 (벤치)');
      const gain = `복귀 때 오버롤 +${Math.round(room * F.armyLo)}~${Math.round(room * F.armyHi)}`;
      return mk('f-army', 'fArmy', {
        title: '군 입대',
        icon: '🪖',
        pid: p.id,
        body: `${info(p)}에게 입영 통지서가 나왔습니다.${p.farm ? ' 지금은 2군에 있습니다.' : ''}`,
        choices: [
          {
            label: '지금 보낸다',
            desc: `${back}시즌 개막 복귀 · ${gain}`,
            detail: {
              rows: [
                rowInfo('이탈', '오늘부터', undefined, 'bad'),
                rowInfo('복귀', `${back}시즌 개막 (${p.age + F.armySeasons}세)`),
                rowInfo('복귀 때 오버롤', `${p.ovr + Math.round(room * F.armyLo)}~${p.ovr + Math.round(room * F.armyHi)} 예상`, `${p.ovr}`, 'good'),
                rowPayroll(c, -p.salary),
                gap,
              ],
              ...pair(p, alt),
              lasts: `${F.armySeasons}시즌`,
            },
          },
          {
            label: '한 시즌 미룬다',
            desc: `올해는 그대로 · 내년 ${dayAt(c, F.armyDay)}경기 뒤 입대`,
            detail: {
              rows: [
                rowInfo('이탈', `내년 ${dayAt(c, F.armyDay)}경기 뒤 (미룰 수 없음)`, undefined, 'bad'),
                rowInfo('복귀', `${back + 1}시즌 개막 (${p.age + 1 + F.armySeasons}세)`),
                rowPayroll(c, 0),
                rowInfo('올해 1군 전력', '변화 없음'),
              ],
              ...pair(p, alt),
              lasts: `${F.armySeasons}시즌 (내년 시즌 중 이탈)`,
            },
          },
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
        return `${josa(p.name, '이', '가')} 머리를 깎았습니다 — ${p.away?.until}시즌에 돌아옵니다`;
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
    if (memoNum(core0, `fc-${d.id}`) >= (d.max ?? 1) || !cardRested(core0, d.id) || !d.when(core0)) continue;
    const core = structuredClone(core0);
    const cd = d.make(core, rng);
    if (!cd) continue;
    core.campaign.event = cd;
    memoAdd(core, 'fevN');
    memoAdd(core, `fc-${d.id}`);
    markCardMut(core, d.id);
    memoSet(core, 'fevDay', core.day);
    const who = cd.who && cd.who !== 'player' ? `${CHARACTERS[cd.who].name} ${CHARACTERS[cd.who].title} — ` : '';
    addNews(core, `${cd.icon} ${who}${cd.title}`, 'info');
    return core;
  }
  return core0;
}
