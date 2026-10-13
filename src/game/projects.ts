// 왕조 프로젝트: 첫 우승(campaign.ending) 뒤에 열리는 대형 지출 목표. 상태는 campaign.projects 한 곳에 둔다.
// 효과 해석(projectFx)은 여기서만 하고, economy.ts·season.ts·draft.ts 는 그 값을 곱하거나 더하기만 한다.
import { OVER_LIMIT_ERR, loanLimit } from './loan';
import type { Core } from './types';
import { fmtInt, fmtMoney } from './format';

export type ProjectId = 'dome' | 'academy' | 'museum' | 'youth' | 'camp' | 'give';
export const PROJECT_IDS: ProjectId[] = ['dome', 'academy', 'museum', 'youth', 'camp', 'give'];

// ── 금액·효과 테이블 (만원) ──
export const DOME_COST = [300000, 500000, 500000]; // 설계 → 착공 → 완공 (총 130억). 60/120/150억으로는 봇이 18시즌 안에 완공하지 못했다 (왕조 장의 순수입이 시즌당 25억 안팎)
export const DOME_STEP = ['설계', '착공', '완공'];
export const DOME_SEATS = 6000; // 완공: 수용 +6,000석 (24,000 → 30,000)
export const DOME_REF_PRICE = 0.05; // 완공: 적정 티켓가 +500원
export const DOME_UPKEEP = 8000; // 완공: 홈경기당 시설 유지비 +8,000만 (시즌 약 34억). 늘어난 6,000석 수입(시즌 50억+)의 절반 남짓을 되가져간다 — 900만일 때는 완공 뒤 현금이 다시 150억까지 쌓였다
export const DOME_BUILD_CAP = 0.9; // 착공 뒤 공사 중인 한 시즌: 수용 −10%
export const DOME_DESIGN_TRUST = 5; // 설계 발표: 도민 지지 +5
export const ACADEMY_COST = 400000;
export const ACADEMY_FARM_GROW = 0.08; // 2군 주간 성장 확률 +8%p
export const ACADEMY_SCOUT = 0.5; // 스카우트 등급 오차 ×0.5
export const MUSEUM_COST = 250000;
export const MUSEUM_SAT = 5; // 개관: 팬 만족 +5
export const MUSEUM_DEMAND = 1.03; // 관광객·원정 응원단: 관중 수요 ×1.03
export const YOUTH_COST = 150000;
export const YOUTH_MAX = 4;
export const YOUTH_POT = [74, 78, 82, 86]; // 회차별 "제주 출신" 유망주의 잠재력 기대값
export const YOUTH_TAG = '제주 출신';
export const CAMP_COST = 120000; // 시즌당
export const CAMP_GROW = 0.05; // 1군 주간 성장 확률 +5%p
export const CAMP_INJ = 0.85; // 부상 확률 ×0.85
export const GIVE_COST = 100000; // 1회 10억
export const GIVE_FX_MAX = 10; // 지지·만족 효과는 누적 10회까지 (기록은 계속 쌓인다)
export const GIVE_STAR = 500000; // 왕조 장의 별: 도민 환원 누적 50억
export const PROJECT_OPEN_LINE = '이제 우리 손으로 지을 차례네.';
export const DOME_DONE_LINE = '섬에 돔이 섰다';

// season.ts 의 addNews 와 같은 모양 (순환 참조를 피해 따로 둔다)
function pushNews(core: Core, text: string): void {
  core.news.unshift({ id: core.newsSeq++, season: core.season, day: core.day, text, tone: 'good' });
  if (core.news.length > 60) core.news.length = 60;
}

type P = Pick<Core, 'campaign'> & Partial<Pick<Core, 'season' | 'phase'>>;
const st = (core: { campaign?: Core['campaign'] }): Record<string, number> => core.campaign?.projects ?? {};

/** 프로젝트 섹션이 열렸는가 (첫 우승 뒤) */
export const projectsOpen = (core: Pick<Core, 'campaign'>): boolean => !!core.campaign?.ending;

/** 돈을 낸 돔 단계 0~3 */
export const domePaid = (core: { campaign?: Core['campaign'] }): number => st(core).dome ?? 0;
/** 지금 구장에 반영된 돔 단계 0~3 — 낸 단계는 다음 시즌 개막에 반영된다 */
export function domeStage(core: { campaign?: Core['campaign']; season?: number }): number {
  const s = st(core);
  const paid = s.dome ?? 0;
  return paid > 0 && (s.domeAt ?? 0) >= (core.season ?? Infinity) ? paid - 1 : paid;
}
/** 도민 환원 누적액 (만원) */
export const giveTotal = (core: { campaign?: Core['campaign'] }): number => (st(core).give ?? 0) * GIVE_COST;
/** 전지훈련이 적용되는 시즌인가 */
export const campOn = (core: { campaign?: Core['campaign']; season?: number }): boolean => !!st(core).camp && st(core).camp === core.season;

export interface ProjectFx {
  noWeather: boolean; // 돔: 날씨가 관중·매점에 영향을 주지 않는다
  seats: number; // 수용 가산 (석)
  capMult: number; // 수용 배율 (공사 중)
  refPrice: number; // 적정 티켓가 가산 (만원)
  upkeep: number; // 홈경기 유지비 가산 (만원)
  demand: number; // 관중 수요 배율
  farmGrow: number; // 2군 성장 확률 가산
  mainGrow: number; // 1군 성장 확률 가산
  inj: number; // 부상 확률 배율
  scout: number; // 스카우트 등급 오차 배율
  youth: number; // 다음 드래프트의 제주 출신 유망주 회차 (0 = 없음)
}

export function projectFx(core: { campaign?: Core['campaign']; season?: number }): ProjectFx {
  const s = st(core);
  const dome = domeStage(core);
  const camp = campOn(core);
  return {
    noWeather: dome >= 3,
    seats: dome >= 3 ? DOME_SEATS : 0,
    capMult: dome === 2 ? DOME_BUILD_CAP : 1,
    refPrice: dome >= 3 ? DOME_REF_PRICE : 0,
    upkeep: dome >= 3 ? DOME_UPKEEP : 0,
    demand: s.museum ? MUSEUM_DEMAND : 1,
    farmGrow: s.academy ? ACADEMY_FARM_GROW : 0,
    mainGrow: camp ? CAMP_GROW : 0,
    inj: camp ? CAMP_INJ : 1,
    scout: s.academy ? ACADEMY_SCOUT : 1,
    youth: Math.min(YOUTH_MAX, s.youth ?? 0),
  };
}

export interface ProjectPreview {
  id: ProjectId;
  name: string;
  icon: string;
  line: string; // 한 줄 효과 (카드)
  step?: string; // 다음 단계 이름 ("착공") 또는 진행 표시 ("2/4")
  cost: number; // 다음 구매 비용 (다 했으면 0)
  rows: string[]; // 누르기 전에 결과: 숫자로
  cash: string; // "자금: 현금 180억 → 30억"
  done: boolean; // 더 살 것이 없다
  status: string; // 지금 상태 한 줄
  error?: string; // 지금 진행할 수 없는 사유
}

const cashLine = (core: Core, cost: number) => `자금: 현금 ${fmtMoney(core.finance.cash)} → ${fmtMoney(core.finance.cash - cost)}`;

/** 구매 전 결과 미리보기 (순수). 카드와 상세 시트, 봇이 같이 쓴다 */
export function projectPreview(core: Core, id: ProjectId): ProjectPreview {
  const s = st(core);
  const stove = core.phase === 'ended' || core.phase === 'draft';
  const base = { id, cash: '', done: false, status: '', rows: [] as string[] };
  let pv: ProjectPreview;
  switch (id) {
    case 'dome': {
      const paid = s.dome ?? 0;
      const done = paid >= 3;
      const cost = done ? 0 : DOME_COST[paid];
      const seatsNow = 24000;
      const rows =
        paid === 0
          ? ['육지가 내밀던 그 돔을 섬에 — 3단계 중 첫 단계', `도민 지지 +${DOME_DESIGN_TRUST}`, '구장 옆에 조감도 간판이 선다', `남은 단계: 착공 ${fmtMoney(DOME_COST[1])} · 완공 ${fmtMoney(DOME_COST[2])}`]
          : paid === 1
            ? [`공사 중 한 시즌: 수용 −10% (${fmtInt(seatsNow)}석 → ${fmtInt(seatsNow * DOME_BUILD_CAP)}석)`, '구장에 크레인과 비계가 선다', `남은 단계: 완공 ${fmtMoney(DOME_COST[2])}`]
            : [
                '비 오는 날 관중 −15% → 0% · 흐린 날 −5% → 0%',
                `수용 +${fmtInt(DOME_SEATS)}석 (${fmtInt(seatsNow)}석 → ${fmtInt(seatsNow + DOME_SEATS)}석)`,
                `적정 티켓가 +${fmtInt(DOME_REF_PRICE * 10000)}원 · 유지비 +홈경기당 ${fmtMoney(DOME_UPKEEP)}`,
              ];
      pv = {
        ...base, name: '우리 돔구장', icon: '🏟', done, cost, step: done ? undefined : DOME_STEP[paid],
        line: '비가 와도 꽉 차는 30,000석',
        rows: done ? ['날씨의 관중 영향 없음', `수용 +${fmtInt(DOME_SEATS)}석`, `유지비 +홈경기당 ${fmtMoney(DOME_UPKEEP)}`] : rows,
        status: done ? (domeStage(core) >= 3 ? '완공 — 섬에 돔이 섰다' : '완공 대금 납부 — 다음 시즌 개막에 문을 연다') : paid === 0 ? `3단계 · 총 ${fmtMoney(DOME_COST.reduce((a, b) => a + b, 0))}` : `${DOME_STEP[paid - 1]} 완료 (${paid}/3)`,
      };
      if (!done) {
        if (core.facilities.seats < 4) pv.error = '2층 스타디움(관중석 최고 단계)을 먼저 지어야 합니다';
        else if (paid > 0 && (s.domeAt ?? 0) >= core.season) pv.error = '한 시즌에 한 단계만 — 다음 시즌에 이어집니다';
      }
      break;
    }
    case 'academy':
      pv = {
        ...base, name: '육성 아카데미', icon: '🎓', done: !!s.academy, cost: s.academy ? 0 : ACADEMY_COST,
        line: `2군 성장 +${Math.round(ACADEMY_FARM_GROW * 100)}%p · 스카우트 오차 ½`,
        rows: [`2군 주간 성장 확률 +${Math.round(ACADEMY_FARM_GROW * 100)}%p`, '드래프트 스카우트 등급 오차 ×0.5'],
        status: s.academy ? '운영 중' : '1회',
      };
      break;
    case 'museum': {
      const names = (core.campaign.retired ?? []).map((r) => r.name);
      pv = {
        ...base, name: '구단 기념관', icon: '🏛', done: !!s.museum, cost: s.museum ? 0 : MUSEUM_COST,
        line: names.length ? `전시: ${names[0]}${names.length > 1 ? ` 외 ${names.length - 1}명` : ''}` : '영구결번의 이름을 건다',
        rows: [`팬 만족 +${MUSEUM_SAT}`, `관광객·원정 응원단: 관중 수요 +${Math.round((MUSEUM_DEMAND - 1) * 100)}%`, names.length ? `전시: ${names.join(' · ')}` : '전시할 영구결번이 아직 없습니다'],
        status: s.museum ? '개관' : '1회 · 영구결번 1개 이상',
      };
      if (!s.museum && !names.length) pv.error = '영구결번이 1개 이상 있어야 합니다';
      break;
    }
    case 'youth': {
      const n = s.youth ?? 0;
      const done = n >= YOUTH_MAX;
      pv = {
        ...base, name: '유소년 구장 기부', icon: '🌱', done, cost: done ? 0 : YOUTH_COST, step: `${n}/${YOUTH_MAX}`,
        line: `드래프트에 ${YOUTH_TAG} 유망주 +1`,
        rows: done
          ? [`매 드래프트: ${YOUTH_TAG} 유망주 1명 (잠재력 기대 ${YOUTH_POT[YOUTH_MAX - 1]})`]
          : [`다음 드래프트부터 ${YOUTH_TAG} 유망주 1명 (잠재력 기대 ${n > 0 ? `${YOUTH_POT[n - 1]} → ` : ''}${YOUTH_POT[n]})`, '그 선수는 프랜차이즈 스타 판정 5시즌 → 4시즌'],
        status: `${n}/${YOUTH_MAX}곳 기부`,
      };
      break;
    }
    case 'camp': {
      const target = stove ? core.season + 1 : core.season;
      const bought = s.camp === target;
      pv = {
        ...base, name: '해외 전지훈련', icon: '✈', done: false, cost: CAMP_COST,
        line: `1군 성장 +${Math.round(CAMP_GROW * 100)}%p · 부상 −${Math.round((1 - CAMP_INJ) * 100)}%`,
        rows: [`다음 시즌 1군 주간 성장 확률 +${Math.round(CAMP_GROW * 100)}%p`, `다음 시즌 부상 확률 −${Math.round((1 - CAMP_INJ) * 100)}%`, '시즌이 끝나면 효과도 끝난다'],
        status: campOn(core) && !stove ? '이번 시즌 적용 중' : bought ? '다음 시즌 예약됨' : '스토브리그에만 · 시즌당',
      };
      if (bought) pv.error = stove ? '이미 다음 시즌 전지훈련을 잡았습니다' : '이번 시즌 적용 중 — 다음 스토브리그에 다시';
      else if (!stove) pv.error = '스토브리그(시즌 결산 뒤)에만 잡을 수 있습니다';
      break;
    }
    case 'give': {
      const n = s.give ?? 0;
      const fx = n < GIVE_FX_MAX;
      pv = {
        ...base, name: '도민 환원', icon: '🍊', done: false, cost: GIVE_COST, step: `${n}회`,
        line: '조합원 배당 · 전당에 기록',
        rows: ['감귤 조합원 배당·지역 기부', fx ? `도민 지지 +1 · 팬 만족 +1 (효과는 누적 ${GIVE_FX_MAX}회까지 · 지금 ${n}회)` : `지지·만족 효과는 다 받았습니다 (${GIVE_FX_MAX}회) — 기록만 쌓입니다`, `명예의 전당: 도민 환원 누적 ${fmtMoney(n * GIVE_COST)} → ${fmtMoney((n + 1) * GIVE_COST)}`, `왕조 장의 별: 누적 ${fmtMoney(GIVE_STAR)}`],
        status: n ? `누적 ${fmtMoney(n * GIVE_COST)}` : '10억 단위',
      };
      break;
    }
  }
  pv.cash = cashLine(core, pv.cost);
  if (!projectsOpen(core)) pv.error = '첫 우승 뒤에 열립니다';
  else if (core.phase === 'over') pv.error = '구단 운영이 끝났습니다';
  else if (!pv.done && !pv.error && core.finance.cash < pv.cost) pv.error = `현금이 부족합니다 (필요 ${fmtMoney(pv.cost)})`;
  if (pv.done) delete pv.error;
  return pv;
}

/** 프로젝트 한 단계를 진행한다 (순수). 현금 부족·순서 위반은 error */
export function buyProject(core0: Core, id: ProjectId): { core: Core; error?: string } {
  const pv = projectPreview(core0, id);
  if (pv.done) return { core: core0, error: '이미 마친 프로젝트입니다' };
  if (pv.error) return { core: core0, error: pv.error };
  if (core0.finance.debt > loanLimit(core0)) return { core: core0, error: OVER_LIMIT_ERR };
  const core = structuredClone(core0);
  const c = core.campaign;
  const s = (c.projects = { ...(c.projects ?? {}) });
  core.finance.cash -= pv.cost;
  core.finance.ledger.facility += pv.cost;
  const stove = core.phase === 'ended' || core.phase === 'draft';
  const news = (text: string) => pushNews(core, text);
  switch (id) {
    case 'dome': {
      s.dome = (s.dome ?? 0) + 1;
      s.domeAt = core.season;
      if (s.dome === 1) {
        c.trust = Math.min(100, c.trust + DOME_DESIGN_TRUST);
        news(`우리 돔구장 설계 발표 — 도민 지지 +${DOME_DESIGN_TRUST}. 조합장: "육지가 내밀던 그 그림을, 우리가 그립니다."`);
      } else if (s.dome === 2) news('우리 돔구장 착공 — 다음 시즌은 공사로 관중석 일부(−10%)를 닫습니다');
      else news(`${DOME_DONE_LINE} — 다음 시즌 개막부터 비가 와도 30,000명이 찹니다`);
      break;
    }
    case 'academy':
      s.academy = 1;
      news('육성 아카데미 개원 — 2군이 더 빨리 자라고, 스카우트의 눈이 밝아집니다');
      break;
    case 'museum':
      s.museum = 1;
      core.fanSat = Math.min(100, core.fanSat + MUSEUM_SAT);
      news(`구단 기념관 개관 — 전시: ${(c.retired ?? []).map((r) => r.name).join(' · ')}`);
      break;
    case 'youth':
      s.youth = (s.youth ?? 0) + 1;
      news(`유소년 구장 기부 (${s.youth}/${YOUTH_MAX}) — 다음 드래프트에 ${YOUTH_TAG} 유망주가 나옵니다`);
      break;
    case 'camp':
      s.camp = stove ? core.season + 1 : core.season;
      news('해외 전지훈련 확정 — 다음 시즌 1군이 더 자라고 덜 다칩니다');
      break;
    case 'give':
      s.give = (s.give ?? 0) + 1;
      if (s.give <= GIVE_FX_MAX) {
        c.trust = Math.min(100, c.trust + 1);
        core.fanSat = Math.min(100, core.fanSat + 1);
      }
      news(`도민 환원 ${fmtMoney(GIVE_COST)} — 감귤 조합원 배당·지역 기부 (누적 ${fmtMoney(s.give * GIVE_COST)})`);
      break;
  }
  return { core };
}

/** 첫 우승 엔딩 직후 한 번: 섹션이 열렸음을 알린다 (mutate) */
export function openProjectsMut(core: Core): void {
  const c = core.campaign;
  if ((c.projects ?? {}).open) return;
  c.projects = { ...(c.projects ?? {}), open: core.season };
  pushNews(core, `왕조 프로젝트가 열렸습니다 (구단 탭 › 프로젝트) — 조합장: "${PROJECT_OPEN_LINE}"`);
  c.hints = { ...(c.hints ?? {}), stadium: Math.min(9, (c.hints?.stadium ?? 0) + 1) };
}

/** 새 시즌 개막에 한 번: 돔이 문을 열었으면 뉴스 한 줄 (mutate) */
export function projectSeasonOpenMut(core: Core): void {
  const s = st(core);
  if ((s.dome ?? 0) >= 3 && s.domeAt === core.season - 1) pushNews(core, `${DOME_DONE_LINE} — 우리 돔구장이 문을 열었습니다 (30,000석)`);
}

/** 결산 화면 한 줄 (없으면 null) */
export function projectVerdictLine(core: P): string | null {
  const s = st(core);
  if (!projectsOpen(core)) return null;
  if (s.open === core.season) return `조합장: "${PROJECT_OPEN_LINE}" — 왕조 프로젝트가 열렸습니다`;
  if ((s.dome ?? 0) >= 3 && s.domeAt === core.season) return `${DOME_DONE_LINE} — 다음 시즌 개막에 문을 엽니다`;
  return null;
}

/** 돈을 쓸 수 있는 총액 (도민 환원 제외, 전지훈련은 한 시즌분) */
export const PROJECT_TOTAL = DOME_COST.reduce((a, b) => a + b, 0) + ACADEMY_COST + MUSEUM_COST + YOUTH_COST * YOUTH_MAX + CAMP_COST;
