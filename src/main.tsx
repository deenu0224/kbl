import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import 'galmuri/dist/galmuri.css';
import './index.css';
import App from './App';
import { initAnalytics } from './analytics';
import { initUiScale } from './components/layout/uiScale';
import { initAchv } from './components/achvStore';

initUiScale();
initAnalytics();
initAchv();

// 뒤로 갔다 돌아왔을 때 중간에 멈춘 등장 애니메이션(반투명 창)을 풀어 준다
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  const root = document.documentElement;
  root.dataset.noanim = '1';
  setTimeout(() => delete root.dataset.noanim, 400);
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
