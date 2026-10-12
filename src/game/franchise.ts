// 프랜차이즈 스타 (LEVEL_DESIGN 7절): 유저 팀에서 5시즌 이상 뛴 star 60+ 선수.
import type { Player } from './types';

export const FRANCHISE_SEASONS = 5;
export const FRANCHISE_STAR = 60;

/** 이번 시즌이 팀에서 몇 번째 시즌인지 (since 가 없으면 창단 멤버 = 1시즌부터) */
export function seasonsWith(p: Player, season: number): number {
  return season - (p.since ?? 1) + 1;
}

export function isFranchise(p: Player, season: number): boolean {
  return p.star >= FRANCHISE_STAR && seasonsWith(p, season) >= FRANCHISE_SEASONS;
}
