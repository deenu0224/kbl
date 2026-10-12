import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { BatPos, Player, Team } from '../game/types';
import { pitcherLoc, putPitcher, useCore, useStore, useUserTeam, type LeftTab } from '../store';
import { fmtAvg, fmtEra, fmtMoney } from '../game/format';
import { MIN_BATTERS, MIN_PITCHERS, ROSTER_MAX, releaseCost, signingBonus } from '../game/economy';
import { slotNewcomer } from '../game/lineup';
import { signPlayer } from '../game/season';
import { runwayPieceOf } from '../game/runway';
import { betterArms, betterBats, homeSwap, offPos, orderIssues } from '../game/fixes';
import { effDef, teamParts, type TeamParts } from '../game/ratings';
import PlayerCard from './PlayerCard';
import { FirstTip } from './Briefing';
import { useHintTabs } from './RightPanel';
import Sheet from './layout/Sheet';
import { useIsMobile } from './layout/useLayout';
import { OvrBadge, POS_KO, SectionTitle, Stars, TabBar } from './ui';

// ───────── 공용 행 ─────────

function Row({
  lead,
  player: p,
  stat,
  selected,
  target,
  onClick,
  tag,
  fix,
  flash,
  done,
  issue,
}: {
  issue?: boolean; // 오더지: 문제 있는 줄 (왼쪽 빨간 띠)
  tag?: ReactNode; // 이름 옆 작은 태그 ("본 좌익")
  fix?: Fix; // 한 번 탭으로 고치는 칩 ("▲벤치 72 · 타선 +4")
  flash?: boolean; // 방금 영입한 선수의 자리
  done?: boolean; // 방금 칩으로 고친 줄 (초록으로 잠깐 번쩍)
  lead: ReactNode;
  player: Player;
  stat: ReactNode;
  selected: boolean;
  target: boolean; // 교체 모드에서 고를 수 있는 대상
  onClick: () => void;
}) {
  const mobile = useIsMobile();
  return (
    <button
      onClick={onClick}
      data-pid={p.id}
      className={`flex w-full cursor-pointer items-center gap-1.5 px-1 py-[3px] text-left text-[12px] mob:min-h-10 mob:gap-2 mob:text-[13px] ${
        done ? 'bg-good/35' : flash ? 'bg-hi/35' : selected ? 'bg-hi/20' : target ? 'bg-good/10 hover:bg-good/25' : 'hover:bg-white/8'
      }`}
      style={done ? { boxShadow: 'inset 0 0 0 2px #6ee07a' } : flash ? { boxShadow: 'inset 0 0 0 2px #ffd84a' } : selected ? { boxShadow: 'inset 2px 0 0 #ffd84a' } : target ? { boxShadow: 'inset 2px 0 0 #6ee07a' } : issue ? { boxShadow: 'inset 3px 0 0 #ff6b6b' } : undefined}
      data-issue={issue || undefined}
      data-done={done || undefined}
    >
      <span className="w-9 shrink-0 text-[10px] text-white/55">{lead}</span>
      <OvrBadge ovr={p.ovr} size={mobile ? 22 : 18} />
      <span className={`min-w-0 flex-1 truncate ${p.injury > 0 ? 'text-bad' : ''}`}>
        {p.name}
        {p.injury > 0 && <span className="ml-1 text-[10px]">✚{p.injury}</span>}
        {(p.tired ?? 0) > 0 && <span className="ml-1 text-[10px] text-[#f0a35a]">연투{p.tired}</span>}
        {p.star >= 70 && <span className="ml-0.5 text-[10px] text-hi">★</span>}
        {tag && <span className="ml-1 bg-bad/25 px-1 text-[10px] text-bad">{tag}</span>}
      </span>
      {fix ? (
        <span
          role="button"
          data-fix={fix.kind}
          className="flex shrink-0 items-center whitespace-nowrap bg-good/20 px-1 py-0.5 text-[10px] text-good hover:bg-good/35 mob:min-h-8 mob:px-1.5 mob:text-[11px]"
          style={{ boxShadow: '0 0 0 1px #6ee07a88' }}
          onClick={(e) => {
            e.stopPropagation();
            fix.onClick();
          }}
        >
          {fix.label}
          {fix.effect && <span className="text-white"> · {fix.effect}</span>}
        </span>
      ) : (
        <span className="shrink-0 text-[10px] text-white/70 mob:text-[11px]">{stat}</span>
      )}
    </button>
  );
}

interface Fix {
  kind: 'bench' | 'pos' | 'arm';
  label: string; // "▲벤치 72", "⇄ 제자리"
  effect: string; // 누르기 전에 보이는 결과 ("타선 +4 · 수비 +3")
  onClick: () => void;
}

const batStat = (p: Player) => (
  <>
    {fmtAvg(p.bat.h, p.bat.ab)} <span className="text-white/45">{p.bat.hr}홈런 {p.bat.rbi}타점</span>
  </>
);
const pitStat = (p: Player) => (
  <>
    {fmtEra(p.pit.er, p.pit.outs)}{' '}
    <span className="text-white/45">
      {p.pit.w}승 {p.pit.l}패{p.pit.sv ? ` ${p.pit.sv}세` : ''}
    </span>
  </>
);

function Hint({ children, onCancel }: { children: ReactNode; onCancel: () => void }) {
  const mobile = useIsMobile();
  return (
    <div className="flex shrink-0 items-center gap-2 bg-good/15 px-2 py-1 text-[11px] text-good mob:text-[12px]">
      <span className="min-w-0 flex-1">{children}</span>
      {/* 모바일에선 카드 시트가 닫혀 있으므로 여기서 취소 */}
      {mobile && (
        <button className="px-btn gold shrink-0" onClick={onCancel}>
          취소
        </button>
      )}
    </div>
  );
}

/** 선수 카드 자리: 데스크톱은 패널 아래에 붙고, 모바일은 바텀 시트로 뜬다. */
function CardDock({ open, onClose, placeholder, children }: { open: boolean; onClose: () => void; placeholder?: ReactNode; children: ReactNode }) {
  const mobile = useIsMobile();
  if (mobile) return open ? <Sheet onClose={onClose} label="선수 카드">{children}</Sheet> : null;
  if (open) return <>{children}</>;
  return placeholder ? <div className="shrink-0 bg-panel-2/60 p-2 text-center text-[11px] text-white/45">{placeholder}</div> : null;
}

/** 방출 버튼 + 불가 사유 */
function ReleaseButton({ player, team }: { player: Player; team: Team }) {
  const core = useCore();
  const release = useStore((s) => s.release);
  const [arm, setArm] = useState(false);
  useEffect(() => setArm(false), [player.id]);

  const nBat = team.roster.filter((x) => x.kind === 'B').length;
  const nPit = team.roster.length - nBat;
  const cost = releaseCost(player, core);
  const reason =
    player.kind === 'B' && nBat <= MIN_BATTERS
      ? `타자는 최소 ${MIN_BATTERS}명`
      : player.kind === 'P' && nPit <= MIN_PITCHERS
        ? `투수는 최소 ${MIN_PITCHERS}명`
        : core.finance.cash < cost
          ? `위약금 부족 (${fmtMoney(cost)})`
          : null;

  return (
    <>
      <button
        className={`px-btn ${arm ? 'primary' : ''}`}
        disabled={!!reason}
        title={reason ?? `위약금 ${fmtMoney(cost)} (잔여 연봉의 20%)`}
        onClick={() => {
          if (!arm) return setArm(true);
          setArm(false);
          release(player.id);
        }}
      >
        {arm ? '정말 방출?' : '방출'}
      </button>
      <span className={`text-[10px] ${reason ? 'text-bad' : 'text-white/50'}`}>{reason ?? `위약금 ${fmtMoney(cost)}`}</span>
    </>
  );
}

// ───────── 팀 전력 막대 ─────────

export const PART_LABEL: [keyof TeamParts, string][] = [
  ['bat', '타선'],
  ['def', '수비'],
  ['rot', '선발'],
  ['pen', '불펜'],
];
const DELTA_MS = 2000;

/** 타선 54 · 수비 49 · 선발 58 · 불펜 51. 편성을 바꾸는 순간 변한 칸이 "49 → 57"로 잠깐 보인다. */
export function TeamBar({ team }: { team: Team }) {
  const parts = useMemo(() => teamParts(team), [team]);
  const prev = useRef(parts);
  const [delta, setDelta] = useState<Partial<Record<keyof TeamParts, number>>>({});
  useEffect(() => {
    const d: Partial<Record<keyof TeamParts, number>> = {};
    for (const [k] of PART_LABEL) if (prev.current[k] !== parts[k]) d[k] = prev.current[k];
    prev.current = parts;
    if (!Object.keys(d).length) return;
    setDelta(d);
    const id = setTimeout(() => setDelta({}), DELTA_MS);
    return () => clearTimeout(id);
  }, [parts]);
  return (
    <div className="grid shrink-0 grid-cols-4 gap-[3px] px-1.5 pt-1.5" data-testid="teambar">
      {PART_LABEL.map(([k, label]) => {
        const from = delta[k];
        const v = parts[k];
        const tone = from === undefined ? '' : v > from ? 'text-good' : 'text-bad';
        return (
          <div key={k} className="bg-ink/60 px-1 py-0.5 text-center">
            <div className="flex items-baseline justify-center gap-1 whitespace-nowrap text-[10px] text-white/55">
              {label}
              <span className={`text-[13px] ${tone || 'text-white'}`}>{from === undefined ? v : `${from}→${v}`}</span>
            </div>
            <div className="mt-0.5 h-[3px] bg-white/10">
              <div className={`h-full ${from === undefined ? 'bg-sky' : v > from ? 'bg-good' : 'bg-bad'}`} style={{ width: `${Math.min(100, Math.max(0, (v - 30) * 2))}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** 전력 변화 중 가장 큰 1~2칸: "타선 +4 · 수비 +3" */
function partsDelta(a: TeamParts, b: TeamParts): string {
  return PART_LABEL.map(([k, label]) => ({ label, d: b[k] - a[k] }))
    .filter((x) => x.d !== 0)
    .sort((x, y) => Math.abs(y.d) - Math.abs(x.d))
    .slice(0, 2)
    .map((x) => `${x.label} ${x.d > 0 ? '+' : '−'}${Math.abs(x.d)}`)
    .join(' · ');
}

/** 편성을 이렇게 바꾸면 전력이 어떻게 변하는가 (복제본에만 적용) */
function editEffect(team: Team, edit: (t: Team) => void): string {
  const t: Team = { ...team, lineup: team.lineup.map((l) => ({ ...l })), rotation: [...team.rotation], bullpen: [...team.bullpen] };
  edit(t);
  return partsDelta(teamParts(team), teamParts(t));
}

const DONE_MS = 1000;
/** 칩으로 방금 고친 줄들 (1초간 초록) */
function useDone(): [string[], (...pids: string[]) => void] {
  const [done, setDone] = useState<string[]>([]);
  useEffect(() => {
    if (!done.length) return;
    const id = setTimeout(() => setDone([]), DONE_MS);
    return () => clearTimeout(id);
  }, [done]);
  return [done, (...pids) => !useStore.getState().playback && setDone(pids)];
}

/** 방금 영입한 선수의 자리를 잠깐 강조하고 그 줄로 스크롤한다 */
function useFlash(box: React.RefObject<HTMLDivElement | null>): string | null {
  const flash = useStore((s) => s.flash);
  const [pid, setPid] = useState<string | null>(null);
  useEffect(() => {
    if (!flash) return;
    const left = DELTA_MS - (Date.now() - flash.at);
    if (left <= 0) return;
    setPid(flash.pid);
    box.current?.querySelector(`[data-pid="${flash.pid}"]`)?.scrollIntoView({ block: 'nearest' });
    const id = setTimeout(() => setPid(null), left);
    return () => clearTimeout(id);
  }, [flash, box]);
  return pid;
}

export { orderIssues };

// ───────── 타선 ─────────

/** order: 개막전 오더지 안 (전력 막대·자동 편성은 오더지가 따로 놓고, 문제 있는 줄에 빨간 띠) */
export function LineupTab({ order = false }: { order?: boolean }) {
  const team = useUserTeam();
  const swapLineup = useStore((s) => s.swapLineup);
  const substitute = useStore((s) => s.substitute);
  const swapPos = useStore((s) => s.swapPos);
  const [sel, setSel] = useState<string | null>(null);
  const [swap, setSwap] = useState<false | 'order' | 'pos'>(false); // order: 타순·벤치 교체 / pos: 주전끼리 수비 위치 교대
  const mobile = useIsMobile();

  const byId = useMemo(() => new Map(team.roster.map((p) => [p.id, p])), [team.roster]);
  const inLineup = useMemo(() => new Set(team.lineup.map((l) => l.pid)), [team.lineup]);
  const bench = useMemo(
    () => team.roster.filter((p) => p.kind === 'B' && !inLineup.has(p.id)).sort((a, b) => b.ovr - a.ovr),
    [team.roster, inLineup],
  );
  const selP = sel ? byId.get(sel) : undefined;
  const selSlot = sel ? team.lineup.findIndex((l) => l.pid === sel) : -1;
  const box = useRef<HTMLDivElement>(null);
  const benchRef = useRef<HTMLDivElement>(null);
  const flashPid = useFlash(box);
  const better = useMemo(() => betterBats(team), [team]);
  const [done, markDone] = useDone();
  // 줄마다 한 번 탭으로 고치는 칩: 벤치의 더 나은 타자가 먼저, 없으면 제자리 찾기
  const fixes = useMemo(() => {
    const out = new Map<string, Fix>();
    team.lineup.forEach((l, i) => {
      const p = byId.get(l.pid);
      if (!p) return;
      const cand = better.get(p.id);
      if (cand) {
        out.set(p.id, {
          kind: 'bench',
          label: `▲벤치 ${cand.ovr}`,
          effect: editEffect(team, (t) => (t.lineup[i].pid = cand.id)),
          onClick: () => {
            substitute(i, cand.id);
            markDone(cand.id);
          },
        });
        return;
      }
      const j = offPos(p, l.pos) ? homeSwap(team, byId, i) : -1;
      if (j < 0) return;
      const other = team.lineup[j].pid;
      out.set(p.id, {
        kind: 'pos',
        label: '⇄ 제자리',
        effect: editEffect(team, (t) => ([t.lineup[i].pos, t.lineup[j].pos] = [t.lineup[j].pos, t.lineup[i].pos])),
        onClick: () => {
          swapPos(i, j);
          markDone(p.id, other);
        },
      });
    });
    return out;
  }, [team, byId, better]);
  // 교체 모드로 들어가면 후보(벤치)가 바로 보이게
  useEffect(() => {
    if (swap === 'order' && selSlot >= 0) benchRef.current?.scrollIntoView({ block: 'start' });
    if (swap === 'pos') box.current?.scrollTo({ top: 0 });
  }, [swap, selSlot]);

  useEffect(() => {
    if (sel && !byId.has(sel)) {
      setSel(null);
      setSwap(false);
    }
  }, [sel, byId]);

  const click = (pid: string) => {
    if (swap && sel && pid !== sel) {
      const j = team.lineup.findIndex((l) => l.pid === pid);
      if (swap === 'pos') {
        if (selSlot < 0 || j < 0) return; // 수비 교대는 주전끼리만
        swapPos(selSlot, j);
      } else if (selSlot >= 0 && j >= 0) swapLineup(selSlot, j);
      else if (selSlot >= 0) substitute(selSlot, pid);
      else if (j >= 0) substitute(j, sel);
      else {
        setSel(pid); // 벤치끼리는 바꿀 것이 없다
        return;
      }
      setSwap(false);
      if (mobile) setSel(null); // 모바일: 교체가 끝나면 시트를 다시 띄우지 않는다
      return;
    }
    setSwap(false);
    setSel(pid === sel ? null : pid);
  };
  const isTarget = (pid: string) => !!swap && !!sel && pid !== sel && (swap === 'pos' ? inLineup.has(pid) : selSlot >= 0 || inLineup.has(pid));

  return (
    <>
      {!order && <TeamBar team={team} />}
      <div ref={box} className="px-scroll min-h-0 flex-1 overflow-y-auto p-1.5">
        <SectionTitle right={!order && <AutoButton />}>선발 타순</SectionTitle>
        {team.lineup.map((l, i) => {
          const p = byId.get(l.pid);
          if (!p) return null;
          const off = offPos(p, l.pos);
          const fix = swap ? undefined : fixes.get(p.id);
          return (
            <Row
              key={l.pid}
              lead={
                <>
                  <span className="text-hi">{i + 1}</span> <span className={off ? 'text-bad' : ''}>{POS_KO[l.pos]}</span>
                </>
              }
              player={p}
              stat={batStat(p)}
              selected={sel === p.id}
              target={isTarget(p.id)}
              onClick={() => click(p.id)}
              tag={off && !fix ? `본 ${POS_KO[p.pos as BatPos]}` : undefined}
              fix={fix}
              flash={flashPid === p.id}
              done={done.includes(p.id)}
              issue={order && fixes.has(p.id)}
            />
          );
        })}
        <div ref={benchRef}>
          <SectionTitle>벤치 ({bench.length})</SectionTitle>
        </div>
        {bench.map((p) => (
          <Row key={p.id} lead={POS_KO[p.pos]} player={p} stat={batStat(p)} selected={sel === p.id} target={isTarget(p.id)} onClick={() => click(p.id)} flash={flashPid === p.id} />
        ))}
        {!bench.length && <div className="px-1 text-[10px] text-white/40">벤치 타자가 없습니다</div>}
      </div>
      {swap && <Hint onCancel={() => setSwap(false)}>{swap === 'pos' ? `⇄ ${selP?.name}와(과) 수비 위치를 바꿀 주전을 고르세요` : `↔ ${selP?.name}와(과) 바꿀 선수를 고르세요`}</Hint>}
      <CardDock open={!!selP && !(mobile && swap)} onClose={() => setSel(null)} placeholder={order ? undefined : '선수를 누르면 카드가 열립니다'}>
        {selP && (
          <PlayerCard player={selP} team={team} roleLabel={selSlot >= 0 ? `${selSlot + 1}번 · ${POS_KO[team.lineup[selSlot].pos]}` : `벤치 · ${POS_KO[selP.pos]}`}>
            <button className={`px-btn ${swap ? 'gold' : 'green'}`} onClick={() => setSwap((v) => (v ? false : 'order'))} title="타순 맞바꾸기 또는 벤치 선수와 교체">
              {swap ? '취소' : '↔ 교체'}
            </button>
            {selSlot >= 0 && !swap && (
              <button className="px-btn" onClick={() => setSwap('pos')} title="다른 주전과 수비 위치만 맞바꾸기 (타순은 그대로)">
                ⇄ 수비 교대
              </button>
            )}
            <ReleaseButton player={selP} team={team} />
          </PlayerCard>
        )}
      </CardDock>
    </>
  );
}

// ───────── 투수 ─────────

export function PitchersTab({ order = false }: { order?: boolean }) {
  const team = useUserTeam();
  const swapPitchers = useStore((s) => s.swapPitchers);
  const [sel, setSel] = useState<string | null>(null);
  const [swap, setSwap] = useState(false);
  const mobile = useIsMobile();

  const byId = useMemo(() => new Map(team.roster.map((p) => [p.id, p])), [team.roster]);
  const assigned = useMemo(
    () => new Set([...team.rotation, ...team.bullpen, ...(team.closer ? [team.closer] : [])]),
    [team.rotation, team.bullpen, team.closer],
  );
  const spare = useMemo(() => team.roster.filter((p) => p.kind === 'P' && !assigned.has(p.id)), [team.roster, assigned]);
  const selP = sel ? byId.get(sel) : undefined;
  const box = useRef<HTMLDivElement>(null);
  const penRef = useRef<HTMLDivElement>(null);
  const flashPid = useFlash(box);
  const better = useMemo(() => betterArms(team), [team]);
  const [done, markDone] = useDone();
  const selInRot = !!sel && (team.rotation.includes(sel) || team.closer === sel);
  useEffect(() => {
    if (swap && selInRot) penRef.current?.scrollIntoView({ block: 'start' });
  }, [swap, selInRot]);

  useEffect(() => {
    if (sel && !byId.has(sel)) {
      setSel(null);
      setSwap(false);
    }
  }, [sel, byId]);

  const roleOf = (pid: string): string => {
    const ri = team.rotation.indexOf(pid);
    if (ri >= 0) return `${ri + 1}선발`;
    if (team.closer === pid) return '마무리';
    if (team.bullpen.includes(pid)) return '불펜';
    return '대기';
  };
  const click = (pid: string) => {
    if (swap && sel && pid !== sel) {
      swapPitchers(sel, pid);
      setSwap(false);
      if (mobile) setSel(null);
      return;
    }
    setSwap(false);
    setSel(pid === sel ? null : pid);
  };
  const row = (pid: string, lead: ReactNode) => {
    const p = byId.get(pid);
    if (!p) return null;
    const inRot = team.rotation.includes(pid);
    const up = swap ? undefined : better.get(pid);
    const fix: Fix | undefined = up && {
      kind: 'arm',
      label: `▲${up.from} ${up.cand.ovr}`,
      effect: editEffect(team, (t) => {
        const la = pitcherLoc(t, pid);
        const lb = pitcherLoc(t, up.cand.id);
        putPitcher(t, la, up.cand.id);
        putPitcher(t, lb, pid);
      }),
      onClick: () => {
        swapPitchers(pid, up.cand.id);
        markDone(up.cand.id);
      },
    };
    return (
      <Row
        key={pid}
        lead={lead}
        player={p}
        stat={pitStat(p)}
        selected={sel === pid}
        target={swap && !!sel && sel !== pid}
        onClick={() => click(pid)}
        tag={fix ? undefined : inRot && p.pos !== 'SP' ? `본 ${POS_KO[p.pos]}` : !inRot && p.pos === 'SP' ? '본 선발' : p.pos === 'CP' && team.closer !== pid ? '본 마무리' : undefined}
        fix={fix}
        flash={flashPid === pid}
        done={done.includes(pid)}
        issue={order && better.has(pid)}
      />
    );
  };
  const nextIdx = team.rotation.length ? team.nextStarter % team.rotation.length : -1;

  return (
    <>
      {!order && <TeamBar team={team} />}
      <div ref={box} className="px-scroll min-h-0 flex-1 overflow-y-auto p-1.5">
        <SectionTitle right={!order && <AutoButton />}>선발 로테이션</SectionTitle>
        {team.rotation.map((pid, i) =>
          row(
            pid,
            <>
              <span className="text-hi">{i + 1}</span> 선발{i === nextIdx && <span className="text-good"> ◀</span>}
            </>,
          ),
        )}
        <div className="px-1 text-[10px] text-white/40">◀ 다음 경기 선발</div>
        <SectionTitle>마무리</SectionTitle>
        {team.closer ? row(team.closer, '마무리') : <div className="px-1 text-[10px] text-bad">마무리 투수가 없습니다</div>}
        <div ref={penRef}>
          <SectionTitle>불펜 ({team.bullpen.length})</SectionTitle>
        </div>
        {team.bullpen.map((pid, i) => row(pid, `불펜${i + 1}`))}
        {spare.length > 0 && (
          <>
            <SectionTitle>대기 ({spare.length})</SectionTitle>
            {spare.map((p) => row(p.id, '대기'))}
          </>
        )}
      </div>
      {swap && <Hint onCancel={() => setSwap(false)}>↔ {selP?.name}와(과) 보직을 바꿀 투수를 고르세요</Hint>}
      <CardDock open={!!selP && !(mobile && swap)} onClose={() => setSel(null)} placeholder={order ? undefined : '투수를 누르면 카드가 열립니다'}>
        {selP && (
          <PlayerCard player={selP} team={team} roleLabel={roleOf(selP.id)}>
            <button className={`px-btn ${swap ? 'gold' : 'green'}`} onClick={() => setSwap((v) => !v)} title="다른 투수와 보직 맞바꾸기">
              {swap ? '취소' : '↔ 교체'}
            </button>
            <ReleaseButton player={selP} team={team} />
          </PlayerCard>
        )}
      </CardDock>
    </>
  );
}

// ───────── 영입 ─────────

export function MarketTab() {
  const team = useUserTeam();
  const freeAgents = useStore((s) => s.freeAgents);
  const cash = useStore((s) => s.finance.cash);
  const sign = useStore((s) => s.sign);
  const core = useCore();
  const [sel, setSel] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'B' | 'P'>('all');

  // 스카우트 팀장의 명단은 시장 맨 위에 따로 올린다 (맨 앞이 그가 고른 선수)
  const scoutIds = useStore((s) => s.campaign.eventsSeen.find((x) => x.startsWith('~scoutList='))?.slice(11) ?? '');
  const list = useMemo(() => {
    const ids = scoutIds ? scoutIds.split(',') : [];
    const rank = (p: Player) => (ids.includes(p.id) ? ids.indexOf(p.id) - 9 : 0);
    return freeAgents.filter((p) => filter === 'all' || p.kind === filter).sort((a, b) => rank(a) - rank(b) || b.ovr - a.ovr);
  }, [freeAgents, filter, scoutIds]);
  const scoutPick = scoutIds.split(',')[0];
  const selP = sel ? freeAgents.find((p) => p.id === sel) : undefined;
  const full = team.roster.length >= ROSTER_MAX;
  const bonus = selP ? signingBonus(selP) : 0;
  // 영입하면: 자동으로 들어갈 자리를 복제본에 적용해 본 전력 변화
  const preview = useMemo(() => {
    if (!selP) return null;
    const t = structuredClone(team);
    const p = structuredClone(selP);
    t.roster.push(p);
    const role = slotNewcomer(t, p);
    const a = teamParts(team);
    const b = teamParts(t);
    const moved = PART_LABEL.filter(([k]) => a[k] !== b[k])
      .sort(([x], [y]) => Math.abs(b[y] - a[y]) - Math.abs(b[x] - a[x]))
      .slice(0, 2)
      .map(([k, label]) => ({ label, from: a[k], to: b[k] }));
    return { role, moved };
  }, [selP, team]);
  // 영입하면 금고가 언제 비는가 (안전하면 없음)
  const signPiece = useMemo(() => {
    if (!selP) return null;
    const r = signPlayer(core, selP.id);
    return r.error ? null : runwayPieceOf(core, r.core);
  }, [core, selP]);
  const reason = !selP ? null : full ? `로스터 정원 초과 (${ROSTER_MAX}명)` : cash < bonus ? `현금 부족 (계약금 ${fmtMoney(bonus)})` : null;

  return (
    <>
      <FirstTip id="market" />
      <div className="flex shrink-0 items-center gap-1 px-1.5 pt-1.5 text-[10px]">
        {(
          [
            ['all', '전체'],
            ['B', '타자'],
            ['P', '투수'],
          ] as const
        ).map(([k, label]) => (
          <button key={k} onClick={() => setFilter(k)} className={`cursor-pointer px-1.5 py-0.5 mob:min-h-9 mob:px-3 ${filter === k ? 'bg-hi text-ink' : 'bg-ink text-white/60'}`}>
            {label}
          </button>
        ))}
        <span className={`ml-auto ${full ? 'text-bad' : 'text-white/50'}`}>
          로스터 {team.roster.length}/{ROSTER_MAX}
        </span>
      </div>
      <div className="px-scroll min-h-0 flex-1 overflow-y-auto p-1.5">
        {list.map((p) => {
          const b = signingBonus(p);
          const afford = cash >= b;
          return (
            <button
              key={p.id}
              onClick={() => setSel(p.id === sel ? null : p.id)}
              className={`mb-[3px] flex w-full cursor-pointer items-center gap-1.5 px-1 py-1 text-left mob:min-h-12 mob:gap-2 mob:px-1.5 ${sel === p.id ? 'bg-hi/20' : 'bg-ink/40 hover:bg-white/8'}`}
              style={sel === p.id ? { boxShadow: 'inset 2px 0 0 #ffd84a' } : undefined}
            >
              <OvrBadge ovr={p.ovr} size={22} />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1 text-[12px] mob:text-[13px]">
                  <span className="truncate">{p.name}</span>
                  <span className="shrink-0 text-[10px] text-white/50">
                    {POS_KO[p.pos]} · {p.age}세
                  </span>
                </span>
                <span className="flex items-center gap-1.5 text-[10px]">
                  <Stars star={p.star} />
                  {p.pot - p.ovr >= 6 && <span className="text-good">잠재 {p.pot}</span>}
                  {scoutIds.includes(p.id) && (
                    <span className={`truncate ${p.id === scoutPick ? 'text-hi' : 'text-sky'}`}>
                      📋 {p.id === scoutPick ? '팀장 추천 · ' : ''}
                      {(p.tag ?? '스카우트 명단').replace('스카우트 명단 · ', '')}
                    </span>
                  )}
                </span>
              </span>
              <span className="shrink-0 text-right text-[10px] leading-tight">
                <span className="block text-white/80">연 {fmtMoney(p.salary)}</span>
                <span className={`block ${afford ? 'text-hi' : 'text-bad'}`}>계약금 {fmtMoney(b)}</span>
              </span>
            </button>
          );
        })}
        {!list.length && <div className="p-2 text-center text-[11px] text-white/40">시장에 남은 선수가 없습니다</div>}
      </div>
      <CardDock open={!!selP} onClose={() => setSel(null)} placeholder="선수를 누르면 카드가 열립니다">
        {selP && (
          <PlayerCard
            player={selP}
            extra={
              <div className="mt-1 bg-ink/60 px-1.5 py-1 text-[11px]" data-testid="sign-preview">
                <div>
                  <span className="text-white/60">영입하면: </span>
                  {preview?.moved.length ? (
                    preview.moved.map((m, i) => (
                      <span key={m.label}>
                        {i > 0 && ' · '}
                        {m.label} {m.from} → <span className={m.to > m.from ? 'text-good' : 'text-bad'}>{m.to}</span>
                      </span>
                    ))
                  ) : (
                    <span className="text-white/75">{preview?.role} · 전력 변화 없음</span>
                  )}
                </div>
                <div className="text-white/60">
                  연봉 <span className="text-white">+{fmtMoney(selP.salary)}/시즌</span> · 계약금 <span className="text-hi">{fmtMoney(bonus)}</span>
                </div>
                {signPiece && (
                  <div className="text-hi" data-testid="runway-piece">
                    {signPiece}
                  </div>
                )}
              </div>
            }
          >
            <button className="px-btn primary" data-sfx="none" disabled={!!reason} onClick={() => sign(selP.id)}>
              영입
            </button>
            {reason && <span className="text-[10px] text-bad">{reason}</span>}
          </PlayerCard>
        )}
      </CardDock>
    </>
  );
}

// ───────── 패널 ─────────

const TABS: { id: LeftTab; label: string }[] = [
  { id: 'lineup', label: '타선' },
  { id: 'pitchers', label: '투수' },
  { id: 'market', label: '영입' },
];

/** [자동 편성]: 감독이 승복하기 전(0장 클리어 전)에는 "감독에게 맡기기"다 */
export function AutoButton({ className = '!px-1.5 !py-0.5 text-[10px] mob:!px-3 mob:text-[12px]', order = false }: { className?: string; order?: boolean }) {
  const auto = useStore((s) => s.auto);
  const yielded = useStore((s) => !!s.campaign.managerYielded);
  // 오더지 안, 승복 전: 감독의 편성으로 되돌리는 버튼이라 작게 둔다
  if (order && !yielded) {
    return (
      <button className="shrink-0 cursor-pointer self-center px-1 text-[11px] text-white/50 underline hover:text-white/80 mob:min-h-11" data-testid="order-reset" onClick={auto}>
        감독의 원래 오더로
      </button>
    );
  }
  return (
    <button
      className={`px-btn ${className}`}
      onClick={auto}
      title={yielded ? 'OVR 기준으로 타선·투수진을 다시 짭니다' : '감독이 자기 방식대로 타선·투수진을 짭니다'}
    >
      {yielded ? '자동 편성' : '감독에게 맡기기'}
    </button>
  );
}

export default function LeftPanel() {
  const tab = useStore((s) => s.leftTab);
  const setTab = useStore((s) => s.setTab);
  const clearHint = useStore((s) => s.clearHint);
  const tabs = useHintTabs(TABS, tab);
  return (
    <div className="px-panel flex h-full min-h-0 flex-col">
      <TabBar
        tabs={tabs}
        value={tab}
        onChange={(t) => {
          clearHint(t);
          setTab('left', t);
        }}
      />
      {tab === 'lineup' && <LineupTab />}
      {tab === 'pitchers' && <PitchersTab />}
      {tab === 'market' && <MarketTab />}
    </div>
  );
}
