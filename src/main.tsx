import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import 'galmuri/dist/galmuri.css';
import './index.css';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import { initAnalytics } from './analytics';
import { initUiScale } from './components/layout/uiScale';
import { initAchv } from './components/achvStore';
import { initHotkeys } from './components/hotkey';

initUiScale();
initAnalytics();
initAchv();
initHotkeys();
// 세이브를 브라우저가 임의로 지우지 않게 영구 저장을 요청한다 (거절돼도 그대로 동작. 홈 화면 앱이면 대개 허락된다)
void navigator.storage?.persist?.().catch(() => false);

// 뒤로 갔다 돌아왔을 때 중간에 멈춘 등장 애니메이션(반투명 창)을 풀어 준다
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  const root = document.documentElement;
  root.dataset.noanim = '1';
  setTimeout(() => delete root.dataset.noanim, 400);
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
