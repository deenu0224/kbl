// 시즌 전환 노쇠 상수. 다른 모듈을 가져오지 않는다 (season.ts ↔ analysis.ts 가 서로 가져와서, 상수를 season.ts 에 두면 로드 순서에 따라 비어 있었다)
/** 능력치마다 [최소, 최대] 변화 (31세부터 주력·체력 −1 추가) · 33세 이상 급락 확률과 폭 */
export const DECAY = { a31: [-2, 0] as const, a33: [-4, 0] as const, a35: [-5, -1] as const, a37: [-7, -2] as const, cliffAge: 33, cliff: 0.15, cliffDrop: [3, 6] as const };
