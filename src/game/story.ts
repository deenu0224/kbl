import { josa } from './format';
// 스토리 데이터: 전제·인물·대사·시즌 이름. 규칙은 docs/LEVEL_CONCEPT.md 7절, docs/LEVEL_DESIGN.md 0·6·7절.
// 대사 규칙: 한 번에 2문장 이하, 방법 지시 금지, 숫자 금지. 실존 구단·인물명 금지.
import type { Campaign, CharId, SeasonRecord } from './types';

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

/** 부임 전 다섯 시즌의 순위 (구단사 순위열 앞에 흐리게 붙는다): 꼴찌-꼴찌-한 칸 위-꼴찌-꼴찌. 8구단 8-8-7-8-8, 10구단 10-10-9-10-10 */
const PAST_FROM_LAST = [0, 0, 1, 0, 0];
const NEW_TEAMS = 10; // 새 게임의 구단 수 (generate.ts LEAGUE_TEAMS 와 같다 — 순환 import 를 피해 여기 적는다)
export const pastRanks = (teams: number = NEW_TEAMS): number[] => PAST_FROM_LAST.map((d) => teams - d);
/** 새 게임(10구단) 기준의 부임 전 순위. 세이브를 읽는 화면은 pastRanks(구단 수)를 쓴다 */
export const PAST_RANKS = pastRanks();
/** 바랜 깃발의 우승이 몇 시즌 전이었는지 */
export const TITLE_YEARS_AGO = 31;

// ───────── 전제 (0절) ─────────

/** 신임(trust)의 화면상 이름 */
export const TRUST_LABEL = '도민 지지';
/** phase 'over' 의 이름 */
export const OVER_LABEL = '연고 이전';

/** 새 게임 첫 뉴스 (위가 최신). 부임 기사 + 지난 다섯 시즌 순위 */
export const premiseNews = (teams: number = NEW_TEAMS): string[] => [
  `감귤 조합, ${TITLE_YEARS_AGO}년 전 우승 멤버를 새 단장으로 선임 — "귤밭에서 다시 야구장으로"`,
  `리그, 관중·성적 미달 구단 연고 이전 심사 착수… 육지의 한 도시가 신축 돔구장을 내걸었다`,
  `도민 구단 제주 {team}, 지난 다섯 시즌 ${pastRanks(teams).join('-')}위. 낡은 구장엔 바랜 우승 깃발 하나`,
];
export const PREMISE_NEWS: string[] = premiseNews();

export const NEWS = {
  seasonOpen: (season: number) => `시즌 ${season} 개막 — 연봉이 재산정되고 새 FA 시장이 열렸습니다`,
  brokenLineup: '부성택 감독이 개막 타순을 전임 체제 방식 그대로 적어 냈습니다',
  managerYield: '부성택 감독, "편성은 단장 뜻대로" — 이제 [자동 편성]이 최적 편성으로 바뀝니다',
  over: '도민 지지가 바닥났습니다. 리그 이사회가 제주 {team}의 연고 이전을 승인했습니다',
  overDealt: '협상 테이블은 이미 차려져 있었습니다. {team}은(는) 다음 시즌부터 육지의 돔구장에서 뜁니다',
  fanLine: (n: number) => `외야석의 오랜 팬은 오늘도 같은 자리에 앉았습니다 (${n}번째 시즌)`,
  retiredNumber: (name: string) => `${name}의 등번호가 구장에 걸립니다 — 영구결번`,
  franchiseGone: (name: string) => `간판 ${josa(name, '이', '가')} 팀을 떠났습니다 — 팬들이 등을 돌립니다`,
  jetLag: '긴 원정에서 돌아온 첫 홈경기 — 선수단 몸이 무겁습니다',
  faDrought: '올겨울 FA 시장이 말랐습니다 — 대어는 없고 준척의 몸값이 뛰었습니다',
  rainStart: '장마 전선이 제주에 걸쳤습니다',
  genChange: (names: string) => `세월 앞에 장사 없다 — ${names}의 몸이 눈에 띄게 무뎌졌습니다`,
  aceOut: (name: string, g: number) => `에이스 이탈: ${name} 어깨 통증으로 ${g}경기 결장`,
  scoutList: (pos: string) => `스카우트 팀장의 명단 도착 — ${pos} 후보 3명이 영입 시장에 올라왔습니다`,
  forecast: (label: string, inGames: number) => `예보: ${inGames}경기 뒤 「${label}」`,
  fixture: (label: string, a: string, b: string) => `잔여 일정 확정 — 「${label}」 상대는 ${a}, ${b}`,
};

/** 스캔들(scandal.ts)의 뉴스와 조합장의 한 줄. 건조하게 사실만 */
export const SCANDAL_NEWS = {
  dopeSign: (name: string, age: number) => `${name}, ${age >= 30 ? '서른에' : '뒤늦게'} 찾아온 전성기`,
  fixSignP: (name: string) => `1회 볼넷 3개 — ${name}의 이상한 하루`,
  fixSignB: (name: string) => `평범한 뜬공을 두 번 놓쳤다 — ${name}의 이상한 하루`,
  exposed: (what: string, name: string, season: number) => `리그 사무국 발표: ${season}번째 시즌 ${name}의 ${what}, 구단은 알고도 덮었다`,
  chairReport: '부끄러운 일이지만, 숨기지 않은 건 잘한 걸세.',
  chairExposed: '우리가 부끄러운 건 진 게 아니라 숨긴 걸세.',
  tainted: '그해의 우승에는 뒷말이 남았다',
};

// ───────── 장별 대사 (6절). 인물은 방법을 말하지 않고 자기 사정을 말한다 ─────────

export interface Line {
  who: CharId;
  line: string;
}

export interface StageStory {
  open: Line; // 장 시작 한 줄
  retry: Line; // 같은 장 재도전 시작 한 줄
  clear: Line; // 결산: 깃발 달성
  fail: Line; // 결산: 깃발 실패
  midBehind: string; // 중간 점검(조합장): 뒤처짐
  midAhead: string; // 중간 점검(조합장): 앞섬
}

export const STAGE_STORY: StageStory[] = [
  {
    open: { who: 'manager', line: '개막 타순은 제가 늘 하던 대로 적어 냈습니다. 오래 뛴 선수들이 이 팀의 얼굴 아닙니까.' },
    retry: { who: 'manager', line: '작년 일은 작년 일입니다. 저는 여전히 제 선수들을 믿습니다.' },
    clear: { who: 'manager', line: '제가 틀렸습니다. 이제 편성은 단장님 뜻대로 가겠습니다.' },
    fail: { who: 'scout', line: '제 눈이 예전 같지 않은가 봅니다. 그래도 야구는 사람이 하는 겁니다.' },
    midBehind: '조합원들이 순위표를 보고 한숨을 쉽니다. 귤값도 안 좋은 해라 면목이 없네요.',
    midAhead: '요즘은 선과장에서도 야구 얘기를 합니다. 이런 건 참 오랜만이에요.',
  },
  {
    open: { who: 'marketing', line: '작년에 돌아온 분들이 올해는 친구를 데려오고 있어요. 매표소 앞이 벌써 시끄럽습니다!' },
    retry: { who: 'marketing', line: '작년엔 문 앞에서 돌아간 분이 너무 많았어요. 그 얼굴들이 아직도 생각나요.' },
    clear: { who: 'marketing', line: '보셨어요? 외야 끝까지 주황색이에요!' },
    fail: { who: 'marketing', line: '빈자리보다 돌아간 발걸음이 더 아팠어요. 그래도 저는 내년에도 꽉 찰 거라고 믿어요.' },
    midBehind: '심사단이 관중석 사진을 찍어 갔다고 합니다. 빈자리가 많이 찍혔을까 걱정입니다.',
    midAhead: '구장 가는 버스가 만원이랍디다. 살다 보니 이런 날도 오네요.',
  },
  {
    open: { who: 'farm', line: '작년에 뽑은 아이들이 벌써 방망이를 다르게 잡습니다. 다만 아직은 유리그릇입니다.' },
    retry: { who: 'farm', line: '지금 쓰면 망가지고 안 쓰면 썩습니다. 저도 답을 모르겠습니다.' },
    clear: { who: 'farm', line: '그 아이들이 가을에 뛰는 걸 보게 될 줄은 몰랐습니다. 제가 너무 아꼈나 봅니다.' },
    fail: { who: 'farm', line: '베테랑들의 다리가 먼저 멈췄습니다. 아이들은 아직 덜 여물었고요.' },
    midBehind: '가을야구 얘기가 쏙 들어갔습니다. 그래도 조합원들이 젊은 선수들 이름을 외우기 시작했어요.',
    midAhead: '가을에 귤 따다 말고 야구장에 가게 생겼습니다. 다들 그 걱정을 하며 웃어요.',
  },
  {
    open: { who: 'pitching', line: '가을은 깁니다. 팔은 소모품이 아닙니다.' },
    retry: { who: 'pitching', line: '작년 가을에 누구 팔이 먼저 떨어졌는지 저는 기억합니다. 올해도 같은 얼굴들입니다.' },
    clear: { who: 'pitching', line: '끝까지 버틴 건 공이 아니라 팔이었습니다. 지켜 주셔서 고맙습니다.' },
    fail: { who: 'pitching', line: '마지막에 올릴 사람이 없었습니다. 그게 전부입니다.' },
    midBehind: '선두가 멀어 보입니다. 그래도 가을 냄새를 맡아 본 섬은 쉽게 포기하지 않아요.',
    midAhead: '한국시리즈라는 말을 입에 올려도 될까요. 부정 탈까 봐 조심스럽습니다.',
  },
  {
    open: { who: 'chair', line: '육지에서 손님이 온다고 합니다. 조건이 좋다는 소문이라 마음이 무겁습니다.' },
    retry: { who: 'chair', line: '그 손님이 올해도 온답니다. 우리가 내놓을 건 바랜 깃발뿐인데요.' },
    clear: { who: 'chair', line: '바랜 깃발 옆에 새 깃발을 겁니다. 귤밭에서도 보일 겁니다.' },
    fail: { who: 'suitor', line: '아쉬운 시즌이었습니다. 저희 제안은 내년에도 유효합니다.' },
    midBehind: '정상이 손에 잡힐 듯 멀어집니다. 조합원들은 돔구장 얘기를 애써 안 꺼냅니다.',
    midAhead: '온 섬이 숨을 죽이고 있습니다. 저는 요즘 깃대만 쳐다봅니다.',
  },
  {
    open: { who: 'chair', line: '이제 육지 팀들이 우리를 잡으러 옵니다. 그런 말을 듣는 날이 왔네요.' },
    retry: { who: 'chair', line: '한 해 쉬어 간 셈 칩시다. 깃발은 어디 안 갑니다.' },
    clear: { who: 'chair', line: '올해도 가을에 야구를 봅니다. 이게 당연해질까 봐 겁이 나요.' },
    fail: { who: 'chair', line: '지키는 일이 오르는 일보다 어렵다더니요. 그래도 섬은 기다릴 줄 압니다.' },
    midBehind: '챔피언도 쉬어 갈 때가 있지요. 조합원들은 아직 느긋합니다.',
    midAhead: '올해도 가을 일손이 모자라겠습니다. 다들 싫지 않은 눈치예요.',
  },
];

/** 감독이 이미 승복한 뒤 0장을 다시 할 때의 시작 한 줄 */
export const STAGE0_RETRY_YIELDED: Line = { who: 'scout', line: '올해는 제 수첩 말고 다른 것도 보시겠지요. 서운하진 않습니다.' };

/** 이벤트 카드의 인물 대사 (events.ts 가 카드에 채운다) */
export const CARD_LINES: Record<string, Line> = {
  veteran: { who: 'manager', line: '저 친구는 이 팀에서 청춘을 다 보냈습니다. 연패 중에 벤치에 앉혀 두면 라커룸이 가만있지 않을 겁니다.' },
  scoutlist: { who: 'scout', line: '약한 자리를 메울 이름을 적어 왔습니다. 맨 위 친구는 제가 한창때부터 본 선수입니다.' },
  oldeyeUnsigned: { who: 'scout', line: '제 수첩 맨 위에 있던 이름입니다. 한창때 그 친구 스윙을 직접 봤습니다.' },
  oldeyeSlump: { who: 'scout', line: '지금은 몸이 덜 풀렸을 뿐입니다. 이름값이 어디 가겠습니까.' },
  scalper: { who: 'marketing', line: '표가 웃돈에 팔린대요. 속상한데, 솔직히 조금 설레기도 해요.' },
  meeting: { who: 'marketing', line: '팬들이 게이트 앞에 모여 있어요. 화가 난 게 아니라 지친 얼굴들이에요.' },
  goods: { who: 'marketing', line: '지금 이 분위기를 그냥 흘려보내기가 아까워요. 캐릭터 회사에서 먼저 연락이 왔어요!' },
  tourist: { who: 'marketing', line: '주말인데 빈자리가 보여요. 여행사가 관광객을 보내 주겠다는데, 도민 팬들이 어떻게 볼지 모르겠어요.' },
  raise: { who: 'player', line: '숫자는 에이전트가 말할 겁니다. 저는 이 섬에서 인정받고 싶을 뿐입니다.' },
  trade: { who: 'scout', line: '저쪽 단장이 벤치에 앉은 우리 선수를 눈여겨봤답니다. 우리 구멍도 저쪽은 알고 있고요.' },
  early: { who: 'farm', line: '본인은 뛰겠다고 합니다. 제 눈엔 아직 다 낫지 않았습니다.' },
  notyet: { who: 'farm', line: '아직 이릅니다. 지금 무너지면 다시 세우는 데 몇 해가 걸립니다.' },
  arm: { who: 'pitching', line: '어제도 그제도 던졌습니다. 팔은 소모품이 아닙니다.' },
  tour: { who: 'player', line: '올해가 마지막일 것 같습니다. 조용히 가도 괜찮습니다.' },
  // 2군 사건 (farm.ts)
  fReady: { who: 'farm', line: '2군에서 가르칠 건 다 가르쳤습니다. 이제는 1군 공을 봐야 자랍니다.' },
  fHype: { who: 'farm', line: '기록만 보고 다들 올리라고 합니다. 제 눈엔 아직 1군 공을 못 따라갑니다.' },
  fSub: { who: 'farm', line: '빈자리를 메우라고 올렸더니 자리를 차지해 버렸습니다. 돌아온 주전에게 뭐라고 할지 모르겠습니다.' },
  fSubVet: { who: 'manager', line: '그 자리는 십 년을 지킨 선수의 자리입니다. 한 주 반짝한 걸로 뺏을 수는 없습니다.' },
  fArmy: { who: 'farm', line: '입영 통지서가 나왔습니다. 지금 보내면 아프고, 미루면 더 아픈 때에 갑니다.' },
  fConv: { who: 'farm', line: '저 자리는 몇 해가 지나도 안 납니다. 글러브를 바꿔 끼우면 길이 열립니다.' },
  fPain: { who: 'farm', line: '1군 공에 방망이가 밀립니다. 지금 쓰면 망가지고, 내리면 기가 꺾입니다.' },
  dome: { who: 'suitor', line: '새 돔구장과 이전 지원금을 준비했습니다. 선수들에게도 팬들에게도 더 나은 환경일 겁니다.' },
};

/** 2군 사건 '인스트럭터 합류'의 대사 (은퇴한 프랜차이즈 스타의 이름이 들어간다) */
export const FARM_COACH_LINE = (name: string): string => `${name} 선배가 유니폼을 다시 입겠답니다. 아이들에게 그만한 교본이 없습니다.`;

/** 장 시작 한 줄 (retry = 같은 장 재도전) */
export function openingLine(stage: number, retry: boolean, yielded = false): Line {
  const s = STAGE_STORY[Math.min(Math.max(stage, 0), STAGE_STORY.length - 1)];
  if (stage === 0 && retry && yielded) return STAGE0_RETRY_YIELDED;
  return retry ? s.retry : s.open;
}

/** 결산 화면의 인물 한 줄 */
export function verdictLine(stage: number, cleared: boolean): Line {
  const s = STAGE_STORY[Math.min(Math.max(stage, 0), STAGE_STORY.length - 1)];
  return cleared ? s.clear : s.fail;
}

// ───────── 엔딩 (7절) ─────────

export const ENDING = {
  /** 섬에 남았다 */
  stayed: {
    title: '제주의 기적',
    text: '바랜 깃발 옆에 새 깃발이 걸렸습니다. 외야석의 오랜 팬은 한참 동안 두 깃발을 올려다보았습니다.',
    news: '🍊 제주의 기적 — 바랜 깃발 옆에 두 번째 깃발이 걸렸습니다',
  },
  /** 4장에서 협상 테이블에 앉았다 */
  dealt: {
    title: '두 번째 깃발',
    text: '새 깃발은 걸렸지만, 협상 테이블은 아직 치워지지 않았습니다. 섬은 깃발을 올려다보며 내년에도 이 팀이 여기 있을지 묻습니다.',
    news: '🍊 두 번째 깃발이 걸렸습니다. 다만 돔구장 협상 테이블은 아직 그대로입니다',
  },
};

export function endingText(c: Pick<Campaign, 'dealt'>): { title: string; text: string; news: string } {
  return c.dealt ? ENDING.dealt : ENDING.stayed;
}

// ───────── 시즌 이름 (7절) ─────────

export interface SeasonCtx {
  results: number[]; // 정규시즌 경기별 1=승 0=패 0.5=무
  rainyAtt: number | null; // 장마 구간 홈 평균 관중 (구간이 없었으면 null)
  sellouts: number;
  prev: SeasonRecord[]; // 이전 시즌 기록
  dealt: boolean;
  titlesBefore: number; // 이 시즌 전까지의 우승 횟수
  teams?: number; // 구단 수 (없으면 8 — 옛 호출)
  games?: number; // 시즌 경기 수 (없으면 84)
  postTeams?: number; // 포스트시즌 진출 팀 수 (없으면 4)
}
const nT = (x: SeasonCtx) => x.teams ?? 8;
const nPost = (x: SeasonCtx) => x.postTeams ?? 4;
const gAt = (x: SeasonCtx, d84: number) => Math.round((d84 * (x.games ?? 84)) / 84); // 84경기 기준 경기 수를 이 시즌 길이로

const pctOf = (xs: number[]) => (xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : 0.5);
function longest(xs: number[], v: number): number {
  let best = 0;
  let cur = 0;
  for (const x of xs) {
    cur = x === v ? cur + 1 : 0;
    if (cur > best) best = cur;
  }
  return best;
}

interface NameRule {
  name: string;
  test: (r: SeasonRecord, x: SeasonCtx) => boolean;
}

// 위에서부터 처음 맞는 규칙의 이름이 붙는다
export const SEASON_NAME_RULES: NameRule[] = [
  { name: '떠날 채비를 한 우승', test: (r, x) => r.post === 'champion' && x.dealt },
  { name: '제주의 기적', test: (r, x) => r.post === 'champion' && x.titlesBefore === 0 },
  { name: '왕조의 해', test: (r) => r.post === 'champion' },
  { name: '한 걸음이 모자랐던 가을', test: (r) => r.post === 'KS' },
  { name: '처음 맞은 가을', test: (r, x) => r.post !== 'none' && x.prev.every((p) => p.post === 'none') },
  { name: '9월의 기적', test: (_r, x) => x.results.length >= 24 && x.results.slice(-12).filter((v) => v === 1).length >= 9 },
  { name: '봄에만 강했던 해', test: (_r, x) => x.results.length >= gAt(x, 60) && pctOf(x.results.slice(0, gAt(x, 42))) - pctOf(x.results.slice(gAt(x, 42))) >= 0.15 },
  { name: '여름에 깨어난 해', test: (_r, x) => x.results.length >= gAt(x, 60) && pctOf(x.results.slice(gAt(x, 42))) - pctOf(x.results.slice(0, gAt(x, 42))) >= 0.15 },
  { name: '장마에 무너진 해', test: (r, x) => x.rainyAtt !== null && r.avgAtt > 0 && x.rainyAtt < r.avgAtt * 0.75 },
  { name: '가을 문턱에서 멈춘 해', test: (r, x) => r.rank >= nPost(x) + 1 && r.rank <= nPost(x) + 2 && x.results.slice(-12).filter((v) => v === 1).length <= 3 },
  { name: '가을 냄새를 맡은 해', test: (r) => r.post === 'WC' || r.post === 'SPO' || r.post === 'PO' },
  { name: '끝이 안 보이던 해', test: (r, x) => r.rank >= nT(x) && x.prev.slice(-2).length === 2 && x.prev.slice(-2).every((p) => p.rank >= nT(x)) },
  { name: '달라진 팀의 해', test: (r, x) => x.prev.length > 0 && x.prev[x.prev.length - 1].rank - r.rank >= 3 },
  { name: '꼴찌를 벗어난 해', test: (r, x) => r.rank < nT(x) && (x.prev.length ? x.prev[x.prev.length - 1].rank >= nT(x) : r.rank <= nT(x) - 2) },
  { name: '주황 물결의 해', test: (_r, x) => x.sellouts >= 25 },
  { name: '긴 연패의 해', test: (_r, x) => longest(x.results, 0) >= 9 },
  { name: '연승 바람이 분 해', test: (_r, x) => longest(x.results, 1) >= 8 },
  { name: '한 끗이 모자랐던 해', test: (r, x) => r.rank === nPost(x) + 1 },
  { name: '허리띠를 졸라맨 해', test: (r) => r.profit < 0 },
  { name: '부임 첫해', test: (_r, x) => x.prev.length === 0 },
  { name: '바닥을 친 해', test: (r, x) => r.rank >= nT(x) },
];

/** 시즌 결과에 이름을 붙인다 (결산 때 호출) */
export function nameSeason(r: SeasonRecord, x: SeasonCtx): string {
  for (const rule of SEASON_NAME_RULES) if (rule.test(r, x)) return rule.name;
  return r.rank <= nPost(x) ? '위를 보던 해' : '버틴 해';
}

/** 구단사 순위열 "10-10-9-7-5-3-1" (부임 전 순위 포함 여부 선택) */
export function rankLine(history: SeasonRecord[], withPast = false, teams: number = NEW_TEAMS): string {
  return [...(withPast ? pastRanks(teams) : []), ...history.map((h) => h.rank)].join('-');
}

/** 문구의 {team} 자리에 유저가 정한 별칭을 넣는다 */
export function withTeam(text: string, team: string): string {
  return text.split('{team}은(는)').join(josa(team, '은', '는')).split('{team}').join(team);
}
