// "?" 버튼 뒤의 설명. 한 주제에 3~5줄, 한 줄에 한 문장. 숫자는 실제 규칙 값만.
export type HelpTopic =
  | 'ovr'
  | 'potential'
  | 'strength'
  | 'winChance'
  | 'trust'
  | 'flag'
  | 'runway'
  | 'fatigue'
  | 'farm'
  | 'service'
  | 'value'
  | 'posRank'
  | 'demand';

export const HELP: Record<HelpTopic, { title: string; lines: string[] }> = {
  ovr: { title: '종합 능력(OVR)', lines: ['선수의 능력치를 하나로 합친 숫자입니다.', '50이 리그 평균입니다.'] },
  potential: { title: '잠재력', lines: ['이 선수가 자랄 수 있는 종합 능력의 상한입니다.'] },
  strength: { title: '팀 전력', lines: ['지금 오더로 계산한 타선·수비·선발·불펜 점수입니다.', '오더를 바꾸면 바로 변합니다.'] },
  winChance: { title: '승리 확률', lines: ['지금 오더로 다음 경기를 미리 여러 번 돌려 본 결과입니다.'] },
  trust: { title: '도민 지지', lines: ['시즌 목표를 이루면 오르고, 놓치면 내려갑니다.', '0이 되면 팀이 섬을 떠납니다.'] },
  flag: { title: '시즌 목표', lines: ['깃발은 이번 시즌에 꼭 이뤄야 하는 목표입니다.', '별 3개는 더 어려운 선택 목표입니다.'] },
  runway: { title: '자금 예측', lines: ['최근 손익이 이어진다고 보고 현금이 바닥나는 시점을 계산합니다.'] },
  fatigue: { title: '연투 피로', lines: ['연달아 던진 불펜 투수는 구위가 떨어집니다.', '하루 쉬면 회복합니다.'] },
  farm: { title: '2군', lines: ['2군 선수는 경기에 나오지 않고, 젊은 선수는 1군 벤치보다 빨리 자랍니다.', '2군 코치가 알아서 운영합니다.'] },
  service: { title: '보유 기간', lines: ['우리가 지명한 선수는 6시즌 동안 시장가보다 싼 연봉으로 뜁니다.', '그 뒤에는 재계약을 요구합니다.'] },
  value: { title: '가성비', lines: ['능력에 맞는 시장 연봉과 실제 연봉의 차이입니다.'] },
  posRank: { title: '포지션 순위', lines: ['그 자리 주전을 리그 8개 구단과 비교한 순위입니다.', '빨강은 약점, 초록은 강점입니다.'] },
  demand: { title: '관중 수요', lines: ['오고 싶어 하는 사람 수입니다.', '좌석보다 많으면 매진이고, 표값을 올리면 줄어듭니다.'] },
};
