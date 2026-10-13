import type { BatPos, Core, LineupSlot, Player, Team } from '../../game/types';
import { fixedStarters } from '../../game/campaign';
import { ROSTER_MAX, activeRoster } from '../../game/economy';
import { farmLockLeft } from '../../game/season';
import { sendDownPreview } from '../../game/analysis';
import { recPairs } from '../../game/fixes';
import { teamParts, type TeamParts } from '../../game/ratings';

// ───────── 선수단 화면의 순수 연산 (미리 보기와 실제 반영이 같은 함수를 쓴다) ─────────

export type EditorView = 'field' | 'order' | 'arms';

/** 선수단 화면이 되돌릴 수 있는 편성 상태: 타순·수비 위치·투수 보직 + 1군/2군 소속 */
export interface LineupSnap {
  lineup: LineupSlot[];
  rotation: string[];
  bullpen: string[];
  closer: string | null;
  farm: Record<string, number | true>; // 2군 선수 id → 재등록 가능 day (없으면 true)
  il?: string[]; // 그중 부상자 명단(재활)인 선수
}

export function snapOf(t: Team): LineupSnap {
  const farm: LineupSnap['farm'] = {};
  for (const p of t.roster) if (p.farm) farm[p.id] = p.farmUntil ?? true;
  const il = t.roster.filter((p) => p.farm && p.il).map((p) => p.id);
  return { lineup: t.lineup.map((l) => ({ ...l })), rotation: [...t.rotation], bullpen: [...t.bullpen], closer: t.closer, farm, ...(il.length ? { il } : {}) };
}

/** 스냅샷을 팀에 덮어쓴다 (mutate). 그 사이 팀을 떠난 선수가 끼어 있으면 false */
export function applySnap(t: Team, s: LineupSnap): boolean {
  const ids = new Set(t.roster.map((p) => p.id));
  const used = [...s.lineup.map((l) => l.pid), ...s.rotation, ...s.bullpen, ...(s.closer ? [s.closer] : [])];
  if (used.some((id) => !ids.has(id))) return false;
  t.lineup = s.lineup.map((l) => ({ ...l }));
  t.rotation = [...s.rotation];
  t.bullpen = [...s.bullpen];
  t.closer = s.closer;
  for (const p of t.roster) {
    const f = s.farm[p.id];
    if (f === undefined) {
      delete p.farm;
      delete p.il;
      delete p.farmUntil;
    } else {
      p.farm = true;
      if (s.il?.includes(p.id)) p.il = true;
      else delete p.il;
      if (f === true) delete p.farmUntil;
      else p.farmUntil = f;
    }
  }
  return true;
}

export const sameSnap = (a: LineupSnap, b: LineupSnap): boolean => JSON.stringify(a) === JSON.stringify(b);

const PARTS: [keyof TeamParts, string][] = [
  ['bat', '타선'],
  ['def', '수비'],
  ['rot', '선발'],
  ['pen', '불펜'],
];

/** 전력 변화 중 가장 큰 1~2칸: "수비 +5 · 타선 +2" */
export function partsDelta(a: TeamParts, b: TeamParts): { text: string; sum: number } {
  const ds = PARTS.map(([k, label]) => ({ label, d: b[k] - a[k] }))
    .filter((x) => x.d !== 0)
    .sort((x, y) => Math.abs(y.d) - Math.abs(x.d));
  return { text: ds.slice(0, 2).map((x) => `${x.label} ${x.d > 0 ? '+' : '−'}${Math.abs(x.d)}`).join(' · '), sum: ds.reduce((s, x) => s + x.d, 0) };
}

const light = (t: Team): Team => ({ ...t, lineup: t.lineup.map((l) => ({ ...l })), rotation: [...t.rotation], bullpen: [...t.bullpen] });

type PLoc = { k: 'rot' | 'pen'; i: number } | { k: 'cl' } | null;
function ploc(t: Team, pid: string): PLoc {
  const ri = t.rotation.indexOf(pid);
  if (ri >= 0) return { k: 'rot', i: ri };
  if (t.closer === pid) return { k: 'cl' };
  const bi = t.bullpen.indexOf(pid);
  return bi >= 0 ? { k: 'pen', i: bi } : null;
}
function pput(t: Team, l: PLoc, pid: string): void {
  if (!l) return;
  if (l.k === 'rot') t.rotation[l.i] = pid;
  else if (l.k === 'pen') t.bullpen[l.i] = pid;
  else t.closer = pid;
}

/** 편성 안에서 out 의 자리를 inn 이 그대로 물려받는다 (mutate) */
export function replaceIn(t: Team, out: string, inn: string): void {
  t.lineup = t.lineup.map((l) => (l.pid === out ? { ...l, pid: inn } : l));
  pput(t, ploc(t, out), inn);
}

export interface Plan {
  after: Team; // 반영한 뒤의 팀 (복제본)
  text: string; // "수비 +5 · 타선 +2"
  sum: number; // 변화 합 (음수면 빨강)
  callUp?: { farm: string; target: string; down: boolean }; // 2군 칩을 놓는 경우
}
export type PlanResult = Plan | { error: string } | null;

/**
 * a 를 b 자리에 놓으면 어떻게 되는가. null = 바꿀 것이 없다, error = 놓을 수 없다(사유).
 * move: 타순 화면에서 끌어 놓을 때는 맞바꾸지 않고 그 자리에 끼워 넣는다.
 */
export function planEdit(core: Core, team: Team, view: EditorView, a: string, b: string, move = false): PlanResult {
  const r = planEdit0(core, team, view, a, b, move);
  if (!r || 'error' in r) return r;
  // 고정 출전을 약속한 선수는 그 기간에 선발에서 뺄 수 없다 (빼도 경기 때 다시 들어가 "되돌아간" 것처럼 보인다)
  for (const [pid, f] of fixedStarters(core)) {
    if (team.lineup.some((l) => l.pid === pid) && !r.after.lineup.some((l) => l.pid === pid)) {
      const p = team.roster.find((x) => x.id === pid);
      return { error: `${p?.name ?? '이 선수'}: 고정 출전 약속 중 — ${f.left}경기 뒤에 뺄 수 있습니다` };
    }
  }
  return r;
}

function planEdit0(core: Core, team: Team, view: EditorView, a: string, b: string, move = false): PlanResult {
  if (a === b) return null;
  const pa = team.roster.find((p) => p.id === a);
  const pb = team.roster.find((p) => p.id === b);
  if (!pa || !pb || pa.kind !== pb.kind) return null;
  const before = teamParts(team);
  const done = (after: Team, extra?: Partial<Plan>, note = ''): Plan => {
    const d = partsDelta(before, teamParts(after));
    return { after, text: [d.text, note].filter(Boolean).join(' · '), sum: d.sum, ...extra };
  };

  if (pa.farm || pb.farm) {
    if (pa.farm && pb.farm) return null;
    const [f, o] = pa.farm ? [pa, pb] : [pb, pa];
    const left = farmLockLeft(core, f);
    if (left > 0) return { error: f.il ? `${f.name}: 재활 중 — ${left}경기 뒤 복귀` : `${f.name}: 재등록 ${left}경기 뒤` };
    const full = activeRoster(team).length >= ROSTER_MAX;
    if (full) {
      const pv = sendDownPreview(core, o);
      if (!pv.ok) return { error: `${o.name}: ${pv.text}` };
    }
    const t = light(team);
    t.roster = team.roster.map((p) => (p.id === f.id ? { ...p, farm: undefined, il: undefined } : full && p.id === o.id ? { ...p, farm: true } : p));
    const loc = ploc(t, o.id);
    replaceIn(t, o.id, f.id);
    if (!full && loc) t.bullpen.push(o.id); // 밀려난 투수는 불펜 끝으로
    return done(t, { callUp: { farm: f.id, target: o.id, down: full } }, full ? `${o.name} 2군` : '');
  }

  const t = light(team);
  if (pa.kind === 'B') {
    const i = t.lineup.findIndex((l) => l.pid === a);
    const j = t.lineup.findIndex((l) => l.pid === b);
    if (i < 0 && j < 0) return null;
    if (i >= 0 && j >= 0) {
      if (view === 'order') {
        if (move) {
          const [x] = t.lineup.splice(i, 1);
          t.lineup.splice(j, 0, x);
        } else [t.lineup[i], t.lineup[j]] = [t.lineup[j], t.lineup[i]];
      } else [t.lineup[i].pos, t.lineup[j].pos] = [t.lineup[j].pos, t.lineup[i].pos];
    } else if (i >= 0) t.lineup[i].pid = b;
    else t.lineup[j].pid = a;
    return done(t);
  }
  const la = ploc(t, a);
  const lb = ploc(t, b);
  if (!la && !lb) return null;
  pput(t, la, b);
  pput(t, lb, a);
  return done(t);
}

// ───────── 추천 수리 (▲벤치 · ⇄제자리 · ▲불펜 판정 재사용) ─────────

export interface Rec {
  key: string;
  a: string; // 옮길 선수
  b: string; // 놓을 자리의 선수
  view: EditorView;
  who: string; // "서주현"
  to: string; // "4번 지명"
}

export const POS: Record<string, string> = { C: '포수', '1B': '1루수', '2B': '2루수', '3B': '3루수', SS: '유격수', LF: '좌익수', CF: '중견수', RF: '우익수', DH: '지명타자' };

export function recommend(team: Team): Rec[] {
  const byId = new Map(team.roster.map((p) => [p.id, p]));
  return recPairs(team).map((r): Rec => {
    const who = byId.get(r.a)?.name ?? '';
    if (r.kind === 'bench') return { key: `b${r.b}`, a: r.a, b: r.b, view: 'field', who, to: `${r.slot + 1}번 ${POS[team.lineup[r.slot].pos]}` };
    if (r.kind === 'home') return { key: `p${r.a}`, a: r.a, b: r.b, view: 'field', who, to: `${POS[team.lineup[r.slot].pos as BatPos]} (${byId.get(r.b)?.name ?? ''}와 교대)` };
    const ri = team.rotation.indexOf(r.b);
    return { key: `a${r.b}`, a: r.a, b: r.b, view: 'arms', who, to: ri >= 0 ? `${ri + 1}선발` : '마무리' };
  });
}

export const playerOf = (team: Team, pid: string | null | undefined): Player | undefined => (pid ? team.roster.find((p) => p.id === pid) : undefined);

// ───────── 자리 시트: 그 자리에 올 수 있는 후보 ─────────

export type Group = 'lineup' | 'rot' | 'pen' | 'cl' | 'spare' | 'farm';

/** 선수가 지금 속한 묶음 (선발 타순 · 선발진 · 불펜 · 마무리 · 벤치/대기 · 2군) */
export function groupOf(t: Team, p: Player): Group {
  if (p.farm) return 'farm';
  if (p.kind === 'B') return t.lineup.some((l) => l.pid === p.id) ? 'lineup' : 'spare';
  const l = ploc(t, p.id);
  return l ? l.k : 'spare';
}

/** 비어 있는 마무리 자리에 pid 를 놓는다. 선발·2군·타자는 놓을 수 없다 */
export function planCloser(team: Team, pid: string): PlanResult {
  const p = team.roster.find((x) => x.id === pid);
  if (team.closer || !p || p.kind !== 'P' || p.farm) return null;
  if (team.rotation.includes(pid)) return { error: '선발 투수는 마무리 자리에 놓을 수 없습니다 — 불펜 투수를 고르세요' };
  const t = light(team);
  t.bullpen = t.bullpen.filter((id) => id !== pid);
  t.closer = pid;
  const d = partsDelta(teamParts(team), teamParts(t));
  return { after: t, text: d.text, sum: d.sum };
}

export const EMPTY_CLOSER = '__closer'; // 비어 있는 마무리 자리

export interface Candidate {
  p: Player;
  farm: boolean;
  rehab?: number; // 재활 중: 복귀까지 남은 경기 수 (교체 불가 — 목록 맨 아래에 회색으로)
  plan: PlanResult;
}

/** owner(그 자리의 주인, 또는 빈 마무리 자리)를 대신할 수 있는 후보: 1군 백업 먼저, 그다음 2군. 각 묶음은 예상 변화가 큰 순 */
export function slotCandidates(core: Core, team: Team, owner: string): Candidate[] {
  const o = team.roster.find((p) => p.id === owner);
  const g = o ? groupOf(team, o) : 'cl';
  const kind = o ? o.kind : 'P';
  const sum = (c: Candidate) => (c.plan && 'after' in c.plan ? c.plan.sum : -99);
  const all = team.roster
    .filter((p) => {
      if (p.kind !== kind || p.id === owner) return false;
      const pg = groupOf(team, p);
      if (pg === g) return false;
      if (!o) return pg === 'pen' || pg === 'spare';
      return !(pg === 'rot' && (g === 'pen' || g === 'cl'));
    })
    .map((p): Candidate => {
      const left = p.farm && p.il ? farmLockLeft(core, p) : 0;
      return { p, farm: !!p.farm, ...(left > 0 ? { rehab: left } : {}), plan: o ? planEdit(core, team, kind === 'B' ? 'field' : 'arms', p.id, owner) : planCloser(team, p.id) };
    })
    .sort((a, b) => sum(b) - sum(a) || b.p.ovr - a.p.ovr);
  return [...all.filter((c) => !c.farm).slice(0, 6), ...all.filter((c) => c.farm && !c.rehab).slice(0, 4), ...all.filter((c) => c.rehab).slice(0, 3)];
}
