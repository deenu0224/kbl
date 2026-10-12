import { useEffect, useState } from 'react';
import { useStore, userMatch } from '../store';
import { TeamDot, dowOf, isNightDay } from './ui';

export default function BottomBar() {
  const playback = useStore((s) => !!s.playback);
  const summary = useStore((s) => !!s.summary);
  const phase = useStore((s) => s.phase);
  const day = useStore((s) => s.day);
  const schedule = useStore((s) => s.schedule);
  const userId = useStore((s) => s.userId);
  const teams = useStore((s) => s.teams);
  const playNext = useStore((s) => s.playNext);
  const simDays = useStore((s) => s.simDays);
  const newGame = useStore((s) => s.newGame);
  const [arm, setArm] = useState(false);

  useEffect(() => {
    if (!arm) return;
    const id = window.setTimeout(() => setArm(false), 3000);
    return () => window.clearTimeout(id);
  }, [arm]);

  const total = schedule.length;
  const ended = phase === 'ended' || day >= total;
  const next = ended ? null : userMatch({ schedule, userId }, day);
  const opp = teams.find((t) => t.id === next?.oppId);
  const left = Math.max(0, total - day);
  const reason = playback ? '경기 하이라이트 재생 중' : summary ? '경기 요약을 먼저 닫으세요' : ended ? '시즌이 끝났습니다' : undefined;
  const off = !!reason;

  return (
    <div className="px-panel flex h-12 shrink-0 items-center gap-3 px-3">
      <div className="flex min-w-0 flex-1 items-center gap-2 text-[12px]">
        {next && opp ? (
          <>
            <span className="text-[10px] text-sky">다음 경기</span>
            <span className={`px-1 text-[10px] ${next.isHome ? 'bg-good/25 text-good' : 'bg-white/10 text-white/70'}`}>{next.isHome ? '홈' : '원정'}</span>
            <TeamDot team={opp} size={12} />
            <span className="truncate text-[13px]">
              vs {opp.city} {opp.name}
            </span>
            <span className="whitespace-nowrap text-[10px] text-white/50">
              {day + 1}차전 · {dowOf(day)}요일 {isNightDay(day) ? '야간' : '주간'} · 상대 {opp.rec.w}승 {opp.rec.l}패
            </span>
          </>
        ) : (
          <span className="text-white/60">정규 시즌이 끝났습니다</span>
        )}
      </div>
      {reason && <span className="text-[10px] text-white/45">{reason}</span>}
      <button
        className="px-btn !px-2 text-[10px]"
        disabled={playback}
        title="저장된 구단을 지우고 처음부터 다시 시작합니다"
        onClick={() => {
          if (!arm) return setArm(true);
          setArm(false);
          newGame();
        }}
      >
        {arm ? '정말 새 게임?' : '새 게임'}
      </button>
      <button className="px-btn primary !px-5 !py-1.5 text-[14px]" disabled={off} title={reason ?? '하이라이트와 함께 한 경기 진행'} onClick={playNext}>
        ▶ 경기 진행
      </button>
      <button className="px-btn !py-1.5" disabled={off} title={reason ?? '하이라이트 없이 6경기 진행'} onClick={() => simDays(6)}>
        1주 진행
      </button>
      <button className="px-btn !py-1.5" disabled={off} title={reason ?? `남은 ${left}경기를 한 번에 진행`} onClick={() => simDays(left)}>
        시즌 끝까지
      </button>
    </div>
  );
}
