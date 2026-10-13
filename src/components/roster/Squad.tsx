import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { BatPos, Player } from '../../game/types';
import type { PosKey, PosRow } from '../../game/analysis';
import { FARM_MAX } from '../../game/economy';
import { applyFixes, offPos } from '../../game/fixes';
import { farmLockLeft } from '../../game/season';
import { useCore, useStore, useUserTeam } from '../../store';
import { FarmMoveButton, PART_LABEL, ReleaseButton, usePartsDelta } from '../LeftPanel';
import Help from '../Help';
import Dialog from '../layout/Dialog';
import { useUi, type SquadView } from '../layout/uiStore';
import { useWinChance } from '../useWinChance';
import { OvrBadge, POS_FULL, POS_KO } from '../ui';
import PenStyleBar, { ArmState } from './PenStyle';
import RosterList, { CardPop, goMarket } from './RosterList';
import { EMPTY_CLOSER, POS, groupOf, planCloser, planEdit, recommend, slotCandidates, snapOf, type Plan, type PlanResult } from './editorOps';
import { rankTone, usePosReport, useRosterUi } from './rosterUi';

const HOLD_MS = 150; // 이만큼 누르고 있으면 끌기 시작
const SLOP = 8; // 이만큼 끌면 끌기 시작 (px)
const HINT_KEY = 'kbl-editor-hint-v1';
const DELTA_MS = 2000;

const isPlan = (r: PlanResult | undefined): r is Plan => !!r && 'after' in r;
const errOf = (r: PlanResult | undefined): string | null => (r && 'error' in r ? r.error : null);

/** 야수 화면: 자리별 좌표 (%, 칸의 중심) */
const SPOT: Record<BatPos, [number, number]> = {
  CF: [50, 9],
  LF: [17, 21],
  RF: [83, 21],
  SS: [34, 41],
  '2B': [66, 41],
  '3B': [17, 62],
  '1B': [83, 62],
  C: [50, 87],
  DH: [17, 87],
};
// 칸 색 = 그 자리의 리그 순위 (숫자는 자리 시트에서)
const TONE_BG = { good: '#27452f', mid: '#2e3954', bad: '#4a2630' } as const;
const TONE_EDGE = { good: '#6ee07a', mid: '#0f1420', bad: '#ff6b6b' } as const;
const TONE_TEXT = { good: 'text-good', mid: 'text-white', bad: 'text-bad' } as const;

function hintSeen(): boolean {
  try {
    return localStorage.getItem(HINT_KEY) === '1';
  } catch {
    return true;
  }
}

/** 맨 위 한 줄: 전력 4칸 + 다음 경기 승리 확률. 편성을 바꾸면 변한 칸이 "49→57"로 잠깐 보인다 */
function StrengthLine() {
  const team = useUserTeam();
  const { parts, delta } = usePartsDelta(team);
  const pct = useWinChance();
  const [from, setFrom] = useState<number | null>(null);
  const last = useRef<number | null>(null);
  useEffect(() => {
    if (pct === null) return;
    if (last.current !== null && last.current !== pct) setFrom(last.current);
    last.current = pct;
  }, [pct]);
  useEffect(() => {
    if (from === null) return;
    const id = setTimeout(() => setFrom(null), DELTA_MS);
    return () => clearTimeout(id);
  }, [from, pct]);
  const cTone = from === null || pct === null ? 'text-hi' : pct > from ? 'text-good' : 'text-bad';
  return (
    <div className="flex shrink-0 items-center gap-1 px-1.5 pt-1.5">
      <div className="grid min-w-0 flex-1 grid-cols-[1fr_1fr_1fr_1fr_1.4fr] gap-[3px]" data-testid="teambar">
        {PART_LABEL.map(([k, label]) => {
          const f = delta[k];
          const v = parts[k];
          return (
            <div key={k} className="bg-ink/60 py-0.5 text-center leading-tight">
              <div className="text-[13px] text-white/55">{label}</div>
              <div className={`whitespace-nowrap text-[14px] ${f === undefined ? 'text-white' : v > f ? 'text-good' : 'text-bad'}`}>{f === undefined ? v : `${f}→${v}`}</div>
            </div>
          );
        })}
        <div className="bg-ink/60 py-0.5 text-center leading-tight" data-testid="win-chance" title="다음 경기 승리 확률">
          <div className="whitespace-nowrap text-[13px] text-white/55">승리 확률</div>
          <div className={`whitespace-nowrap text-[14px] ${cTone}`}>{pct === null ? '—' : from === null ? `${pct}%` : `${from}→${pct}%`}</div>
        </div>
      </div>
      <Help topic="strength" />
    </div>
  );
}

/** 가로 칩 줄. 넘칠 때만 가로로 스크롤되고, 그때는 칩을 위아래로 끌거나 길게 눌러 집는다 */
function Tray({ testid, children }: { testid: string; children: (pan: 'none' | 'x') => ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [scrolls, setScrolls] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setScrolls(el.scrollWidth > el.clientWidth + 1);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  });
  return (
    <div ref={ref} className="flex shrink-0 gap-1.5 overflow-x-auto p-1" data-testid={testid}>
      {children(scrolls ? 'x' : 'none')}
    </div>
  );
}

/** 방금 영입·콜업한 선수의 칸을 잠깐 강조한다 */
function useFlashPid(): string | null {
  const flash = useStore((s) => s.flash);
  const [pid, setPid] = useState<string | null>(null);
  useEffect(() => {
    if (!flash) return;
    const left = DELTA_MS - (Date.now() - flash.at);
    if (left <= 0) return;
    setPid(flash.pid);
    const id = setTimeout(() => setPid(null), left);
    return () => clearTimeout(id);
  }, [flash]);
  return pid;
}

/**
 * 자리 시트: 그 자리의 리그 순위와 후보(주전 / 1군 백업 / 2군). 보는 것만으로는 아무것도 바뀌지 않고,
 * [교체]를 눌러야 바뀐다 (그 위에 예상 변화).
 */
function SlotSheet({ owner, rows, onClose, onSwap, onCard }: { owner: string; rows: PosRow[]; onClose: () => void; onSwap: (plan: Plan) => void; onCard: (pid: string) => void }) {
  const [more, setMore] = useState(false);
  const team = useUserTeam();
  const core = useCore();
  const o = team.roster.find((p) => p.id === owner);
  const cands = useMemo(() => slotCandidates(core, team, owner), [core, team, owner]);
  const slot = team.lineup.find((l) => l.pid === owner);
  const g = o ? groupOf(team, o) : 'cl';
  const key: PosKey = slot ? slot.pos : g === 'rot' ? 'SP' : g === 'cl' ? 'CP' : 'RP';
  const row = rows.find((r) => r.key === key);
  const name = slot ? POS[slot.pos] : g === 'rot' ? `${team.rotation.indexOf(owner) + 1}선발` : g === 'cl' ? '마무리' : `불펜 ${team.bullpen.indexOf(owner) + 1}`;
  const nFa = useStore((s) => s.freeAgents.filter((p) => (key === 'DH' ? p.kind === 'B' : p.pos === key)).length);
  const line = (p: Player, lead: string, right: ReactNode, lock = 0, rehab = 0) => (
    <div key={p.id} className={`flex min-h-12 items-center gap-1.5 bg-ink/40 pl-1.5 pr-1 ${rehab > 0 ? 'opacity-55' : ''}`} data-testid={rehab > 0 ? 'slot-row-rehab' : 'slot-row'}>
      <button type="button" className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 self-stretch text-left" onClick={() => onCard(p.id)}>
        <span className={`w-9 shrink-0 text-[13px] ${lead === '주전' ? 'text-hi' : lead === '2군' ? 'text-sky' : 'text-white/55'}`}>{lead}</span>
        <OvrBadge ovr={p.ovr} size={22} />
        <span className="min-w-0 flex-1 leading-tight">
          <span className={`block truncate text-[14px] ${rehab > 0 ? 'text-white/70' : p.injury > 0 ? 'text-bad' : 'text-white'}`}>{p.name}</span>
          <span className={`block truncate text-[13px] ${rehab > 0 ? 'text-white/70' : lock > 0 ? 'text-bad' : 'text-white/55'}`}>
            {p.age}세 · {POS_FULL[p.pos]}
            {rehab > 0 ? ` · ${rehab}경기 뒤 복귀` : lock > 0 && ` · 재등록 ${lock}경기 뒤`}
          </span>
        </span>
      </button>
      {right}
    </div>
  );
  // 이득이 큰 후보부터. 기본은 3명만 보이고 나머지는 접는다
  const sorted = cands.filter((c) => !c.rehab).sort((x, y) => (isPlan(y.plan) ? y.plan.sum : -99) - (isPlan(x.plan) ? x.plan.sum : -99));
  const shown = more ? sorted : sorted.slice(0, 3);
  const hidden = sorted.length - shown.length;
  const rehab = cands.filter((c) => c.rehab); // 재활 중: 맨 아래 회색, 교체 불가
  return (
    <Dialog onClose={onClose} label="자리" width={460}>
      <div className="flex max-h-[calc(70dvh-34px)] flex-col gap-1" data-testid="slot-sheet">
        <div className="flex shrink-0 items-center gap-1.5">
          <span className="font-pixel-lg min-w-0 flex-1 truncate text-[16px] text-white">
            {name}
            {row && <span className={TONE_TEXT[rankTone(row)]}> · 리그 {row.rank}위</span>}
          </span>
          <Help topic="posRank" />
        </div>
        <div className="px-scroll flex min-h-0 flex-1 flex-col gap-[3px] overflow-y-auto [&>*]:shrink-0">
          {o ? line(o, '주전', null) : <div className="bg-bad/15 px-2 py-2 text-[13px] text-bad">마무리 비어 있음 — 불펜 투수를 고르세요</div>}
          {shown.map((c) => {
            const plan = c.plan;
            const ok = isPlan(plan);
            return line(
              c.p,
              c.farm ? '2군' : '백업',
              <span className="flex shrink-0 flex-col items-end gap-0.5">
                <span className={`whitespace-nowrap text-[13px] leading-none ${!ok ? 'text-white/45' : plan.sum < 0 ? 'text-bad' : plan.sum > 0 ? 'text-good' : 'text-white/70'}`} data-testid="slot-delta">
                  {ok ? plan.text || '±0' : '교체 불가'}
                </span>
                <button className="px-btn min-h-9 !px-2 text-[13px]" data-testid="slot-swap" disabled={!ok} onClick={() => ok && onSwap(plan)}>
                  {c.farm ? '콜업·교체' : '교체'}
                </button>
              </span>,
              c.farm ? farmLockLeft(core, c.p) : 0,
            );
          })}
          {hidden > 0 && (
            <button className="px-btn min-h-10 text-[13px]" data-testid="slot-more" onClick={() => setMore(true)}>
              후보 {hidden}명 더 보기 ▾
            </button>
          )}
          {rehab.map((c) => line(c.p, '재활', <span className="shrink-0 whitespace-nowrap px-1 text-[13px] text-white/70">교체 불가</span>, 0, c.rehab))}
          {!cands.length && <div className="px-1 py-2 text-[13px] text-white/45">바꿀 수 있는 후보가 없습니다</div>}
        </div>
        {o && <div className="shrink-0 truncate text-[13px] text-white/55">교체하면 {o.name} → {slot ? '벤치' : '상대의 보직'}</div>}
        <button className="px-btn min-h-10 shrink-0 text-[13px]" data-testid="go-fa" disabled={!nFa} onClick={() => goMarket(key)}>
          {nFa ? `이 자리 FA 보기 ›` : '이 자리 FA 없음'}
        </button>
      </div>
    </Dialog>
  );
}

interface DragState {
  pid: string;
  pan: 'none' | 'x' | 'y';
  touch: boolean;
  x0: number;
  y0: number;
  x: number;
  y: number;
  started: boolean;
  moved: boolean;
  timer: number;
}

const VIEWS: [SquadView, string][] = [
  ['field', '야수'],
  ['order', '타순'],
  ['arms', '투수'],
];

/**
 * 선수단 화면: 보는 곳과 고치는 곳이 하나다. 누르면 본다(자리 시트·선수 카드), 끌어서 놓으면 바뀐다.
 * 끄는 동안 각 칸에 전력 변화가 뜨고, 바꾼 뒤에는 [되돌리기]가 다음 경기 전까지 남는다.
 */
export default function Squad({ top, bottom, fixNote }: { top?: ReactNode; bottom?: ReactNode; fixNote?: boolean }) {
  const team = useUserTeam();
  const core = useCore();
  const restoreLineup = useStore((s) => s.restoreLineup);
  const callUpInto = useStore((s) => s.callUpInto);
  const view = useUi((s) => s.squadView);
  const setView = useUi((s) => s.setSquadView);
  const hist = useRosterUi((s) => s.hist);
  const openList = useRosterUi((s) => s.openList);
  const rows = usePosReport();
  const flashPid = useFlashPid();

  const byId = useMemo(() => new Map(team.roster.map((p) => [p.id, p])), [team.roster]);
  const [sheet, setSheet] = useState<string | null>(null); // 자리 시트의 주인 (또는 빈 마무리 자리)
  const [card, setCard] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ pid: string; over: string | null } | null>(null);
  const [farmOpen, setFarmOpen] = useState(false);
  const [recOpen, setRecOpen] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [hint, setHint] = useState(() => !hintSeen());
  const body = useRef<HTMLDivElement>(null);
  const ghost = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);

  const inLineup = useMemo(() => new Set(team.lineup.map((l) => l.pid)), [team.lineup]);
  const bench = useMemo(() => team.roster.filter((p) => p.kind === 'B' && !p.farm && !inLineup.has(p.id)).sort((a, b) => b.ovr - a.ovr), [team.roster, inLineup]);
  const assigned = useMemo(() => new Set([...team.rotation, ...team.bullpen, ...(team.closer ? [team.closer] : [])]), [team.rotation, team.bullpen, team.closer]);
  const spare = useMemo(() => team.roster.filter((p) => p.kind === 'P' && !p.farm && !assigned.has(p.id)), [team.roster, assigned]);
  const farm = useMemo(() => team.roster.filter((p) => p.farm && p.kind === (view === 'arms' ? 'P' : 'B')).sort((a, b) => Number(!!b.il) - Number(!!a.il) || b.ovr - a.ovr), [team.roster, view]);
  const nFarm = team.roster.filter((p) => p.farm && !p.il).length;
  const nRehab = team.roster.filter((p) => p.farm && p.il).length;
  const recs = useMemo(() => recommend(team), [team]);
  const rowOf = useMemo(() => new Map(rows.map((r) => [r.key, r])), [rows]);

  // 끌고 있는 선수를 각 칸에 놓았을 때의 결과
  const plans = useMemo(() => {
    if (!drag) return null;
    const m = new Map<string, PlanResult>();
    for (const p of team.roster) m.set(p.id, planEdit(core, team, view, drag.pid, p.id, true));
    return m;
  }, [drag?.pid, core, team, view]);

  const closeHint = () => {
    setHint(false);
    try {
      localStorage.setItem(HINT_KEY, '1');
    } catch {
      /* 이번 세션만 */
    }
  };
  const push = () => useRosterUi.getState().push(snapOf(team));
  const commit = (plan: Plan) => {
    push();
    if (plan.callUp) callUpInto(plan.callUp.farm, plan.callUp.target);
    else restoreLineup(snapOf(plan.after));
    setMsg(null);
    if (hint) closeHint();
  };
  const tryEdit = (a: string, b: string): boolean => {
    const r = b === EMPTY_CLOSER ? planCloser(team, a) : planEdit(core, team, view, a, b, true);
    if (isPlan(r)) {
      commit(r);
      return true;
    }
    setMsg(errOf(r));
    return false;
  };
  /** 탭 = 보기: 자리를 가진 선수는 자리 시트, 그 밖(벤치·2군·타순 줄)은 선수 카드 */
  const look = (pid: string) => {
    setMsg(null);
    const p = byId.get(pid);
    if (!p) return;
    const g = groupOf(team, p);
    if (view !== 'order' && g !== 'spare' && g !== 'farm') setSheet(pid);
    else setCard(pid);
  };
  // 포인터 리스너는 누를 때 한 번 걸리므로, 항상 최신 상태를 보게 한다
  const live = useRef({ look, tryEdit });
  live.current = { look, tryEdit };

  const undo = () => {
    const last = useRosterUi.getState().pop();
    if (last) restoreLineup(last);
    setMsg(null);
  };
  const applyAll = () => {
    const t = structuredClone(team);
    if (!applyFixes(t)) return;
    push();
    restoreLineup(snapOf(t));
    setRecOpen(false);
  };

  // 끄는 동안에는 화면이 따라 스크롤되지 않게 한다 (touch-action 은 누른 뒤에 바꿔도 소용없다)
  useEffect(() => {
    const stop = (e: TouchEvent) => {
      if (dragRef.current?.started && e.cancelable) e.preventDefault();
    };
    document.addEventListener('touchmove', stop, { passive: false });
    return () => document.removeEventListener('touchmove', stop);
  }, []);
  useEffect(
    () => () => {
      if (dragRef.current) clearTimeout(dragRef.current.timer);
    },
    [],
  );

  const itemAt = (x: number, y: number): string | null => (document.elementFromPoint(x, y)?.closest('[data-item]') as HTMLElement | null)?.dataset.item ?? null;
  const placeGhost = (d: DragState) => {
    if (ghost.current) ghost.current.style.transform = `translate(${d.x}px, ${d.y}px) translate(-50%, -135%)`;
  };
  const onDown = (pid: string, pan: DragState['pan']) => (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (dragRef.current) return;
    const touch = e.pointerType !== 'mouse';
    const d: DragState = { pid, pan: (e.target as Element).closest('[data-handle]') ? 'none' : pan, touch, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, started: false, moved: false, timer: 0 };
    const start = () => {
      if (d.started) return;
      d.started = true;
      clearTimeout(d.timer);
      setMsg(null);
      setDrag({ pid, over: null });
      requestAnimationFrame(() => placeGhost(d));
    };
    const move = (ev: PointerEvent) => {
      d.x = ev.clientX;
      d.y = ev.clientY;
      const dx = Math.abs(d.x - d.x0);
      const dy = Math.abs(d.y - d.y0);
      if (dx > 3 || dy > 3) d.moved = true;
      if (!d.started) {
        // 스크롤되는 방향으로 민 것은 스크롤이다 (끌기는 길게 누르거나 다른 방향으로)
        const far = !d.touch || d.pan === 'none' ? Math.hypot(dx, dy) >= SLOP : d.pan === 'x' ? dy >= SLOP && dy > dx : dx >= SLOP && dx > dy;
        if (far) start();
        else if (d.touch && Math.hypot(dx, dy) >= SLOP) clearTimeout(d.timer);
        if (!d.started) return;
      }
      placeGhost(d);
      const over = itemAt(d.x, d.y);
      setDrag((cur) => (cur && cur.over !== over ? { pid, over } : cur));
      const box = body.current?.getBoundingClientRect();
      if (box && d.y < box.top + 36) body.current?.scrollBy(0, -14);
      else if (box && d.y > box.bottom - 36) body.current?.scrollBy(0, 14);
    };
    const end = () => {
      clearTimeout(d.timer);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      dragRef.current = null;
      setDrag(null);
    };
    const up = (ev: PointerEvent) => {
      end();
      // 움직이지 않고 뗀 것은 (길게 눌렀어도) 탭 = 보기
      if (!d.started || !d.moved) return live.current.look(pid);
      const over = itemAt(ev.clientX, ev.clientY);
      if (over && over !== pid) live.current.tryEdit(pid, over);
    };
    const cancel = () => end();
    d.timer = window.setTimeout(start, HOLD_MS);
    dragRef.current = d;
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
  };

  // ───────── 칸 ─────────

  const stateOf = (pid: string) => {
    const plan = plans?.get(pid);
    const mine = drag?.pid === pid;
    const ok = isPlan(plan);
    return { plan, mine, ok, dim: !!drag && !mine && !ok, over: !!drag && drag.over === pid && ok };
  };
  /** 테두리: 놓을 곳 > 끄는 선수 > 방금 들어온 선수 > 가장 약한 자리(굵은 빨강) > 순위 색 */
  const frame = (pid: string, row?: PosRow): CSSProperties => {
    const s = stateOf(pid);
    // 칸 색은 팀 안에서 가장 약한 2곳(빨강)·가장 강한 2곳(초록)만. 리그 순위는 자리 시트에서 보여 준다
    const tileTone = row ? (row.weak ? 'bad' : row.strong ? 'good' : 'mid') : 'mid';
    const edge = row ? TONE_EDGE[tileTone] : '#0f1420';
    return {
      boxShadow: s.over ? '0 0 0 3px #6ee07a' : s.mine || flashPid === pid ? '0 0 0 2px #ffd84a' : s.ok ? '0 0 0 2px #6ee07a' : row?.weak ? '0 0 0 3px #ff6b6b' : `0 0 0 1px ${edge}`,
      opacity: s.mine ? 0.45 : s.dim ? 0.38 : 1,
      ...(row ? { background: TONE_BG[tileTone] } : null),
    };
  };
  const delta = (plan: PlanResult | undefined, fallback: ReactNode, tight = true): ReactNode => {
    if (!drag || !isPlan(plan)) return fallback;
    // 좁은 칸에서는 붙여 쓴다: "수비+5 타선+2"
    const text = tight ? plan.text.replace(/ · /g, '  ').replace(/ ([+−])/g, '$1') : plan.text;
    return <span className={plan.sum < 0 ? 'text-bad' : plan.sum > 0 ? 'text-good' : 'text-white/70'} data-testid="delta">{text || '±0'}</span>;
  };
  const itemProps = (pid: string, pan: DragState['pan']) => ({
    'data-item': pid,
    'data-pid': pid,
    'data-ok': stateOf(pid).ok || undefined,
    onPointerDown: onDown(pid, pan),
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
  });

  /** 두 줄 칸: 이름·OVR / 자리(끄는 동안에는 예상 변화) */
  const tile = (p: Player, sub: ReactNode, o: { row?: PosRow; off?: boolean; pan: DragState['pan']; className?: string; style?: CSSProperties; subBad?: boolean }) => (
    <div
      key={p.id}
      {...itemProps(p.id, o.pan)}
      data-pos={o.row?.key}
      data-weak={o.row?.weak || undefined}
      data-injured={p.injury > 0 || undefined}
      className={`flex min-h-[50px] cursor-pointer flex-col justify-center bg-panel-2 px-1 py-1 select-none ${o.className ?? ''}`}
      style={{ ...frame(p.id, o.row), touchAction: o.pan === 'none' ? 'none' : `pan-${o.pan}`, ...o.style }}
    >
      <span className="flex items-center gap-0.5">
        <span className={`min-w-0 flex-1 whitespace-nowrap text-[14px] leading-tight ${o.row ? '' : 'truncate'} ${p.injury > 0 ? 'text-bad' : 'text-white'}`}>
          {p.name}
          {o.off && <span className="text-[13px] text-hi" title="제 포지션이 아니다" data-testid="off-pos">⚠</span>}
        </span>
        <OvrBadge ovr={p.ovr} size={20} />
      </span>
      <span className={`truncate text-[13px] leading-tight ${o.subBad ? 'text-bad' : 'text-white/60'}`}>{delta(stateOf(p.id).plan, sub)}</span>
    </div>
  );

  const fieldView = (
    <>
      <div className={`relative mx-auto ${top ? 'h-[250px] lg:h-[300px]' : 'h-[min(360px,max(250px,calc(100dvh-350px)))]'} w-full max-w-[560px] shrink-0 overflow-hidden`} style={{ background: '#2c6a3c', boxShadow: 'inset 0 0 0 2px #0f1420' }} data-testid="squad-field">
        {/* 내야 흙과 잔디 */}
        <div className="absolute left-1/2 top-[62%] aspect-square w-[46%] -translate-x-1/2 -translate-y-1/2 rotate-45" style={{ background: '#a8794d' }}>
          <div className="absolute inset-[16%]" style={{ background: '#337a45' }} />
        </div>
        {team.lineup.map((l) => {
          const p = byId.get(l.pid);
          if (!p) return null;
          const [x, y] = SPOT[l.pos];
          return tile(p, POS_KO[l.pos], { row: rowOf.get(l.pos), off: offPos(p, l.pos), pan: 'none', className: 'absolute w-[31%] -translate-x-1/2 -translate-y-1/2', style: { left: `${x}%`, top: `${y}%` } });
        })}
      </div>
      <div className="flex shrink-0 items-center justify-between px-0.5 pt-1 text-[13px] text-white/60">
        <span>벤치 {bench.length}</span>
        {farmToggle()}
      </div>
      <Tray testid="squad-bench">{(pan) => bench.map((p) => tile(p, POS_KO[p.pos], { pan, className: 'w-[84px] shrink-0' }))}</Tray>
      {farmTray()}
    </>
  );

  const orderView = (
    <div className="flex flex-col gap-1 p-1" data-testid="squad-order">
      {team.lineup.map((l, i) => {
        const p = byId.get(l.pid);
        if (!p) return null;
        const off = offPos(p, l.pos);
        return (
          <div key={p.id} {...itemProps(p.id, 'y')} className="flex min-h-[46px] cursor-pointer items-center gap-2 bg-panel-2 pr-2 select-none" style={{ ...frame(p.id), touchAction: 'pan-y' }}>
            <span data-handle className="flex h-[46px] w-11 shrink-0 cursor-grab items-center justify-center text-[20px] text-white/55" style={{ touchAction: 'none' }}>
              ≡
            </span>
            <span className="w-4 shrink-0 text-[15px] text-hi">{i + 1}</span>
            <span className={`w-9 shrink-0 text-[13px] ${off ? 'text-hi' : 'text-white/60'}`}>{POS_KO[l.pos]}</span>
            <span className={`min-w-0 flex-1 truncate text-[14px] ${p.injury > 0 ? 'text-bad' : 'text-white'}`}>{p.name}</span>
            <span className="shrink-0 text-[13px]">{delta(stateOf(p.id).plan, null, false)}</span>
            <OvrBadge ovr={p.ovr} size={22} />
          </div>
        );
      })}
    </div>
  );

  const arm = (pid: string | null, role: string, wrong: (p: Player) => boolean, state?: 'pen' | 'next') => {
    const p = pid ? byId.get(pid) : undefined;
    if (!p) return null;
    const bad = wrong(p);
    const sub =
      state === 'pen' && p.injury === 0 ? (
        <span className="flex items-center justify-between gap-1">
          <span className="truncate">{role}</span>
          <ArmState tired={p.tired} />
        </span>
      ) : state === 'next' ? (
        <span className="flex items-center justify-between gap-1">
          <span className="truncate">{role}</span>
          <span className="shrink-0 whitespace-nowrap text-good" data-testid="next-start">다음 등판</span>
        </span>
      ) : (
        role
      );
    return tile(p, sub, { off: bad, subBad: bad, pan: 'y', className: '!px-1.5' });
  };
  const armsView = (
    <div className="p-1" data-testid="squad-arms">
      <PenStyleBar />
      <div className="pb-1 text-[13px] text-white/60">선발</div>
      <div className="grid grid-cols-2 gap-1.5 lg:grid-cols-3" data-testid="squad-rotation">
        {team.rotation.map((pid, i) => arm(pid, `${i + 1}선발`, (p) => p.pos !== 'SP', team.rotation.length && i === team.nextStarter % team.rotation.length ? 'next' : undefined))}
      </div>
      <div className="pb-1 pt-2 text-[13px] text-white/60">마무리 · 불펜</div>
      <div className="grid grid-cols-2 gap-1.5 lg:grid-cols-3" data-testid="squad-pen">
        {team.closer ? (
          arm(team.closer, '마무리', (p) => p.pos === 'SP', 'pen')
        ) : (
          <button
            type="button"
            data-item={EMPTY_CLOSER}
            data-testid="squad-closer-empty"
            className="flex min-h-[50px] cursor-pointer flex-col items-start justify-center bg-ink/50 px-2 text-left text-[13px] leading-snug text-white/70"
            style={{ boxShadow: drag && byId.get(drag.pid)?.kind === 'P' ? '0 0 0 2px #6ee07a' : '0 0 0 2px #ff6b6b' }}
            onClick={() => setSheet(EMPTY_CLOSER)}
          >
            <span className="text-bad">마무리 비어 있음</span>
            <span>눌러서 후보 보기</span>
          </button>
        )}
        {team.bullpen.map((pid, i) => arm(pid, `불펜 ${i + 1}`, (p) => p.pos === 'SP', 'pen'))}
        {spare.map((p) => arm(p.id, '대기', () => false))}
      </div>
      <div className="flex items-center justify-end px-0.5 pt-2">{farmToggle()}</div>
      {farmTray()}
    </div>
  );

  function farmToggle() {
    return (
      <button className="flex min-h-9 cursor-pointer items-center px-2 text-[13px] text-sky" data-testid="squad-farm-toggle" onClick={() => setFarmOpen((v) => !v)}>
        2군 {nFarm}/{FARM_MAX}
        {nRehab > 0 && <span className="text-bad" data-testid="squad-rehab-n">&nbsp;· 재활 {nRehab}</span>}
        &nbsp;{farmOpen ? '▾' : '▸'}
      </button>
    );
  }
  function farmTray() {
    if (!farmOpen) return null;
    return (
      <Tray testid="squad-farm">
        {(pan) =>
          farm.length ? (
            farm.map((p) => {
              const left = farmLockLeft(core, p);
              // 재활 선수: "재활 n경기" 태그로 구분한다 (2군 정원에 들지 않는다)
              if (p.il) return <span key={p.id} className="contents" data-testid="squad-rehab">{tile(p, left > 0 ? `재활 ${left}경기` : '재활 끝', { pan, subBad: left > 0, className: 'w-[104px] shrink-0', style: { background: '#33202a' } })}</span>;
              return tile(p, left > 0 ? `${POS_KO[p.pos]} 잠금${left}` : POS_KO[p.pos], { pan, subBad: left > 0, className: 'w-[104px] shrink-0', style: { background: '#1c2740' } });
            })
          ) : (
            <span className="px-1 py-3 text-[13px] text-white/45">0/{FARM_MAX}</span>
          )
        }
      </Tray>
    );
  }

  const overErr = drag?.over ? errOf(plans?.get(drag.over)) : null;
  const note = overErr ?? msg;
  const dragP = drag ? byId.get(drag.pid) : undefined;
  const cardP = card ? byId.get(card) : undefined;

  return (
    <>
      {top}
      <StrengthLine />
      {fixNote && recs.length > 0 && (
        <div className="shrink-0 px-2 pt-1 text-[13px] text-white/70" data-testid="fix-note">
          오더를 고치면 이길 확률이 오릅니다.
        </div>
      )}
      <div className="flex shrink-0 items-stretch gap-1.5 px-1.5 pt-1.5">
        <div className="flex min-w-0 flex-1 gap-[2px] bg-edge p-[2px]">
          {VIEWS.map(([id, label]) => (
            <button
              key={id}
              data-testid={`squad-view-${id}`}
              data-sfx="tab"
              className={`min-h-11 flex-1 cursor-pointer text-[14px] ${view === id ? 'bg-panel text-hi' : 'bg-panel-2/60 text-white/60'}`}
              style={view === id ? { boxShadow: 'inset 0 2px 0 #ffd84a' } : undefined}
              onClick={() => {
                setView(id);
                setMsg(null);
              }}
            >
              {label}
            </button>
          ))}
        </div>
        {hist.length > 0 && (
          <button className="px-btn green min-h-11 shrink-0 !px-2 text-[13px]" data-testid="squad-undo" onClick={undo}>
            ↶ 되돌리기
          </button>
        )}
        <button className="px-btn min-h-11 shrink-0 !px-2 text-[13px]" data-testid="open-list" onClick={() => openList()}>
          명단 ▤
        </button>
      </div>

      {/* 추천을 펼쳐도 다이아몬드의 절반(150px)은 보이게 한다 */}
      <div ref={body} className={`px-scroll flex min-h-0 flex-1 flex-col overflow-y-auto px-1.5 pt-1.5 ${recOpen ? 'mob:min-h-[158px]' : ''}`} data-testid="squad-body">
        {view === 'field' ? fieldView : view === 'order' ? orderView : armsView}
      </div>

      {note && (
        <div className="shrink-0 bg-bad/20 px-2 py-1.5 text-[13px] text-bad" data-testid="squad-note">
          {note}
        </div>
      )}
      {hint && !note && !recOpen && (
        <div className="flex shrink-0 items-center gap-2 bg-ink/70 px-2 text-[13px] text-white/80" data-testid="squad-hint">
          <span className="min-w-0 flex-1">누르면 그 자리를 보고, 끌어서 놓으면 바뀝니다</span>
          <button className="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center text-[16px] text-white/60" aria-label="닫기" onClick={closeHint}>
            ×
          </button>
        </div>
      )}

      {recs.length > 0 && (
        <div className="flex min-h-[52px] shrink flex-col px-1.5 pt-1.5 pb-1.5 mob:max-h-[40dvh]" data-testid="squad-recs">
          <div className="flex shrink-0 items-stretch gap-1.5">
            <button className="flex min-h-11 min-w-0 flex-1 cursor-pointer items-center gap-1 bg-good/15 px-2 text-left text-[14px] text-good" style={{ boxShadow: 'inset 3px 0 0 #6ee07a' }} data-testid="squad-recs-toggle" onClick={() => setRecOpen((v) => !v)}>
              추천 {recs.length}건 <span className="text-white/60">{recOpen ? '▾' : '▸'}</span>
            </button>
            {recOpen && (
              <button className="px-btn green min-h-11 shrink-0 text-[13px]" data-testid="squad-recs-all" onClick={applyAll}>
                전부 적용
              </button>
            )}
          </div>
          {recOpen && (
            <div className="px-scroll mt-1 flex max-h-[30dvh] min-h-0 flex-col gap-1 overflow-y-auto mob:max-h-none [&>*]:shrink-0">
              {recs.map((r) => {
                const plan = planEdit(core, team, r.view, r.a, r.b);
                return (
                  <div key={r.key} className="flex min-h-12 items-center gap-2 bg-ink/50 px-2 text-[13px]" data-testid="squad-rec">
                    <span className="min-w-0 flex-1 leading-snug">
                      {r.who} → {r.to}
                      {isPlan(plan) && plan.text && <span className={plan.sum < 0 ? 'text-bad' : 'text-good'}> ({plan.text})</span>}
                    </span>
                    <button className="px-btn min-h-10 shrink-0 text-[13px]" data-testid="squad-rec-apply" disabled={!isPlan(plan)} onClick={() => isPlan(plan) && commit(plan)}>
                      적용
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
      {bottom}

      {dragP && (
        <div ref={ghost} className="pointer-events-none fixed left-0 top-0 z-[60] flex items-center gap-1 bg-panel px-2 py-1.5 text-[14px] text-white" style={{ boxShadow: '0 0 0 2px #ffd84a, 0 6px 0 rgba(0,0,0,.35)', transform: dragRef.current ? `translate(${dragRef.current.x}px, ${dragRef.current.y}px) translate(-50%, -135%)` : undefined }} data-testid="squad-ghost">
          {dragP.name}
          <OvrBadge ovr={dragP.ovr} size={20} />
        </div>
      )}
      {sheet && !cardP && (
        <SlotSheet
          owner={sheet}
          rows={rows}
          onClose={() => setSheet(null)}
          onCard={setCard}
          onSwap={(plan) => {
            commit(plan);
            setSheet(null);
          }}
        />
      )}
      {cardP && (
        <CardPop player={cardP} onClose={() => setCard(null)}>
          <FarmMoveButton player={cardP} onDone={() => setCard(null)} />
          <ReleaseButton player={cardP} />
        </CardPop>
      )}
      <RosterList />
    </>
  );
}
