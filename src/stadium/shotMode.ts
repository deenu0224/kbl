// 화면 검증 도구(scripts/screens) 전용 고정값. 자동화 브라우저(navigator.webdriver)에서만 읽는다.
//   ?fxT=2.5  우승 세리머니의 경과 시간을 2.5초로 고정하고, 세리머니를 자동으로 넘기지 않는다 (같은 장면을 찍기 위해)
function readFxT(): number | null {
  try {
    if (typeof window === 'undefined' || !navigator.webdriver) return null;
    const v = new URLSearchParams(window.location.search).get('fxT');
    const n = v === null || v === '' ? NaN : Number(v);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}
export const SHOT_FXT = readFxT();

/** 움직임 줄이기 설정 (prefers-reduced-motion) */
export function reducedMotion(): boolean {
  try {
    return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}
