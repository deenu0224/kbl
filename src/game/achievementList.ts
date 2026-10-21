import type { AchvDef } from './achievements';
import { LIST1 } from './achievementList1';
import { LIST2 } from './achievementList2';
import { LIST3 } from './achievementList3';

/** 도전과제 전체 목록 (화면에 보이는 순서: 첫걸음 · 경기 · 시즌 · 구단 경영 · 선수단 · 이야기 · 기행 · 누적) */
export const ACHV_LIST: AchvDef[] = [...LIST1, ...LIST2, ...LIST3];
export const ACHV_TOTAL = 207;
