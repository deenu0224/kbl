import type { BatPos, Player, Team } from './types';
import { effDef } from './ratings';
import { fixLineup } from './lineup';

// ───────── 편성 문제 판정 (탭의 ▲·본 포지션 태그와 오더지 배지가 같이 쓴다) ─────────

/** 본 포지션이 아닌 자리에서 수비가 깎이는 주전인지 */
export const offPos = (p: Player, pos: BatPos): boolean => pos !== 'DH' && p.pos !== pos && effDef(p, pos) < p.def;

/**
 * 제자리 찾기: i번 주전의 본 포지션 자리에 서 있는 주전의 슬롯.
 * 둘이 수비 위치를 맞바꿔 낯선 자리 페널티 합이 줄 때만 (아니면 -1)
 */
export function homeSwap(team: Team, byId: Map<string, Player>, i: number): number {
  const a = team.lineup[i];
  const p = a && byId.get(a.pid);
  if (!p) return -1;
  const j = team.lineup.findIndex((l) => l.pos === p.pos);
  const q = j >= 0 && j !== i ? byId.get(team.lineup[j].pid) : undefined;
  if (!q) return -1;
  const b = team.lineup[j];
  const pen = (x: Player, pos: BatPos) => (pos === 'DH' ? 0 : x.def - effDef(x, pos));
  return pen(p, b.pos) + pen(q, a.pos) < pen(p, a.pos) + pen(q, b.pos) ? j : -1;
}

/** 벤치에 그 자리를 볼 수 있는 더 높은 OVR 이 있는 주전 (지명타자 자리는 다른 줄에 안 걸린 선수만) */
export function betterBats(team: Team): Map<string, Player> {
  const byId = new Map(team.roster.map((p) => [p.id, p]));
  const inLineup = new Set(team.lineup.map((l) => l.pid));
  const bench = team.roster.filter((p) => p.kind === 'B' && !inLineup.has(p.id)).sort((a, b) => b.ovr - a.ovr);
  const out = new Map<string, Player>();
  const shown = new Set<string>();
  const mark = (dh: boolean) => {
    for (const l of team.lineup) {
      if ((l.pos === 'DH') !== dh) continue;
      const cur = byId.get(l.pid);
      if (!cur) continue;
      const cand = bench.find((p) => p.injury === 0 && p.ovr > cur.ovr && (dh ? !shown.has(p.id) : p.pos === l.pos));
      if (cand) {
        out.set(l.pid, cand);
        shown.add(cand.id);
      }
    }
  };
  mark(false);
  mark(true);
  return out;
}

/**
 * 불펜·마무리 자리에 선발보다 높은 선발 투수가 있으면 로테이션에서 가장 처지는 자리에,
 * 불펜에 더 나은 마무리 투수가 있으면 마무리 자리에 표시한다
 */
export function betterArms(team: Team): Map<string, { cand: Player; from: string }> {
  const byId = new Map(team.roster.map((p) => [p.id, p]));
  const out = new Map<string, { cand: Player; from: string }>();
  const ok = (p: Player | undefined): p is Player => !!p && p.injury === 0;
  const rot = team.rotation.map((id) => byId.get(id)).filter((p): p is Player => !!p);
  const pen = team.bullpen.map((id) => byId.get(id)).filter(ok);
  const cl = team.closer ? byId.get(team.closer) : undefined;
  const sps = [...pen, ...(ok(cl) ? [cl] : [])].filter((p) => p.pos === 'SP');
  if (rot.length && sps.length) {
    const top = sps.reduce((a, b) => (a.ovr >= b.ovr ? a : b));
    const val = (p: Player) => p.ovr - (p.pos === 'SP' ? 0 : 100);
    const low = rot.reduce((a, b) => (val(a) <= val(b) ? a : b));
    if (low.pos !== 'SP' || low.ovr < top.ovr) out.set(low.id, { cand: top, from: top === cl ? '마무리' : '불펜' });
  }
  const cps = pen.filter((p) => p.pos === 'CP');
  if (cl && cl.pos !== 'CP' && cps.length) {
    const top = cps.reduce((a, b) => (a.ovr >= b.ovr ? a : b));
    if (cl.pos === 'SP' || top.ovr > cl.ovr) out.set(cl.id, { cand: top, from: '불펜' });
  }
  return out;
}

/** 오더지 배지: 고칠 줄의 수. 타선 = ▲벤치 또는 ⇄ 제자리 칩이 붙은 줄 (맞바꿀 자리가 없는 본 포지션 불일치는 태그만), 투수 = 불펜에 밀려나 있는 더 나은 선발 수 + 마무리 자리 */
export function orderIssues(team: Team): { lineup: number; pitchers: number } {
  const byId = new Map(team.roster.map((p) => [p.id, p]));
  const better = betterBats(team);
  const lineup = team.lineup.filter((l, i) => {
    const p = byId.get(l.pid);
    return !!p && (better.has(l.pid) || (offPos(p, l.pos) && homeSwap(team, byId, i) >= 0));
  }).length;
  // 선발: 불펜·마무리에 있는 선발 투수를 높은 순으로, 로테이션을 낮은 순으로 짝지어 바꿔야 할 자리 수를 센다
  const ok = (p: Player | undefined): p is Player => !!p && p.injury === 0;
  const val = (p: Player) => p.ovr - (p.pos === 'SP' ? 0 : 100);
  const rot = team.rotation.map((id) => byId.get(id)).filter((p): p is Player => !!p).sort((a, b) => val(a) - val(b));
  const cl = team.closer ? byId.get(team.closer) : undefined;
  const out = [...team.bullpen.map((id) => byId.get(id)), cl].filter(ok).filter((p) => p.pos === 'SP').sort((a, b) => b.ovr - a.ovr);
  let pitchers = 0;
  for (let k = 0; k < Math.min(rot.length, out.length); k++) if (val(rot[k]) < out[k].ovr) pitchers++;
  const arms = betterArms(team);
  if (cl && arms.has(cl.id)) pitchers++;
  return { lineup, pitchers: Math.max(pitchers, arms.size) };
}

// ───────── 한 번에 고치기 (주간 브리핑의 편성 제안 · 봇) ─────────

type PLoc = { k: 'rot'; i: number } | { k: 'pen'; i: number } | { k: 'cl' } | null;
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

/** 연투 피로(2일 이상)인데 필승조 맨 앞(마무리·불펜 1번)에 선 투수와, 그 자리를 대신할 쉰 불펜 투수 */
export function tiredFront(team: Team): { tired: Player; fresh: Player | null } | null {
  const byId = new Map(team.roster.map((p) => [p.id, p]));
  const front = [team.bullpen[0], team.closer].map((id) => (id ? byId.get(id) : undefined)).filter((p): p is Player => !!p && (p.tired ?? 0) >= 2);
  const tired = front[0];
  if (!tired) return null;
  const fresh = team.bullpen
    .slice(1)
    .map((id) => byId.get(id))
    .filter((p): p is Player => !!p && p.injury === 0 && !(p.tired ?? 0) && p.id !== tired.id)
    .sort((a, b) => b.ovr - a.ovr)[0];
  return { tired, fresh: fresh ?? null };
}

/** 오늘 고칠 곳: 오더지 배지(타선·투수) + 부상자가 주전/로테이션에 있음 + 연투 2일 이상이 필승조 맨 앞 */
export function todayIssues(team: Team): number {
  const o = orderIssues(team);
  const byId = new Map(team.roster.map((p) => [p.id, p]));
  const hurt = [...team.lineup.map((l) => l.pid), ...team.rotation].filter((id) => (byId.get(id)?.injury ?? 0) > 0).length;
  return o.lineup + o.pitchers + hurt + (tiredFront(team) ? 1 : 0);
}

/** 칩(▲벤치 · ⇄제자리 · ▲불펜)을 전부 한 번에 적용한다 (mutate). 적용한 칩 수를 돌려준다 */
export function applyFixes(t: Team): number {
  let n = 0;
  for (let guard = 0; guard < 30; guard++) {
    const byId = new Map(t.roster.map((p) => [p.id, p]));
    const bats = betterBats(t);
    const bi = t.lineup.findIndex((l) => bats.has(l.pid));
    if (bi >= 0) {
      t.lineup[bi] = { ...t.lineup[bi], pid: bats.get(t.lineup[bi].pid)!.id };
      n++;
      continue;
    }
    let swapped = false;
    for (let i = 0; i < t.lineup.length && !swapped; i++) {
      const p = byId.get(t.lineup[i].pid);
      const j = p && offPos(p, t.lineup[i].pos) ? homeSwap(t, byId, i) : -1;
      if (j < 0) continue;
      const a = t.lineup[i].pos;
      t.lineup[i] = { ...t.lineup[i], pos: t.lineup[j].pos };
      t.lineup[j] = { ...t.lineup[j], pos: a };
      swapped = true;
    }
    if (swapped) {
      n++;
      continue;
    }
    const arms = [...betterArms(t)][0];
    if (arms) {
      const [pid, { cand }] = arms;
      const la = ploc(t, pid);
      const lb = ploc(t, cand.id);
      pput(t, la, cand.id);
      pput(t, lb, pid);
      n++;
      continue;
    }
    break;
  }
  if ([...t.lineup.map((l) => l.pid), ...t.rotation].some((id) => (t.roster.find((p) => p.id === id)?.injury ?? 0) > 0)) {
    fixLineup(t);
    n++;
  }
  return n;
}
