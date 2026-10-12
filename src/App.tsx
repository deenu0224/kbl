import { useStore } from './store';
import TopBar from './components/TopBar';
import LeftPanel from './components/LeftPanel';
import RightPanel from './components/RightPanel';
import StadiumView from './components/StadiumView';
import BottomBar from './components/BottomBar';
import SeasonEnd from './components/SeasonEnd';
import Toast from './components/Toast';

export default function App() {
  // 마지막 경기 요약을 닫은 뒤에 시즌 결산을 띄운다
  const showEnd = useStore((s) => s.phase === 'ended' && !s.summary && !s.playback);

  return (
    <div className="flex h-screen min-w-[1180px] flex-col gap-[6px] overflow-hidden bg-[#141a29] p-[6px] font-pixel text-[12px] select-none">
      <TopBar />
      <div className="flex min-h-0 flex-1 gap-[6px]">
        <div className="w-[300px] shrink-0">
          <LeftPanel />
        </div>
        <div className="relative min-w-0 flex-1">
          <div className="absolute inset-0">
            <StadiumView />
          </div>
        </div>
        <div className="w-[330px] shrink-0">
          <RightPanel />
        </div>
      </div>
      <BottomBar />
      {showEnd && <SeasonEnd />}
      <Toast />
    </div>
  );
}
