import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import 'galmuri/dist/galmuri.css';
import './index.css';
import App from './App';
import { initAnalytics } from './analytics';
import { initUiScale } from './components/layout/uiScale';

initUiScale();
initAnalytics();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
