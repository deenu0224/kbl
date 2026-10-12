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
  bat: BatStats;
  pit: PitStats;
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

export type PostRound = 'SPO' | 'PO' | 'KS'; // 준플레이오프(3전2선승) / 플레이오프(5전3선승) / 한국시리즈(7전4선승)
export type PostFinish = 'none' | 'SPO' | 'PO' | 'KS' | 'champion'; // 유저의 최종 도달 지점 (KS = 준우승)

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
  seeds: string[]; // 정규시즌 1~4위 teamId
  series: PostSeries[]; // [SPO, PO, KS]
  cur: number; // 진행 중인 시리즈 인덱스 (3 = 전부 종료)
  championId: string | null;
  userFinish: PostFinish;
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
  choices: { label: string; desc: string; disabled?: string }[]; // disabled = 선택 불가 사유
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
  | { kind: 'build'; target: FacilityKind }; // 업그레이드 직후 반짝임

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
}
