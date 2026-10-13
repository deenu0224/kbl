import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Player, Team } from '../game/types';
import { useCore, useStore, useUserTeam, type LeftTab } from '../store';
import { fmtMoney } from '../game/format';
import { FARM_MAX, ROSTER_MAX, activeRoster, farmRoster, releaseCost } from '../game/economy';
import { basketCount } from '../game/transfer';
import { betterArms, betterBats, homeSwap, offPos, orderIssues } from '../game/fixes';
import { teamParts, type TeamParts } from '../game/ratings';
import PlayerCard from './PlayerCard';
import Help from './Help';
import { useEditorUi } from './roster/editorOps';
import { FirstTip } from './Briefing';
import { useHintTabs } from './RightPanel';
import Sheet from './layout/Sheet';
import { useIsMobile } from './layout/useLayout';
import { OvrBadge, POS_FULL, POS_KO, SectionTitle, TabBar } from './ui';
import { MiniDiamond } from './roster/Diamond';
import FrontOffice, { CardPop } from './roster/FrontOffice';
import PlayerBrowser from './roster/PlayerBrowser';
import { AddChip } from './roster/TransferDesk';
import { openDesk, useTransferUi } from './roster/transferUi';
import { usePosReport, useRosterUi } from './roster/rosterUi';
import { PenLoadLine } from './roster/PenStyle';
import { callUpPreview, sendDownPreview } from '../game/analysis';

// ───────── 공용 행 ─────────

/** 보기 전용 한 줄: 타순(보직)·포지션 · 이름 · OVR. 고칠 곳이 있는 줄은 왼쪽 빨간 띠만 */
function Row({ lead, player: p, selected, onClick, flash, issue }: { lead: ReactNode; player: Player; selected: boolean; onClick: () => void; flash?: boolean; issue?: boolean }) {
  const mobile = useIsMobile();
  return (
    <button
      onClick={onClick}
      data-pid={p.id}
      data-issue={issue || undefined}
      className={`flex w-full cursor-pointer items-center gap-1.5 px-1 py-[3px] text-left text-[12px] mob:min-h-10 mob:gap-2 mob:text-[13px] ${flash ? 'bg-hi/35' : selected ? 'bg-hi/20' : 'hover:bg-white/8'}`}
      style={flash ? { boxShadow: 'inset 0 0 0 2px #ffd84a' } : selected ? { boxShadow: 'inset 2px 0 0 #ffd84a' } : issue ? { boxShadow: 'inset 3px 0 0 #ff6b6b' } : undefined}
    >
      <span className="w-12 shrink-0 whitespace-nowrap text-[10px] text-white/55 max-lg:w-auto max-lg:min-w-[58px]">{lead}</span>
      <span className={`min-w-0 flex-1 truncate ${p.injury > 0 ? 'text-bad' : ''}`}>{p.name}</span>
      <OvrBadge ovr={p.ovr} size={mobile ? 22 : 18} />
    </button>
  );
}

/** 선수 카드 자리: 데스크톱은 패널 아래에 붙고, 모바일은 바텀 시트로 뜬다. */
function CardDock({ open, onClose, placeholder, children }: { open: boolean; onClose: () => void; placeholder?: ReactNode; children: ReactNode }) {
  const mobile = useIsMobile();
  if (mobile) return open ? <Sheet onClose={onClose} label="선수 카드">{children}</Sheet> : null;
  if (open) return <>{children}</>;
  return placeholder ? <div className="shrink-0 bg-panel-2/60 p-2 text-center text-[11px] text-white/45">{placeholder}</div> : null;
}

/** [2군으로] / [콜업] 버튼 + 누르기 전에 보이는 결과 줄 */
/** 미리 보기 문장을 숫자 한 줄로: "재등록 10경기 · 성장 12% → 30%" */
const shortPv = (text: string) =>
  text
    .replace(/(\d+)경기 동안 재등록 불가/, '재등록 $1경기')
    .replace('시즌 전: 재등록 제한 없음', '재등록 제한 없음')
    .replace('주당 성장 확률', '성장')
    .replace(/오버롤 (\d+) 이상은 2군에서 안 자란다/, '오버롤 $1 이상 성장 없음')
    .replace('더 자라지 않는 선수', '성장 없음');

export function FarmMoveButton({ player, onDone }: { player: Player; onDone?: () => void }) {
  const core = useCore();
  const sendDown = useStore((s) => s.sendDown);
  const callUp = useStore((s) => s.callUp);
  const pv = player.farm ? callUpPreview(core, player) : sendDownPreview(core, player);
  return (
    <>
      <button
        className={`px-btn ${player.farm ? 'green' : ''}`}
        data-testid={player.farm ? 'call-up' : 'send-down'}
        disabled={!pv.ok}
        onClick={() => {
          (player.farm ? callUp : sendDown)(player.id);
          onDone?.();
        }}
      >
        {player.farm ? '▲ 콜업' : '▼ 2군으로'}
      </button>
      <span className={`basis-full truncate text-[10px] leading-snug mob:text-[13px] ${pv.ok ? 'text-white/65' : 'text-bad'}`} data-testid="farm-preview">
        {shortPv(pv.text)}
      </span>
    </>
  );
}

// ───────── 2군 ─────────

export function FarmTab() {
  const team = useUserTeam();
  const [sel, setSel] = useState<string | null>(null);
  const farm = useMemo(() => farmRoster(team).sort((a, b) => Number(a.kind === 'P') - Number(b.kind === 'P') || b.ovr - a.ovr), [team]);
  const nAct = activeRoster(team).length;
  const selP = sel ? farm.find((p) => p.id === sel) : undefined;
  return (
    <>
      <div className="flex shrink-0 items-center gap-2 px-1.5 pt-1 text-[11px] text-white/60 mob:text-[13px]" data-testid="farm-head">
        <span className="min-w-0 flex-1">
          1군 <span className={nAct >= ROSTER_MAX ? 'text-bad' : 'text-white'}>{nAct}/{ROSTER_MAX}</span> · 2군 <span className={farm.length >= FARM_MAX ? 'text-bad' : 'text-white'}>{farm.length}/{FARM_MAX}</span>
        </span>
        <Help topic="farm" />
      </div>
      <div className="px-scroll min-h-0 flex-1 overflow-y-auto p-1.5" data-testid="farm-list">
        {farm.map((p) => (
          <Row key={p.id} lead={POS_KO[p.pos]} player={p} selected={sel === p.id} onClick={() => setSel(sel === p.id ? null : p.id)} />
        ))}
      </div>
      <CardDock open={!!selP} onClose={() => setSel(null)} placeholder={farm.length ? '선수를 누르면 카드가 열립니다' : undefined}>
        {selP && (
          <PlayerCard player={selP} team={team} roleLabel={`2군 · ${POS_FULL[selP.pos]}`}>
            <EditButton pid={selP.id} onDone={() => setSel(null)} />
            <FarmMoveButton player={selP} onDone={() => setSel(null)} />
            <ReleaseButton player={selP} team={team} />
          </PlayerCard>
        )}
      </CardDock>
    </>
  );
}

/** 선수 카드의 [오더 편집에서 보기]: 그 선수가 선택된 채로 편집기를 연다 */
function EditButton({ pid, onDone }: { pid: string; onDone: () => void }) {
  const openEditor = useEditorUi((s) => s.openEditor);
  return (
    <button
      className="px-btn green"
      data-testid="card-edit"
      onClick={() => {
        onDone();
        openEditor(pid);
      }}
    >
      오더 편집에서 보기
    </button>
  );
}

/** [방출 담기]: 즉시 방출하지 않고 이적 창구에 담는다 (얻는 것·잃는 것을 한 화면에서 보고 확정) */
export function ReleaseButton({ player }: { player: Player; team?: Team }) {
  const core = useCore();
  const cost = releaseCost(player, core);
  return (
    <>
      <button className="px-btn" data-testid="release-to-desk" title="이적 창구에 방출로 담는다 (확정 전까지 실제 선수단은 그대로)" onClick={() => openDesk({ add: [['release', player.id]] })}>
        방출 담기 ⤢
      </button>
      <span className="text-[10px] text-white/50 mob:text-[13px]" data-testid="release-cost" title="방출 시 잔여 연봉 지급">−{fmtMoney(cost)}</span>
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

/** 선수단 탭 맨 위: 전력 막대 · [오더 편집] · 팀 진단 미니맵. 목록은 보기 전용이고, 고치는 일은 전부 오더 편집기에서 한다 */
function RosterTop({ team }: { team: Team }) {
  const rows = usePosReport();
  const openOffice = useRosterUi((s) => s.openOffice);
  const openEditor = useEditorUi((s) => s.openEditor);
  return (
    <>
      <div className="flex shrink-0 items-end gap-1 pr-1.5">
        <div className="min-w-0 flex-1 cursor-pointer" onClick={() => openOffice('table')} title="선수단 크게 보기" data-testid="teambar-open">
          <TeamBar team={team} />
        </div>
        <Help topic="strength" />
      </div>
      <div className="shrink-0 px-1.5 pt-1.5">
        <button className="px-btn primary min-h-9 w-full text-[13px] mob:min-h-11 mob:text-[15px]" data-testid="open-editor" onClick={() => openEditor()}>
          오더 편집
        </button>
      </div>
      <MiniDiamond rows={rows} onOpen={() => openOffice('diag')} />
      <FrontOffice />
    </>
  );
}

// ───────── 타선 ─────────

export function LineupTab() {
  const team = useUserTeam();
  const [sel, setSel] = useState<string | null>(null);

  const byId = useMemo(() => new Map(team.roster.map((p) => [p.id, p])), [team.roster]);
  const inLineup = useMemo(() => new Set(team.lineup.map((l) => l.pid)), [team.lineup]);
  const bench = useMemo(
    () => team.roster.filter((p) => p.kind === 'B' && !p.farm && !inLineup.has(p.id)).sort((a, b) => b.ovr - a.ovr),
    [team.roster, inLineup],
  );
  const selP = sel ? byId.get(sel) : undefined;
  const selSlot = sel ? team.lineup.findIndex((l) => l.pid === sel) : -1;
  const box = useRef<HTMLDivElement>(null);
  const flashPid = useFlash(box);
  const better = useMemo(() => betterBats(team), [team]);

  return (
    <>
      <RosterTop team={team} />
      <div ref={box} className="px-scroll min-h-0 flex-1 overflow-y-auto p-1.5" data-testid="lineup-list">
        <SectionTitle>선발 타순</SectionTitle>
        {team.lineup.map((l, i) => {
          const p = byId.get(l.pid);
          if (!p) return null;
          const off = offPos(p, l.pos);
          return (
            <Row
              key={l.pid}
              lead={
                <>
                  <span className="text-hi">{i + 1}</span> <span className={off ? 'text-bad' : ''}>{POS_KO[l.pos]}</span>
                </>
              }
              player={p}
              selected={sel === p.id}
              onClick={() => setSel(sel === p.id ? null : p.id)}
              flash={flashPid === p.id}
              issue={p.injury > 0 || better.has(p.id) || (off && homeSwap(team, byId, i) >= 0)}
            />
          );
        })}
        <SectionTitle>벤치 ({bench.length})</SectionTitle>
        {bench.map((p) => (
          <Row key={p.id} lead={POS_KO[p.pos]} player={p} selected={sel === p.id} onClick={() => setSel(sel === p.id ? null : p.id)} flash={flashPid === p.id} />
        ))}
      </div>
      <CardDock open={!!selP} onClose={() => setSel(null)} placeholder="선수를 누르면 카드가 열립니다">
        {selP && (
          <PlayerCard player={selP} team={team} roleLabel={selSlot >= 0 ? `${selSlot + 1}번 · ${POS_FULL[team.lineup[selSlot].pos]}` : `벤치 · ${POS_FULL[selP.pos]}`}>
            <EditButton pid={selP.id} onDone={() => setSel(null)} />
            <FarmMoveButton player={selP} onDone={() => setSel(null)} />
            <ReleaseButton player={selP} team={team} />
          </PlayerCard>
        )}
      </CardDock>
    </>
  );
}

// ───────── 투수 ─────────

export function PitchersTab() {
  const team = useUserTeam();
  const [sel, setSel] = useState<string | null>(null);

  const byId = useMemo(() => new Map(team.roster.map((p) => [p.id, p])), [team.roster]);
  const assigned = useMemo(
    () => new Set([...team.rotation, ...team.bullpen, ...(team.closer ? [team.closer] : [])]),
    [team.rotation, team.bullpen, team.closer],
  );
  const spare = useMemo(() => team.roster.filter((p) => p.kind === 'P' && !p.farm && !assigned.has(p.id)), [team.roster, assigned]);
  const selP = sel ? byId.get(sel) : undefined;
  const box = useRef<HTMLDivElement>(null);
  const flashPid = useFlash(box);
  const better = useMemo(() => betterArms(team), [team]);

  const roleOf = (pid: string): string => {
    const ri = team.rotation.indexOf(pid);
    if (ri >= 0) return `${ri + 1}선발`;
    if (team.closer === pid) return '마무리';
    if (team.bullpen.includes(pid)) return '불펜';
    return '대기';
  };
  const row = (pid: string, lead: ReactNode) => {
    const p = byId.get(pid);
    if (!p) return null;
    return (
      <Row
        key={pid}
        lead={lead}
        player={p}
        selected={sel === pid}
        onClick={() => setSel(sel === pid ? null : pid)}
        flash={flashPid === pid}
        issue={better.has(pid) || (p.injury > 0 && team.rotation.includes(pid))}
      />
    );
  };
  const nextIdx = team.rotation.length ? team.nextStarter % team.rotation.length : -1;

  return (
    <>
      <RosterTop team={team} />
      <PenLoadLine className="shrink-0 px-2 pt-1.5 !text-[11px] mob:!text-[13px]" />
      <div ref={box} className="px-scroll min-h-0 flex-1 overflow-y-auto p-1.5" data-testid="pitcher-list">
        <SectionTitle>선발 로테이션</SectionTitle>
        {team.rotation.map((pid, i) =>
          row(
            pid,
            <>
              <span className="text-hi">{i + 1}</span> 선발{i === nextIdx && <span className="text-good"> ◀</span>}
            </>,
          ),
        )}
        <SectionTitle>마무리</SectionTitle>
        {team.closer && row(team.closer, '마무리')}
        <SectionTitle>불펜 ({team.bullpen.length})</SectionTitle>
        {team.bullpen.map((pid, i) => row(pid, `불펜${i + 1}`))}
        {spare.length > 0 && (
          <>
            <SectionTitle>대기 ({spare.length})</SectionTitle>
            {spare.map((p) => row(p.id, '대기'))}
          </>
        )}
      </div>
      <CardDock open={!!selP} onClose={() => setSel(null)} placeholder="투수를 누르면 카드가 열립니다">
        {selP && (
          <PlayerCard player={selP} team={team} roleLabel={roleOf(selP.id)}>
            <EditButton pid={selP.id} onDone={() => setSel(null)} />
            <FarmMoveButton player={selP} onDone={() => setSel(null)} />
            <ReleaseButton player={selP} team={team} />
          </PlayerCard>
        )}
      </CardDock>
    </>
  );
}

// ───────── 이적 ─────────

/** 이적 탭: 이적 창구(전체 화면)로 들어가는 문. 목록의 선수를 누르면 담은 채로 창구가 열린다 */
export function MarketTab() {
  const team = useUserTeam();
  const freeAgents = useStore((s) => s.freeAgents);
  const cash = useStore((s) => s.finance.cash);
  const basket = useTransferUi((s) => s.basket);
  const rows = usePosReport();
  const [card, setCard] = useState<string | null>(null);

  // 스카우트 팀장의 명단은 맨 위에 따로 올린다 (맨 앞이 그가 고른 선수)
  const scoutIds = useStore((s) => s.campaign.eventsSeen.find((x) => x.startsWith('~scoutList='))?.slice(11) ?? '');
  const pinned = useMemo(() => (scoutIds ? scoutIds.split(',') : []), [scoutIds]);
  const nAct = activeRoster(team).length;
  const nFarm = farmRoster(team).length;
  const n = basketCount(basket);
  const cardP = card ? freeAgents.find((p) => p.id === card) : undefined;

  return (
    <>
      <FirstTip id="market" />
      <div className="flex shrink-0 flex-col gap-1 px-1.5 pt-1.5">
        <div className="flex gap-1">
          <button className="px-btn primary min-h-9 flex-[2] text-[13px] mob:min-h-11 mob:text-[15px]" data-testid="open-desk" onClick={() => openDesk()}>
            이적 창구{n > 0 ? ` · 담은 ${n}건 확인` : ' 열기'} ⤢
          </button>
          <button className="px-btn min-h-9 flex-1 whitespace-nowrap text-[12px] mob:min-h-11 mob:text-[13px]" data-testid="open-desk-squad" onClick={() => openDesk({ side: 'squad' })}>
            방출·2군
          </button>
        </div>
        <div className="truncate text-[10px] text-white/60 mob:text-[13px]" data-testid="desk-head">
          현금 <span className="text-hi">{fmtMoney(cash)}</span> · 1군 <span className={nAct >= ROSTER_MAX ? 'text-bad' : 'text-white'}>{nAct}/{ROSTER_MAX}</span> · 2군 <span className="text-white">{nFarm}/{FARM_MAX}</span>
        </div>
      </div>
      <PlayerBrowser
        mode="market"
        players={freeAgents}
        rows={rows}
        sel={card}
        onPick={(p) => setCard(p.id)}
        pinned={pinned}
        note={(p) => (pinned.includes(p.id) ? <span className="ml-1 text-hi" title="스카우트 팀장 추천">★</span> : null)}
        band={(p) => (basket.sign.includes(p.id) ? { color: '#6ee07a', bg: '#27452f' } : undefined)}
        rowAction={(p) => <AddChip kind="sign" pid={p.id} />}
      />
      {cardP && (
        <CardPop player={cardP} onClose={() => setCard(null)}>
          <AddChip kind="sign" pid={cardP.id} big />
        </CardPop>
      )}
    </>
  );
}

// ───────── 패널 ─────────

const TABS: { id: Exclude<LeftTab, 'farm'>; label: string }[] = [
  { id: 'lineup', label: '타선' },
  { id: 'pitchers', label: '투수' },
  { id: 'market', label: '이적' },
];

export default function LeftPanel() {
  const tab = useStore((s) => s.leftTab);
  const setTab = useStore((s) => s.setTab);
  const clearHint = useStore((s) => s.clearHint);
  const nFarm = useStore((s) => (s.teams.find((t) => t.id === s.userId)?.roster ?? []).filter((p) => p.farm).length);
  const hinted = useHintTabs(TABS, tab === 'farm' ? null : tab);
  const tabs: { id: LeftTab; label: string; badge?: ReactNode }[] = [...hinted.slice(0, 2), { id: 'farm' as const, label: `2군 ${nFarm}/${FARM_MAX}` }, ...hinted.slice(2)];
  return (
    <div className="px-panel flex h-full min-h-0 flex-col">
      <TabBar
        tabs={tabs}
        value={tab}
        onChange={(t) => {
          if (t !== 'farm') clearHint(t as Exclude<LeftTab, 'farm'>);
          setTab('left', t);
        }}
      />
      {tab === 'farm' && <FarmTab />}
      {tab === 'lineup' && <LineupTab />}
      {tab === 'pitchers' && <PitchersTab />}
      {tab === 'market' && <MarketTab />}
    </div>
  );
}
