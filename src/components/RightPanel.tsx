import { useMemo } from 'react';
import type { FacilityKind, Ledger } from '../game/types';
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
import { standings } from '../game/season';
import { Bar, FAC_KO, MiniBars, MoneyBar, SectionTitle, TabBar, TeamDot, TONE_CLASS, dowOf, fmtPct, isNightDay } from './ui';

// ───────── 리그 ─────────

export function LeagueTab() {
  const teams = useStore((s) => s.teams);
  const userId = useStore((s) => s.userId);
  const schedule = useStore((s) => s.schedule);
  const day = useStore((s) => s.day);
  const last = useStore((s) => s.lastReport);

  const table = useMemo(() => standings(teams), [teams]);
  const byId = useMemo(() => new Map(teams.map((t) => [t.id, t])), [teams]);
  const lead = table[0];
  const upcoming = useMemo(() => {
    const out: { day: number; oppId: string; isHome: boolean }[] = [];
    for (let d = day; d < schedule.length && out.length < 5; d++) {
      const m = userMatch({ schedule, userId }, d);
      if (m) out.push({ day: d, ...m });
    }
    return out;
  }, [schedule, day, userId]);

  return (
    <div className="px-scroll min-h-0 flex-1 overflow-y-auto p-1.5">
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
      {upcoming.map((u, i) => {
        const opp = byId.get(u.oppId);
        return (
          <div key={u.day} className={`flex items-center gap-1.5 px-1.5 py-[3px] text-[11px] ${i === 0 ? 'bg-sky/15' : ''}`}>
            <span className="w-12 text-white/50">
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
      {!upcoming.length && <div className="px-1 text-[10px] text-white/40">남은 경기가 없습니다</div>}
    </div>
  );
}

// ───────── 구장 ─────────

const KINDS: FacilityKind[] = ['seats', 'food', 'training'];

function facInfo(kind: FacilityKind, lv: number): { name: string; desc: string; upkeep: number } | null {
  const row = kind === 'seats' ? SEAT_LV[lv] : kind === 'food' ? FOOD_LV[lv] : TRAIN_LV[lv];
  return row ? { name: row.name, desc: row.desc, upkeep: row.upkeep } : null;
}

function FacilityCard({ kind }: { kind: FacilityKind }) {
  const facilities = useStore((s) => s.facilities);
  const cash = useStore((s) => s.finance.cash);
  const upgrade = useStore((s) => s.upgrade);
  const lv = facilities[kind];
  const cur = facInfo(kind, lv);
  const next = facInfo(kind, lv + 1);
  const cost = upgradeCost(kind, facilities);
  const reason = cost == null ? '최대 단계입니다' : cash < cost ? `현금 부족 (${fmtMoney(cost - cash)} 모자람)` : null;

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
          <div className="mt-1 flex items-center gap-2">
            <button className="px-btn gold" disabled={!!reason} title={reason ?? `유지비 ${fmtMoney(next.upkeep)}/경기`} onClick={() => upgrade(kind)}>
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

export function StadiumTab() {
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
    <div className="px-scroll min-h-0 flex-1 overflow-y-auto p-1.5">
      <SectionTitle>티켓 가격</SectionTitle>
      <div className="bg-panel-2 p-1.5" style={{ boxShadow: '0 0 0 1px #0f1420' }}>
        <div className="flex items-center gap-1.5">
          <button className="px-btn" disabled={price <= 0.5} onClick={() => setPrice(price - 0.1)}>
            −
          </button>
          <div className="flex-1 text-center">
            <span className="font-pixel-lg text-[18px] text-hi">{fmtInt(Math.round(price * 10000))}</span>
            <span className="text-[11px] text-white/60">원</span>
          </div>
          <button className="px-btn" disabled={price >= 4} onClick={() => setPrice(price + 0.1)}>
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
          className="mt-1 w-full accent-[#ffd84a]"
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
        {over && <div className="mt-0.5 text-[10px] text-hi">자리가 모자랍니다 — 가격을 올리거나 관중석을 증설하세요</div>}
      </div>

      <SectionTitle>시설</SectionTitle>
      {KINDS.map((k) => (
        <FacilityCard key={k} kind={k} />
      ))}

      <SectionTitle right={<span className="text-white/50">평균 {fmtInt(Math.round(avg))}명</span>}>홈 관중 추이</SectionTitle>
      <MiniBars values={recent} max={cap} height={52} color={(v) => (v >= cap ? '#ffd84a' : v >= cap * 0.7 ? '#6ee07a' : '#7fd3ff')} />
      <div className="mt-0.5 flex justify-between text-[9px] text-white/40">
        <span>홈 {att.length}경기</span>
        <span>
          <span className="text-hi">■</span> 매진 <span className="text-good">■</span> 70%↑
        </span>
      </div>
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

  return (
    <div className="px-scroll min-h-0 flex-1 overflow-y-auto p-1.5">
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
        {!canBorrow && <div className="mt-1 text-[10px] text-bad">한도까지 빌렸습니다. 한도를 넘기면 선수가 강제 매각됩니다</div>}
      </div>

      <SectionTitle right={<span className="text-hi">{fmtMoney(finance.cash)}</span>}>현금 추이</SectionTitle>
      <MiniBars values={cashHistory.slice(-84)} height={56} color={(v) => (v < 0 ? '#ff6b6b' : '#ffd84a')} />
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

export default function RightPanel() {
  const tab = useStore((s) => s.rightTab);
  const setTab = useStore((s) => s.setTab);
  return (
    <div className="px-panel flex h-full min-h-0 flex-col">
      <TabBar tabs={TABS} value={tab} onChange={(t) => setTab('right', t)} />
      {tab === 'league' && <LeagueTab />}
      {tab === 'stadium' && <StadiumTab />}
      {tab === 'finance' && <FinanceTab />}
      {tab === 'news' && <NewsTab />}
    </div>
  );
}
