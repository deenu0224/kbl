import type { BatPos, LineupSlot, Player, Team } from './types';
import { batValue, effDef } from './ratings';

// 1군 등록 선수만 (economy.activeRoster 와 같다 — 순환 import 를 피하려고 여기에 둔다)
const active = (t: Team): Player[] => t.roster.filter((p) => !p.farm);

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

// ── 감독의 편성 (LEVEL_DESIGN 3절): 나이·연봉(이름값)에 가중치를 둔다 ──
const MGR_AGE = 3.0; // 27세 기준 1살당 가산
const MGR_SALARY = 1.5; // 연봉 1억당 가산
type Bias = (p: Player) => number;
const noBias: Bias = () => 0;
const mgrBias: Bias = (p) => (p.age - 27) * MGR_AGE + (p.salary / 10000) * MGR_SALARY;

/**
 * 고른 9명 안에서 수비 위치를 다시 나눈다: 둘이 자리를 바꿔 낯선 자리의 페널티 합이 줄면 바꾼다.
 * (자리를 순서대로 채우다 보면 서로 자리가 엇갈린 채 남는 경우가 있다 — 타자 구성은 그대로다)
 */
function tidyDefense(chosen: { p: Player; pos: BatPos }[]): void {
  const pen = (p: Player, pos: BatPos) => (pos === 'DH' ? 0 : p.def - effDef(p, pos));
  for (let pass = 0; pass < 4; pass++) {
    let moved = false;
    for (let i = 0; i < chosen.length; i++) {
      for (let j = i + 1; j < chosen.length; j++) {
        const a = chosen[i];
        const b = chosen[j];
        const now = pen(a.p, a.pos) + pen(b.p, b.pos);
        const alt = pen(a.p, b.pos) + pen(b.p, a.pos);
        const gain = slotValue(a.p, b.pos) + slotValue(b.p, a.pos) - slotValue(a.p, a.pos) - slotValue(b.p, b.pos);
        if (alt < now || (alt === now && gain > 0.001)) {
          [a.pos, b.pos] = [b.pos, a.pos];
          moved = true;
        }
      }
    }
    if (!moved) break;
  }
}

function buildBatting(t: Team, bias: Bias = noBias): void {
  const pool = active(t).filter((p) => p.kind === 'B');
  const chosen: { p: Player; pos: BatPos }[] = [];
  const take = (pos: BatPos) => {
    const p = best(pool, (x) => slotValue(x, pos) + bias(x));
    if (!p) return;
    pool.splice(pool.indexOf(p), 1);
    chosen.push({ p, pos });
  };
  // DH 감은 미리 빼두지 않고, 수비 8자리를 먼저 채운 뒤 남은 최고 타자를 DH 로
  for (const pos of FIELD_ORDER) take(pos);
  take('DH');
  tidyDefense(chosen);

  // 타순: 1번 출루+주력, 3번 최고 타자, 4번 최고 파워, 나머지는 타격순
  const rest = chosen.slice();
  const pull = (score: (x: { p: Player; pos: BatPos }) => number) => {
    const x = best(rest, score);
    if (x) rest.splice(rest.indexOf(x), 1);
    return x;
  };
  const order: ({ p: Player; pos: BatPos } | undefined)[] = new Array(9).fill(undefined);
  order[2] = pull((x) => batValue(x.p) + bias(x.p));
  order[3] = pull((x) => x.p.pow * 0.6 + x.p.con * 0.4 + bias(x.p));
  order[0] = pull((x) => x.p.eye * 0.4 + x.p.con * 0.3 + x.p.spd * 0.3);
  for (const i of [1, 4, 5, 6, 7, 8]) order[i] = pull((x) => batValue(x.p) + bias(x.p));
  t.lineup = order
    .filter((x): x is { p: Player; pos: BatPos } => !!x)
    .map((x): LineupSlot => ({ pid: x.p.id, pos: x.pos }));
}

function buildPitching(t: Team, bias: Bias = noBias): void {
  const pool = active(t).filter((p) => p.kind === 'P');
  const byOvr = (a: Player, b: Player) => b.ovr + bias(b) - (a.ovr + bias(a));
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
    best(rest.filter((p) => p.pos === 'CP'), (p) => p.ovr + bias(p)) ?? (rest.length > 1 ? best(rest, (p) => p.stf * 0.6 + p.ctl * 0.4) : undefined);
  if (closer) rest = rest.filter((p) => p !== closer);
  t.rotation = rot.map((p) => p.id);
  t.closer = closer ? closer.id : null;
  t.bullpen = rest.sort(byOvr).map((p) => p.id);
  t.nextStarter = t.rotation.length ? t.nextStarter % t.rotation.length : 0;
}

/** 타선만 최적으로 재구성 */
export function autoBatting(t: Team): void {
  buildBatting(t);
}

/** 선발·불펜·마무리만 최적으로 재구성 */
export function autoPitching(t: Team): void {
  buildPitching(t);
}

/** 타선·선발·불펜·마무리를 처음부터 재구성 */
export function autoLineup(t: Team): void {
  buildBatting(t);
  buildPitching(t);
}

/** 감독에게 맡기기: 나이·연봉에 가중치를 둔 편성 (0장 클리어 전 유저 팀의 [자동 편성]) */
export function managerLineup(t: Team): void {
  // 타선: 자리는 제대로 채우되, 같은 포지션(또는 지명타자)에 이름값이 더 큰 선수가 있으면 그를 쓴다
  buildBatting(t);
  const byId = new Map(t.roster.map((p) => [p.id, p]));
  const used = new Set(t.lineup.map((s) => s.pid));
  for (const slot of t.lineup) {
    const cur = byId.get(slot.pid);
    if (!cur) continue;
    const cands = active(t).filter((p) => p.kind === 'B' && !used.has(p.id) && (p.pos === slot.pos || slot.pos === 'DH'));
    const sub = best(cands, (p) => slotValue(p, slot.pos) + mgrBias(p));
    if (sub && slotValue(sub, slot.pos) + mgrBias(sub) > slotValue(cur, slot.pos) + mgrBias(cur)) {
      used.delete(cur.id);
      used.add(sub.id);
      slot.pid = sub.id;
    }
  }
  buildPitching(t, mgrBias);
}

// 고장의 정도 (scripts/firstgames.ts 로 맞춘다: 고장 난 채 12경기 승률 ≈ .30 이하, 고치면 ≈ .50)
export const BROKEN = {
  benched: 3, // 벤치로 밀려난 상위 타자 수 (그 자리는 포지션이 안 맞는 벤치 최고령이 맡는다)
  misfit: 3, // 서로 수비 위치를 바꿔 선 주전 쌍
  weakTop: 2, // 최약 타자를 4번·3번에
  acesToPen: 3, // 불펜으로 간 상위 선발 수 (그 자리는 불펜 최고령이 선발로)
  closerSwap: true, // 마무리 ↔ 불펜 맨 뒤
};
// 수비 위치를 맞바꿀 쌍 (앞에서부터 misfit 개)
const MISFIT_PAIRS: [BatPos, BatPos][] = [['SS', '1B'], ['C', 'LF'], ['CF', '3B']];

/**
 * 0장의 "고장 난 타순": 전임 체제의 유산. 감독의 편성에서 한 번 더 어긋나게 만든다.
 * 상위 타자가 벤치 · 최약 타자가 중심 타선 · 포지션 불일치 · 상위 선발이 불펜. 고치는 건 무료·가역.
 */
export function breakLineup(t: Team, lv: typeof BROKEN = BROKEN): void {
  managerLineup(t);
  const byId = new Map(t.roster.map((p) => [p.id, p]));
  const inLineup = () => t.lineup.map((s) => byId.get(s.pid)).filter((p): p is Player => !!p);
  // 1) 상위 타자 → 벤치. 대신 포지션이 안 맞는 벤치 최고령이 그 자리를 맡는다
  const out = new Set<string>();
  for (let n = 0; n < lv.benched; n++) {
    const top = best(inLineup().filter((p) => !out.has(p.id)), (p) => batValue(p));
    const used = new Set(t.lineup.map((s) => s.pid));
    const bench = active(t).filter((p) => p.kind === 'B' && !used.has(p.id) && !out.has(p.id));
    if (!top || !bench.length) break;
    const slot = t.lineup.find((s) => s.pid === top.id)!;
    const sub = best(bench, (p) => (p.pos !== slot.pos && slot.pos !== 'DH' ? 100 : 0) + p.age)!;
    slot.pid = sub.id;
    out.add(top.id);
    out.add(sub.id);
  }
  // 2) 주전끼리 수비 위치를 바꿔 선다
  for (const [a, b] of MISFIT_PAIRS.slice(0, lv.misfit)) {
    const sa = t.lineup.find((s) => s.pos === a);
    const sb = t.lineup.find((s) => s.pos === b);
    if (sa && sb) [sa.pos, sb.pos] = [sb.pos, sa.pos];
  }
  // 3) 최약 타자 → 4번, 그다음 → 3번
  for (const at of [3, 2].slice(0, lv.weakTop)) {
    const placed = new Set([3, 2].filter((i) => i > at).map((i) => t.lineup[i]?.pid));
    const worst = best(inLineup().filter((p) => !placed.has(p.id)), (p) => -batValue(p));
    if (worst && t.lineup.length > at) {
      const i = t.lineup.findIndex((s) => s.pid === worst.id);
      if (i >= 0 && i !== at) [t.lineup[i], t.lineup[at]] = [t.lineup[at], t.lineup[i]];
    }
  }
  // 4) 상위 선발 ↔ 불펜 최고령
  for (let n = 0; n < lv.acesToPen; n++) {
    const rot = t.rotation.map((id) => byId.get(id)).filter((p): p is Player => !!p && p.pos === 'SP');
    const pen = t.bullpen.map((id) => byId.get(id)).filter((p): p is Player => !!p && p.pos !== 'SP');
    const ace = best(rot, (p) => p.ovr);
    const old = best(pen, (p) => p.age - p.sta * 0.1);
    if (!ace || !old) break;
    t.rotation[t.rotation.indexOf(ace.id)] = old.id;
    t.bullpen[t.bullpen.indexOf(old.id)] = ace.id;
  }
  // 5) 마무리 ↔ 불펜 맨 뒤(추격조)
  if (lv.closerSwap && t.closer && t.bullpen.length) {
    const i = t.bullpen.length - 1;
    [t.closer, t.bullpen[i]] = [t.bullpen[i], t.closer];
  }
  t.nextStarter = 0;
}

/** 로스터 변동 후 무효 항목 정리 + 빈칸 채움. 유효한 기존 항목은 그대로 둔다. */
export function fixLineup(t: Team): void {
  const batters = new Map(active(t).filter((p) => p.kind === 'B').map((p) => [p.id, p]));
  const pitchers = new Map(active(t).filter((p) => p.kind === 'P').map((p) => [p.id, p]));

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
  // 다쳤거나 징계 중이면 주전·로테이션·마무리에 넣지 않는다 (2군에서 올리면 바로 주전이 되어 멀쩡한 주전이 밀렸다)
  const out = p.injury > 0 || (p.ban ?? 0) > 0;
  if (p.kind === 'B') {
    const tryPos = (pos: BatPos): boolean => {
      if (out) return false;
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
  if (out) {
    // 불펜 맨 뒤 (아래에서 끼워 넣지 않게)
  } else if (p.pos === 'SP') {
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
  if (role === '불펜' && out) t.bullpen.push(p.id);
  else if (role === '불펜') {
    // 불펜은 좋은 투수가 앞(필승조)
    const idx = t.bullpen.findIndex((id) => (byId.get(id)?.ovr ?? 0) < p.ovr);
    if (idx < 0) t.bullpen.push(p.id);
    else t.bullpen.splice(idx, 0, p.id);
  }
  fixLineup(t);
  return role;
}
