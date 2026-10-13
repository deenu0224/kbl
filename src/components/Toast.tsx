import { useEffect, useState } from 'react';
import { useStore } from '../store';
import TransferDesk from './roster/TransferDesk';

const BG = { good: '#2f9e4f', bad: '#c0392b', info: '#3d4c75' } as const;

/** 액션 결과/오류 알림. key 가 바뀔 때마다 다시 뜬다. 모바일에선 캠페인 줄·드래프트 순서 띠를 가리지 않게 액션 바 바로 위에 띄운다. */
export default function Toast() {
  return (
    <>
      {/* 이적 창구는 어느 화면에서든 열린다 (두 레이아웃 모두에 항상 떠 있는 자리) */}
      <TransferDesk />
      <ToastBox />
    </>
  );
}

function ToastBox() {
  const toast = useStore((s) => s.toast);
  const [shownKey, setShownKey] = useState<number | null>(null);

  useEffect(() => {
    if (!toast) return;
    setShownKey(toast.key);
    const id = window.setTimeout(() => setShownKey(null), 2600);
    return () => window.clearTimeout(id);
  }, [toast]);

  if (!toast || shownKey !== toast.key) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-14 z-[60] flex justify-center px-3 mob:top-auto mob:bottom-[calc(env(safe-area-inset-bottom)+164px)] land:bottom-[calc(env(safe-area-inset-bottom)+60px)]">
      <div
        key={toast.key}
        className="anim-pop px-4 py-1.5 text-center text-[13px] text-white"
        style={{ background: BG[toast.tone], boxShadow: '0 0 0 2px #0f1420, 0 4px 0 rgba(0,0,0,.3)' }}
      >
        {toast.tone === 'bad' ? '✕ ' : toast.tone === 'good' ? '✓ ' : ''}
        {toast.text}
      </div>
    </div>
  );
}
