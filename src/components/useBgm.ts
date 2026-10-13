import { useEffect } from 'react';
import { isBgmRunning, setBgmMood, startBgm, type BgmMood } from '../audio/bgm';
import { unlock } from '../audio/sfx';
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
    // iOS Safari 는 pointerdown 을 사용자 입력으로 치지 않는다(touchend·click 에서만 소리가 풀린다).
    // 그래서 여러 입력에 걸어 두고, 실제로 재생 상태가 될 때까지 계속 시도한다.
    const EVENTS = ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown'] as const;
    const off = () => EVENTS.forEach((e) => window.removeEventListener(e, start, true));
    const start = () => {
      unlock();
      startBgm();
      setBgmMood(moodNow());
      if (isBgmRunning()) off();
    };
    EVENTS.forEach((e) => window.addEventListener(e, start, true));
    const sync = () => setBgmMood(moodNow());
    const u1 = useStore.subscribe((s, p) => {
      if (s.playback !== p.playback || s.summary !== p.summary || s.phase !== p.phase) sync();
    });
    const u2 = useUi.subscribe((s, p) => {
      if (s.screen !== p.screen) sync();
    });
    return () => {
      off();
      u1();
      u2();
    };
  }, []);
}
