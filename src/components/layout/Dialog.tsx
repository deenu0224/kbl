import { useEffect, type ReactNode } from 'react';
import Sheet from './Sheet';
import { useIsMobile } from './useLayout';

/** 공용 대화 상자: 데스크톱은 가운데 패널, 모바일은 바텀 시트. 바깥을 누르거나 Esc 로 닫힌다. */
export default function Dialog({ onClose, label, children, width = 560 }: { onClose: () => void; label?: string; children: ReactNode; width?: number }) {
  const mobile = useIsMobile();
  useEffect(() => {
    if (mobile) return; // Sheet 가 직접 처리
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mobile, onClose]);

  if (mobile) {
    return (
      <Sheet onClose={onClose} label={label}>
        {children}
      </Sheet>
    );
  }
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4" role="dialog" aria-label={label}>
      <div className="anim-fade absolute inset-0 bg-ink/70" onClick={onClose} />
      <div className="px-panel px-scroll relative flex max-h-full w-full flex-col overflow-y-auto p-3" style={{ maxWidth: width }}>
        {children}
        <div className="mt-2 flex justify-end">
          <button className="px-btn" onClick={onClose}>
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}
