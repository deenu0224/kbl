import { useEffect, useMemo, useRef, useState } from 'react';
import type { Player } from '../game/types';
import { useCore, useStore, useUserTeam } from '../store';
import { DRAFT_BONUS, DRAFT_ROUNDS, draftRound } from '../game/draft';
import { ROSTER_MAX, farmMax, activeRoster, farmRoster } from '../game/economy';
import { fmtMoney } from '../game/format';
import PlayerCard from './PlayerCard';
import Sheet from './layout/Sheet';
import { useLayout } from './layout/useLayout';
import { useUi } from './layout/uiStore';
import { POS_FULL, POS_KO, SectionTitle, TeamDot } from './ui';
import PlayerBrowser from './roster/PlayerBrowser';
import { usePosReport } from './roster/rosterUi';

const school = (p: Player) => (p.age <= 20 ? '고졸' : '대졸');

/** 신인 드래프트 전체 화면 (phase 'draft') */
export default function DraftScreen() {
  const draft = useStore((s) => s.draft);
  const teams = useStore((s) => s.teams);
  const userId = useStore((s) => s.userId);
  const season = useStore((s) => s.season);
  const cash = useStore((s) => s.finance.cash);
  const draftPick = useStore((s) => s.draftPick);
  const draftSkip = useStore((s) => s.draftSkip);
  const finishDraft = useStore((s) => s.finishDraft);
  const setPeek = useUi((s) => s.setDraftPeek);
  const team = useUserTeam();
  const layout = useLayout();
  const mobile = layout !== 'desktop';
  const [sel, setSel] = useState<string | null>(null);
  const curRef = useRef<HTMLDivElement | null>(null);
  const rows = usePosReport();

  const byId = useMemo(() => new Map(teams.map((t) => [t.id, t])), [teams]);
  const order = draft?.order ?? [];
  const pick = draft?.pick ?? 0;
  const pool = draft?.pool ?? [];
  const log = draft?.log ?? [];
  const done = !draft || pick >= order.length;
  const myTurn = !done && order[pick] === userId;
  const round = draft && !done ? draftRound(draft) : DRAFT_ROUNDS;
  const perRound = Math.max(1, Math.round(order.length / DRAFT_ROUNDS));
  const bonus = DRAFT_BONUS[round - 1] ?? DRAFT_BONUS[DRAFT_BONUS.length - 1];
  const selP = sel ? pool.find((p) => p.id === sel) : undefined;
  const mine = useMemo(() => new Set(draft?.mine ?? []), [draft?.mine]);
  const nFarm = farmRoster(team).length;
  const FARM_MAX = farmMax(useCore());
  const full = nFarm >= FARM_MAX;
  const reason = !myTurn ? '지명 차례가 아닙니다' : full ? `2군이 가득 찼습니다 (${FARM_MAX}명)` : cash < bonus ? `계약금 부족 (${fmtMoney(bonus)})` : null;

  useEffect(() => {
    if (sel && !pool.some((p) => p.id === sel)) setSel(null);
  }, [sel, pool]);
  // 현재 순번이 띠 가운데 오도록
  useEffect(() => {
    curRef.current?.scrollIntoView({ inline: 'center', block: 'nearest' });
  }, [pick]);

  const card = selP && (
    <PlayerCard player={selP} prospect roleLabel={`${POS_FULL[selP.pos]} · ${school(selP)}`}>
      <button className="px-btn primary mob:min-h-11 mob:flex-1 mob:text-[15px]" data-sfx="none" disabled={!!reason} onClick={() => draftPick(selP.id)}>
        지명 · 계약금 {fmtMoney(bonus)}
      </button>
      {reason && <span className="text-[10px] text-bad">{reason}</span>}
    </PlayerCard>
  );

  const logView = (
    <>
      <SectionTitle>지명 기록</SectionTitle>
      {log
        .slice()
        .reverse()
        .map((l, i) => {
          const me = l.teamId === userId;
          return (
            <div key={`${l.pid}-${i}`} className={`flex items-center gap-1.5 px-1 py-[3px] text-[11px] mob:text-[13px] ${me ? 'bg-hi/20 text-hi' : i % 2 ? 'bg-white/4' : ''}`}>
              <span className="w-6 shrink-0 text-white/45">{l.round}R</span>
              <TeamDot team={byId.get(l.teamId)} />
              <span className="w-16 shrink-0 truncate text-white/65">{byId.get(l.teamId)?.name}</span>
              <span className="min-w-0 flex-1 truncate">{l.name}</span>
              <span className="shrink-0 text-[10px] text-white/50">{POS_KO[l.pos as keyof typeof POS_KO] ?? l.pos}</span>
            </div>
          );
        })}
      {!log.length && <div className="px-1 text-[10px] text-white/40">아직 지명된 선수가 없습니다</div>}
    </>
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch justify-center bg-ink/95 p-4 mob:p-0"
      style={{ paddingTop: 'max(env(safe-area-inset-top), 0px)', paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="px-panel flex min-h-0 w-full max-w-[1000px] flex-col">
        {/* 머리 */}
        <div className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 px-3 pt-2 land:pt-1">
          <div className="flex-1 whitespace-nowrap">
            <div className="text-[11px] text-sky">{season}시즌 스토브리그</div>
            <div className="font-pixel-lg text-[18px] leading-tight text-hi" style={{ textShadow: '1px 1px 0 #0f1420' }}>
              신인 드래프트 <span className="text-[13px] text-white/70">{done ? '종료' : `${round}라운드`}</span>
            </div>
          </div>
          <div className="order-last w-full text-[11px] leading-tight text-white/65 lg:order-none lg:w-auto lg:shrink-0 lg:text-right">
            <div>
              현금 <span className="text-hi">{fmtMoney(cash)}</span>
            </div>
            <div className={full ? 'text-bad' : ''} data-testid="draft-farm">
              지명 선수는 2군으로 · 2군 {nFarm}/{FARM_MAX} <span className="text-white/45">(1군 {activeRoster(team).length}/{ROSTER_MAX})</span>
            </div>
          </div>
          <button className="px-btn shrink-0 mob:text-[13px]" onClick={() => setPeek(true)}>
            구단 보기
          </button>
        </div>

        {/* 지명 순서 띠 */}
        <div className="px-scroll mt-1.5 flex shrink-0 gap-[3px] overflow-x-auto bg-edge/60 px-2 py-1.5 land:mt-1 land:py-1">
          {order.map((tid, i) => {
            const t = byId.get(tid);
            const cur = i === pick && !done;
            const me = tid === userId;
            const past = i < pick;
            return (
              <div
                key={i}
                ref={cur ? curRef : undefined}
                className={`flex w-11 shrink-0 flex-col items-center gap-0.5 py-1 text-[10px] leading-none land:flex-row land:justify-center land:gap-1 land:py-0.5 ${cur ? 'bg-hi/25' : 'bg-panel'} ${past ? 'opacity-40' : ''}`}
                style={{ boxShadow: cur ? '0 0 0 2px #ffd84a' : me ? 'inset 0 -2px 0 #ffd84a' : undefined, marginLeft: i > 0 && i % perRound === 0 ? 8 : 0 }}
              >
                <span className="text-white/50 land:hidden">
                  {Math.floor(i / perRound) + 1}-{(i % perRound) + 1}
                </span>
                <TeamDot team={t} size={12} />
                <span className={me ? 'text-hi' : 'text-white/70'}>{me ? '우리' : tid}</span>
              </div>
            );
          })}
        </div>

        {/* 본문 */}
        <div className="flex min-h-0 flex-1 gap-2 p-2">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="shrink-0 px-1.5 text-[11px] text-white/50 mob:text-[13px]">남은 유망주 {pool.length}명</div>
            <PlayerBrowser
              mode="draft"
              players={pool}
              rows={rows}
              sel={sel}
              onPick={(p) => setSel(p.id === sel && !mobile ? null : p.id)}
              rowAction={(p) => (
                <button className="px-btn primary !px-2 !py-0.5 text-[11px] mob:min-h-9 mob:text-[13px]" data-sfx="none" data-testid="draft-pick" disabled={!!reason} title={reason ?? undefined} onClick={() => draftPick(p.id)}>
                  지명
                </button>
              )}
            />
            {mobile && <div className="px-scroll max-h-[calc(var(--dvh)*18)] shrink-0 overflow-y-auto land:hidden">{logView}</div>}
          </div>
          {!mobile && (
            <div className="px-scroll flex min-h-0 w-[320px] shrink-0 flex-col overflow-y-auto">
              {card || <div className="shrink-0 bg-panel-2/60 p-2 text-center text-[11px] text-white/45">선수를 누르면 카드가 열립니다</div>}
              {logView}
            </div>
          )}
        </div>

        {/* 바닥: 차례 / 패스 / 개막 */}
        <div className="flex shrink-0 items-center gap-2 bg-edge/60 p-2 land:py-1">
          {done ? (
            <>
              <span className="min-w-0 flex-1 text-[12px] text-white/75">
                우리 구단 지명 <span className="text-hi">{mine.size}명</span>
              </span>
              <button className="px-btn primary min-h-11 !px-6 text-[15px] mob:flex-1" onClick={finishDraft}>
                새 시즌 개막 ▶
              </button>
            </>
          ) : (
            <>
              <span className={`min-w-0 flex-1 text-[12px] mob:text-[13px] ${myTurn ? 'text-hi' : 'text-white/60'}`}>
                {myTurn ? `우리 차례 — ${round}라운드 (계약금 ${fmtMoney(bonus)})` : '다른 구단이 지명 중입니다'}
              </span>
              <button className="px-btn min-h-10 mob:text-[13px]" disabled={!myTurn} onClick={draftSkip}>
                패스
              </button>
            </>
          )}
        </div>
      </div>

      {mobile && selP && (
        <Sheet onClose={() => setSel(null)} label="유망주 카드">
          {card}
        </Sheet>
      )}
    </div>
  );
}
