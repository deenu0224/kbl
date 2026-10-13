import { useEffect, useMemo } from 'react';
import { FirstTip } from './Briefing';
import type { Core, FacilityKind, HintTab, Ledger } from '../game/types';
import { useCore, useStore, useUserTeam, userMatch, type RightTab } from '../store';
import { fmtInt, fmtMoney } from '../game/format';
import {
  FOOD_LV,
  LOAN_LIMIT,
  LOAN_RATE,
  LOAN_STEP,
  SEAT_LV,
  TRAIN_LV,
  payroll,
  previewDemand,
  refPrice,
  upgradeCost,
} from '../game/economy';
import { borrow as borrowLoan, standings, upgradeFacility } from '../game/season';
import { forcedSaleTarget, runway, runwayPath, runwayPieceOf } from '../game/runway';
import Bracket from './Bracket';
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
  const lead = table[0];
  const upcoming = useMemo(() => {
    const out: { day: number; oppId: string; isHome: boolean }[] = [];
    if (phase !== 'season') return out;
    for (let d = day; d < schedule.length && out.length < 5; d++) {
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
            .sort((a, b) => a.from - b.from)
            .slice(0, 3),
    [beats, day, phase, schedule.length],
  );

  return (
    <div className="px-scroll min-h-0 flex-1 overflow-y-auto p-1.5">
      <Chips items={LEAGUE_SUBS} value={sub} onChange={setSub} />
      {sub === 'leaders' && <Leaders />}
      {sub === 'bracket' && (
        <div className="mt-2">
          <Bracket />
        </div>
      )}
      {sub === 'table' && (
        <>
      {phase === 'post' && post && (
        <div className="mt-2">
          <Bracket />
        </div>
      )}
      <SectionTitle>순위표</SectionTitle>
      <div className="flex px-1 text-[9px] text-white/40">
        <span className="w-4" />
        <span className="flex-1">구단</span>
        <span className="w-16 text-center">승-패-무</span>
        <span className="w-9 text-right">승률</span>
        <span className="w-8 text-right">승차</span>
        <span className="w-11 text-right">최근10</span>
      </div>
      {table.map((t, i) => {
        const gb = (lead.rec.w - t.rec.w + (t.rec.l - lead.rec.l)) / 2;
        const me = t.id === userId;
        return (
          <div
            key={t.id}
            className={`flex items-center px-1 py-[3px] text-[11px] ${me ? 'bg-hi/20 text-hi' : i % 2 ? 'bg-white/4' : ''}`}
            style={me ? { boxShadow: 'inset 2px 0 0 #ffd84a' } : undefined}
          >
            <span className={`w-4 ${i < 4 ? 'text-good' : 'text-white/50'}`}>{i + 1}</span>
            <span className="flex min-w-0 flex-1 items-center gap-1">
              <TeamDot team={t} />
              <span className="truncate">{t.name}</span>
            </span>
            <span className="w-16 text-center text-white/85">
              {t.rec.w}-{t.rec.l}-{t.rec.t}
            </span>
            <span className="w-9 text-right">{fmtPct(t.rec.w, t.rec.l)}</span>
            <span className="w-8 text-right text-white/60">{i === 0 || gb === 0 ? '-' : gb.toFixed(1)}</span>
            <span className="flex w-11 items-end justify-end gap-px">
              {t.rec.last10.slice(-10).map((v, k) => (
                <span key={k} style={{ width: 3, height: v === 1 ? 9 : v === 0 ? 4 : 6, background: v === 1 ? '#6ee07a' : v === 0 ? '#ff6b6b' : '#9aa5c4' }} />
              ))}
            </span>
          </div>
        );
      })}

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

      <SectionTitle>다음 일정</SectionTitle>
      {forecast.map((b) => {
        const n = b.from - day;
        const games = b.to - Math.max(b.from, day) + 1;
        return (
          <div key={b.id} className="mb-[2px] flex items-center gap-1.5 bg-ink/50 px-1.5 py-[3px] text-[11px] mob:min-h-8 mob:text-[12px]" style={{ boxShadow: 'inset 2px 0 0 #f0a35a' }}>
            <span className="w-[58px] shrink-0 whitespace-nowrap text-[#f0a35a]">{n > 0 ? `D-${n}` : '진행 중'}</span>
            <span className="min-w-0 flex-1 truncate">
              {b.icon ? `${b.icon} ` : ''}
              {b.label}
            </span>
            <span className="shrink-0 text-[10px] text-white/50">{n > 0 ? `${games}경기` : `남은 ${games}경기`}</span>
          </div>
        );
      })}
      {upcoming.map((u, i) => {
        const opp = byId.get(u.oppId);
        return (
          <div key={u.day} className={`flex items-center gap-1.5 px-1.5 py-[3px] text-[11px] ${i === 0 ? 'bg-sky/15' : ''}`}>
            <span className="w-[58px] shrink-0 whitespace-nowrap text-white/50">
              {u.day + 1}차전 {dowOf(u.day)}
            </span>
            <span className={`w-7 text-center text-[10px] ${u.isHome ? 'bg-good/25 text-good' : 'bg-white/10 text-white/60'}`}>{u.isHome ? '홈' : '원정'}</span>
            <TeamDot team={opp} />
            <span className="flex-1 truncate">
              {opp?.city} {opp?.name}
            </span>
            <span className="text-[10px] text-white/40">{isNightDay(u.day) ? '야간' : '주간'}</span>
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
  const reason = cost == null ? '최대 단계입니다' : cash < cost ? `현금 부족 (${fmtMoney(cost - cash)} 모자람)` : null;
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

/** part 를 주면 그 조각만 (구장에서 연 바텀 시트용): 'ticket' = 티켓 가격 + 관중 추이, 시설 이름 = 그 시설 카드 */
export function StadiumTab({ part }: { part?: 'ticket' | FacilityKind } = {}) {
  const core = useCore();
  const setPrice = useStore((s) => s.setPrice);
  const price = core.finance.ticketPrice;
  const ref = refPrice(core.facilities);
  const demand = useMemo(() => previewDemand(core), [core]);
  const cap = SEAT_LV[core.facilities.seats]?.cap ?? 0;
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

export function FinanceTab() {
  const finance = useStore((s) => s.finance);
  const cashHistory = useStore((s) => s.cashHistory);
  const borrow = useStore((s) => s.borrow);
  const repay = useStore((s) => s.repay);
  const team = useUserTeam();
  const pay = payroll(team);
  const games = useStore((s) => s.schedule.length) || 84;

  const canBorrow = finance.debt + LOAN_STEP <= LOAN_LIMIT;
  const canRepay = finance.debt > 0 && finance.cash >= Math.min(LOAN_STEP, finance.debt);
  const perGameInterest = (finance.debt * LOAN_RATE) / games;
  const core = useCore();
  const rw = useMemo(() => runway(core), [core]);
  const ghost = useMemo(() => runwayPath(core), [core]);
  const inSeason = core.phase === 'season' && core.day < core.schedule.length;
  const victim = rw.forcedSale !== null ? forcedSaleTarget(core) : null;
  const loanPiece = useMemo(() => {
    const r = borrowLoan(core);
    return r.error ? null : runwayPieceOf(core, r.core);
  }, [core]);

  return (
    <div className="px-scroll min-h-0 flex-1 overflow-y-auto p-1.5">
      <div className="-mx-1.5 -mt-1.5 mb-1.5 empty:hidden">
        <FirstTip id="finance" />
      </div>
      {inSeason && (
        <div className="mb-1.5 bg-ink/60 px-1.5 py-1 text-[11px] leading-snug mob:text-[13px]" style={{ boxShadow: `inset 3px 0 0 ${rw.cashOut !== null ? '#ff6b6b' : '#6ee07a'}` }} data-testid="runway-line">
          <div>
            경기당 평균{' '}
            <span className={rw.perGame >= 0 ? 'text-good' : 'text-bad'}>
              {rw.perGame >= 0 ? '+' : '−'}
              {fmtMoney(Math.abs(rw.perGame))}
            </span>{' '}
            · 이 페이스면 시즌 말 <span className={rw.seasonEnd >= 0 ? 'text-hi' : 'text-bad'}>{rw.seasonEnd >= 0 ? `현금 ${fmtMoney(rw.seasonEnd)}` : `${fmtMoney(-rw.seasonEnd)} 부족`}</span>
          </div>
          {rw.cashOut !== null && (
            <div className="text-bad" data-testid="runway-step">
              ① {rw.cashOut}경기 뒤 바닥 → 모자란 돈은 긴급 대출(연 {Math.round(LOAN_RATE * 100)}%)로 전환
            </div>
          )}
          {rw.forcedSale !== null && (
            <div className="text-bad" data-testid="runway-step">
              ② {rw.forcedSale}경기 뒤 부채 {fmtMoney(LOAN_LIMIT)} 초과 → 최고 연봉 선수{victim ? ` ${victim.name}(${fmtMoney(victim.salary)})` : ''} 강제 매각
            </div>
          )}
        </div>
      )}
      <SectionTitle>시즌 누적 장부</SectionTitle>
      <LedgerBars ledger={finance.ledger} />

      <SectionTitle>선수단 인건비</SectionTitle>
      <div className="flex items-center justify-between bg-panel-2 px-1.5 py-1 text-[11px]" style={{ boxShadow: '0 0 0 1px #0f1420' }}>
        <span>
          연봉 총액 <span className="text-hi">{fmtMoney(pay)}</span>
        </span>
        <span className="text-white/55">경기당 {fmtMoney(Math.round(pay / games))}</span>
      </div>

      <SectionTitle>대출</SectionTitle>
      <div className="bg-panel-2 p-1.5" style={{ boxShadow: '0 0 0 1px #0f1420' }}>
        <div className="flex justify-between text-[11px]">
          <span>
            부채 <span className={finance.debt > 0 ? 'text-bad' : 'text-white/60'}>{fmtMoney(finance.debt)}</span>
          </span>
          <span className="text-white/55">한도 {fmtMoney(LOAN_LIMIT)}</span>
        </div>
        <Bar ratio={finance.debt / LOAN_LIMIT} color={finance.debt > LOAN_LIMIT * 0.7 ? '#ff6b6b' : '#f0a35a'} h={8} className="my-1" />
        <div className="text-[10px] text-white/55">
          연 {Math.round(LOAN_RATE * 100)}% · 지금 이자 경기당 {fmtMoney(Math.round(perGameInterest))}
        </div>
        {canBorrow && (
          <div className="mt-0.5 text-[11px] text-white" data-testid="loan-effect">
            +{fmtMoney(LOAN_STEP)} 대출: 이자 시즌당 약 {fmtMoney(Math.round(LOAN_STEP * LOAN_RATE))}
            {loanPiece && <span className="text-hi" data-testid="runway-piece"> · {loanPiece}</span>}
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
        {!canBorrow && <div className="mt-1 text-[10px] text-bad">한도까지 빌렸습니다. 한도를 넘기면 선수가 강제 매각됩니다</div>}
      </div>

      <SectionTitle right={<span className="text-hi">{fmtMoney(finance.cash)}</span>}>현금 추이</SectionTitle>
      <MiniBars values={cashHistory.slice(-84)} ghost={inSeason ? ghost : []} height={56} color={(v) => (v < 0 ? '#ff6b6b' : '#ffd84a')} />
      {inSeason && ghost.length > 0 && (
        <div className="mt-0.5 flex justify-between text-[9px] text-white/40 mob:text-[11px]">
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

/** 탭 배지(campaign.hints): 탭을 열거나 다시 누르면 지운다 */
export function useHintTabs<T extends HintTab>(tabs: { id: T; label: string }[], active: T | null) {
  const hints = useStore((s) => s.campaign.hints);
  const clearHint = useStore((s) => s.clearHint);
  // 이미 열려 있는 탭에 새로 붙은 배지도 바로 지운다
  const n = active ? (hints?.[active] ?? 0) : 0;
  useEffect(() => {
    if (active && n > 0) clearHint(active);
  }, [active, n, clearHint]);
  return tabs.map((t) => ({ ...t, badge: <Badge n={t.id === active ? 0 : hints?.[t.id]} /> }));
}

export default function RightPanel() {
  const tab = useStore((s) => s.rightTab);
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
          setTab('right', t);
        }}
      />
      {tab === 'league' && <LeagueTab />}
      {tab === 'stadium' && <StadiumTab />}
      {tab === 'finance' && <FinanceTab />}
      {tab === 'news' && <NewsTab />}
    </div>
  );
}
