/** 홈 화면 앱(설치된 웹앱)으로 열렸는가 */
export const installed = (): boolean => {
  try {
    return window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  } catch {
    return false;
  }
};
