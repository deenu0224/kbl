import type { BatPos, LineupSlot, Player, Team } from './types';
import { batValue, effDef } from './ratings';

// 수비 위치를 채우는 순서(희소한 포지션부터)와 수비 비중
const FIELD_ORDER: BatPos[] = ['C', 'SS', 'CF', '2B', '3B', 'RF', 'LF', '1B'];
const DEF_WEIGHT: Record<BatPos, number> = {
  C: 0.7, SS: 0.7, CF: 0.6, '2B': 0.5, '3B': 0.45, RF: 0.4, LF: 0.35, '1B': 0.3, DH: 0,
};
const ALL_POS: BatPos[] = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH'];

/** 특정 수비 위치에 세웠을 때의 가치 */
export function slotValue(p: Player, pos: BatPos): number {
  return batValue(p) + effDef(p, pos) * DEF_WEIGHT[pos];
}

function best<T>(arr: T[], score: (x: T) => number): T | undefined {
  let top: T | undefined;
  let topV = -Infinity;
  for (const x of arr) {
    const v = score(x);
    if (v > topV) {
      topV = v;
      top = x;
    }
  }
  return top;
}

function buildBatting(t: Team): void {
  const pool = t.roster.filter((p) => p.kind === 'B');
  const chosen: { p: Player; pos: BatPos }[] = [];
  const take = (pos: BatPos) => {
    const p = best(pool, (x) => slotValue(x, pos));
    if (!p) return;
    pool.splice(pool.indexOf(p), 1);
    chosen.push({ p, pos });
  };
  // DH 감은 미리 빼두지 않고, 수비 8자리를 먼저 채운 뒤 남은 최고 타자를 DH 로
  for (const pos of FIELD_ORDER) take(pos);
  take('DH');

  // 타순: 1번 출루+주력, 3번 최고 타자, 4번 최고 파워, 나머지는 타격순
  const rest = chosen.slice();
  const pull = (score: (x: { p: Player; pos: BatPos }) => number) => {
    const x = best(rest, score);
    if (x) rest.splice(rest.indexOf(x), 1);
    return x;
  };
  const order: ({ p: Player; pos: BatPos } | undefined)[] = new Array(9).fill(undefined);
  order[2] = pull((x) => batValue(x.p));
  order[3] = pull((x) => x.p.pow * 0.6 + x.p.con * 0.4);
  order[0] = pull((x) => x.p.eye * 0.4 + x.p.con * 0.3 + x.p.spd * 0.3);
  for (const i of [1, 4, 5, 6, 7, 8]) order[i] = pull((x) => batValue(x.p));
  t.lineup = order
    .filter((x): x is { p: Player; pos: BatPos } => !!x)
    .map((x): LineupSlot => ({ pid: x.p.id, pos: x.pos }));
}

function buildPitching(t: Team): void {
  const pool = t.roster.filter((p) => p.kind === 'P');
  const byOvr = (a: Player, b: Player) => b.ovr - a.ovr;
  const sp = pool.filter((p) => p.pos === 'SP').sort(byOvr);
  const others = pool.filter((p) => p.pos !== 'SP');
  const rot = sp.slice(0, 5);
  let rest = [...sp.slice(5), ...others];
  // 선발 자원이 모자라면 체력 좋은 순으로 채운다(불펜 최소 2명은 남김)
  while (rot.length < 5 && rest.length > 2) {
    const p = best(rest, (x) => x.sta + x.ovr * 0.5)!;
    rest.splice(rest.indexOf(p), 1);
    rot.push(p);
  }
  const closer =
    best(rest.filter((p) => p.pos === 'CP'), (p) => p.ovr) ?? (rest.length > 1 ? best(rest, (p) => p.stf * 0.6 + p.ctl * 0.4) : undefined);
  if (closer) rest = rest.filter((p) => p !== closer);
  t.rotation = rot.map((p) => p.id);
  t.closer = closer ? closer.id : null;
  t.bullpen = rest.sort(byOvr).map((p) => p.id);
  t.nextStarter = t.rotation.length ? t.nextStarter % t.rotation.length : 0;
}

/** 타선·선발·불펜·마무리를 처음부터 재구성 */
export function autoLineup(t: Team): void {
  buildBatting(t);
  buildPitching(t);
}

/** 로스터 변동 후 무효 항목 정리 + 빈칸 채움. 유효한 기존 항목은 그대로 둔다. */
export function fixLineup(t: Team): void {
  const batters = new Map(t.roster.filter((p) => p.kind === 'B').map((p) => [p.id, p]));
  const pitchers = new Map(t.roster.filter((p) => p.kind === 'P').map((p) => [p.id, p]));

  // ── 타선 ──
  const posOk =
    t.lineup.length === 9 && ALL_POS.every((pos) => t.lineup.filter((s) => s.pos === pos).length === 1);
  if (!posOk) {
    buildBatting(t);
  } else {
    const used = new Set<string>();
    const holes: number[] = [];
    t.lineup.forEach((s, i) => {
      if (batters.has(s.pid) && !used.has(s.pid)) used.add(s.pid);
      else holes.push(i);
    });
    for (const i of holes) {
      const pos = t.lineup[i].pos;
      const cand = [...batters.values()].filter((p) => !used.has(p.id));
      const healthy = cand.filter((p) => p.injury === 0);
      const p = best(healthy.length ? healthy : cand, (x) => slotValue(x, pos));
      if (p) {
        used.add(p.id);
        t.lineup[i] = { pid: p.id, pos };
      }
    }
    // 타자가 9명 미만이라 못 채운 칸은 제거(시뮬은 가변 길이 타순을 허용)
    t.lineup = t.lineup.filter((s) => used.has(s.pid) && batters.has(s.pid));
  }

  // ── 투수 ──
  const uniq = (ids: string[]) => ids.filter((id, i) => pitchers.has(id) && ids.indexOf(id) === i);
  t.rotation = uniq(t.rotation).slice(0, 5);
  if (t.closer && (!pitchers.has(t.closer) || t.rotation.includes(t.closer))) t.closer = null;
  t.bullpen = uniq(t.bullpen).filter((id) => !t.rotation.includes(id) && id !== t.closer);
  const assigned = new Set([...t.rotation, ...t.bullpen, ...(t.closer ? [t.closer] : [])]);
  const loose = [...pitchers.values()].filter((p) => !assigned.has(p.id)).sort((a, b) => b.ovr - a.ovr);
  for (const p of loose) t.bullpen.push(p.id);
  while (t.rotation.length < 5 && t.bullpen.length > 2) {
    const pen = t.bullpen.map((id) => pitchers.get(id)!);
    const p = best(pen, (x) => (x.pos === 'SP' ? 100 : 0) + x.sta + x.ovr * 0.5)!;
    t.bullpen.splice(t.bullpen.indexOf(p.id), 1);
    t.rotation.push(p.id);
  }
  if (!t.closer && t.bullpen.length > 1) {
    const pen = t.bullpen.map((id) => pitchers.get(id)!);
    const p = best(pen, (x) => (x.pos === 'CP' ? 100 : 0) + x.stf * 0.6 + x.ctl * 0.4)!;
    t.bullpen.splice(t.bullpen.indexOf(p.id), 1);
    t.closer = p.id;
  }
  t.nextStarter = t.rotation.length ? t.nextStarter % t.rotation.length : 0;
}

/**
 * 새로 영입한 선수를 역할에 끼워 넣는다. 같은 자리의 기존 선수보다 나을 때만 주전으로,
 * 아니면 벤치/불펜에 둔다. 반환값은 맡게 된 역할 설명.
 */
export function slotNewcomer(t: Team, p: Player): string {
  const byId = new Map(t.roster.map((x) => [x.id, x]));
  if (p.kind === 'B') {
    const tryPos = (pos: BatPos): boolean => {
      const slot = t.lineup.find((s) => s.pos === pos);
      if (!slot) return false;
      const cur = byId.get(slot.pid);
      if (cur && slotValue(cur, pos) >= slotValue(p, pos)) return false;
      slot.pid = p.id;
      return true;
    };
    const placed = (p.pos !== 'DH' && tryPos(p.pos as BatPos)) || tryPos('DH');
    if (placed) {
      // 타순도 실력에 맞게: 3번 → 4번 → 1번 … 순으로 자기보다 약한 타자의 자리와 맞바꾼다
      const me = t.lineup.findIndex((s) => s.pid === p.id);
      for (const i of [2, 3, 0, 1, 4, 5, 6, 7, 8]) {
        if (i === me) break;
        const cur = t.lineup[i] ? byId.get(t.lineup[i].pid) : undefined;
        if (cur && batValue(cur) < batValue(p)) {
          [t.lineup[i], t.lineup[me]] = [t.lineup[me], t.lineup[i]];
          break;
        }
      }
    }
    fixLineup(t);
    return placed ? '주전 라인업' : '벤치';
  }
  let role = '불펜';
  if (p.pos === 'SP') {
    if (t.rotation.length < 5) {
      t.rotation.push(p.id);
      role = '선발 로테이션';
    } else {
      const worst = best(t.rotation.map((id) => byId.get(id)!).filter(Boolean), (x) => -x.ovr);
      if (worst && worst.ovr < p.ovr) {
        t.rotation[t.rotation.indexOf(worst.id)] = p.id;
        t.bullpen.push(worst.id);
        role = '선발 로테이션';
      }
    }
    if (role !== '불펜') t.rotation.sort((a, b) => (byId.get(b)?.ovr ?? 0) - (byId.get(a)?.ovr ?? 0));
  } else if (p.pos === 'CP') {
    const cur = t.closer ? byId.get(t.closer) : undefined;
    if (!cur || cur.ovr < p.ovr) {
      if (cur) t.bullpen.unshift(cur.id);
      t.closer = p.id;
      role = '마무리';
    }
  }
  if (role === '불펜') {
    // 불펜은 좋은 투수가 앞(필승조)
    const idx = t.bullpen.findIndex((id) => (byId.get(id)?.ovr ?? 0) < p.ovr);
    if (idx < 0) t.bullpen.push(p.id);
    else t.bullpen.splice(idx, 0, p.id);
  }
  fixLineup(t);
  return role;
}
