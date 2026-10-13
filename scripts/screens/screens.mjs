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
  // 관중 칩은 구장 그림 위에 얹는 오버레이 (세로 폰에서는 캔버스 밖 좌상단에 고정되지만 같은 크기를 쓴다)
  { kind: 'touch', testid: 'crowd-chip' },
  // 시트 손잡이: 바깥 탭·아래로 끌기·Esc 로도 닫히므로 높이 24px 를 유지한다 (키우면 모든 시트의 내용이 16px 밀린다)
  { kind: 'touch', testid: 'sheet-handle' },
  // 주간 브리핑의 대사와 제안 줄은 여러 줄로 읽는 글 (버튼 전체가 카드)
  { kind: 'wrap', text: '^“' },
  { kind: 'wrap', testid: 'brief-open' },
  // 사건 카드·조치 시트의 선택지는 제목 + 설명 두 줄짜리 카드형 버튼
  { kind: 'wrap', testid: 'ev-choice' },
  { kind: 'wrap', testid: 'remedy-sheet' },
  // ì ì¬ë ¥ ì¤ëªì [ìì¦ êµì²´] ì¤ì ë¬¸ì¥ í ì¤ì íµì§¸ë¡ ëë¥´ë ì ê¸° ë²í¼ (ì¢ì í­ììë ë ì¤ë¡ ì½íë¤)
  { kind: 'wrap', testid: 'pot-toggle' },
  // 촘촘한 표(선수 표)의 열 머리·필터 칩 줄: 한 화면에 열을 많이 보여 주는 화면이라 행 높이를 키우지 않는다
  { kind: 'touch', selector: 'table' },
];

const c = (click, o = {}) => ({ click, ...o });
const m = (click, o = {}) => ({ click, when: 'mobile', ...o });
const d = (click, o = {}) => ({ click, when: 'desktop', ...o });
const st = (xs) => xs.map((x) => (typeof x === 'string' ? c(x) : x));
/** 초기 화면에서 [이어하기] 뒤의 스텝 */
const game = (...xs) => [c('continue'), ...st(xs)];
const S = (id, fixture, steps, o = {}) => ({ id, fixture, steps, ...o });

/** 선수단 화면: 모바일은 하단 탭, 데스크톱은 왼쪽 패널의 [선수단 열기] */
const SQUAD = [m('선수단'), d('open-squad')];
/** 가장 약한 자리의 칸 (굵은 빨간 테두리) */
const WEAK = 'css:[data-testid="squad-field"] [data-weak]';
/** 2군 서랍의 첫 칩 */
const FARM_CHIP = 'css:[data-testid="squad-farm"] [data-item]';
const LIST = [...SQUAD, c('open-list')];
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

  // ── 개막전 오더 (선수단 화면 + 감독 대사 + [오더 제출])
  S('order-field', 'fresh', game()),
  S('order-order', 'fresh', game('squad-view-order')),
  S('order-arms', 'fresh', game('squad-view-arms')),
  S('order-recs', 'fresh', game('squad-recs-toggle')),
  S('order-slot', 'fresh', game(WEAK)),
  // 2군이 있는 새 게임: 2군 서랍 (야수 · 투수)
  S('new-farm', 'fresh', game('squad-farm-toggle')),
  S('new-farm-arms', 'fresh', game('squad-view-arms', 'squad-farm-toggle')),
  // 불펜 방침 스위치
  S('pen-style', 'farm', game(...SQUAD, 'squad-view-arms')),
  S('pen-style-swarm', 'farm', game(...SQUAD, 'squad-view-arms', 'pen-style-swarm', { wait: 400 })),

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
  S('ticket', 'season3', game(m('crowd-chip'), d('구장'))),
  S('menu', 'season3', game('m-top'), { only: 'mobile' }),
  S('campaign', 'season3', game('캠페인')),
  S('campaign-dynasty', 'dynasty', game('캠페인')),
  S('campaign-bottom', 'season3', game('캠페인', { scroll: 'bottom' })),
  S('todo', 'post', game()),
  S('todo-action', 'post', game('매진 —')),
  // 조치 시트
  S('remedy-penover', 'penover', game('불펜 과부하')),
  S('todo-penover', 'penover', game()),

  // ── 선수단 (모바일: 선수단 탭, 데스크톱: [선수단 열기] 모달)
  S('roster-field', 'farm', game(...SQUAD)),
  S('roster-field-s3', 'season3', game(...SQUAD)),
  S('roster-injury', 'injury', game(...SQUAD)),
  S('roster-farm', 'farm', game(...SQUAD, 'squad-farm-toggle')),
  S('roster-slot', 'season3', game(...SQUAD, WEAK)),
  S('roster-slot-swapped', 'season3', game(...SQUAD, WEAK, 'slot-swap', { wait: 300 })),
  S('roster-order', 'farm', game(...SQUAD, 'squad-view-order')),
  S('roster-arms', 'farm', game(...SQUAD, 'squad-view-arms')),
  S('roster-arms-slot', 'farm', game(...SQUAD, 'squad-view-arms', 'css:[data-testid="squad-rotation"] [data-item]')),
  S('roster-penover', 'penover', game(...SQUAD, 'squad-view-arms')),
  S('roster-recs', 'injury', game(...SQUAD, c('squad-recs-toggle', { optional: true }))),
  S('roster-from-chance', 'farm', game('pre-chance')),
  S('card-batter', 'farm', game(...SQUAD, 'css:[data-testid="squad-bench"] [data-item]')),
  S('card-order', 'farm', game(...SQUAD, 'squad-view-order', 'css:[data-testid="squad-order"] [data-item]')),
  S('card-slot', 'farm', game(...SQUAD, 'css:[data-testid="squad-field"] [data-item]', 'css:[data-testid="slot-row"] button')),
  S('card-farm', 'farm', game(...SQUAD, 'squad-farm-toggle', FARM_CHIP)),
  S('card-pot', 'farm', game(...SQUAD, 'squad-farm-toggle', FARM_CHIP, '잠재력 설명')),
  S('card-pot-toggle', 'farm', game(...SQUAD, 'squad-farm-toggle', FARM_CHIP, '잠재력 설명', 'pot-toggle')),

  // ── 명단 (선수단 화면의 [명단 ▤])
  S('fo-list', 'season3', game(...LIST)),
  S('fo-list-farm', 'season3', game(...LIST, 'squad-farm')),
  S('fo-table', 'season3', game(...LIST, 'view-toggle')),
  S('fo-salary', 'season3', game(...LIST, '연봉')),
  S('fo-card', 'season3', game(...LIST, 'player-list')),

  // ── 이적
  S('market-list', 'season3', game(...MARKET)),
  S('market-table', 'season3', game(...MARKET, 'view-toggle')),
  S('desk', 'season3', game(...DESK)),
  S('desk-table', 'season3', game(...DESK, 'view-toggle')),
  S('desk-added', 'season3', game(...DESK, 'add-sign', c('add-sign', { nth: 1 }))),
  S('desk-summary', 'season3', game(...DESK, 'add-sign', c('add-sign', { nth: 1 }), m('sum-toggle'))),
  S('desk-squad', 'season3', game(...DESK, m('side-squad'))),

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
  // 사건 상세 시트
  S('event-detail', 'event', game(c('ev-more', { optional: true }))),
  S('event-farm-detail', 'eventFarm', game(c('ev-more', { optional: true }))),
  S('midcheck', 'midcheck', game()),

  // ── 경기 진행
  S('play-highlight', 'season3', game(...PLAY, { wait: 1000 })),
  S('play-away', 'away', game(...PLAY, { wait: 1000 })),
  S('summary', 'season3', game(...SUMMARY)),
  S('summary-more', 'season3', game(...SUMMARY, '자세히: 이닝별')),
  S('summary-opener', 'fresh', game('order-submit', { wait: 600 }, c('▶ 경기 진행', { optional: true }), { wait: 600 }, c('건너뛰기 ▶▶', { optional: true }), { wait: 500 })),
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
