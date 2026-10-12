import { useEffect, useMemo, useRef, useState } from 'react';
import { play } from '../audio/sfx';
import { CHARACTERS } from '../game/story';
import { teamParts } from '../game/ratings';
import { useStore, userMatch, useUserTeam } from '../store';
import { AutoButton, LineupTab, PitchersTab, TeamBar, orderIssues } from './LeftPanel';
import { useWinChance } from './useWinChance';
import PixelFace from './PixelFace';
import { useIsMobile } from './layout/useLayout';
import { useUi, type RosterSub } from './layout/uiStore';
import { Badge, TabBar, TeamDot } from './ui';

// 새 시즌·새 게임의 개막전에는 오더지가 다시 첫 화면이 된다
useStore.subscribe((s, p) => {
  if (s.season !== p.season || s.seed !== p.seed) useUi.setState({ orderOpen: true, orderBase: null, orderEdit: null });
});

const safe = {
  paddingTop: 'max(env(safe-area-inset-top), 4px)',
  paddingBottom: 'max(env(safe-area-inset-bottom), 6px)',
  paddingLeft: 'max(env(safe-area-inset-left), 4px)',
  paddingRight: 'max(env(safe-area-inset-right), 4px)',
};

/** 세그먼트 배지: 문제 수, 없으면 ✓ */
const mark = (n: number) => (n > 0 ? <Badge n={n} /> : <span className="text-good">✓</span>);

const CHANCE_MS = 2000;

/** 오더지의 중심 숫자: 개막전 승리 확률. 편성을 바꾸면 "31% → 44%"가 잠깐 보인다. 계산은 미뤄서 하고 그동안은 이전 값을 둔다. */
function WinChance({ fixable, label }: { fixable: boolean; label: string }) {
  const pct = useWinChance();
  const [from, setFrom] = useState<number | null>(null);
  const last = useRef<number | null>(null);
  useEffect(() => {
    if (pct === null) return;
    if (last.current !== null && last.current !== pct) setFrom(last.current);
    last.current = pct;
  }, [pct]);
  useEffect(() => {
    if (from === null) return;
    const id = setTimeout(() => setFrom(null), CHANCE_MS);
    return () => clearTimeout(id);
  }, [from, pct]);
  const tone = from === null || pct === null ? 'text-hi' : pct > from ? 'text-good' : 'text-bad';
  const bar = from === null || pct === null ? 'bg-hi' : pct > from ? 'bg-good' : 'bg-bad';
  return (
    <div className="shrink-0 px-2 pt-2" data-testid="win-chance">
      <div className="flex items-baseline justify-between gap-2 whitespace-nowrap">
        <span className="text-[12px] text-white/75 mob:text-[13px]">{label}</span>
        <span className={`font-pixel-lg text-[24px] leading-none ${tone}`} style={{ textShadow: '1px 1px 0 #0f1420' }}>
          {pct === null ? '…' : from === null ? `${pct}%` : `${from}% → ${pct}%`}
        </span>
      </div>
      <div className="mt-1 h-[6px] bg-white/10">
        <div className={`h-full ${bar}`} style={{ width: `${pct ?? 0}%`, transition: 'width .3s' }} />
      </div>
      {fixable && <div className="mt-1 text-[11px] text-white/70 mob:text-[12px]">오더를 고치면 이길 확률이 오릅니다.</div>}
    </div>
  );
}

/**
 * 개막전 오더지: 시즌 첫 경기를 치르기 전, 감독이 내민 오더가 첫 화면이 된다.
 * 모바일은 전체 화면, 데스크톱은 야구장 영역 위 가운데. [오더 제출]로만 개막전이 시작된다.
 */
export default function OrderSheet() {
  const idleNow = useStore((s) => !s.campaign.event && !s.campaign.briefing && !s.summary && !s.playback);
  const opener = useStore((s) => s.phase === 'season' && s.day === 0);
  const playable = useStore((s) => (s.phase === 'season' && s.day < s.schedule.length) || s.phase === 'post');
  const phase = useStore((s) => s.phase);
  const post = useStore((s) => s.post);
  const day = useStore((s) => s.day);
  const daily = !opener; // 개막전이 아니면 "오늘의 오더": 감독 대사 없이, [닫기]로 닫는다
  const show = idleNow && playable;
  const open = useUi((s) => (opener ? s.orderOpen : s.dailyOpen));
  const setOpen = useUi((s) => (opener ? s.setOrderOpen : s.setDailyOpen));
  const playNext = useStore((s) => s.playNext);
  const opening = useStore((s) => s.campaign.opening);
  const schedule = useStore((s) => s.schedule);
  const userId = useStore((s) => s.userId);
  const teams = useStore((s) => s.teams);
  const team = useUserTeam();
  const mobile = useIsMobile();
  const [seg, setSeg] = useState<RosterSub>('lineup');
  const issues = useMemo(() => orderIssues(team), [team]);
  const visible = show && open;

  useEffect(() => {
    if (visible && !daily) play('event');
  }, [visible, daily]);
  // 경기가 진행되면 "오늘의 오더"는 닫힌다
  useEffect(() => {
    if (!show) useUi.setState({ dailyOpen: false });
  }, [show]);
  // 처음 열었을 때의 전력을 적어 둔다 (경기 후 요약의 "오더 수정" 줄)
  const season = useStore((s) => s.season);
  useEffect(() => {
    if (visible && !daily && useUi.getState().orderBase?.season !== season) useUi.setState({ orderBase: { season, parts: teamParts(team) } });
  }, [visible, season, team]);
  const submit = () => {
    const base = useUi.getState().orderBase;
    if (base?.season === season) useUi.setState({ orderEdit: { season, from: base.parts, to: teamParts(team) } });
    playNext();
  };

  if (!visible) return null;
  const next = userMatch({ schedule, userId, phase, post }, day);
  const title = daily ? '오늘의 오더' : '개막전 오더';
  const opp = teams.find((t) => t.id === next?.oppId);
  const mgr = CHARACTERS.manager;

  const sheet = (
    <>
      <div className="flex shrink-0 items-center gap-2 px-2 pt-1.5">
        <span className="font-pixel-lg shrink-0 text-[18px] leading-tight text-hi" style={{ textShadow: '1px 1px 0 #0f1420' }}>
          {title}
        </span>
        {next && opp && (
          <span className="flex min-w-0 flex-1 items-center gap-1 text-[12px] text-white/75 mob:text-[13px]">
            <TeamDot team={opp} size={11} />
            <span className="truncate">
              vs {opp.city} {opp.name} · {next.isHome ? '홈' : '원정'}
            </span>
          </span>
        )}
        {!daily && (
          <button className="px-btn ml-auto shrink-0 !px-2 !py-0.5 text-[11px] mob:text-[12px]" data-testid="order-close" onClick={() => setOpen(false)}>
            구장 보기
          </button>
        )}
      </div>

      {!daily && (
      <div className="flex shrink-0 items-start gap-2 px-2 pt-2">
        <div className="shrink-0" style={{ boxShadow: `0 0 0 2px #0f1420, 0 0 0 3px ${team.color2}` }}>
          <PixelFace id={`char-${mgr.seed}`} color={team.color} color2={team.color2} size={48} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] leading-tight">
            {mgr.name} <span className="text-[11px] text-white/55">{mgr.title}</span>
          </div>
          {opening && (
            <div className="mt-1 bg-ink/70 px-2 py-1.5 text-[12px] leading-snug text-white mob:text-[13px]" style={{ boxShadow: 'inset 2px 0 0 #ffd84a' }}>
              “{opening}”
            </div>
          )}
        </div>
      </div>
      )}

      <WinChance fixable={issues.lineup + issues.pitchers > 0} label={daily ? '오늘 승리 확률' : '개막전 승리 확률'} />
      <TeamBar team={team} />
      <div className="shrink-0 px-1.5 pt-1.5">
        <TabBar
          tabs={[
            { id: 'lineup' as const, label: '타선', badge: mark(issues.lineup) },
            { id: 'pitchers' as const, label: '투수', badge: mark(issues.pitchers) },
          ]}
          value={seg}
          onChange={setSeg}
        />
      </div>

      <div className="flex min-h-0 flex-1 flex-col">{seg === 'lineup' ? <LineupTab order /> : <PitchersTab order />}</div>

      <div className="flex shrink-0 items-stretch gap-2 px-2 pt-1.5 pb-2">
        <AutoButton order className="min-h-11 flex-1 text-[12px] mob:text-[13px]" />
        {daily ? (
          <button className="px-btn primary min-h-11 flex-[1.8] text-[15px]" data-testid="daily-close" onClick={() => setOpen(false)}>
            닫기
          </button>
        ) : (
          <button className="px-btn primary min-h-11 flex-[1.8] text-[15px]" data-sfx="none" data-testid="order-submit" onClick={submit}>
            오더 제출 ▶
          </button>
        )}
      </div>
    </>
  );

  if (mobile) {
    return (
      <div className="anim-fade fixed inset-0 z-[35] flex h-[100dvh] flex-col bg-panel font-pixel text-[12px] select-none" style={safe} role="dialog" aria-label={title} data-testid="order-sheet">
        {sheet}
      </div>
    );
  }
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-ink/70 p-3" role="dialog" aria-label={title} data-testid="order-sheet">
      <div className="px-panel anim-pop flex h-full max-h-[720px] w-full max-w-[560px] flex-col">{sheet}</div>
    </div>
  );
}
