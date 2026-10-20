import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Player, Team } from '../game/types';
import { useCore, useStore, useUserTeam } from '../store';
import { fmtMoney } from '../game/format';
import { releaseCost } from '../game/economy';
import { offPos } from '../game/fixes';
import { teamParts, type TeamParts } from '../game/ratings';
import Help from './Help';
import { useHintTabs } from './RightPanel';
import { useUi } from './layout/uiStore';
import { OvrBadge, POS_KO, SectionTitle, TabBar } from './ui';
import { openDesk } from './roster/transferUi';
import { callUpPreview, sendDownPreview } from '../game/analysis';

// ───────── 공용 행 ─────────

/** 읽기 전용 한 줄: 타순·포지션 · 이름 · OVR. 누르면 선수단 화면이 열린다 */
function Row({ lead, player: p, onClick }: { lead: ReactNode; player: Player; onClick: () => void }) {
  return (
    <button onClick={onClick} data-pid={p.id} className="flex w-full cursor-pointer items-center gap-1.5 px-1 py-[3px] text-left text-[12px] hover:bg-white/8">
      <span className="w-12 shrink-0 whitespace-nowrap text-[10px] text-white/55">{lead}</span>
      <span className={`min-w-0 flex-1 truncate ${p.injury > 0 ? 'text-bad' : ''}`}>{p.name}</span>
      <OvrBadge ovr={p.ovr} size={18} />
    </button>
  );
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
        {player.farm ? (player.il ? '▲ 복귀' : '▲ 콜업') : player.injury > 0 ? '▼ 부상자 명단으로' : '▼ 2군으로'}
      </button>
      <span className={`basis-full truncate text-[10px] leading-snug mob:text-[13px] ${pv.ok ? 'text-white/65' : 'text-bad'}`} data-testid="farm-preview">
        {shortPv(pv.text)}
      </span>
    </>
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
      <span className="text-[11px] text-white/50 mob:text-[13px]" data-testid="release-cost" title="방출 시 잔여 연봉 지급">{cost > 0 ? `−${fmtMoney(cost)}` : '비용 없음'}</span>
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

/** 지금 전력과, 방금 변한 칸의 이전 값 (2초 동안) */
export function usePartsDelta(team: Team): { parts: TeamParts; delta: Partial<Record<keyof TeamParts, number>> } {
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
  return { parts, delta };
}

/** 타선 54 · 수비 49 · 선발 58 · 불펜 51. 편성을 바꾸는 순간 변한 칸이 "49 → 57"로 잠깐 보인다. */
function TeamBar({ team }: { team: Team }) {
  const { parts, delta } = usePartsDelta(team);
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

// ───────── 선수단 (데스크톱 왼쪽 패널) ─────────

/** 좁은 패널에는 읽는 것만: 전력 막대 · 타순 1~9 · 벤치. 고치는 곳은 [선수단 열기]로 여는 큰 화면 하나다 */
function SquadSummary() {
  const team = useUserTeam();
  const openSquad = useUi((s) => s.openSquad);
  const byId = useMemo(() => new Map(team.roster.map((p) => [p.id, p])), [team.roster]);
  const inLineup = useMemo(() => new Set(team.lineup.map((l) => l.pid)), [team.lineup]);
  const bench = useMemo(() => team.roster.filter((p) => p.kind === 'B' && !p.farm && !inLineup.has(p.id)).sort((a, b) => b.ovr - a.ovr), [team.roster, inLineup]);
  return (
    <>
      <div className="flex shrink-0 items-end gap-1 pr-1.5">
        <div className="min-w-0 flex-1">
          <TeamBar team={team} />
        </div>
        <Help topic="strength" />
      </div>
      <div className="shrink-0 px-1.5 pt-1.5">
        <button className="px-btn primary min-h-9 w-full text-[13px]" data-testid="open-squad" onClick={() => openSquad()}>
          선수단 열기 ⤢
        </button>
      </div>
      <div className="px-scroll min-h-0 flex-1 overflow-y-auto p-1.5" data-testid="lineup-list">
        <SectionTitle>선발 타순</SectionTitle>
        {team.lineup.map((l, i) => {
          const p = byId.get(l.pid);
          if (!p) return null;
          return (
            <Row
              key={l.pid}
              lead={
                <>
                  <span className="text-hi">{i + 1}</span> <span className={offPos(p, l.pos) ? 'text-hi' : ''}>{POS_KO[l.pos]}</span>
                </>
              }
              player={p}
              onClick={() => openSquad('field')}
            />
          );
        })}
        <SectionTitle>벤치 ({bench.length})</SectionTitle>
        {bench.map((p) => (
          <Row key={p.id} lead={POS_KO[p.pos]} player={p} onClick={() => openSquad('field')} />
        ))}
      </div>
    </>
  );
}

// ───────── 이적 ─────────

const TABS: { id: 'lineup' | 'market'; label: string }[] = [
  { id: 'lineup', label: '선수단' },
  { id: 'market', label: '이적 창구 ⤢' }, // 탭이 아니라 창구를 바로 연다
];

export default function LeftPanel() {
  const tab = 'lineup';
  const setTab = useStore((s) => s.setTab);
  const clearHint = useStore((s) => s.clearHint);
  const tabs = useHintTabs(TABS, tab);
  return (
    <div className="px-panel flex h-full min-h-0 flex-col">
      <TabBar
        tabs={tabs}
        value={tab}
        // [이적]은 탭이 아니라 이적 창구 그 자체 (탭 목록과 창구가 같은 목록 두 겹이었다)
        onChange={(t) => {
          clearHint(t);
          if (t === 'market') openDesk();
          else setTab('left', t);
        }}
      />
      <SquadSummary />
    </div>
  );
}
