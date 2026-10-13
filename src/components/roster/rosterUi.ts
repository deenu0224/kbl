import { create } from 'zustand';
import { useEffect, useMemo } from 'react';
import { positionReport, rankMap, type PosRow } from '../../game/analysis';
import { pickCore, useCore, useStore } from '../../store';

export type OfficeView = 'diag' | 'table' | 'depth' | 'salary';

interface RosterUi {
  office: OfficeView | null; // 프런트 오피스 전체 화면 (null = 닫힘)
  seen: { key: string; ranks: Record<string, number> } | null; // 다이아몬드가 마지막으로 보여 준 순위
  flash: string[]; // 방금 순위가 오른 칸 (잠깐 초록)
  openOffice(v?: OfficeView): void;
  close(): void;
}

export const useRosterUi = create<RosterUi>()((set) => ({
  office: null,
  seen: null,
  flash: [],
  openOffice: (v = 'diag') => set({ office: v }),
  close: () => set({ office: null }),
}));

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
  if (s.season !== p.season || s.seed !== p.seed || s.phase !== p.phase || !s.campaign.posRank0) markBaseline();
});

const FLASH_MS = 2400;
let flashTimer: ReturnType<typeof setTimeout> | undefined;

/** 순위가 오른 칸을 잠깐 번쩍이게 한다. 다이아몬드(미니·전체)가 같이 쓴다 */
export function useRankFlash(rows: PosRow[]): string[] {
  const key = useStore((s) => `${s.seed}/${s.season}`);
  const flash = useRosterUi((s) => s.flash);
  useEffect(() => {
    const now = rankMap(rows);
    const seen = useRosterUi.getState().seen;
    if (seen && seen.key === key) {
      const up = Object.keys(now).filter((k) => now[k] < (seen.ranks[k] ?? now[k]));
      const same = Object.keys(now).every((k) => now[k] === seen.ranks[k]);
      if (same) return;
      useRosterUi.setState({ seen: { key, ranks: now }, ...(up.length ? { flash: up } : {}) });
      if (up.length) {
        clearTimeout(flashTimer);
        flashTimer = setTimeout(() => useRosterUi.setState({ flash: [] }), FLASH_MS);
      }
    } else useRosterUi.setState({ seen: { key, ranks: now } });
  }, [rows, key]);
  return flash;
}
