import type { AchvDef } from './achievements';
import { mk, some, totAtLeast, won } from './achievementList1';
import { DRAFT_ROUNDS } from './draft';
import { payroll } from './economy';
import { FOREIGN_MAX } from './events';
import { isFranchise } from './franchise';
import { memoNum } from './memo';
import { leagueSize } from './league';

// 도전과제 목록 2: 구단 경영 · 선수단

const EOK = 10000; // 1억 (만원)
const cashAt = (n: number) => ({ test: (x: Parameters<AchvDef['test']>[0]) => x.core.finance.cash >= n * EOK, progress: ((x) => [Math.max(0, Math.round(x.core.finance.cash / EOK)), n]) as NonNullable<AchvDef['progress']> });
const isDrafted = (id: string): boolean => id.startsWith('dr');
const starters = (x: Parameters<AchvDef['test']>[0]) => x.t.lineup.map((l) => x.t.roster.find((p) => p.id === l.pid)).filter((p) => !!p);

const C = mk('club');
const CLUB: AchvDef[] = [
  C('c-cash50', '금고에 볕 들 날', '현금 50억 보유', '💰', 1, 'manage', cashAt(50).test, { progress: cashAt(50).progress }),
  C('c-cash100', '백억 구단', '현금 100억 보유', '💎', 2, 'manage', cashAt(100).test, { progress: cashAt(100).progress }),
  C('c-cash200', '돈이 돈을 번다', '현금 200억 보유', '🏦', 3, 'manage', cashAt(200).test, { progress: cashAt(200).progress }),
  C('c-cash300', '섬에서 제일 큰 금고', '현금 300억 보유', '🪙', 4, 'manage', cashAt(300).test, { progress: cashAt(300).progress }),
  C('c-debtfree', '빚 청산', '남아 있던 부채를 전부 갚는다', '✂️', 1, 'manage', (x) => !!x.prev && x.prev.finance.debt > 0 && x.core.finance.debt === 0),
  C('c-noloan', '무차입 흑자 경영', '이자를 한 푼도 내지 않고 영업 흑자로 시즌을 마친다', '🧾', 2, 'season', (x) => x.core.finance.debt === 0 && x.core.finance.ledger.interest === 0 && x.rec!.profit > 0),
  C('c-seats-max', '2층 스타디움', '관중석을 최고 단계(24,000석)까지 올린다', '🏟️', 3, 'manage', (x) => x.core.facilities.seats >= 4, { progress: (x) => [x.core.facilities.seats, 4] }),
  C('c-food-max', '먹으러 야구장 간다', '매점을 최고 단계까지 올린다', '🍗', 2, 'manage', (x) => x.core.facilities.food >= 4, { progress: (x) => [x.core.facilities.food, 4] }),
  C('c-train-max', '시설은 메이저급', '훈련장을 최고 단계까지 올린다', '🏋️', 2, 'manage', (x) => x.core.facilities.training >= 4, { progress: (x) => [x.core.facilities.training, 4] }),
  C('c-all-max', '풀옵션 구단', '관중석·매점·훈련장을 모두 최고 단계까지 올린다', '🛠️', 3, 'manage', (x) => x.core.facilities.seats + x.core.facilities.food + x.core.facilities.training >= 12, { progress: (x) => [x.core.facilities.seats + x.core.facilities.food + x.core.facilities.training, 12] }),
  C('c-att10k', '평균 1만 관중', '한 시즌 홈 평균 관중 10,000명 이상', '👥', 2, 'season', (x) => x.rec!.avgAtt >= 10000),
  C('c-att15k', '야구 도시 제주', '한 시즌 홈 평균 관중 15,000명 이상', '🌆', 3, 'season', (x) => x.rec!.avgAtt >= 15000),
  C('c-att20k', '섬 사람 다 왔다', '한 시즌 홈 평균 관중 20,000명 이상', '🌋', 3, 'season', (x) => x.rec!.avgAtt >= 20000),
  C('c-sell10', '매진입니다', '한 시즌 홈경기 매진 10회', '🎫', 1, 'game', (x) => x.core.campaign.sellouts >= 10, { progress: (x) => [x.core.campaign.sellouts, 10] }),
  C('c-sell20', '표 좀 구해 줘', '한 시즌 홈경기 매진 20회', '📵', 2, 'game', (x) => x.core.campaign.sellouts >= 20, { progress: (x) => [x.core.campaign.sellouts, 20] }),
  C('c-sell35', '예매 전쟁', '한 시즌 홈경기 매진 35회', '⚔️', 3, 'game', (x) => x.core.campaign.sellouts >= 35, { progress: (x) => [x.core.campaign.sellouts, 35] }),
  C('c-profit10', '남는 장사', '한 시즌 영업 흑자 10억 이상', '📗', 1, 'season', (x) => x.rec!.profit >= 10 * EOK),
  C('c-profit50', '흑자 구단의 품격', '한 시즌 영업 흑자 50억 이상', '📚', 2, 'season', (x) => x.rec!.profit >= 50 * EOK),
  C('c-profit80', '야구로 돈 버는 법', '한 시즌 영업 흑자 80억 이상', '🤑', 4, 'season', (x) => x.rec!.profit >= 80 * EOK),
  C('c-fans20k', '팬 2만', '팬 수 20,000명 이상', '📣', 2, 'story', (x) => x.core.fans >= 20000, { progress: (x) => [Math.round(x.core.fans), 20000] }),
  C('c-fans40k', '전국구 구단', '팬 수 40,000명 이상', '🗺️', 4, 'story', (x) => x.core.fans >= 40000, { progress: (x) => [Math.round(x.core.fans), 40000] }),
  C('c-turned', '암표라도 사야 하나', '한 경기에 자리가 없어 돌아간 팬 5,000명 이상', '🚧', 2, 'game', (x) => (x.r?.crowd?.turnedAway ?? 0) >= 5000),
  C('c-full24', '2만 4천의 함성', '한 경기 관중 24,000명 이상', '🔊', 3, 'game', (x) => (x.r?.crowd?.attendance ?? 0) >= 24000),
  C('c-price2', '배짱 장사 성공', '티켓값 2.0만원 이상으로 홈경기 매진', '🎩', 3, 'game', (x) => !!x.r?.crowd?.soldOut && !x.r.post && x.core.finance.ticketPrice >= 2),
  C('c-rain-sell', '비 와도 만원', '비 오는 홈경기 매진', '☔', 2, 'game', (x) => !!x.r?.crowd?.soldOut && x.r.crowd.weather === 'rain'),
];

const Q = mk('squad');
const SQUAD: AchvDef[] = [
  Q('q-star', '간판 영입', '스타성 80 이상인 FA 선수를 영입한다', '🤩', 2, 'squad', (x) => x.signed.some((p) => p.star >= 80)),
  Q('q-foreign', '용병 풀가동', `외국인 선수 ${FOREIGN_MAX}명 보유`, '🌍', 1, 'squad', (x) => x.t.roster.filter((p) => p.foreign).length >= FOREIGN_MAX),
  Q('q-shop3', '쇼핑 중독', 'FA 선수 3명 이상을 한꺼번에 영입한다 (이적 창구에서 한 번에)', '🛒', 2, 'squad', (x) => x.signed.length >= 3),
  Q('q-ovr80', '에이스급', '오버롤 80 이상인 선수 보유', '🅰️', 2, ['squad', 'season'], (x) => some(x, (p) => p.ovr >= 80)),
  Q('q-ovr88', '리그를 씹어 먹는 선수', '오버롤 88 이상인 선수 보유', '🦖', 4, ['squad', 'season'], (x) => some(x, (p) => p.ovr >= 88)),
  Q('q-lineup65', '구멍 없는 타선', '주전 타자 9명 전원 오버롤 65 이상', '🧩', 2, ['squad', 'season'], (x) => starters(x).length === 9 && starters(x).every((p) => p.ovr >= 65)),
  Q('q-lineup68', '살인 타선', '주전 타자 9명 전원 오버롤 68 이상', '☠️', 4, ['squad', 'season'], (x) => starters(x).length === 9 && starters(x).every((p) => p.ovr >= 68)),
  Q('q-young5', '젊은 피', '25세 이하 주전 타자 5명 이상', '🌱', 2, ['squad', 'season'], (x) => starters(x).filter((p) => p.age <= 25).length >= 5),
  Q('q-vet', '형님 아직 죽지 않았다', '38세 이상 선수를 주전 타순에 올린 채 승리', '🧓', 1, 'game', (x) => won(x) && starters(x).some((p) => p.age >= 38)),
  Q('q-teen', '겁 없는 막내', '20세 이하 선수를 주전 타순에 올린 채 승리', '🍼', 2, 'game', (x) => won(x) && starters(x).some((p) => p.age <= 20)),
  Q('q-draft70', '우리가 키웠다', '드래프트 출신 선수가 오버롤 70 이상으로 성장', '🌳', 3, ['squad', 'season'], (x) => some(x, (p) => isDrafted(p.id) && p.ovr >= 70)),
  Q('q-draft80', '로또 당첨', '드래프트 출신 선수가 오버롤 80 이상으로 성장', '🎰', 3, ['squad', 'season'], (x) => some(x, (p) => isDrafted(p.id) && p.ovr >= 80)),
  Q('q-draft-full', '지명권은 다 쓴다', `한 번의 드래프트에서 ${DRAFT_ROUNDS}라운드 모두 지명`, '🗳️', 1, 'draft', (x) => (x.core.draft?.mine.length ?? 0) >= DRAFT_ROUNDS),
  Q('q-draft-a', '스카우트의 눈', '스카우트 등급 A 인 신인을 지명한다', '🔭', 2, 'draft', (x) => x.picked.some((p) => p.scout === 'A')),
  Q('q-trade', '거래 성사', '다른 구단과 트레이드를 1건 성사시킨다', '🤝', 2, 'total', totAtLeast('trades', 1).test),
  Q('q-grow40', '훈련의 성과', '한 시즌 훈련 성장 40회', '📈', 2, 'game', (x) => memoNum(x.core, 'grow') >= 40, { progress: (x) => [memoNum(x.core, 'grow'), 40] }),
  Q('q-retired', '영구결번', '영구결번 선수가 1명 생긴다', '🎽', 3, 'story', (x) => (x.core.campaign.retired?.length ?? 0) >= 1),
  Q('q-retired3', '전설들의 구단', '영구결번 선수 3명', '🏛️', 4, 'story', (x) => (x.core.campaign.retired?.length ?? 0) >= 3, { progress: (x) => [x.core.campaign.retired?.length ?? 0, 3] }),
  Q('q-franchise', '프랜차이즈 스타', '프랜차이즈 스타(스타성 60 이상 · 우리 팀 5시즌 이상) 보유', '💛', 2, ['squad', 'story'], (x) => some(x, (p) => isFranchise(p, x.core.season))),
  Q('q-resign', '남아 줘서 고맙다', 'FA 자격을 얻은 선수를 재계약 카드에서 붙잡는다', '🫶', 1, 'event', (x) => x.card?.id === 'resign' && !!x.card.pid && some(x, (p) => p.id === x.card!.pid)),
  Q('q-cheap-post', '가성비 야구', '연봉 총액이 리그 8팀 중 7위 이하인데 포스트시즌 진출', '🪙', 4, 'season', (x) => x.rec!.post !== 'none' && x.core.teams.filter((t) => payroll(t) > payroll(x.t)).length >= leagueSize(x.core) - 2),
  Q('q-army', '몸 건강히 다녀와라', '입대한 선수가 생긴다', '🫡', 2, 'story', (x) => (x.core.campaign.away?.length ?? 0) >= 1),
  Q('q-army-back', '전역을 명 받았습니다', '입대했던 선수가 팀에 돌아온다', '🎖️', 3, 'story', (x) => !!x.prev && (x.prev.campaign.away ?? []).some((a) => some(x, (p) => p.id === a.id))),
  Q('q-analyst', '숫자로 야구한다', '데이터 분석원을 채용한다', '📊', 2, 'story', (x) => !!x.core.campaign.analyst),
  Q('q-ethics', '바른 생활 구단', '선수단 윤리 교육 3단계 완료', '📜', 3, 'story', (x) => (x.core.campaign.ethics ?? 0) >= 3, { progress: (x) => [x.core.campaign.ethics ?? 0, 3] }),
  Q('q-pen', '불펜 운영 철학', '불펜 운영 방침을 직접 바꾼다', '🧠', 1, 'story', (x) => x.quiet && !!x.prev && (x.prev.campaign.penStyle ?? 'balance') !== (x.core.campaign.penStyle ?? 'balance')),
  Q('q-farm-manual', '2군도 내가 본다', '2군 자동 운영을 끈다', '🕹️', 1, 'story', (x) => x.core.campaign.farmAuto === false),
  Q('q-block', '매물 나왔습니다', '우리 선수 1명을 트레이드 시장에 내놓는다', '🏷️', 1, 'story', (x) => (x.core.campaign.block?.length ?? 0) >= 1),
  Q('q-rotation', '선발 왕국', '선발 로테이션 5명 전원 오버롤 70 이상', '🖐️', 2, ['squad', 'season'], (x) => x.t.rotation.length >= 5 && x.t.rotation.every((id) => some(x, (p) => p.id === id && p.ovr >= 70))),
  Q('q-homegrown', '메이드 인 제주', '주전 타자 9명 중 3명 이상이 드래프트 출신', '🍊', 2, ['squad', 'season'], (x) => starters(x).filter((p) => isDrafted(p.id)).length >= 3),
];

export const LIST2: AchvDef[] = [...CLUB, ...SQUAD];
