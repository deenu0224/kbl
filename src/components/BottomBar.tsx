import { useEffect, useState } from 'react';
import { useStore, userMatch } from '../store';
import { TeamDot, dowOf, isNightDay } from './ui';

/** 하단 진행 버튼들의 공통 상태 (데스크톱 BottomBar · 모바일 액션 바 공용) */
function useMatchActions() {
  const playback = useStore((s) => !!s.playback);
  const summary = useStore((s) => !!s.summary);
  const phase = useStore((s) => s.phase);
  const day = useStore((s) => s.day);
  const schedule = useStore((s) => s.schedule);
  const userId = useStore((s) => s.userId);
  const teams = useStore((s) => s.teams);

  const total = schedule.length;
  const ended = phase === 'ended' || day >= total;
  const next = ended ? null : userMatch({ schedule, userId }, day);
  const opp = teams.find((t) => t.id === next?.oppId);
  const left = Math.max(0, total - day);
  const reason = playback ? '경기 하이라이트 재생 중' : summary ? '경기 요약을 먼저 닫으세요' : ended ? '시즌이 끝났습니다' : undefined;
  return { playback, day, next, opp, left, reason, off: !!reason };
}

export default function BottomBar() {
  const { playback, day, next, opp, left, reason, off } = useMatchActions();
  const playNext = useStore((s) => s.playNext);
  const simDays = useStore((s) => s.simDays);
  const newGame = useStore((s) => s.newGame);
  const [arm, setArm] = useState(false);

  useEffect(() => {
    if (!arm) return;
    const id = window.setTimeout(() => setArm(false), 3000);
    return () => window.clearTimeout(id);
  }, [arm]);

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

// ───────── 모바일 액션 바 ─────────

/** 재생 중 실시간 점수 한 줄 (모바일에선 전광판 글씨가 작아서) */
function LiveScore() {
  const playback = useStore((s) => s.playback);
  const teams = useStore((s) => s.teams);
  const userId = useStore((s) => s.userId);
  if (!playback) return null;
  const { report, step } = playback;
  const ev = report.result.events[step];
  const away = teams.find((t) => t.id === report.result.awayId);
  const home = teams.find((t) => t.id === report.result.homeId);
  const inning = !ev ? '' : ev.type === 'final' ? '경기 종료' : ev.type === 'start' ? '플레이볼' : `${ev.inning}회${ev.half === 0 ? '초' : '말'}`;
  return (
    <div className="flex min-w-0 items-center gap-1.5 text-[13px]">
      <span className="shrink-0 text-[11px] text-sky">{inning}</span>
      <TeamDot team={away} size={11} />
      <span className={`truncate ${away?.id === userId ? 'text-white' : 'text-white/65'}`}>{away?.name}</span>
      <span className="shrink-0 font-pixel-lg text-[15px] text-hi">
        {ev?.away ?? 0} : {ev?.home ?? 0}
      </span>
      <span className={`truncate ${home?.id === userId ? 'text-white' : 'text-white/65'}`}>{home?.name}</span>
      <TeamDot team={home} size={11} />
    </div>
  );
}

/**
 * 모바일 액션 바: [▶ 경기 진행](크게) [1주] [시즌 끝까지] + 다음 경기 한 줄.
 * 하이라이트 재생 중엔 엄지 위치에 [건너뛰기].
 */
export function MobileActionBar() {
  const { playback, day, next, opp, left, reason, off } = useMatchActions();
  const playNext = useStore((s) => s.playNext);
  const simDays = useStore((s) => s.simDays);
  const skipPlayback = useStore((s) => s.skipPlayback);

  const info = playback ? (
    <LiveScore />
  ) : next && opp ? (
    <div className="flex min-w-0 items-center gap-1.5 text-[13px]">
      <span className={`shrink-0 px-1 text-[11px] ${next.isHome ? 'bg-good/25 text-good' : 'bg-white/10 text-white/70'}`}>{next.isHome ? '홈' : '원정'}</span>
      <TeamDot team={opp} size={11} />
      <span className="min-w-0 truncate">vs {opp.name}</span>
      <span className="shrink-0 text-[11px] text-white/50">
        {day + 1}차전 {dowOf(day)} {isNightDay(day) ? '야간' : '주간'} · {opp.rec.w}승{opp.rec.l}패
      </span>
    </div>
  ) : (
    <div className="text-[12px] text-white/60">{reason ?? '정규 시즌이 끝났습니다'}</div>
  );

  const buttons = playback ? (
    <button className="px-btn gold min-h-11 short:min-h-10 flex-1 text-[15px]" onClick={skipPlayback}>
      건너뛰기 ▶▶
    </button>
  ) : (
    <>
      <button className="px-btn primary min-h-11 short:min-h-10 flex-[1.6] text-[15px]" disabled={off} onClick={playNext}>
        ▶ 경기 진행
      </button>
      <button className="px-btn min-h-11 short:min-h-10 flex-1 text-[13px]" disabled={off} onClick={() => simDays(6)}>
        1주
      </button>
      <button className="px-btn min-h-11 short:min-h-10 flex-[1.3] text-[13px] leading-tight" disabled={off} onClick={() => simDays(left)}>
        시즌 끝까지
      </button>
    </>
  );

  return (
    <div className="px-panel flex shrink-0 flex-col gap-1.5 px-2 pt-1 pb-2">
      <div className="flex h-5 min-w-0 items-center justify-between gap-2">
        {info}
        {/* title 툴팁 대신 비활성 사유를 화면에 */}
        {reason && !playback && next && <span className="shrink-0 text-[11px] text-white/45">{reason}</span>}
      </div>
      <div className="flex gap-2">{buttons}</div>
    </div>
  );
}
