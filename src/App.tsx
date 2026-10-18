import { useLayoutEffect } from 'react';
import WhatsNew from './components/WhatsNew';
import { useStore } from './store';
import TopBar from './components/TopBar';
import LeftPanel from './components/LeftPanel';
import RightPanel from './components/RightPanel';
import StadiumView from './components/StadiumView';
import BottomBar from './components/BottomBar';
import SeasonEnd from './components/SeasonEnd';
import AutumnIntro from './components/AutumnIntro';
import DraftScreen from './components/DraftScreen';
import GameOver from './components/GameOver';
import OrderSheet from './components/OrderSheet';
import { CampaignSheet } from './components/Campaign';
import BriefingSheet from './components/Briefing';
import Toast from './components/Toast';
import MobileShell from './components/layout/MobileShell';
import { useLayout } from './components/layout/useLayout';
import { useUi } from './components/layout/uiStore';
import { useSfx } from './components/useSfx';
import { useBgm } from './components/useBgm';
import { useHofSync } from './components/hofStore';
import { usePlaybackDriver } from './components/StadiumView';
import TransferDesk from './components/roster/TransferDesk';
import TitleScreen from './components/TitleScreen';
import Settings from './components/Settings';
import Achievements, { AchvToast } from './components/Achievements';

/** 시즌 사이의 전체 화면들: 결산 → 드래프트, 또는 연고 이전 */
function PhaseScreens() {
  // 마지막 경기 요약을 닫은 뒤에 띄운다
  const idle = useStore((s) => !s.summary && !s.playback);
  const phase = useStore((s) => s.phase);
  const draftPeek = useUi((s) => s.draftPeek);
  const intro = useStore((s) => !!s.post?.intro && (s.phase === 'post' || s.phase === 'ended'));
  const autumnOpen = useUi((s) => s.autumnOpen);
  if (!idle) return null;
  // 정규시즌 마감 화면: 가을야구 첫 경기 전 · 떨어졌으면 결산 전에 한 번 (리그 탭 대진표에서 다시 연다)
  if (intro || (autumnOpen && (phase === 'post' || phase === 'ended'))) return <AutumnIntro />;
  if (phase === 'ended') return <SeasonEnd />;
  if (phase === 'over') return <GameOver />;
  if (phase === 'draft' && !draftPeek) return <DraftScreen />;
  return null;
}

export default function App() {
  const layout = useLayout();
  useSfx();
  useBgm();
  useHofSync();
  usePlaybackDriver();
  const screen = useUi((s) => s.screen);

  // CSS 의 mob: 변형과 모바일 글자 하한이 이 속성을 본다
  useLayoutEffect(() => {
    document.documentElement.dataset.layout = layout;
  }, [layout]);

  // 앱을 열면 항상 초기 화면부터 (게임 화면은 그 뒤에)
  if (screen === 'title') {
    return (
      <>
        <TitleScreen />
        <Achievements />
        <Settings />
        <WhatsNew />
      </>
    );
  }

  if (layout !== 'desktop') {
    return (
      <>
        <MobileShell orientation={layout} />
        <TransferDesk tabbed />
        <BriefingSheet />
        <CampaignSheet />
        <PhaseScreens />
        <Settings />
        <WhatsNew />
        <Achievements />
        <Toast />
        <AchvToast />
      </>
    );
  }

  return (
    <div className="flex h-[calc(var(--dvh)*100)] flex-col gap-[6px] overflow-hidden bg-[#1b1a19] p-[6px] font-pixel text-[12px] select-none">
      <TopBar />
      <div className="flex min-h-0 flex-1 gap-[6px]">
        <div className="w-[300px] shrink-0 max-[1279px]:w-[clamp(256px,calc(var(--vw)*23.4),300px)]">
          <LeftPanel />
        </div>
        <div className="relative min-w-0 flex-1">
          <div className="absolute inset-0">
            <StadiumView />
          </div>
          {/* 야구장 그림은 비율이 고정이라, 오더지는 가운데 칸 전체 높이를 쓴다 */}
          <OrderSheet />
        </div>
        <div className="w-[330px] shrink-0 max-[1279px]:w-[clamp(280px,calc(var(--vw)*25.8),330px)]">
          <RightPanel />
        </div>
      </div>
      <BottomBar />
      <TransferDesk />
      <Settings />
      <WhatsNew />
      <BriefingSheet />
      <CampaignSheet />
      <PhaseScreens />
      <Achievements />
      <Toast />
      <AchvToast />
    </div>
  );
}
