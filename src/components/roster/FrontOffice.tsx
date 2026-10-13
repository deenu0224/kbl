import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { Player } from '../../game/types';
import { depthChart, fitsKey, salaryReport, type DepthLine, type PosKey, type PosRow } from '../../game/analysis';
import { FARM_MAX, ROSTER_MAX, farmRoster } from '../../game/economy';
import { FarmMoveButton, ReleaseButton } from '../LeftPanel';
import { fmtMoney } from '../../game/format';
import { useCore, useStore, useUserTeam } from '../../store';
import PlayerCard from '../PlayerCard';
import Dialog from '../layout/Dialog';
import Help from '../Help';
import { Bar, OvrBadge, POS_KO, TabBar } from '../ui';
import Diamond, { RankText, diagSummary, rankTone } from './Diamond';
import PlayerBrowser from './PlayerBrowser';
import { usePosReport, useRosterUi, type OfficeView } from './rosterUi';
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
    <div className="fixed inset-0 z-40 flex h-[100dvh] items-stretch justify-center bg-ink/90 p-5 font-pixel text-[12px] select-none mob:p-0" style={safe} data-testid={testid}>
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
  useRosterUi.setState({ office: null });
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

// ───────── 진단 ─────────

function DepthRows({ line, onPick }: { line: DepthLine; onPick: (p: Player) => void }) {
  let bk = 0;
  return (
    <>
      {line.slots.map((s) => (
        <button key={s.p.id} className="flex w-full cursor-pointer items-center gap-1.5 bg-ink/40 px-1 py-1 text-left hover:bg-white/8 mob:min-h-10" onClick={() => onPick(s.p)}>
          <span className={`w-9 shrink-0 text-[10px] mob:text-[11px] ${s.starter ? 'text-hi' : 'text-white/55'}`}>{s.starter ? '주전' : s.farm ? '2군' : `백업${++bk}`}</span>
          <OvrBadge ovr={s.p.ovr} size={20} />
          <span className={`min-w-0 flex-1 truncate ${s.p.injury > 0 ? 'text-bad' : ''}`}>
            {s.p.name}
            <span className="ml-1 text-[10px] text-white/45 mob:text-[11px]">본 {POS_KO[s.p.pos]}</span>
          </span>
          <span className="shrink-0 text-right text-[10px] text-white/70 mob:text-[11px]">
            {s.p.age}세 · {fmtMoney(s.p.salary)}
          </span>
        </button>
      ))}
    </>
  );
}

function DiagView({ rows, onCard }: { rows: PosRow[]; onCard: (p: Player) => void }) {
  const core = useCore();
  const freeAgents = useStore((s) => s.freeAgents);
  const { weak } = diagSummary(rows);
  const [sel, setSel] = useState<PosKey | null>(weak[0]?.key ?? null);
  const depth = useMemo(() => depthChart(core, rows), [core, rows]);
  const row = rows.find((r) => r.key === sel);
  const line = depth.find((d) => d.key === sel);
  const fas = sel ? freeAgents.filter((p) => fitsKey(p, sel)).sort((a, b) => b.ovr - a.ovr) : [];
  return (
    <div className="px-scroll flex min-h-0 flex-1 flex-row gap-2 overflow-y-auto p-2 por:flex-col">
      <div className="flex w-[min(54%,calc((100dvh-190px)*1.02))] shrink-0 flex-col gap-1.5 por:w-full">
        <div className="flex items-center gap-1.5 bg-ink/60 px-1.5 py-1 text-[11px] leading-snug mob:text-[12px]" data-testid="diag-summary">
          <span className="min-w-0 flex-1 text-white/60">빨간 테두리 = 가장 약한 두 자리. 칸을 누르면 뎁스가 보입니다</span>
          <Help topic="posRank" />
        </div>
        <Diamond rows={rows} sel={sel} onPick={setSel} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1" data-testid="diag-detail">
        {row && line ? (
          <>
            <div className="flex flex-wrap items-baseline gap-x-2 bg-edge/60 px-1.5 py-1">
              <span className="font-pixel-lg text-[15px] text-white">{row.label}</span>
              <RankText row={row} className="text-[13px]" />
              <span className="text-[11px] text-white/60">
                자리 점수 {row.score.toFixed(0)} · 리그 평균 {row.avg.toFixed(0)}
              </span>
            </div>
            <DepthRows line={line} onPick={onCard} />
            {row.thin && (
              <div className="px-1 text-[11px] text-bad">
                뎁스가 얇다: 백업 {row.backup ? row.backupScore.toFixed(0) : '없음'} · 리그 백업 평균 {row.backupAvg.toFixed(0)}
              </div>
            )}
            <button className="px-btn primary mt-1 mob:min-h-11" disabled={!fas.length} onClick={() => goMarket(sel)} data-testid="go-fa">
              {fas.length ? `이 자리 FA ${fas.length}명 보기 ▶` : '이 자리 FA 없음'}
            </button>
          </>
        ) : (
          <div className="bg-panel-2/60 p-2 text-center text-[11px] text-white/45">칸을 누르면 그 자리의 뎁스와 영입 후보가 보입니다</div>
        )}
      </div>
    </div>
  );
}

// ───────── 뎁스 ─────────

function DepthView({ rows, onCard }: { rows: PosRow[]; onCard: (p: Player) => void }) {
  const core = useCore();
  const depth = useMemo(() => depthChart(core, rows), [core, rows]);
  const thin = depth.filter((d) => d.thin);
  return (
    <div className="px-scroll min-h-0 flex-1 overflow-y-auto p-2" data-testid="depth-view">
      <div className="mb-1.5 bg-ink/60 px-1.5 py-1 text-[11px] mob:text-[12px]">
        <span className="text-white/60">빈 뎁스 {thin.length}곳: </span>
        <span className="text-bad">{thin.length ? thin.map((d) => d.label).join(' · ') : '없음'}</span>
        <span className="text-white/45"> — 백업이 리그 백업 평균보다 6 이상 낮은 자리</span>
      </div>
      <div className="grid grid-cols-2 gap-1 por:grid-cols-1">
        {depth.map((d) => {
          const row = rows.find((r) => r.key === d.key)!;
          const n = d.key === 'SP' || d.key === 'RP' ? d.slots.length : 3;
          return (
            <div key={d.key} className="flex items-stretch gap-1 bg-ink/40 p-1" data-thin={d.thin || undefined} style={d.thin ? { boxShadow: 'inset 3px 0 0 #ff6b6b' } : undefined}>
              <div className="flex w-[52px] shrink-0 flex-col justify-center pl-1 leading-tight">
                <span className={d.thin ? 'text-bad' : 'text-sky'}>{d.label}</span>
                <RankText row={row} className="text-[10px] mob:text-[11px]" />
              </div>
              <div className="grid min-w-0 flex-1 gap-[3px]" style={{ gridTemplateColumns: `repeat(${Math.min(3, n)}, minmax(0, 1fr))` }}>
                {Array.from({ length: Math.max(3, d.slots.length) }, (_, i) => d.slots[i]).map((s, i) =>
                  s ? (
                    <button key={s.p.id} className="flex min-w-0 cursor-pointer flex-col bg-panel-2/70 px-1 py-0.5 text-left leading-tight hover:bg-panel-2 mob:min-h-10" onClick={() => onCard(s.p)}>
                      <span className={`truncate text-[11px] mob:text-[12px] ${s.p.injury > 0 ? 'text-bad' : s.starter ? 'text-white' : 'text-white/75'}`}>{s.p.name}</span>
                      <span className="text-[10px] text-white/55 mob:text-[11px]">
                        {s.starter ? '주전' : '백업'} <span className={!s.starter && d.thin && i === d.slots.findIndex((x) => !x.starter) ? 'text-bad' : 'text-white'}>{s.score.toFixed(0)}</span>
                      </span>
                    </button>
                  ) : i < 3 ? (
                    <div key={i} className="flex items-center justify-center bg-bad/15 text-[10px] text-bad mob:text-[11px]">비어 있음</div>
                  ) : null,
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
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
          <span className="shrink-0 text-right text-[10px] leading-tight mob:text-[11px]">
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
            <div className="text-[10px] text-white/55 mob:text-[11px]">{k}</div>
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
      <div className="text-[10px] text-white/45 mob:text-[11px]">기대 연봉 = 이번 시즌 시장가 (OVR·나이로 정해지는 연봉 곡선)</div>
      <div className="mt-2 mb-1 text-[11px] text-sky">▸ 연령 분포</div>
      <div className="grid grid-cols-3 gap-1 text-center">
        {r.ages.map((a) => (
          <div key={a.label} className="bg-ink/60 px-1 py-1 leading-tight">
            <div className="text-[10px] text-white/55 mob:text-[11px]">{a.label}</div>
            <div className="text-[13px] text-white">{a.n}명</div>
            <div className="text-[11px] text-hi">{fmtMoney(a.sum)}</div>
            <div className="text-[10px] text-white/45">{r.total ? Math.round((a.sum / r.total) * 100) : 0}%</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ───────── 프런트 오피스 ─────────

const VIEWS: { id: OfficeView; label: string }[] = [
  { id: 'diag', label: '진단' },
  { id: 'table', label: '명단' },
  { id: 'depth', label: '뎁스' },
  { id: 'salary', label: '연봉' },
];

/** 선수단 전체 화면 도구. 선수단 탭의 [크게 보기]·미니 다이아몬드로 연다 */
export default function FrontOffice() {
  const view = useRosterUi((s) => s.office);
  const close = useRosterUi((s) => s.close);
  if (!view) return null;
  return <Office view={view} onClose={close} />;
}

function Office({ view, onClose }: { view: OfficeView; onClose: () => void }) {
  const team = useUserTeam();
  const rows = usePosReport();
  const [card, setCard] = useState<string | null>(null);
  const cardP = card ? team.roster.find((p) => p.id === card) : undefined;
  const pick = (p: Player) => setCard(p.id);
  const [squad, setSquad] = useState<'all' | 'first' | 'farm'>('all');
  const nFarm = farmRoster(team).length;
  const shown = squad === 'all' ? team.roster : team.roster.filter((p) => !!p.farm === (squad === 'farm'));
  return (
    <FullScreen title="프런트 오피스" sub={`${team.name} · 1군 ${team.roster.length - nFarm}/${ROSTER_MAX} · 2군 ${nFarm}/${FARM_MAX}`} onClose={onClose} testid="front-office" hold={!!cardP}>
      <div className="mt-1 shrink-0">
        <TabBar tabs={VIEWS} value={view} onChange={(v) => useRosterUi.setState({ office: v })} />
      </div>
      {view === 'diag' && <DiagView rows={rows} onCard={pick} />}
      {view === 'table' && (
        <div className="mt-1 flex shrink-0 items-center gap-1 text-[11px]" data-testid="squad-filter">
          {([['all', `전체 ${team.roster.length}`], ['first', `1군 ${team.roster.length - nFarm}`], ['farm', `2군 ${nFarm}`]] as const).map(([id, label]) => (
            <button key={id} data-testid={`squad-${id}`} onClick={() => setSquad(id)} className={`cursor-pointer whitespace-nowrap px-2 py-0.5 mob:min-h-9 ${squad === id ? 'bg-hi text-ink' : 'bg-ink text-white/70'}`}>
              {label}
            </button>
          ))}
        </div>
      )}
      {view === 'table' && <PlayerBrowser mode="roster" players={shown} rows={rows} sel={card} onPick={pick} />}
      {view === 'depth' && <DepthView rows={rows} onCard={pick} />}
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
