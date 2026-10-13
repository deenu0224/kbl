import { josa } from './format';
// 부상 대체 선택 카드: 주전이 다치면 그 자리를 누가 메울지 유저가 고른다.
// 일반 카드 예산·간격과 무관하게 그 경기 직후 한 명씩 뜬다 (대기열: farm.ts subQueue).
// "감독에게 맡긴다"는 자동 처리(farm.ts ilAutoMut · subGapMut)를 그대로 돌린 결과다.
import type { Core, EventCard, Player, Team } from './types';
import { teamParts, type TeamParts } from './ratings';
import { fixLineup, slotValue } from './lineup';
import { IL_AUTO, MIN_BATTERS, MIN_PITCHERS, ROSTER_MAX, activeRoster, farmMax, farmRoster, userTeam } from './economy';
import { memoAdd, memoSet } from './memo';
import { POS_NAME } from './script';
import { addNews } from './season';
import { hintMut } from './campaign';
import { CHARACTERS } from './story';
import { FARM_COACH, FARM_N, farmAutoOn, ilAutoMut, ilMoveMut, markUpMut, subBenchOut, subFarmPick, subGapMut, subHandoverMut, subQueue, subQueueSet, subRole, subSlotKey, type SubRole } from './farm';
import { rowInfo, rowOvr, type Row } from './eventRows';

const posKo = (pos: string): string => POS_NAME[pos] ?? pos;
const sgn = (v: number) => (v > 0 ? `+${v}` : v < 0 ? `−${-v}` : '±0');
const PART: [keyof TeamParts, string][] = [['bat', '타선'], ['def', '수비'], ['rot', '선발'], ['pen', '불펜']];
const roleKo = (r: SubRole) => (r.k === 'L' ? posKo(r.pos) : r.k === 'R' ? `${r.i + 1}선발` : r.k === 'C' ? '마무리' : '필승조');

export interface SubPlan {
  type: 'bench' | 'callup';
  x: Player; // 그 자리에 들어갈 선수
  mover?: Player; // 포지션 재배치: 이 선수가 부상자의 수비 위치로 옮기고 x 가 그의 자리를 맡는다
  out?: Player | null; // 콜업으로 1군이 넘칠 때 내려갈 선수
  score: number;
}

/** 편성만 바꾼다 (mutate). 등록·말소는 applyMut 이 한다 */
function arrange(t: Team, inj: Player, role: SubRole, pl: SubPlan): void {
  const x = pl.x.id;
  if (role.k === 'L') {
    const slot = t.lineup[role.i];
    const ms = pl.mover ? t.lineup.find((s) => s.pid === pl.mover!.id) : undefined;
    slot.pid = x;
    if (ms) {
      slot.pos = ms.pos;
      ms.pos = role.pos;
    }
    return;
  }
  t.bullpen = t.bullpen.filter((id) => id !== x && id !== inj.id);
  if (role.k === 'R') t.rotation[role.i] = x;
  else if (role.k === 'C') t.closer = x;
  else t.bullpen.splice(role.i, 0, x);
  if (role.k !== 'B' && !inj.farm) t.bullpen.push(inj.id);
}

/** 그 부상이 부상자 명단으로 갈 일인가 (자동 운영이 켜져 있고 IL_AUTO 경기 이상) */
const ilDue = (core: Core, inj: Player) => farmAutoOn(core) && !inj.ban && inj.injury >= IL_AUTO;
const minOf = (p: Player) => (p.kind === 'B' ? MIN_BATTERS : MIN_PITCHERS);

/** 대체 후보: 1군 벤치·불펜에서 최대 2명 + 2군 콜업 1명 */
export function subPlans(core: Core, inj: Player, role: SubRole): SubPlan[] {
  const t = userTeam(core);
  const byId = new Map(t.roster.map((p) => [p.id, p]));
  const act = activeRoster(t).filter((p) => p.kind === inj.kind && p.id !== inj.id && p.injury === 0);
  const bench: SubPlan[] = [];
  if (role.k === 'L') {
    const inLu = new Set(t.lineup.map((s) => s.pid));
    for (const x of act.filter((p) => !inLu.has(p.id))) {
      let best: SubPlan = { type: 'bench', x, score: slotValue(x, role.pos) };
      for (const s of t.lineup) {
        const a = byId.get(s.pid);
        if (!a || a.id === inj.id || a.injury > 0 || s.pos === role.pos || s.pos === 'DH' || role.pos === 'DH') continue;
        const score = slotValue(x, s.pos) + slotValue(a, role.pos) - slotValue(a, s.pos);
        if (score > best.score + 1) best = { type: 'bench', x, mover: a, score };
      }
      bench.push(best);
    }
  } else {
    const pen = t.bullpen.map((id) => byId.get(id)).filter((p): p is Player => !!p && p.id !== inj.id && p.injury === 0);
    const pool = role.k === 'B' ? pen.filter((p) => t.bullpen.indexOf(p.id) >= 2) : pen;
    const v = (p: Player) => (role.k === 'R' ? (p.pos === 'SP' ? 100 : 0) + p.sta * 0.3 + p.ovr : role.k === 'C' ? (p.pos === 'CP' ? 100 : 0) + p.stf * 0.6 + p.ctl * 0.4 : p.ovr);
    for (const x of pool) bench.push({ type: 'bench', x, score: v(x) });
  }
  const out = bench.sort((a, b) => b.score - a.score).slice(0, 2);
  // 2군 콜업: 부상자 명단으로 1군 자리가 나거나 빈자리가 있을 때. 가득이면 같은 종류의 최약 벤치를 내린다
  const k = subFarmPick(core, t, inj);
  if (k) {
    const room = activeRoster(t).length - (ilDue(core, inj) ? 1 : 0) < ROSTER_MAX;
    const down = room ? null : inj.injury >= FARM_N.subInjury && farmRoster(t).length < farmMax(core) ? subBenchOut(t, k.kind, [inj.id, ...out.map((p) => p.x.id)]) : null;
    if (room || down) out.push({ type: 'callup', x: k, out: down, score: 0 });
  }
  return out;
}

const partsAfter = (t0: Team, inj: Player, role: SubRole, pl: SubPlan): TeamParts => {
  const t = structuredClone(t0);
  arrange(t, inj, role, pl);
  return teamParts(t);
};
const diffSum = (a: TeamParts, b: TeamParts) => PART.reduce((s, [k]) => s + b[k] - a[k], 0);
const diffTxt = (a: TeamParts, b: TeamParts) => {
  const ds = PART.map(([k, n]) => ({ n, d: b[k] - a[k] })).filter((x) => x.d !== 0).sort((x, y) => Math.abs(y.d) - Math.abs(x.d));
  return ds.length ? ds.slice(0, 2).map((x) => `${x.n} ${sgn(x.d)}`).join(' · ') : '전력 변화 없음';
};
const partRows = (a: TeamParts, b: TeamParts): Row[] => PART.map(([k, n]) => rowOvr(n, a[k], b[k]));

/** 감독(자동 처리)에게 맡긴 결과 (mutate): 대기열에서 빼고 기존 자동 경로를 그대로 돌린다 */
function managerMut(core: Core, inj: Player, notes: string[]): void {
  subQueueSet(core, subQueue(core).filter((id) => id !== inj.id));
  ilAutoMut(core, notes);
  subGapMut(core, notes);
}

/** 감독에게 맡기면 누가 그 자리에 서는가 (표시용. 실제와 같은 함수를 복사본에 돌려 읽는다) */
function managerLook(core: Core, inj: Player, role: SubRole): { name: string; parts: TeamParts; up?: Player; pids: string[] } {
  const c = structuredClone(core);
  const t = userTeam(c);
  const group = (x: Team) => (role.k === 'L' ? x.lineup.map((s) => s.pid) : role.k === 'R' ? x.rotation : role.k === 'C' ? [x.closer ?? ''] : x.bullpen.slice(0, 2));
  const old = new Set(group(t));
  managerMut(c, t.roster.find((p) => p.id === inj.id)!, []);
  const up = t.roster.find((p) => p.subFor === inj.id && !p.farm);
  let who = group(t).map((id) => t.roster.find((p) => p.id === id)).find((p) => !!p && !old.has(p.id));
  if (!who && role.k === 'L') {
    // 짧은 부상: 편성은 그대로 두고 경기마다 벤치가 대신 나선다 (sim.ts gameOrder 와 같은 기준)
    const inLu = new Set(t.lineup.map((s) => s.pid));
    who = activeRoster(t).filter((p) => p.kind === 'B' && p.injury === 0 && !inLu.has(p.id)).sort((a, b) => slotValue(b, role.pos) - slotValue(a, role.pos))[0];
    if (who) t.lineup[role.i].pid = who.id;
  }
  const name = who ? who.name : role.k === 'L' ? '대체 없음' : role.k === 'R' ? '불펜 임시 선발' : '남은 불펜';
  const orig = up ? userTeam(core).roster.find((p) => p.id === up.id) : undefined;
  return { name, parts: teamParts(t), up: orig?.farm ? orig : undefined, pids: [inj.id, ...(who ? [who.id] : [])] };
}

function planLabel(role: SubRole, pl: SubPlan, moverPos?: string): string {
  if (pl.type === 'callup') return `2군 ${pl.x.name} 콜업 (${posKo(pl.x.pos)} ${pl.x.ovr})`;
  // 주전 한 명이 다친 자리로 옮기고, 그가 비운 자리에 벤치 선수가 들어간다
  if (pl.mover && role.k === 'L') return `${pl.mover.name} ${posKo(role.pos)}로 · ${posKo(moverPos ?? pl.mover.pos)}엔 ${pl.x.name}`;
  return `${pl.x.name} (${posKo(pl.x.pos)} ${pl.x.ovr})`;
}

/** 카드를 만든다. 대체할 자리가 없으면(이미 편성에서 빠졌다) null */
export function makeSubCard(core: Core, inj: Player): EventCard | null {
  const t = userTeam(core);
  const role = subRole(t, inj);
  if (!role || inj.farm || inj.injury <= 0) return null;
  const before = teamParts(t);
  const il = ilDue(core, inj) && activeRoster(t).filter((p) => p.kind === inj.kind).length - 1 >= minOf(inj);
  const plans = subPlans(core, inj, role);
  const choices: EventCard['choices'] = plans.map((pl) => {
    const after = partsAfter(t, inj, role, pl);
    const tail = pl.type === 'callup' ? ` · ${pl.out ? `${pl.out.name} 2군행` : '빈자리 사용'}` : '';
    const d = diffTxt(before, after);
    const moverPos = pl.mover ? (t.lineup.find((x) => x.pid === pl.mover!.id)?.pos ?? pl.mover.pos) : undefined;
    const shift = !!pl.mover && role.k === 'L';
    return {
      label: planLabel(role, pl, moverPos),
      desc: pl.type === 'callup' ? `${d.split(' · ')[0]}${tail}` : d,
      detail: {
        rows: [
          ...partRows(before, after),
          // 자리별로 누가 서는지: 옮기는 안은 두 자리가 바뀐다
          ...(shift
            ? [
                rowInfo(roleKo(role), `${pl.mover!.name} ${pl.mover!.ovr}`, `${inj.name} ${inj.ovr}`, pl.mover!.ovr >= inj.ovr ? 'good' : 'bad'),
                rowInfo(posKo(moverPos as never), `${pl.x.name} ${pl.x.ovr}`, `${pl.mover!.name} ${pl.mover!.ovr}`, pl.x.ovr >= pl.mover!.ovr ? 'good' : 'bad'),
              ]
            : [rowInfo(roleKo(role), `${pl.x.name} ${pl.x.ovr}`, `${inj.name} ${inj.ovr}`, pl.x.ovr >= inj.ovr ? 'good' : 'bad')]),
          ...(pl.type === 'callup' ? [rowInfo(pl.x.name, '1군', '2군', 'good'), rowInfo('1군 자리', pl.out ? `${pl.out.name} 2군행` : '빈자리 사용', undefined, pl.out ? 'bad' : 'info')] : []),
        ],
        pids: [inj.id, pl.x.id, ...(pl.mover ? [pl.mover.id] : []), ...(pl.out ? [pl.out.id] : [])],
        compare: [inj.id, pl.x.id] as [string, string],
        lasts: `${inj.name} 복귀까지 (${inj.injury}경기)`,
      },
    };
  });
  const m = managerLook(core, inj, role);
  choices.push({
    label: '감독에게 맡긴다',
    desc: `감독 선택: ${m.name}${m.up ? (m.up.name === m.name ? ' 콜업' : ` · ${m.up.name} 콜업`) : ''}`,
    detail: { rows: [...partRows(before, m.parts), rowInfo(roleKo(role), m.name, `${inj.name} ${inj.ovr}`)], pids: m.pids, ...(m.pids[1] ? { compare: [inj.id, m.pids[1]] as [string, string] } : {}), lasts: `${inj.name} 복귀까지 (${inj.injury}경기)` },
  });
  return {
    id: `sub|${inj.id}`,
    title: '부상 대체',
    icon: '🩹',
    pid: inj.id,
    who: inj.kind === 'B' ? 'manager' : 'pitching',
    line: `${josa(inj.name, '이', '가')} 빠집니다. 누구를 넣을까요.`,
    body: `${inj.name}(${roleKo(role)}) 부상 — ${inj.injury}경기 결장${il ? ' · 부상자 명단으로 옮깁니다 · 1군 자리 +1' : ''}`,
    choices,
  };
}

/** 대기열의 다음 부상자 카드를 campaign.event 에 둔다. 없으면 원본 반환 */
export function drawSubCard(core0: Core): Core {
  if (core0.campaign.event || core0.phase !== 'season' || !subQueue(core0).length) return core0;
  const core = structuredClone(core0);
  const t = userTeam(core);
  const q = subQueue(core);
  let dropped = false;
  while (q.length && !core.campaign.event) {
    const inj = t.roster.find((p) => p.id === q[0]);
    const cd = inj ? makeSubCard(core, inj) : null;
    if (cd) {
      core.campaign.event = cd;
      memoAdd(core, 'subN');
      addNews(core, `${cd.icon} ${CHARACTERS[cd.who as 'manager'].name} ${CHARACTERS[cd.who as 'manager'].title} — ${cd.title}: ${inj!.name}`, 'info');
    } else {
      q.shift();
      dropped = true;
    }
  }
  subQueueSet(core, q);
  // 카드로 만들 수 없는 부상(이미 편성에서 빠졌다)은 자동 처리로 넘긴다
  if (dropped) {
    const notes: string[] = [];
    ilAutoMut(core, notes);
    subGapMut(core, notes);
  }
  return core;
}

/** 전력 손실이 가장 작은 선택지 (봇·점검용) */
export function subBestIdx(core: Core, card: EventCard): number {
  const t = userTeam(core);
  const inj = t.roster.find((p) => p.id === card.pid);
  const role = inj ? subRole(t, inj) : null;
  if (!inj || !role) return card.choices.length - 1;
  const before = teamParts(t);
  const plans = subPlans(core, inj, role);
  let best = card.choices.length - 1;
  let top = diffSum(before, managerLook(core, inj, role).parts);
  plans.forEach((pl, i) => {
    const v = diffSum(before, partsAfter(t, inj, role, pl));
    if (v > top) [best, top] = [i, v];
  });
  return best;
}

/** 선택 적용 (events.ts resolveEvent 가 부른다) */
export function resolveSubCard(core: Core, idx: number, card: EventCard): string {
  const t = userTeam(core);
  const inj = t.roster.find((p) => p.id === card.pid);
  const notes: string[] = [];
  if (!inj) {
    subQueueSet(core, subQueue(core).filter((id) => id !== card.pid));
    return '없던 일이 되었습니다';
  }
  const role = subRole(t, inj);
  const pl = role ? subPlans(core, inj, role)[idx] : undefined;
  memoSet(core, `subdone-${inj.id}`, core.day + inj.injury); // 이 부상은 할 일에 올리지 않는다 (todo.ts)
  hintMut(core, inj.kind === 'B' ? 'lineup' : 'pitchers');
  if (!role || !pl) {
    managerMut(core, inj, notes);
    const sub = t.roster.find((p) => p.subFor === inj.id && !p.farm);
    return sub ? `감독이 ${josa(sub.name, '을', '를')} 올렸습니다` : '감독이 알아서 메웁니다';
  }
  subQueueSet(core, subQueue(core).filter((id) => id !== inj.id));
  const moverPos = pl.mover ? t.lineup.find((s) => s.pid === pl.mover!.id)?.pos : undefined;
  arrange(t, inj, role, pl);
  memoSet(core, subSlotKey(inj.id), role.k === 'L' ? ['L', role.i, role.pos, pl.mover?.id ?? '', moverPos ?? ''].join('~') : role.k);
  // 이미 다른 부상자의 대체로 뛰던 선수는 그 표시를 유지한다
  if (!pl.x.subFor) {
    // 다친 선수가 다른 부상자의 대체로 뛰던 중이었으면, 새 대체 선수가 그 역할을 넘겨받는다 (원래 주인이 돌아오면 그 칸을 돌려준다)
    const root = inj.subFor ? t.roster.find((p) => p.id === inj.subFor) : undefined;
    if (root && subHandoverMut(core, root, inj)) {
      pl.x.subFor = root.id;
      delete inj.subFor;
      delete inj.subFrom;
    } else pl.x.subFor = inj.id;
    if (pl.type === 'bench') pl.x.subFrom = 'bench';
  }
  if (pl.type === 'callup') {
    markUpMut(core, pl.x);
    delete pl.x.farm;
    delete pl.x.farmUntil;
  }
  // 부상자 명단: 최소 인원이 지켜질 때만 (콜업이면 인원은 그대로다)
  let tail = '';
  if (ilDue(core, inj) && activeRoster(t).filter((p) => p.kind === inj.kind).length - 1 >= minOf(inj)) {
    const games = inj.injury;
    ilMoveMut(core, inj);
    tail = ` — ${inj.name} 부상자 명단(${games}경기)`;
  }
  if (pl.type === 'callup' && activeRoster(t).length > ROSTER_MAX && pl.out) {
    pl.out.farm = true;
    delete pl.out.tired;
    delete pl.out.subFor;
    delete pl.out.subFrom;
    delete pl.out.farmUntil;
    tail += ` · ${pl.out.name} 2군행`;
  }
  fixLineup(t);
  if (pl.type === 'callup') addNews(core, `${FARM_COACH}${inj.name} 부상(${inj.injury}경기) 공백에 ${pl.x.name}(${posKo(pl.x.pos)} 오버롤 ${pl.x.ovr}) 콜업`, 'info');
  return `${josa(pl.x.name, '이', '가')} ${inj.name}의 자리(${roleKo(role)})를 맡습니다${tail}`;
}
