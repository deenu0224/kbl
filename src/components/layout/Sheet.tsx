import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * 모바일 바텀 시트. 바깥(어두운 배경)을 탭하거나 손잡이를 아래로 끌면 닫힌다.
 * 내용이 길면 시트 안에서 세로 스크롤.
 */
export default function Sheet({ onClose, children, label }: { onClose: () => void; children: ReactNode; label?: string }) {
  const [dy, setDy] = useState(0);
  const start = useRef<number | null>(null);
  const body = useRef<HTMLDivElement | null>(null);

  // 뒤로가기(안드로이드)·Esc 로도 닫히게
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const onStart = (y: number) => {
    // 내용이 스크롤된 상태면 끌어내리기 대신 스크롤
    if ((body.current?.scrollTop ?? 0) > 0) return;
    start.current = y;
  };
  const onMove = (y: number) => {
    if (start.current == null) return;
    setDy(Math.max(0, y - start.current));
  };
  const onEnd = () => {
    if (start.current == null) return;
    start.current = null;
    if (dy > 70) onClose();
    else setDy(0);
  };

  return (
    <div className="fixed inset-0 z-40 flex flex-col justify-end" role="dialog" aria-label={label}>
      <div className="anim-fade absolute inset-0 bg-ink/65" onClick={onClose} />
      <div
        className="anim-sheet relative mx-auto flex max-h-[88dvh] w-full max-w-[520px] flex-col bg-panel"
        style={{
          transform: dy ? `translateY(${dy}px)` : undefined,
          boxShadow: '0 -2px 0 0 #0f1420, inset 0 2px 0 0 rgba(255,255,255,.08)',
          paddingBottom: 'env(safe-area-inset-bottom)',
          paddingLeft: 'env(safe-area-inset-left)',
          paddingRight: 'env(safe-area-inset-right)',
        }}
        onTouchStart={(e) => onStart(e.touches[0].clientY)}
        onTouchMove={(e) => onMove(e.touches[0].clientY)}
        onTouchEnd={onEnd}
        onTouchCancel={onEnd}
      >
        <button className="flex h-6 w-full shrink-0 cursor-pointer items-center justify-center" data-testid="sheet-handle" onClick={onClose} aria-label="닫기">
          <span className="h-[4px] w-12 bg-white/30" />
        </button>
        <div ref={body} className="px-scroll min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {children}
        </div>
      </div>
    </div>
  );
}
