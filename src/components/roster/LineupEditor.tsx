import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { BatPos, Player } from '../../game/types';
import { FARM_MAX } from '../../game/economy';
import { applyFixes, offPos } from '../../game/fixes';
import { farmLockLeft } from '../../game/season';
import { useCore, useStore, useUserTeam } from '../../store';
import { TeamBar } from '../LeftPanel';
import { useWinChance } from '../useWinChance';
import { OvrBadge, POS_KO } from '../ui';
import PenStyleBar from './PenStyle';
import { planEdit, recommend, sameSnap, snapOf, type EditorView, type LineupSnap, type Plan, type PlanResult } from './editorOps';

const HOLD_MS = 150; // 이만큼 누르고 있으면 끌기 시작
const SLOP = 8; // 이만큼 끌면 끌기 시작 (px)
const HINT_KEY = 'kbl-editor-hint-v1';
const CHANCE_MS = 2000;

const isPlan = (r: PlanResult | undefined): r is Plan => !!r && 'after' in r;
const errOf = (r: PlanResult | undefined): string | null => (r && 'error' in r ? r.error : null);

/** 수비 화면: 자리별 좌표 (%, 칸의 중심) */
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

function hintSeen(): boolean {
  try {
    return localStorage.getItem(HINT_KEY) === '1';
  } catch {
    return true;
  }
}

/** 승리 확률(큰 숫자). 편성을 바꾸면 "31% → 44%"가 잠깐 보인다. */
function WinChance({ label, note }: { label: string; note?: ReactNode }) {
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
    const id = setTimeout(() => setFrom(null), CHANCE_MS);
    return () => clearTimeout(id);
  }, [from, pct]);
  const tone = from === null || pct === null ? 'text-hi' : pct > from ? 'text-good' : 'text-bad';
  const bar = from === null || pct === null ? 'bg-hi' : pct > from ? 'bg-good' : 'bg-bad';
  return (
    <div className="shrink-0 px-2 pt-1.5" data-testid="win-chance">
      <div className="flex items-baseline justify-between gap-2 whitespace-nowrap">
        <span className="text-[13px] text-white/75">{label}</span>
        <span className={`font-pixel-lg text-[26px] leading-none ${tone}`} style={{ textShadow: '1px 1px 0 #0f1420' }}>
          {pct === null ? '…' : from === null ? `${pct}%` : `${from}% → ${pct}%`}
        </span>
      </div>
      <div className="mt-1 h-[6px] bg-white/10">
        <div className={`h-full ${bar}`} style={{ width: `${pct ?? 0}%`, transition: 'width .3s' }} />
      </div>
      {note && <div className="mt-1 text-[13px] text-white/70">{note}</div>}
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

/**
 * 오더 편집기: 고치기 전용 화면. 끌어서 놓거나(드래그), 두 번 눌러(탭-탭) 자리를 맞바꾼다.
 * 놓기 전에 각 칸에 전력 변화가 뜨고, 놓으면 바로 반영된다. 닫으면 확정.
 */
const EMPTY_CLOSER = '__closer'; // 비어 있는 마무리 자리 (data-item)

export default function LineupEditor({ top, action, chanceLabel, fixNote, focus }: { top?: ReactNode; action: ReactNode; chanceLabel: string | null; fixNote?: boolean; focus?: string | null }) {
  const team = useUserTeam();
  const core = useCore();
  const restoreLineup = useStore((s) => s.restoreLineup);
  const callUpInto = useStore((s) => s.callUpInto);
  const auto = useStore((s) => s.auto);
  const yielded = useStore((s) => !!s.campaign.managerYielded);
  const opener = useStore((s) => s.phase === 'season' && s.day === 0);

  const byId = useMemo(() => new Map(team.roster.map((p) => [p.id, p])), [team.roster]);
  const focusP = focus ? byId.get(focus) : undefined;
  const [view, setView] = useState<EditorView>(focusP?.kind === 'P' ? 'arms' : 'field');
  const [sel, setSel] = useState<string | null>(focusP ? focusP.id : null);
  const [drag, setDrag] = useState<{ pid: string; over: string | null } | null>(null);
  const [farmOpen, setFarmOpen] = useState(!!focusP?.farm);
  const [recOpen, setRecOpen] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [hint, setHint] = useState(() => !hintSeen());
  const [base] = useState<LineupSnap>(() => snapOf(team));
  const [hist, setHist] = useState<LineupSnap[]>([]);
  const body = useRef<HTMLDivElement>(null);
  const ghost = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);

  const inLineup = useMemo(() => new Set(team.lineup.map((l) => l.pid)), [team.lineup]);
  const bench = useMemo(() => team.roster.filter((p) => p.kind === 'B' && !p.farm && !inLineup.has(p.id)).sort((a, b) => b.ovr - a.ovr), [team.roster, inLineup]);
  const assigned = useMemo(() => new Set([...team.rotation, ...team.bullpen, ...(team.closer ? [team.closer] : [])]), [team.rotation, team.bullpen, team.closer]);
  const spare = useMemo(() => team.roster.filter((p) => p.kind === 'P' && !p.farm && !assigned.has(p.id)), [team.roster, assigned]);
  const farm = useMemo(() => team.roster.filter((p) => p.farm && p.kind === (view === 'arms' ? 'P' : 'B')).sort((a, b) => b.ovr - a.ovr), [team.roster, view]);
  const recs = useMemo(() => recommend(team), [team]);
  const dirty = useMemo(() => !sameSnap(base, snapOf(team)), [base, team]);

  // 선택했거나 끌고 있는 선수를 각 칸에 놓았을 때의 결과
  const active = drag?.pid ?? sel;
  const dragging = !!drag;
  const plans = useMemo(() => {
    if (!active) return null;
    const m = new Map<string, PlanResult>();
    for (const p of team.roster) m.set(p.id, planEdit(core, team, view, active, p.id, dragging));
    return m;
  }, [active, dragging, core, team, view]);

  const closeHint = () => {
    setHint(false);
    try {
      localStorage.setItem(HINT_KEY, '1');
    } catch {
      /* 이번 세션만 */
    }
  };
  const push = () => setHist((h) => [...h, snapOf(team)]);
  const commit = (plan: Plan) => {
    push();
    if (plan.callUp) callUpInto(plan.callUp.farm, plan.callUp.target);
    else restoreLineup(snapOf(plan.after));
    setMsg(null);
    if (hint) closeHint();
  };
  const tryEdit = (a: string, b: string, move: boolean): boolean => {
    const r = planEdit(core, team, view, a, b, move);
    if (isPlan(r)) {
      commit(r);
      return true;
    }
    setMsg(errOf(r));
    return false;
  };
  const tap = (pid: string) => {
    setMsg(null);
    if (!sel) return setSel(pid);
    if (sel === pid) return setSel(null);
    const r = planEdit(core, team, view, sel, pid, false);
    if (isPlan(r)) {
      commit(r);
      setSel(null);
    } else if (errOf(r)) setMsg(errOf(r));
    else setSel(pid); // 바꿀 것이 없는 사이면 선택만 옮긴다
  };
  // 비어 있는 마무리 자리에 불펜(대기) 투수를 놓는다
  const setCloser = (pid: string): boolean => {
    const p = byId.get(pid);
    if (team.closer || !p || p.kind !== 'P' || p.farm) return false;
    if (team.rotation.includes(pid)) {
      setMsg('선발 투수는 마무리 자리에 놓을 수 없습니다 — 불펜 투수를 고르세요');
      return false;
    }
    const snap = snapOf(team);
    push();
    restoreLineup({ ...snap, bullpen: snap.bullpen.filter((id) => id !== pid), closer: pid });
    setSel(null);
    setMsg(null);
    return true;
  };
  // 포인터 리스너는 누를 때 한 번 걸리므로, 항상 최신 상태를 보게 한다
  const live = useRef({ tap, tryEdit, view, setCloser });
  live.current = { tap, tryEdit, view, setCloser };

  const undo = () => {
    const last = hist[hist.length - 1];
    if (!last) return;
    restoreLineup(last);
    setHist((h) => h.slice(0, -1));
    setSel(null);
    setMsg(null);
  };
  const reset = () => {
    restoreLineup(base);
    setHist([]);
    setSel(null);
    setMsg(null);
  };
  const applyAll = () => {
    const t = structuredClone(team);
    if (!applyFixes(t)) return;
    push();
    restoreLineup(snapOf(t));
    setSel(null);
    setRecOpen(false);
  };
  const runAuto = () => {
    push();
    auto();
    setSel(null);
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
      if (!d.started) return live.current.tap(pid);
      const over = itemAt(ev.clientX, ev.clientY);
      if (over === pid) {
        if (!d.moved) live.current.tap(pid); // 길게 눌렀다 뗀 것은 탭
      } else if (over === EMPTY_CLOSER) {
        live.current.setCloser(pid);
      } else if (over) {
        setSel(null);
        live.current.tryEdit(pid, over, live.current.view === 'order');
      }
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
    const mine = active === pid;
    const ok = isPlan(plan);
    return { plan, mine, ok, dim: !!active && !mine && !ok, over: !!drag && drag.over === pid && ok };
  };
  const frame = (pid: string, bad: boolean): CSSProperties => {
    const s = stateOf(pid);
    return {
      boxShadow: s.over ? '0 0 0 3px #6ee07a' : s.mine ? '0 0 0 2px #ffd84a' : bad ? '0 0 0 2px #ff6b6b' : s.ok ? '0 0 0 1px #6ee07a' : '0 0 0 1px #0f1420',
      opacity: drag?.pid === pid ? 0.45 : s.dim ? 0.38 : 1,
    };
  };
  const delta = (plan: PlanResult | undefined, fallback: ReactNode, tight = true): ReactNode => {
    if (!active || !isPlan(plan)) return fallback;
    // 좁은 칸에서는 붙여 쓴다: "수비+5 타선+2"
    const text = tight ? plan.text.replace(/ · /g, '  ').replace(/ ([+−])/g, '$1') : plan.text;
    return <span className={plan.sum < 0 ? 'text-bad' : plan.sum > 0 ? 'text-good' : 'text-white/70'} data-testid="delta">{text || '±0'}</span>;
  };
  const itemProps = (pid: string, pan: DragState['pan']) => ({
    'data-item': pid,
    'data-ok': stateOf(pid).ok || undefined,
    'data-sel': sel === pid || undefined,
    onPointerDown: onDown(pid, pan),
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
  });

  /** 두 줄 칸: 이름·OVR / 자리(선택 중에는 예상 변화) */
  const tile = (p: Player, sub: ReactNode, o: { bad?: boolean; pan: DragState['pan']; className?: string; style?: CSSProperties; subBad?: boolean }) => (
    <div
      key={p.id}
      {...itemProps(p.id, o.pan)}
      className={`flex min-h-[50px] cursor-pointer flex-col justify-center bg-panel-2 px-1.5 py-1 select-none ${o.className ?? ''}`}
      style={{ ...frame(p.id, !!o.bad), touchAction: o.pan === 'none' ? 'none' : `pan-${o.pan}`, ...o.style }}
    >
      <span className="flex items-center gap-1">
        <span className={`min-w-0 flex-1 truncate text-[14px] leading-tight ${p.injury > 0 ? 'text-bad' : 'text-white'}`}>{p.name}</span>
        <OvrBadge ovr={p.ovr} size={20} />
      </span>
      <span className={`truncate text-[13px] leading-tight ${o.subBad ? 'text-bad' : 'text-white/60'}`}>{delta(stateOf(p.id).plan, sub)}</span>
    </div>
  );

  const fieldView = (
    <>
      <div className="relative mx-auto h-[300px] w-full max-w-[560px] shrink-0 overflow-hidden" style={{ background: '#2c6a3c', boxShadow: 'inset 0 0 0 2px #0f1420' }} data-testid="editor-field">
        {/* 내야 흙과 잔디 */}
        <div className="absolute left-1/2 top-[62%] aspect-square w-[46%] -translate-x-1/2 -translate-y-1/2 rotate-45" style={{ background: '#a8794d' }}>
          <div className="absolute inset-[16%]" style={{ background: '#337a45' }} />
        </div>
        {team.lineup.map((l) => {
          const p = byId.get(l.pid);
          if (!p) return null;
          const [x, y] = SPOT[l.pos];
          const off = offPos(p, l.pos);
          return tile(p, POS_KO[l.pos], { bad: off, subBad: off, pan: 'none', className: 'absolute w-[30%] -translate-x-1/2 -translate-y-1/2', style: { left: `${x}%`, top: `${y}%` } });
        })}
      </div>
      <div className="flex shrink-0 items-center justify-between px-0.5 pt-2 text-[13px] text-white/60">
        <span>벤치 {bench.length}</span>
        {farmToggle()}
      </div>
      <Tray testid="editor-bench">{(pan) => bench.map((p) => tile(p, POS_KO[p.pos], { pan, className: 'w-[84px] shrink-0' }))}</Tray>
      {farmTray()}
    </>
  );

  const orderView = (
    <div className="flex flex-col gap-1 p-1" data-testid="editor-order">
      {team.lineup.map((l, i) => {
        const p = byId.get(l.pid);
        if (!p) return null;
        const off = offPos(p, l.pos);
        return (
          <div key={p.id} {...itemProps(p.id, 'y')} className="flex min-h-[50px] cursor-pointer items-center gap-2 bg-panel-2 pr-2 select-none" style={{ ...frame(p.id, false), touchAction: 'pan-y' }}>
            <span data-handle className="flex h-[50px] w-11 shrink-0 cursor-grab items-center justify-center text-[20px] text-white/55" style={{ touchAction: 'none' }}>
              ≡
            </span>
            <span className="w-4 shrink-0 text-[15px] text-hi">{i + 1}</span>
            <span className={`w-9 shrink-0 text-[13px] ${off ? 'text-bad' : 'text-white/60'}`}>{POS_KO[l.pos]}</span>
            <span className={`min-w-0 flex-1 truncate text-[14px] ${p.injury > 0 ? 'text-bad' : 'text-white'}`}>{p.name}</span>
            <span className="shrink-0 text-[13px]">{delta(stateOf(p.id).plan, null, false)}</span>
            <OvrBadge ovr={p.ovr} size={22} />
          </div>
        );
      })}
    </div>
  );

  const arm = (pid: string | null, role: string, wrong: (p: Player) => boolean) => {
    const p = pid ? byId.get(pid) : undefined;
    if (!p) return null;
    const bad = wrong(p);
    return tile(p, role, { bad, subBad: bad, pan: 'y' });
  };
  const armsView = (
    <div className="p-1" data-testid="editor-arms">
      <PenStyleBar />
      <div className="pb-1 text-[13px] text-white/60">선발</div>
      <div className="grid grid-cols-2 gap-1.5 lg:grid-cols-3" data-testid="editor-rotation">
        {team.rotation.map((pid, i) => arm(pid, `${i + 1}선발`, (p) => p.pos !== 'SP'))}
      </div>
      <div className="pb-1 pt-2 text-[13px] text-white/60">마무리 · 불펜</div>
      <div className="grid grid-cols-2 gap-1.5 lg:grid-cols-3" data-testid="editor-pen">
        {team.closer ? (
          arm(team.closer, '마무리', (p) => p.pos === 'SP')
        ) : (
          <button
            type="button"
            data-item={EMPTY_CLOSER}
            data-testid="editor-closer-empty"
            className="flex min-h-[50px] cursor-pointer flex-col items-start justify-center bg-ink/50 px-2 text-left text-[13px] leading-snug text-white/70"
            style={{ boxShadow: sel && byId.get(sel)?.kind === 'P' ? '0 0 0 2px #6ee07a' : '0 0 0 2px #ff6b6b' }}
            onClick={() => (sel ? setCloser(sel) : setMsg('불펜 투수를 먼저 고른 뒤 마무리 자리를 누르세요'))}
          >
            <span className="text-bad">마무리 비어 있음</span>
            <span>불펜 투수를 놓으세요</span>
          </button>
        )}
        {team.bullpen.map((pid, i) => arm(pid, `불펜 ${i + 1}`, (p) => p.pos === 'SP'))}
        {spare.map((p) => arm(p.id, '대기', () => false))}
      </div>
      <div className="flex items-center justify-end px-0.5 pt-2">{farmToggle()}</div>
      {farmTray()}
    </div>
  );

  function farmToggle() {
    return (
      <button className="flex min-h-9 cursor-pointer items-center px-2 text-[13px] text-sky" data-testid="editor-farm-toggle" onClick={() => setFarmOpen((v) => !v)}>
        2군 {farm.length}명 {farmOpen ? '▾' : '▸'}
      </button>
    );
  }
  function farmTray() {
    if (!farmOpen) return null;
    return (
      <Tray testid="editor-farm">
        {(pan) =>
          farm.length ? (
            farm.map((p) => {
              const left = farmLockLeft(core, p);
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
  const VIEWS: [EditorView, string][] = [
    ['field', '수비'],
    ['order', '타순'],
    ['arms', '투수'],
  ];

  return (
    <>
      {top}
      {chanceLabel && <WinChance label={chanceLabel} note={fixNote && recs.length > 0 ? '오더를 고치면 이길 확률이 오릅니다.' : undefined} />}
      <TeamBar team={team} />
      <div className="flex shrink-0 items-stretch gap-1.5 px-1.5 pt-1.5">
        <div className="flex min-w-0 flex-1 gap-[2px] bg-edge p-[2px]">
          {VIEWS.map(([id, label]) => (
            <button
              key={id}
              data-testid={`editor-view-${id}`}
              data-sfx="tab"
              className={`min-h-11 flex-1 cursor-pointer text-[14px] ${view === id ? 'bg-panel text-hi' : 'bg-panel-2/60 text-white/60'}`}
              style={view === id ? { boxShadow: 'inset 0 2px 0 #ffd84a' } : undefined}
              onClick={() => {
                setView(id);
                setSel(null);
                setMsg(null);
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <button className="px-btn min-h-11 shrink-0 !px-2 text-[13px]" data-testid="editor-undo" disabled={!hist.length} onClick={undo}>
          ↶ 되돌리기
        </button>
        <button className="px-btn min-h-11 shrink-0 !px-2 text-[13px]" data-testid="editor-reset" disabled={!dirty} onClick={reset}>
          처음으로
        </button>
      </div>

      {/* 추천을 펼쳐도 수비 그림의 절반(150px)은 보이게 한다 */}
      <div ref={body} className={`px-scroll flex min-h-0 flex-1 flex-col overflow-y-auto px-1.5 pt-1.5 ${recOpen ? 'mob:min-h-[158px]' : ''}`} data-testid="editor-body">
        {view === 'field' ? fieldView : view === 'order' ? orderView : armsView}
      </div>

      {note && (
        <div className="shrink-0 bg-bad/20 px-2 py-1.5 text-[13px] text-bad" data-testid="editor-note">
          {note}
        </div>
      )}
      {hint && !note && !recOpen && (
        <div className="flex shrink-0 items-center gap-2 bg-ink/70 px-2 text-[13px] text-white/80" data-testid="editor-hint">
          <span className="min-w-0 flex-1">끌어서 놓거나, 두 번 눌러 바꿉니다</span>
          <button className="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center text-[16px] text-white/60" aria-label="닫기" onClick={closeHint}>
            ×
          </button>
        </div>
      )}

      {recs.length > 0 && (
        <div className="flex min-h-[52px] shrink flex-col px-1.5 pt-1.5 mob:max-h-[40dvh]" data-testid="editor-recs">
          <div className="flex shrink-0 items-stretch gap-1.5">
            <button className="flex min-h-11 min-w-0 flex-1 cursor-pointer items-center gap-1 bg-good/15 px-2 text-left text-[14px] text-good" style={{ boxShadow: 'inset 3px 0 0 #6ee07a' }} data-testid="editor-recs-toggle" onClick={() => setRecOpen((v) => !v)}>
              추천 {recs.length}건 <span className="text-white/60">{recOpen ? '▾' : '▸'}</span>
            </button>
            <button className="px-btn green min-h-11 shrink-0 text-[13px]" data-testid="editor-recs-all" onClick={applyAll}>
              전부 적용
            </button>
          </div>
          {recOpen && (
            <div className="px-scroll mt-1 flex max-h-[30dvh] min-h-0 flex-col gap-1 overflow-y-auto mob:max-h-none [&>*]:shrink-0">
              {recs.map((r) => {
                const plan = planEdit(core, team, r.view, r.a, r.b);
                return (
                  <div key={r.key} className="flex min-h-12 items-center gap-2 bg-ink/50 px-2 text-[13px]" data-testid="editor-rec">
                    <span className="min-w-0 flex-1 leading-snug">
                      {r.who} → {r.to}
                      {isPlan(plan) && plan.text && <span className={plan.sum < 0 ? 'text-bad' : 'text-good'}> ({plan.text})</span>}
                    </span>
                    <button
                      className="px-btn min-h-10 shrink-0 text-[13px]"
                      data-testid="editor-rec-apply"
                      disabled={!isPlan(plan)}
                      onClick={() => {
                        if (isPlan(plan)) commit(plan);
                        setSel(null);
                      }}
                    >
                      적용
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      <div className="flex shrink-0 items-stretch gap-2 px-1.5 pt-1.5 pb-2">
        {opener && !yielded ? (
          <button className="min-h-11 flex-1 cursor-pointer whitespace-nowrap px-1 text-[13px] text-white/60 underline" data-testid="order-reset" onClick={runAuto}>
            감독 오더로
          </button>
        ) : (
          <button className="px-btn min-h-11 flex-1 text-[13px]" data-testid="editor-auto" onClick={runAuto}>
            자동 편성
          </button>
        )}
        {action}
      </div>

      {dragP && (
        <div ref={ghost} className="pointer-events-none fixed left-0 top-0 z-[60] flex items-center gap-1 bg-panel px-2 py-1.5 text-[14px] text-white" style={{ boxShadow: '0 0 0 2px #ffd84a, 0 6px 0 rgba(0,0,0,.35)', transform: dragRef.current ? `translate(${dragRef.current.x}px, ${dragRef.current.y}px) translate(-50%, -135%)` : undefined }} data-testid="editor-ghost">
          {dragP.name}
          <OvrBadge ovr={dragP.ovr} size={20} />
        </div>
      )}
    </>
  );
}
