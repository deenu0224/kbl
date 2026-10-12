import { useEffect, useState } from 'react';
import { useStore, userMatch, useUserTeam } from '../store';
import { usePostLine } from './Bracket';
import { EventReopen } from './EventCardModal';
import { useUi } from './layout/uiStore';
import { todayIssues } from '../game/fixes';
import { useWinChance } from './useWinChance';
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
  const post = useStore((s) => s.post);
  const event = useStore((s) => !!s.campaign.event);
  const briefing = useStore((s) => !!s.campaign.briefing);
  const postLine = usePostLine();

  const total = schedule.length;
  const inPost = phase === 'post';
  const live = phase === 'season' ? day < total : inPost;
  const next = live ? userMatch({ schedule, userId, phase, post }, day) : null;
  const opp = teams.find((t) => t.id === next?.oppId);
  const left = inPost ? 20 : Math.max(0, total - day);
  const idle = phase === 'draft' ? '신인 드래프트 진행 중' : phase === 'over' ? '연고 이전이 확정됐습니다' : inPost ? '포스트시즌 일정이 끝났습니다' : '정규 시즌이 끝났습니다';
  const reason = playback ? '경기 하이라이트 재생 중' : summary ? '경기 요약을 먼저 닫으세요' : event ? '이벤트 카드 대기 중' : briefing ? '주간 브리핑 대기 중' : !next ? idle : undefined;
  /** 다음 경기 설명: 정규시즌은 "12차전 · 금요일 야간", 포스트시즌은 "한국시리즈 3차전 · 2승 1패" */
  const when = postLine ? postLine.text : `${day + 1}차전 · ${dowOf(day)}요일 ${isNightDay(day) ? '야간' : '주간'}`;
  const whenShort = postLine ? postLine.text : `${day + 1}차전 ${dowOf(day)} ${isNightDay(day) ? '야간' : '주간'}`;
  // 시즌 첫 경기는 한 경기씩: 개막전을 치르기 전에는 일괄 진행을 잠근다
  const bulkReason = reason ?? (phase === 'season' && day === 0 ? '개막전부터' : undefined);
  // 개막전은 오더 제출로만 시작한다: 주 버튼이 오더지를 다시 여는 버튼이 된다
  const opener = phase === 'season' && day === 0 && !!next;
  return { opener, playback, phase, inPost, next, opp, left, reason, idle, when, whenShort, off: !!reason, bulkOff: !!bulkReason, bulkReason };
}

/** 경기 전 점검 줄: "오늘 승리 확률 44%" + 고칠 곳이 있으면 칩 (탭하면 "오늘의 오더") */
function PreGame({ short = false }: { short?: boolean }) {
  const team = useUserTeam();
  const opener = useStore((s) => s.phase === 'season' && s.day === 0);
  const pct = useWinChance();
  const setDailyOpen = useUi((s) => s.setDailyOpen);
  const setOrderOpen = useUi((s) => s.setOrderOpen);
  const n = todayIssues(team);
  return (
    <>
      <span className="shrink-0 whitespace-nowrap text-[11px] text-white/70" data-testid="pre-chance">
        {short ? '승리 확률' : '오늘 승리 확률'} <span className="text-[13px] text-hi">{pct === null ? '—' : `${pct}%`}</span>
      </span>
      {n > 0 && (
        <button
          className="shrink-0 cursor-pointer whitespace-nowrap bg-bad/85 px-1.5 py-0.5 text-[11px] text-white mob:py-1 mob:text-[12px]"
          style={{ boxShadow: '0 0 0 1px #0f1420' }}
          data-testid="fix-chip"
          onClick={() => (opener ? setOrderOpen(true) : setDailyOpen(true))}
        >
          고칠 곳 {n}
        </button>
      )}
    </>
  );
}

/** 주 버튼: 평소엔 [▶ 경기 진행], 개막전 전에는 [개막전 오더] */
function PlayButton({ className, opener, off }: { className: string; opener: boolean; off: boolean }) {
  const playNext = useStore((s) => s.playNext);
  const setOrderOpen = useUi((s) => s.setOrderOpen);
  if (opener) {
    return (
      <button className={`px-btn primary ${className}`} data-testid="order-open" disabled={off} onClick={() => setOrderOpen(true)}>
        개막전 오더
      </button>
    );
  }
  return (
    <button className={`px-btn primary ${className}`} data-sfx="none" disabled={off} onClick={playNext}>
      ▶ 경기 진행
    </button>
  );
}

/** 드래프트 중 구단 화면을 살펴보다 돌아가는 버튼 */
function DraftReturn({ className = '' }: { className?: string }) {
  const phase = useStore((s) => s.phase);
  const setPeek = useUi((s) => s.setDraftPeek);
  if (phase !== 'draft') return null;
  return (
    <button className={`px-btn primary ${className}`} onClick={() => setPeek(false)}>
      드래프트로 돌아가기 ▶
    </button>
  );
}

export default function BottomBar() {
  const { opener, playback, inPost, next, opp, left, reason, idle, when, off, bulkOff, bulkReason } = useMatchActions();
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
            <span className="text-[10px] text-sky">{inPost ? '가을야구' : '다음 경기'}</span>
            <span className={`px-1 text-[10px] ${next.isHome ? 'bg-good/25 text-good' : 'bg-white/10 text-white/70'}`}>{next.isHome ? '홈' : '원정'}</span>
            <TeamDot team={opp} size={12} />
            <span className="truncate text-[13px]">
              vs {opp.city} {opp.name}
            </span>
            <span className="whitespace-nowrap text-[10px] text-white/50">
              <span className={inPost ? 'text-hi' : ''}>{when}</span>
              {!inPost && ` · 상대 ${opp.rec.w}승 ${opp.rec.l}패`}
            </span>
            {!playback && <PreGame />}
          </>
        ) : (
          <span className="text-white/60">{idle}</span>
        )}
      </div>
      {(reason ?? bulkReason) && next && <span className="text-[10px] text-white/45">{reason ?? `일괄 진행은 ${bulkReason}`}</span>}
      <EventReopen className="!py-1.5" />
      <DraftReturn className="!py-1.5" />
      <button
        className="px-btn !px-2 text-[10px]"
        disabled={playback}
        onClick={() => {
          if (!arm) return setArm(true);
          setArm(false);
          newGame();
        }}
      >
        {arm ? '정말 새 게임?' : '새 게임'}
      </button>
      <PlayButton className="!px-5 !py-1.5 text-[14px]" opener={opener} off={off} />
      {!inPost && (
        <button className="px-btn !py-1.5" disabled={bulkOff} title={bulkReason} onClick={() => simDays(6)}>
          1주 진행
        </button>
      )}
      <button className="px-btn !py-1.5" disabled={bulkOff} title={bulkReason} onClick={() => simDays(left)}>
        {inPost ? '가을야구 끝까지' : '시즌 끝까지'}
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
  const { opener, playback, inPost, next, opp, left, reason, idle, whenShort, off, bulkOff, bulkReason } = useMatchActions();
  const simDays = useStore((s) => s.simDays);
  const skipPlayback = useStore((s) => s.skipPlayback);

  const info = playback ? (
    <LiveScore />
  ) : next && opp ? (
    <div className="flex min-w-0 items-center gap-1.5 text-[13px]">
      <span className={`shrink-0 px-1 text-[11px] ${next.isHome ? 'bg-good/25 text-good' : 'bg-white/10 text-white/70'}`}>{next.isHome ? '홈' : '원정'}</span>
      <TeamDot team={opp} size={11} />
      <span className="min-w-0 truncate">vs {opp.name}</span>
      <span className={`shrink-0 text-[11px] ${inPost ? 'text-hi' : 'text-white/50'}`}>
        {whenShort}
      </span>
      <PreGame short />
    </div>
  ) : (
    <div className="text-[12px] text-white/60">{idle}</div>
  );

  const eventId = useStore((s) => s.campaign.event?.id ?? null);
  const hiddenId = useUi((s) => s.eventHidden);
  const eventFolded = eventId !== null && eventId === hiddenId;
  const buttons = playback ? (
    <button className="px-btn gold min-h-11 short:min-h-10 flex-1 text-[15px]" onClick={skipPlayback}>
      건너뛰기 ▶▶
    </button>
  ) : eventFolded ? (
    // 카드를 접어 둔 동안엔 진행 버튼 대신 카드로 돌아가는 버튼 하나만
    <EventReopen className="min-h-11 short:min-h-10 flex-1 truncate text-[15px]" />
  ) : (
    <>
      <DraftReturn className="min-h-11 short:min-h-10 flex-[2] text-[14px]" />
      <PlayButton className="min-h-11 short:min-h-10 flex-[1.6] text-[15px]" opener={opener} off={off} />
      {!inPost && (
        <button className="px-btn min-h-11 short:min-h-10 flex-1 text-[13px] leading-tight" disabled={bulkOff} onClick={() => simDays(6)}>
          1주
          {!reason && bulkReason && <span className="block text-[10px] text-white/45">{bulkReason}</span>}
        </button>
      )}
      <button className="px-btn min-h-11 short:min-h-10 flex-[1.3] text-[13px] leading-tight" disabled={bulkOff} onClick={() => simDays(left)}>
        {inPost ? '가을야구 끝까지' : '시즌 끝까지'}
      </button>
    </>
  );

  return (
    <div className="px-panel flex shrink-0 flex-col gap-1.5 px-2 pt-1 pb-2">
      <div className="flex h-6 min-w-0 items-center justify-between gap-2">
        {info}
        {/* title 툴팁 대신 비활성 사유를 화면에 */}
        {reason && !playback && next && <span className="shrink-0 text-[11px] text-white/45">{reason}</span>}
      </div>
      <div className="flex gap-2">{buttons}</div>
    </div>
  );
}
