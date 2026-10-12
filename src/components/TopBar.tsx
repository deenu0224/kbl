import { useEffect, useState, type ReactNode } from 'react';
import { useStore, useUserTeam } from '../store';
import { fmtInt, fmtMoney } from '../game/format';
import { payroll } from '../game/economy';
import { teamStrength } from '../game/ratings';
import { rankOf } from '../game/season';
import { CampaignChip } from './Campaign';
import SoundButton from './SoundButton';
import { useUi } from './layout/uiStore';
import { Bar, ratingColor, recText, TeamDot } from './ui';

function Cell({ label, children, title }: { label: string; children: ReactNode; title?: string }) {
  return (
    <div className="flex flex-col justify-center px-2.5 leading-tight max-[1279px]:px-1.5" title={title}>
      <span className="text-[9px] text-white/50">{label}</span>
      <span className="whitespace-nowrap text-[13px]">{children}</span>
    </div>
  );
}

const Sep = () => <div className="mx-1 w-[2px] self-stretch bg-edge" />;

export default function TopBar() {
  const team = useUserTeam();
  const teams = useStore((s) => s.teams);
  const season = useStore((s) => s.season);
  const day = useStore((s) => s.day);
  const total = useStore((s) => s.schedule.length);
  const cash = useStore((s) => s.finance.cash);
  const debt = useStore((s) => s.finance.debt);
  const crowd = useStore((s) => s.crowd);
  const fans = useStore((s) => s.fans);
  const fanSat = useStore((s) => s.fanSat);

  const rank = rankOf(teams, team.id);
  const str = teamStrength(team);
  const pay = payroll(team);
  const streak = team.rec.streak;

  return (
    <div className="px-panel flex h-12 shrink-0 items-stretch px-2">
      <div className="flex items-center gap-2 pr-2">
        <TeamDot team={team} size={22} />
        <div className="leading-tight">
          <div className="font-pixel-lg text-[15px]" style={{ color: team.color, textShadow: '1px 1px 0 #0f1420' }}>
            {team.city} {team.name}
          </div>
          <div className="text-[10px] text-white/55">
            {season}시즌 · {Math.min(day, total)}/{total} 경기
          </div>
        </div>
      </div>
      <div className="flex w-16 items-center max-[1399px]:hidden">
        <Bar ratio={total ? day / total : 0} color="#7fd3ff" h={6} />
      </div>
      <Sep />
      <CampaignChip className="w-[210px] shrink-0 max-[1279px]:w-[176px]" />
      <Sep />
      <Cell label="순위">
        <span className={rank <= 3 ? 'text-hi' : rank >= 7 ? 'text-bad' : ''}>{rank}위</span>
      </Cell>
      <Cell label="전적">
        {recText(team.rec)}
        {Math.abs(streak) >= 2 && (
          <span className={`ml-1 text-[10px] ${streak > 0 ? 'text-good' : 'text-bad'}`}>
            {Math.abs(streak)}
            {streak > 0 ? '연승' : '연패'}
          </span>
        )}
      </Cell>
      <Sep />
      <Cell label="현금">
        <span className={cash < 0 ? 'text-bad' : 'text-hi'}>{fmtMoney(cash)}</span>
      </Cell>
      <Cell label="부채">
        <span className={debt > 0 ? 'text-bad' : 'text-white/60'}>{fmtMoney(debt)}</span>
      </Cell>
      <span className="flex max-[1399px]:hidden">
        <Cell label="연봉 총액">{fmtMoney(pay)}</Cell>
      </span>
      <Sep />
      <Cell label="최근 관중" title="마지막 홈경기 관중">
        {crowd ? (
          <>
            {fmtInt(crowd.attendance)}
            {crowd.soldOut && <span className="ml-1 text-[10px] text-hi">매진</span>}
          </>
        ) : (
          <span className="text-white/40">-</span>
        )}
      </Cell>
      <Cell label="팬 수">{fmtInt(Math.round(fans))}</Cell>
      <Cell label="만족도" title={`팬 만족도 ${Math.round(fanSat)}/100`}>
        <span className="flex items-center gap-1">
          <span style={{ color: fanSat >= 60 ? '#6ee07a' : fanSat >= 40 ? '#ffd84a' : '#ff6b6b' }}>{Math.round(fanSat)}</span>
          <span className="w-10">
            <Bar ratio={fanSat / 100} color={fanSat >= 60 ? '#6ee07a' : fanSat >= 40 ? '#ffd84a' : '#ff6b6b'} h={5} />
          </span>
        </span>
      </Cell>
      <Cell label="전력">
        <span style={{ color: ratingColor(str) }}>{Math.round(str)}</span>
      </Cell>
      <div className="ml-auto flex items-center">
        <SoundButton />
      </div>
    </div>
  );
}

// ───────── 모바일: 2줄 컴팩트 상단바 (탭하면 상세 펼침) ─────────

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col bg-ink/60 px-2 py-1 leading-tight">
      <span className="text-[11px] text-white/50">{label}</span>
      <span className="text-[14px]">{children}</span>
    </div>
  );
}

export function MobileTopBar() {
  const team = useUserTeam();
  const teams = useStore((s) => s.teams);
  const season = useStore((s) => s.season);
  const day = useStore((s) => s.day);
  const total = useStore((s) => s.schedule.length);
  const cash = useStore((s) => s.finance.cash);
  const debt = useStore((s) => s.finance.debt);
  const crowd = useStore((s) => s.crowd);
  const fans = useStore((s) => s.fans);
  const fanSat = useStore((s) => s.fanSat);
  const playback = useStore((s) => !!s.playback);
  const newGame = useStore((s) => s.newGame);
  const open = useUi((s) => s.topOpen);
  const setOpen = useUi((s) => s.setTopOpen);
  const [arm, setArm] = useState(false);

  useEffect(() => {
    if (!open) setArm(false);
  }, [open]);

  const rank = rankOf(teams, team.id);
  const str = teamStrength(team);
  const pay = payroll(team);
  const streak = team.rec.streak;
  const satColor = fanSat >= 60 ? '#6ee07a' : fanSat >= 40 ? '#ffd84a' : '#ff6b6b';

  return (
    <div className="px-panel relative z-30 flex shrink-0 flex-col land:flex-row">
      <button className="flex min-w-0 flex-1 cursor-pointer flex-col justify-center gap-0.5 px-2 py-1 text-left" onClick={() => setOpen(!open)} aria-expanded={open}>
        <div className="flex w-full items-center gap-1.5 text-[13px] leading-tight">
          <TeamDot team={team} size={14} />
          <span className="min-w-0 truncate font-pixel-lg text-[14px]" style={{ color: team.color, textShadow: '1px 1px 0 #0f1420' }}>
            {team.name}
          </span>
          <span className="shrink-0 text-[11px] text-white/55">
            {Math.min(day, total)}/{total}
          </span>
          <span className="ml-auto flex shrink-0 items-center gap-1.5">
            <span className={rank <= 3 ? 'text-hi' : rank >= 7 ? 'text-bad' : ''}>{rank}위</span>
            <span className="text-white/85">{recText(team.rec)}</span>
            {Math.abs(streak) >= 2 && (
              <span className={`text-[11px] ${streak > 0 ? 'text-good' : 'text-bad'}`}>
                {Math.abs(streak)}
                {streak > 0 ? '연승' : '연패'}
              </span>
            )}
          </span>
        </div>
        <div className="flex w-full items-center gap-2.5 text-[13px] leading-tight">
          <span>
            <span className="text-[11px] text-white/50">현금 </span>
            <span className={cash < 0 ? 'text-bad' : 'text-hi'}>{fmtMoney(cash)}</span>
          </span>
          <span>
            <span className="text-[11px] text-white/50">팬 </span>
            {fmtInt(Math.round(fans))}
          </span>
          <span className="flex min-w-0 flex-1 items-center gap-1">
            <span className="shrink-0 text-[11px] text-white/50">만족</span>
            <span className="shrink-0" style={{ color: satColor }}>
              {Math.round(fanSat)}
            </span>
            <span className="w-full max-w-14 min-w-6">
              <Bar ratio={fanSat / 100} color={satColor} h={5} />
            </span>
          </span>
          <span className="shrink-0 text-[11px] text-white/45">{open ? '▲' : '▼'}</span>
        </div>
      </button>
      {/* 캠페인: 세로는 한 줄, 가로는 옆에 두 줄 */}
      <div className="hidden bg-ink/35 por:block" style={{ boxShadow: 'inset 0 2px 0 #0f1420' }}>
        <CampaignChip line />
      </div>
      <div className="hidden w-[46%] shrink-0 bg-ink/35 land:flex" style={{ boxShadow: 'inset 2px 0 0 #0f1420' }}>
        <CampaignChip className="w-full" />
      </div>

      {open && (
        <>
          <div className="fixed inset-0 z-[-1]" onClick={() => setOpen(false)} />
          <div className="px-panel anim-fade absolute inset-x-0 top-full mt-[4px] p-2">
            <div className="mb-1.5 flex items-center gap-2 text-[11px] text-white/55">
              <span className="shrink-0">
                {team.city} {team.name} · {season}시즌
              </span>
              <Bar ratio={total ? day / total : 0} color="#7fd3ff" h={6} />
            </div>
            <div className="grid grid-cols-3 gap-1">
              <Detail label="부채">
                <span className={debt > 0 ? 'text-bad' : 'text-white/60'}>{fmtMoney(debt)}</span>
              </Detail>
              <Detail label="연봉 총액">{fmtMoney(pay)}</Detail>
              <Detail label="전력">
                <span style={{ color: ratingColor(str) }}>{Math.round(str)}</span>
              </Detail>
              <Detail label="최근 홈 관중">
                {crowd ? (
                  <>
                    {fmtInt(crowd.attendance)}
                    {crowd.soldOut && <span className="ml-1 text-[11px] text-hi">매진</span>}
                  </>
                ) : (
                  <span className="text-white/40">-</span>
                )}
              </Detail>
              <Detail label="팬 수">{fmtInt(Math.round(fans))}</Detail>
              <Detail label="팬 만족도">
                <span style={{ color: satColor }}>{Math.round(fanSat)}</span>
                <span className="text-[11px] text-white/45">/100</span>
              </Detail>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <SoundButton inline />
            </div>
            <div className="mt-2 flex items-center justify-end gap-2">
              {playback && <span className="text-[11px] text-white/45">재생 중에는 새 게임을 시작할 수 없습니다</span>}
              <button
                className={`px-btn ${arm ? 'primary' : ''}`}
                disabled={playback}
                onClick={() => {
                  if (!arm) return setArm(true);
                  setArm(false);
                  setOpen(false);
                  newGame();
                }}
              >
                {arm ? '정말 새 게임? (저장 삭제)' : '새 게임'}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
