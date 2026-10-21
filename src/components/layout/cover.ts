import { useEffect } from 'react';
import { create } from 'zustand';

/**
 * 앱(폰 탭 화면)을 통째로 덮고 있는 화면 수: 개막전 오더지 · 경기 요약 · 결산 · 드래프트 · 가을야구 막 · 게임 오버.
 * 덮여 있으면 이적 창구를 이적 탭에 열지 않고 그 화면 위에 띄운다 (탭에 열면 덮개 밑이라 안 보였다 — 오더지에서 방출·영입이 안 되던 것).
 * 저장하지 않는다 (화면이 떠 있는 동안만의 상태)
 */
export const useCover = create<{ n: number }>()(() => ({ n: 0 }));

/** 이 화면이 앱을 덮는 동안 (on) 덮개로 센다 */
export function useCovering(on = true): void {
  useEffect(() => {
    if (!on) return;
    useCover.setState((s) => ({ n: s.n + 1 }));
    return () => useCover.setState((s) => ({ n: s.n - 1 }));
  }, [on]);
}
