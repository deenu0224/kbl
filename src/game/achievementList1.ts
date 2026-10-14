import type { BatPos, Core, Player } from './types';
import { gameView, lineupKey, userOf, type AchvCat, type AchvCtx, type AchvDef, type AchvOn } from './achievements';
import { leagueAwards } from './leaders';
import { memoGet } from './memo';
import { inPost, isLast, postTeams, seasonGames } from './league';

// 도전과제 목록 1: 첫걸음 · 경기 · 시즌. 조건은 전부 DayReport 와 상태에서 읽는다 (게임 수치를 바꾸지 않는다)

type Opt = { hidden?: string; progress?: AchvDef['progress'] };
/** 한 줄 정의: id · 제목 · 조건 · 아이콘 · 난이도 · 사건 · 판정 */
export const mk =
  (cat: AchvCat) =>
  (id: string, title: string, desc: string, icon: string, tier: 1 | 2 | 3 | 4, on: AchvOn | AchvOn[], test: (x: AchvCtx) => boolean, o: Opt = {}): AchvDef => ({
    id, cat, title, desc, icon, tier, on: Array.isArray(on) ? on : [on], test, ...o,
  });

/** 누적 카운터가 n 이상 */
export const totAtLeast = (k: string, n: number) => ({
  test: (x: AchvCtx) => (x.tot[k] ?? 0) >= n,
  progress: ((x) => [x.tot[k] ?? 0, n]) as NonNullable<AchvDef['progress']>,
});

/** 이번 시즌 정규시즌 결과 문자열('W'/'L'/'T')에서 가장 긴 연승·연패 */
export function streaks(core: Core): { w: number; l: number; n: number } {
  const s = memoGet(core, 'wl') ?? '';
  let w = 0;
  let l = 0;
  let cw = 0;
  let cl = 0;
  for (const ch of s) {
    cw = ch === 'W' ? cw + 1 : 0;
    cl = ch === 'L' ? cl + 1 : 0;
    w = Math.max(w, cw);
    l = Math.max(l, cl);
  }
  return { w, l, n: s.length };
}

/** 리그 시상 (결산 한 번에 여러 도전과제가 같이 읽으므로 상태 객체별로 한 번만 계산) */
const awardMemo = new WeakMap<Core, ReturnType<typeof leagueAwards>>();
export function awardsOf(core: Core): ReturnType<typeof leagueAwards> {
  let a = awardMemo.get(core);
  if (!a) {
    a = leagueAwards(core);
    awardMemo.set(core, a);
  }
  return a;
}
const hasTitle = (x: AchvCtx, cat: string): boolean => awardsOf(x.core).titles.some((t) => t.cat === cat && t.row.teamId === x.core.userId);
const myTitles = (x: AchvCtx): number => awardsOf(x.core).titles.filter((t) => t.row.teamId === x.core.userId).length;
const myGloves = (x: AchvCtx): number => (Object.keys(awardsOf(x.core).goldenGlove) as BatPos[]).filter((k) => awardsOf(x.core).goldenGlove[k]?.teamId === x.core.userId).length;
const pct = (r: { w: number; l: number }): number => (r.w + r.l ? r.w / (r.w + r.l) : 0);
const g = (x: AchvCtx) => gameView(x.r!);
const won = (x: AchvCtx): boolean => !!x.r && x.r.won === true;
// 와일드카드 결정전은 4위가 1승을 안고 시작한다: 5위(전 경기 원정)의 2연승만 무패 통과로 친다. 4위의 1승 통과는 한 경기라 치지 않는다
const wcSweep = (x: AchvCtx): boolean => !x.r!.isHome && x.r!.post!.gameNo === 2;
const some = (x: AchvCtx, f: (p: Player) => boolean): boolean => x.t.roster.some(f);
const postRank: Record<string, number> = { none: 0, WC: 1, SPO: 1, PO: 2, KS: 3, champion: 4 };

const S = mk('start');
const START: AchvDef[] = [
  S('s-first-game', '플레이볼', '첫 경기를 치른다', '⚾', 1, 'game', (x) => !!x.r),
  S('s-first-win', '첫 승 신고', '첫 승리를 거둔다', '🙌', 1, 'game', won),
  S('s-first-loss', '졌지만 잘 싸웠다', '첫 패배를 당한다', '🥲', 1, 'game', (x) => !!x.r && x.r.won === false),
  S('s-home-win', '집에서는 이긴다', '홈경기에서 처음 이긴다', '🏠', 1, 'game', (x) => won(x) && x.r!.isHome),
  S('s-lineup', '저걸 왜 저기서 바꿔', '타순·수비 위치·투수 보직을 직접 한 번 바꾼다', '✏️', 1, 'squad', (x) => x.quiet && !!x.prev && !x.signed.length && !x.released.length && !x.calledUp.length && !x.sentDown.length && lineupKey(userOf(x.prev)) !== lineupKey(x.t)),
  S('s-price', '가격표 고쳐 쓰기', '티켓값을 한 번 바꾼다', '🎟️', 1, 'manage', (x) => x.quiet && !!x.prev && x.prev.finance.ticketPrice !== x.core.finance.ticketPrice),
  S('s-upgrade', '첫 삽', '시설을 1단계 올린다', '🏗️', 1, 'total', totAtLeast('upgrades', 1).test),
  S('s-sign', '도장 쾅', 'FA 선수 1명을 영입한다', '🖋️', 1, 'total', totAtLeast('signs', 1).test),
  S('s-release', '미안하다, 이게 프로다', '선수 1명을 방출한다', '📦', 1, 'total', totAtLeast('releases', 1).test),
  S('s-callup', '짐 싸서 올라와라', '2군 선수 1명을 1군에 등록한다', '⬆️', 1, 'total', totAtLeast('ups', 1).test),
  S('s-loan', '마이너스 통장 개설', '대출을 한 번 받는다', '🏦', 1, 'manage', (x) => x.quiet && !!x.prev && x.core.finance.debt > x.prev.finance.debt),
  S('s-card', '결재 서류 1호', '사건 카드 1장을 처리한다', '🗂️', 1, 'total', totAtLeast('cards', 1).test),
  S('s-brief', '보고는 짧게', '주간 브리핑의 제안 1건을 실행한다', '📋', 1, 'story', (x) => (x.core.campaign.briefMemo?.done.length ?? 0) >= 1),
  S('s-pick', '우리 애 뽑았다', '신인 드래프트에서 1명을 지명한다', '🎓', 1, 'total', totAtLeast('picks', 1).test),
  S('s-season', '방구석 단장 졸업', '첫 시즌 결산을 마친다', '🎉', 1, 'total', totAtLeast('seasons', 1).test),
];

const G = mk('game');
const GAME: AchvDef[] = [
  G('g-10', '빠따가 터진 날', '한 경기 10득점 이상으로 승리', '💥', 1, 'game', (x) => won(x) && g(x).my >= 10),
  G('g-15', '핸드볼 스코어', '한 경기 15득점 이상으로 승리', '🤾', 2, 'game', (x) => won(x) && g(x).my >= 15),
  G('g-20', '여기 농구장 아닙니다', '한 경기 20득점 이상으로 승리', '🏀', 3, 'game', (x) => won(x) && g(x).my >= 20),
  G('g-shutout', '한 점도 못 준다', '무실점으로 승리', '🧱', 1, 'game', (x) => won(x) && g(x).opp === 0),
  G('g-1-0', '한 점이면 충분해', '1 대 0 으로 승리', '☝️', 2, 'game', (x) => won(x) && g(x).my === 1 && g(x).opp === 0),
  G('g-cg', '불펜은 오늘 휴가', '투수 1명만 던져 승리 (완투승)', '🦾', 3, 'game', (x) => won(x) && g(x).pit.length === 1),
  G('g-cgso', '혼자 다 했다', '투수 1명만 던져 무실점 승리 (완봉승)', '👑', 3, 'game', (x) => won(x) && g(x).pit.length === 1 && g(x).opp === 0),
  G('g-onehit', '안타 하나가 뭐라고', '상대를 1안타 이하로 묶고 승리', '🤏', 3, 'game', (x) => won(x) && g(x).oppHits <= 1),
  G('g-nohit', '노히트 노런', '상대를 무안타·무실점으로 묶고 승리', '🚫', 4, 'game', (x) => won(x) && g(x).oppHits === 0 && g(x).opp === 0, { hidden: '전광판 안타 칸에 0 이 끝까지 남는 날' }),
  G('g-k10', '닥터 K', '투수 1명이 한 경기 탈삼진 10개 이상', '🌀', 1, 'game', (x) => !!x.r && g(x).pit.some((p) => p.so >= 10)),
  G('g-k15', '선풍기 9대', '한 경기 팀 탈삼진 15개 이상', '🪭', 2, 'game', (x) => !!x.r && g(x).pit.reduce((s, p) => s + p.so, 0) >= 15),
  G('g-walkoff', '집에 가자', '끝내기 승리 (홈, 9회 이후 마지막 공격에서 결승점)', '🎆', 1, 'game', (x) => won(x) && g(x).walkoff),
  G('g-walkoff-hr', '굿바이 홈런', '끝내기 홈런으로 승리', '🚀', 2, 'game', (x) => won(x) && x.r!.result.events.some((e) => e.type === 'walkoff' && e.teamId === x.core.userId && e.text.includes('홈런'))),
  G('g-cb3', '약속의 8회', '3점 차 이상 뒤지다가 역전승', '🔄', 1, 'game', (x) => won(x) && g(x).maxBehind >= 3),
  G('g-cb5', '이걸 뒤집네', '5점 차 이상 뒤지다가 역전승', '🙃', 2, 'game', (x) => won(x) && g(x).maxBehind >= 5),
  G('g-cb7', '야구 몰라요', '7점 차 이상 뒤지다가 역전승', '🤯', 4, 'game', (x) => won(x) && g(x).maxBehind >= 7),
  G('g-extra', '퇴근은 없다', '연장전(10회 이후)에서 승리', '🌙', 1, 'game', (x) => won(x) && x.r!.result.innings >= 10),
  G('g-12', '무박 2일', '12회까지 가서 승리', '🛌', 2, 'game', (x) => won(x) && x.r!.result.innings >= 12),
  G('g-hr2', '멀티포', '타자 1명이 한 경기 홈런 2개 이상', '✌️', 1, 'game', (x) => !!x.r && g(x).bat.some((b) => b.hr >= 2)),
  G('g-hr3', '오늘 야구 혼자 하나', '타자 1명이 한 경기 홈런 3개 이상', '🎇', 4, 'game', (x) => !!x.r && g(x).bat.some((b) => b.hr >= 3)),
  G('g-team-hr4', '홈런 공장 가동', '한 경기 팀 홈런 4개 이상', '🏭', 2, 'game', (x) => !!x.r && g(x).bat.reduce((s, b) => s + b.hr, 0) >= 4),
  G('g-h4', '치면 안타', '타자 1명이 한 경기 4안타 이상', '🎯', 1, 'game', (x) => !!x.r && g(x).bat.some((b) => b.h >= 4)),
  G('g-h5', '5타수 5안타', '타자 1명이 한 경기 5안타 이상', '🖐️', 3, 'game', (x) => !!x.r && g(x).bat.some((b) => b.h >= 5)),
  G('g-rbi6', '타점 먹방', '타자 1명이 한 경기 6타점 이상', '🍽️', 2, 'game', (x) => !!x.r && g(x).bat.some((b) => b.rbi >= 6)),
  G('g-hits20', '불방망이', '한 경기 팀 안타 20개 이상', '🔥', 2, 'game', (x) => !!x.r && g(x).myHits >= 20),
  G('g-big6', '빅이닝', '한 이닝에 6득점 이상', '📈', 1, 'game', (x) => !!x.r && g(x).myLine.some((v) => v >= 6)),
  G('g-big9', '타자 일순', '한 이닝에 9득점 이상', '🎡', 3, 'game', (x) => !!x.r && g(x).myLine.some((v) => v >= 9)),
  G('g-rain-win', '우중 혈투', '비 오는 홈경기에서 승리', '🌧️', 1, 'game', (x) => won(x) && x.r!.crowd?.weather === 'rain'),
  G('g-soldout-win', '만원 관중 앞에서', '매진된 홈경기에서 승리', '🎊', 1, 'game', (x) => won(x) && !!x.r!.crowd?.soldOut),
  G('g-climb', '두 계단 점프', '한 경기로 순위가 2계단 이상 오른다 (20경기 이후)', '🪜', 2, 'game', (x) => !!x.r && !x.r.post && x.r.day >= 20 && x.r.rankBefore - x.r.rankAfter >= 2),
];

const E = mk('season');
const SEASON: AchvDef[] = [
  E('se-rank7', '탈꼴찌', '정규시즌을 꼴찌가 아닌 순위로 마친다', '🥾', 1, 'season', (x) => !isLast(x.core, x.rec!.rank)),
  E('se-rank5', '희망 고문', '정규시즌 6위로 마친다 (한 칸 차이로 가을야구 탈락)', '😮‍💨', 2, 'season', (x) => x.rec!.rank === postTeams(x.core) + 1),
  E('se-rank4', '가을 냄새', '정규시즌 5위 이내로 마친다 (가을야구 진출권)', '🍂', 2, 'season', (x) => inPost(x.core, x.rec!.rank)),
  E('se-rank1', '정규시즌 우승', '정규시즌 1위로 마친다', '🥇', 3, 'season', (x) => x.rec!.rank === 1),
  E('se-500', '5할 본능', '정규시즌 승률 .500 이상', '⚖️', 1, 'season', (x) => pct(x.rec!) >= 0.5),
  E('se-600', '올해는 다르다(진짜로)', '정규시즌 승률 .600 이상', '📣', 3, 'season', (x) => pct(x.rec!) >= 0.6),
  E('se-700', '리그 파괴자', '정규시즌 승률 .700 이상', '☄️', 4, 'season', (x) => pct(x.rec!) >= 0.7),
  E('se-w5', '분위기 탔다', '정규시즌 5연승', '🌊', 1, 'game', (x) => streaks(x.core).w >= 5, { progress: (x) => [streaks(x.core).w, 5] }),
  E('se-w8', '질 것 같지가 않다', '정규시즌 8연승', '🚄', 2, 'game', (x) => streaks(x.core).w >= 8, { progress: (x) => [streaks(x.core).w, 8] }),
  E('se-w12', '지는 법을 잊었다', '정규시즌 12연승', '🛸', 4, 'game', (x) => streaks(x.core).w >= 12, { progress: (x) => [streaks(x.core).w, 12] }),
  E('se-nol3', '연패는 남의 일', '한 시즌 내내 3연패 없이 정규시즌을 마친다', '🧘', 4, 'season', (x) => streaks(x.core).n >= seasonGames(x.core) && streaks(x.core).l <= 2),
  E('se-post-win', '가을에 이겼다', '포스트시즌 경기에서 1승', '🍁', 2, 'game', (x) => won(x) && !!x.r!.post),
  E('se-sweep', '빗자루 들고 왔다', '포스트시즌 시리즈를 무패로 통과', '🧹', 3, 'game', (x) => won(x) && !!x.r!.post && (x.r!.post.round === 'WC' ? wcSweep(x) : x.r!.post.oppW === 0 && x.r!.post.myW * 2 > x.r!.post.bestOf)),
  E('se-ks-win', '한국시리즈 1승', '한국시리즈 경기에서 1승', '🏟️', 3, 'game', (x) => won(x) && x.r!.post?.round === 'KS'),
  E('se-game7', '끝장 승부', '한국시리즈 7차전에서 승리', '7️⃣', 4, 'game', (x) => won(x) && x.r!.post?.round === 'KS' && x.r!.post.gameNo === 7),
  E('se-upset', '도장 깨기', '정규시즌 5위로 와일드카드 결정전부터 한국시리즈까지 진출', '🥋', 4, 'season', (x) => x.rec!.rank === postTeams(x.core) && postRank[x.rec!.post] >= 3),
  E('se-hrking', '홈런왕 배출', '우리 선수가 리그 홈런왕', '💣', 2, 'season', (x) => hasTitle(x, 'hr')),
  E('se-batking', '타격왕 배출', '우리 선수가 리그 타격왕', '🏏', 2, 'season', (x) => hasTitle(x, 'avg')),
  E('se-winking', '다승왕 배출', '우리 선수가 리그 다승왕', '🔟', 2, 'season', (x) => hasTitle(x, 'w')),
  E('se-eraking', '짠물 에이스', '우리 선수가 리그 평균자책점 1위', '🧂', 2, 'season', (x) => hasTitle(x, 'era')),
  E('se-svking', '뒷문 단속반', '우리 선수가 리그 세이브왕', '🔒', 2, 'season', (x) => hasTitle(x, 'sv')),
  E('se-mvp', '리그의 주인공', '우리 선수가 리그 MVP', '🌟', 3, 'season', (x) => awardsOf(x.core).mvp?.teamId === x.core.userId),
  E('se-rookie', '올해의 신인', '우리 선수가 신인왕', '🐣', 3, 'season', (x) => awardsOf(x.core).rookie?.teamId === x.core.userId),
  E('se-gg3', '황금 장갑 세 켤레', '한 시즌 골든글러브 수상자 3명 이상', '🧤', 2, 'season', (x) => myGloves(x) >= 3),
  E('se-titles5', '타이틀 싹쓸이', '한 시즌 개인 타이틀 10개 중 5개 이상을 우리 선수가 차지', '🗃️', 3, 'season', (x) => myTitles(x) >= 5),
  E('se-triple', '타격 3관왕', '한 선수가 타격왕·홈런왕·타점왕을 모두 차지', '🔱', 4, 'season', (x) => {
    const ts = awardsOf(x.core).titles;
    const of = (c: string) => ts.find((t) => t.cat === c)?.row;
    const a = of('avg');
    return !!a && a.teamId === x.core.userId && of('hr')?.pid === a.pid && of('rbi')?.pid === a.pid;
  }),
  E('se-hr25', '25홈런 타자', '한 시즌 홈런 25개 이상인 타자 보유', '🌋', 4, 'season', (x) => some(x, (p) => p.bat.hr >= 25)),
  E('se-p12', '12승 투수', '한 시즌 12승 이상인 투수 보유', '🗿', 4, 'season', (x) => some(x, (p) => p.pit.w >= 12)),
  E('se-grade-s', '성적표에 S', '시즌 평가 S 등급', '💯', 3, 'season', (x) => x.rec!.grade === 'S'),
  E('se-jump', '수직 상승', '직전 시즌보다 순위를 4계단 이상 올린다', '🛗', 3, 'season', (x) => {
    const h = x.core.campaign.history;
    return h.length >= 2 && h[h.length - 2].rank - x.rec!.rank >= 4;
  }),
];

export const LIST1: AchvDef[] = [...START, ...GAME, ...SEASON];
export { some, won, g as gv };
