import { useEffect, useState } from 'react';
import { winChanceJob } from '../game/forecast';
import { pickCore, useStore, useUserTeam } from '../store';
import { chanceKey, useUi } from './layout/uiStore';

export const CHANCE_N = 1200; // 화면용 표본 수 (표준오차 약 1.4%p)
const CHANCE_CHUNK = 100; // 한 번에 돌리는 경기 수

/** 한가할 때 실행. 화면이 가려져(document.hidden) requestIdleCallback 이 안 불려도 setTimeout 이 대신 부른다 */
export function idle(fn: () => void): () => void {
  let done = false;
  const once = () => {
    if (done) return;
    done = true;
    cancel();
    fn();
  };
  const ric = typeof requestIdleCallback === 'function' ? requestIdleCallback(once, { timeout: 300 }) : null;
  const to = setTimeout(once, ric === null ? 30 : 400);
  const cancel = () => {
    if (ric !== null) cancelIdleCallback(ric);
    clearTimeout(to);
  };
  return () => {
    done = true;
    cancel();
  };
}

/**
 * 다음 유저 경기의 승리 확률(%). 계산 전에는 null. 편성·경기일이 바뀌면 다시 계산하고 그동안은 이전 값을 둔다.
 * 계산한 값은 uiStore.chances 에 적어 둔다 (경기 요약의 "경기 전 44% → 승리").
 */
export function useWinChance(on = true): number | null {
  const team = useUserTeam();
  const day = useStore((s) => s.day);
  const phase = useStore((s) => s.phase);
  const busy = useStore((s) => !!s.playback);
  const [pct, setPct] = useState<number | null>(null);
  const live = on && !busy && (phase === 'season' || phase === 'post');
  useEffect(() => {
    if (!live) return;
    const core = pickCore(useStore.getState());
    if (core.phase === 'season' && core.day >= core.schedule.length) return;
    const job = winChanceJob(core, CHANCE_N);
    let cancel = () => {};
    const run = () => {
      const r = job(CHANCE_CHUNK);
      if (r === null) return void (cancel = idle(run));
      const v = Math.round(r * 100);
      setPct(v);
      useUi.getState().setChance(chanceKey(core), v);
    };
    cancel = idle(run);
    return () => cancel();
  }, [team, day, phase, live]);
  return pct;
}
