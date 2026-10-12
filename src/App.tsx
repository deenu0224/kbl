import { useLayoutEffect } from 'react';
import { useStore } from './store';
import TopBar from './components/TopBar';
import LeftPanel from './components/LeftPanel';
import RightPanel from './components/RightPanel';
import StadiumView from './components/StadiumView';
import BottomBar from './components/BottomBar';
import SeasonEnd from './components/SeasonEnd';
import Toast from './components/Toast';
import MobileShell from './components/layout/MobileShell';
import { useLayout } from './components/layout/useLayout';

export default function App() {
  // 마지막 경기 요약을 닫은 뒤에 시즌 결산을 띄운다
  const showEnd = useStore((s) => s.phase === 'ended' && !s.summary && !s.playback);
  const layout = useLayout();

  // CSS 의 mob: 변형과 모바일 글자 하한이 이 속성을 본다
  useLayoutEffect(() => {
    document.documentElement.dataset.layout = layout;
  }, [layout]);

  if (layout !== 'desktop') {
    return (
      <>
        <MobileShell orientation={layout} />
        {showEnd && <SeasonEnd />}
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
      {showEnd && <SeasonEnd />}
      <Toast />
    </div>
  );
}
