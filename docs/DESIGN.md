# KBL — 픽셀 야구 구단 타이쿤 (MVP 설계)

한 문장: **작은 야구장을 가진 가난한 구단을 운영해서, 눈에 보이게 성장시킨다.**
선수단 운영이 중심(B), 구장 경영이 보조(A). 내 선택의 결과는 **숫자와 야구장 화면 양쪽**에 드러나야 한다.

스택: React 19 + TypeScript + Vite + Zustand + Tailwind v4. 픽셀 폰트 Galmuri(로컬 번들).
공유 타입은 `src/game/types.ts` — **이 파일은 수정 금지**(계약). 금액 단위는 전부 만원.

## 모듈 소유권

| 영역 | 파일 | 담당 |
|---|---|---|
| 기반 | `package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`, `src/main.tsx`, `src/index.css`, `src/game/types.ts` | 오케스트레이터(수정 금지) |
| 게임 로직 | `src/game/*.ts` (types.ts 제외), `scripts/balance.ts` | worker-core |
| 구장 렌더러 | `src/stadium/*` | worker-stadium |
| 스토어 + UI | `src/store.ts`, `src/App.tsx`, `src/components/*` | worker-ui |

다른 담당의 파일은 만들거나 고치지 않는다. 아래 API 시그니처는 고정 계약이다.

## 1. 게임 로직 API (worker-core)

순수 함수. React/DOM 의존 금지. 난수는 `Rng = () => number` 를 인자로 받는다.

```ts
// src/game/rng.ts
export type Rng = () => number;
export function mulberry32(seed: number): Rng;
export function randInt(r: Rng, a: number, b: number): number; // a..b 포함
export function pick<T>(r: Rng, arr: T[]): T;
export function gauss(r: Rng): number; // 표준정규
export function clamp(v: number, lo: number, hi: number): number;

// src/game/format.ts
export function fmtMoney(v: number): string;   // 12500 -> "1.3억", 800 -> "800만", 음수는 "-"
export function fmtAvg(h: number, ab: number): string;   // ".312"
export function fmtEra(er: number, outs: number): string; // "3.45" / "-.--"
export function fmtIp(outs: number): string;   // "6.1"
export function fmtInt(v: number): string;     // 천단위 콤마

// src/game/ratings.ts
export function calcOvr(p: Player): number;
export function calcSalary(p: Player): number;            // 만원, KBO 최저연봉 3000 하한
export function teamStrength(t: Team): number;            // 0~99 표시용 전력
export function effDef(p: Player, pos: BatPos): number;   // 포지션 불일치 페널티 반영 수비

// src/game/lineup.ts
export function autoLineup(t: Team): void;   // t.lineup/rotation/bullpen/closer 재구성 (mutate)
export function fixLineup(t: Team): void;    // 로스터 변동 후 무효 pid 정리·빈칸 채움 (mutate, 유효 항목은 유지)

// src/game/schedule.ts
export const GAMES: number; // 84
export function buildSchedule(teamIds: string[], rng: Rng): Matchup[][]; // 84일 × 4경기, 팀당 홈 42

// src/game/economy.ts
export const SEAT_LV: { cap: number; cost: number; upkeep: number; name: string; desc: string }[];   // 5단계
export const FOOD_LV: { spend: number; sat: number; cost: number; upkeep: number; name: string; desc: string }[]; // 5단계
export const TRAIN_LV: { grow: number; inj: number; cost: number; upkeep: number; name: string; desc: string }[]; // 5단계(0=공터)
export const LOAN_LIMIT: number;   // 500000 (50억)
export const LOAN_STEP: number;    // 50000 (5억)
export const LOAN_RATE: number;    // 0.08 연이율
export const ROSTER_MAX: number;   // 28
export const MIN_BATTERS: number;  // 10
export const MIN_PITCHERS: number; // 8
export function refPrice(f: Facilities): number;           // 적정 티켓가(만원)
export function payroll(t: Team): number;                  // 연봉 총액
export function signingBonus(p: Player): number;           // 영입 계약금 (연봉의 25%)
export function releaseCost(p: Player, core: Core): number; // 방출 위약금 (잔여 연봉의 20%)
export function upgradeCost(kind: FacilityKind, f: Facilities): number | null; // 다음 단계 비용, 최대면 null
export function previewDemand(core: Core): number;         // 현재 조건(평일·맑음 가정)의 예상 관중 수요

// src/game/generate.ts
export function newCore(seed: number): Core;   // 8개 구단 + 선수 + FA + 일정 생성. 유저 = 'JEJ'
export function ledgerZero(): Ledger;

// src/game/sim.ts
export function simulateGame(home: Team, away: Team, rng: Rng,
  opts: { track: boolean; injMult?: Record<string, number> }): GameResult;
  // 선수 시즌 스탯·team.nextStarter·부상을 mutate. team.rec 는 건드리지 않음.

// src/game/season.ts
export function standings(teams: Team[]): Team[];          // 승률순 (승률 = W/(W+L)), 동률은 득실차
export function rankOf(teams: Team[], id: string): number; // 1~8
export function advanceDay(core: Core, rng: Rng): { core: Core; report: DayReport };
  // 입력 core 는 mutate 금지(structuredClone 후 작업). 하루치 4경기 시뮬 + 순위 + 재정 + 팬 + 부상 + 주간 훈련 성장 + 뉴스.
export function signPlayer(core: Core, pid: string): { core: Core; error?: string };
export function releasePlayer(core: Core, pid: string): { core: Core; error?: string };
export function upgradeFacility(core: Core, kind: FacilityKind): { core: Core; error?: string };
export function setTicketPrice(core: Core, price: number): Core;   // 0.5~4.0, 0.1 단위
export function borrow(core: Core): { core: Core; error?: string }; // LOAN_STEP 만큼
export function repay(core: Core): { core: Core; error?: string };
export function nextSeason(core: Core, rng: Rng): Core;   // 나이+1, 성장/노쇠, 연봉 재산정, 기록·일정·FA 리셋
export function seasonAwards(core: Core): { mvpBat: Player | null; mvpPit: Player | null; grade: 'S'|'A'|'B'|'C'|'D'; comment: string };
```

액션 함수가 `error` 를 돌려주면 core 는 변경 없이 그대로 반환한다. 에러 문구는 한국어 한 줄.

### 리그

KBO 참고, **전부 가상**. 새 게임은 10개 구단·81경기, 옛 세이브는 8개 구단·84경기 그대로(`docs/TEN_TEAMS.md`). 실존 구단명·별칭 금지:

| id | 구단 | 색 | 전력 tier | pop |
|---|---|---|---|---|
| SEL | 서울 듀오스 | #c2185b / #1b2233 | 63 | 0.95 |
| YIN | 용인 판다스 | #1a3a8f / #ffffff | 61 | 0.85 |
| BUS | 부산 타이탄스 | #0e7fb8 / #f26a1b | 59 | 0.90 |
| DGU | 대구 라이거스 | #1e56c4 / #ffd23f | 59 | 0.70 |
| GWJ | 광주 재규어스 | #d32f2f / #111111 | 60 | 0.80 |
| ICN | 인천 앵커스 | #b71c1c / #f5c518 | 57 | 0.60 |
| DJN | 대전 호크스 | #f57c00 / #212121 | 54 | 0.55 |
| JEJ | 제주 탠저린즈 (유저) | #f08a1c / #1f6b3a | 55 | 0.25 |
| SUW | 수원 매직스 | #6d3fb8 / #e9dcb0 | 58 | 0.60 |
| CHW | 창원 랩터스 | #00897b / #ffe082 | 56 | 0.50 |

옛 세이브에는 옛 이름(서울 스카이라인즈·한강 그리폰즈(`HAN`)·부산 씨호크스·대구 썬더킹스·광주 레드폭스·대전 팰컨스)이 그대로 남는다. 정의 조회는 `teamDef(id)` 가 `HAN` → `YIN` 으로 잇는다.

- 팀당 23명: 타자 13(C,1B,2B,3B,SS,LF,CF,RF,DH + 벤치 C·내야·외야·코너) / 투수 10(SP5, RP4, CP1).
- 능력치: tier 중심 정규분포(편차 7~8), 포지션 보정(C·SS·CF 수비↑, 1B·DH 파워↑). 20~97 클램프.
- **선수 스탯은 KBO 실제 리그 수준을 기준으로 보정**: 리그 타율 ≈ .265~.275, 팀당 경기 득점 ≈ 4.6~5.2, ERA ≈ 4.2~4.8, 풀시즌 환산 홈런왕 ≈ 35~45개(84경기면 20~27개), 3할 타자 다수 / 3할4푼 이상은 드물게.
- **KBO 스타 유형 아키타입**(실제 기록 규모를 본뜸, 이름은 전부 가명): 교타 외야수(.340/15HR형), 홈런왕 1루수(.285/40HR형), 30-30 3루수, 안방마님 포수, 수비형 유격수, 베테랑 지명타자, 리드오프 2루수, 외인 거포, 토종 에이스, 외인 1선발, 파이어볼러, 제구형 좌완, 끝판왕 마무리, 필승조 셋업. `tag` 필드에 설명 문구. 상위 팀 4명, 중위 3명, 하위 2명, 유저 팀 1명(베테랑 지명타자 또는 유망주).
- **가명**: 한국 성 + 이름 2음절 조합(3글자). 실존 유명 선수명과 겹치면 다시 뽑는 차단 목록(50명 이상)을 둔다. 리그 내 중복 금지. 외인은 지어낸 외국 이름(예: "로건 베일").
- 연봉: OVR 기반 볼록 곡선. OVR 50 ≈ 4천만, 60 ≈ 1.7억, 70 ≈ 4.6억, 80 ≈ 10억, 90 ≈ 18억. 24세 이하는 할인. 최저 3000.
- FA 풀 18명: 스타급 3(OVR 78~85), 준척 6(65~74), 저가·유망주 9(50~62, 일부는 pot 높음).

### 경기 시뮬 (타석 단위)

타석 결과 확률(50 = 평균): BB 8.8%, K 18%, HR 2.4%×(pow/50)^1.8, 인플레이 안타 BABIP .300 기준에 컨택·주력·구위·팀수비 보정. 2루타/3루타 비중은 파워/주력. 주자 진루 확률 모델, 병살 12%, 희생 득점.
9이닝, 연장 12회까지, **무승부 있음**(KBO식). 9회말 이후 홈팀 리드 시 즉시 종료(끝내기).
투수 운용: 선발 한계 타자 수 = 17 + sta×0.14, 초과 시 구위·제구 하락 → 이닝 교체. 불펜은 이닝마다 순서대로, 9회 이후 1~3점 리드면 마무리. 대량 실점 시 즉시 교체. 승/패/세이브 귀속.
부상 선수(injury>0)는 자동으로 벤치 최적 선수로 대체(로스터의 lineup 은 유지).
하이라이트(`track: true` 일 때만): `start`(선발 맞대결) → 홈런 전부, 역전·동점 깨는 적시타, 2타점 이상 적시타, 끝내기, 부상 → `final`. **최대 10개**로 추림(리드 변경·유저팀 이벤트 우선). text 예: `"한서준 투런 홈런!"`, sub 예: `"7회말 · 시즌 12호"`.
경기 후 부상 판정: 출전 선수당 0.35% × 훈련장 보정 → 3~16경기 결장.

### 경제 (유저 팀만 정산)

- 일정: 84경기(홈 42). 요일 = day % 6 → 화·수·목·금·토·일. 화~금은 야간(night), 토·일 주간.
- 홈경기 수요 = fans × 성적(0.75 + 0.5×최근10경기 승률, 3연승 이상 보너스) × 스타(상위 3명 star 합) × 상대 pop(0.9~1.15) × 요일(금 1.1, 토 1.3, 일 1.25) × 날씨(맑음 60% 1.0 / 흐림 25% 0.95 / 비 15% 0.6) × 가격((refPrice/price)^1.3) × 만족도(0.8 + fanSat/250) × 노이즈.
- 관중 = min(수용, 수요). 수요 초과분은 turnedAway → "입장 못한 팬" 뉴스로 **증설 유도**.
- 수입: 입장(관중×가격), 매점(관중×FOOD_LV.spend, 비 오면 ×0.8), 굿즈(스타성 연동), 리그 분배금·스폰서(매 경기, 팬 수·순위 연동).
- 지출: 연봉(총액/84 매 경기), 시설 유지비(홈경기), 훈련장 유지비 + 구단 운영비(매 경기), 대출 이자(연 8%/84).
- 초기: 현금 15억, 부채 0, 티켓 1.1만, fans 5200, fanSat 50, 관중석 Lv1(6000석), 매점 Lv1, 훈련장 없음.
- 시설 단계: 관중석 6000/9000/13000/18000/24000석(10억/22억/40억/70억), 매점 객단가 0.22→1.10만(3.5억/8억/16억/30억), 훈련장 성장률·부상 감소(4억/9억/18억/35억).
- **목표 밸런스**: 아무것도 안 하면 시즌 손익 +8억~+18억, 순위 7~8위. 업그레이드 2~4개 + FA 1~2명이 한 시즌에 가능하지만 전부는 불가. 스타 영입 → 수요 급증 → 매진 → 증설 필요의 사이클이 실제로 발생해야 함.
- 현금이 음수가 되면 자동으로 긴급 대출 전환. 부채가 한도 초과면 **최고 연봉 선수 강제 매각**(연봉의 50% 현금) + 뉴스.
- 팬: 승 +25 / 패 −12, 홈 매진 +10, 만족도 (fanSat−50)×0.6/홈경기, 스타 영입 시 즉시 +star×4.
- fanSat 은 목표값(45 + 매점 + 성적 + 가격 적정성 + 열기)으로 홈경기마다 15%씩 수렴.
- 주간 훈련(6경기마다): 유저 선수 중 28세 이하·OVR<pot 이 TRAIN_LV.grow 확률로 능력치 +1~2 → notes/뉴스 `"훈련 성과: 한서준 파워+1"`. 33세 이상은 소폭 노쇠.
- 영입: 계약금(연봉 25%) 즉시 지출, 로스터 상한 28. 방출: 잔여 연봉의 20% 위약금, 타자 10·투수 8 미만 불가, 방출 선수는 FA 풀로.

`scripts/balance.ts` (`npm run balance`): 시드 여러 개로 무개입 시즌을 돌려 리그 타율/ERA/경기당 득점/홈런 1위/유저 순위·손익·평균 관중·매진 횟수를 출력해 위 목표에 맞는지 검증한다.

## 2. 구장 렌더러 (worker-stadium)

```ts
// src/stadium/StadiumCanvas.tsx
export const STADIUM_W = 640, STADIUM_H = 420;
export default function StadiumCanvas(props: { scene: StadiumScene; className?: string }): JSX.Element;
// 시설 핫스팟(오버레이 배치용, 캔버스 픽셀 좌표 rect)
export const HOTSPOTS: Record<FacilityKind | 'scoreboard', { x: number; y: number; w: number; h: number }>;
```

- 내부 해상도 640×420 캔버스, CSS 로 확대(`image-rendering: pixelated`, 클래스 `pixel`). 안티앨리어싱 없는 **정수 좌표 fillRect / ImageData 픽셀아트**. 텍스트는 캔버스에 그리지 않는다(전광판 글자는 UI 가 HTML 로 오버레이).
- **3/4 탑뷰 디오라마**: 홈플레이트가 화면 아래 중앙, 외야가 위. 월드→화면 투영 `sx = 320 + x`, `sy = 338 + y×0.62 − z`. 외야 펜스 반지름 290(월드). 밝고 깨끗한 스포츠 색감(어두운 톤 금지).
- 정적 레이어(시설 레벨이 바뀔 때만 재생성, 오프스크린 캐시): 잔디(방사형 잔디깎기 줄무늬), 내야 흙, 마운드, 파울라인, 베이스, 워닝트랙, 외야 펜스(높이감), 관중석 콘크리트/테두리, 덕아웃, 조명탑, 전광판 프레임(위 중앙, 대략 x250~390 y56~114, 내부는 검은 LED 패널로 비워둠), 주차장(좌상단), 나무·광장 타일 배경.
- **관중석 Lv0~4** (`facilities.seats`): 내야석 줄 수 4/6/8/9/11, 파울라인을 따라 뻗는 길이 115/155/195/215/235, Lv3 부터 외야석(4줄 → 7줄), Lv2 부터 지붕/상단 구조물, Lv4 는 2층 느낌. 좌석 하나 = 2×2px 점, 통로(계단) 간격.
- **관중**: `fill` 비율만큼 좌석이 팬(몸 2×2 + 머리)으로 채워진다. 채움 순서는 좌석별 고정 rank(홈 가까운 앞줄부터 + 랜덤). 팬 색의 절반 이상은 홈팀 색. 평소엔 일부만 까딱이고, cheer 시 다수가 점프·깃발.
- **매점** (좌하단, 대략 x14~165 y340~414): Lv0 포장마차 → 간이 매점 → 차양 달린 매장 → 파라솔 푸드코트 → 2층 네온 푸드홀. fill 에 비례해 줄 선 손님.
- **훈련장** (우하단, 대략 x475~626 y340~414): Lv0 울타리 친 공터 → 배팅 케이지 → +불펜 마운드 → 실내 훈련장 건물 → 돔형 퍼포먼스 센터(+의무실 적십자).
- 선수: 4×6px 내외 스프라이트. 수비 9명 + 타자. `playing` 일 때 `homeBatting` 에 따라 수비/공격 팀 색 교체. 평소엔 홈팀이 연습(살짝 움직임).
- fx (`fxKey` 변경 시 처음부터 재생): `hr` 공 포물선(그림자 포함) 후 담장 넘어감, cheer 면 폭죽·관중 점프 / `score` 주자 홈인 / `walkoff`·`win` 대형 폭죽 / `injury` 적십자 점멸 / `build` 해당 시설 위 반짝임·먼지.
- 날씨: 비(빗줄기), 흐림(약한 톤다운). night: 옅은 남색 틴트(알파 ≤0.25) + 조명 글로우. 주차장 차량 수도 fill 에 비례.
- `banners`: 전광판 옆에 걸리는 우승/성과 깃발 수.
- requestAnimationFrame 루프(약 12~15fps 스로틀), 언마운트 시 정리. scene 은 ref 로 읽어 리렌더와 무관하게 동작.
- 개발용 미리보기: `src/stadium/preview.html` + `src/stadium/preview.tsx` (레벨·fill·fx 를 버튼으로 바꿔볼 수 있는 단독 페이지, `http://localhost:5173/src/stadium/preview.html`).

## 3. 스토어 + UI (worker-ui)

```ts
// src/store.ts (zustand + persist, key 'kbl-save-v1')
interface Store extends Core {
  playback: { report: DayReport; next: Core; step: number } | null; // 하이라이트 재생 중 (커밋 전)
  summary: DayReport[] | null;      // 경기 후 요약 (1개 = 단일 경기, 여러 개 = 일괄 진행)
  fx: { kind: FacilityKind; key: number } | null; // 업그레이드 연출
  toast: { text: string; tone: 'good'|'bad'|'info'; key: number } | null;
  leftTab: 'lineup'|'pitchers'|'market'; rightTab: 'league'|'stadium'|'finance'|'news';
  playNext(): void;          // advanceDay → playback 시작 (결과는 재생 끝나야 커밋 → 상단바에 스포일러 없음)
  stepPlayback(): void; skipPlayback(): void;   // 끝나면 next 커밋 + summary
  simDays(n: number): void;  // 하이라이트 없이 n일 (시즌 끝이면 중단) → summary
  closeSummary(): void;
  sign(pid): void; release(pid): void; upgrade(kind): void; setPrice(v): void; borrow(): void; repay(): void;
  swapLineup(i, j): void; substitute(slot, benchPid): void; swapPitchers(pidA, pidB): void; auto(): void;
  startNextSeason(): void; newGame(): void; setTab(...)
}
```
persist 는 Core 필드만 저장(playback/summary/fx/toast 제외).

### 화면 (데스크톱 1280px+ 기준, 한 화면)

```
┌ TopBar: 구단명 · 시즌/경기일(n/84) · 순위 · 전적 | 현금 · 부채 · 연봉총액 | 최근 관중 · 팬 수 · 만족도 · 전력 ┐
├ Left(300px) ──┬──────── Center: 야구장 (640:420 비율 유지, 가능한 한 크게) ────────┬ Right(330px) ┤
│ 타선/투수/영입 │  StadiumCanvas + HTML 오버레이(전광판 글자, 핫스팟, 하이라이트 배너)  │ 리그/구장/재무/뉴스 │
│ + 선수 카드    │                                                               │                │
├───────────────┴ BottomBar: 다음 경기 정보 · [경기 진행] [1주 진행] [시즌 끝까지] ───┴────────────────┤
```

- **야구장이 항상 중심**. 패널 탭을 바꿔도 야구장은 그대로. 모달은 야구장 영역 안에서만 뜬다(시즌 종료 화면 제외).
- 오버레이(캔버스 위 % 좌표, 컨테이너 쿼리 단위 `cqw` 로 글자 크기):
  - 전광판(HOTSPOTS.scoreboard): 평소 "NEXT vs 상대 · 홈/원정 · 요일", 재생 중엔 원정/홈 점수·이닝.
  - 시설 핫스팟 3개: hover 시 테두리 + "매점 Lv2 ▲3.5억" 라벨, 클릭 시 우측 구장 탭으로.
  - 관중 칩: "관중 5,214 / 6,000" + 매진 시 깜빡이는 "매진!" + 날씨 아이콘.
  - 하이라이트 배너: 이벤트 text/sub 를 큰 픽셀 글씨로 pop-in (`.anim-pop`).
  - 간판스타 칩: star 최고 선수 이름.
- StadiumScene 매핑: fill = 재생 중이면 그 경기 관중(원정이면 평소의 15%), 아니면 마지막 홈경기. fx 는 이벤트 type → hr/score/walkoff/injury, 유저 홈 승리 final → win. cheer = 유저팀 이벤트 && 홈경기.
- 재생: 이벤트당 1.8초(hr·walkoff 2.6초), [건너뛰기] 버튼. 끝나면 **경기 요약 카드**: 라인스코어, 승·패·세 투수, MVP, 관중·수입 내역(입장/매점/굿즈/분배금 − 연봉/유지비/이자 = 순익), 부상·소식, 순위 변동.
- Left `타선`: 타순 1~9(수비위치, 이름, OVR, 타율/홈런/타점, 부상 표시) + 벤치. 선수 클릭 → 하단 **선수 카드**(픽셀 초상 `PixelFace`, 능력치 막대, 시즌 기록, 연봉, tag, [↔ 교체] [방출]). 교체 모드에서 다른 선수를 누르면 swap/substitute. [자동 편성].
- Left `투수`: 선발 1~5, 마무리, 불펜. 같은 방식으로 역할 교체.
- Left `영입`: FA 목록(OVR, 나이, 연봉, 계약금, 스타성 ★) → 카드에서 [영입]. 돈 부족·정원 초과 시 비활성 + 이유.
- Right `리그`: 순위표(유저 강조, 승차), 오늘 타구장 결과, 다음 5경기 일정.
- Right `구장`: 티켓 가격 조절(적정가·예상 수요 표시), 시설 3종 카드(현재 단계 이름·효과 → 다음 단계 효과·비용, [업그레이드]), 홈 관중 추이 미니 막대그래프.
- Right `재무`: 시즌 누적 수입/지출 표, 연봉 총액, 대출/상환 버튼(한도·이자), 현금 추이 미니 그래프.
- Right `뉴스`: 최신순 리스트(tone 색).
- 시즌 종료(`phase === 'ended'`): 전체 화면 결과 — 최종 순위표, 우리 팀 성적, 손익 결산, 총/평균 관중, 팀 MVP(타자·투수), 구단주 평가 등급, [다음 시즌] [새 게임].
- 톤: 남색 계열 UI 크롬 + 밝은 야구장. `index.css` 의 `.px-panel`, `.px-btn(.primary/.gold/.green)`, `.px-scroll`, `.anim-pop/.anim-float/.anim-blink` 와 Tailwind 토큰(`font-pixel`, `text-hi`, `text-good`, `text-bad`, `bg-panel`, `bg-panel-2` …) 사용. 엑셀처럼 보이지 않게: 막대·아이콘·색을 적극 사용.
