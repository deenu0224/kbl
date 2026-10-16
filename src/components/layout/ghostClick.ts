import { useRef, type MouseEvent } from 'react';

// 안드로이드 크롬의 "유령 클릭": 손가락을 떼는 순간(pointerup)에 시트·대화 상자를 열면, 같은 탭의 합성 click 이
// 그 사이 그려진 새 화면(어두운 배경·버튼)에 떨어져 열자마자 닫히거나 엉뚱한 버튼이 눌린다 (선수단 칸 탭).
// 아이폰·맥은 click 대상이 달라 괜찮다. 터치를 뗀 직후에 열린 경우에만, 그 뒤 첫 click 하나를 삼킨다.
export const GHOST_MS = 400; // 열린 뒤 이 안에 오는 click 만 유령으로 본다
const ARM_MS = 120; // 터치를 뗀 지 이 안에 열렸으면 유령 click 이 따라온다

let lastTouchUp = -1e9;
if (typeof window !== 'undefined') {
  window.addEventListener('pointerup', (e) => e.pointerType === 'touch' && (lastTouchUp = performance.now()), { capture: true, passive: true });
}

/** 시트·대화 상자 맨 바깥 요소의 onClickCapture 로 건다 */
export function useGhostGuard(): (e: MouseEvent) => void {
  const at = useRef<{ opened: number; armed: boolean } | null>(null);
  if (!at.current) {
    const now = performance.now();
    at.current = { opened: now, armed: now - lastTouchUp < ARM_MS };
  }
  return (e) => {
    const s = at.current!;
    if (!s.armed) return;
    s.armed = false; // 하나만
    if (performance.now() - s.opened < GHOST_MS) {
      e.preventDefault();
      e.stopPropagation();
    }
  };
}
