// 화면 정의 목록. 화면 = { id, fixture, steps, only?, allow? }
//   fixture: scripts/screens/fixtures.ts 가 만드는 세이브 이름 (없으면 빈 localStorage)
//   steps:   { click: testid 또는 글 } · { dblclick } · { wait: ms } · { fill: testid, text } · { scroll: 'bottom'|'top' } · { key }
//            click 에는 nth(같은 것이 여럿일 때) · optional(없어도 넘어감) · when('mobile'|'desktop') 을 붙일 수 있다
//   only:    'mobile' | 'desktop' — 그 레이아웃에만 있는 화면
// 클릭 대상을 못 찾으면 그 화면은 missing 으로 기록되고 순회는 계속된다.

/** 검사 허용 목록: { kind?, testid?, testidPrefix?, text?(정규식), selector? } — 의도된 것만 적는다 */
export const ALLOW = [
  // 구장 캔버스 위 오버레이는 cqw 단위로 그림에 맞춰 줄어든다 (의도)
  { kind: 'smallfont', testid: 'stadium' },
  { kind: 'touch', testid: 'stadium' },
  { kind: 'clip', testid: 'stadium-pan' },
  // 선수 이름 목록의 말줄임은 설계
  { kind: 'ellipsis', testid: 'player-list' },
];

const c = (click, o = {}) => ({ click, ...o });
const m = (click, o = {}) => ({ click, when: 'mobile', ...o });
const d = (click, o = {}) => ({ click, when: 'desktop', ...o });
const st = (xs) => xs.map((x) => (typeof x === 'string' ? c(x) : x));
/** 초기 화면에서 [이어하기] 뒤의 스텝 */
const game = (...xs) => [c('continue'), ...st(xs)];
const S = (id, fixture, steps, o = {}) => ({ id, fixture, steps, ...o });

const ROSTER = [m('선수단')];
const FO = [...ROSTER, c('teambar-open')];
const MARKET = [c('이적')];
const DESK = [...MARKET, c('open-desk')];
const CLUB = [m('구단')];
const PLAY = [c('▶ 경기 진행')];
const SUMMARY = [...PLAY, { wait: 600 }, c('건너뛰기 ▶▶', { optional: true }), { wait: 500 }];

export const SCREENS = [
  // ── 초기 화면
  S('title', null, []),
  S('title-save', 'opened', []),
  S('title-nick', null, st(['new-game'])),
  S('title-nick-typed', null, [c('new-game'), { fill: 'nick-input', text: '한라 오렌지스' }]),
  S('title-overwrite', 'opened', st(['new-game'])),
  S('title-settings', null, st(['open-settings'])),
  S('title-hof', 'over', st(['open-hof'])),
  S('title-hof-empty', null, st(['open-hof'])),

  // ── 개막전 오더
  S('order-field', 'fresh', game()),
  S('order-order', 'fresh', game('editor-view-order')),
  S('order-arms', 'fresh', game('editor-view-arms')),
  S('order-recs', 'fresh', game('editor-recs-toggle')),
  S('order-farm', 'farm', game('pre-chance', c('editor-farm-toggle', { optional: true }))),

  // ── 홈
  S('home', 'opened', game()),
  S('home-away', 'away', game()),
  S('home-full', 'opened', game({ dblclick: 'stadium-pan' }), { only: 'mobile' }),
  S('home-soldout', 'soldout', game()),
  S('home-injury', 'injury', game()),
  S('home-cashlow', 'cashlow', game()),
  S('home-season3', 'season3', game()),
  S('home-dynasty', 'dynasty', game()),
  S('fac-seats', 'season3', game(m('fac-fixed-seats'), d('fac-seats'))),
  S('fac-food', 'season3', game(m('fac-fixed-food'), d('fac-food'))),
  S('fac-training', 'season3', game(m('fac-fixed-training'), d('fac-training'))),
  S('ticket', 'season3', game('crowd-chip')),
  S('menu', 'season3', game('m-top'), { only: 'mobile' }),
  S('campaign', 'season3', game('캠페인')),
  S('campaign-dynasty', 'dynasty', game('캠페인')),
  S('campaign-bottom', 'season3', game('캠페인', { scroll: 'bottom' })),
  S('todo', 'post', game()),
  S('todo-action', 'post', game('지난 홈경기')),
  S('todo-penover', 'penover', game()),

  // ── 선수단
  S('roster-lineup', 'farm', game(...ROSTER)),
  S('roster-pitchers', 'farm', game(...ROSTER, '투수')),
  S('roster-farm', 'farm', game(...ROSTER, '2군')),
  S('roster-injury', 'injury', game(...ROSTER)),
  S('roster-penover', 'penover', game(...ROSTER, '투수')),
  S('card-batter', 'farm', game(...ROSTER, 'lineup-list')),
  S('card-pitcher', 'farm', game(...ROSTER, '투수', 'pitcher-list')),
  S('card-farm', 'farm', game(...ROSTER, '2군', 'farm-list')),
  S('card-pot', 'farm', game(...ROSTER, '2군', 'farm-list', '잠재력 설명')),
  S('card-pot-toggle', 'farm', game(...ROSTER, '2군', 'farm-list', 'pot-toggle')),

  // ── 프런트 오피스
  S('fo-diag', 'season3', game(...FO, '진단')),
  S('fo-squad', 'season3', game(...FO, '명단')),
  S('fo-depth', 'season3', game(...FO, '뎁스')),
  S('fo-salary', 'season3', game(...FO, '연봉')),
  S('fo-table', 'season3', game(...FO, '명단', 'view-toggle')),

  // ── 이적
  S('market-list', 'season3', game(...MARKET)),
  S('market-table', 'season3', game(...MARKET, 'view-toggle')),
  S('desk', 'season3', game(...DESK)),
  S('desk-table', 'season3', game(...DESK, 'view-toggle')),
  S('desk-added', 'season3', game(...DESK, 'add-sign', c('add-sign', { nth: 1 }))),
  S('desk-summary', 'season3', game(...DESK, 'add-sign', c('add-sign', { nth: 1 }), 'sum-toggle')),
  S('desk-squad', 'season3', game(...DESK, 'side-squad')),

  // ── 리그
  S('league-table', 'season3', game('리그')),
  S('league-more', 'season3', game('리그', '자세히: 승률')),
  S('league-leaders', 'season3', game('리그', '기록')),
  S('league-bracket', 'season3', game('리그', '대진표')),

  // ── 구단
  S('club-finance', 'season3', game(...CLUB, '재무')),
  S('club-finance-more', 'season3', game(...CLUB, '재무', '자세히: 누적 장부')),
  S('club-finance-cashlow', 'cashlow', game(...CLUB, '재무')),
  S('club-stadium', 'season3', game(...CLUB, '구장')),
  S('club-news', 'season3', game(...CLUB, '뉴스')),

  // ── 브리핑 · 이벤트
  S('briefing', 'briefing', game()),
  S('briefing-detail', 'briefing', game('brief-open')),
  S('event', 'event', game()),
  S('event-farm', 'eventFarm', game()),
  S('midcheck', 'midcheck', game()),

  // ── 경기 진행
  S('play-highlight', 'season3', game(...PLAY, { wait: 1000 })),
  S('play-away', 'away', game(...PLAY, { wait: 1000 })),
  S('summary', 'season3', game(...SUMMARY)),
  S('summary-more', 'season3', game(...SUMMARY, '자세히: 이닝별')),
  S('summary-opener', 'fresh', game('order-submit', { wait: 400 }, ...SUMMARY)),
  S('week', 'opened', game('1주', { wait: 1500 })),

  // ── 시즌 끝
  S('ended', 'ended', game()),
  S('ended-bottom', 'ended', game({ scroll: 'bottom' })),
  S('ended-folds', 'ended', game('fold-bracket', 'fold-awards', 'fold-ledger')),
  S('ended-fail', 'endedFail', game()),
  S('ended-fail-bottom', 'endedFail', game({ scroll: 'bottom' })),
  S('resign', 'resign', game()),
  S('draft-list', 'draft', game()),
  S('draft-table', 'draft', game('view-toggle')),
  S('draft-card', 'draft', game('player-list')),
  S('draft-done', 'draftDone', game()),
  S('draft-done-bottom', 'draftDone', game({ scroll: 'bottom' })),

  // ── 포스트시즌
  S('post-home', 'post', game()),
  S('post-bracket', 'post', game('리그', '대진표')),

  // ── 설정 · 끝
  S('settings-game', 'season3', game(m('m-top'), m('menu-settings'), d('menu'))),
  S('over', 'over', game()),
  S('ending', 'ending', game()),
  S('ending-after', 'ending', game('계속')),
];
