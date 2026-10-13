import { create } from 'zustand';
import type { BatPos, Core, LineupSlot, Player, Team } from '../../game/types';
import { ROSTER_MAX, activeRoster } from '../../game/economy';
import { farmLockLeft } from '../../game/season';
import { sendDownPreview } from '../../game/analysis';
import { betterArms, betterBats, homeSwap, offPos } from '../../game/fixes';
import { teamParts, type TeamParts } from '../../game/ratings';

// ───────── 오더 편집기의 순수 연산 (미리 보기와 실제 반영이 같은 함수를 쓴다) ─────────

export type EditorView = 'field' | 'order' | 'arms';

/** 편집기가 되돌릴 수 있는 편성 상태: 타순·수비 위치·투수 보직 + 1군/2군 소속 */
export interface LineupSnap {
  lineup: LineupSlot[];
  rotation: string[];
  bullpen: string[];
  closer: string | null;
  farm: Record<string, number | true>; // 2군 선수 id → 재등록 가능 day (없으면 true)
}

export function snapOf(t: Team): LineupSnap {
  const farm: LineupSnap['farm'] = {};
  for (const p of t.roster) if (p.farm) farm[p.id] = p.farmUntil ?? true;
  return { lineup: t.lineup.map((l) => ({ ...l })), rotation: [...t.rotation], bullpen: [...t.bullpen], closer: t.closer, farm };
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
      delete p.farmUntil;
    } else {
      p.farm = true;
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
    if (left > 0) return { error: `${f.name}: 재등록 ${left}경기 뒤` };
    const full = activeRoster(team).length >= ROSTER_MAX;
    if (full) {
      const pv = sendDownPreview(core, o);
      if (!pv.ok) return { error: `${o.name}: ${pv.text}` };
    }
    const t = light(team);
    t.roster = team.roster.map((p) => (p.id === f.id ? { ...p, farm: undefined } : full && p.id === o.id ? { ...p, farm: true } : p));
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

const POS: Record<string, string> = { C: '포수', '1B': '1루수', '2B': '2루수', '3B': '3루수', SS: '유격수', LF: '좌익수', CF: '중견수', RF: '우익수', DH: '지명타자' };

export function recommend(team: Team): Rec[] {
  const byId = new Map(team.roster.map((p) => [p.id, p]));
  const out: Rec[] = [];
  const bats = betterBats(team);
  const seen = new Set<string>();
  team.lineup.forEach((l, i) => {
    const p = byId.get(l.pid);
    if (!p) return;
    const cand = bats.get(p.id);
    if (cand) return void out.push({ key: `b${p.id}`, a: cand.id, b: p.id, view: 'field', who: cand.name, to: `${i + 1}번 ${POS[l.pos]}` });
    const j = offPos(p, l.pos) ? homeSwap(team, byId, i) : -1;
    if (j < 0 || seen.has(p.id)) return;
    const q = byId.get(team.lineup[j].pid);
    if (!q) return;
    seen.add(q.id);
    out.push({ key: `p${p.id}`, a: p.id, b: q.id, view: 'field', who: p.name, to: `${POS[team.lineup[j].pos as BatPos]} (${q.name}와 교대)` });
  });
  for (const [pid, { cand }] of betterArms(team)) {
    const ri = team.rotation.indexOf(pid);
    out.push({ key: `a${pid}`, a: cand.id, b: pid, view: 'arms', who: cand.name, to: ri >= 0 ? `${ri + 1}선발` : '마무리' });
  }
  return out;
}

// ───────── 편집기 열기 (선수단 탭 · 선수 카드) ─────────

interface EditorUi {
  open: boolean; // 경기가 없는 날에도 여는 편집기 (개막전·오늘의 오더는 uiStore 의 orderOpen·dailyOpen)
  focus: string | null; // 이 선수가 선택된 채로 연다
  openEditor(focus?: string | null): void;
  close(): void;
}
export const useEditorUi = create<EditorUi>()((set) => ({
  open: false,
  focus: null,
  openEditor: (focus = null) => set({ open: true, focus }),
  close: () => set({ open: false, focus: null }),
}));

export const playerOf = (team: Team, pid: string | null | undefined): Player | undefined => (pid ? team.roster.find((p) => p.id === pid) : undefined);
