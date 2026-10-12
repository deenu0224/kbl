import { useSyncExternalStore } from 'react';

export type Layout = 'desktop' | 'portrait' | 'landscape';

// 데스크톱 3단 레이아웃은 폭 1100 · 높이 600 이상에서만. 그 외는 방향에 따라 모바일 레이아웃.
const DESKTOP_Q = '(min-width: 1100px) and (min-height: 600px)';
const PORTRAIT_Q = '(orientation: portrait)';

function read(): Layout {
  if (typeof window === 'undefined' || !window.matchMedia) return 'desktop';
  if (window.matchMedia(DESKTOP_Q).matches) return 'desktop';
  return window.matchMedia(PORTRAIT_Q).matches ? 'portrait' : 'landscape';
}

function subscribe(cb: () => void): () => void {
  const qs = [window.matchMedia(DESKTOP_Q), window.matchMedia(PORTRAIT_Q)];
  qs.forEach((q) => q.addEventListener('change', cb));
  window.addEventListener('resize', cb);
  return () => {
    qs.forEach((q) => q.removeEventListener('change', cb));
    window.removeEventListener('resize', cb);
  };
}

/** 현재 화면 레이아웃. matchMedia 기반이라 회전·창 크기 변경에 즉시 반응한다. */
export function useLayout(): Layout {
  return useSyncExternalStore(subscribe, read, () => 'desktop');
}

/** 모바일(세로·가로) 레이아웃인지 */
export function useIsMobile(): boolean {
  return useLayout() !== 'desktop';
}
