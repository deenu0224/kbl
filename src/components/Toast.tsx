import { useEffect, useState } from 'react';
import { useStore } from '../store';

const BG = { good: '#2f9e4f', bad: '#c0392b', info: '#3d4c75' } as const;

/** 액션 결과/오류 알림. key 가 바뀔 때마다 다시 뜬다. */
export default function Toast() {
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
    <div className="pointer-events-none fixed inset-x-0 top-14 z-[60] flex justify-center">
      <div
        key={toast.key}
        className="anim-pop px-4 py-1.5 text-[13px] text-white"
        style={{ background: BG[toast.tone], boxShadow: '0 0 0 2px #0f1420, 0 4px 0 rgba(0,0,0,.3)' }}
      >
        {toast.tone === 'bad' ? '✕ ' : toast.tone === 'good' ? '✓ ' : ''}
        {toast.text}
      </div>
    </div>
  );
}
