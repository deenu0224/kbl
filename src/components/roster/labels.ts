import type { TeamParts } from '../../game/ratings';

export const PART_KO: Record<keyof TeamParts, string> = { bat: '타선', def: '수비', rot: '선발', pen: '불펜' };
/** 변화량 표기: +3 / −2 / 0 */
export const fmtDelta = (n: number): string => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '0');
