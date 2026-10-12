import { create } from 'zustand';

/** 모바일 하단 탭 5개 */
export type MobileTab = 'roster' | 'market' | 'stadium' | 'league' | 'club';
export type RosterSub = 'lineup' | 'pitchers';
export type ClubSub = 'finance' | 'news';

interface UiState {
  tab: MobileTab;
  rosterSub: RosterSub;
  clubSub: ClubSub;
  topOpen: boolean; // 컴팩트 상단바 상세 펼침
  setTab(tab: MobileTab): void;
  setRosterSub(s: RosterSub): void;
  setClubSub(s: ClubSub): void;
  setTopOpen(v: boolean): void;
}

/** 모바일 전용 UI 상태 (저장하지 않음). 게임 상태는 src/store.ts 에. */
export const useUi = create<UiState>()((set) => ({
  tab: 'roster',
  rosterSub: 'lineup',
  clubSub: 'finance',
  topOpen: false,
  setTab: (tab) => set({ tab }),
  setRosterSub: (rosterSub) => set({ rosterSub }),
  setClubSub: (clubSub) => set({ clubSub }),
  setTopOpen: (topOpen) => set({ topOpen }),
}));
