import { useEffect } from 'react';
import { create } from 'zustand';
import type { Core } from '../game/types';
import { HOF_KEY, emptyHof, parseHof, recordAwards, recordClub, syncHof, hofWorthy, type Hof, type HofEnd } from '../game/hof';
import { leagueAwards } from '../game/leaders';
import { pickCore, useStore } from '../store';
import { cardOf } from '../share/shareData';

function load(): Hof {
  try {
    return parseHof(localStorage.getItem(HOF_KEY));
  } catch {
    return emptyHof();
  }
}

/** 명예의 전당 (세이브와 독립된 localStorage 키 — 새로하기에도 남는다) */
export const useHof = create<{ hof: Hof }>()(() => ({ hof: load() }));

function put(hof: Hof): void {
  if (hof === useHof.getState().hof) return;
  useHof.setState({ hof });
  try {
    localStorage.setItem(HOF_KEY, JSON.stringify(hof));
  } catch {
    /* 저장 불가 환경에서는 이번 세션만 */
  }
}

const today = (): string => new Date().toISOString().slice(0, 10);

/** 지금 구단을 역대 구단에 적는다. 이미 끝난 이유가 적힌 구단(우승 엔딩·연고 이전)은 이유를 유지하고 숫자만 갱신 */
export function hofCloseClub(core: Core, end: HofEnd): void {
  if (!hofWorthy(core)) return;
  const hof = useHof.getState().hof;
  const prev = hof.clubs.find((c) => c.seed === core.seed);
  const kept = end === 'abandoned' && prev ? prev.end : end;
  put(recordClub(syncHof(hof, core), core, kept, today(), cardOf(core, kept === 'champion' ? 'champion' : kept === 'relocated' ? 'relocated' : 'season')));
}

export function clearHof(): void {
  put(emptyHof());
}

/** 스토어 변화를 보고 기록을 갱신한다 (App 에서 한 번) */
export function useHofSync(): void {
  useEffect(() => {
    put(syncHof(useHof.getState().hof, pickCore(useStore.getState())));
    return useStore.subscribe((s, p) => {
      if (s.campaign === p.campaign && s.phase === p.phase) return;
      const core = pickCore(s);
      let hof = syncHof(useHof.getState().hof, core);
      // 결산 시점: 시즌 기록이 한 줄 늘었다 → 리그 시상을 적는다
      if (s.seed === p.seed && s.campaign.history.length > p.campaign.history.length) hof = recordAwards(hof, core, leagueAwards(core));
      put(hof);
      if (s.seed !== p.seed) return;
      if (s.phase === 'over' && p.phase !== 'over') hofCloseClub(core, 'relocated');
      else if (s.campaign.ending && !p.campaign.ending) hofCloseClub(core, 'champion');
    });
  }, []);
}
