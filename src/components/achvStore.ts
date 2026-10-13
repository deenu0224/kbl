import { create } from 'zustand';
import type { Core } from '../game/types';
import { ACHV_KEY, achvStep, emptyAchv, parseAchv, type AchvSave } from '../game/achievements';
import { ACHV_LIST } from '../game/achievementList';
import { pickCore, useStore } from '../store';
import { track } from '../analytics';

function load(): AchvSave {
  try {
    return parseAchv(localStorage.getItem(ACHV_KEY));
  } catch {
    return emptyAchv();
  }
}

interface AchvState {
  save: AchvSave; // 세이브와 독립된 localStorage 키 — 새로하기·세이브 지우기에도 남는다 (명예의 전당과 같은 방식)
  open: boolean; // 도전과제 화면
  queue: string[][]; // 알림 대기열: 한 번에 달성한 묶음 단위
  setOpen(v: boolean): void;
  shift(): void; // 맨 앞 알림을 내린다
}
export const useAchv = create<AchvState>()((set) => ({
  save: load(),
  open: false,
  queue: [],
  setOpen: (open) => set({ open }),
  shift: () => set((s) => ({ queue: s.queue.slice(1) })),
}));

function put(save: AchvSave): void {
  useAchv.setState({ save });
  try {
    localStorage.setItem(ACHV_KEY, JSON.stringify(save));
  } catch {
    /* 저장 불가 환경에서는 이번 세션만 */
  }
}

export function clearAchv(): void {
  put(emptyAchv());
  useAchv.setState({ queue: [] });
}

const today = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** 스토어 변화를 보고 도전과제를 판정한다 (main.tsx 에서 한 번). 게임 상태는 읽기만 한다 */
export function initAchv(): void {
  const see = (prev: Core | null, core: Core, reports: Parameters<typeof achvStep>[4]): void => {
    const r = achvStep(ACHV_LIST, useAchv.getState().save, prev, core, reports, today());
    if (r.save !== useAchv.getState().save) put(r.save);
    if (!r.gained.length) return;
    useAchv.setState((s) => ({ queue: [...s.queue, r.gained] }));
    track('achv'); // 개별 id 는 보내지 않는다
  };
  // 이어할 세이브가 있으면 지금 상태로 판정되는 것을 한 번 훑는다 (알림 없이 기록만)
  if (useStore.getState().campaign.history.length || useStore.getState().day > 0) {
    see(null, pickCore(useStore.getState()), []);
    useAchv.setState({ queue: [] });
  }
  useStore.subscribe((s, p) => {
    // 경기는 결과가 확정될 때(하이라이트가 끝나 요약이 뜰 때) 한 번에 본다
    const reports = s.summary && s.summary !== p.summary ? s.summary : [];
    if (!reports.length && s.teams === p.teams && s.campaign === p.campaign && s.finance === p.finance && s.facilities === p.facilities && s.phase === p.phase && s.draft === p.draft && s.seed === p.seed && s.day === p.day) return;
    see(pickCore(p), pickCore(s), reports);
  });
}
