import { useEffect } from 'react';
import { setBgmMood, startBgm, type BgmMood } from '../audio/bgm';
import { useStore } from '../store';
import { useUi } from './layout/uiStore';

/** 지금 화면의 분위기: 평소 calm, 하이라이트 재생 중 game, 결산·드래프트와 야간 경기 요약 중 night */
function moodNow(): BgmMood {
  const s = useStore.getState();
  if (useUi.getState().screen === 'title') return 'calm';
  if (s.playback) return 'game';
  if (s.summary) return s.summary[s.summary.length - 1]?.night ? 'night' : 'calm';
  if (s.phase === 'ended' || s.phase === 'draft') return 'night';
  return 'calm';
}

/** 배경음악 연결 (App 에서 한 번): 첫 입력에서 시작하고, 화면에 따라 분위기를 바꾼다 */
export function useBgm(): void {
  useEffect(() => {
    const start = () => {
      startBgm();
      setBgmMood(moodNow());
      window.removeEventListener('pointerdown', start, true);
      window.removeEventListener('keydown', start, true);
    };
    window.addEventListener('pointerdown', start, true);
    window.addEventListener('keydown', start, true);
    const sync = () => setBgmMood(moodNow());
    const u1 = useStore.subscribe((s, p) => {
      if (s.playback !== p.playback || s.summary !== p.summary || s.phase !== p.phase) sync();
    });
    const u2 = useUi.subscribe((s, p) => {
      if (s.screen !== p.screen) sync();
    });
    return () => {
      window.removeEventListener('pointerdown', start, true);
      window.removeEventListener('keydown', start, true);
      u1();
      u2();
    };
  }, []);
}
