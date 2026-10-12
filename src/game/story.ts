// 스토리 데이터: 전제·인물·대사·시즌 이름. 규칙은 docs/LEVEL_CONCEPT.md 7절, docs/LEVEL_DESIGN.md 0·6·7절.
// 대사 규칙: 한 번에 2문장 이하, 방법 지시 금지, 숫자 금지. 실존 구단·인물명 금지.
import type { CharId } from './types';

export interface Character {
  id: CharId;
  name: string; // 가명
  title: string; // 직함
  seed: number; // 픽셀 초상 시드
  trait: string; // 성격 한 줄 (UI 에 노출하지 않는다)
}

export const CHARACTERS: Record<CharId, Character> = {
  manager: { id: 'manager', name: '부성택', title: '감독', seed: 7101, trait: '유저의 옛 동료. 베테랑을 믿는다' },
  scout: { id: 'scout', name: '고만석', title: '스카우트 팀장', seed: 7102, trait: '30년 경력의 옛날 눈. 악의는 없고, 절반만 옳다' },
  marketing: { id: 'marketing', name: '한유라', title: '마케팅 팀장', seed: 7103, trait: '육지에서 내려온 유일한 낙관주의자' },
  farm: { id: 'farm', name: '현동수', title: '2군 코치', seed: 7104, trait: '지금 쓰면 망가지고, 안 쓰면 썩는다고 한다' },
  pitching: { id: 'pitching', name: '양기범', title: '투수 코치', seed: 7105, trait: '팔은 소모품이 아니라고 한다' },
  chair: { id: 'chair', name: '강순자', title: '감귤 조합장', seed: 7106, trait: '귤 농사를 짓는 구단주 대표. 돈은 없고 미안함은 많다' },
  suitor: { id: 'suitor', name: '윤태준', title: '돔구장 유치위원장', seed: 7107, trait: '4장에만 나온다. 정중하고, 조건이 좋다' },
  player: { id: 'player', name: '', title: '선수', seed: 0, trait: '관련 선수 본인 (이름은 카드의 pid 로)' },
};

/** 부임 전 다섯 시즌의 순위 (구단사 순위열 앞에 흐리게 붙는다) */
export const PAST_RANKS = [8, 8, 7, 8, 8];
/** 바랜 깃발의 우승이 몇 시즌 전이었는지 */
export const TITLE_YEARS_AGO = 31;
