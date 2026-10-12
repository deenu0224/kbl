import { useMemo, useState } from 'react';
import type { Player, Team } from '../game/types';
import { useCore, useStore } from '../store';
import { fmtAvg, fmtEra, fmtInt, fmtMoney } from '../game/format';
import { rankOf, seasonAwards, standings } from '../game/season';
import PixelFace from './PixelFace';
import { LedgerBars, ledgerTotals } from './RightPanel';
import { MiniBars, OvrBadge, POS_KO, TeamDot, fmtPct, recText } from './ui';

const GRADE_COLOR: Record<string, string> = { S: '#ffd84a', A: '#6ee07a', B: '#7fd3ff', C: '#f0a35a', D: '#ff6b6b' };

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

/** 시즌 종료 전체 화면 결산 */
export default function SeasonEnd() {
  const core = useCore();
  const startNextSeason = useStore((s) => s.startNextSeason);
  const newGame = useStore((s) => s.newGame);
  const [armNew, setArmNew] = useState(false);

  const awards = useMemo(() => seasonAwards(core), [core]);
  const table = useMemo(() => standings(core.teams), [core.teams]);
  const team = core.teams.find((t) => t.id === core.userId) ?? core.teams[0];
  const rank = rankOf(core.teams, team.id);
  const lead = table[0];
  const { net } = ledgerTotals(core.finance.ledger);
  const att = core.attHistory;
  const totalAtt = att.reduce((a, b) => a + b, 0);
  const avgAtt = att.length ? Math.round(totalAtt / att.length) : 0;
  const gc = GRADE_COLOR[awards.grade] ?? '#fff';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/95 p-4 mob:items-stretch mob:p-0"
      style={{ paddingTop: 'max(env(safe-area-inset-top), 0px)', paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="px-panel px-scroll flex max-h-full w-full max-w-[1100px] flex-col overflow-y-auto p-4 mob:p-3">
        <div className="flex items-center justify-between mob:flex-col mob:items-stretch mob:gap-2">
          <div>
            <div className="text-[11px] text-sky">{core.season}시즌 종료</div>
            <div className="font-pixel-lg text-[26px] leading-tight" style={{ color: team.color, textShadow: '2px 2px 0 #0f1420' }}>
              {team.city} {team.name}
            </div>
            <div className="mt-0.5 text-[14px]">
              최종 <span className="font-pixel-lg text-[20px] text-hi">{rank}위</span> · {recText(team.rec)} · 승률 {fmtPct(team.rec.w, team.rec.l)}
              <span className="ml-2 text-[11px] text-white/55">
                득점 {team.rec.rs} / 실점 {team.rec.ra}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-3 mob:flex-row-reverse mob:justify-end">
            <div className="max-w-[300px] text-right mob:max-w-none mob:text-left">
              <div className="text-[10px] text-white/50">구단주 평가</div>
              <div className="text-[12px] leading-snug text-white/90">{awards.comment}</div>
            </div>
            <div
              className="anim-pop flex h-20 w-20 items-center justify-center font-pixel-lg text-[52px] text-ink"
              style={{ background: gc, boxShadow: '0 0 0 3px #0f1420, inset 0 -6px 0 rgba(0,0,0,.25)' }}
            >
              {awards.grade}
            </div>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-3 mob:grid-cols-2 por:grid-cols-1">
          {/* 순위표 */}
          <div>
            <div className="mb-1 text-[11px] text-sky">▸ 최종 순위</div>
            {table.map((t, i) => {
              const me = t.id === core.userId;
              const gb = (lead.rec.w - t.rec.w + (t.rec.l - lead.rec.l)) / 2;
              return (
                <div
                  key={t.id}
                  className={`flex items-center gap-1.5 px-1.5 py-1 text-[12px] ${me ? 'bg-hi/20 text-hi' : i % 2 ? 'bg-white/4' : ''}`}
                  style={me ? { boxShadow: 'inset 2px 0 0 #ffd84a' } : undefined}
                >
                  <span className={`w-4 ${i === 0 ? 'text-hi' : 'text-white/50'}`}>{i + 1}</span>
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

          {/* 손익 */}
          <div>
            <div className="mb-1 text-[11px] text-sky">▸ 손익 결산</div>
            <LedgerBars ledger={core.finance.ledger} />
            <div className="mt-1 flex justify-between text-[11px] text-white/70">
              <span>
                보유 현금 <span className="text-hi">{fmtMoney(core.finance.cash)}</span>
              </span>
              <span>
                부채 <span className={core.finance.debt > 0 ? 'text-bad' : ''}>{fmtMoney(core.finance.debt)}</span>
              </span>
            </div>
            <div className={`mt-0.5 text-[10px] ${net >= 0 ? 'text-good' : 'text-bad'}`}>
              {net >= 0 ? '흑자 시즌이었습니다' : '적자 시즌이었습니다 — 지출 구조를 점검하세요'}
            </div>
          </div>

          {/* 관중 + MVP */}
          <div className="flex flex-col gap-2">
            <div>
              <div className="mb-1 text-[11px] text-sky">▸ 관중</div>
              <div className="flex justify-between text-[12px]">
                <span>
                  총 <span className="font-pixel-lg text-[15px] text-hi">{fmtInt(totalAtt)}</span>명
                </span>
                <span className="text-white/75">
                  평균 {fmtInt(avgAtt)}명 · 팬 {fmtInt(Math.round(core.fans))}
                </span>
              </div>
              <MiniBars values={att} height={44} color={(v, i) => (i === att.indexOf(Math.max(...att)) ? '#ffd84a' : v >= avgAtt ? '#6ee07a' : '#7fd3ff')} style={{ marginTop: 4 }} />
            </div>
            <div>
              <div className="mb-1 text-[11px] text-sky">▸ 팀 MVP</div>
              <div className="flex flex-col gap-1.5">
                <MvpCard title="타자 MVP" p={awards.mvpBat} team={team} />
                <MvpCard title="투수 MVP" p={awards.mvpPit} team={team} />
              </div>
            </div>
          </div>
        </div>

        <div className="mt-4 flex items-center justify-end gap-3 mob:sticky mob:-bottom-3 mob:-mx-3 mob:-mb-3 mob:bg-panel mob:p-3">
          <button
            className="px-btn !px-4 !py-1.5"
            onClick={() => {
              if (!armNew) return setArmNew(true);
              newGame();
            }}
            title="저장된 구단을 지우고 처음부터 다시 시작합니다"
          >
            {armNew ? '정말 처음부터? (저장 삭제)' : '새 게임'}
          </button>
          <button className="px-btn primary !px-6 !py-2 text-[14px] mob:flex-1" onClick={startNextSeason}>
            다음 시즌 ▶
          </button>
        </div>
      </div>
    </div>
  );
}
