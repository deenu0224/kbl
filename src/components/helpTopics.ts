// "?" 버튼 뒤의 설명. 한 주제에 3~5줄, 한 줄에 한 문장. 숫자는 실제 규칙 값만.
import { BAILOUT_TRUST, DEBT_MOOD, FA_HEAT, faHeatLine, faHeatMult, LUX_TAX_BIG, debtMood, luxTax, DEBT_OVER_TRUST, DEBT_OVER_TRUST2, DEBT_SALE_RATE, FARM_CAP, FARM_LOCK, FARM_MAX, FARM_MAX_ACADEMY, LOAN_LIMIT, LOAN_RATE, LOAN_RATE_HI, LOAN_REV_SHARE, LOAN_TIER, ROSTER_MAX, SVC_YEARS, loanInterest, loanLimit } from '../game/economy';
import type { Core } from '../game/types';
import { leagueSize, postTeams, seasonGames } from '../game/league';
import { TRUST_MAX, TRUST_START } from '../game/campaign';
import { RUNWAY_DANGER, RUNWAY_SHOW } from '../game/runway';
import { VALUE_FAIR } from '../game/analysis';
import { fmtMoney } from '../game/format';
import { SIM } from '../game/sim';
import { SC } from '../game/scandal';
import { DOME_COST, GIVE_FX_MAX } from '../game/projects';

export type HelpTopic =
  | 'ovr'
  | 'potential'
  | 'strength'
  | 'winChance'
  | 'trust'
  | 'flag'
  | 'runway'
  | 'debt'
  | 'luxtax'
  | 'faheat'
  | 'fatigue'
  | 'penStyle'
  | 'farm'
  | 'service'
  | 'payNext'
  | 'value'
  | 'posRank'
  | 'demand'
  | 'ethics'
  | 'secrets'
  | 'projects'
  | 'postseason';

export const HELP: Record<HelpTopic, { title: string; lines: string[] | ((core: Core) => string[]) }> = {
  postseason: {
    title: '가을야구',
    lines: (core: Core) => {
      const n = postTeams(core);
      const head = `${leagueSize(core)}개 구단이 ${seasonGames(core)}경기를 치르고, 정규시즌 ${n}위까지 가을야구에 나갑니다.`;
      const ladder = '아래 순위부터 한 계단씩 올라갑니다: 준플레이오프(3전 2선승) → 플레이오프(5전 3선승) → 한국시리즈(7전 4선승).';
      if (n < 5) return [head, ladder, '순위가 높은 팀이 홈경기를 더 많이 치릅니다.', '포스트시즌에는 무승부가 없습니다.'];
      return [
        head,
        `와일드카드 결정전: ${n - 1}위와 ${n}위가 ${n - 1}위 구장에서만 최대 2경기를 치릅니다. ${n - 1}위는 1승을 안고 시작해서 한 번 이기거나 비기면 통과하고, ${n}위는 두 경기를 모두 이겨야 합니다.`,
        ladder,
        '순위가 높은 팀이 홈경기를 더 많이 치릅니다.',
        '무승부는 와일드카드 결정전에만 있고, 그 뒤로는 승부가 날 때까지 연장합니다.',
      ];
    },
  },
  projects: {
    title: '왕조 프로젝트',
    lines: [
      '첫 우승 뒤에 열리는, 구단이 섬에 남기는 것들입니다.',
      `우리 돔구장은 설계 ${fmtMoney(DOME_COST[0])} → 착공 ${fmtMoney(DOME_COST[1])} → 완공 ${fmtMoney(DOME_COST[2])}, 한 시즌에 한 단계씩 짓고 다음 시즌 개막에 반영됩니다.`,
      '완공하면 날씨가 관중과 매점에 영향을 주지 않고 30,000석이 됩니다.',
      `해외 전지훈련은 스토브리그에만 잡을 수 있고 그 시즌에만 듭니다.`,
      `도민 환원은 ${GIVE_FX_MAX}회까지만 지지·만족이 오르고, 누적액은 명예의 전당에 남습니다.`,
    ],
  },
  ethics: {
    title: '선수단 윤리 교육',
    lines: [
      '상위권 구단에는 금지 약물과 승부조작의 유혹이 찾아옵니다.',
      `교육을 한 단계 받을 때마다 그런 일이 생길 확률이 ×${SC.ethicsMult}가 됩니다.`,
      `시즌에 한 번, 최대 ${SC.ethicsMax}단계까지 받을 수 있습니다.`,
      `비용은 연봉 총액의 ${SC.ethicsRate * 100}%입니다 (최소 ${fmtMoney(SC.ethicsMin)}).`,
      '시장가보다 크게 싼 연봉으로 뛰는 선수가 많을수록 확률이 오릅니다.',
    ],
  },
  secrets: {
    title: '말하지 않은 일',
    lines: [
      '덮은 일은 매 시즌 드러날 수 있습니다.',
      `결산 때마다 판정합니다: 덮은 그 시즌 ${Math.round(SC.detect0 * 100)}%, 해마다 +${Math.round(SC.detectStep * 100)}%p, 상한 ${Math.round(SC.detectMax * 100)}%.`,
      `드러나면 도민 지지가 크게 내려가고(약물 ${SC.trust.dope}, 승부조작 ${SC.trust.fix}) 그 시즌의 별을 잃습니다.`,
      `승부조작이면 ${SC.forfeit}승 몰수와 벌금이 더해집니다.`,
      '여러 건이면 화면의 적발 위험은 그중 한 건 이상이 드러날 확률입니다.',
      `덮은 다음 시즌부터 기자가 찾아올 수 있습니다(한 건에 최대 ${SC.press.max}번): 입막음하면 그 시즌 위험 −${Math.round(-SC.press.hush * 100)}%p 대신 다음 시즌부터 +${Math.round(SC.press.hushLate * 100)}%p, 모른 척하면 +${Math.round(SC.press.ignore * 100)}%p, 털어놓으면 지지 하락이 절반이고 승수 몰수는 없습니다.`,
      '윤리 교육은 새 스캔들이 생길 확률을 낮춥니다. 이미 덮은 일의 적발 위험은 바꾸지 못합니다.',
    ],
  },
  ovr: { title: '종합 능력(오버롤)', lines: ['선수의 능력치를 하나로 합친 숫자입니다.', '50이 리그 평균입니다.', '표의 열 머리를 누르면 그 값으로 정렬됩니다.'] },
  potential: { title: '잠재력', lines: ['이 선수가 자랄 수 있는 종합 능력의 상한입니다.', '잠재력이 지금 능력보다 6 이상 높으면 초록색으로 보입니다.', `2군에서는 종합 능력 ${FARM_CAP}까지만 자랍니다.`] },
  strength: { title: '팀 전력', lines: ['지금 오더로 계산한 타선·수비·선발·불펜 점수입니다.', '오더를 바꾸면 바로 변합니다.', '부상자가 주전에 있으면 그만큼 내려갑니다.'] },
  winChance: { title: '승리 확률', lines: ['지금 오더로 다음 경기를 미리 여러 번 돌려 본 결과입니다.', '오더를 고치면 숫자가 다시 계산됩니다.', '경기 뒤 요약에서 예측과 실제 결과를 나란히 보여 줍니다.'] },
  trust: {
    title: '도민 지지',
    lines: [`${TRUST_START}에서 시작하고 최대 ${TRUST_MAX}입니다.`, '시즌 목표를 이루면 오르고, 놓치면 내려갑니다.', '오르내리는 폭은 장마다 다르며 결산 화면에 나옵니다.', '0이 되면 팀이 섬을 떠납니다.'],
  },
  flag: {
    title: '시즌 목표',
    lines: ['시즌 목표는 이번 시즌에 꼭 이뤄야 하는 목표입니다.', '목표를 이루면 지원금과 도민 지지를 받고 다음 장으로 넘어갑니다.', '별 3개는 더 어려운 선택 목표입니다.', '별을 누르면 지금 진행 수치가 보입니다.'],
  },
  debt: {
    title: '부채와 한도',
    lines: (core: Core) => {
      const lim = loanLimit(core);
      const pct = (v: number) => Math.round(v * 100);
      return [
        `한도 ${fmtMoney(lim)} = 지난 시즌 매출${core.campaign.prevRevenue ? ` ${fmtMoney(core.campaign.prevRevenue)}` : ''}의 ${pct(LOAN_REV_SHARE)}% (최소 ${fmtMoney(LOAN_LIMIT)}).`,
        `이자는 ${fmtMoney(lim * LOAN_TIER)}까지 연 ${pct(LOAN_RATE)}%, 그 위는 연 ${pct(LOAN_RATE_HI)}% — 지금 시즌당 ${fmtMoney(Math.round(loanInterest(core, core.finance.debt)))}.`,
        '금고가 비면 모자란 돈은 긴급 대출이 되어 부채에 더해집니다.',
        `한도를 넘으면 영입·시설·프로젝트·대출이 막히고, 경기 뒤마다 선수 한 명을 보냅니다 (대금 = 시장 연봉의 ${pct(DEBT_SALE_RATE)}%). 보낼 선수가 없으면 조합 특별 출자(도민 지지 −${BAILOUT_TRUST}, 시즌 1회).`,
        `한도를 넘긴 채 결산하면 도민 지지 −${DEBT_OVER_TRUST}, 두 시즌 연속이면 −${DEBT_OVER_TRUST2}.`,
        ...(debtMood(core, 0)
          ? [`빚더미 구단: 부채가 한도의 ${pct(DEBT_MOOD.at)}% 이상인 채 결산하면 첫 해는 조합장 경고, 다음 해부터 연속으로 그러면 도민 지지 −${DEBT_MOOD.trust} (한도를 꽉 채웠으면 −${DEBT_MOOD.trustFull}). 한 번이라도 ${pct(DEBT_MOOD.at)}% 아래로 결산하면 처음으로 돌아갑니다.`]
          : []),
      ];
    },
  },
  luxtax: {
    title: '경쟁균형세',
    lines: (core: Core) => {
      const l = luxTax(core);
      const k = LUX_TAX_BIG;
      return [
        `연봉 총액이 상한을 넘으면 넘은 금액의 ${Math.round(k.rate * 100)}%를 시즌 결산 때 제재금으로 냅니다.`,
        `상한 ${fmtMoney(l.cap)} — 우리를 뺀 리그 연봉 상위 ${k.top}구단 평균의 ${Math.round(k.capRate * 100)}%. 한 번 오른 상한은 내려가지 않고, 해마다 리그 연봉 인상률만큼 오릅니다.`,
        `지금 연봉 총액 ${fmtMoney(l.payroll)} — ${l.tax > 0 ? `이대로 시즌을 마치면 제재금 ${fmtMoney(l.tax)}` : `상한까지 ${fmtMoney(l.cap - l.payroll)} 남았습니다`}.`,
        '결산 시점의 연봉 총액으로 계산합니다. 영입·재계약 전에 예상 제재금이 함께 나옵니다.',
      ];
    },
  },
  faheat: {
    title: '달아오르는 FA 시장',
    lines: (core: Core) => {
      const up = (n: number) => `+${Math.round((faHeatMult(n) - 1) * 100)}%`;
      return [
        '같은 시즌에 FA 를 거듭 영입하면 계약금이 오릅니다. 에이전트들이 제주가 급하다는 것을 알기 때문입니다.',
        `두 번째 영입 ${up(1)} · 세 번째 ${up(2)} · 네 번째 ${up(3)} · 다섯 번째 ${up(4)}, 그 뒤로는 한 명마다 ${Math.round(FA_HEAT.step * 100)}%p 씩 더 오릅니다. 연봉은 그대로입니다.`,
        '시즌 결산이 끝나면 다시 0명부터 셉니다. 스토브리그의 영입은 다음 시즌 몫입니다.',
        '외국인을 포함해 영입 시장에서 데려오는 모든 선수를 셉니다. 드래프트·트레이드·콜업·재계약은 세지 않습니다.',
        faHeatLine(core) ?? '이 리그에는 적용되지 않습니다.',
      ];
    },
  },
  runway: {
    title: '자금 예측',
    lines: [
      '최근 홈 관중과 지금 연봉·유지비가 이어진다고 보고 남은 경기를 계산합니다.',
      '입장 수입은 KBO처럼 홈 72 : 원정 28로 나눕니다.',
      `금고가 ${RUNWAY_SHOW}경기 안에 비면 경고가 뜨고, ${RUNWAY_DANGER}경기 안이면 빨간색입니다.`,
      `금고가 비면 모자란 돈은 연 ${Math.round(LOAN_RATE * 100)}% 긴급 대출로 바뀝니다.`,
      '부채가 한도를 넘으면 영입·투자가 막히고, 보낼 선수를 골라야 합니다.',
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
      `타순을 여러 번 만나면 선발이 맞기 시작합니다. 세 바퀴째에 구위가 ${SIM.TTO_STF[2]} 안팎 떨어지고, 구위가 낮은 선발일수록 더 크게 떨어집니다.`,
      `구원은 타자 ${SIM.SHORT_BF}명까지 구위가 ${SIM.SHORT_STF} 오릅니다.`,
      `연투하면 구위가 ${SIM.TIRED_1}, 이틀 연투하면 ${SIM.TIRED_2} 떨어지고 다치기 쉽습니다.`,
    ],
  },
  farm: {
    title: '2군',
    lines: ['2군 선수는 경기에 나오지 않습니다.', `젊은 선수는 1군 벤치보다 빨리 자라지만 종합 능력 ${FARM_CAP}까지만 자랍니다.`, `2군으로 내린 선수는 ${FARM_LOCK}경기 뒤에 다시 올릴 수 있습니다.`, `1군 정원은 ${ROSTER_MAX}명, 2군 정원은 ${FARM_MAX}명입니다 (육성 아카데미가 있으면 ${FARM_MAX_ACADEMY}명).`, '부상·징계 중인 선수는 부상자 명단(재활)으로 내릴 수 있습니다. 1군 자리가 하나 비고 2군 정원에는 들지 않으며, 나을 때까지(최소 10경기) 복귀할 수 없습니다.', '2군 자동 운영이 켜져 있으면 10경기 이상 결장하는 부상자는 2군 코치가 명단에 올리고 대체 선수를 콜업합니다. 나으면 자동으로 복귀합니다.', '주전이 다치면 그 자리를 누가 메울지 카드에서 고릅니다. 설정의 [부상 대체]를 감독에게 맡기면 묻지 않고 알아서 메웁니다.'],
  },
  service: {
    title: 'FA 자격',
    lines: [`우리가 지명한 선수는 ${SVC_YEARS}시즌 동안 시장가보다 싼 연봉으로 뜁니다.`, '첫해는 최저 연봉이고 해마다 시장가에 가까워집니다.', '그 뒤에는 FA 자격을 얻어 재계약을 요구합니다.'],
  },
  payNext: {
    title: '내년 연봉 예상',
    lines: [
      '선수 연봉은 시즌이 바뀔 때 다시 매겨집니다(연봉 재평가). 능력·나이와 리그 연봉 인상률에 맞춘 값이고, 최근 가을야구를 했으면 몸값이 더 붙습니다.',
      `우리가 지명한 선수는 ${SVC_YEARS}시즌 동안 보유 기간 할인을 받습니다. 할인은 해마다 줄고, 끝나면 시장가로 재계약합니다.`,
      '드래프트로 2군이 늘면 2군 연봉과 2군 운영비도 늘어납니다.',
      '예상은 지금 능력 그대로 한 살 더 먹는다고 본 값입니다. 성장·노쇠·영입·방출은 넣지 않습니다.',
      '영업손익은 이번 시즌 수입이 그대로라고 보고, 이자는 지금 부채로 셉니다.',
    ],
  },
  value: {
    title: '가성비',
    lines: ['능력과 나이에 맞는 시장 연봉과 실제 연봉의 차이입니다.', `차이가 ${fmtMoney(VALUE_FAIR)} 안쪽이면 "적정"입니다.`, '저평가는 싸게 쓰는 선수, 고평가는 비싸게 쓰는 선수입니다.', '표의 [계약] 칩을 누르면 가성비 열이 보입니다.'],
  },
  posRank: {
    title: '포지션 순위',
    lines: (core: Core) => [`그 자리 주전을 리그 ${leagueSize(core)}개 구단과 비교한 순위입니다.`, '1~2위는 초록, 아래 세 순위는 빨강입니다.', '빨간 테두리는 우리 팀에서 가장 약한 두 자리입니다.', '칸을 누르면 그 자리의 주전·백업과 영입 후보가 보입니다.'],
  },
  demand: { title: '관중 수요', lines: ['오고 싶어 하는 사람 수입니다.', '좌석보다 많으면 매진이고, 못 들어온 팬은 발길을 돌립니다.', '표값을 올리면 줄어듭니다.', '관중석을 늘리면 그만큼 더 받을 수 있습니다.'] },
};
