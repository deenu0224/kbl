import { exposureLines } from '../game/scandal';
import { CHARACTERS, SCANDAL_NEWS } from '../game/story';
import Fold from './Fold';
import { useUi } from './layout/uiStore';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { BatPos, Objective, Player, Team } from '../game/types';
import { useCore, useStore } from '../store';
import { fmtAvg, fmtEra, fmtInt, fmtMoney } from '../game/format';
import { rankOf, seasonAwards, standings } from '../game/season';
import { STAGES, TRUST_MAX, objDisplay } from '../game/campaign';
import { leagueAwards, type LeaderRow } from '../game/leaders';
import Bracket from './Bracket';
import { Flag, POST_KO, StageTrail, silhouette, stageName } from './Campaign';
import EndingScene from './EndingScene';
import EventCardModal from './EventCardModal';
import { useIsMobile } from './layout/useLayout';
import PixelFace from './PixelFace';
import TransferDesk from './roster/TransferDesk';
import { openDesk } from './roster/transferUi';
import { LedgerBars, ledgerTotals } from './RightPanel';
import { MiniBars, OvrBadge, POS_KO, TeamDot, fmtPct, recText } from './ui';

const GRADE_COLOR: Record<string, string> = { S: '#ffd84a', A: '#6ee07a', B: '#7fd3ff', C: '#f0a35a', D: '#ff6b6b' };
const GG_ORDER: BatPos[] = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH'];

/** 결산 항목이 차례로 드러난다 */
function Step({ i, children, className = '' }: { i: number; children: ReactNode; className?: string }) {
  return (
    <div className={`anim-fade-slow ${className}`} style={{ animationDelay: `${i * 0.35}s` }}>
      {children}
    </div>
  );
}

const Title = ({ children }: { children: ReactNode }) => <div className="mb-1 text-[11px] text-sky">▸ {children}</div>;

function MvpCard({ title, p, team }: { title: string; p: Player | null; team: Team }) {
  return (
    <div className="flex items-center gap-2 bg-panel-2 p-2" style={{ boxShadow: `0 0 0 1px #0f1420, inset 0 0 0 2px ${team.color}` }}>
      {p ? (
        <>
          <PixelFace id={p.id} color={team.color} color2={team.color2} foreign={p.foreign} size={48} />
          <div className="min-w-0 flex-1">
            <div className="text-[10px] text-hi">{title}</div>
            <div className="flex items-center gap-1.5">
              <OvrBadge ovr={p.ovr} size={20} />
              <span className="truncate font-pixel-lg text-[14px]">{p.name}</span>
              <span className="text-[10px] text-white/50">{POS_KO[p.pos]}</span>
            </div>
            <div className="text-[11px] text-white/80">
              {p.kind === 'B'
                ? `타율 ${fmtAvg(p.bat.h, p.bat.ab)} · ${p.bat.hr}홈런 · ${p.bat.rbi}타점`
                : `ERA ${fmtEra(p.pit.er, p.pit.outs)} · ${p.pit.w}승 ${p.pit.l}패${p.pit.sv ? ` ${p.pit.sv}세` : ''} · ${p.pit.so}K`}
            </div>
          </div>
        </>
      ) : (
        <div className="text-[11px] text-white/45">{title}: 해당 없음</div>
      )}
    </div>
  );
}

/** 리그 시상 카드 (MVP·신인왕) */
function AwardCard({ title, row, byId, userId }: { title: string; row: LeaderRow | null; byId: Map<string, Team>; userId: string }) {
  const t = row ? byId.get(row.teamId) : undefined;
  const me = row?.teamId === userId;
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2 bg-panel-2 p-2" style={{ boxShadow: `0 0 0 1px #0f1420, inset 0 0 0 2px ${t?.color ?? '#47557f'}` }}>
      {row && t ? (
        <>
          <PixelFace id={row.pid} color={t.color} color2={t.color2} size={44} />
          <div className="min-w-0 flex-1">
            <div className="text-[11px] text-hi">{title}</div>
            <div className="flex items-center gap-1.5">
              <span className={`truncate font-pixel-lg text-[14px] ${me ? 'text-hi' : ''}`}>{row.name}</span>
              <span className="shrink-0 text-[11px] text-white/55">{t.name}</span>
            </div>
            <div className="text-[11px] leading-snug text-white/80">{row.text}</div>
          </div>
        </>
      ) : (
        <div className="text-[11px] text-white/45">{title}: 해당 없음</div>
      )}
    </div>
  );
}

function ObjResult({ o, flag }: { o: Objective; flag?: boolean }) {
  const d = objDisplay(useCore(), o);
  const ok = o.state === 'done';
  return (
    <div className={`flex items-center gap-2 px-2 ${flag ? 'bg-ink/60 py-2' : 'bg-ink/40 py-1'}`} style={flag ? { boxShadow: `inset 3px 0 0 ${ok ? '#6ee07a' : '#ff6b6b'}` } : undefined}>
      {flag ? <Flag size={22} color={ok ? '#6ee07a' : '#6b7694'} /> : <span className={`text-[16px] leading-none ${ok ? 'text-hi' : 'text-white/20'}`}>★</span>}
      <div className="min-w-0 flex-1">
        <div className={`${flag ? 'font-pixel-lg text-[16px]' : 'text-[12px] mob:text-[13px]'} leading-tight ${ok ? '' : 'text-white/55'}`}>{o.text}</div>
        <div className="text-[11px] text-white/55">
          {d.cur} / {d.target}
        </div>
      </div>
      <span className={`shrink-0 ${flag ? 'font-pixel-lg text-[15px]' : 'text-[11px]'} ${ok ? 'text-good' : 'text-bad'}`}>{ok ? '달성' : '미달'}</span>
    </div>
  );
}

/** 도민 지지: before → after 로 움직이는 막대 */
function TrustMove({ before, after }: { before: number; after: number }) {
  const [v, setV] = useState(before);
  useEffect(() => {
    const id = window.setTimeout(() => setV(after), 60);
    return () => window.clearTimeout(id);
  }, [after]);
  const d = Math.round(after - before);
  const c = after >= 50 ? '#6ee07a' : after >= 25 ? '#ffd84a' : '#ff6b6b';
  return (
    <div>
      <div className="flex items-baseline gap-2">
        <span className="text-[13px] text-white/50">{Math.round(before)}</span>
        <span className="text-white/35">→</span>
        <span className="font-pixel-lg text-[24px] leading-none" style={{ color: c }}>
          {Math.round(after)}
        </span>
        {d !== 0 && <span className={`text-[13px] ${d > 0 ? 'text-good' : 'text-bad'}`}>{d > 0 ? `+${d}` : d}</span>}
      </div>
      <div className="relative mt-1 h-[10px] w-full bg-[#141a29]" style={{ boxShadow: 'inset 0 0 0 1px #0f1420' }}>
        <div className="trust-move h-full" style={{ width: `${Math.max(0, Math.min(100, (v / TRUST_MAX) * 100))}%`, background: c, boxShadow: 'inset 0 -3px 0 rgba(0,0,0,.25)' }} />
        <div className="absolute inset-y-0 w-[2px] bg-white/70" style={{ left: `${Math.max(0, Math.min(100, (before / TRUST_MAX) * 100))}%` }} />
      </div>
    </div>
  );
}

/** 시즌 종료 전체 화면 결산: 깃발 → 별 → 도민 지지 → 시즌 이름 → 대진표 → 시상 → 다음 장 */
export default function SeasonEnd() {
  // 재계약 카드는 결산 화면(z-50) 위에 띄운다. 결산 중에는 카드를 접어 둘 수 없다
  const eventId = useStore((s) => s.campaign.event?.id ?? null);
  const hidden = useUi((s) => s.eventHidden);
  const mobile = useIsMobile();
  useEffect(() => {
    if (eventId && hidden === eventId) useUi.getState().setEventHidden(null);
  }, [eventId, hidden]);
  return (
    <>
      <SeasonEndBody />
      {/* 스토브리그의 이적 창구 (결산 화면에서 연다) */}
      <TransferDesk />
      {/* 결산 중의 사건 카드는 여기서만 그린다 (MobileShell 은 결산 중에는 그리지 않는다) */}
      {eventId && (
        <div className="fixed inset-0 z-[60] font-pixel text-[12px]" data-testid="season-event">
          <EventCardModal sheet={mobile} />
        </div>
      )}
    </>
  );
}

function SeasonEndBody() {
  const core = useCore();
  const beginDraft = useStore((s) => s.beginDraft);
  const stoveCards = useStore((s) => s.stoveCards);
  const newGame = () => useUi.getState().setScreen('title');
  const [armNew, setArmNew] = useState(false);
  const [endingSeen, setEndingSeen] = useState(false);

  const awards = useMemo(() => seasonAwards(core), [core]);
  const league = useMemo(() => leagueAwards(core), [core]);
  const table = useMemo(() => standings(core.teams), [core.teams]);
  const byId = useMemo(() => new Map(core.teams.map((t) => [t.id, t])), [core.teams]);
  const team = byId.get(core.userId) ?? core.teams[0];
  const rank = rankOf(core.teams, team.id);
  const lead = table[0];
  const { net } = ledgerTotals(core.finance.ledger);
  const att = core.attHistory;
  const totalAtt = att.reduce((a, b) => a + b, 0);
  const avgAtt = att.length ? Math.round(totalAtt / att.length) : 0;

  const c = core.campaign;
  const v = c.verdict;
  const objs = c.objectives ?? [];
  const main = objs.find((o) => o.main);
  const stars = objs.filter((o) => !o.main);
  const last = c.history?.[c.history.length - 1];
  const seasonName = v?.seasonName ?? last?.name;
  const grade = last?.grade ?? awards.grade;
  const stageBefore = v?.stageBefore ?? c.stage;
  const stageAfter = v?.stageAfter ?? c.stage;
  const advanced = stageAfter > stageBefore;
  const finish = core.post?.userFinish ?? 'none';
  // 이 결산에서 처음 엔딩 조건을 넘었는가
  const endingNow = !!v?.cleared && !!c.ending && STAGES.slice(stageBefore, Math.max(stageAfter, stageBefore + 1)).some((s) => s.ending);

  if (endingNow && !endingSeen) return <EndingScene onDone={() => setEndingSeen(true)} />;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/95 p-4 mob:items-stretch mob:p-0"
      style={{ paddingTop: 'max(env(safe-area-inset-top), 0px)', paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="px-panel px-scroll flex max-h-full w-full max-w-[1100px] flex-col overflow-y-auto p-4 mob:p-3">
        {/* 머리 */}
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11px] text-sky">
              {core.season}시즌 결산 · {stageBefore + 1}장 {stageName(stageBefore)}
            </div>
            <div className="font-pixel-lg text-[24px] leading-tight mob:text-[20px]" style={{ color: team.color, textShadow: '2px 2px 0 #0f1420' }}>
              {team.city} {team.name}
            </div>
            <div className="mt-0.5 text-[13px]">
              최종 <span className="font-pixel-lg text-[18px] text-hi">{rank}위</span> · {recText(team.rec)} · 승률 {fmtPct(team.rec.w, team.rec.l)}
              {finish !== 'none' && <span className="ml-2 whitespace-nowrap text-hi">{finish === 'champion' ? '한국시리즈 우승' : finish === 'KS' ? '한국시리즈 준우승' : `${POST_KO[finish]} 진출`}</span>}
            </div>
          </div>
          <div
            className="anim-pop flex h-14 w-14 shrink-0 items-center justify-center font-pixel-lg text-[36px] text-ink"
            style={{ background: GRADE_COLOR[grade] ?? '#fff', boxShadow: '0 0 0 3px #0f1420, inset 0 -5px 0 rgba(0,0,0,.25)' }}
          >
            {grade}
          </div>
        </div>

        {v?.luxTax && (
          <div className="mt-3 bg-bad/15 px-2 py-1.5 text-[12px] leading-snug mob:text-[13px]" data-testid="lux-tax">
            <span className="text-bad">경쟁균형세 −{fmtMoney(v.luxTax.tax)}</span>
            <span className="text-white/70"> · 연봉 총액 {fmtMoney(v.luxTax.payroll)} · 상한 {fmtMoney(v.luxTax.cap)} (리그 상위 3구단 평균의 120%)</span>
          </div>
        )}
        {/* 덮은 일이 드러났다: 무슨 일 · 잃은 것 */}
        {v?.exposures?.map((ex, i) => {
          const l = exposureLines(ex);
          return (
            <div key={i} className="mt-3 bg-bad/20 px-2 py-2 text-[13px] leading-snug" style={{ boxShadow: '0 0 0 1px #ff6b6b' }} data-testid="exposed">
              <div className="text-bad">{l.what}</div>
              <div className="mt-0.5 text-white/85">{l.lost.join(' · ')}</div>
              <div className="mt-1 text-white/60">
                {CHARACTERS.chair.name} {CHARACTERS.chair.title} — “{SCANDAL_NEWS.chairExposed}”
              </div>
            </div>
          );
        })}

        {/* 깃발 → 별 → 도민 지지 → 시즌 이름 */}
        <div className="mt-3 grid grid-cols-2 gap-3 por:grid-cols-1">
          <div className="flex flex-col gap-[3px]">
            <Step i={0}>{main ? <ObjResult o={main} flag /> : <div className="bg-ink/60 px-2 py-2 text-[12px] text-white/50">이번 시즌 목표 기록이 없습니다</div>}</Step>
            {stars.map((o, i) => (
              <Step key={o.id} i={1 + i * 0.5}>
                <ObjResult o={o} />
              </Step>
            ))}
            {v && (v.cashReward > 0 || v.fansReward > 0) && (
              <Step i={2.5} className="flex gap-3 px-2 pt-1 text-[12px]">
                {v.cashReward > 0 && (
                  <span>
                    조합 지원금 <span className="text-hi">+{fmtMoney(v.cashReward)}</span>
                  </span>
                )}
                {v.fansReward > 0 && (
                  <span>
                    팬 <span className="text-good">+{fmtInt(v.fansReward)}</span>
                  </span>
                )}
              </Step>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <Step i={3} className="bg-ink/60 px-2 py-2">
              <Title>도민 지지</Title>
              <TrustMove before={v?.trustBefore ?? c.trust} after={v?.trustAfter ?? c.trust} />
            </Step>
            {seasonName && (
              <Step i={4} className="bg-ink/60 px-2 py-2">
                <Title>{core.season}시즌의 이름</Title>
                <div className="font-pixel-lg text-[20px] leading-tight text-hi" style={{ textShadow: '1px 1px 0 #0f1420' }}>
                  「{seasonName}」
                </div>
              </Step>
            )}
          </div>
        </div>

        {/* 포스트시즌 대진표 결과 */}
        {core.post && (
          <Step i={5} className="mt-3">
            <Fold label="포스트시즌 대진표" testid="fold-bracket">
              <Bracket wide />
            </Fold>
          </Step>
        )}

        {/* 리그 시상 */}
        <Step i={6} className="mt-3">
          <Fold label="리그 시상 · 타이틀 · 골든글러브" testid="fold-awards">
          <div className="flex gap-2 por:flex-col">
            <AwardCard title="정규시즌 MVP" row={league.mvp} byId={byId} userId={core.userId} />
            <AwardCard title="신인왕" row={league.rookie} byId={byId} userId={core.userId} />
          </div>
          <div className="mt-2 grid grid-cols-2 gap-3 por:grid-cols-1">
            <div>
              <div className="mb-0.5 text-[11px] text-white/55">타이틀</div>
              {league.titles.map((t) => {
                const me = t.row.teamId === core.userId;
                return (
                  <div key={t.cat} className={`flex items-center gap-1.5 px-1.5 py-[3px] text-[11px] odd:bg-white/4 mob:text-[13px] ${me ? 'text-hi' : ''}`}>
                    <span className="w-[72px] shrink-0 text-white/60">{t.label}</span>
                    <TeamDot team={byId.get(t.row.teamId)} />
                    <span className="min-w-0 flex-1 truncate">{t.row.name}</span>
                    <span className="shrink-0">{t.row.text}</span>
                  </div>
                );
              })}
              {!league.titles.length && <div className="px-1 text-[11px] text-white/40">해당 없음</div>}
            </div>
            <div>
              <div className="mb-0.5 text-[11px] text-white/55">골든글러브</div>
              <div className="grid grid-cols-3 gap-[2px]">
                {GG_ORDER.map((pos) => {
                  const r = league.goldenGlove?.[pos] ?? null;
                  const me = r?.teamId === core.userId;
                  return (
                    <div key={pos} className={`flex items-center gap-1 px-1.5 py-1 text-[11px] mob:text-[13px] ${me ? 'bg-hi/20 text-hi' : 'bg-ink/40'}`}>
                      <span className="w-7 shrink-0 text-[10px] text-white/50">{POS_KO[pos]}</span>
                      {r ? (
                        <>
                          <TeamDot team={byId.get(r.teamId)} size={8} />
                          <span className="min-w-0 truncate">{r.name}</span>
                        </>
                      ) : (
                        <span className="text-white/30">-</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
          </Fold>
        </Step>

        {/* 다음 장 공개 */}
        <Step i={7} className="mt-3 bg-ink/60 px-2 py-2">
          <Title>{advanced ? '다음 장' : '다음 시즌'}</Title>
          {advanced ? (
            <div className="font-pixel-lg relative mb-1.5 text-[20px] leading-tight text-hi" style={{ textShadow: '1px 1px 0 #0f1420' }}>
              {stageAfter + 1}장 ·{' '}
              <span className="relative inline-block">
                <span className="anim-unveil">{stageName(stageAfter)}</span>
                <span className="anim-veil pointer-events-none absolute inset-0 overflow-hidden whitespace-nowrap text-white/30">{silhouette(stageAfter)}</span>
              </span>
            </div>
          ) : (
            <div className="font-pixel-lg mb-1.5 text-[16px] leading-tight text-white/85">
              {stageAfter + 1}장 · {stageName(stageAfter)} <span className="font-pixel text-[12px] text-white/50">한 번 더</span>
            </div>
          )}
          <StageTrail stage={stageAfter} />
        </Step>

        {/* 살림: 최종 순위 · 손익 · 구단 MVP 는 접어 둔다 */}
        <Fold label="최종 순위 · 손익 결산 · 구단 MVP" className="mt-3" testid="fold-ledger">
        <div className="mt-3 grid grid-cols-3 gap-3 mob:grid-cols-2 por:grid-cols-1">
          <div>
            <Title>최종 순위</Title>
            {table.map((t, i) => {
              const me = t.id === core.userId;
              const gb = (lead.rec.w - t.rec.w + (t.rec.l - lead.rec.l)) / 2;
              return (
                <div
                  key={t.id}
                  className={`flex items-center gap-1.5 px-1.5 py-1 text-[12px] ${me ? 'bg-hi/20 text-hi' : i % 2 ? 'bg-white/4' : ''}`}
                  style={me ? { boxShadow: 'inset 2px 0 0 #ffd84a' } : undefined}
                >
                  <span className={`w-4 ${i < 4 ? 'text-good' : 'text-white/50'}`}>{i + 1}</span>
                  <TeamDot team={t} />
                  <span className="min-w-0 flex-1 truncate">
                    {t.city} {t.name}
                  </span>
                  <span className="text-white/80">
                    {t.rec.w}-{t.rec.l}-{t.rec.t}
                  </span>
                  <span className="w-9 text-right">{fmtPct(t.rec.w, t.rec.l)}</span>
                  <span className="w-7 text-right text-white/50">{i === 0 || gb === 0 ? '-' : gb.toFixed(1)}</span>
                </div>
              );
            })}
          </div>

          <div>
            <Title>손익 결산</Title>
            <LedgerBars ledger={core.finance.ledger} />
            <div className="mt-1 flex justify-between text-[11px] text-white/70">
              <span>
                보유 현금 <span className="text-hi">{fmtMoney(core.finance.cash)}</span>
              </span>
              <span>
                부채 <span className={core.finance.debt > 0 ? 'text-bad' : ''}>{fmtMoney(core.finance.debt)}</span>
              </span>
            </div>
            <div className={`mt-0.5 text-[10px] ${net >= 0 ? 'text-good' : 'text-bad'}`}>{net >= 0 ? '흑자 시즌' : '적자 시즌'}</div>
          </div>

          <div className="flex flex-col gap-2">
            <div>
              <Title>관중</Title>
              <div className="flex justify-between text-[12px]">
                <span>
                  총 <span className="font-pixel-lg text-[15px] text-hi">{fmtInt(totalAtt)}</span>명
                </span>
                <span className="text-white/75">
                  평균 {fmtInt(avgAtt)}명 · 팬 {fmtInt(Math.round(core.fans))}
                </span>
              </div>
              <MiniBars values={att} height={44} color={(val, i) => (i === att.indexOf(Math.max(...att)) ? '#ffd84a' : val >= avgAtt ? '#6ee07a' : '#7fd3ff')} style={{ marginTop: 4 }} />
            </div>
            <div>
              <Title>팀 MVP</Title>
              <div className="flex flex-col gap-1.5">
                <MvpCard title="타자 MVP" p={awards.mvpBat} team={team} />
                <MvpCard title="투수 MVP" p={awards.mvpPit} team={team} />
              </div>
            </div>
          </div>
        </div>
        </Fold>

        <div className="mt-4 flex items-center justify-end gap-3 mob:sticky mob:-bottom-3 mob:-mx-3 mob:-mb-3 mob:bg-panel mob:p-3">
          <button
            className="px-btn !px-4 !py-1.5 mob:text-[13px]"
            onClick={() => {
              if (!armNew) return setArmNew(true);
              newGame();
            }}
          >
            {armNew ? '초기 화면으로 나가기' : '초기 화면'}
          </button>
          {/* 스토브리그: 재계약·트레이드 제안 카드를 먼저 처리하고, 그 뒤에 이적 창구가 열린다 */}
          <button
            className="px-btn min-h-11 !px-4 !py-2 text-[13px]"
            data-testid="stove-market"
            onClick={() => {
              if (!stoveCards()) openDesk({ side: 'market' });
            }}
          >
            이적 시장
          </button>
          <button className="px-btn primary min-h-11 !px-6 !py-2 text-[14px] mob:flex-1" onClick={beginDraft}>
            신인 드래프트로 ▶
          </button>
        </div>
      </div>
    </div>
  );
}
