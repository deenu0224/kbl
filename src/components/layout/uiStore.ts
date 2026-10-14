import { create } from 'zustand';
import type { TeamParts } from '../../game/ratings';

/** 모바일 하단 탭 5개 */
export type MobileTab = 'home' | 'roster' | 'market' | 'league' | 'club';
/** 선수단 화면의 세 보기: 야수(다이아몬드) · 타순 · 투수 */
export type SquadView = 'field' | 'order' | 'arms';
export type ClubSub = 'finance' | 'stadium' | 'news';
export type Screen = 'title' | 'game';
/** 구장에서 연 시트: 시설 셋 또는 티켓 가격 */
export type FacSheet = 'seats' | 'food' | 'training' | 'ticket';

export const SAVE_KEY = 'kbl-save-v1';
function hadSave(): boolean {
  try {
    return !!localStorage.getItem(SAVE_KEY);
  } catch {
    return false;
  }
}
const FAST_KEY = 'kbl-fast-v1';
/** 이번 시즌의 가을야구 보기 속도 (선택하지 않았으면 천천히) */
export function postViewOf(st: { postView: { at: string; v: PostView } | null }, core: { seed: number; season: number }): PostView {
  return st.postView?.at === postViewKey(core) ? st.postView.v : 'slow';
}
/** 이 경기 하이라이트를 빠르게 넘기는가: 가을야구 경기는 가을야구 보기 속도, 그 밖에는 설정의 '빠르게' */
export function fastFor(st: { fast: boolean; postView: { at: string; v: PostView } | null }, core: { seed: number; season: number }, post: boolean): boolean {
  return post ? postViewOf(st, core) === 'fast' : st.fast;
}
function loadFast(): boolean {
  try {
    return localStorage.getItem(FAST_KEY) === '1';
  } catch {
    return false;
  }
}
export type LeagueSub = 'table' | 'leaders' | 'bracket';

/** 가을야구 보기 속도: 천천히(장면 더 많이·더 길게) / 빨리(설정의 '빠르게'와 같다). 시즌마다 처음엔 천천히 */
export type PostView = 'slow' | 'fast';
const POSTVIEW_KEY = 'kbl-postview-v1';
function loadPostView(): { at: string; v: PostView } | null {
  try {
    const v = JSON.parse(localStorage.getItem(POSTVIEW_KEY) ?? 'null');
    return v && typeof v.at === 'string' && (v.v === 'slow' || v.v === 'fast') ? v : null;
  } catch {
    return null;
  }
}
/** 시즌 열쇠 (리그 시드 + 시즌): 이 열쇠가 바뀌면 선택이 처음(천천히)으로 돌아간다 */
export const postViewKey = (s: { seed: number; season: number }) => `${s.seed}/${s.season}`;

export type TipId = 'market' | 'stadium' | 'finance';
export const chanceKey = (s: { seed: number; season: number; phase: string; day: number }) => `${s.seed}/${s.season}/${s.phase}/${s.day}`;

const TIPS_KEY = 'kbl-tips-v1';
function loadTips(): Partial<Record<TipId, boolean>> {
  try {
    return JSON.parse(localStorage.getItem(TIPS_KEY) ?? '{}') ?? {};
  } catch {
    return {};
  }
}

const TODO_KEY = 'kbl-todo-dismissed-v1';
function loadDismissed(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(TODO_KEY) ?? '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

interface UiState {
  dismissed: string[]; // [×]로 닫은 "할 일" id (확인만 하면 되는 항목, localStorage 유지)
  dismissTodo(id: string): void;
  screen: Screen; // 앱을 열면 항상 초기 화면부터
  hasSave: boolean; // 이어할 세이브가 있는가 (초기 화면의 이어하기)
  settingsOpen: boolean;
  facSheet: FacSheet | null;
  fast: boolean; // 하이라이트 빠르게 (이벤트당 대기 절반)
  setScreen(s: Screen): void;
  setSettingsOpen(v: boolean): void;
  setFacSheet(v: FacSheet | null): void;
  setFast(v: boolean): void;
  tab: MobileTab;
  squadView: SquadView;
  squadOpen: boolean; // 데스크톱: 선수단 화면 모달 (모바일은 선수단 탭이 곧 그 화면)
  clubSub: ClubSub;
  topOpen: boolean; // 컴팩트 상단바 상세 펼침
  leagueSub: LeagueSub; // 리그 탭 서브뷰 (데스크톱·모바일 공용)
  campaignOpen: boolean; // 캠페인 시트
  eventHidden: string | null; // 잠시 접어 둔 이벤트 카드 id (선수단을 살펴보고 다시 연다)
  draftPeek: boolean; // 드래프트 중 구단 화면 살펴보기
  orderOpen: boolean; // 개막전 오더지 (시즌이 바뀌면 다시 열린다)
  orderBase: { season: number; parts: TeamParts } | null; // 오더지를 처음 열었을 때의 전력
  orderEdit: { season: number; from: TeamParts; to: TeamParts } | null; // 제출 시점과의 차이 (개막전 요약의 "오더 수정" 줄)
  chances: Record<string, number>; // 경기 전 승리 확률(%) — 키는 chanceKey(). 경기 요약의 "경기 전 44% → 승리"
  tips: Partial<Record<TipId, boolean>>; // 닫은 탭별 첫 만남 한 문장 (localStorage 유지)
  stadiumZoom: boolean; // 홈 구장: 확대(높이 맞춤) / 전체(폭 맞춤). 구장이 다시 마운트돼도 유지한다
  stadiumPan: number; // 확대했을 때의 가로 위치 0~1 (0.5 = 가운데)
  setStadiumView(v: { zoom?: boolean; pan?: number }): void;
  setChance(key: string, pct: number): void;
  closeTip(id: TipId): void;
  setTab(tab: MobileTab): void;
  setSquadView(v: SquadView): void;
  openSquad(view?: SquadView): void; // 선수단 화면으로 (모바일: 선수단 탭, 데스크톱: 모달)
  closeSquad(): void;
  setClubSub(s: ClubSub): void;
  setTopOpen(v: boolean): void;
  setLeagueSub(s: LeagueSub): void;
  setCampaignOpen(v: boolean): void;
  setEventHidden(id: string | null): void;
  setDraftPeek(v: boolean): void;
  setOrderOpen(v: boolean): void;
  postView: { at: string; v: PostView } | null; // 가을야구 보기 속도 (시즌 열쇠와 함께 저장)
  setPostView(at: string, v: PostView): void;
  autumnOpen: boolean; // 정규시즌 마감 화면을 다시 열었다 (리그 탭 대진표의 [정규시즌 마감 다시 보기])
  setAutumnOpen(v: boolean): void;
}

/** 화면 전용 UI 상태 (tips 만 localStorage 에 저장). 게임 상태는 src/store.ts 에. */
export const useUi = create<UiState>()((set) => ({
  screen: 'title',
  hasSave: hadSave(),
  settingsOpen: false,
  facSheet: null,
  fast: loadFast(),
  setScreen: (screen) => set({ screen, topOpen: false, facSheet: null }),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  setFacSheet: (facSheet) => set({ facSheet }),
  setFast: (fast) => {
    try {
      localStorage.setItem(FAST_KEY, fast ? '1' : '0');
    } catch {
      /* 이번 세션만 */
    }
    set({ fast });
  },
  tab: 'home',
  squadView: 'field',
  squadOpen: false,
  clubSub: 'finance',
  topOpen: false,
  leagueSub: 'table',
  campaignOpen: false,
  eventHidden: null,
  draftPeek: false,
  orderOpen: true,
  autumnOpen: false,
  postView: loadPostView(),
  setPostView: (at, v) => {
    try {
      localStorage.setItem(POSTVIEW_KEY, JSON.stringify({ at, v }));
    } catch {
      /* 이번 세션만 */
    }
    set({ postView: { at, v } });
  },
  setAutumnOpen: (autumnOpen) => set({ autumnOpen }),
  orderBase: null,
  orderEdit: null,
  chances: {},
  tips: loadTips(),
  dismissed: loadDismissed(),
  dismissTodo: (id) =>
    set((s) => {
      if (s.dismissed.includes(id)) return s;
      const dismissed = [...s.dismissed, id].slice(-60);
      try {
        localStorage.setItem(TODO_KEY, JSON.stringify(dismissed));
      } catch {
        /* 이번 세션만 */
      }
      return { dismissed };
    }),
  stadiumZoom: true,
  stadiumPan: 0.5,
  setStadiumView: (v) => set((s) => ({ stadiumZoom: v.zoom ?? s.stadiumZoom, stadiumPan: v.pan ?? s.stadiumPan })),
  setChance: (key, pct) =>
    set((s) => {
      if (s.chances[key] === pct) return s;
      const keys = Object.keys(s.chances).slice(-8);
      return { chances: { ...Object.fromEntries(keys.map((k) => [k, s.chances[k]])), [key]: pct } };
    }),
  closeTip: (id) =>
    set((s) => {
      const tips = { ...s.tips, [id]: true };
      try {
        localStorage.setItem(TIPS_KEY, JSON.stringify(tips));
      } catch {
        /* 저장 불가 환경에서는 이번 세션만 */
      }
      return { tips };
    }),
  setTab: (tab) => set({ tab }),
  setSquadView: (squadView) => set({ squadView }),
  openSquad: (view) => set((s) => ({ tab: 'roster', squadOpen: true, squadView: view ?? s.squadView })),
  closeSquad: () => set({ squadOpen: false }),
  setClubSub: (clubSub) => set({ clubSub }),
  setTopOpen: (topOpen) => set({ topOpen }),
  setLeagueSub: (leagueSub) => set({ leagueSub }),
  setCampaignOpen: (campaignOpen) => set({ campaignOpen }),
  setEventHidden: (eventHidden) => set({ eventHidden }),
  setDraftPeek: (draftPeek) => set({ draftPeek }),
  setOrderOpen: (orderOpen) => set({ orderOpen }),
}));
