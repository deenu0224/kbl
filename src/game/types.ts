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
}

// 게임의 직렬화 가능한 핵심 상태 (스토어가 그대로 보관)
export interface Core {
  seed: number;
  season: number; // 1부터
  day: number; // 다음에 치를 경기일 인덱스 (0-based). schedule.length 이면 시즌 종료
  phase: 'season' | 'ended';
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
}
