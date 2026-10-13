import { useEffect } from 'react';
import { play } from '../audio/sfx';
import { CHARACTERS } from '../game/story';
import { teamParts } from '../game/ratings';
import { useStore, userMatch, useUserTeam } from '../store';
import LineupEditor from './roster/LineupEditor';
import { useEditorUi } from './roster/editorOps';
import PixelFace from './PixelFace';
import { useIsMobile } from './layout/useLayout';
import { useUi } from './layout/uiStore';
import { TeamDot } from './ui';

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
  const uiOpen = useUi((s) => (opener ? s.orderOpen : s.dailyOpen));
  const setUiOpen = useUi((s) => (opener ? s.setOrderOpen : s.setDailyOpen));
  // 선수단 탭의 [오더 편집]·선수 카드에서 연 편집기 (경기가 없는 날에도 열린다)
  const editorOpen = useEditorUi((s) => s.open);
  const focus = useEditorUi((s) => s.focus);
  const setOpen = (v: boolean) => {
    setUiOpen(v);
    if (!v) useEditorUi.getState().close();
  };
  const playNext = useStore((s) => s.playNext);
  const opening = useStore((s) => s.campaign.opening);
  const schedule = useStore((s) => s.schedule);
  const userId = useStore((s) => s.userId);
  const teams = useStore((s) => s.teams);
  const team = useUserTeam();
  const mobile = useIsMobile();
  const visible = idleNow && ((show && uiOpen) || editorOpen);

  useEffect(() => {
    if (visible && !daily) play('event');
  }, [visible, daily]);
  // 경기가 진행되면 "오늘의 오더"는 닫힌다
  useEffect(() => {
    if (!show) useUi.setState({ dailyOpen: false });
    if (!idleNow) useEditorUi.getState().close();
  }, [show, idleNow]);
  // 처음 열었을 때의 전력을 적어 둔다 (경기 후 요약의 "오더 수정" 줄)
  const season = useStore((s) => s.season);
  useEffect(() => {
    if (visible && !daily && useUi.getState().orderBase?.season !== season) useUi.setState({ orderBase: { season, parts: teamParts(team) } });
  }, [visible, season, team]);
  const submit = () => {
    const base = useUi.getState().orderBase;
    if (base?.season === season) useUi.setState({ orderEdit: { season, from: base.parts, to: teamParts(team) } });
    useEditorUi.getState().close();
    playNext();
  };

  if (!visible) return null;
  const next = userMatch({ schedule, userId, phase, post }, day);
  const title = daily ? (playable ? '오늘의 오더' : '오더 편집') : '개막전 오더';
  const opp = teams.find((t) => t.id === next?.oppId);
  const mgr = CHARACTERS.manager;

  const top = (
    <>
      <div className="flex shrink-0 items-center gap-2 px-2 pt-1.5">
        <span className="font-pixel-lg shrink-0 text-[18px] leading-tight text-hi" style={{ textShadow: '1px 1px 0 #0f1420' }}>
          {title}
        </span>
        {playable && next && opp && (
          <span className="flex min-w-0 flex-1 items-center gap-1 text-[13px] text-white/75">
            <TeamDot team={opp} size={11} />
            <span className="truncate">
              vs {opp.city} {opp.name} · {next.isHome ? '홈' : '원정'}
            </span>
          </span>
        )}
        {!daily && (
          <button className="px-btn ml-auto shrink-0 !px-2 !py-0.5 text-[13px]" data-testid="order-close" onClick={() => setOpen(false)}>
            구장 보기
          </button>
        )}
      </div>
      {!daily && opening && (
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
  const action = daily ? (
    <button className="px-btn primary min-h-11 flex-[1.8] text-[15px]" data-testid="daily-close" onClick={() => setOpen(false)}>
      닫기
    </button>
  ) : (
    <button className="px-btn primary min-h-11 flex-[1.8] text-[15px]" data-sfx="none" data-testid="order-submit" onClick={submit}>
      오더 제출 ▶
    </button>
  );
  const sheet = <LineupEditor key={focus ?? ''} top={top} action={action} focus={focus} fixNote={!daily} chanceLabel={!playable ? null : daily ? '오늘 승리 확률' : '개막전 승리 확률'} />;

  if (mobile) {
    return (
      <div className="anim-fade fixed inset-0 z-[35] flex h-[100dvh] flex-col bg-panel font-pixel text-[12px] select-none" style={safe} role="dialog" aria-label={title} data-testid="order-sheet">
        {sheet}
      </div>
    );
  }
  return (
    <div className="fixed inset-0 z-[35] flex items-center justify-center bg-ink/70 p-3 font-pixel text-[12px] select-none" role="dialog" aria-label={title} data-testid="order-sheet">
      <div className="px-panel anim-pop flex h-full max-h-[860px] w-full max-w-[760px] flex-col">{sheet}</div>
    </div>
  );
}
