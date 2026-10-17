// 화면 정의 목록. 화면 = { id, fixture, steps, only?, allow? }
//   fixture: scripts/screens/fixtures.ts 가 만드는 세이브 이름 (없으면 빈 localStorage)
//   steps:   { click: testid 또는 글 } · { dblclick } · { wait: ms } · { fill: testid, text } · { scroll: 'bottom'|'top' } · { key }
//            click 에는 nth(같은 것이 여럿일 때) · optional(없어도 넘어감) · when('mobile'|'desktop') 을 붙일 수 있다
//   only:    'mobile' | 'desktop' — 그 레이아웃에만 있는 화면
//   query:   주소 뒤에 붙일 쿼리 ('?l=...' — 도전 링크 · '?fxT=2.4' — 우승 세리머니 시간 고정)
//   motion:  true 면 움직임 줄이기를 끄고 찍는다 (기본은 reducedMotion 'reduce')
//   steps 의 { waitFor: testid, timeout? } 은 그 요소가 보일 때까지 기다린다
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
/** 스토브리그의 이적 창구: 트레이드 제안 카드가 먼저 뜨면 [거절]하고 다시 연다 */
// 스토브리그 카드(재계약 여럿 · 포스팅 · 트레이드 제안)가 몇 장이든 첫 선택지로 넘긴다
const STOVE_SKIP = Array.from({ length: 5 }, () => [c('선택', { nth: 1, optional: true }), { wait: 300 }, c('stove-market', { optional: true })]).flat();
const STOVE_DESK = [c('stove-market'), ...STOVE_SKIP, m('side-squad')];
/** 우리 선수단 목록의 정렬 칩 (데스크톱은 영입 시장에도 있다) */
const RSORT = 'css:[data-testid="browser-roster"] [data-testid="list-sort"]';
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

/** 도전과제 화면: 모바일은 상단 메뉴, 데스크톱은 상단바의 🏆 */
const ACHV = [m('m-top'), m('menu-achv'), d('open-achv-top')];
/** 도전과제 저장(kbl-achv-v1)의 예: 일부 달성 + 누적 카운터 */
const ACHV_UI = {
  'kbl-achv-v1': JSON.stringify({
    v: 1,
    done: Object.fromEntries(['s-first-game', 's-first-win', 's-first-loss', 's-home-win', 's-lineup', 's-sign', 's-season', 'g-10', 'g-shutout', 'g-walkoff', 'g-cb3', 'se-rank7', 'se-w5', 'c-sell10', 'q-foreign', 't-stage1', 't-star1', 'o-lose10', 'o-walkoff-loss', 'o-no-draft', 'n-games100', 'n-hr100'].map((id, i) => [id, `2026-10-${String(1 + (i % 13)).padStart(2, '0')}`])),
    totals: { games: 212, wins: 97, losses: 110, ties: 5, hr: 188, runs: 930, sellouts: 31, att: 612400, seasons: 2, signs: 7, releases: 4, trades: 1, picks: 6, cards: 23, walkoffs: 6, clubs: 1 },
  }),
};

export const SCREENS = [
  // ── 초기 화면
  S('title', null, []),
  S('title-save', 'opened', []),
  S('title-nick', null, st(['new-game'])),
  S('title-nick-typed', null, [c('new-game'), { fill: 'nick-input', text: '한라 오렌지스' }]),
  S('title-overwrite', 'opened', st(['new-game'])),
  S('title-settings', null, st(['open-settings'])),
  S('whats-new', null, st(['version-badge'])),
  S('title-hof', 'over', st(['open-hof'])),
  S('title-hof-empty', null, st(['open-hof'])),
  S('title-hof-detail', 'over', st(['open-hof', 'hof-club'])),
  S('title-hof-record', 'over', st(['open-hof', 'hof-record'])),
  // 공유 링크(?from=유형)로 연 초기 화면: 세이브 없음 · 있음
  S('title-from', null, [], { query: '?from=w6' }),
  S('title-from-over', null, [], { query: '?from=x4' }),
  S('title-from-save', 'opened', [], { query: '?from=p3-post' }),

  // ── 공유 시트 (결산 · 우승 엔딩 · 연고 이전 · 명예의 전당의 역대 구단 줄)

  S('share-ended', 'ended', game({ scroll: 'bottom' }, 'share-open', { wait: 900 })),
  S('share-ended-fail', 'endedFail', game({ scroll: 'bottom' }, 'share-open', { wait: 900 })),
  S('share-ending', 'ending', game('share-open', { wait: 900 })),
  S('share-over', 'over', game({ scroll: 'bottom' }, 'share-open', { wait: 900 })),
  S('share-hof', 'over', st(['open-hof', 'share-club', { wait: 900 }])),
  S('share-text', 'ended', game({ scroll: 'bottom' }, 'share-open', { wait: 900 }, 'share-text-toggle')),
  S('share-note', 'ended', game({ scroll: 'bottom' }, 'share-open', { wait: 900 }, { fill: 'share-note-input', text: '답답해서 내가 해 봤다. 3년 걸렸다' }, 'share-text-toggle')),
  S('share-copied', 'ended', game({ scroll: 'bottom' }, 'share-open', { wait: 900 }, 'share-copy')),

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
  S('help-pen', 'farm', game(...SQUAD, 'squad-view-arms', 'css:[data-testid="squad-arms"] button[aria-label$="설명"]')),
  S('help-ovr-card', 'farm', game(...SQUAD, 'css:[data-testid="squad-bench"] [data-item]', 'css:[role="dialog"] button[aria-label$="설명"]')),
  S('pen-style-swarm', 'farm', game(...SQUAD, 'squad-view-arms', 'pen-style-swarm', { wait: 400 })),

  // ── 홈
  S('home', 'opened', game()),
  S('home-away', 'away', game()),
  // 상대 구장 성장: 같은 13,000석 개막 구단의 1시즌 · 9시즌+ 원정
  S('home-away-early', 'awayEarly', game()),
  S('home-away-late', 'awayLate', game()),
  S('home-full', 'opened', game({ dblclick: 'stadium-pan' }), { only: 'mobile' }),
  S('home-soldout', 'soldout', game()),
  S('home-injury', 'injury', game()),
  S('home-cashlow', 'cashlow', game()),
  S('home-season3', 'season3', game()),
  S('home-dynasty', 'dynasty', game()),
  // 세로 폰: 구장이 확대돼 시설 태그가 화면 밖이면 하단 고정 버튼, 아니면 태그 (할 일 줄 수에 따라 달라진다)
  S('fac-seats', 'season3', game(m('fac-fixed-seats', { optional: true }), m('fac-seats', { optional: true }), d('fac-seats'))),
  S('fac-food', 'season3', game(m('fac-fixed-food', { optional: true }), m('fac-food', { optional: true }), d('fac-food'))),
  S('fac-training', 'season3', game(m('fac-fixed-training', { optional: true }), m('fac-training', { optional: true }), d('fac-training'))),
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
  // 방출 추천: 할 일 → 조치 시트 → 이적 창구(방출 후보순) → 추천 선수 카드
  S('rel-todo', 'relFull', game()),
  S('rel-remedy', 'relFull', game('방출 검토')),
  S('rel-desk', 'relFull', game('방출 검토', '이적 창구 열기', { wait: 300 })),
  S('rel-card', 'relFull', game('방출 검토', '이적 창구 열기', { wait: 300 }, 'css:[data-testid="browser-roster"] [data-pid]:has([data-testid="rel-badge"]) button')),
  S('rel-open', 'relOpen', game()),
  S('rel-stove', 'relStove', game(...STOVE_DESK, RSORT, RSORT, RSORT)),
  // 내년 살림 미리보기 (payforecast.ts): 결산의 블록(적자·흑자) · [이적 시장(방출 후보순)] · 시즌 후반 재무 탭 한 줄과 도움말 · 할 일과 조치 시트
  S('ended-pay-loss', 'endedPayLoss', game('css:[data-testid="pay-forecast"] > div')),
  S('ended-pay-gain', 'endedPayGain', game('css:[data-testid="pay-forecast"] > div')),
  S('club-finance-pay', 'payLate', game(...CLUB, '재무')),
  S('club-finance-pay-help', 'payLate', game(...CLUB, '재무', 'css:[data-testid="pay-forecast-line"] button')),
  S('todo-pay', 'payTodo', game()),
  S('todo-pay-remedy', 'payTodo', game('내년 적자 예상')),
  S('rel-stove-card', 'relStove', game(...STOVE_DESK, RSORT, RSORT, RSORT, 'css:[data-testid="browser-roster"] [data-pid]:has([data-testid="rel-badge"]) button')),

  // ── 선수단 (모바일: 선수단 탭, 데스크톱: [선수단 열기] 모달)
  S('roster-field', 'farm', game(...SQUAD)),
  S('roster-field-s3', 'season3', game(...SQUAD)),
  S('roster-fixed', 'fixedStart', game(...SQUAD)),
  S('roster-fixed-slot', 'fixedStart', game(...SQUAD, 'css:[data-testid="squad-field"] [data-item]:has([data-testid="fixed-start"])', 'slot-row')),
  S('roster-injury', 'injury', game(...SQUAD)),
  S('roster-farm', 'farm', game(...SQUAD, 'squad-farm-toggle')),
  S('roster-slot', 'season3', game(...SQUAD, WEAK)),
  S('roster-slot-pick', 'season3', game(...SQUAD, WEAK, 'slot-row')),
  S('roster-slot-swapped', 'season3', game(...SQUAD, WEAK, 'slot-row', 'slot-swap', { wait: 300 })),
  S('roster-order', 'farm', game(...SQUAD, 'squad-view-order')),
  S('roster-arms', 'farm', game(...SQUAD, 'squad-view-arms')),
  S('roster-arms-slot', 'farm', game(...SQUAD, 'squad-view-arms', 'css:[data-testid="squad-rotation"] [data-item]')),
  S('roster-penover', 'penover', game(...SQUAD, 'squad-view-arms')),
  // 부상자 명단(재활): 2군 트레이의 재활 칩 · 재활 선수 카드 · 자리 시트의 재활 줄 · 직접 말소(자동 운영 끔)
  S('rehab-tray', 'rehab', game(...SQUAD, 'squad-farm-toggle')),
  S('rehab-card', 'rehab', game(...SQUAD, 'squad-farm-toggle', 'css:[data-testid="squad-rehab"] [data-item]')),
  S('rehab-slot', 'rehab', game(...SQUAD, 'css:[data-testid="squad-field"] [data-item]')),
  S('il-card', 'injuryManual', game(...SQUAD, 'css:[data-testid="squad-field"] [data-injured]', 'slot-card')),
  S('il-remedy', 'injuryManual', game('부상:')),
  S('roster-recs', 'injury', game(...SQUAD, c('squad-recs-toggle', { optional: true }))),
  S('roster-from-chance', 'farm', game('pre-chance')),
  S('card-batter', 'farm', game(...SQUAD, 'css:[data-testid="squad-bench"] [data-item]')),
  S('card-order', 'farm', game(...SQUAD, 'squad-view-order', 'css:[data-testid="squad-order"] [data-item]')),
  S('card-slot', 'farm', game(...SQUAD, 'css:[data-testid="squad-field"] [data-item]', 'slot-card')),
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
  S('desk-fa-card', 'season3', game(...DESK, 'css:[data-testid="browser-market"] [data-testid="player-list"] > * button')),
  S('desk-fa-card-pick', 'season3', game(...DESK, 'css:[data-testid="browser-market"] [data-testid="player-list"] > * button', c('vs-pick', { nth: 2 }))),
  S('desk-posfilter', 'season3', game(...DESK, 'lkind-B', 'lpos-SS')),
  S('desk-table', 'season3', game(...DESK, 'view-toggle')),
  S('desk-added', 'season3', game(...DESK, 'add-sign', c('add-sign', { nth: 1 }))),
  S('desk-summary', 'season3', game(...DESK, 'add-sign', c('add-sign', { nth: 1 }), m('sum-toggle'))),
  S('desk-squad', 'season3', game(...DESK, m('side-squad'))),
  // FA 계약금 누진: 이번 시즌 FA 2명 영입 뒤
  S('desk-heat', 'faHeat', game(...DESK)),
  S('desk-heat-table', 'faHeat', game(...DESK, 'view-toggle')),
  S('desk-heat-card', 'faHeat', game(...DESK, 'css:[data-testid="browser-market"] [data-testid="player-list"] > * button')),
  S('desk-heat-summary', 'faHeat', game(...DESK, 'add-sign', c('add-sign', { nth: 1 }), m('sum-toggle'))),

  // ── 리그
  S('league-table', 'season3', game('리그')),
  S('league-more', 'season3', game('리그', '자세히: 승률')),
  S('league-leaders', 'season3', game('리그', '기록')),
  S('league-bracket', 'season3', game('리그', '대진표')),

  // ── 구단
  S('club-finance', 'season3', game(...CLUB, '재무')),
  S('club-finance-more', 'season3', game(...CLUB, '재무', '자세히: 누적 장부')),
  S('club-finance-cashlow', 'cashlow', game(...CLUB, '재무')),
  // 부채 한도: 50% · 80% · 초과 재무 화면, 설명, 매각 카드와 상세, 한도 초과 결산의 빨간 줄
  S('club-finance-debt50', 'debt50', game(...CLUB, '재무')),
  S('club-finance-debt80', 'debt80', game(...CLUB, '재무')),
  S('club-finance-debtover', 'debtOver', game(...CLUB, '재무')),
  S('event-debtsale', 'debtSale', game()),
  S('event-rental', 'rental', game()),
  S('event-mlb', 'mlbPost', game()),
  S('event-mlb-detail', 'mlbPost', game(c('ev-more', { optional: true }))),
  S('event-buyout', 'buyout', game(c('ev-more', { optional: true }))),
  S('event-debtsale-detail', 'debtSale', game(c('ev-more', { optional: true }))),
  S('ended-debtover', 'endedDebt', game()),
  S('ended-debtmood-warn', 'endedMoodWarn', game()),
  S('ended-debtmood', 'endedMood', game()),
  S('ended-luxtax', 'endedLux', game()),
  S('briefing-debtmood', 'briefMood', game()),
  S('club-finance-luxover', 'luxOver', game(...CLUB, '재무')),
  S('academy-farm', 'academy', game(...SQUAD, 'squad-farm-toggle')),
  S('share-dome', 'domeDone', game({ scroll: 'bottom' }, 'share-open', { wait: 900 })),
  S('club-stadium', 'season3', game(...CLUB, '구장')),
  S('club-news', 'season3', game(...CLUB, '뉴스')),
  // ── 왕조 프로젝트 (첫 우승 뒤)
  S('club-projects-new', 'projects', game(...CLUB, '구장', { scroll: 'bottom' })),
  S('club-projects', 'dome2', game(...CLUB, '구장', { scroll: 'bottom' })),
  S('club-project-detail', 'dome2', game(...CLUB, '구장', { scroll: 'bottom' }, c('우리 돔구장 상세'))),
  S('club-project-give', 'dome3', game(...CLUB, '구장', { scroll: 'bottom' }, c('도민 환원 상세'))),
  S('ended-projects', 'ending', game('계속', c('stove-projects'))),
  S('home-dome1', 'dome1', game()),
  S('home-dome2', 'dome2', game()),
  S('home-dome3', 'dome3', game()),
  S('title-hof-give', 'dome3', st(['open-hof'])),
  // 선수단 윤리 교육 줄 (스캔들이 생길 수 있는 구단부터 보인다)
  S('club-ethics', 'dynasty', game(...CLUB, '재무', { scroll: 'bottom' })),

  // ── 브리핑 · 이벤트
  S('briefing', 'briefing', game()),
  S('briefing-detail', 'briefing', game('brief-open')),
  S('event', 'event', game()),
  S('event-farm', 'eventFarm', game()),
  // 사건 상세 시트
  S('event-detail', 'event', game(c('ev-more', { optional: true }))),
  S('event-farm-detail', 'eventFarm', game(c('ev-more', { optional: true }))),
  // 부상 대체 선택 카드: 타자 · 투수 · 상세 시트 · 10경기 이상(부상자 명단 + 콜업 후보) · 설정의 토글
  S('event-sub-bat', 'eventSubBat', game()),
  S('event-sub-pit', 'eventSubPit', game()),
  S('event-sub-detail', 'eventSubBat', game(c('ev-more', { optional: true }))),
  S('event-sub-il', 'eventSubIl', game()),
  S('event-sub-il-detail', 'eventSubIl', game(c('ev-more', { optional: true }))),
  S('midcheck', 'midcheck', game()),
  // 후반 스캔들: 「트레이너의 보고」 카드 · 상세 시트
  S('scandal-card', 'dope', game()),
  S('scandal-detail', 'dope', game(c('ev-more', { optional: true }))),
  // 제재금이 보이는 승부조작 카드 「사무국의 전화」
  S('scandal-fix', 'fixcard', game()),
  S('scandal-fix-detail', 'fixcard', game(c('ev-more', { optional: true }))),
  // 덮은 일이 따라다닌다: 기자 카드 · 상세 · 선수단 🤫 · 선수 카드 태그 · 캠페인·재무의 적발 위험 · 브리핑 징후 경고
  S('scandal-press', 'pressCard', game()),
  S('scandal-press-detail', 'pressCard', game(c('ev-more', { optional: true }))),
  S('scandal-squad', 'secretQuiet', game(...SQUAD)),
  S('scandal-playercard', 'secretQuiet', game(...SQUAD, 'css:[data-testid="squad-field"] [data-item]:has([data-testid="secret-tag"])')),
  S('scandal-campaign', 'secretQuiet', game('캠페인', { scroll: 'bottom' })),
  S('scandal-finance', 'secretQuiet', game(...CLUB, '재무')),
  S('scandal-brief-warn', 'briefWarn', game()),
  // 적발: 리그 사무국 긴급 발표 1건 · 2건(넘기기) · 결산의 한 줄 요약
  S('scandal-exposure', 'exposed', game()),
  S('scandal-exposure-2', 'exposed2', game()),
  S('scandal-exposure-2b', 'exposed2', game('exposure-next')),
  S('scandal-exposed-line', 'exposed2', game('exposure-next', 'exposure-next')),
  // 트레이드 제안 3유형 · 상세(전→후 표 · 비교) · 역제안 상세 · 역제안 결과
  S('trade-now', 'tradeNow', game()),
  S('trade-now-detail', 'tradeNow', game('ev-more')),
  S('trade-future', 'tradeFuture', game()),
  S('trade-future-detail', 'tradeFuture', game('ev-more')),
  S('trade-dump', 'tradeDump', game()),
  S('trade-dump-detail', 'tradeDump', game('ev-more')),
  S('trade-counter-detail', 'tradeNow', game(c('ev-more', { nth: 2 }))),
  S('trade-counter-result', 'tradeNow', game(c('ev-select', { nth: 2 }), { wait: 400 })),
  // 혹사 카드 「팔은 소모품이 아니다」
  S('arm-card', 'arm', game()),
  S('arm-detail', 'arm', game('ev-more')),
  // 이적 창구의 [트레이드 시장에] 토글 (꺼짐 · 켜짐)
  S('desk-block-off', 'tradeWindow', game(...DESK, m('side-squad'))),
  // 1군이 꽉 찼을 때 영입: 그 줄 아래에 내보낼 후보 3명 → [2군] → 확정 → 되돌리기
  S('desk-full-inline', 'relFull', game(...DESK, 'add-sign', { wait: 400 })),
  S('desk-full-picked', 'relFull', game(...DESK, 'add-sign', { wait: 300 }, 'cand-down', { wait: 300 })),
  // 표 보기에서 담으면 줄 아래가 없다 → 아래 바 위에 같은 후보
  S('desk-full-table', 'relFull', game(...DESK, 'view-toggle', { wait: 200 }, 'add-sign', { wait: 400 })),
  S('desk-undo', 'relFull', game(...DESK, 'add-sign', { wait: 300 }, 'cand-down', { wait: 300 }, 'desk-confirm', { wait: 300 })),
  // 폰은 줄 버튼이 없다: 줄을 눌러 카드에서 [트레이드 시장에 내놓기]
  S('desk-block-on', 'tradeWindow', game(...DESK, m('side-squad'), m('css:[data-testid="browser-roster"] [data-pid] button'), 'add-block', { wait: 300 })),

  // ── 경기 진행
  S('play-highlight', 'season3', game(...PLAY, { wait: 1000 })),
  S('play-away', 'away', game(...PLAY, { wait: 1000 })),
  S('summary', 'season3', game(...SUMMARY)),
  S('summary-box', 'season3', game(...SUMMARY, '자세히: 이닝별', { scroll: 'bottom' })),
  S('summary-more', 'season3', game(...SUMMARY, '자세히: 이닝별')),
  // 원정 경기 요약의 오늘의 정산: 입장 대신 원정 몫 (상대 구장 입장 수입의 28%)
  S('summary-away', 'away', game(...SUMMARY, '자세히: 이닝별', { scroll: 'bottom' })),
  S('summary-opener', 'fresh', game('order-submit', { wait: 600 }, c('▶ 경기 진행', { optional: true }), { wait: 600 }, c('건너뛰기 ▶▶', { optional: true }), { wait: 500 })),
  S('week', 'opened', game('1주', { wait: 1500 })),

  // ── 시즌 끝
  // 한국시리즈 우승: 확정 경기의 세리머니(홈·원정 · 움직임 줄이기) · 첫 우승 결산 · 2연패 결산 · 우승 다음 시즌 홈 구장
  S('champ-ceremony', 'ksClinchHome', game(...PLAY, { waitFor: 'champion-ceremony', timeout: 40000 }), { query: '?fxT=2.4', motion: true }),
  S('champ-skip', 'ksClinchHome', game(...PLAY, { wait: 800 }, '건너뛰기 ▶▶', { waitFor: 'champion-ceremony', timeout: 20000 }), { query: '?fxT=3.0', motion: true }),
  S('champ-toss', 'ksClinchHome', game(...PLAY, { waitFor: 'champion-ceremony', timeout: 40000 }), { query: '?fxT=3.0', motion: true }),
  S('champ-ceremony-calm', 'ksClinchHome', game(...PLAY, { waitFor: 'champion-ceremony', timeout: 40000 }), { query: '?fxT=2.4' }),
  S('champ-ceremony-away', 'ksClinchAway', game(...PLAY, { waitFor: 'champion-ceremony', timeout: 40000 }), { query: '?fxT=2.4', motion: true }),
  S('champ-ended', 'champ1', game(c('계속', { optional: true }))),
  S('champ-ended-bottom', 'champ1', game(c('계속', { optional: true }), { scroll: 'bottom' })),
  S('champ-ended-2', 'champ2', game(c('계속', { optional: true }))),
  S('champ-defending', 'defending', game()),
  S('ended', 'ended', game()),
  S('ended-bottom', 'ended', game({ scroll: 'bottom' })),
  S('ended-folds', 'ended', game('fold-bracket', 'fold-awards', 'fold-ledger')),
  S('ended-fail', 'endedFail', game()),
  S('ended-fail-bottom', 'endedFail', game({ scroll: 'bottom' })),
  // 덮은 일이 드러난 결산 (빨간 섹션)
  S('ended-exposed', 'exposed', game('exposure-next')),
  // 스토브리그: 결산 화면의 [이적 시장] → 이적 창구 · 스토브리그 트레이드 제안 카드
  S('ended-market', 'ended', game({ scroll: 'bottom' }, 'stove-market', { wait: 400 })),
  // 스토브리그 카드를 처리한 뒤(거절): [이적 시장]이 이적 창구를 연다
  // 카드를 처리하면 창구가 저절로 열린다 (두 번째 [이적 시장]은 필요 없을 때만 — 창구가 덮고 있으면 건너뛴다)
  S('ended-market-open', 'endedFail', game({ scroll: 'bottom' }, 'stove-market', { wait: 400 }, c('ev-select', { nth: 1, optional: true }), { wait: 1500 }, c('stove-market', { optional: true }), { wait: 800 })),
  S('stove-trade', 'stoveTrade', game()),
  S('stove-trade-detail', 'stoveTrade', game('ev-more')),
  // 마감: 예고(리그 일정표 · 할 일) · 등록 마감 뒤의 이적 창구(영입 꺼짐 · 사유 줄 · 시장 토글 꺼짐)
  S('league-deadline', 'deadlineSoon', game('리그')),
  S('desk-reg-closed', 'regClosed', game(...DESK)),
  S('desk-reg-closed-squad', 'regClosed', game(...DESK, m('side-squad'))),
  S('resign', 'resign', game()),
  S('draft-list', 'draft', game()),
  S('draft-posfilter', 'draft', game('lkind-P', 'lpos-SP')),
  S('draft-table', 'draft', game('view-toggle')),
  S('draft-card', 'draft', game('player-list')),
  S('draft-done', 'draftDone', game()),
  S('draft-done-bottom', 'draftDone', game({ scroll: 'bottom' })),

  // ── 정규시즌 마감 화면: 4위 와일드카드 · 1위 직행 · 6위 탈락(한 칸 차이) → 결산 · 8구단 4팀 · 닫은 뒤 · 리그 탭에서 다시 열기
  S('autumn-wc', 'introWc', game()),
  S('autumn-wc-bottom', 'introWc', game({ scroll: 'bottom' })),
  S('autumn-top', 'introTop', game()),
  S('autumn-out', 'introOut', game()),
  S('autumn-out-next', 'introOut', game('autumn-go', { wait: 2500 })),
  S('autumn-eight', 'introEight', game()),
  S('autumn-go', 'introWc', game('autumn-go', { wait: 400 })),
  S('autumn-reopen', 'post', game('리그', '대진표', 'autumn-reopen')),
  S('po-from-wc-bracket', 'poFromWc', game('리그', '대진표')),
  S('po-from-wc-home', 'poFromWc', game()),
  S('po-from-wc-table', 'poFromWc', game('리그')),
  // 가을야구 보기 속도: 기본 천천히 · [빨리] 누른 뒤 · 천천히 재생 중 (장면 점이 늘어난다)
  S('autumn-view', 'post', game()),
  S('autumn-view-fast', 'post', game('postview-fast')),
  S('autumn-view-play', 'post', game('▶ 경기 진행', { wait: 5200 })),
  S('autumn-line-late', 'post', game('▶ 경기 진행', { wait: 14000 })),

  // ── 포스트시즌
  S('post-home', 'post', game()),
  S('post-bracket', 'post', game('리그', '대진표')),
  // 10구단 와일드카드 결정전: 4위(1승 안고 시작) · 5위(2연승 필요) · 1승 1패 · 무승부 통과 · 탈락 결산
  S('wc-hi-home', 'wcHi', game()),
  S('wc-hi-bracket', 'wcHi', game('리그', '대진표')),
  S('wc-hi-table', 'wcHi', game('리그')),
  S('wc-help', 'wcHi', game('리그', '대진표', '가을야구 설명')),
  S('eight-help', 'eight', game('리그', '대진표', '가을야구 설명')),
  S('wc-lo-home', 'wcLo', game()),
  S('wc-lo-bracket', 'wcLo', game('리그', '대진표')),
  S('wc-lo-summary', 'wcLo', game(...SUMMARY)),
  S('wc-mid-bracket', 'wcMid', game('리그', '대진표')),
  S('wc-tie-bracket', 'wcTie', game('리그', '대진표')),
  S('wc-out', 'wcOut', game()),
  S('wc-out-bracket', 'wcOut', game({ wait: 2500 }, 'fold-bracket', { wait: 500 })),
  S('wc-out-ledger', 'wcOut', game({ wait: 2500 }, 'fold-ledger', { wait: 500 }, { scroll: 'bottom' })),
  // 8구단 세이브(10구단 체제 전의 게임): 홈 · 순위표 · 대진표(4팀) · 포스트시즌
  S('eight-home', 'eight', game()),
  S('eight-table', 'eight', game('리그')),
  S('eight-more', 'eight', game('리그', '자세히: 승률')),
  S('eight-bracket', 'eight', game('리그', '대진표')),
  S('eight-club', 'eight', game(...CLUB)),
  S('eight-summary', 'eight', game(...SUMMARY)),
  S('eight-post-bracket', 'eightPost', game('리그', '대진표')),
  // 진짜 옛 세이브 (옛 코드로 저장한 파일 그대로)
  S('old-home', 'oldReal', game()),
  S('old-table', 'oldReal', game('리그')),
  S('old-bracket', 'oldReal', game('리그', '대진표')),
  S('old-club', 'oldReal', game(...CLUB)),
  S('old-post-home', 'oldRealPost', game()),
  S('old-post-bracket', 'oldRealPost', game('리그', '대진표')),

  // ── 도전과제: 초기 화면에서 연 목록(달성 일부 · 빈 저장) · 게임 안에서 연 목록 · 범주 탭 · 필터 · 달성 알림
  S('achv-title', 'opened', st(['open-achv']), { ui: ACHV_UI }),
  S('achv-title-empty', null, st(['open-achv'])),
  S('achv-game', 'season3', game(...ACHV), { ui: ACHV_UI }),
  S('achv-cat', 'season3', game(...ACHV, 'achv-cat-odd'), { ui: ACHV_UI }),
  S('achv-cat-total', 'season3', game(...ACHV, 'achv-cat-total'), { ui: ACHV_UI }),
  S('achv-filter-done', 'season3', game(...ACHV, 'achv-filter-done'), { ui: ACHV_UI }),
  S('achv-toast', 'season3', game(...SUMMARY, '확인', { wait: 300 })),

  // ── 설정 · 끝
  S('settings-game', 'season3', game(m('m-top'), m('menu-settings'), d('menu'))),
  S('over', 'over', game()),
  S('ending', 'ending', game()),
  S('ending-after', 'ending', game('계속')),
];
