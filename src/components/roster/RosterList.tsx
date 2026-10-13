import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { Player } from '../../game/types';
import { salaryReport, type PosKey } from '../../game/analysis';
import { ROSTER_MAX, farmMax, activeRoster, farmRoster, rehabRoster } from '../../game/economy';
import { FarmMoveButton, ReleaseButton } from '../LeftPanel';
import { fmtMoney } from '../../game/format';
import { useCore, useStore, useUserTeam } from '../../store';
import PlayerCard from '../PlayerCard';
import Dialog from '../layout/Dialog';
import { Bar, OvrBadge, TabBar } from '../ui';
import PlayerBrowser from './PlayerBrowser';
import { usePosReport, useRosterUi, type ListView } from './rosterUi';
import { openDesk } from './transferUi';

const safe = {
  paddingTop: 'max(env(safe-area-inset-top), 0px)',
  paddingBottom: 'env(safe-area-inset-bottom)',
  paddingLeft: 'env(safe-area-inset-left)',
  paddingRight: 'env(safe-area-inset-right)',
};

/** 전체 화면 틀: 모바일은 100dvh, 데스크톱은 화면 대부분을 덮는 모달 */
export function FullScreen({ title, sub, onClose, children, testid, hold = false }: { title: string; sub?: ReactNode; onClose: () => void; children: ReactNode; testid?: string; hold?: boolean }) {
  useEffect(() => {
    // 선수 카드가 떠 있으면(hold) Esc 는 카드만 닫는다
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !hold && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, hold]);
  return createPortal(
    <div className="fixed inset-0 z-40 flex h-[calc(var(--dvh)*100)] items-stretch justify-center bg-ink/90 p-5 font-pixel text-[12px] select-none mob:p-0" style={safe} data-testid={testid}>
      <div className="absolute inset-0" onClick={onClose} />
      <div className="px-panel relative flex min-h-0 w-full max-w-[1180px] flex-col">
        <div className="flex shrink-0 items-center gap-2 px-2 pt-1.5">
          <div className="min-w-0 flex-1">
            <div className="truncate font-pixel-lg text-[16px] leading-tight text-hi" style={{ textShadow: '1px 1px 0 #0f1420' }}>
              {title}
            </div>
            {sub && <div className="truncate text-[11px] text-white/60">{sub}</div>}
          </div>
          <button className="px-btn shrink-0" onClick={onClose} data-testid="fs-close">
            닫기 ✕
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

/** 이적 창구의 영입 시장으로: 그 포지션으로 걸러서 연다 */
export function goMarket(key: PosKey | 'weak' | null): void {
  useRosterUi.setState({ list: null });
  openDesk({ side: 'market', pos: key });
}

export function CardPop({ player, onClose, children, extra }: { player: Player; onClose: () => void; children?: ReactNode; extra?: ReactNode }) {
  const team = useUserTeam();
  const mine = team.roster.some((p) => p.id === player.id);
  return (
    <Dialog onClose={onClose} label="선수 카드" width={420}>
      <PlayerCard player={player} team={mine ? team : undefined} extra={extra}>
        {children}
      </PlayerCard>
    </Dialog>
  );
}

// ───────── 연봉 ─────────

function SalaryView({ onCard }: { onCard: (p: Player) => void }) {
  const core = useCore();
  const r = useMemo(() => salaryReport(core), [core]);
  const maxShare = Math.max(0.01, ...r.groups.map((g) => g.share));
  const list = (title: string, xs: { p: Player; gap: number }[], good: boolean) => (
    <div className="min-w-0 flex-1">
      <div className={`mb-0.5 text-[11px] ${good ? 'text-good' : 'text-bad'}`}>▸ {title}</div>
      {xs.map((x) => (
        <button key={x.p.id} className="mb-[2px] flex w-full cursor-pointer items-center gap-1.5 bg-ink/40 px-1 py-1 text-left hover:bg-white/8 mob:min-h-10" onClick={() => onCard(x.p)}>
          <OvrBadge ovr={x.p.ovr} size={18} />
          <span className="min-w-0 flex-1 truncate">{x.p.name}</span>
          <span className="shrink-0 text-right text-[10px] leading-tight mob:text-[13px]">
            <span className="block text-white/60">연 {fmtMoney(x.p.salary)}</span>
            <span className={`block ${good ? 'text-good' : 'text-bad'}`}>{good ? '+' : '−'}{fmtMoney(Math.abs(x.gap))}</span>
          </span>
        </button>
      ))}
      {!xs.length && <div className="px-1 text-[10px] text-white/40">해당 선수 없음</div>}
    </div>
  );
  return (
    <div className="px-scroll min-h-0 flex-1 overflow-y-auto p-2" data-testid="salary-view">
      <div className="grid grid-cols-3 gap-1 text-center">
        {[
          ['총 연봉', fmtMoney(r.total)],
          ['리그 순위', `${r.rank}위 / ${r.of}구단`],
          ['리그 평균', fmtMoney(r.leagueAvg)],
        ].map(([k, v]) => (
          <div key={k} className="bg-ink/60 px-1 py-1">
            <div className="text-[10px] text-white/55 mob:text-[13px]">{k}</div>
            <div className="font-pixel-lg text-[15px] text-hi">{v}</div>
          </div>
        ))}
      </div>
      <div className="mt-2 mb-1 text-[11px] text-sky">▸ 포지션 그룹별 비중</div>
      {r.groups.map((g) => (
        <div key={g.label} className="mb-[3px] flex items-center gap-1.5 text-[11px]">
          <span className="w-8 shrink-0 text-white/70">{g.label}</span>
          <Bar ratio={g.share / maxShare} color="#7fd3ff" h={9} />
          <span className="w-[112px] shrink-0 whitespace-nowrap text-right text-white/80">
            {Math.round(g.share * 100)}% · {fmtMoney(g.sum)} <span className="text-white/45">{g.n}명</span>
          </span>
        </div>
      ))}
      <div className="mt-2 flex flex-row gap-2 por:flex-col">
        {list('고평가 (기대 연봉보다 비싼) 상위 3', r.over, false)}
        {list('저평가 (기대 연봉보다 싼) 상위 3', r.under, true)}
      </div>
      <div className="text-[10px] text-white/45 mob:text-[13px]">기대 연봉 = 이번 시즌 시장가 (오버롤·나이로 정해지는 연봉 곡선)</div>
      <div className="mt-2 mb-1 text-[11px] text-sky">▸ 연령 분포</div>
      <div className="grid grid-cols-3 gap-1 text-center">
        {r.ages.map((a) => (
          <div key={a.label} className="bg-ink/60 px-1 py-1 leading-tight">
            <div className="text-[10px] text-white/55 mob:text-[13px]">{a.label}</div>
            <div className="text-[13px] text-white">{a.n}명</div>
            <div className="text-[11px] text-hi">{fmtMoney(a.sum)}</div>
            <div className="text-[10px] text-white/45">{r.total ? Math.round((a.sum / r.total) * 100) : 0}%</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ───────── 명단 ─────────

const VIEWS: { id: ListView; label: string }[] = [
  { id: 'list', label: '명단' },
  { id: 'salary', label: '연봉' },
];
type Filt = 'all' | 'first' | 'farm' | 'B' | 'P';

/** 명단 전체 화면: 선수단 화면의 [명단 ▤]으로 연다. 단순 목록(또는 표)과 연봉 뷰 */
export default function RosterList() {
  const view = useRosterUi((s) => s.list);
  const close = useRosterUi((s) => s.close);
  if (!view) return null;
  return <ListScreen view={view} onClose={close} />;
}

function ListScreen({ view, onClose }: { view: ListView; onClose: () => void }) {
  const core = useCore();
  const team = useUserTeam();
  const rows = usePosReport();
  const [card, setCard] = useState<string | null>(null);
  const cardP = card ? team.roster.find((p) => p.id === card) : undefined;
  const pick = (p: Player) => setCard(p.id);
  const [filt, setFilt] = useState<Filt>('all');
  const nFarm = farmRoster(team).length;
  const shown = filt === 'all' ? team.roster : filt === 'B' || filt === 'P' ? team.roster.filter((p) => p.kind === filt) : team.roster.filter((p) => !!p.farm === (filt === 'farm'));
  const chips = (
    <>
      {([['all', '전체'], ['first', '1군'], ['farm', '2군'], ['B', '타자'], ['P', '투수']] as const).map(([id, label]) => (
        <button key={id} data-sfx="tab" data-testid={`squad-${id}`} onClick={() => setFilt(id)} className={`shrink-0 cursor-pointer whitespace-nowrap px-1.5 py-0.5 text-[10px] mob:min-h-9 mob:px-2.5 mob:text-[13px] ${filt === id ? 'bg-hi text-ink' : 'bg-ink text-white/60'}`}>
          {label}
        </button>
      ))}
    </>
  );
  return (
    <FullScreen title="명단" sub={`${team.name} · 1군 ${activeRoster(team).length}/${ROSTER_MAX} · 2군 ${nFarm}/${farmMax(core)}${rehabRoster(team).length ? ` · 재활 ${rehabRoster(team).length}` : ''}`} onClose={onClose} testid="roster-list" hold={!!cardP}>
      <div className="mt-1 shrink-0">
        <TabBar tabs={VIEWS} value={view} onChange={(v) => useRosterUi.setState({ list: v })} />
      </div>
      {view === 'list' && <PlayerBrowser mode="roster" players={shown} rows={rows} sel={card} onPick={pick} chips={chips} />}
      {view === 'salary' && <SalaryView onCard={pick} />}
      {cardP && (
        <CardPop player={cardP} onClose={() => setCard(null)}>
          <FarmMoveButton player={cardP} onDone={() => setCard(null)} />
          <ReleaseButton player={cardP} />
        </CardPop>
      )}
    </FullScreen>
  );
}
