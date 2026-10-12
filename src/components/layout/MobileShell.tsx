import { useEffect } from 'react';
import type { HintTab } from '../../game/types';
import { useStore } from '../../store';
import { MobileActionBar } from '../BottomBar';
import GameSummary from '../GameSummary';
import { LineupTab, MarketTab, PitchersTab } from '../LeftPanel';
import EventCardModal from '../EventCardModal';
import OrderSheet from '../OrderSheet';
import { FinanceTab, LeagueTab, NewsTab, StadiumTab, useHintTabs } from '../RightPanel';
import StadiumView from '../StadiumView';
import { MobileTopBar } from '../TopBar';
import { TabBar } from '../ui';
import MobileNav from './MobileNav';
import { useUi, type ClubSub, type RosterSub } from './uiStore';

const ROSTER_SUBS: { id: RosterSub; label: string }[] = [
  { id: 'lineup', label: '타선' },
  { id: 'pitchers', label: '투수' },
];
const CLUB_SUBS: { id: ClubSub; label: string }[] = [
  { id: 'finance', label: '재무' },
  { id: 'news', label: '뉴스' },
];

/** 현재 모바일 탭의 내용. 데스크톱 패널과 같은 탭 컴포넌트를 그대로 쓴다. */
function MobilePanel() {
  const tab = useUi((s) => s.tab);
  const rosterSub = useUi((s) => s.rosterSub);
  const clubSub = useUi((s) => s.clubSub);
  const setRosterSub = useUi((s) => s.setRosterSub);
  const setClubSub = useUi((s) => s.setClubSub);
  const playback = useStore((s) => !!s.playback);
  const clearHint = useStore((s) => s.clearHint);
  // 지금 보이는 하위 탭의 배지는 지운다
  const active: HintTab = tab === 'roster' ? rosterSub : tab === 'club' ? clubSub : tab;
  const rosterTabs = useHintTabs(ROSTER_SUBS, tab === 'roster' ? rosterSub : null);
  const clubTabs = useHintTabs(CLUB_SUBS, tab === 'club' ? clubSub : null);
  const activeN = useStore((s) => s.campaign.hints?.[active] ?? 0);
  useEffect(() => {
    if (activeN > 0) clearHint(active);
  }, [active, activeN, clearHint]);

  return (
    // 하이라이트 재생 중엔 야구장에 집중하도록 패널을 반투명하게
    <div className={`px-panel flex min-h-0 flex-1 flex-col transition-opacity ${playback ? 'opacity-35' : ''}`}>
      {tab === 'roster' && (
        <>
          <TabBar tabs={rosterTabs} value={rosterSub} onChange={setRosterSub} />
          {rosterSub === 'lineup' ? <LineupTab /> : <PitchersTab />}
        </>
      )}
      {tab === 'market' && <MarketTab />}
      {tab === 'stadium' && <StadiumTab />}
      {tab === 'league' && <LeagueTab />}
      {tab === 'club' && (
        <>
          <TabBar tabs={clubTabs} value={clubSub} onChange={setClubSub} />
          {clubSub === 'finance' ? <FinanceTab /> : <NewsTab />}
        </>
      )}
    </div>
  );
}

const safe = {
  paddingTop: 'max(env(safe-area-inset-top), 4px)',
  paddingBottom: 'max(env(safe-area-inset-bottom), 4px)',
  paddingLeft: 'max(env(safe-area-inset-left), 4px)',
  paddingRight: 'max(env(safe-area-inset-right), 4px)',
};

/**
 * 모바일 레이아웃.
 * - portrait: 상단바 / 야구장(폭 100%) / 패널 / 액션 바 / 하단 탭
 * - landscape: [상단바 · 야구장 · 액션 바] | [탭 · 패널]
 */
export default function MobileShell({ orientation }: { orientation: 'portrait' | 'landscape' }) {
  if (orientation === 'landscape') {
    return (
      <div className="flex h-[100dvh] gap-[4px] overflow-hidden bg-[#141a29] font-pixel text-[12px] select-none" style={safe}>
        <div className="flex min-w-0 flex-1 flex-col gap-[4px]">
          <MobileTopBar />
          <div className="relative min-h-0 flex-1">
            <div className="absolute inset-0">
              <StadiumView />
            </div>
          </div>
          <MobileActionBar />
        </div>
        <div className="flex w-[clamp(300px,44vw,440px)] shrink-0 flex-col">
          <MobileNav placement="top" />
          <MobilePanel />
        </div>
        <GameSummary sheet />
        <EventCardModal sheet />
        <OrderSheet />
      </div>
    );
  }
  return (
    <div className="flex h-[100dvh] flex-col gap-[4px] overflow-hidden bg-[#141a29] font-pixel text-[12px] select-none" style={safe}>
      <MobileTopBar />
      {/* 폭 100% 기준 640:420, 키 작은 폰에선 높이 34dvh 까지만 (가운데 정렬) */}
      <div className="relative w-full shrink-0" style={{ height: 'min(calc((100vw - 8px) * 420 / 640), 34dvh)' }}>
        <div className="absolute inset-0">
          <StadiumView />
        </div>
      </div>
      <MobilePanel />
      <MobileActionBar />
      <MobileNav placement="bottom" />
      <GameSummary sheet />
      <EventCardModal sheet />
        <OrderSheet />
    </div>
  );
}
