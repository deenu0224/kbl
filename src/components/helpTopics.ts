// "?" 버튼 뒤의 설명. 한 주제에 3~5줄, 한 줄에 한 문장. 숫자는 실제 규칙 값만.
import { FARM_CAP, FARM_LOCK, FARM_MAX, LOAN_LIMIT, LOAN_RATE, ROSTER_MAX, SVC_YEARS } from '../game/economy';
import { TRUST_MAX, TRUST_START } from '../game/campaign';
import { RUNWAY_DANGER, RUNWAY_SHOW } from '../game/runway';
import { VALUE_FAIR } from '../game/analysis';
import { fmtMoney } from '../game/format';
import { SIM } from '../game/sim';

export type HelpTopic =
  | 'ovr'
  | 'potential'
  | 'strength'
  | 'winChance'
  | 'trust'
  | 'flag'
  | 'runway'
  | 'fatigue'
  | 'penStyle'
  | 'farm'
  | 'service'
  | 'value'
  | 'posRank'
  | 'demand';

export const HELP: Record<HelpTopic, { title: string; lines: string[] }> = {
  ovr: { title: '종합 능력(OVR)', lines: ['선수의 능력치를 하나로 합친 숫자입니다.', '50이 리그 평균입니다.', '표의 열 머리를 누르면 그 값으로 정렬됩니다.'] },
  potential: { title: '잠재력', lines: ['이 선수가 자랄 수 있는 종합 능력의 상한입니다.', '잠재력이 지금 능력보다 6 이상 높으면 초록색으로 보입니다.', `2군에서는 종합 능력 ${FARM_CAP}까지만 자랍니다.`] },
  strength: { title: '팀 전력', lines: ['지금 오더로 계산한 타선·수비·선발·불펜 점수입니다.', '오더를 바꾸면 바로 변합니다.', '부상자가 주전에 있으면 그만큼 내려갑니다.'] },
  winChance: { title: '승리 확률', lines: ['지금 오더로 다음 경기를 미리 여러 번 돌려 본 결과입니다.', '오더를 고치면 숫자가 다시 계산됩니다.', '경기 뒤 요약에서 예측과 실제 결과를 나란히 보여 줍니다.'] },
  trust: {
    title: '도민 지지',
    lines: [`${TRUST_START}에서 시작하고 최대 ${TRUST_MAX}입니다.`, '시즌 목표(깃발)를 이루면 오르고, 놓치면 내려갑니다.', '오르내리는 폭은 장마다 다르며 결산 화면에 나옵니다.', '0이 되면 팀이 섬을 떠납니다.'],
  },
  flag: {
    title: '시즌 목표',
    lines: ['깃발은 이번 시즌에 꼭 이뤄야 하는 목표입니다.', '깃발을 이루면 지원금과 도민 지지를 받고 다음 장으로 넘어갑니다.', '별 3개는 더 어려운 선택 목표입니다.', '별을 누르면 지금 진행 수치가 보입니다.'],
  },
  runway: {
    title: '자금 예측',
    lines: [
      '최근 홈 관중과 지금 연봉·유지비가 이어진다고 보고 남은 경기를 계산합니다.',
      `금고가 ${RUNWAY_SHOW}경기 안에 비면 경고가 뜨고, ${RUNWAY_DANGER}경기 안이면 빨간색입니다.`,
      `금고가 비면 모자란 돈은 연 ${Math.round(LOAN_RATE * 100)}% 긴급 대출로 바뀝니다.`,
      `부채가 ${fmtMoney(LOAN_LIMIT)}을 넘으면 최고 연봉 선수가 강제 매각됩니다.`,
    ],
  },
  fatigue: {
    title: '연투 피로',
    lines: [`전날 던진 불펜 투수는 구위가 ${SIM.TIRED_1}, 제구가 ${SIM.TIRED_CTL_1} 떨어집니다.`, `이틀 연속 던졌으면 ${SIM.TIRED_2}, ${SIM.TIRED_CTL_2} 떨어집니다.`, `마무리는 ${SIM.CLOSER_MAX_TIRED + 1}연투까지만 나오고 그 뒤에는 쉽니다.`, '하루 쉬면 회복합니다.'],
  },
  penStyle: {
    title: '불펜 운영 방침',
    lines: [
      `믿음: 선발을 타자 ${SIM.TRUST_SP_LIMIT}명 더 끌고, 승부처는 필승조 ${SIM.TRUST_CORE}명과 마무리가 맡습니다.`,
      '균형: 선발은 한계 타자 수에서 내리고, 상황에 따라 필승조와 추격조를 씁니다.',
      `벌떼: 선발을 타자 ${-SIM.SWARM_SP_LIMIT}명 일찍 내리고, 구원은 타자 ${SIM.SWARM_BF_TIGHT}~${SIM.SWARM_BF}명씩 끊어 던집니다.`,
      `구원은 타자 ${SIM.SHORT_BF}명까지 구위가 ${SIM.SHORT_STF} 오릅니다.`,
      `연투하면 구위가 ${SIM.TIRED_1}, 이틀 연투하면 ${SIM.TIRED_2} 떨어지고 다치기 쉽습니다.`,
    ],
  },
  farm: {
    title: '2군',
    lines: ['2군 선수는 경기에 나오지 않습니다.', `젊은 선수는 1군 벤치보다 빨리 자라지만 종합 능력 ${FARM_CAP}까지만 자랍니다.`, `2군으로 내린 선수는 ${FARM_LOCK}경기 뒤에 다시 올릴 수 있습니다.`, `1군 정원은 ${ROSTER_MAX}명, 2군 정원은 ${FARM_MAX}명입니다.`],
  },
  service: {
    title: '보유 기간',
    lines: [`우리가 지명한 선수는 ${SVC_YEARS}시즌 동안 시장가보다 싼 연봉으로 뜁니다.`, '첫해는 최저 연봉이고 해마다 시장가에 가까워집니다.', '그 뒤에는 FA 자격을 얻어 재계약을 요구합니다.'],
  },
  value: {
    title: '가성비',
    lines: ['능력과 나이에 맞는 시장 연봉과 실제 연봉의 차이입니다.', `차이가 ${fmtMoney(VALUE_FAIR)} 안쪽이면 "적정"입니다.`, '저평가는 싸게 쓰는 선수, 고평가는 비싸게 쓰는 선수입니다.', '표의 [계약] 칩을 누르면 가성비 열이 보입니다.'],
  },
  posRank: {
    title: '포지션 순위',
    lines: ['그 자리 주전을 리그 8개 구단과 비교한 순위입니다.', '1~2위는 초록, 아래 세 순위는 빨강입니다.', '빨간 테두리는 우리 팀에서 가장 약한 두 자리입니다.', '칸을 누르면 그 자리의 주전·백업과 영입 후보가 보입니다.'],
  },
  demand: { title: '관중 수요', lines: ['오고 싶어 하는 사람 수입니다.', '좌석보다 많으면 매진이고, 못 들어온 팬은 발길을 돌립니다.', '표값을 올리면 줄어듭니다.', '관중석을 늘리면 그만큼 더 받을 수 있습니다.'] },
};
