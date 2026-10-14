import { useMemo, useState } from 'react';
import Sheet from './layout/Sheet';
import { PROJECT_IDS, projectPreview, projectsOpen, type ProjectId } from '../game/projects';
import { TodoLines, useTodos } from './Todo';
import Fold from './Fold';
import Help from './Help';
import { FirstTip } from './Briefing';
import type { Core, FacilityKind, HintTab, Ledger } from '../game/types';
import { SC, ethicsBlocked, ethicsCost, ethicsLv, ethicsMult, scandalOpen } from '../game/scandal';
import { useCore, useStore, useUserTeam, userMatch, type RightTab } from '../store';
import { fmtInt, fmtMoney } from '../game/format';
import {
  FOOD_LV,
  LOAN_DANGER,
  OVER_LIMIT_ERR,
  LOAN_STEP,
  LOAN_TIER,
  loanInterest,
  loanLimit,
  overLimit,
  SEAT_LV,
  TRAIN_LV,
  payroll,
  capacityOf,
  previewDemand,
  refPrice,
  upgradeCost,
} from '../game/economy';
import { borrow as borrowLoan, standings, upgradeFacility } from '../game/season';
import { deadlinesSoon } from '../game/economy';
import { RUNWAY_DANGER, borrowMoodText, debtMoodText, luxLine, runway, runwayPath, runwayPieceOf } from '../game/runway';
import { teamStrength } from '../game/ratings';
import Bracket, { OppClimb } from './Bracket';
import Standings from './Standings';
import { postTeams, seasonGames } from '../game/league';
import Leaders from './Leaders';
import { useUi, type LeagueSub } from './layout/uiStore';
import { Badge, Bar, Chips, FAC_KO, MiniBars, MoneyBar, SectionTitle, TabBar, TeamDot, TONE_CLASS, dowOf, fmtPct, isNightDay } from './ui';

const LEAGUE_SUBS: readonly (readonly [LeagueSub, string])[] = [
  ['table', '순위'],
  ['leaders', '기록'],
  ['bracket', '대진표'],
];

// ───────── 리그 ─────────

export function LeagueTab() {
  const teams = useStore((s) => s.teams);
  const userId = useStore((s) => s.userId);
  const schedule = useStore((s) => s.schedule);
  const day = useStore((s) => s.day);
  const last = useStore((s) => s.lastReport);
  const phase = useStore((s) => s.phase);
  const post = useStore((s) => s.post);
  const beats = useStore((s) => s.campaign.beats);
  const sub = useUi((s) => s.leagueSub);
  const setSub = useUi((s) => s.setLeagueSub);

  const table = useMemo(() => standings(teams), [teams]);
  const byId = useMemo(() => new Map(teams.map((t) => [t.id, t])), [teams]);
  const upcoming = useMemo(() => {
    const out: { day: number; oppId: string; isHome: boolean }[] = [];
    if (phase !== 'season') return out;
    for (let d = day; d < schedule.length && out.length < 3; d++) {
      const m = userMatch({ schedule, userId }, d);
      if (m) out.push({ day: d, oppId: m.oppId, isHome: m.isHome });
    }
    return out;
  }, [schedule, day, userId, phase]);
  // 일정표 예보: 대본 구간 중 세계 안의 이름(label)이 붙은 것만. 구간의 역할(part)은 보이지 않는다.
  const forecast = useMemo(
    () =>
      phase !== 'season'
        ? []
        : (beats ?? [])
            .filter((b) => !!b.label && b.to >= day && b.from < schedule.length)
            .concat(deadlinesSoon({ phase, day, schedule }).map((d) => ({ id: `dl-${d.id}`, part: 'mid' as const, from: d.day, to: d.day, label: d.label, icon: d.icon })))
            .sort((a, b) => a.from - b.from)
            .slice(0, 3),
    [beats, day, phase, schedule],
  );

  return (
    <div className="px-scroll min-h-0 flex-1 overflow-y-auto p-1.5">
      <Chips items={LEAGUE_SUBS} value={sub} onChange={setSub} />
      {sub === 'leaders' && <Leaders />}
      {sub === 'bracket' && (
        <div className="mt-2">
          <OppClimb className="mb-1.5 bg-ink/40 px-1.5 py-1" />
          <Bracket path reopen />
        </div>
      )}
      {sub === 'table' && (
        <>
      {phase === 'post' && post && (
        <div className="mt-2">
          <OppClimb className="mb-1.5 bg-ink/40 px-1.5 py-1" />
          <Bracket />
        </div>
      )}
      <SectionTitle right={<Help topic="postseason" />}>순위표</SectionTitle>
      <Standings teams={teams} userId={userId} />
      <Fold label="자세히: 승률 · 최근 10경기 · 타구장 결과" className="mt-1" testid="fold-league">
        {table.map((t) => (
          <div key={t.id} className="flex items-center px-1 py-[3px] text-[11px] mob:text-[13px]">
            <span className="flex min-w-0 flex-1 items-center gap-1">
              <TeamDot team={t} />
              <span className="truncate">{t.name}</span>
            </span>
            <span className="w-16 text-center text-white/70">
              {t.rec.w}-{t.rec.l}-{t.rec.t}
            </span>
            <span className="w-10 text-right">{fmtPct(t.rec.w, t.rec.l)}</span>
            <span className="flex w-12 items-end justify-end gap-px">
              {t.rec.last10.slice(-10).map((v, k) => (
                <span key={k} style={{ width: 3, height: v === 1 ? 9 : v === 0 ? 4 : 6, background: v === 1 ? '#6ee07a' : v === 0 ? '#ff6b6b' : '#9aa5c4' }} />
              ))}
            </span>
          </div>
        ))}

      <SectionTitle>타구장 결과</SectionTitle>
      {last && last.others.length ? (
        <div className="grid grid-cols-1 gap-[3px]">
          {last.others.map((g, i) => {
            const a = byId.get(g.awayId);
            const h = byId.get(g.homeId);
            return (
              <div key={i} className="flex items-center gap-1 bg-ink/50 px-1.5 py-[3px] text-[11px]">
                <TeamDot team={a} />
                <span className={`flex-1 truncate ${g.away > g.home ? '' : 'text-white/50'}`}>{a?.name ?? g.awayId}</span>
                <span className="font-pixel-lg text-[12px]">
                  <span className={g.away > g.home ? 'text-hi' : ''}>{g.away}</span>
                  <span className="mx-1 text-white/40">:</span>
                  <span className={g.home > g.away ? 'text-hi' : ''}>{g.home}</span>
                </span>
                <span className={`flex-1 truncate text-right ${g.home > g.away ? '' : 'text-white/50'}`}>{h?.name ?? g.homeId}</span>
                <TeamDot team={h} />
              </div>
            );
          })}
        </div>
      ) : (
        <div className="px-1 text-[10px] text-white/40">경기를 진행하면 표시됩니다</div>
      )}
      </Fold>

      <SectionTitle>다음 일정</SectionTitle>
      {forecast.map((b) => {
        const n = b.from - day;
        return (
          <div key={b.id} className="mb-[2px] flex items-center gap-1.5 bg-ink/50 px-1.5 py-[3px] text-[11px] mob:min-h-10 mob:text-[13px]" style={{ boxShadow: 'inset 2px 0 0 #f0a35a' }}>
            <span className="w-[58px] shrink-0 whitespace-nowrap text-[#f0a35a]">{n > 0 ? `D-${n}` : '진행 중'}</span>
            <span className="min-w-0 flex-1 truncate">
              {b.icon ? `${b.icon} ` : ''}
              {b.label}
            </span>
          </div>
        );
      })}
      {upcoming.slice(0, Math.max(1, 3 - forecast.length)).map((u, i) => {
        const opp = byId.get(u.oppId);
        return (
          <div key={u.day} className={`flex items-center gap-1.5 px-1.5 py-[3px] text-[11px] ${i === 0 ? 'bg-sky/15' : ''}`}>
            <span className="w-[58px] shrink-0 whitespace-nowrap text-white/50">
              {u.day + 1}차전
            </span>
            <span className={`w-7 text-center text-[10px] ${u.isHome ? 'bg-good/25 text-good' : 'bg-white/10 text-white/60'}`}>{u.isHome ? '홈' : '원정'}</span>
            <TeamDot team={opp} />
            <span className="flex-1 truncate">
              {opp?.city} {opp?.name}
            </span>
          </div>
        );
      })}
      {!upcoming.length && <div className="px-1 text-[10px] text-white/40">{phase === 'post' ? '포스트시즌 진행 중' : '남은 경기가 없습니다'}</div>}
        </>
      )}
    </div>
  );
}

// ───────── 구장 ─────────

const KINDS: FacilityKind[] = ['seats', 'food', 'training'];

function facInfo(kind: FacilityKind, lv: number): { name: string; desc: string; upkeep: number } | null {
  const row = kind === 'seats' ? SEAT_LV[lv] : kind === 'food' ? FOOD_LV[lv] : TRAIN_LV[lv];
  return row ? { name: row.name, desc: row.desc, upkeep: row.upkeep } : null;
}

/** 업그레이드하면 달라지는 것 한 줄 (숫자 위주) */
function upgradeEffect(core: Core, kind: FacilityKind): string {
  const lv = core.facilities[kind];
  if (kind === 'seats') {
    const add = `+${fmtInt(SEAT_LV[lv + 1].cap - SEAT_LV[lv].cap)}석`;
    if (core.crowd && core.crowd.turnedAway > 0) return `${add} · 지난 홈경기 발길 돌린 팬 ${fmtInt(core.crowd.turnedAway)}명`;
    const over = Math.round(previewDemand(core) - SEAT_LV[lv].cap);
    return over > 0 ? `${add} · 예상 수요 초과 ${fmtInt(over)}명` : `${add} · 지금은 빈 좌석 ${fmtInt(-over)}석`;
  }
  if (kind === 'food') {
    const d = FOOD_LV[lv + 1].spend - FOOD_LV[lv].spend;
    const recent = core.attHistory.slice(-10);
    const att = recent.length ? recent.reduce((a, b) => a + b, 0) / recent.length : Math.min(previewDemand(core), SEAT_LV[core.facilities.seats].cap);
    return `관중 1인당 +${fmtInt(Math.round(d * 10000))}원 · 홈경기당 약 +${fmtMoney(Math.round((att * d) / 10) * 10)}`;
  }
  const a = TRAIN_LV[lv];
  const b = TRAIN_LV[lv + 1];
  return `주간 성장 확률 ${Math.round(a.grow * 100)}% → ${Math.round(b.grow * 100)}% · 부상 −${Math.round((1 - b.inj / a.inj) * 100)}%`;
}

function FacilityCard({ kind }: { kind: FacilityKind }) {
  const core = useCore();
  const facilities = useStore((s) => s.facilities);
  const cash = useStore((s) => s.finance.cash);
  const upgrade = useStore((s) => s.upgrade);
  const lv = facilities[kind];
  const cur = facInfo(kind, lv);
  const next = facInfo(kind, lv + 1);
  const cost = upgradeCost(kind, facilities);
  const reason = cost == null ? '최대 단계입니다' : overLimit(core) ? OVER_LIMIT_ERR : cash < cost ? `현금 부족 (${fmtMoney(cost - cash)} 모자람)` : null;
  // 실행하면 금고가 언제 비는가 (안전하면 없음)
  const piece = useMemo(() => {
    const r = upgradeFacility(core, kind);
    return r.error ? null : runwayPieceOf(core, r.core);
  }, [core, kind]);

  return (
    <div className="mb-1.5 bg-panel-2 p-1.5" style={{ boxShadow: '0 0 0 1px #0f1420' }}>
      <div className="flex items-center justify-between">
        <span className="text-[12px] text-hi">
          {FAC_KO[kind]} <span className="text-white">{cur?.name}</span>
        </span>
        <span className="flex gap-[2px]" title={`Lv${lv + 1} / 5`}>
          {[0, 1, 2, 3, 4].map((i) => (
            <span key={i} style={{ width: 9, height: 9, background: i <= lv ? '#ffd84a' : '#141a29', boxShadow: '0 0 0 1px #0f1420' }} />
          ))}
        </span>
      </div>
      <div className="mt-0.5 text-[10px] text-white/65">{cur?.desc}</div>
      {next && cost != null ? (
        <div className="mt-1 bg-ink/60 p-1">
          <div className="text-[10px] text-good">
            ▲ Lv{lv + 2} {next.name}
          </div>
          <div className="text-[10px] text-white/65">{next.desc}</div>
          <div className="mt-0.5 text-[11px] text-white" data-testid={`upgrade-effect-${kind}`}>
            {upgradeEffect(core, kind)}
            {piece && <span className="text-hi" data-testid="runway-piece"> · {piece}</span>}
          </div>
          <div className="mt-1 flex items-center gap-2">
            <button className="px-btn gold" data-sfx="none" disabled={!!reason} onClick={() => upgrade(kind)}>
              업그레이드 {fmtMoney(cost)}
            </button>
            {reason ? <span className="text-[10px] text-bad">{reason}</span> : <span className="text-[10px] text-white/45">유지비 {fmtMoney(next.upkeep)}</span>}
          </div>
        </div>
      ) : (
        <div className="mt-1 text-[10px] text-hi">★ 최고 단계 달성</div>
      )}
    </div>
  );
}

/** 왕조 프로젝트 (첫 우승 뒤에만 보인다): 카드 = 이름·한 줄 효과·비용·[진행], 탭하면 상세 */
export function ProjectsSection() {
  const core = useCore();
  const buy = useStore((s) => s.project);
  const [open, setOpen] = useState<ProjectId | null>(null);
  if (!projectsOpen(core)) return null;
  const pvs = PROJECT_IDS.map((id) => projectPreview(core, id));
  const sel = open ? pvs.find((p) => p.id === open) : null;
  return (
    <div data-testid="projects">
      <SectionTitle right={<Help topic="projects" />}>왕조 프로젝트</SectionTitle>
      {pvs.map((pv) => (
        <div key={pv.id} className="mb-1.5 flex items-center gap-1.5 bg-panel-2 p-1.5" style={{ boxShadow: '0 0 0 1px #0f1420' }} data-testid={`project-${pv.id}`}>
          <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setOpen(pv.id)} aria-label={`${pv.name} 상세`}>
            <div className="flex items-baseline justify-between gap-2 text-[12px]">
              <span className="truncate text-hi">
                {pv.icon} {pv.name}
              </span>
              <span className="shrink-0 text-[10px] text-white/60">{pv.status}</span>
            </div>
            <div className="mt-0.5 text-[10px] leading-snug text-white/65 mob:text-[12px]">{pv.line}</div>
          </button>
          {pv.done ? (
            <span className="shrink-0 text-[11px] text-good">✓ 완료</span>
          ) : (
            <button className="px-btn gold shrink-0" data-sfx="none" disabled={!!pv.error} onClick={() => setOpen(pv.id)}>
              {pv.id === 'dome' && pv.step ? `${pv.step} ` : ''}
              {fmtMoney(pv.cost)}
            </button>
          )}
        </div>
      ))}
      {sel && (
        <Sheet onClose={() => setOpen(null)} label={sel.name}>
          <div className="px-4 pb-5 pt-1" data-testid="project-detail">
            <div className="font-pixel-lg mb-1 text-[16px] text-hi">
              {sel.icon} {sel.name}
              {sel.id === 'dome' && sel.step ? ` — ${sel.step}` : ''}
            </div>
            <div className="mb-2 text-[12px] text-white/60">{sel.status}</div>
            {sel.rows.map((r, i) => (
              <p key={i} className="mb-1 text-[13px] leading-relaxed text-white/90">
                · {r}
              </p>
            ))}
            {!sel.done && (
              <>
                <p className="mt-2 text-[13px] text-sky" data-testid="project-cash">
                  {sel.cash}
                </p>
                <div className="mt-3 flex items-center gap-2">
                  <button
                    className="px-btn gold"
                    data-sfx="none"
                    disabled={!!sel.error}
                    onClick={() => {
                      if (buy(sel.id)) setOpen(null);
                    }}
                  >
                    진행 {fmtMoney(sel.cost)}
                  </button>
                  {sel.error && <span className="text-[12px] text-bad">{sel.error}</span>}
                </div>
              </>
            )}
          </div>
        </Sheet>
      )}
    </div>
  );
}

/** part 를 주면 그 조각만 (구장에서 연 바텀 시트용): 'ticket' = 티켓 가격 + 관중 추이, 시설 이름 = 그 시설 카드 */
export function StadiumTab({ part }: { part?: 'ticket' | FacilityKind } = {}) {
  const core = useCore();
  const setPrice = useStore((s) => s.setPrice);
  const price = core.finance.ticketPrice;
  const ref = refPrice(core.facilities, core);
  const demand = useMemo(() => previewDemand(core), [core]);
  const cap = capacityOf(core);
  const over = demand > cap;
  const att = core.attHistory;
  const recent = att.slice(-42);
  const avg = att.length ? att.reduce((a, b) => a + b, 0) / att.length : 0;

  return (
    <div className={part ? 'p-1' : 'px-scroll min-h-0 flex-1 overflow-y-auto p-1.5'} data-testid={part ? `fac-sheet-${part}` : undefined}>
      {!part && (
        <div className="-mx-1.5 -mt-1.5 mb-1.5 empty:hidden">
          <FirstTip id="stadium" />
        </div>
      )}
      {(!part || part === 'ticket') && <SectionTitle>티켓 가격</SectionTitle>}
      <div className={`bg-panel-2 p-1.5 ${!part || part === 'ticket' ? '' : 'hidden'}`} style={{ boxShadow: '0 0 0 1px #0f1420' }}>
        <div className="flex items-center gap-1.5">
          <button className="px-btn mob:min-h-14 mob:min-w-16 mob:text-[26px]" disabled={price <= 0.5} onClick={() => setPrice(price - 0.1)} aria-label="가격 내리기">
            −
          </button>
          <div className="flex-1 text-center">
            <span className="font-pixel-lg text-[18px] text-hi mob:text-[26px]">{fmtInt(Math.round(price * 10000))}</span>
            <span className="text-[11px] text-white/60">원</span>
          </div>
          <button className="px-btn mob:min-h-14 mob:min-w-16 mob:text-[26px]" disabled={price >= 4} onClick={() => setPrice(price + 0.1)} aria-label="가격 올리기">
            +
          </button>
        </div>
        <input
          type="range"
          min={0.5}
          max={4}
          step={0.1}
          value={price}
          onChange={(e) => setPrice(Number(e.target.value))}
          className="mt-1 w-full accent-[#ffd84a] mob:my-1 mob:h-8"
        />
        <div className="flex justify-between text-[10px]">
          <span className="text-white/60">
            적정가 <span className="text-sky">{fmtInt(Math.round(ref * 10000))}원</span>
          </span>
          <span className={price > ref * 1.15 ? 'text-bad' : price < ref * 0.85 ? 'text-good' : 'text-white/60'}>
            {price > ref * 1.15 ? '비싸다는 불만' : price < ref * 0.85 ? '싸다고 좋아함' : '적정 수준'}
          </span>
        </div>
        <div className="mt-1.5 text-[10px] text-white/60">
          예상 수요 <span className={over ? 'text-hi' : 'text-white'}>{fmtInt(Math.round(demand))}명</span> / 좌석 {fmtInt(cap)}석
          <span className="text-white/40"> (평일·맑음)</span>
        </div>
        <Bar ratio={cap ? demand / cap : 0} color={over ? '#ffd84a' : '#7fd3ff'} h={8} className="mt-0.5" />
        {over && <div className="mt-0.5 text-[10px] text-hi">예상 수요가 좌석보다 {fmtInt(Math.round(demand - cap))}명 많습니다</div>}
        <div className="mt-1 text-[10px] text-white/60">
          홈경기당 예상 입장 수입 <span className="text-hi">{fmtMoney(Math.round(Math.min(demand, cap) * price))}</span>
        </div>
      </div>

      {!part && <SectionTitle>시설</SectionTitle>}
      {KINDS.filter((k) => !part || part === k).map((k) => (
        <FacilityCard key={k} kind={k} />
      ))}
      {!part && <ProjectsSection />}
      {part && part !== 'ticket' ? null : (
        <>
      <SectionTitle right={<span className="text-white/50">평균 {fmtInt(Math.round(avg))}명</span>}>홈 관중 추이</SectionTitle>
      <MiniBars values={recent} max={cap} height={52} color={(v) => (v >= cap ? '#ffd84a' : v >= cap * 0.7 ? '#6ee07a' : '#7fd3ff')} />
      <div className="mt-0.5 flex justify-between text-[9px] text-white/40">
        <span>홈 {att.length}경기</span>
        <span>
          <span className="text-hi">■</span> 매진 <span className="text-good">■</span> 70%↑
        </span>
      </div>
        </>
      )}
    </div>
  );
}

// ───────── 재무 ─────────

const INCOME: [keyof Ledger, string][] = [
  ['ticket', '입장'],
  ['food', '매점'],
  ['merch', '굿즈'],
  ['league', '분배금'],
  ['sales', '선수매각'],
];
const EXPENSE: [keyof Ledger, string][] = [
  ['salary', '연봉'],
  ['upkeep', '유지·운영'],
  ['interest', '이자'],
  ['signing', '계약·위약'],
  ['facility', '시설투자'],
];

export function ledgerTotals(l: Ledger) {
  const income = INCOME.reduce((a, [k]) => a + l[k], 0);
  const expense = EXPENSE.reduce((a, [k]) => a + l[k], 0);
  return { income, expense, net: income - expense };
}

export function LedgerBars({ ledger }: { ledger: Ledger }) {
  const { income, expense, net } = ledgerTotals(ledger);
  const max = Math.max(1, ...INCOME.map(([k]) => ledger[k]), ...EXPENSE.map(([k]) => ledger[k]));
  return (
    <div className="flex flex-col gap-[3px]">
      <div className="flex justify-between text-[10px] text-good">
        <span>수입</span>
        <span>+{fmtMoney(income)}</span>
      </div>
      {INCOME.map(([k, label]) => (ledger[k] > 0 || k !== 'sales' ? <MoneyBar key={k} label={label} text={fmtMoney(ledger[k])} ratio={ledger[k] / max} color="#6ee07a" /> : null))}
      <div className="mt-1 flex justify-between text-[10px] text-bad">
        <span>지출</span>
        <span>-{fmtMoney(expense)}</span>
      </div>
      {EXPENSE.map(([k, label]) => (
        <MoneyBar key={k} label={label} text={fmtMoney(ledger[k])} ratio={ledger[k] / max} color="#ff6b6b" />
      ))}
      <div className="mt-1 flex items-center justify-between bg-ink/70 px-1.5 py-1 text-[12px]">
        <span>시즌 손익</span>
        <span className={`font-pixel-lg text-[14px] ${net >= 0 ? 'text-good' : 'text-bad'}`}>
          {net >= 0 ? '+' : ''}
          {fmtMoney(net)}
        </span>
      </div>
    </div>
  );
}

const DEBT_BAR_MAX = 1.25; // 부채 막대의 오른쪽 끝 = 한도의 125%

export function FinanceTab() {
  const finance = useStore((s) => s.finance);
  const cashHistory = useStore((s) => s.cashHistory);
  const borrow = useStore((s) => s.borrow);
  const repay = useStore((s) => s.repay);
  const team = useUserTeam();
  const pay = payroll(team);
  const games = useStore((s) => seasonGames(s));

  const core = useCore();
  const limit = loanLimit(core);
  const over = overLimit(core);
  const canBorrow = !over && finance.debt + LOAN_STEP <= limit;
  const canRepay = finance.debt > 0 && finance.cash >= Math.min(LOAN_STEP, finance.debt);
  const interest = Math.round(loanInterest(core, finance.debt));
  const stepInterest = Math.round(loanInterest(core, finance.debt + LOAN_STEP)) - interest;
  const debtRatio = finance.debt / limit;
  const debtTone = over || debtRatio >= LOAN_DANGER ? 'text-bad' : debtRatio >= LOAN_TIER ? 'text-[#f0a35a]' : 'text-white/75';
  const rw = useMemo(() => runway(core), [core]);
  const ghost = useMemo(() => runwayPath(core), [core]);
  const inSeason = core.phase === 'season' && core.day < core.schedule.length;
  const buyEthics = useStore((s) => s.buyEthics);
  const eLv = ethicsLv(core);
  const eBlocked = ethicsBlocked(core);
  const loanPiece = useMemo(() => {
    const r = borrowLoan(core);
    return r.error ? null : runwayPieceOf(core, r.core);
  }, [core]);
  // 결과를 미리 말한다 (10구단 리그): 빚더미 구단 여론 · 경쟁균형세
  const mood = debtMoodText(core);
  const loanMood = borrowMoodText(core, LOAN_STEP);
  const lux = luxLine(core);

  return (
    <div className="px-scroll min-h-0 flex-1 overflow-y-auto p-1.5">
      <div className="-mx-1.5 -mt-1.5 mb-1.5 empty:hidden">
        <FirstTip id="finance" />
      </div>
      {mood ? (
        <div className={`mb-1.5 px-1.5 py-1 text-[11px] mob:text-[13px] ${mood.cut > 0 ? 'bg-bad/25 text-bad' : 'bg-[#f0a35a]/20 text-[#f0a35a]'}`} data-testid="debt-mood">
          {mood.text}
        </div>
      ) : debtRatio >= LOAN_DANGER && (
        <div className="mb-1.5 bg-bad/25 px-1.5 py-1 text-[11px] text-bad mob:text-[13px]" data-testid="debt-danger">
          {over ? `부채가 한도를 넘었습니다 — 영입·투자·대출이 막히고 선수를 보내야 합니다` : `부채가 한도의 ${Math.round(debtRatio * 100)}% — 한도를 넘으면 선수를 보내야 합니다`}
        </div>
      )}
      {/* 기본 = 현금 · 경기당 손익 · 시즌 말 예상 (+ 경고 시 바닥까지) */}
      <div className="mb-1.5 grid grid-cols-3 gap-1 text-center" data-testid="runway-line">
        <div className="bg-ink/60 px-1 py-1.5 leading-tight">
          <div className="text-[10px] text-white/55 mob:text-[13px]">현금</div>
          <div className={`font-pixel-lg text-[15px] ${finance.cash < 0 ? 'text-bad' : 'text-hi'}`}>{fmtMoney(finance.cash)}</div>
        </div>
        <div className="bg-ink/60 px-1 py-1.5 leading-tight">
          <div className="text-[10px] text-white/55 mob:text-[13px]">경기당 손익</div>
          <div className={`font-pixel-lg text-[15px] ${rw.perGame >= 0 ? 'text-good' : 'text-bad'}`}>
            {inSeason ? `${rw.perGame >= 0 ? '+' : '−'}${fmtMoney(Math.abs(rw.perGame))}` : '-'}
          </div>
        </div>
        <div className="relative bg-ink/60 px-1 py-1.5 leading-tight">
          <div className="text-[10px] text-white/55 mob:text-[13px]">시즌 말 예상</div>
          <div className={`font-pixel-lg text-[15px] ${rw.seasonEnd >= 0 ? 'text-hi' : 'text-bad'}`}>{rw.seasonEnd >= 0 ? fmtMoney(rw.seasonEnd) : `−${fmtMoney(-rw.seasonEnd)}`}</div>
        </div>
      </div>
      <div className="mb-1.5 flex items-center gap-1.5 text-[11px] mob:text-[13px]">
        {inSeason && rw.cashOut !== null ? (
          <span className="min-w-0 flex-1 text-bad" data-testid="runway-step">
            {rw.cashOut}경기 뒤 금고가 빕니다
          </span>
        ) : (
          <span className="min-w-0 flex-1 text-white/55">이 페이스면 금고는 안전합니다</span>
        )}
        <Help topic="runway" />
      </div>
      {/* 부채 한 줄 + 막대 (눈금: 한도의 50% = 이자 구간, 100% = 한도) */}
      <div className="mb-1.5" data-testid="debt-line">
        <div className="flex items-center gap-1.5 text-[11px] mob:text-[13px]">
          <span className={`min-w-0 flex-1 ${debtTone}`}>
            부채 {fmtMoney(finance.debt)} / 한도 {fmtMoney(limit)} · 이자 시즌당 {fmtMoney(interest)}
          </span>
          <Help topic="debt" />
        </div>
        <div className="relative mt-1 h-2 bg-ink/70" data-testid="debt-bar">
          <div className="h-full" style={{ width: `${Math.min(100, (debtRatio / DEBT_BAR_MAX) * 100)}%`, background: over || debtRatio >= LOAN_DANGER ? '#ff6b6b' : debtRatio >= LOAN_TIER ? '#f0a35a' : '#8fb8de' }} />
          <div className="absolute -top-0.5 h-3 w-px bg-white/60" style={{ left: `${(LOAN_TIER / DEBT_BAR_MAX) * 100}%` }} />
          <div className="absolute -top-0.5 h-3 w-0.5 bg-white" style={{ left: `${(1 / DEBT_BAR_MAX) * 100}%` }} />
        </div>
      </div>
      {lux && (
        <div className="mb-1.5 flex items-center gap-1.5 text-[11px] mob:text-[13px]" data-testid="lux-line">
          <span className={`min-w-0 flex-1 ${lux.over ? 'text-bad' : 'text-white/75'}`}>{lux.text}</span>
          <Help topic="luxtax" />
        </div>
      )}
      {inSeason && !over && rw.forcedSale !== null && rw.forcedSale <= RUNWAY_DANGER && (
        <div className="mb-1.5 bg-bad/20 px-1.5 py-1 text-[11px] text-bad mob:text-[13px]" data-testid="forced-line">
          한도 초과까지 {rw.forcedSale}경기 — 넘으면 선수를 보내야 합니다
        </div>
      )}
      <Fold label="자세히: 누적 장부 · 인건비 · 구단 현황" className="mb-1.5" testid="fold-finance">
        {inSeason && rw.cashOut !== null && (
          <div className="mb-1 bg-ink/60 px-1.5 py-1 text-[11px] leading-snug text-bad mob:text-[13px]">
            <div>① {rw.cashOut}경기 뒤 바닥 → 모자란 돈은 긴급 대출로 전환 (부채에 더해진다)</div>
            {rw.forcedSale !== null && (
              <div>
                ② {rw.forcedSale}경기 뒤 부채 한도 {fmtMoney(limit)} 초과 → 영입·투자가 막히고 선수 매각
              </div>
            )}
          </div>
        )}
        <LedgerBars ledger={finance.ledger} />
        <div className="mt-1.5 flex items-center justify-between bg-panel-2 px-1.5 py-1 text-[11px] mob:text-[13px]" style={{ boxShadow: '0 0 0 1px #0f1420' }}>
          <span>
            연봉 총액 <span className="text-hi">{fmtMoney(pay)}</span>
          </span>
          <span className="text-white/55">경기당 {fmtMoney(Math.round(pay / games))}</span>
        </div>
        <div className="mt-1 bg-panel-2 px-1.5 py-1 text-[11px] text-white/75 mob:text-[13px]" style={{ boxShadow: '0 0 0 1px #0f1420' }} data-testid="club-status">
          전력 {Math.round(teamStrength(team))} · 팬 {fmtInt(Math.round(core.fans))}명 · 만족도 {Math.round(core.fanSat)}
          {core.crowd ? ` · 최근 홈 관중 ${fmtInt(core.crowd.attendance)}명` : ''}
        </div>
      </Fold>

      <SectionTitle>대출</SectionTitle>
      <div className="bg-panel-2 p-1.5" style={{ boxShadow: '0 0 0 1px #0f1420' }}>
        <div className="flex justify-between text-[11px]">
          <span>
            부채 <span className={finance.debt > 0 ? 'text-bad' : 'text-white/60'}>{fmtMoney(finance.debt)}</span>
          </span>
          <span className="text-white/55">한도 {fmtMoney(limit)}</span>
        </div>
        <Bar ratio={finance.debt / limit} color={debtRatio >= LOAN_DANGER ? '#ff6b6b' : '#f0a35a'} h={8} className="my-1" />
        {finance.debt > 0 && <div className="text-[10px] text-white/55 mob:text-[13px]">이자 시즌당 {fmtMoney(interest)} · 경기당 {fmtMoney(Math.round(interest / games))}</div>}
        {canBorrow && (
          <div className="mt-0.5 text-[11px] text-white" data-testid="loan-effect">
            +{fmtMoney(LOAN_STEP)} 대출: 이자 시즌당 {fmtMoney(interest)} → {fmtMoney(interest + stepInterest)}
            {loanPiece && <span className="text-hi" data-testid="runway-piece"> · {loanPiece}</span>}
            {loanMood && <div className="text-bad" data-testid="loan-mood">{loanMood}</div>}
          </div>
        )}
        <div className="mt-1.5 flex gap-2">
          <button className="px-btn" disabled={!canBorrow} title={canBorrow ? `${fmtMoney(LOAN_STEP)} 대출` : '대출 한도 초과'} onClick={borrow}>
            대출 +{fmtMoney(LOAN_STEP)}
          </button>
          <button
            className="px-btn green"
            disabled={!canRepay}
            title={finance.debt <= 0 ? '갚을 부채가 없습니다' : canRepay ? '상환' : '현금 부족'}
            onClick={repay}
          >
            상환 −{fmtMoney(Math.min(LOAN_STEP, finance.debt || LOAN_STEP))}
          </button>
        </div>
        {/* 모바일엔 title 툴팁이 없으므로 상환 불가 사유를 보여준다 */}
        {!canRepay && <div className="mt-1 hidden text-[10px] text-white/50 mob:block">상환 불가: {finance.debt <= 0 ? '갚을 부채가 없습니다' : '현금 부족'}</div>}
        {!canBorrow && <div className="mt-1 text-[10px] text-bad mob:text-[13px]">{over ? '부채가 한도를 넘었습니다 — 선수 매각으로 부채를 줄이세요' : '한도까지 빌렸습니다. 한도를 넘기면 선수를 보내야 합니다'}</div>}
      </div>

      {(scandalOpen(core) || eLv > 0) && (
        <>
          <SectionTitle>선수단 관리</SectionTitle>
          <div className="flex items-center gap-1.5 bg-panel-2 p-1.5 text-[11px] mob:text-[13px]" style={{ boxShadow: '0 0 0 1px #0f1420' }} data-testid="ethics-line">
            <div className="min-w-0 flex-1 leading-snug">
              <div>
                윤리 교육 <span className="text-hi">{eLv}/{SC.ethicsMax}단계</span> · 스캔들 확률 ×{ethicsMult(eLv)}
                {eLv < SC.ethicsMax && <span className="text-good"> → ×{ethicsMult(eLv + 1)}</span>}
              </div>
              <div className="text-white/55">{eLv >= SC.ethicsMax ? '교육 과정을 모두 마쳤습니다' : `비용 ${fmtMoney(ethicsCost(core))}${eBlocked ? ` · ${eBlocked}` : ''}`}</div>
            </div>
            <Help topic="ethics" />
            <button className="px-btn green" disabled={!!eBlocked} onClick={buyEthics}>
              실시
            </button>
          </div>
        </>
      )}

      <SectionTitle>현금 추이</SectionTitle>
      <MiniBars values={cashHistory.slice(-games)} ghost={inSeason ? ghost : []} height={56} color={(v) => (v < 0 ? '#ff6b6b' : '#ffd84a')} />
      {inSeason && ghost.length > 0 && (
        <div className="mt-0.5 flex justify-between text-[9px] text-white/40 mob:text-[13px]">
          <span>지금까지</span>
          <span>┄ 이 페이스의 예측 (남은 {ghost.length}경기)</span>
        </div>
      )}
    </div>
  );
}

// ───────── 뉴스 ─────────

export function NewsTab() {
  const news = useStore((s) => s.news);
  return (
    <div className="px-scroll min-h-0 flex-1 overflow-y-auto p-1.5">
      {news.slice(0, 80).map((n) => (
        <div key={n.id} className="mb-[3px] flex gap-1.5 bg-ink/40 px-1.5 py-1 text-[11px] leading-snug">
          <span className={`shrink-0 ${TONE_CLASS[n.tone]}`}>{n.tone === 'good' ? '▲' : n.tone === 'bad' ? '▼' : '●'}</span>
          <span className="min-w-0 flex-1">
            <span className={n.tone === 'info' ? 'text-white/90' : TONE_CLASS[n.tone]}>{n.text}</span>
            <span className="ml-1 whitespace-nowrap text-[9px] text-white/35">
              {n.season}시즌 {n.day + 1}차전
            </span>
          </span>
        </div>
      ))}
      {!news.length && <div className="p-2 text-center text-[11px] text-white/40">아직 소식이 없습니다</div>}
    </div>
  );
}

// ───────── 패널 ─────────

const TABS: { id: RightTab; label: string }[] = [
  { id: 'league', label: '리그' },
  { id: 'stadium', label: '구장' },
  { id: 'finance', label: '재무' },
  { id: 'news', label: '뉴스' },
];

/** 탭 배지 = 그 탭에 속한 "할 일" 개수 (todo.ts). 탭을 열어도 상태가 해소되기 전에는 남는다 */
export function useHintTabs<T extends HintTab>(tabs: { id: T; label: string }[], _active?: T | null) {
  const todos = useTodos();
  return tabs.map((t) => ({ ...t, badge: <Badge n={todos.filter((x) => x.hint === t.id).length} /> }));
}

export default function RightPanel() {
  const tab = useStore((s) => s.rightTab);
  const setTab = useStore((s) => s.setTab);
  const tabs = useHintTabs(TABS, tab);
  return (
    <div className="px-panel flex h-full min-h-0 flex-col">
      {/* 데스크톱의 "할 일": 배지가 왜 떴는지 여기서 읽는다 */}
      <TodoLines className="p-1 pb-0" />
      <TabBar tabs={tabs} value={tab} onChange={(t) => setTab('right', t)} />
      {tab === 'league' && <LeagueTab />}
      {tab === 'stadium' && <StadiumTab />}
      {tab === 'finance' && <FinanceTab />}
      {tab === 'news' && <NewsTab />}
    </div>
  );
}
