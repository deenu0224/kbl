// KBL 공유 타입 계약. 모든 모듈(게임 로직 / 구장 렌더러 / UI)이 이 파일을 기준으로 맞춘다.
// 금액 단위는 전부 "만원" 정수 (1억 = 10000).

export type BatPos = 'C' | '1B' | '2B' | '3B' | 'SS' | 'LF' | 'CF' | 'RF' | 'DH';
export type PitchRole = 'SP' | 'RP' | 'CP';

export interface BatStats {
  g: number;
  pa: number;
  ab: number;
  h: number;
  d2: number;
  hr: number;
  rbi: number;
  bb: number;
  so: number;
  r: number;
  d3: number; // 3루타
  sb: number; // 도루
  cs: number; // 도루 실패
}

export interface PitStats {
  g: number;
  gs: number;
  outs: number;
  er: number;
  h: number;
  bb: number;
  so: number;
  hr: number;
  w: number;
  l: number;
  sv: number;
}

export interface Player {
  id: string;
  name: string; // 가명
  age: number;
  kind: 'B' | 'P';
  pos: BatPos | PitchRole; // 주 포지션
  foreign: boolean; // 외국인 선수
  // 타자 능력치 (20~99, 50이 리그 평균). 투수는 0.
  con: number; // 컨택
  pow: number; // 파워
  eye: number; // 선구안
  spd: number; // 주력
  def: number; // 수비
  // 투수 능력치 (20~99). 타자는 0.
  stf: number; // 구위
  ctl: number; // 제구
  sta: number; // 체력
  pot: number; // 잠재력(성장 상한 OVR)
  ovr: number; // 종합
  salary: number; // 연봉(만원/시즌)
  star: number; // 스타성 0~100 (관중·굿즈에 영향)
  injury: number; // 남은 결장 경기 수 (0 = 건강)
  tag?: string; // KBO 참고 아키타입 설명 (예: "홈런왕형 1루수")
  rookie?: boolean; // 이번 시즌 데뷔 신인 (신인왕 자격)
  scout?: 'A' | 'B' | 'C' | 'D'; // 드래프트 스카우트 등급 (잠재력의 흐릿한 표시)
  since?: number; // 유저 팀에 합류한 시즌 (프랜차이즈 스타 판정용. 없으면 1)
  tired?: number; // 연투 피로: 연속 등판 일수 (0/없음 = 정상). 투수만
  farm?: boolean; // 2군(퓨처스) 소속. 없으면 1군 등록 (유저 구단만 쓴다)
  farmUntil?: number; // 2군으로 내려간 선수가 다시 1군에 등록될 수 있는 day (말소 후 10경기)
  farmStat?: FarmStat; // 이번 시즌 퓨처스 누적 기록
  il?: boolean; // 부상자 명단(재활): 부상·징계로 말소된 선수. farm 과 함께 선다. 2군 정원·성장·콜업 후보에서 빠지고 farmUntil 까지 복귀할 수 없다
  svc?: number; // 보유 기간(서비스 타임)의 기준: 유저 팀에 드래프트로 입단해 데뷔한 시즌. 있으면 6시즌 동안 연봉이 시장가의 일부 (contract.ts)
  ask?: number; // FA 재계약 때 합의한 배율 (시장가 × 이 값. 유저 팀에 있는 동안 유지)
  away?: { until: number; kind: 'army' }; // 팀을 떠나 있는 선수 (입대). until 시즌 개막에 복귀. 로스터가 아니라 campaign.away 에 있다
  served?: boolean; // 군 복무를 마쳤거나 입대한 선수 (입대 통지 대상에서 빠진다)
  armyDue?: number; // 입대를 미룬 선수: 이 시즌 60경기 뒤 선택 없이 입대한다
  prev?: { season: number; bat: BatStats; pit: PitStats; ovr?: number }; // 지난 시즌 기록 (시즌이 바뀔 때 옮겨 적는다). ovr = 그 시즌 끝의 오버롤 (방출 추천의 하락 판정. 옛 세이브에는 없다)
  subFor?: string; // 부상 대체로 자동 콜업된 선수: 대신하는 부상자의 id (복귀하면 2군으로 돌아간다)
  subFrom?: 'bench'; // 부상 대체 카드에서 고른 1군 벤치·불펜 선수 (복귀하면 2군이 아니라 원래 자리로)
  posShift?: { from: string; pen: number; until: number }; // 포지션 전향 중: 원래 포지션 · 수비 감소분(이미 def 에 반영) · 해소되는 day
  ban?: number; // 징계로 남은 출장 정지 경기 수 (injury 와 같이 줄어든다. 시즌을 넘기면 이월. scandal.ts)
  apps?: string; // 최근 15경기의 구원 등판 기록 ('1' = 등판, '0' = 쉼. 혹사 판정. sim.ts)
  lever?: number; // 다음 FA 재계약 요구 배율에 더해지는 값 (약점을 잡았으면 +, 믿어 준 선수면 −. scandal.ts)
  bat: BatStats;
  pit: PitStats;
}

/** 퓨처스(2군) 누적 기록 — 경기 시뮬 없이 능력치에서 주간으로 뽑는다 */
export interface FarmStat {
  g: number;
  ab: number;
  h: number;
  hr: number;
  outs: number;
  er: number;
}

export interface LineupSlot {
  pid: string;
  pos: BatPos; // 이 타순에서 맡는 수비 위치
}

export interface TeamRecord {
  w: number;
  l: number;
  t: number;
  rs: number; // 득점
  ra: number; // 실점
  streak: number; // +연승 / -연패
  last10: number[]; // 최근 10경기 1=승 0=패 0.5=무
}

export interface Team {
  id: string;
  city: string;
  name: string;
  color: string; // 주 색상 hex
  color2: string; // 보조 색상 hex
  pop: number; // 구단 인기 0~1 (원정 관중 동원력)
  roster: Player[];
  lineup: LineupSlot[]; // 항상 9칸, 타순 순서
  rotation: string[]; // 선발 로테이션 pid (최대 5)
  bullpen: string[]; // 불펜 pid
  closer: string | null;
  nextStarter: number; // rotation 인덱스
  rec: TeamRecord;
}

export interface Matchup {
  homeId: string;
  awayId: string;
}

// ───────── 경기 결과 ─────────

export type EvType = 'start' | 'hr' | 'score' | 'walkoff' | 'injury' | 'final';

export interface GameEvent {
  type: EvType;
  inning: number;
  half: 0 | 1; // 0=초(원정 공격) 1=말(홈 공격)
  teamId: string; // 이벤트 주체 팀
  text: string; // 큰 글씨 한 줄 ("김OO 투런 홈런!")
  sub?: string; // 작은 글씨 ("7회말 · 시즌 12호")
  away: number; // 이벤트 직후 점수
  home: number;
  rbi?: number;
  pid?: string;
  seq?: number; // 경기 안의 순서 (천천히 보기에서 장면을 끼워 넣을 때 쓴다)
  moment?: 'k' | 'dp' | 'hold' | 'run'; // 천천히 보기에서만 보이는 장면: 득점권 삼진 · 병살 위기 탈출 · 득점권 무실점 이닝 종료 · 작은 득점 ('run' 말고는 type 'start' 로 둔다: 구장 효과·효과음이 없다)
}

export interface GameResult {
  homeId: string;
  awayId: string;
  home: number;
  away: number;
  innings: number;
  line: [number[], number[]]; // [원정 이닝별 득점, 홈 이닝별 득점]
  hits: [number, number]; // [원정, 홈]
  events: GameEvent[]; // 하이라이트 (유저 경기만 채움, 'start'로 시작 'final'로 끝)
  starters: [string, string]; // [원정 선발 pid, 홈 선발 pid]
  winP?: string;
  lossP?: string;
  saveP?: string;
  mvp?: { pid: string; teamId: string; name: string; text: string };
  injuries: { pid: string; name: string; teamId: string; games: number }[];
  errs?: [{ pid: string; name: string; pos: string }[], { pid: string; name: string; pos: string }[]]; // [원정, 홈] 실책한 야수
  box?: [BoxSide, BoxSide]; // [원정, 홈] 선수별 기록 (유저 경기만)
  pitOrder?: [string[], string[]]; // [원정, 홈] 투수 등판 순서 pid (유저 경기만. 경기 기록의 투수 줄 순서)
  more?: GameEvent[]; // 하이라이트에 들지 못한 장면 (유저 경기만. 가을야구 천천히 보기가 events 사이에 끼워 넣는다. 난수를 쓰지 않고 기록만 한다)
}

/** 한 경기의 선수별 기록 */
export interface BoxSide {
  bat: { pid: string; name: string; pos: string; ab: number; h: number; hr: number; rbi: number; bb: number; so: number; r: number }[];
  pit: { pid: string; name: string; outs: number; h: number; er: number; bb: number; so: number; dec?: 'W' | 'L' | 'S' }[];
}

// ───────── 경영 ─────────

export type FacilityKind = 'seats' | 'food' | 'training';

export interface Facilities {
  seats: number; // 0~4 (표시는 Lv1~5)
  food: number; // 0~4
  training: number; // 0~4 (0 = 공터)
}

export type Weather = 'sunny' | 'cloudy' | 'rain';

export interface Crowd {
  attendance: number;
  capacity: number;
  demand: number; // 오고 싶어한 인원 (capacity 초과 가능)
  turnedAway: number; // 자리가 없어 못 들어온 인원
  soldOut: boolean;
  weather: Weather;
}

// 시즌 누적 장부 (전부 양수로 기록)
export interface Ledger {
  ticket: number;
  food: number;
  merch: number;
  league: number; // 중계권·스폰서 분배금
  sales: number; // 선수 강제 매각 등
  salary: number;
  upkeep: number; // 시설 유지비 + 구단 운영비
  interest: number;
  signing: number; // 계약금 + 방출 위약금
  facility: number; // 시설 투자
}

export interface Finance {
  cash: number;
  debt: number;
  ticketPrice: number; // 만원 (예: 1.2 = 12,000원)
  ledger: Ledger;
}

export interface NewsItem {
  id: number;
  season: number;
  day: number;
  text: string;
  tone: 'good' | 'bad' | 'info';
}

// 하루(1경기) 진행 결과 리포트 — 경기 요약 화면과 하이라이트 재생에 사용
export interface DayReport {
  day: number; // 0-based 경기일
  result: GameResult; // 유저 팀 경기
  isHome: boolean;
  oppId: string;
  won: boolean | null; // null = 무승부
  night: boolean; // 평일 야간 경기
  crowd: Crowd | null; // 홈경기만
  money: {
    ticket: number;
    food: number;
    merch: number;
    league: number;
    salary: number;
    upkeep: number;
    interest: number;
    net: number;
  };
  rankBefore: number;
  rankAfter: number;
  others: { homeId: string; awayId: string; home: number; away: number }[];
  notes: string[]; // 이 날 생긴 소식 (매진, 부상, 성장 등)
  post?: { round: PostRound; name: string; gameNo: number; myW: number; oppW: number; bestOf: number }; // 포스트시즌 경기일 때 (경기 후 시리즈 전적)
}

// 게임의 직렬화 가능한 핵심 상태 (스토어가 그대로 보관)
export interface Core {
  seed: number;
  season: number; // 1부터
  day: number; // 다음에 치를 경기일 인덱스 (0-based). schedule.length 이면 시즌 종료
  phase: Phase;
  userId: string;
  teams: Team[];
  schedule: Matchup[][]; // [day][4경기]
  freeAgents: Player[];
  finance: Finance;
  facilities: Facilities;
  fans: number; // 팬층 규모 (관중 수요의 기반)
  fanSat: number; // 팬 만족도 0~100
  crowd: Crowd | null; // 마지막 홈경기 관중
  attHistory: number[]; // 홈경기 관중 기록
  cashHistory: number[]; // 일별 현금 기록
  news: NewsItem[]; // 최신이 앞
  newsSeq: number;
  campaign: Campaign;
  post: Postseason | null; // 이번 시즌 포스트시즌 (정규시즌 종료 시 생성)
  draft: DraftState | null; // phase === 'draft' 일 때만
}

// ───────── 진행 단계 / 포스트시즌 / 캠페인 (docs/LEVEL_DESIGN.md) ─────────

// season(정규시즌) → post(유저가 가을야구 진출 시에만) → ended(시즌 결산) → draft(신인 드래프트) → season …
// over = 구단주 신임 0 으로 해임 (게임 오버)
export type Phase = 'season' | 'post' | 'ended' | 'draft' | 'over';

// WC = 와일드카드 결정전 (10구단 리그만: 4위 vs 5위, 전부 4위 홈, 4위가 1승을 안고 시작 — 4위는 1승 또는 1무, 5위는 2연승)
export type PostRound = 'WC' | 'SPO' | 'PO' | 'KS'; // 준플레이오프(3전2선승) / 플레이오프(5전3선승) / 한국시리즈(7전4선승)
export type PostFinish = 'none' | 'WC' | 'SPO' | 'PO' | 'KS' | 'champion'; // 유저의 최종 도달 지점 (KS = 준우승)

export interface PostSeries {
  round: PostRound;
  name: string; // "준플레이오프"
  hiId: string | null; // 상위 시드 (홈 어드밴티지). 앞 시리즈가 안 끝났으면 null
  loId: string | null;
  bestOf: number;
  hiW: number;
  loW: number;
  winnerId: string | null;
  games: { homeId: string; awayId: string; home: number; away: number }[];
}

export interface Postseason {
  seeds: string[]; // 정규시즌 1~4위 teamId (10구단 리그는 1~5위)
  series: PostSeries[]; // [SPO, PO, KS] (10구단 리그는 [WC, SPO, PO, KS])
  cur: number; // 진행 중인 시리즈 인덱스 (series.length = 전부 종료)
  championId: string | null;
  userFinish: PostFinish;
  ksBox?: KsBox; // 한국시리즈 동안 유저 팀 선수별 누적 (시리즈 MVP 용. 옛 세이브에는 없다)
  intro?: boolean; // 정규시즌 마감 화면을 아직 보지 않았다 (정규시즌이 끝날 때 켜고, 화면을 닫으면 지운다. 옛 세이브에는 없다)
}

/** 한국시리즈 유저 팀 선수별 누적 기록 (pid → 기록) */
export interface KsBox {
  bat: Record<string, { name: string; pos: string; ab: number; h: number; hr: number; rbi: number; bb: number; r: number }>;
  pit: Record<string, { name: string; outs: number; h: number; er: number; so: number; w: number; sv: number }>;
}

export type ObjKind =
  | 'rank' // 정규시즌 순위 target 이내
  | 'wins' // target 승 이상
  | 'avgAtt' // 홈 평균 관중 target 이상
  | 'sellouts' // 매진 target 회 이상
  | 'profit' // 영업손익 target(만원) 이상
  | 'fans' // 팬 수 target 이상
  | 'facility' // 시설 레벨 합(seats+food+training) target 이상
  | 'star' // star target 이상 선수 보유
  | 'post' // 포스트시즌 도달: target 1=진출 2=PO 3=KS 4=우승
  | 'debt'; // 시즌 종료 시 부채 target 이하

export interface Objective {
  id: string;
  kind: ObjKind;
  main: boolean; // true = 스테이지 클리어 조건, false = 보조 목표
  text: string; // "정규시즌 7위 이내"
  target: number;
  progress: number; // 현재 값 (UI 진행 막대용, 매 경기 갱신)
  state: 'open' | 'done' | 'failed';
  reward: { cash: number; fans: number; trust: number }; // 달성 보상 (시즌 결산 시 지급)
}

export interface SeasonRecord {
  season: number;
  stage: number;
  rank: number;
  w: number;
  l: number;
  t: number;
  post: PostFinish;
  profit: number;
  avgAtt: number;
  grade: 'S' | 'A' | 'B' | 'C' | 'D';
  cleared: boolean; // 그 시즌에 스테이지 메인 목표 달성
  name?: string; // 자동 명명된 시즌 이름 ("9월의 기적")
  tainted?: boolean; // 그해 덮었던 일이 뒤에 드러났다 (scandal.ts)
  // ── 단장 점수·기록 카드 (gmscore.ts. 전부 optional: 장치가 생기기 전 기록에는 없다) ──
  gm?: GmParts; // 단장 점수 세 갈래 (합 = 점수). 화면의 랭크는 이것으로 다시 정한다 (grade 는 옛 값 그대로 남는다)
  scene?: GameScene; // 그 시즌 유저 경기의 가장 희귀한 장면
  months?: number[]; // 정규시즌을 6구간(4~9월)으로 나눈 구간별 승률 (무 = 0.5)
  streak?: number; // 정규시즌 최장 연승
  gb?: number; // 1위와의 게임 차 (1위면 0)
  foe?: VsRec; // 상대 전적이 가장 나쁜 팀 (천적)
  prey?: VsRec; // 상대 전적이 가장 좋은 팀 (밥)
  mvp?: SeasonMvp; // 우리 팀 올해의 선수
  ps?: [string, number, number][]; // 가을야구 시리즈별 [라운드 'WC'|'SPO'|'PO'|'KS', 우리 승, 상대 승]
  debt?: number; // 결산 때 부채 (다음 시즌 부채 증감의 기준)
}

/** 단장 점수 세 갈래: 성적 0~450 · 살림 0~300 · 민심 0~250 */
export interface GmParts {
  s: number;
  p: number;
  m: number;
}
/** 명장면: k = 희귀도 순위 (작을수록 희귀. 가을야구 장면은 같은 종류보다 0.5 앞) */
export interface GameScene {
  k: number;
  text: string; // "라이거스전 9회말 7점 차 뒤집은 끝내기"
}
export interface VsRec {
  name: string;
  w: number;
  l: number;
  t: number;
}
export interface SeasonMvp {
  name: string;
  pos: string; // BatPos | PitchRole
  line: string; // ".331 · 28홈런 · 97타점"
  titles: string[]; // 리그 타이틀 ("홈런왕")
}

// 시즌 대본의 한 구간 (LEVEL_DESIGN 3절). label 이 있으면 일정표에 세계 안의 예보로 보인다.
export interface Beat {
  id: string; // 'broken-lineup' | 'scout-list' | 'road-trip' | 'rainy' | 'rivals' | 'home-stand' | 'midcheck' …
  part: 'ki' | 'seung' | 'mid' | 'jeon' | 'gyeol'; // 유저에게 보이지 않는다
  from: number; // 경기일(0-based) 포함
  to: number; // 포함
  label?: string; // "장마 예보", "죽음의 원정 6연전"
  icon?: string; // 이모지 1개
}

// 인물 (story.ts 의 CHARACTERS 키)
export type CharId = 'manager' | 'scout' | 'marketing' | 'farm' | 'pitching' | 'chair' | 'suitor' | 'player';

// 탭 배지가 붙는 자리
export type HintTab = 'lineup' | 'pitchers' | 'market' | 'league' | 'stadium' | 'finance' | 'news';

// 시즌 중 의사결정 이벤트 카드
export interface EventCard {
  id: string;
  title: string;
  body: string;
  icon: string; // 이모지 1개
  pid?: string; // 관련 선수
  who?: CharId; // 말하는 인물 (없으면 인물 없는 사건)
  line?: string; // 인물의 대사 (2문장 이하). body 는 상황 설명 한 줄
  choices: { label: string; desc: string; disabled?: string; cashNeed?: number; detail?: EventDetail }[]; // cashNeed = 이 선택에 드는 현금 (막힘 여부는 카드를 만든 때가 아니라 지금 현금으로 다시 본다)
  // // disabled = 선택 불가 사유. desc 는 핵심 2조각, 나머지는 detail
}

// 선택지 상세 (카드에서 선택지를 누르면 열리는 시트). 숫자는 resolve 가 적용하는 값과 같은 계산에서 나온다 (eventRows.ts)
export interface EventDetail {
  rows: { label: string; before?: string; after: string; tone?: 'good' | 'bad' | 'info' }[]; // 전 → 후 표
  pids?: string[]; // 관련 선수 (카드로 열어 볼 수 있다)
  compare?: [string, string]; // 나란히 비교할 두 선수
  risk?: string; // 확률이 있는 결과 한 줄
  lasts?: string; // 지속 기간
}

// 이벤트 지속 효과. kind 의 해석은 campaign.ts 가 소유한다.
export interface Buff {
  kind: string; // 예: 'merch', 'capacity', 'demand', 'food', 'focus', 'halfPrice', 'pledge'
  value: number; // 배율 또는 수치
  until: number; // 이 경기일(day, 0-based) 이전까지 유효. 홈경기 수로 세는 효과는 left 사용
  left?: number; // 남은 홈경기 수 (있으면 until 대신 이걸로 만료)
  label: string; // UI 표시 ("굿즈 콜라보 ×1.5")
  pid?: string;
}

export interface Campaign {
  stage: number; // 0-based STAGES 인덱스
  trust: number; // 구단주 신임 0~100 (0 이하 = 해임)
  objectives: Objective[]; // 이번 시즌 목표 (메인 1 + 보조 2)
  achievements: string[]; // 달성한 업적 id
  titles: number; // 한국시리즈 우승 횟수
  history: SeasonRecord[];
  event: EventCard | null; // 대기 중인 이벤트 (선택 전에는 경기 진행 불가)
  eventsSeen: string[]; // 이번 시즌에 나온 이벤트 id
  buffs: Buff[]; // 이벤트로 생긴 지속 효과 (시즌이 바뀌면 비움)
  sellouts: number; // 이번 시즌 매진 횟수
  ending: boolean; // 우승 엔딩을 본 적 있음
  verdict: SeasonVerdict | null; // 시즌 결산 결과 (phase 'ended' 진입 시 기록)
  // ── v3 (전부 optional: 구 세이브·1라운드 코드와 호환) ──
  beats?: Beat[]; // 이번 시즌 대본
  hints?: Partial<Record<HintTab, number>>; // 탭 배지 숫자 (탭을 열면 스토어가 지운다)
  retired?: { name: string; season: number; pos: string }[]; // 영구결번
  managerYielded?: boolean; // 감독이 승복함 (자동 편성이 최적 편성이 된다)
  analyst?: boolean; // 데이터 분석원 채용 (드래프트 등급 정확도↑)
  dealt?: boolean; // 4장에서 이전 협상 테이블에 앉음 (엔딩 문구 분기)
  opening?: string; // 장 시작 때 인물의 한 줄 (TopBar/캠페인 시트 표시용)
  briefing?: Briefing | null; // 대기 중인 주간 브리핑 (닫아야 다음 경기 진행)
  briefMemo?: BriefMemo; // 주간 브리핑의 기억: 지난주 수치 · 실행한 제안 · 넘긴 제안
  resignQueue?: string[]; // 스토브리그 재계약 대기열: FA 자격을 얻은 선수 id (contract.ts drawResign 이 채우고 카드로 하나씩 처리)
  farmAuto?: boolean; // 2군 자동 운영 (undefined = 켜짐). farm.ts
  subAuto?: boolean; // 부상 대체: true = 감독에게 맡기기 (undefined = 직접 고르기). subpick.ts
  penStyle?: 'trust' | 'balance' | 'swarm'; // 불펜 운영 방침 (undefined = 균형). sim.ts
  away?: Player[]; // 팀을 떠나 있는 선수 (입대). 각 선수의 away.until 시즌 개막에 돌아온다
  posRank0?: { season: number; ranks: Record<string, number> }; // 시즌 개막 시점의 포지션별 리그 순위 (analysis.ts positionReport 의 key → 순위)
  cardSeen?: Record<string, number>; // 카드 기본 id → 마지막으로 나온 시즌 (재등장 간격. events.ts cardRested)
  alumni?: { name: string; season: number; pos: string }[]; // 유저 팀에서 은퇴한 스타성 60+ 선수 (인스트럭터 후보. 영구결번과 별개)
  secrets?: Secret[]; // 덮은 일. 매 시즌 결산에서 적발 판정 (scandal.ts)
  exposed?: number; // 덮은 일이 드러난 횟수 (엔딩 문구 분기)
  ethics?: number; // 선수단 윤리 교육 누적 단계 0~3
  ethicsSeason?: number; // 윤리 교육을 마지막으로 실시한 시즌 (시즌당 1회)
  fixCoop?: number; // 승부조작 조사에 전면 협조: 이 시즌까지 발생 확률이 준다
  fixClear?: string[]; // 승부조작 대상에서 빠진 선수 id (연봉을 올려 주었거나 무혐의)
  block?: string[]; // 트레이드 시장에 내놓은 우리 선수 id (최대 2명. trade.ts)
  projects?: Record<string, number>; // 왕조 프로젝트 단계·누적 (projects.ts 가 해석한다)
  leagueCut?: { season: number; mult: number }; // 승부조작 적발: 이 시즌의 리그 분배금 배율 (scandal.ts)
  prevRevenue?: number; // 직전 시즌 매출(입장+매점+굿즈+분배금). 대출 한도의 기준 (economy.ts loanLimit)
  debtOver?: number; // 부채 한도 초과로 결산한 연속 시즌 수
  luxCap?: number; // 경쟁균형세 상한의 지난 결산까지 최고값 (시즌 1 물가 기준) — 상한은 내려가지 않고 연봉 인상률만큼 오른다 (10구단 리그 · economy.ts luxTax)
  debtHeavy?: number; // 부채가 한도의 80% 이상인 채 결산한 연속 시즌 수 (10구단 리그 · loan.ts DEBT_MOOD)
  fa?: { season: number; n: number; paid: number; extra: number }; // FA 계약금 누진 (10구단 리그 · economy.ts FA_HEAT): 그 시즌(결산 뒤 ~ 다음 결산)에 영입한 FA 수 · 낸 계약금 합 · 그중 배율로 더 낸 몫
  bailout?: number; // 조합 특별 출자를 받은 시즌 (시즌 1회)
  diary?: SeasonDiary; // 이번 시즌 유저 경기 기록 (gmscore.ts — 상대 전적·명장면·개막 부채. 결산에서 SeasonRecord 로 옮긴다)
}
/** 시즌 중 유저 경기 기록 (season 이 지금 시즌과 다르면 새로 시작한다) */
export interface SeasonDiary {
  season: number;
  vs: Record<string, [number, number, number]>; // 상대 teamId → [승, 패, 무] (정규시즌)
  scene?: GameScene;
  debt0?: number; // 기록을 시작한 날의 부채
}
/** 덮은 일 한 건 */
export interface Secret {
  kind: 'dope' | 'fix';
  pid: string;
  name: string;
  season: number;
  unknown?: boolean; // 유저가 사실 여부를 모르는 건 ("선수 말을 믿는다"). 화면의 "말하지 않은 일" 건수에 넣지 않는다
  press?: number; // 기자 카드가 이 일로 찾아온 횟수 (최대 SC.press.max)
  pressSeason?: number; // 마지막으로 찾아온 시즌
  heat?: number; // heatSeason 결산의 적발 위험 가감 (입막음 −, 모른 척 +)
  heatSeason?: number;
  hushAt?: number[]; // 입막음한 시즌들 (그 다음 시즌부터 기록이 남아 위험이 오른다)
}
/** 결산에서 드러난 일 한 건 (결산 화면의 빨간 섹션) */
export interface Exposure {
  kind: 'dope' | 'fix';
  name: string;
  season: number; // 덮은 시즌
  trust: number; // 도민 지지 변화 (음수)
  stars: number; // 박탈된 별 수
  wins: number; // 몰수된 승수
  fine: number; // 벌금
  ban: number; // 출장 정지 경기 수 (0 = 영구 제명)
  tainted: boolean; // 우승 시즌의 일이었다
  trustFrom?: number; // 드러나기 직전 도민 지지 (발표 화면의 전 → 후)
  wFrom?: number; // 몰수 전 승수
  rank?: [number, number]; // 몰수 전 → 후 정규시즌 순위
}
// ───────── 주간 브리핑 (briefing.ts 가 만들고 해석한다) ─────────
export type BriefAction =
  | { t: 'sign'; pid: string }
  | { t: 'price'; value: number }
  | { t: 'upgrade'; kind: FacilityKind }
  | { t: 'fix' } // 편성 칩 전부 적용
  | { t: 'rest'; pid: string; withPid: string } // 연투 투수와 쉰 투수의 보직 맞바꿈
  | { t: 'promote'; pid: string; slot: number } // 유망주를 주전으로
  | { t: 'repay' };
/** 제안이 건드리는 대상과 방향: 선수 id(+1 = 주전에 넣기, −1 = 빼기) 또는 'price'(+1 = 인상, −1 = 인하) */
export interface BriefMove {
  t: string;
  d: 1 | -1;
}
/** 제안 상세 시트의 재료 (제안을 만들 때 실행 전후를 계산해 둔다) */
export interface BriefDetail {
  parts?: { a: number[]; b: number[] }; // 전력 4칸 [타선, 수비, 선발, 불펜] 전 → 후
  rows?: { label: string; a: string; b: string; tone?: 'good' | 'bad' }[]; // 전후 표
  shifts?: { name: string; from: string; to: string }[]; // 편성: 누가 어느 자리에서 어디로
  pid?: string; // 영입·방출 대상
  vsPid?: string; // 영입으로 밀려나는 현재 주전
}
export interface BriefResult {
  text: string; // 결과 줄 (실제)
  label: string;
  expect?: string; // 실행 시점의 예상 줄
  parts?: { a: number[]; b: number[]; now: number[] }; // 전력 4칸: 실행 전 · 예상 · 지금
}
export interface BriefOffer {
  moves?: BriefMove[]; // 번복 판정용
  detail?: BriefDetail;
  id: string; // 같은 제안인지 가리는 키 ("sign:LF", "price:up" …)
  kind: string; // 종류 (같은 종류는 한 주에 한 장)
  who: CharId;
  line: string; // 인물의 한 줄 제안 (2문장 이하)
  effect: string; // 예상 결과 숫자
  flag?: string; // 깃발 단위로 본 예상 ("예상 승수 +2")
  action: BriefAction;
  state?: 'done' | 'skipped';
  rescue?: { t: 'release'; pid: string } | { t: 'borrow' }; // 자금 대응 제안: 있으면 action 대신 이것을 실행한다 (runway.ts)
  farm?: { up?: string; down?: string }; // 2군 이동 제안: 있으면 action 대신 내려보내기 → 콜업 순으로 실행한다
  penStyle?: 'trust' | 'balance' | 'swarm'; // 불펜 운영 방침 변경 제안: 있으면 action 대신 방침을 바꾼다
}
export interface Briefing {
  day: number; // 이 경기일 직전에 열렸다
  summary: string; // 지난 6경기 한 줄
  results: string[]; // 지난주 실행한 제안의 결과
  offers: BriefOffer[];
  resultInfo?: BriefResult[]; // results 와 같은 순서의 상세
  alert?: string; // 조합장의 자금 경고 한 줄 (금고가 12경기 안에 빌 때만, 제안보다 위에)
  warn?: { who: CharId; line: string }; // 스캔들 징후를 본 스태프의 한 줄 (scandal.ts scandalWarn. 시즌에 한 번, 노란색)
}
/** 실행한 제안 (다음 주 브리핑의 결과 줄을 만들 재료) */
export interface BriefDone {
  id: string;
  kind: string;
  day: number;
  label: string; // "영입 노성진"
  pid?: string;
  n?: number[]; // 실행 시점의 숫자들 (종류별 해석은 briefing.ts)
  expect?: string; // 실행 시점의 예상 줄
  parts?: number[]; // 실행 전 전력 4칸
  partsExp?: number[]; // 실행 직후(예상) 전력 4칸
}
export interface BriefMemo {
  season: number;
  snap?: { day: number; rank: number; profit: number; attN: number }; // 지난 브리핑 시점
  done: BriefDone[];
  skipped: Record<string, number>; // 제안 id → 넘긴 경기일
  shown?: number; // 이번 시즌에 낸 제안 수 (실측용)
  quiet?: Record<string, number>; // 종류 → 이 경기일부터 다시 낼 수 있다 (같은 종류 간격)
  log?: { t: string; d: 1 | -1; day: number }[]; // 최근에 제안했거나 유저가 직접 한 조작의 대상·방향 (번복 금지)
  state?: { price: number; seat: Record<string, string> }; // 지난 주 시점의 티켓값 · 주전(선수 id → 자리)
}

export interface SeasonVerdict {
  cleared: boolean;
  stageBefore: number;
  stageAfter: number;
  trustBefore: number;
  trustAfter: number;
  cashReward: number;
  fansReward: number;
  seasonName?: string;
  newAchievements: string[];
  fired: boolean;
  exposures?: Exposure[]; // 이번 결산에서 드러난 덮은 일
  luxTax?: { cap: number; payroll: number; tax: number; on?: boolean }; // 경쟁균형세를 낸 시즌 (economy.ts LUX_TAX)
  debtOver?: { debt: number; limit: number; streak: number; trust: number }; // 부채 한도 초과로 결산 (trust = 지지 변화, 음수)
  debtMood?: { debt: number; limit: number; streak: number; trust: number }; // 빚더미 구단: 부채가 한도의 80% 이상인 채 결산 (trust = 지지 변화, 0 = 첫 해 경고만)
}

export interface DraftState {
  pool: Player[]; // 남은 지명 대상
  order: string[]; // 전체 지명 순서 (teamId, 라운드 × 8)
  pick: number; // order 인덱스 (order.length = 종료)
  log: { round: number; teamId: string; pid: string; name: string; pos: string }[];
  mine: string[]; // 유저가 뽑은 pid
}

// ───────── 구장 렌더러 입력 ─────────

export type StadiumFx =
  | { kind: 'none' }
  | { kind: 'hr'; byHome: boolean; cheer: boolean } // 홈런: 공 궤적 (+cheer면 폭죽·관중 점프)
  | { kind: 'score'; cheer: boolean } // 득점: 주자 홈인
  | { kind: 'walkoff' } // 끝내기: 대형 폭죽
  | { kind: 'win' } // 홈 승리 폭죽
  | { kind: 'injury' } // 부상: 적십자 점멸
  | { kind: 'build'; target: FacilityKind } // 업그레이드 직후 반짝임
  | { kind: 'champion'; away: boolean; c1: string; c2: string; calm?: boolean }; // 한국시리즈 우승 확정: 마운드 세리머니 (away = 원정 구장 · c1/c2 = 우리 팀 색 · calm = 움직임 줄이기)

export interface StadiumScene {
  facilities: Facilities;
  homeColor: string;
  homeColor2: string;
  awayColor: string; // 상대(원정) 팀 색
  fill: number; // 좌석 점유율 0~1
  weather: Weather;
  night: boolean;
  playing: boolean; // 경기 하이라이트 재생 중
  homeBatting: boolean; // 재생 중 현재 공격이 홈팀인지
  fx: StadiumFx;
  fxKey: number; // 값이 바뀌면 fx 애니메이션을 처음부터 재생
  banners: number; // 걸린 우승/성과 배너 수 (0~3)
  // ── v3 (optional: 없으면 그리지 않는다) ──
  oldBanner?: boolean; // 바랜 옛 우승 깃발 (항상 걸려 있다)
  gateQueue?: number; // 게이트 밖 대기 줄 0~1 (발길 돌린 팬 비율)
  cheerLv?: number; // 응원 문화 0~3 (주황 물결 → 깃발 → 대형 현수막)
  retiredNums?: number; // 걸린 영구결번 수 (0~4)
  dome?: 0 | 1 | 2 | 3; // 우리 돔구장 단계 (1 조감도 간판 · 2 크레인·비계 · 3 돔 지붕). 없으면 그리지 않는다
  awayFans?: number; // 원정 응원단 크기 0~1 (3루 쪽 끝 관중석의 원정 색 덩어리). 없으면 그리지 않는다
  titleWall?: number[]; // 외야 펜스에 건 우승 현수막의 시즌 번호 (오래된 것부터, 최대 2). 없으면 그리지 않는다
  autumn?: boolean; // 가을야구 장식 (포스트시즌 동안 우리 홈 구장: 외야 펜스·내야 관중석 앞의 주황·갈색 깃발줄). 없으면 그리지 않는다
}
