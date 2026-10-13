import type { AchvDef } from './achievements';
import { gv, mk, some, streaks, totAtLeast, won } from './achievementList1';
import { isFranchise } from './franchise';
import { loanLimit } from './loan';
import { memoGet } from './memo';
import { GIVE_STAR, YOUTH_MAX, domePaid, giveTotal } from './projects';

// 도전과제 목록 3: 이야기 · 기행 · 누적

type X = Parameters<AchvDef['test']>[0];
const camp = (x: X) => x.core.campaign;
const stars = (x: Pick<X, 'core'>): number => x.core.campaign.achievements.length;
const stageAt = (n: number) => ({ test: (x: X) => camp(x).stage >= n, progress: ((x) => [x.core.campaign.stage, n]) as NonNullable<AchvDef['progress']> });
const starsAt = (n: number) => ({ test: (x: X) => stars(x) >= n, progress: ((x) => [stars(x), n]) as NonNullable<AchvDef['progress']> });
const proj = (x: Pick<X, 'core'>): Record<string, number> => x.core.campaign.projects ?? {};
const lost = (x: X): boolean => !!x.r && x.r.won === false;

const T = mk('story');
const STORY: AchvDef[] = [
  T('t-stage1', '고장은 고쳤다', '2장 「돌아온 관중」에 도달', '🔧', 1, 'story', stageAt(1).test, { progress: stageAt(1).progress }),
  T('t-stage2', '관중이 돌아왔다', '3장 「가을야구」에 도달', '🎏', 2, 'story', stageAt(2).test, { progress: stageAt(2).progress }),
  T('t-stage3', '가을에 야구하는 팀', '4장 「한국시리즈로」에 도달', '🍁', 2, 'story', stageAt(3).test, { progress: stageAt(3).progress }),
  T('t-stage4', '한 계단 남았다', '5장 「제주의 기적」에 도달', '🪜', 3, 'story', stageAt(4).test, { progress: stageAt(4).progress }),
  T('t-ending', '제주의 기적', '5장의 깃발을 꽂는다 (한국시리즈 우승 엔딩)', '🏆', 3, 'story', (x) => !!camp(x).ending),
  T('t-star1', '첫 별', '별 1개 획득', '⭐', 1, 'story', starsAt(1).test, { progress: starsAt(1).progress }),
  T('t-star5', '별 다섯 개', '별 5개 획득', '🌟', 2, 'story', starsAt(5).test, { progress: starsAt(5).progress }),
  T('t-star8', '별 헤는 밤', '별 8개 획득', '✨', 3, 'story', starsAt(8).test, { progress: starsAt(8).progress }),
  T('t-star10', '은하수', '별 10개 획득', '🌌', 4, 'story', starsAt(10).test, { progress: starsAt(10).progress }),
  T('t-flag6', '약속을 어긴 적이 없다', '6시즌 연속으로 그 시즌의 깃발을 꽂는다', '🎌', 4, 'season', (x) => camp(x).history.length >= 6 && camp(x).history.slice(-6).every((h) => h.cleared)),
  T('t-perfect', '한 장을 완벽하게', '한 장의 별 3개를 전부 획득', '💠', 4, 'story', (x) => [0, 1, 2, 3, 4, 5].some((s) => camp(x).achievements.filter((a) => a.startsWith(`s${s}-`)).length >= 3)),
  T('t-trust100', '섬의 아들', '도민 지지 100', '🫶', 2, 'story', (x) => camp(x).trust >= 100, { progress: (x) => [x.core.campaign.trust, 100] }),
  T('t-fast', '속성 과외', '부임 6시즌 안에 우승 엔딩', '⏱️', 4, 'story', (x) => !!camp(x).ending && camp(x).history.some((h, i) => i < 6 && h.stage === 4 && h.cleared)),
  T('t-nodeal', '흔들리지 않는 섬', '이전 협상 테이블에 앉지 않고 우승 엔딩', '🗿', 3, 'story', (x) => !!camp(x).ending && !camp(x).dealt, { hidden: '육지에서 온 손님에게 끝까지 자리를 내주지 않는다' }),
  T('t-dealt', '들어나 봅시다', '연고 이전 협상 테이블에 앉는다', '🪑', 2, ['story', 'event'], (x) => !!camp(x).dealt, { hidden: '육지에서 온 손님의 제안을 들어 본다' }),
  T('t-over', '팀이 섬을 떠났다', '도민 지지가 0 이 되어 연고 이전', '🚢', 2, 'story', (x) => x.core.phase === 'over', { hidden: '가장 보고 싶지 않은 결말' }),
  T('t-titles2', '두 번째 깃발', '한 구단에서 한국시리즈 우승 2회', '🚩', 3, 'story', (x) => camp(x).titles >= 2, { progress: (x) => [x.core.campaign.titles, 2] }),
  T('t-b2b', '왕조의 시작', '한국시리즈 2시즌 연속 우승', '👑', 4, 'season', (x) => {
    const h = camp(x).history;
    return h.length >= 2 && h[h.length - 1].post === 'champion' && h[h.length - 2].post === 'champion';
  }),
  T('t-skip', '월반', '한 번의 결산으로 두 장을 한꺼번에 오른다', '⏭️', 2, 'season', (x) => !!camp(x).verdict && camp(x).verdict!.stageAfter - camp(x).verdict!.stageBefore >= 2),
  T('t-pledge', '약속은 지킨다', '중간 점검에서 목표 상향을 약속하고 그 시즌 깃발을 꽂는다', '🤞', 2, 'season', (x) => memoGet(x.core, 'mid') === 'up' && x.rec!.cleared),
  T('t-dome1', '우리 돔구장', '돔구장 건설의 첫 단계를 시작한다', '📐', 3, 'story', (x) => domePaid(x.core) >= 1, { hidden: '우승 뒤에 열리는 가장 큰 공사' }),
  T('t-dome3', '섬에 돔을 세우다', '돔구장 완공 (3단계 모두 납부)', '🏗️', 4, 'story', (x) => domePaid(x.core) >= 3, { hidden: '비가 와도 야구하는 섬', progress: (x) => [domePaid(x.core), 3] }),
  T('t-academy', '백년대계', '육성 아카데미를 세운다', '🎓', 3, 'story', (x) => !!proj(x).academy, { hidden: '우승 뒤에 열리는 투자 — 사람을 키운다' }),
  T('t-give50', '받은 만큼 돌려준다', '도민 환원 누적 50억', '🍊', 4, 'story', (x) => giveTotal(x.core) >= GIVE_STAR, { hidden: '우승 뒤에 열리는 투자 — 섬에 돌려준다', progress: (x) => [Math.round(giveTotal(x.core) / 10000), GIVE_STAR / 10000] }),
  T('t-allproj', '왕조의 유산', '돔구장·육성 아카데미·구단 기념관·유소년 구장 기부를 전부 마친다', '🏰', 4, 'story', (x) => domePaid(x.core) >= 3 && !!proj(x).academy && !!proj(x).museum && (proj(x).youth ?? 0) >= YOUTH_MAX, { hidden: '우승 뒤에 열리는 투자를 끝까지' }),
  T('t-honest', '매를 먼저 맞는다', '스캔들을 덮지 않는다 (약물은 자진 신고 · 승부조작은 조사에 전면 협조)', '🙇', 2, 'event', (x) => {
    if (x.card?.id === 'dope') return some(x, (p) => p.id === x.card!.pid && (p.ban ?? 0) > 0) && (camp(x).secrets?.length ?? 0) === (x.prev?.campaign.secrets?.length ?? 0);
    return x.card?.id === 'fix' && camp(x).fixCoop !== undefined && camp(x).fixCoop !== x.prev?.campaign.fixCoop;
  }, { hidden: '나쁜 소식이 올라왔을 때 숨기지 않는다' }),
  T('t-secret', '무덤까지 가져간다', '알게 된 스캔들을 덮는다', '🤫', 2, 'event', (x) => !!x.prev && (x.card?.id === 'dope' || x.card?.id === 'fix') && (camp(x).secrets ?? []).filter((s) => !s.unknown).length > (x.prev.campaign.secrets ?? []).filter((s) => !s.unknown).length, { hidden: '나쁜 소식이 올라왔을 때 못 본 척한다' }),
  T('t-exposed', '세상에 비밀은 없다', '덮었던 일이 결산에서 드러난다', '📰', 3, 'story', (x) => (camp(x).exposed ?? 0) >= 1, { hidden: '덮은 일은 언젠가' }),
  T('t-seasons10', '단장 10년 차', '한 구단에서 10시즌을 결산한다', '🗓️', 3, 'story', (x) => camp(x).history.length >= 10, { progress: (x) => [x.core.campaign.history.length, 10] }),
  T('t-museum', '기억을 전시하다', '구단 기념관을 연다', '🏛️', 3, 'story', (x) => !!proj(x).museum, { hidden: '우승 뒤에 열리는 투자 — 기억을 남긴다' }),
];

const O = mk('odd');
const ODD: AchvDef[] = [
  O('o-last-profit', '꼴찌로 흑자', '정규시즌 8위인데 영업 흑자로 시즌을 마친다', '🧮', 2, 'season', (x) => x.rec!.rank === 8 && x.rec!.profit > 0),
  O('o-lose10', '오늘 경기는 없었던 걸로', '10점 차 이상으로 패배', '🙈', 1, 'game', (x) => lost(x) && gv(x).opp - gv(x).my >= 10),
  O('o-score10-lose', '10점 내고 지는 법', '10득점 이상 하고도 패배', '🫠', 1, 'game', (x) => lost(x) && gv(x).my >= 10),
  O('o-tie12', '아무도 이기지 못했다', '12회까지 가서 무승부', '🤝', 1, 'game', (x) => !!x.r && x.r.won === null && x.r.result.innings >= 12),
  O('o-3hit-win', '안타 3개면 충분하다', '팀 안타 3개 이하로 승리', '🥢', 2, 'game', (x) => won(x) && gv(x).myHits <= 3),
  O('o-err4', '이게 팀이냐', '한 경기 팀 실책 4개 이상', '🧤', 2, 'game', (x) => !!x.r && gv(x).myErrs >= 4),
  O('o-l10', '숨 쉬듯 진다', '정규시즌 10연패', '🕳️', 2, 'game', (x) => streaks(x.core).l >= 10, { hidden: '연패에도 급이 있다', progress: (x) => [streaks(x.core).l, 10] }),
  O('o-60loss', '야구 끊는다 (열한 번째)', '한 시즌 60패 이상', '🚬', 2, 'season', (x) => x.rec!.l >= 60, { hidden: '84경기 중에 이만큼 지기도 쉽지 않다' }),
  O('o-no-draft', '지명권은 장식입니다', '신인 드래프트에서 한 명도 지명하지 않고 끝낸다', '🪑', 1, 'draft', (x) => !!x.prev && x.prev.phase === 'draft' && x.core.phase !== 'draft' && !!x.prev.draft && x.prev.draft.mine.length === 0, { hidden: '드래프트장에서 아무 말도 하지 않는다' }),
  O('o-min-roster', '전원 방출 직전', '선수단(1군+2군)을 20명 이하로 줄인다', '🏚️', 3, 'squad', (x) => x.t.roster.length <= 20, { hidden: '라커룸이 휑하다' }),
  O('o-cheap-sell', '박리다매', '티켓값 0.5만원으로 홈경기 매진', '🏷️', 2, 'game', (x) => !!x.r?.crowd?.soldOut && !x.r.post && x.core.finance.ticketPrice <= 0.5),
  O('o-greedy', '이 가격에 누가 와', '티켓값 4.0만원에 관중이 좌석의 절반도 안 찬다', '🦗', 2, 'game', (x) => !!x.r?.crowd && !x.r.post && x.core.finance.ticketPrice >= 4 && x.r.crowd.attendance < x.r.crowd.capacity * 0.5, { hidden: '가격표를 끝까지 올려 본다' }),
  O('o-debt-limit', '영끌', '부채가 대출 한도에 닿는다', '🧨', 2, 'manage', (x) => x.core.finance.debt > 0 && x.core.finance.debt >= loanLimit(x.core)),
  O('o-cash-neg', '통장이 텅장', '현금이 0 아래로 떨어진다', '🕸️', 2, 'manage', (x) => x.core.finance.cash < 0, { hidden: '금고 바닥을 본다' }),
  O('o-champ-debt', '빚내서 우승', '부채가 남은 채로 한국시리즈 우승', '💳', 4, 'season', (x) => x.rec!.post === 'champion' && x.core.finance.debt > 0, { hidden: '갚는 건 내년의 내가' }),
  O('o-negdiff-post', '득실은 숫자일 뿐', '득실 차가 마이너스인데 포스트시즌 진출', '🎲', 3, 'season', (x) => x.rec!.post !== 'none' && x.t.rec.rs < x.t.rec.ra),
  O('o-franchise-out', '피도 눈물도 없다', '프랜차이즈 스타를 방출한다', '🧊', 3, 'squad', (x) => !!x.prev && x.released.some((p) => x.prev!.teams.some((t) => t.id === x.prev!.userId && t.roster.some((q) => q.id === p.id && isFranchise(q, x.prev!.season)))), { hidden: '팬들이 등을 돌릴 일을 한다' }),
  O('o-bailout', '조합원 여러분 죄송합니다', '부채 한도 초과로 조합 특별 출자를 받는다', '🙏', 3, 'story', (x) => camp(x).bailout !== undefined, { hidden: '빚을 감당하지 못한 구단이 마지막에 기대는 곳' }),
  O('o-trust-low', '풍전등화', '도민 지지 10 이하로 시즌 결산을 넘기고도 팀이 섬에 남는다', '🕯️', 3, 'season', (x) => x.core.phase !== 'over' && camp(x).trust <= 10, { hidden: '한 번만 더 실패하면 끝' }),
  O('o-walkoff-loss', '남의 집 잔치', '원정에서 끝내기 패배', '🎉', 1, 'game', (x) => lost(x) && gv(x).walkoffLoss, { hidden: '상대 팀 팬들이 가장 신난 날' }),
];

const N = mk('total');
const tot = (id: string, title: string, desc: string, icon: string, tier: 1 | 2 | 3 | 4, k: string, n: number) => N(id, title, desc, icon, tier, 'total', totAtLeast(k, n).test, { progress: totAtLeast(k, n).progress });
const TOTAL: AchvDef[] = [
  tot('n-games100', '출근 도장 100번', '통산 100경기', '📆', 1, 'games', 100),
  tot('n-games500', '직관보다 많이 봤다', '통산 500경기', '📺', 2, 'games', 500),
  tot('n-games1000', '천 경기 단장', '통산 1,000경기', '🗄️', 3, 'games', 1000),
  tot('n-wins100', '통산 100승', '통산 100승', '💯', 1, 'wins', 100),
  tot('n-wins500', '통산 500승', '통산 500승', '🏅', 3, 'wins', 500),
  tot('n-wins1000', '명장 소리 듣는다', '통산 1,000승', '🎖️', 4, 'wins', 1000),
  tot('n-losses500', '그래도 본다', '통산 500패', '😇', 3, 'losses', 500),
  tot('n-hr100', '담장 밖 100개', '통산 팀 홈런 100개', '🎆', 1, 'hr', 100),
  tot('n-hr1000', '홈런 천 개', '통산 팀 홈런 1,000개', '🌠', 3, 'hr', 1000),
  tot('n-seasons5', '5년 차', '통산 5시즌 결산', '🖐️', 2, 'seasons', 5),
  tot('n-seasons20', '강산이 두 번 변했다', '통산 20시즌 결산', '⛰️', 3, 'seasons', 20),
  tot('n-titles3', '우승 청부사', '통산 한국시리즈 우승 3회', '🥇', 4, 'titles', 3),
  tot('n-clubs3', '단장 재취업', '새 구단을 3번 시작한다', '💼', 2, 'clubs', 3),
  tot('n-sell100', '매진 100번', '통산 홈경기 매진 100회', '🎟️', 2, 'sellouts', 100),
  tot('n-att1m', '백만 관중', '통산 홈 관중 100만 명', '🚶', 2, 'att', 1000000),
  tot('n-att10m', '천만 관중', '통산 홈 관중 1,000만 명', '🌏', 4, 'att', 10000000),
  tot('n-signs30', '큰손', '통산 FA 영입 30명', '🛍️', 2, 'signs', 30),
  tot('n-trades10', '트레이드 장인', '통산 트레이드 10건', '🔁', 3, 'trades', 10),
  tot('n-cards100', '결재의 달인', '통산 사건 카드 100장 처리', '🗃️', 3, 'cards', 100),
  tot('n-walkoffs20', '끝내기 전문 구단', '통산 끝내기 승리 20회', '🎇', 2, 'walkoffs', 20),
];

export const LIST3: AchvDef[] = [...STORY, ...ODD, ...TOTAL];
