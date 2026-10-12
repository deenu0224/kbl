import { create } from 'zustand';
import type { TeamParts } from '../../game/ratings';

/** 모바일 하단 탭 5개 */
export type MobileTab = 'roster' | 'market' | 'stadium' | 'league' | 'club';
export type RosterSub = 'lineup' | 'pitchers';
export type ClubSub = 'finance' | 'news';
export type LeagueSub = 'table' | 'leaders' | 'bracket';

interface UiState {
  tab: MobileTab;
  rosterSub: RosterSub;
  clubSub: ClubSub;
  topOpen: boolean; // 컴팩트 상단바 상세 펼침
  leagueSub: LeagueSub; // 리그 탭 서브뷰 (데스크톱·모바일 공용)
  campaignOpen: boolean; // 캠페인 시트
  eventHidden: string | null; // 잠시 접어 둔 이벤트 카드 id (선수단을 살펴보고 다시 연다)
  draftPeek: boolean; // 드래프트 중 구단 화면 살펴보기
  orderOpen: boolean; // 개막전 오더지 (시즌이 바뀌면 다시 열린다)
  orderBase: { season: number; parts: TeamParts } | null; // 오더지를 처음 열었을 때의 전력
  orderEdit: { season: number; from: TeamParts; to: TeamParts } | null; // 제출 시점과의 차이 (개막전 요약의 "오더 수정" 줄)
  setTab(tab: MobileTab): void;
  setRosterSub(s: RosterSub): void;
  setClubSub(s: ClubSub): void;
  setTopOpen(v: boolean): void;
  setLeagueSub(s: LeagueSub): void;
  setCampaignOpen(v: boolean): void;
  setEventHidden(id: string | null): void;
  setDraftPeek(v: boolean): void;
  setOrderOpen(v: boolean): void;
}

/** 화면 전용 UI 상태 (저장하지 않음). 게임 상태는 src/store.ts 에. */
export const useUi = create<UiState>()((set) => ({
  tab: 'roster',
  rosterSub: 'lineup',
  clubSub: 'finance',
  topOpen: false,
  leagueSub: 'table',
  campaignOpen: false,
  eventHidden: null,
  draftPeek: false,
  orderOpen: true,
  orderBase: null,
  orderEdit: null,
  setTab: (tab) => set({ tab }),
  setRosterSub: (rosterSub) => set({ rosterSub }),
  setClubSub: (clubSub) => set({ clubSub }),
  setTopOpen: (topOpen) => set({ topOpen }),
  setLeagueSub: (leagueSub) => set({ leagueSub }),
  setCampaignOpen: (campaignOpen) => set({ campaignOpen }),
  setEventHidden: (eventHidden) => set({ eventHidden }),
  setDraftPeek: (draftPeek) => set({ draftPeek }),
  setOrderOpen: (orderOpen) => set({ orderOpen }),
}));
