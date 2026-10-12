// 실제 KBO 리그 환경 수치 (2022~2025 정규시즌, 10구단 144경기 · 720경기).
// 게임 속 구단·선수는 전부 가상이지만, 리그 환경(타율·득점·볼넷률·타이틀 규모 등)은 이 값을 기준으로 맞춘다.
// 출처·조사일·추정 근거는 docs/KBO_DATA.md. 선수 이름은 코드에 넣지 않는다.
// 금액 단위는 만원.

/** 시즌별 리그 합계(10구단 합) + 개인 타이틀 규모 */
const SEASONS = {
  2022: {
    // ── 리그 타격 합계 (KBO 기록실 팀 기록 합계 행) ──
    pa: 55963, // 타석
    ab: 49276, // 타수
    r: 6523, // 득점
    h: 12801, // 안타
    d2: 2220, // 2루타
    d3: 203, // 3루타
    hr: 1085, // 홈런
    bb: 4930, // 볼넷 (고의4구 포함)
    hbp: 721, // 사구
    so: 10469, // 삼진
    sf: 422, // 희생플라이
    sac: 610, // 희생번트
    gdp: 1076, // 병살타
    obp: 0.333, // 출루율 (공식)
    slg: 0.379, // 장타율 (공식)
    // ── 리그 투수·수비·주루 합계 ──
    outs: 38564, // 투구 아웃카운트 (12854⅔ 이닝)
    er: 5796, // 자책점
    era: 4.06, // 평균자책 (공식)
    whip: 1.38, // (피안타+볼넷)/이닝 (공식, 사구 제외)
    e: 1130, // 실책
    sba: 1257, // 도루 시도
    sb: 890, // 도루 성공
    ties: 12, // 무승부 경기 수 (720경기 − 승리 708)
    // ── 개인 타이틀 (144경기) ──
    avgTop: 0.349, // 타율 1위 (규정타석)
    hrTop: 35, // 홈런 1위 (개)
    rbiTop: 113, // 타점 1위
    sbTop: 42, // 도루 1위
    wTop: 16, // 다승 1위
    eraTop: 2.11, // 평균자책 1위 (규정이닝)
    svTop: 42, // 세이브 1위
    soTop: 224, // 탈삼진 1위
    qualBat: 53, // 규정타석 타자 수
    n300: 13, // 규정타석 3할 타자 수
    n20hr: 14, // 20홈런 이상 타자 수
    n10w: 19, // 10승 이상 투수 수
    qualPit: 22, // 규정이닝 투수 수
  },
  2023: {
    pa: 56231, ab: 49236, r: 6622, h: 12969, d2: 2221, d3: 222, hr: 924, bb: 5140, hbp: 696, so: 9970, sf: 485, sac: 673, gdp: 1015,
    obp: 0.338, slg: 0.374,
    outs: 38503, er: 5905, era: 4.14, whip: 1.41, e: 1121, sba: 1437, sb: 1040, ties: 12,
    avgTop: 0.339, hrTop: 31, rbiTop: 101, sbTop: 39, wTop: 20, eraTop: 2.0, svTop: 42, soTop: 209,
    qualBat: 50, n300: 14, n20hr: 8, n10w: 15, qualPit: 17,
  },
  2024: {
    pa: 57265, ab: 50205, r: 7740, h: 13929, d2: 2381, d3: 229, hr: 1438, bb: 5265, hbp: 783, so: 10826, sf: 528, sac: 482, gdp: 1013,
    obp: 0.352, slg: 0.42,
    outs: 38367, er: 6972, era: 4.91, whip: 1.5, e: 1088, sba: 1549, sb: 1152, ties: 10,
    avgTop: 0.36, hrTop: 46, rbiTop: 132, sbTop: 64, wTop: 15, eraTop: 2.53, svTop: 31, soTop: 182,
    qualBat: 56, n300: 24, n20hr: 22, n10w: 19, qualPit: 20,
  },
  2025: {
    pa: 55996, ab: 49021, r: 6813, h: 12824, d2: 2243, d3: 208, hr: 1191, bb: 5123, hbp: 806, so: 11024, sf: 451, sac: 594, gdp: 1003,
    obp: 0.338, slg: 0.389,
    outs: 38321, er: 6115, era: 4.31, whip: 1.4, e: 1063, sba: 1440, sb: 1078, ties: 22, // 2025년부터 연장 11회 제한 → 무승부 증가
    avgTop: 0.337, hrTop: 50, rbiTop: 158, sbTop: 49, wTop: 17, eraTop: 1.89, svTop: 35, soTop: 252,
    qualBat: 43, n300: 13, n20hr: 13, n10w: 20, qualPit: 22,
  },
} as const;

export type KboYear = keyof typeof SEASONS;
export type KboSeason = (typeof SEASONS)[KboYear];

export const KBO = {
  teams: 10,
  games: 144, // 팀당 경기 수
  leagueGames: 720, // 시즌 총 경기 수
  seasons: SEASONS,
  // 경기당 평균 관중 (명). null = 확인 못 함
  attendance: {
    2022: { total: 6076074, avg: 8439, clubTop: null, clubLow: null },
    2023: { total: 8100326, avg: 11250, clubTop: 16703, clubLow: null },
    2024: { total: 10887705, avg: 15122, clubTop: 19144, clubLow: null }, // 10구단 모두 평균 1만 명 이상
    2025: { total: 12312519, avg: 17101, clubTop: 23101, clubLow: null },
  },
  // 연봉 (만원). 평균은 신인·외국인 제외 KBO 발표치
  salary: {
    2022: { avg: 15259, max: 270000, min: 3000 },
    2023: { avg: 14648, max: null, min: 3000 },
    2024: { avg: 15495, max: 250000, min: 3000 },
    2025: { avg: 16071, max: 300000, min: 3000 },
    minFrom2027: 3300, // 2027년부터 최저연봉 인상
  },
  foreign: {
    limit: 3, // 구단당 외국인 선수 보유 (2026년부터 아시아쿼터 1명 별도 → 최대 4명)
    asiaQuotaFrom2026: 1,
  },
} as const;

export interface KboRates {
  avg: number; // 타율
  obp: number; // 출루율
  slg: number; // 장타율
  ops: number;
  rpg: number; // 팀 경기당 득점
  era: number; // 평균자책
  ra9: number; // 9이닝당 실점 (비자책 포함)
  whip: number; // (피안타+볼넷)/이닝
  whipHbp: number; // (피안타+볼넷+사구)/이닝 — 시뮬은 사구를 볼넷으로 합쳐 기록하므로 비교용
  bbPct: number; // 볼넷/타석
  hbpPct: number; // 사구/타석
  walkPct: number; // (볼넷+사구)/타석 — 시뮬 BB 확률의 기준
  kPct: number; // 삼진/타석
  hrPct: number; // 홈런/타석
  babip: number; // (H−HR)/(AB−SO−HR+SF)
  d2OfHits: number; // 안타 중 2루타
  d3OfHits: number; // 안타 중 3루타
  hrOfHits: number; // 안타 중 홈런
  hrPerGame: number; // 팀 경기당 홈런
  sbaPerGame: number; // 팀 경기당 도루 시도
  sbPerGame: number; // 팀 경기당 도루 성공
  sbPct: number; // 도루 성공률
  gdpPerGame: number; // 팀 경기당 병살타
  errPerGame: number; // 팀 경기당 실책
  runsPerEr: number; // 총실점 / 자책점 (비자책 비중)
  tieRate: number; // 무승부 경기 비율
}

/** 리그 합계 → 비율 지표 */
export function kboRates(s: KboSeason): KboRates {
  const teamGames = KBO.leagueGames * 2;
  const ip = s.outs / 3;
  return {
    avg: s.h / s.ab,
    obp: s.obp,
    slg: s.slg,
    ops: s.obp + s.slg,
    rpg: s.r / teamGames,
    era: s.era,
    ra9: (s.r * 27) / s.outs,
    whip: s.whip,
    whipHbp: (s.h + s.bb + s.hbp) / ip,
    bbPct: s.bb / s.pa,
    hbpPct: s.hbp / s.pa,
    walkPct: (s.bb + s.hbp) / s.pa,
    kPct: s.so / s.pa,
    hrPct: s.hr / s.pa,
    babip: (s.h - s.hr) / (s.ab - s.so - s.hr + s.sf),
    d2OfHits: s.d2 / s.h,
    d3OfHits: s.d3 / s.h,
    hrOfHits: s.hr / s.h,
    hrPerGame: s.hr / teamGames,
    sbaPerGame: s.sba / teamGames,
    sbPerGame: s.sb / teamGames,
    sbPct: s.sb / s.sba,
    gdpPerGame: s.gdp / teamGames,
    errPerGame: s.e / teamGames,
    runsPerEr: s.r / s.er,
    tieRate: s.ties / KBO.leagueGames,
  };
}

const YEARS = Object.keys(SEASONS).map(Number) as KboYear[];
const meanOf = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
function meanRecord<K extends string>(rows: Record<K, number>[]): Record<K, number> {
  const out = {} as Record<K, number>;
  for (const k of Object.keys(rows[0]) as K[]) out[k] = meanOf(rows.map((r) => r[k]));
  return out;
}

export interface KboTitles {
  avgTop: number;
  hrTop: number;
  rbiTop: number;
  sbTop: number;
  wTop: number;
  eraTop: number;
  svTop: number;
  soTop: number;
  qualBat: number;
  n300: number;
  n20hr: number;
  n10w: number;
  qualPit: number;
}

/** 다시즌(2022~2025) 단순 평균. 비율 지표 + 144경기·10구단 기준 타이틀 규모 */
export const KBO_AVG: KboRates & { titles: KboTitles; attendance: number; salaryAvg: number; salaryMax: number; salaryMin: number } = {
  ...meanRecord(YEARS.map((y) => kboRates(SEASONS[y]) as unknown as Record<keyof KboRates, number>)),
  titles: meanRecord(
    YEARS.map((y) => {
      const s = SEASONS[y];
      const t: KboTitles = {
        avgTop: s.avgTop, hrTop: s.hrTop, rbiTop: s.rbiTop, sbTop: s.sbTop, wTop: s.wTop, eraTop: s.eraTop, svTop: s.svTop, soTop: s.soTop,
        qualBat: s.qualBat, n300: s.n300, n20hr: s.n20hr, n10w: s.n10w, qualPit: s.qualPit,
      };
      return t as unknown as Record<keyof KboTitles, number>;
    }),
  ) as unknown as KboTitles,
  attendance: meanOf(YEARS.map((y) => KBO.attendance[y].avg)), // 명/경기
  salaryAvg: meanOf(YEARS.map((y) => KBO.salary[y].avg)), // 만원
  salaryMax: meanOf(YEARS.map((y) => KBO.salary[y].max).filter((v): v is NonNullable<typeof v> => v !== null)), // 만원 (확인된 시즌만)
  salaryMin: 3000, // 만원
};

/** 우리 리그 규격 */
export const KBL_GAMES = 84;
export const KBL_TEAMS = 8;

/**
 * KBO 144경기 누적 기록을 우리 리그 시즌 길이로 환산.
 * 예: scaleToSeason(40) = 23.3 (144경기 40홈런 ≈ 84경기 23홈런)
 */
export function scaleToSeason(v: number, games: number = KBL_GAMES): number {
  return (v * games) / KBO.games;
}

/** 10구단 기준 "인원 수" 지표를 우리 리그 구단 수로 환산 (예: 3할 타자 수) */
export function scaleToTeams(v: number, teams: number = KBL_TEAMS): number {
  return (v * teams) / KBO.teams;
}
