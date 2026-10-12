import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Player, Team } from '../game/types';
import { useCore, useStore, useUserTeam, type LeftTab } from '../store';
import { fmtAvg, fmtEra, fmtMoney } from '../game/format';
import { MIN_BATTERS, MIN_PITCHERS, ROSTER_MAX, releaseCost, signingBonus } from '../game/economy';
import PlayerCard from './PlayerCard';
import { OvrBadge, POS_KO, SectionTitle, Stars, TabBar } from './ui';

// ───────── 공용 행 ─────────

function Row({
  lead,
  player: p,
  stat,
  selected,
  target,
  onClick,
}: {
  lead: ReactNode;
  player: Player;
  stat: ReactNode;
  selected: boolean;
  target: boolean; // 교체 모드에서 고를 수 있는 대상
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full cursor-pointer items-center gap-1.5 px-1 py-[3px] text-left text-[12px] ${
        selected ? 'bg-hi/20' : target ? 'bg-good/10 hover:bg-good/25' : 'hover:bg-white/8'
      }`}
      style={selected ? { boxShadow: 'inset 2px 0 0 #ffd84a' } : target ? { boxShadow: 'inset 2px 0 0 #6ee07a' } : undefined}
    >
      <span className="w-9 shrink-0 text-[10px] text-white/55">{lead}</span>
      <OvrBadge ovr={p.ovr} size={18} />
      <span className={`min-w-0 flex-1 truncate ${p.injury > 0 ? 'text-bad' : ''}`}>
        {p.name}
        {p.injury > 0 && <span className="ml-1 text-[10px]">✚{p.injury}</span>}
        {p.star >= 70 && <span className="ml-0.5 text-[10px] text-hi">★</span>}
      </span>
      <span className="shrink-0 text-[10px] text-white/70">{stat}</span>
    </button>
  );
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

function Hint({ children }: { children: ReactNode }) {
  return <div className="bg-good/15 px-2 py-1 text-[11px] text-good">{children}</div>;
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

// ───────── 타선 ─────────

export function LineupTab() {
  const team = useUserTeam();
  const swapLineup = useStore((s) => s.swapLineup);
  const substitute = useStore((s) => s.substitute);
  const auto = useStore((s) => s.auto);
  const [sel, setSel] = useState<string | null>(null);
  const [swap, setSwap] = useState(false);

  const byId = useMemo(() => new Map(team.roster.map((p) => [p.id, p])), [team.roster]);
  const inLineup = useMemo(() => new Set(team.lineup.map((l) => l.pid)), [team.lineup]);
  const bench = useMemo(
    () => team.roster.filter((p) => p.kind === 'B' && !inLineup.has(p.id)).sort((a, b) => b.ovr - a.ovr),
    [team.roster, inLineup],
  );
  const selP = sel ? byId.get(sel) : undefined;
  const selSlot = sel ? team.lineup.findIndex((l) => l.pid === sel) : -1;

  useEffect(() => {
    if (sel && !byId.has(sel)) {
      setSel(null);
      setSwap(false);
    }
  }, [sel, byId]);

  const click = (pid: string) => {
    if (swap && sel && pid !== sel) {
      const j = team.lineup.findIndex((l) => l.pid === pid);
      if (selSlot >= 0 && j >= 0) swapLineup(selSlot, j);
      else if (selSlot >= 0) substitute(selSlot, pid);
      else if (j >= 0) substitute(j, sel);
      else {
        setSel(pid); // 벤치끼리는 바꿀 것이 없다
        return;
      }
      setSwap(false);
      return;
    }
    setSwap(false);
    setSel(pid === sel ? null : pid);
  };
  const isTarget = (pid: string) => swap && !!sel && pid !== sel && (selSlot >= 0 || inLineup.has(pid));

  return (
    <>
      <div className="px-scroll min-h-0 flex-1 overflow-y-auto p-1.5">
        <SectionTitle
          right={
            <button className="px-btn !px-1.5 !py-0.5 text-[10px]" onClick={auto} title="OVR 기준으로 타선·투수진을 다시 짭니다">
              자동 편성
            </button>
          }
        >
          선발 타순
        </SectionTitle>
        {team.lineup.map((l, i) => {
          const p = byId.get(l.pid);
          if (!p) return null;
          return (
            <Row
              key={l.pid}
              lead={
                <>
                  <span className="text-hi">{i + 1}</span> {POS_KO[l.pos]}
                </>
              }
              player={p}
              stat={batStat(p)}
              selected={sel === p.id}
              target={isTarget(p.id)}
              onClick={() => click(p.id)}
            />
          );
        })}
        <SectionTitle>벤치 ({bench.length})</SectionTitle>
        {bench.map((p) => (
          <Row key={p.id} lead={POS_KO[p.pos]} player={p} stat={batStat(p)} selected={sel === p.id} target={isTarget(p.id)} onClick={() => click(p.id)} />
        ))}
        {!bench.length && <div className="px-1 text-[10px] text-white/40">벤치 타자가 없습니다</div>}
      </div>
      {swap && <Hint>↔ {selP?.name}와(과) 바꿀 선수를 고르세요</Hint>}
      {selP ? (
        <PlayerCard player={selP} team={team} roleLabel={selSlot >= 0 ? `${selSlot + 1}번 · ${POS_KO[team.lineup[selSlot].pos]}` : `벤치 · ${POS_KO[selP.pos]}`}>
          <button className={`px-btn ${swap ? 'gold' : 'green'}`} onClick={() => setSwap((v) => !v)} title="타순 맞바꾸기 또는 벤치 선수와 교체">
            {swap ? '취소' : '↔ 교체'}
          </button>
          <ReleaseButton player={selP} team={team} />
        </PlayerCard>
      ) : (
        <div className="shrink-0 bg-panel-2/60 p-2 text-center text-[11px] text-white/45">선수를 누르면 카드가 열립니다</div>
      )}
    </>
  );
}

// ───────── 투수 ─────────

export function PitchersTab() {
  const team = useUserTeam();
  const swapPitchers = useStore((s) => s.swapPitchers);
  const auto = useStore((s) => s.auto);
  const [sel, setSel] = useState<string | null>(null);
  const [swap, setSwap] = useState(false);

  const byId = useMemo(() => new Map(team.roster.map((p) => [p.id, p])), [team.roster]);
  const assigned = useMemo(
    () => new Set([...team.rotation, ...team.bullpen, ...(team.closer ? [team.closer] : [])]),
    [team.rotation, team.bullpen, team.closer],
  );
  const spare = useMemo(() => team.roster.filter((p) => p.kind === 'P' && !assigned.has(p.id)), [team.roster, assigned]);
  const selP = sel ? byId.get(sel) : undefined;

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
      return;
    }
    setSwap(false);
    setSel(pid === sel ? null : pid);
  };
  const row = (pid: string, lead: ReactNode) => {
    const p = byId.get(pid);
    if (!p) return null;
    return (
      <Row key={pid} lead={lead} player={p} stat={pitStat(p)} selected={sel === pid} target={swap && !!sel && sel !== pid} onClick={() => click(pid)} />
    );
  };
  const nextIdx = team.rotation.length ? team.nextStarter % team.rotation.length : -1;

  return (
    <>
      <div className="px-scroll min-h-0 flex-1 overflow-y-auto p-1.5">
        <SectionTitle
          right={
            <button className="px-btn !px-1.5 !py-0.5 text-[10px]" onClick={auto} title="OVR 기준으로 타선·투수진을 다시 짭니다">
              자동 편성
            </button>
          }
        >
          선발 로테이션
        </SectionTitle>
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
        <SectionTitle>불펜 ({team.bullpen.length})</SectionTitle>
        {team.bullpen.map((pid, i) => row(pid, `불펜${i + 1}`))}
        {spare.length > 0 && (
          <>
            <SectionTitle>대기 ({spare.length})</SectionTitle>
            {spare.map((p) => row(p.id, '대기'))}
          </>
        )}
      </div>
      {swap && <Hint>↔ {selP?.name}와(과) 보직을 바꿀 투수를 고르세요</Hint>}
      {selP ? (
        <PlayerCard player={selP} team={team} roleLabel={roleOf(selP.id)}>
          <button className={`px-btn ${swap ? 'gold' : 'green'}`} onClick={() => setSwap((v) => !v)} title="다른 투수와 보직 맞바꾸기">
            {swap ? '취소' : '↔ 교체'}
          </button>
          <ReleaseButton player={selP} team={team} />
        </PlayerCard>
      ) : (
        <div className="shrink-0 bg-panel-2/60 p-2 text-center text-[11px] text-white/45">투수를 누르면 카드가 열립니다</div>
      )}
    </>
  );
}

// ───────── 영입 ─────────

export function MarketTab() {
  const team = useUserTeam();
  const freeAgents = useStore((s) => s.freeAgents);
  const cash = useStore((s) => s.finance.cash);
  const sign = useStore((s) => s.sign);
  const [sel, setSel] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'B' | 'P'>('all');

  const list = useMemo(
    () => freeAgents.filter((p) => filter === 'all' || p.kind === filter).sort((a, b) => b.ovr - a.ovr),
    [freeAgents, filter],
  );
  const selP = sel ? freeAgents.find((p) => p.id === sel) : undefined;
  const full = team.roster.length >= ROSTER_MAX;
  const bonus = selP ? signingBonus(selP) : 0;
  const reason = !selP ? null : full ? `로스터 정원 초과 (${ROSTER_MAX}명)` : cash < bonus ? `현금 부족 (계약금 ${fmtMoney(bonus)})` : null;

  return (
    <>
      <div className="flex shrink-0 items-center gap-1 px-1.5 pt-1.5 text-[10px]">
        {(
          [
            ['all', '전체'],
            ['B', '타자'],
            ['P', '투수'],
          ] as const
        ).map(([k, label]) => (
          <button key={k} onClick={() => setFilter(k)} className={`cursor-pointer px-1.5 py-0.5 ${filter === k ? 'bg-hi text-ink' : 'bg-ink text-white/60'}`}>
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
              className={`mb-[3px] flex w-full cursor-pointer items-center gap-1.5 px-1 py-1 text-left ${sel === p.id ? 'bg-hi/20' : 'bg-ink/40 hover:bg-white/8'}`}
              style={sel === p.id ? { boxShadow: 'inset 2px 0 0 #ffd84a' } : undefined}
            >
              <OvrBadge ovr={p.ovr} size={22} />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1 text-[12px]">
                  <span className="truncate">{p.name}</span>
                  <span className="shrink-0 text-[10px] text-white/50">
                    {POS_KO[p.pos]} · {p.age}세
                  </span>
                </span>
                <span className="flex items-center gap-1.5 text-[10px]">
                  <Stars star={p.star} />
                  {p.pot - p.ovr >= 6 && <span className="text-good">잠재 {p.pot}</span>}
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
      {selP ? (
        <PlayerCard
          player={selP}
          extra={
            <div className="mt-1 flex justify-between bg-ink/60 px-1.5 py-1 text-[11px]">
              <span>
                계약금 <span className="text-hi">{fmtMoney(bonus)}</span>
              </span>
              <span className="text-white/60">연봉은 매 경기 분할 지급</span>
            </div>
          }
        >
          <button className="px-btn primary" disabled={!!reason} title={reason ?? '계약금을 내고 즉시 영입'} onClick={() => sign(selP.id)}>
            영입
          </button>
          {reason && <span className="text-[10px] text-bad">{reason}</span>}
        </PlayerCard>
      ) : (
        <div className="shrink-0 bg-panel-2/60 p-2 text-center text-[11px] text-white/45">
          스타(★)를 영입하면 관중과 굿즈 매출이 늘어납니다
        </div>
      )}
    </>
  );
}

// ───────── 패널 ─────────

const TABS: { id: LeftTab; label: string }[] = [
  { id: 'lineup', label: '타선' },
  { id: 'pitchers', label: '투수' },
  { id: 'market', label: '영입' },
];

export default function LeftPanel() {
  const tab = useStore((s) => s.leftTab);
  const setTab = useStore((s) => s.setTab);
  return (
    <div className="px-panel flex h-full min-h-0 flex-col">
      <TabBar tabs={TABS} value={tab} onChange={(t) => setTab('left', t)} />
      {tab === 'lineup' && <LineupTab />}
      {tab === 'pitchers' && <PitchersTab />}
      {tab === 'market' && <MarketTab />}
    </div>
  );
}
