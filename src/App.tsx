import { useLayoutEffect } from 'react';
import { useStore } from './store';
import TopBar from './components/TopBar';
import LeftPanel from './components/LeftPanel';
import RightPanel from './components/RightPanel';
import StadiumView from './components/StadiumView';
import BottomBar from './components/BottomBar';
import SeasonEnd from './components/SeasonEnd';
import DraftScreen from './components/DraftScreen';
import GameOver from './components/GameOver';
import { CampaignSheet } from './components/Campaign';
import Toast from './components/Toast';
import MobileShell from './components/layout/MobileShell';
import { useLayout } from './components/layout/useLayout';
import { useUi } from './components/layout/uiStore';
import { useSfx } from './components/useSfx';

/** 시즌 사이의 전체 화면들: 결산 → 드래프트, 또는 연고 이전 */
function PhaseScreens() {
  // 마지막 경기 요약을 닫은 뒤에 띄운다
  const idle = useStore((s) => !s.summary && !s.playback);
  const phase = useStore((s) => s.phase);
  const draftPeek = useUi((s) => s.draftPeek);
  if (!idle) return null;
  if (phase === 'ended') return <SeasonEnd />;
  if (phase === 'over') return <GameOver />;
  if (phase === 'draft' && !draftPeek) return <DraftScreen />;
  return null;
}

export default function App() {
  const layout = useLayout();
  useSfx();

  // CSS 의 mob: 변형과 모바일 글자 하한이 이 속성을 본다
  useLayoutEffect(() => {
    document.documentElement.dataset.layout = layout;
  }, [layout]);

  if (layout !== 'desktop') {
    return (
      <>
        <MobileShell orientation={layout} />
        <CampaignSheet />
        <PhaseScreens />
        <Toast />
      </>
    );
  }

  return (
    <div className="flex h-[100dvh] flex-col gap-[6px] overflow-hidden bg-[#141a29] p-[6px] font-pixel text-[12px] select-none">
      <TopBar />
      <div className="flex min-h-0 flex-1 gap-[6px]">
        <div className="w-[300px] shrink-0 max-[1279px]:w-[clamp(256px,23.4vw,300px)]">
          <LeftPanel />
        </div>
        <div className="relative min-w-0 flex-1">
          <div className="absolute inset-0">
            <StadiumView />
          </div>
        </div>
        <div className="w-[330px] shrink-0 max-[1279px]:w-[clamp(280px,25.8vw,330px)]">
          <RightPanel />
        </div>
      </div>
      <BottomBar />
      <CampaignSheet />
      <PhaseScreens />
      <Toast />
    </div>
  );
}
