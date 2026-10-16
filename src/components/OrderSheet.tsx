import { useEffect } from 'react';
import { play } from '../audio/sfx';
import { CHARACTERS } from '../game/story';
import { teamParts } from '../game/ratings';
import { useStore, userMatch, useUserTeam } from '../store';
import Squad from './roster/Squad';
import PixelFace from './PixelFace';
import { useIsMobile } from './layout/useLayout';
import { useUi } from './layout/uiStore';
import { TeamDot } from './ui';

// 새 시즌·새 게임의 개막전에는 오더지가 다시 첫 화면이 된다
useStore.subscribe((s, p) => {
  if (s.season !== p.season || s.seed !== p.seed) useUi.setState({ orderOpen: true, orderBase: null, orderEdit: null });
});

const safe = {
  paddingTop: 'max(var(--sat), 4px)',
  paddingBottom: 'max(env(safe-area-inset-bottom), 6px)',
  paddingLeft: 'max(env(safe-area-inset-left), 4px)',
  paddingRight: 'max(env(safe-area-inset-right), 4px)',
};

/**
 * 선수단 화면을 전체 화면으로 띄우는 두 경우.
 * - 개막전 오더: 시즌 첫 경기 전, 감독의 대사와 [오더 제출 ▶]을 얹은 선수단 화면이 첫 화면이 된다 (모바일은 하단 내비까지 덮는다).
 * - 데스크톱의 [선수단 열기]: 같은 화면이 가운데 큰 모달로 열린다 (모바일은 선수단 탭이 곧 그 화면이다).
 */
export default function OrderSheet() {
  const idleNow = useStore((s) => !s.campaign.event && !s.campaign.briefing && !s.summary && !s.playback);
  const opener = useStore((s) => s.phase === 'season' && s.day === 0 && s.schedule.length > 0);
  const phase = useStore((s) => s.phase);
  const post = useStore((s) => s.post);
  const day = useStore((s) => s.day);
  const orderOpen = useUi((s) => s.orderOpen);
  const squadOpen = useUi((s) => s.squadOpen);
  const opening = useStore((s) => s.campaign.opening);
  const playNext = useStore((s) => s.playNext);
  const schedule = useStore((s) => s.schedule);
  const userId = useStore((s) => s.userId);
  const teams = useStore((s) => s.teams);
  const season = useStore((s) => s.season);
  const team = useUserTeam();
  const mobile = useIsMobile();
  const order = idleNow && opener && orderOpen;
  const visible = order || (idleNow && !mobile && squadOpen);

  useEffect(() => {
    if (order) play('event');
  }, [order]);
  // 경기·사건이 시작되면 모달은 닫힌다
  useEffect(() => {
    if (!idleNow) useUi.setState({ squadOpen: false });
  }, [idleNow]);
  // 처음 열었을 때의 전력을 적어 둔다 (경기 후 요약의 "오더 수정" 줄)
  useEffect(() => {
    if (order && useUi.getState().orderBase?.season !== season) useUi.setState({ orderBase: { season, parts: teamParts(team) } });
  }, [order, season, team]);
  const submit = () => {
    const base = useUi.getState().orderBase;
    if (base?.season === season) useUi.setState({ orderEdit: { season, from: base.parts, to: teamParts(team) } });
    useUi.setState({ squadOpen: false });
    playNext();
  };
  const close = () => useUi.setState(order ? { orderOpen: false, squadOpen: false } : { squadOpen: false });

  if (!visible) return null;
  const next = userMatch({ schedule, userId, phase, post }, day);
  const title = order ? '개막전 오더' : '선수단';
  const opp = teams.find((t) => t.id === next?.oppId);
  const mgr = CHARACTERS.manager;

  const top = (
    <>
      <div className="flex shrink-0 items-center gap-2 px-2 pt-1.5">
        <span className="font-pixel-lg shrink-0 text-[18px] leading-tight text-hi" style={{ textShadow: '1px 1px 0 #0f1420' }}>
          {title}
        </span>
        <span className="flex min-w-0 flex-1 items-center gap-1 text-[13px] text-white/75">
          {next && opp && (
            <>
              <TeamDot team={opp} size={11} />
              <span className="truncate">
                vs {opp.city} {opp.name} · {next.isHome ? '홈' : '원정'}
              </span>
            </>
          )}
        </span>
        <button className="px-btn shrink-0 !px-2 !py-0.5 text-[13px] mob:min-h-9" data-testid="order-close" onClick={close}>
          {order ? '구장 보기' : '닫기 ✕'}
        </button>
      </div>
      {order && opening && (
        <div className="flex shrink-0 items-center gap-2 px-2 pt-1.5">
          <div className="shrink-0" style={{ boxShadow: `0 0 0 2px #0f1420, 0 0 0 3px ${team.color2}` }}>
            <PixelFace id={`char-${mgr.seed}`} color={team.color} color2={team.color2} size={36} />
          </div>
          <div className="min-w-0 flex-1 bg-ink/70 px-2 py-1 text-[13px] leading-snug text-white" style={{ boxShadow: 'inset 2px 0 0 #ffd84a' }}>
            “{opening}”
          </div>
        </div>
      )}
    </>
  );
  const bottom = order ? (
    <div className="shrink-0 px-1.5 pt-1.5 pb-2">
      <button className="px-btn primary min-h-11 w-full text-[15px]" data-sfx="none" data-testid="order-submit" onClick={submit} data-hotkey="2" title="Enter · Space">
        오더 제출 ▶
      </button>
    </div>
  ) : (
    <div className="h-1.5 shrink-0" />
  );
  const sheet = <Squad top={top} bottom={bottom} fixNote={order} />;

  if (mobile) {
    return (
      <div className="fixed inset-0 z-[35] flex h-[calc(var(--dvh)*100)] flex-col bg-panel font-pixel text-[12px] select-none" style={safe} role="dialog" aria-label={title} data-testid="order-sheet">
        {sheet}
      </div>
    );
  }
  return (
    <div className="fixed inset-0 z-[35] flex items-center justify-center bg-ink/70 p-3 font-pixel text-[12px] select-none" role="dialog" aria-label={title} data-testid="order-sheet">
      <div className="absolute inset-0" onClick={order ? undefined : close} />
      <div className="px-panel anim-pop relative flex h-full max-h-[860px] w-full max-w-[760px] flex-col">{sheet}</div>
    </div>
  );
}
