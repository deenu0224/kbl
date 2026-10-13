import { create } from 'zustand';
import { useMemo } from 'react';
import { positionReport, rankMap, type PosRow } from '../../game/analysis';
import { pickCore, useCore, useStore } from '../../store';
import type { LineupSnap } from './editorOps';

export type ListView = 'list' | 'salary';

interface RosterUi {
  list: ListView | null; // 명단 전체 화면 (null = 닫힘)
  hist: LineupSnap[]; // 되돌리기 스택: 다음 경기를 치르면 비운다
  openList(v?: ListView): void;
  close(): void;
  push(s: LineupSnap): void;
  pop(): LineupSnap | undefined;
}

export const useRosterUi = create<RosterUi>()((set, get) => ({
  list: null,
  hist: [],
  openList: (v = 'list') => set({ list: v }),
  close: () => set({ list: null }),
  push: (s) => set((st) => ({ hist: [...st.hist, s].slice(-30) })),
  pop: () => {
    const last = get().hist.at(-1);
    if (last) set((st) => ({ hist: st.hist.slice(0, -1) }));
    return last;
  },
}));

/** 순위 → 색: 1~2위 초록, 3~5위 중립, 6위 이하 빨강 */
export function rankTone(r: Pick<PosRow, 'rank' | 'of'>): 'good' | 'mid' | 'bad' {
  if (r.rank <= 2) return 'good';
  return r.rank >= r.of - 2 ? 'bad' : 'mid';
}

/** 팀 진단 (스토어의 현재 상태 기준) */
export function usePosReport(): PosRow[] {
  const core = useCore();
  return useMemo(() => positionReport(core), [core]);
}

// 시즌 개막 시점의 포지션 순위를 한 번 적어 둔다 ("8위 → 4위" 의 왼쪽 숫자). 새 게임·새 시즌이면 다시 적는다.
function markBaseline(): void {
  const s = useStore.getState();
  if (s.phase !== 'season' || s.playback) return;
  if (s.campaign.posRank0?.season === s.season) return;
  const ranks = rankMap(positionReport(pickCore(s)));
  useStore.setState({ campaign: { ...s.campaign, posRank0: { season: s.season, ranks } } });
}
markBaseline();
useStore.subscribe((s, p) => {
  // 경기가 진행됐거나 다른 게임이면 되돌릴 것이 없다
  if ((s.day !== p.day || s.phase !== p.phase || s.season !== p.season || s.seed !== p.seed) && useRosterUi.getState().hist.length) useRosterUi.setState({ hist: [] });
  if (s.season !== p.season || s.seed !== p.seed || s.phase !== p.phase || !s.campaign.posRank0) markBaseline();
});
