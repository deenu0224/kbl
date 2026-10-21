// 동적 레이어: 관중·차량·선수·fx·날씨. 매 프레임(약 14fps) 정적 레이어 위에 다시 그린다.
import { drawDome } from './dome';
import type { StadiumScene } from '../game/types';
import { DOME_FLAG, NEON, parasolSpots, queueSpots, trainActors, type TrainActor } from './buildings';
import {
  B1,
  B2,
  B3,
  BANNER_X,
  BANNER_X_NEW,
  BANNER_Y,
  DEG,
  FIELDERS,
  GATE_Y,
  HOTSPOTS,
  HX,
  HY,
  MOUND,
  OLD_BANNER_X,
  PARK_SLOTS,
  RETIRED_X,
  SB_FRAME,
  RETIRED_Y,
  STADIUM_H,
  STADIUM_W,
  TOWERS,
  YK,
  fenceTopY,
  gateX,
  hash2,
  SEAT_SPEC,
  DUG_T0,
  DUG_T1,
  clampLv,
  standToWorld,
  standingSpots,
  type Pt,
  type Seat,
} from './geometry';
import { CAR_COLORS, FAN_EXTRA, FIREWORK_COLORS, PAL, col, lum, mix, shade } from './palette';
import type { StaticLayers } from './staticLayer';
import { CHAMP_POPS } from './ceremony';

type Ctx = CanvasRenderingContext2D;

export interface FrameInput {
  ctx: Ctx;
  scene: StadiumScene;
  layers: StaticLayers;
  t: number; // 초
  fxT: number; // fx 시작 후 경과 초
  night: HTMLCanvasElement | null;
}

function R(ctx: Ctx, x: number, y: number, w: number, h: number, c: string): void {
  ctx.fillStyle = c;
  ctx.fillRect(Math.round(x), Math.round(y), w, h);
}

const X = (wx: number): number => Math.round(HX + wx);
const Y = (wy: number, z = 0): number => Math.round(HY + wy * YK - z);
const clamp01 = (v: number): number => (Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0);
const lerp = (a: number, b: number, p: number): number => a + (b - a) * p;

interface Kit {
  j: string;
  c: string;
  p: string;
}
function kit(color: string, home: boolean): Kit {
  return { j: color, c: shade(color, -0.4), p: home ? '#ffffff' : '#cdd3dc' };
}

/** 선수 스프라이트 4×6. (x, y) = 발 중앙. pose: 0 서기, 1 달리기, 2 점프(팔 올림) */
function sprite(ctx: Ctx, x: number, y: number, k: Kit, pose: 0 | 1 | 2, f: number): void {
  R(ctx, x - 2, y, 5, 1, 'rgba(20,50,20,0.28)');
  const up = pose === 2 && (f & 1) ? 2 : pose === 1 && (f & 1) ? 1 : 0;
  const yy = y - up;
  R(ctx, x - 1, yy - 6, 2, 1, k.c);
  R(ctx, x - 1, yy - 5, 2, 1, PAL.skin);
  R(ctx, x - 2, yy - 4, 4, 2, k.j);
  R(ctx, x - 1, yy - 2, 2, 1, k.p);
  if (pose === 1 && (f & 1)) {
    R(ctx, x - 2, yy - 1, 1, 1, k.p);
    R(ctx, x + 1, yy - 1, 1, 1, k.p);
  } else {
    R(ctx, x - 1, yy - 1, 2, 1, k.p);
  }
  if (pose === 2) {
    R(ctx, x - 3, yy - 6, 1, 2, PAL.skin);
    R(ctx, x + 2, yy - 6, 1, 2, PAL.skin);
  }
}

function person(ctx: Ctx, x: number, y: number, c: string, up: number): void {
  const yy = y - up;
  R(ctx, x, yy - 1, 2, 1, '#3a3f4b');
  R(ctx, x, yy - 3, 2, 2, c);
  R(ctx, x, yy - 5, 2, 2, PAL.skin);
  R(ctx, x, yy - 5, 2, 1, '#5a3b22');
}

function ball(ctx: Ctx, x: number, y: number, gy: number): void {
  R(ctx, x - 1, gy, 3, 1, 'rgba(0,0,0,0.25)');
  R(ctx, x, y, 2, 2, '#ffffff');
}

function sparkle(ctx: Ctx, x: number, y: number, big: boolean, c = '#ffe45c'): void {
  if (big) {
    R(ctx, x - 2, y, 5, 1, c);
    R(ctx, x, y - 2, 1, 5, c);
    R(ctx, x - 1, y - 1, 3, 3, '#ffffff');
  } else {
    R(ctx, x - 1, y, 3, 1, c);
    R(ctx, x, y - 1, 1, 3, c);
    R(ctx, x, y, 1, 1, '#ffffff');
  }
}

// ───────── 관중 ─────────

function jumpOf(s: Seat, f: number, cheer: number): number {
  if (cheer === 2) return s.ph % 10 < 8 ? [0, 1, 2, 1][(f + s.ph) & 3] : 0;
  if (cheer === 1) return s.ph % 10 < 4 && ((f + s.ph) & 3) === 0 ? 1 : 0;
  return ((f >> 1) + s.ph) % 29 === 0 ? 1 : 0;
}

const UMBRELLAS = ['#e5393a', '#ffd23f', '#3f7fd6', '#f4f6fa', '#3fb86a', '#ff8fc0', '#7a5cd6', '#22b5c8'];

/** 응원 물결의 마루 위치(0~1, Seat.u 와 같은 축). 지금 지나가는 물결이 없으면 빈 배열 */
function waveCrests(t: number, lv: number): number[] {
  if (lv <= 0) return [];
  if (lv >= 4) {
    const c = (t / 2.6) % 1;
    return [c, (c + 0.5) % 1];
  }
  const ph = (t % 6.5) / 3.4;
  return ph < 1 ? [ph] : [];
}

const WAVE_HALF = 0.05;

/** 물결에 들어간 관중이 일어서는 높이(px). 0 이면 물결 밖 */
function waveLift(u: number, crests: number[]): number {
  let best = 0;
  for (let i = 0; i < crests.length; i++) {
    let d = Math.abs(u - crests[i]);
    if (d > 0.5) d = 1 - d;
    if (d < WAVE_HALF) best = Math.max(best, d < WAVE_HALF * 0.5 ? 3 : 2);
  }
  return best;
}

/**
 * cheer: fx 로 인한 순간 환호(0~2). cheerLv: 응원 문화 유효 단계(0~4, fx 중에는 한 단계 위).
 * 비 오는 날 지붕 없는 자리의 관중은 우산을 쓴다(우천 관중 감소는 fill 에 이미 들어 있다).
 * 관중이 적은 날에는 오랜 팬 주위 자리를 비워 그 한 사람이 눈에 띄게 한다.
 */
const STANDING_FILL = 0.995; // 이 점유율부터 입석이 선다
const standingCache = new Map<number, ReturnType<typeof standingSpots>>();
function standingOf(lv: number): ReturnType<typeof standingSpots> {
  let s = standingCache.get(lv);
  if (!s) standingCache.set(lv, (s = standingSpots(lv)));
  return s;
}

function drawCrowd(
  ctx: Ctx,
  L: StaticLayers,
  scene: StadiumScene,
  t: number,
  f: number,
  cheer: number,
  cheerLv: number,
): void {
  const fill = clamp01(scene.fill);
  if (fill <= 0) return;
  const rain = scene.weather === 'rain';
  const h2 = lum(col(scene.homeColor2)) < 45 ? mix(scene.homeColor, '#ffffff', 0.45) : scene.homeColor2;
  const pal = [scene.homeColor, h2, scene.awayColor, ...FAN_EXTRA];
  const seats = L.seats;
  const lonely = !L.oldFanOnGrass && fill < 0.75;
  const of = L.oldFan;
  const here = (s: Seat): boolean => s.rank < fill && !(lonely && Math.abs(s.x - of.x - 2) <= 10 && Math.abs(s.y - of.y + 2) <= 8);
  const wet = (s: Seat): boolean => rain && !s.cov && s.ph % 5 !== 0;

  for (let ci = 0; ci < L.groups.length; ci++) {
    const g = L.groups[ci];
    ctx.fillStyle = pal[ci] ?? '#ffffff';
    for (let i = 0; i < g.length; i++) {
      const s = g[i];
      if (!here(s)) continue;
      ctx.fillRect(s.x, s.y - jumpOf(s, f, cheer), 2, 2);
    }
  }
  for (let tone = 0; tone < 2; tone++) {
    ctx.fillStyle = tone ? PAL.skin2 : PAL.skin;
    for (let i = 0; i < seats.length; i++) {
      const s = seats[i];
      if ((s.ph & 1) !== tone || !here(s)) continue;
      ctx.fillRect(s.x, s.y - jumpOf(s, f, cheer) - 1, 2, 1);
    }
  }

  // 응원 물결: 홈팀 색으로 일어서는 띠가 구장을 돈다
  const crests = waveCrests(t, cheerLv);
  if (crests.length > 0) {
    const hi = shade(scene.homeColor, 0.4);
    for (let pass = 0; pass < 2; pass++) {
      ctx.fillStyle = pass ? hi : scene.homeColor;
      for (let i = 0; i < seats.length; i++) {
        const s = seats[i];
        if (!here(s)) continue;
        const lift = waveLift(s.u, crests);
        if (lift === 0) continue;
        if (pass === 0) ctx.fillRect(s.x - 1, s.y - lift, 4, lift + 2);
        else if (lift === 3) ctx.fillRect(s.x - 1, s.y - lift - 1, 4, 2);
      }
    }
  }

  if (rain) {
    // 우산: 4×3 색 덩어리
    for (let k = 0; k < UMBRELLAS.length; k++) {
      const c = UMBRELLAS[k];
      for (let pass = 0; pass < 2; pass++) {
        ctx.fillStyle = pass ? shade(c, -0.28) : c;
        for (let i = 0; i < seats.length; i++) {
          const s = seats[i];
          if ((s.ph >> 3) % UMBRELLAS.length !== k || !here(s) || !wet(s)) continue;
          const y = s.y - jumpOf(s, f, cheer) - waveLift(s.u, crests);
          if (pass === 0) {
            ctx.fillRect(s.x - 1, y - 2, 4, 2);
            ctx.fillRect(s.x, y - 3, 2, 1);
          } else {
            ctx.fillRect(s.x - 1, y, 4, 1);
          }
        }
      }
    }
  }

  if (cheer === 2) {
    // 깃발·응원봉
    for (let i = 0; i < seats.length; i++) {
      const s = seats[i];
      if (!here(s)) continue;
      const m = s.ph % 19;
      if (m === 0) {
        const w = (f + s.ph) & 2 ? 1 : 0;
        const dy = jumpOf(s, f, cheer);
        R(ctx, s.x + 2, s.y - dy - 5, 1, 5, '#f4f6fa');
        R(ctx, s.x + 3 - w * 4, s.y - dy - 5, 3, 2, s.ph & 32 ? scene.homeColor : '#ffffff');
      } else if (m === 1 || m === 2) {
        const dy = jumpOf(s, f, cheer);
        R(ctx, s.x + ((f + s.ph) & 1 ? -1 : 2), s.y - dy - 3, 1, 2, m === 1 ? '#ffe45c' : scene.homeColor);
      }
    }
  }

  // 매진: 작은 구장(지붕 없는 Lv0·1)은 뒷벽과 스탠드 끝에 서서 보는 입석 줄이 생긴다
  if (fill >= STANDING_FILL && L.lv.seats <= 1) {
    const spots = standingOf(L.lv.seats);
    for (let i = 0; i < spots.length; i++) {
      const s = spots[i];
      const up = cheer > 0 && ((f + s.ph) & 1) === 0 ? 1 : 0;
      const y = s.y - up;
      R(ctx, s.x, y - 4, 2, 3, pal[s.ph % 3 === 0 ? 1 : s.ph % 7 === 0 ? 2 : 0]);
      R(ctx, s.x, y - 5, 2, 1, s.ph & 1 ? PAL.skin2 : PAL.skin);
      R(ctx, s.x, y - 1, 2, 1, '#2b3550');
    }
  }

  // 큰 깃발 흔들기 (응원 문화 2+)
  if (cheerLv >= 2) {
    const stripe = lum(col(h2)) > 150 ? h2 : '#ffffff';
    for (let i = 0; i < L.wavers.length; i++) {
      const s = L.wavers[i];
      if (!here(s)) continue;
      const p = ((cheerLv >= 4 ? f : f >> 1) + s.ph) & 3;
      const y = s.y - 12 - waveLift(s.u, crests);
      R(ctx, s.x + 1, y, 1, 12, '#f4f6fa');
      const wide = p === 0 || p === 2;
      const w = wide ? 8 : 5;
      const x = p < 2 ? s.x + 2 : s.x + 1 - w;
      const yy = wide ? y : y + 1;
      R(ctx, x, yy, w, 6, scene.homeColor);
      R(ctx, x, yy + 2, w, 2, stripe);
      R(ctx, x, yy + 6, w, 1, 'rgba(20,30,50,0.35)');
    }
  }
}

/** 외야의 오랜 팬: 관중이 없어도 늘 같은 자리에. 폰에서도 읽히도록 다른 관중의 세 배 크기(6×9)에 깃발을 든다 */
// 원정 응원단: 3루 쪽 내야 스탠드의 외야 쪽 끝 구역을 원정 색으로 채운다 (좌석 배열별로 순서를 한 번만 만든다)
const AWAY_ORDER = new WeakMap<Seat[], Seat[]>();
const AWAY_MIN = 70; // 390px 폭 화면에서도 덩어리로 보이는 최소 인원
/** 원정 응원석에 앉는 자리들 (앞에서부터 n 명). 응원단이 없으면 빈 배열 */
function awaySeats(L: StaticLayers, scene: StadiumScene): Seat[] {
  const share = clamp01(scene.awayFans || 0);
  if (share <= 0) return [];
  let order = AWAY_ORDER.get(L.seats);
  if (!order) {
    order = L.seats.filter((s) => s.sec !== 2 && s.u < 0.5).sort((a, b) => a.u - b.u);
    AWAY_ORDER.set(L.seats, order);
  }
  return order.slice(0, Math.min(order.length, Math.max(AWAY_MIN, Math.round(L.seats.length * share))));
}

function drawAwayFans(ctx: Ctx, L: StaticLayers, scene: StadiumScene, f: number): void {
  const order = awaySeats(L, scene);
  const n = order.length;
  if (n <= 0) return;
  const c = scene.awayColor;
  const hi = shade(c, 0.35);
  // 원정에서 우승을 확정하면 원정 응원석만 터진다
  const party = scene.fx.kind === 'champion' && scene.fx.away;
  for (let i = 0; i < n; i++) {
    const s = order[i];
    // 원정 팬은 자기 팀이 칠 때(홈 공격이 아닐 때) 들썩인다
    const up = party ? (scene.fx.kind === 'champion' && scene.fx.calm ? 1 : [0, 1, 2, 1][(f + s.ph) & 3]) : scene.playing && !scene.homeBatting && ((f + s.ph) & 3) === 0 ? 1 : 0;
    ctx.fillStyle = s.ph % 5 === 0 ? hi : c;
    ctx.fillRect(s.x - 1, s.y - up, 4, 3);
    ctx.fillStyle = s.ph & 1 ? PAL.skin2 : PAL.skin;
    ctx.fillRect(s.x, s.y - up - 1, 2, 1);
  }
  // 응원 깃발 두 개 (우승 때는 다섯 개)
  const flags = party ? 5 : 2;
  for (let k = 0; k < flags; k++) {
    const s = order[Math.floor(((k + 1) * n) / (flags + 1))];
    const w = (f + k * 3) & 2 ? 1 : 0;
    R(ctx, s.x + 1, s.y - 9, 1, 9, '#f4f6fa');
    R(ctx, s.x + 2 - w * 6, s.y - 9, 5, 3, c);
    R(ctx, s.x + 2 - w * 6, s.y - 8, 5, 1, '#ffffff');
  }
}

function drawOldFan(ctx: Ctx, L: StaticLayers, scene: StadiumScene, f: number): void {
  const { x, y } = L.oldFan;
  if (L.oldFanOnGrass) {
    // 잔디 언덕에 깐 돗자리
    R(ctx, x - 4, y + 1, 14, 3, '#f4f6fa');
    R(ctx, x - 4, y + 3, 14, 1, '#b9c4d2');
    R(ctx, x + 7, y + 1, 2, 2, '#5ec8ff');
  } else {
    R(ctx, x - 2, y + 2, 9, 1, 'rgba(20,40,30,0.35)');
  }
  // 몸 6×5 · 얼굴 4×3 · 흰 머리 1줄. 어두운 테두리로 관중에서 떼어낸다
  R(ctx, x - 2, y - 7, 8, 9, 'rgba(15,20,32,0.55)');
  R(ctx, x - 1, y - 3, 6, 5, scene.homeColor);
  R(ctx, x - 1, y - 3, 6, 1, shade(scene.homeColor, 0.3));
  R(ctx, x, y - 6, 4, 3, PAL.skin);
  R(ctx, x, y - 7, 4, 1, '#e9ecf1');
  // 깃발: 천천히 좌우로
  const w = (f >> 3) & 1;
  R(ctx, x + 5, y - 17, 1, 17, '#f4f6fa');
  R(ctx, x + 6, y - 17 + w, 9 - w, 6, scene.homeColor);
  R(ctx, x + 6, y - 15 + w, 9 - w, 2, '#ffffff');
  R(ctx, x + 6, y - 11 + w, 9 - w, 1, 'rgba(20,30,50,0.35)');
  if (scene.weather === 'rain') {
    R(ctx, x - 4, y - 10, 10, 2, '#ffd23f');
    R(ctx, x - 2, y - 11, 6, 1, '#ffd23f');
    R(ctx, x - 4, y - 8, 10, 1, '#c99a1c');
  }
}

// ───────── 게이트 / 대기 줄 ─────────

const QUEUE_ROWS = 3;
const QUEUE_COLS = 20;

/** 게이트(매표 문)와 그 밖으로 늘어선 줄. gateQueue 가 정의돼 있을 때만 문을 세운다 */
function drawGate(ctx: Ctx, L: StaticLayers, scene: StadiumScene, t: number, f: number): void {
  if (scene.gateQueue === undefined) return;
  // 문은 벽에서 살짝 안쪽으로 물려 세운다(하단 조명탑에 가리지 않게)
  const gx = gateX(L.lv.seats) + 5;
  const y = GATE_Y;
  R(ctx, gx - 14, y, 17, 2, 'rgba(40,40,60,0.22)');
  R(ctx, gx - 12, y - 9, 12, 9, '#26304a');
  R(ctx, gx - 14, y - 11, 3, 11, '#f4f6fa');
  R(ctx, gx - 1, y - 11, 3, 11, '#f4f6fa');
  R(ctx, gx - 1, y - 11, 1, 11, '#c3c9d1');
  R(ctx, gx - 15, y - 15, 19, 5, scene.homeColor);
  R(ctx, gx - 15, y - 15, 19, 1, shade(scene.homeColor, 0.4));
  R(ctx, gx - 15, y - 11, 19, 1, shade(scene.homeColor, -0.35));
  R(ctx, gx - 9, y - 14, 7, 2, PAL.gold);
  R(ctx, gx - 10, y - 4, 8, 1, '#ffd23f');
  const q = clamp01(scene.gateQueue);
  const n = Math.round(q * QUEUE_ROWS * QUEUE_COLS);
  if (n <= 0) return;
  // 세 줄로 선 사람들: 값이 클수록 왼쪽(주차장 쪽)으로 길어진다
  const cols = Math.ceil(n / QUEUE_ROWS);
  const x0 = gx - 20;
  const len = cols * 4 + 3;
  // 줄 세우는 띠(위·아래)와 말뚝
  R(ctx, x0 - len + 4, y - 19, len, 1, '#b3262a');
  R(ctx, x0 - len + 4, y + 1, len, 1, '#b3262a');
  for (const px of [x0 + 3, x0 - len + 4]) {
    R(ctx, px, y - 21, 1, 4, '#3a3f4b');
    R(ctx, px, y - 1, 1, 4, '#3a3f4b');
  }
  const cs = [scene.homeColor, ...FAN_EXTRA, scene.homeColor, scene.homeColor2];
  const rain = scene.weather === 'rain';
  for (let row = 0; row < QUEUE_ROWS; row++) {
    for (let c = cols - 1; c >= 0; c--) {
      const i = c * QUEUE_ROWS + row;
      if (i >= n) continue;
      // 조금씩 앞으로 당겨졌다 밀리며 꿈틀거린다
      const crawl = Math.round(Math.sin(t * 2.2 - c * 0.55 + row));
      const snake = Math.round(Math.sin(c * 0.5 + t * 1.1 + row * 0.6));
      const px = x0 - c * 4 + crawl - (row & 1) * 2;
      const py = y - 12 + row * 6 + snake;
      const up = ((f >> 2) + i * 5) % 17 === 0 ? 1 : 0;
      person(ctx, px, py, cs[(i * 7 + 3) % cs.length], up);
      if (rain && i % 3 !== 1) {
        const uc = UMBRELLAS[(i * 5) % UMBRELLAS.length];
        R(ctx, px - 1, py - 8 - up, 4, 2, uc);
        R(ctx, px - 1, py - 6 - up, 4, 1, shade(uc, -0.28));
      }
    }
  }
}

// ───────── 영구결번 / 대형 현수막 ─────────

function drawRetired(ctx: Ctx, scene: StadiumScene): void {
  const n = Math.max(0, Math.min(RETIRED_X.length, Math.round(scene.retiredNums || 0)));
  if (n <= 0) return;
  const xs = RETIRED_X.slice(0, n).map((x) => x + (RETIRED_X.length - n) * 9);
  const ink = shade(scene.homeColor, -0.15);
  for (const cx of xs) {
    const y = RETIRED_Y;
    // 원판(지름 13) + 홈팀 색 테
    R(ctx, cx - 3, y - 6, 7, 13, ink);
    R(ctx, cx - 5, y - 5, 11, 11, ink);
    R(ctx, cx - 6, y - 3, 13, 7, ink);
    R(ctx, cx - 2, y - 5, 5, 11, '#ffffff');
    R(ctx, cx - 4, y - 4, 9, 9, '#ffffff');
    R(ctx, cx - 5, y - 2, 11, 5, '#ffffff');
    // 등번호 자리의 색 막대(숫자는 그리지 않는다)
    R(ctx, cx - 2, y - 2, 5, 5, scene.homeColor);
  }
}

const BIG_BANNER_SPANS: [number, number][] = [
  [126, 246],
  [394, 514],
];

/** 외야 펜스 위에 걸린 대형 현수막(홈팀 색 띠). 바람에 물결친다 */
function drawBigBanner(ctx: Ctx, scene: StadiumScene, t: number, wild: boolean): void {
  const home = scene.homeColor;
  const hi = shade(home, 0.35);
  const dk = shade(home, -0.3);
  const sp = wild ? 9 : 4;
  for (const [x0, x1] of BIG_BANNER_SPANS) {
    for (let sx = x0; sx < x1; sx += 2) {
      const rip = Math.round(Math.sin(sx * 0.14 - t * sp) * (wild ? 1.6 : 1));
      const y = fenceTopY(sx) - 6 + rip;
      const k = (sx - x0) % 30;
      ctx.fillStyle = home;
      ctx.fillRect(sx, y, 2, 9);
      ctx.fillStyle = hi;
      ctx.fillRect(sx, y, 2, 1);
      ctx.fillStyle = dk;
      ctx.fillRect(sx, y + 8, 2, 1);
      // 흰 글자 덩어리 느낌의 무늬
      if (k >= 6 && k < 24 && k % 6 < 4) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(sx, y + 3, 2, 3);
      }
    }
    R(ctx, x0 - 1, fenceTopY(x0) - 9, 1, 12, '#f4f6fa');
    R(ctx, x1, fenceTopY(x1) - 9, 1, 12, '#f4f6fa');
  }
  if (wild) {
    const fl = Math.floor(t * 10);
    for (let i = 0; i < 6; i++) {
      const [x0, x1] = BIG_BANNER_SPANS[i & 1];
      const sx = Math.round(x0 + hash2(i, fl) * (x1 - x0 - 4));
      sparkle(ctx, sx, fenceTopY(sx) - 2, false, '#ffffff');
    }
  }
}

/** 외야 펜스에 건 우승 현수막: 금빛 천에 팀 색 띠 (글자 "{n}시즌 우승"은 StadiumView 의 오버레이). 하나면 가운데, 둘이면 좌우 */
export const TITLE_WALL_SPANS: Record<number, [number, number][]> = {
  1: [[288, 352]],
  2: [
    [250, 314],
    [326, 390],
  ],
};

function drawTitleWall(ctx: Ctx, scene: StadiumScene): void {
  const spans = TITLE_WALL_SPANS[Math.min(2, scene.titleWall?.length ?? 0)];
  if (!spans) return;
  const band = scene.homeColor;
  for (const [x0, x1] of spans) {
    for (let sx = x0; sx < x1; sx += 2) {
      // 펜스 벽면에 걸어 펜스 곡선을 따른다: 흰 천 + 금색 단 + 팀 색 줄 (광고판과 구별되게 어두운 테두리)
      const y = fenceTopY(sx) - 2;
      R(ctx, sx, y - 1, 2, 13, '#0f1420');
      R(ctx, sx, y, 2, 11, '#fbfaf2');
      R(ctx, sx, y, 2, 1, PAL.gold);
      R(ctx, sx, y + 1, 2, 1, band);
      R(ctx, sx, y + 9, 2, 1, band);
      R(ctx, sx, y + 10, 2, 1, PAL.gold);
    }
    R(ctx, x0 - 1, fenceTopY(x0) - 3, 1, 13, '#0f1420');
    R(ctx, x1, fenceTopY(x1) - 3, 1, 13, '#0f1420');
  }
}

// ───────── 가을야구 장식 ─────────

/** 가을 깃발줄 색: 주황 · 갈색 · 노랑 · 적갈색 (팀 색과 상관없이 가을빛) */
const AUTUMN_FLAGS = ['#fbf3dc', '#c8642a', '#ffd84a', '#6b3a1a', '#f0a35a'];

/** 두 점 사이에 처진 줄을 걸고 삼각 깃발을 단다. 바람에 깃발 끝이 1px 흔들린다 */
function bunting(ctx: Ctx, x0: number, y0: number, x1: number, y1: number, sag: number, f: number, seed: number): void {
  const n = Math.max(2, Math.round(Math.abs(x1 - x0) / 7));
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const x = Math.round(x0 + (x1 - x0) * u);
    const y = Math.round(y0 + (y1 - y0) * u + sag * 4 * u * (1 - u));
    R(ctx, x, y, 1, 1, '#3a2a1c');
    if (i === 0 || i === n) continue;
    const c = AUTUMN_FLAGS[(i + seed) % AUTUMN_FLAGS.length];
    const w = ((f >> 3) + i + seed) % 5 === 0 ? 1 : 0;
    // 아래로 뾰족한 5×4 삼각 깃발: 어두운 테두리로 관중석 색과 떼어 낸다
    R(ctx, x - 3, y, 7, 1, '#3a2a1c');
    R(ctx, x - 2, y + 1, 5, 1, c);
    R(ctx, x - 2, y + 2, 5, 1, c);
    R(ctx, x - 1 + w, y + 3, 3, 1, c);
    R(ctx, x + w, y + 4, 1, 1, c);
    R(ctx, x - 3, y + 1, 1, 2, '#3a2a1c');
    R(ctx, x + 3, y + 1, 1, 2, '#3a2a1c');
    R(ctx, x + w, y + 5, 1, 1, '#3a2a1c');
  }
}

/** 포스트시즌의 홈 구장: 외야 펜스 위와 내야 관중석 앞 벽에 가을 깃발줄. 우승 현수막·대형 현수막보다 위(펜스 꼭대기 위)에 건다 */
function drawAutumn(ctx: Ctx, scene: StadiumScene, f: number): void {
  if (!scene.autumn) return;
  // 외야 펜스: 기둥 사이마다 한 칸씩 처진 줄
  const posts: number[] = [];
  for (let x = 44; x <= 596; x += 46) posts.push(x);
  for (let i = 0; i + 1 < posts.length; i++) {
    const a = posts[i];
    const b = posts[i + 1];
    const ya = fenceTopY(a) - 15;
    const yb = fenceTopY(b) - 15;
    R(ctx, a, ya, 1, 15, '#5b4630');
    if (i + 2 === posts.length) R(ctx, b, yb, 1, 15, '#5b4630');
    bunting(ctx, a, ya, b, yb, 4, f, i);
  }
  // 내야 관중석 앞 벽: 덕아웃을 피해 양쪽 두 구간
  const len = SEAT_SPEC[clampLv(scene.facilities.seats)].len;
  for (const side of [-1, 1] as const) {
    const spans: [number, number][] = [
      [6, DUG_T0 - 2],
      [DUG_T1 + 2, len - 4],
    ];
    spans.forEach(([t0, t1], k) => {
      if (t1 - t0 < 12) return;
      const p0 = standToWorld(side, 0.6, t0);
      const p1 = standToWorld(side, 0.6, t1);
      const x0 = Math.round(HX + p0.x);
      const x1 = Math.round(HX + p1.x);
      const y0 = Math.round(HY + p0.y * YK - 7);
      const y1 = Math.round(HY + p1.y * YK - 7);
      bunting(ctx, x0, y0, x1, y1, 2, f, k + (side > 0 ? 2 : 0));
    });
  }
}

// ───────── 차량 ─────────

function carV(ctx: Ctx, x: number, y: number, c: string, flip: boolean): void {
  R(ctx, x, y + 1, 7, 11, 'rgba(0,0,0,0.18)');
  R(ctx, x, y, 7, 11, c);
  R(ctx, x, y + 10, 7, 1, shade(c, -0.3));
  R(ctx, x + 1, y + 3, 5, 5, shade(c, 0.22));
  R(ctx, x + 1, flip ? y + 8 : y + 2, 5, 2, '#bfe3f7');
  R(ctx, x + 1, flip ? y + 2 : y + 8, 5, 1, '#8fb6cc');
}

function carH(ctx: Ctx, x: number, y: number, c: string, dir: 1 | -1): void {
  R(ctx, x, y, 13, 6, c);
  R(ctx, x, y + 5, 13, 1, shade(c, -0.3));
  R(ctx, x + 3, y + 1, 7, 4, shade(c, 0.22));
  R(ctx, dir > 0 ? x + 8 : x + 3, y + 1, 2, 4, '#bfe3f7');
  R(ctx, dir > 0 ? x + 3 : x + 9, y + 1, 1, 4, '#8fb6cc');
  R(ctx, dir > 0 ? x + 12 : x, y + 1, 1, 1, '#fff6c8');
  R(ctx, dir > 0 ? x + 12 : x, y + 4, 1, 1, '#fff6c8');
}

function drawCars(ctx: Ctx, scene: StadiumScene, t: number): void {
  const n = Math.min(PARK_SLOTS.length, Math.round(2 + (PARK_SLOTS.length - 2) * clamp01(scene.fill * 1.05)));
  for (let i = 0; i < n; i++) {
    const p = PARK_SLOTS[i];
    carV(ctx, p.x, p.y, CAR_COLORS[Math.floor(hash2(i, 33) * CAR_COLORS.length)], hash2(i, 34) < 0.5);
  }
  const xa = ((t * 34) % 820) - 80;
  carH(ctx, Math.round(xa), 1, CAR_COLORS[Math.floor(t * 34 / 820) % CAR_COLORS.length], 1);
  const xb = 720 - ((t * 27 + 310) % 900);
  carH(ctx, Math.round(xb), 10, CAR_COLORS[(Math.floor((t * 27 + 310) / 900) + 3) % CAR_COLORS.length], -1);
}

// ───────── 매점 손님 / 훈련장 ─────────

const spotCache = new Map<number, { q: Pt[]; p: Pt[] }>();
const actorCache = new Map<number, TrainActor[]>();

function drawCustomers(ctx: Ctx, L: StaticLayers, scene: StadiumScene, f: number): void {
  const lv = L.lv.food;
  let sp = spotCache.get(lv);
  if (!sp) {
    sp = { q: queueSpots(lv), p: parasolSpots(lv) };
    spotCache.set(lv, sp);
  }
  const k = clamp01(scene.fill * 1.1) * (scene.weather === 'rain' ? 0.7 : 1);
  const cols = [scene.homeColor, ...FAN_EXTRA, scene.homeColor];
  const np = Math.round(sp.p.length * k);
  for (let i = 0; i < np; i++) {
    const p = sp.p[(i * 3) % sp.p.length];
    person(ctx, p.x, p.y, cols[(i * 5 + 2) % cols.length], 0);
  }
  const nq = Math.round(sp.q.length * k);
  for (let i = 0; i < nq; i++) {
    const p = sp.q[i];
    const up = ((f >> 2) + i * 7) % 13 === 0 ? 1 : 0;
    person(ctx, p.x, p.y, cols[(i * 3 + 1) % cols.length], up);
  }
}

function drawTraining(ctx: Ctx, L: StaticLayers, scene: StadiumScene, t: number, f: number): void {
  const lv = L.lv.training;
  let acts = actorCache.get(lv);
  if (!acts) {
    acts = trainActors(lv);
    actorCache.set(lv, acts);
  }
  const k = kit(scene.homeColor, true);
  acts.forEach((a, i) => {
    if (a.kind === 'jog') {
      const len = Math.abs(a.b.x - a.a.x);
      const u = (t * 13 + i * 9) % (len * 2);
      const x = a.a.x + (u < len ? u : len * 2 - u);
      sprite(ctx, Math.round(x), a.a.y, k, 1, f);
      return;
    }
    const ph = ((t + i * 0.7) % 2) / 2;
    if (a.kind === 'bat') {
      sprite(ctx, a.b.x, a.b.y, k, 0, f);
      const swing = ph > 0.3 && ph < 0.42;
      if (swing) R(ctx, a.b.x - 6, a.b.y - 4, 4, 1, '#8a5a34');
      else R(ctx, a.b.x - 3, a.b.y - 8, 1, 4, '#8a5a34');
      if (ph < 0.3) {
        const p = ph / 0.3;
        R(ctx, lerp(a.a.x, a.b.x - 5, p), a.b.y - 4, 1, 1, '#ffffff');
      } else if (ph < 0.55) {
        const p = (ph - 0.3) / 0.25;
        R(ctx, lerp(a.b.x - 5, a.a.x, p), a.b.y - 4 - Math.sin(p * Math.PI) * 9, 1, 1, '#ffffff');
      }
      return;
    }
    // pitch
    sprite(ctx, a.a.x, a.a.y, k, 0, f);
    sprite(ctx, a.b.x, a.b.y, k, 0, f);
    if (ph < 0.3) {
      const p = ph / 0.3;
      R(ctx, lerp(a.a.x, a.b.x, p), lerp(a.a.y, a.b.y, p) - 4, 1, 1, '#ffffff');
    } else if (ph > 0.5 && ph < 0.9) {
      const p = (ph - 0.5) / 0.4;
      R(ctx, lerp(a.b.x, a.a.x, p), lerp(a.b.y, a.a.y, p) - 4 - Math.sin(p * Math.PI) * 7, 1, 1, '#ffffff');
    }
  });
  if (lv === 4) flag(ctx, DOME_FLAG.x, DOME_FLAG.y, scene.homeColor, f, 3);
}

function flag(ctx: Ctx, x: number, y: number, c: string, f: number, seed: number): void {
  if (((f >> 2) + seed) & 1) {
    R(ctx, x, y, 5, 3, c);
    R(ctx, x, y, 5, 1, shade(c, 0.3));
  } else {
    R(ctx, x, y, 3, 3, c);
    R(ctx, x + 3, y + 1, 2, 3, c);
    R(ctx, x, y, 3, 1, shade(c, 0.3));
  }
}

// 우승 깃발 한 장: 12×22. 폰(디오라마 폭 390px)에서도 한 덩어리로 읽히는 크기
const BANNER_W = 12;

/** 우승 깃발 천 한 장(12×23, 깃봉 꼭지 포함). (x, y) = 천의 좌상단. wave = 아랫단이 1px 밀린 펄럭임 (결산 화면의 큰 깃발도 이 그림을 키워 쓴다) */
export function pennant(ctx: Ctx, x: number, y: number, color: string, wave: number): void {
  const W = BANNER_W;
  const w = wave;
  R(ctx, x - 2, y - 3, 3, 2, PAL.gold);
  R(ctx, x - 1, y - 1, W + 2, 13, 'rgba(15,20,32,0.55)');
  R(ctx, x, y, W, 11, PAL.gold);
  R(ctx, x + w, y + 11, W, 9, PAL.gold);
  R(ctx, x, y + 3, W, 4, color);
  R(ctx, x + 5 + w, y + 11, 2, 4, '#ffffff');
  R(ctx, x + 3 + w, y + 12, 6, 2, '#ffffff');
  R(ctx, x + w, y + 20, 4, 3, PAL.gold);
  R(ctx, x + 8 + w, y + 20, 4, 3, PAL.gold);
  R(ctx, x + W - 1, y, 1, 11, '#e0b020');
  R(ctx, x + W - 1 + w, y + 11, 1, 9, '#e0b020');
}

function drawBanners(ctx: Ctx, scene: StadiumScene, f: number): void {
  const old = scene.oldBanner === true;
  const slots = old ? BANNER_X_NEW : BANNER_X;
  const n = Math.max(0, Math.min(slots.length, Math.round(scene.banners || 0)));
  const W = BANNER_W;
  for (let i = 0; i < n; i++) {
    const x = slots[i] + 1;
    const y = BANNER_Y;
    R(ctx, x - 1, y - 2, 1, 62, PAL.steelDk);
    pennant(ctx, x, y, scene.homeColor, ((f >> 2) + i) & 1);
  }
  if (!old) return;
  if (n === 0) {
    // 아직 아무것도 걸리지 않은 빈 깃대: 가로대와, 깃발이 걸릴 자리의 굵은 점선 테두리
    const x = slots[0] + 1;
    const y = BANNER_Y;
    const c = '#e9edf5';
    R(ctx, x - 1, y - 2, 2, 62, PAL.steelDk);
    R(ctx, x - 2, y - 3, 4, 2, '#aab3c2');
    R(ctx, x - 1, y - 1, W + 2, 2, PAL.steelDk);
    R(ctx, x, y + 1, W, 21, 'rgba(15,20,32,0.28)');
    for (let k = 1; k < 21; k += 6) {
      R(ctx, x, y + k, 2, 3, c);
      R(ctx, x + W - 2, y + k + 3, 2, 3, c);
    }
    R(ctx, x + 2, y + 21, 3, 2, c);
    R(ctx, x + 7, y + 21, 3, 2, c);
  }
  // 바랜 옛 우승 깃발: 같은 모양, 빠진 색, 해진 끝. 거의 흔들리지 않는다
  const x = OLD_BANNER_X + 1;
  const y = BANNER_Y;
  const w = (f >> 4) % 5 === 0 ? 1 : 0;
  const cloth = '#a39b80';
  const dk = '#4d4839';
  const band = mix(scene.homeColor, '#7f7a6c', 0.6);
  R(ctx, x - 1, y - 2, 1, 62, '#6b6352');
  R(ctx, x - 2, y - 3, 3, 2, '#8c7d5c');
  // 어두운 테두리로 밝은 광장 바닥에서 떼어낸다
  R(ctx, x - 1, y - 1, W + 2, 13, dk);
  R(ctx, x - 1 + w, y + 11, W + 2, 9, dk);
  R(ctx, x - 1 + w, y + 20, 5, 4, dk);
  R(ctx, x + 6 + w, y + 20, 5, 2, dk);
  R(ctx, x, y, W, 11, cloth);
  R(ctx, x + w, y + 11, W, 8, cloth);
  R(ctx, x, y + 3, W, 4, band);
  R(ctx, x + 5 + w, y + 11, 2, 3, '#c9c2aa');
  // 해진 끝: 길이가 제각각인 올
  R(ctx, x + w, y + 19, 3, 4, cloth);
  R(ctx, x + 7 + w, y + 19, 3, 2, cloth);
  // 좀먹은 구멍
  R(ctx, x + 8, y + 7, 3, 3, dk);
  R(ctx, x + 2 + w, y + 14, 2, 3, dk);
  R(ctx, x + 6, y + 1, 2, 1, dk);
}

// ───────── 선수 ─────────

const BASE_PATH: Pt[] = [{ x: 0, y: 0 }, B1, B2, B3, { x: 0, y: 0 }];

function pathPos(p: number): Pt {
  const u = clamp01(p) * 4;
  const i = Math.min(3, Math.floor(u));
  const a = BASE_PATH[i];
  const b = BASE_PATH[i + 1];
  return { x: lerp(a.x, b.x, u - i), y: lerp(a.y, b.y, u - i) };
}

function drawPlayers(ctx: Ctx, scene: StadiumScene, t: number, fxT: number, f: number): void {
  const fx = scene.fx.kind;
  const homeKit = kit(scene.homeColor, true);
  const awayKit = kit(scene.awayColor, false);
  const playing = scene.playing;
  const fieldKit = playing ? (scene.homeBatting ? awayKit : homeKit) : homeKit;
  const batKit = playing ? (scene.homeBatting ? homeKit : awayKit) : homeKit;
  if (scene.fx.kind === 'champion') return drawChampionPile(ctx, scene, scene.fx, fxT, f);
  const celebrate = (fx === 'win' || fx === 'walkoff') && fxT < 14;
  const fxBusy = (fx === 'hr' || fx === 'score' || fx === 'walkoff' || fx === 'win' || fx === 'injury') && fxT < 6;

  type Sp = { x: number; y: number; k: Kit; pose: 0 | 1 | 2; bat?: 0 | 1 };
  const list: Sp[] = [];

  // 수비
  const winGather = fx === 'win' && celebrate;
  FIELDERS.forEach((p, i) => {
    let x = p.x;
    let y = p.y;
    let pose: 0 | 1 | 2 = 0;
    if (winGather) {
      const g = clamp01(fxT / 1.6);
      const tx = MOUND.x + Math.cos(i * 0.7) * 12;
      const ty = MOUND.y + 8 + Math.sin(i * 0.7) * 9;
      x = lerp(p.x, tx, g);
      y = lerp(p.y, ty, g);
      pose = g < 1 ? 1 : 2;
    } else if (fx === 'walkoff' && celebrate) {
      // 끝내기를 맞은 수비는 고개 숙이고 퇴장
      const g = clamp01((fxT - 1) / 5);
      x = lerp(p.x, -70, g * 0.5);
      y = lerp(p.y, p.y + 20, g * 0.5);
    } else if (((f >> 3) + i * 3) % 9 === 0) {
      x += i % 2 ? 1 : -1;
    }
    list.push({ x, y, k: fx === 'win' ? homeKit : fieldKit, pose });
  });

  if (playing) {
    // 심판
    list.push({ x: 0, y: 16, k: { j: '#2b3350', c: '#1b2233', p: '#3a4563' }, pose: 0 });
    if (fx === 'hr' && fxT < 6.2) {
      const p = pathPos((fxT - 0.35) / 5.6);
      list.push({ x: p.x, y: p.y, k: batKit, pose: 1 });
    } else if ((fx === 'score' || fx === 'walkoff') && fxT < 6) {
      const g = clamp01(fxT / 1.1);
      list.push({ x: lerp(B3.x, -3, g), y: lerp(B3.y, -2, g), k: batKit, pose: g < 1 ? 1 : 2 });
      const g2 = clamp01(fxT / 1.4);
      list.push({ x: lerp(B1.x, B2.x, g2), y: lerp(B1.y, B2.y, g2), k: batKit, pose: g2 < 1 ? 1 : 0 });
      list.push({ x: lerp(-9, B1.x, g2), y: lerp(-1, B1.y, g2), k: batKit, pose: g2 < 1 ? 1 : 0 });
      if (fx === 'walkoff' && fxT > 0.9) {
        for (let i = 0; i < 7; i++) {
          const g3 = clamp01((fxT - 0.9 - i * 0.08) / 0.9);
          const tx = Math.cos(i * 0.9) * 13;
          const ty = -6 + Math.sin(i * 0.9) * 9;
          list.push({ x: lerp(56, tx, g3), y: lerp(-30, ty, g3), k: batKit, pose: g3 < 1 ? 1 : 2 });
        }
      }
    } else if (fx !== 'win') {
      const ph = (t % 2.8) / 2.8;
      list.push({ x: -9, y: -1, k: batKit, pose: 0, bat: ph > 0.3 && ph < 0.4 ? 1 : 0 });
    }
  } else {
    // 연습: 펑고 코치 + 러닝
    if (!celebrate) list.push({ x: -9, y: -1, k: homeKit, pose: 0, bat: (t % 3.2) / 3.2 > 0.9 ? 1 : 0 });
    for (let i = 0; i < 3; i++) {
      const u = (t * 0.035 + i * 0.08) % 2; // 세 명이 겹쳐 보이지 않게 간격을 둔다
      const phi = lerp(14, 40, u < 1 ? u : 2 - u) * DEG;
      list.push({ x: 264 * Math.sin(phi), y: -264 * Math.cos(phi), k: homeKit, pose: 1 });
    }
  }

  list.sort((a, b) => a.y - b.y);
  for (const s of list) {
    const sx = X(s.x);
    const sy = Y(s.y);
    sprite(ctx, sx, sy, s.k, s.pose, f);
    if (s.bat === 1) R(ctx, sx + 2, sy - 4, 4, 1, '#8a5a34');
    else if (s.bat === 0) R(ctx, sx - 3, sy - 8, 1, 4, '#8a5a34');
  }

  // 공
  if (playing && !fxBusy) {
    const ph = (t % 2.8) / 2.8;
    if (ph > 0.16 && ph < 0.3) {
      const p = (ph - 0.16) / 0.14;
      const wy = lerp(MOUND.y, 2, p);
      ball(ctx, X(0), Y(wy, 4), Y(wy));
    }
  } else if (!playing && !celebrate) {
    // 캐치볼
    const pairs: [number, number][] = [
      [2, 3],
      [4, 5],
      [6, 7],
    ];
    pairs.forEach(([a, b], i) => {
      const u = (t / (1.3 + i * 0.4) + i * 0.37) % 2;
      const p = u < 1 ? u : 2 - u;
      const A = FIELDERS[a];
      const B = FIELDERS[b];
      const wx = lerp(A.x, B.x, p);
      const wy = lerp(A.y, B.y, p);
      const z = 5 + Math.sin(p * Math.PI) * (10 + i * 8);
      R(ctx, X(wx), Y(wy), 2, 1, 'rgba(0,0,0,0.2)');
      R(ctx, X(wx), Y(wy, z), 1, 1, '#ffffff');
    });
  }
}

type ChampFx = Extract<StadiumScene['fx'], { kind: 'champion' }>;

const PILE_FIELD = FIELDERS.length; // 그라운드에 있던 9명
const PILE_BENCH = 9; // 덕아웃에서 쏟아져 나오는 선수·코치

/** 마운드 위 한 덩어리: i 번째 선수의 자리(월드). 안쪽부터 해바라기 씨처럼 채운다 */
function pileSpot(i: number): Pt {
  const a = i * 2.4;
  const r = 2 + Math.sqrt(i) * 3.4;
  return { x: MOUND.x + Math.cos(a) * r, y: MOUND.y + 2 + Math.sin(a) * r * 0.8 };
}

/**
 * 우승 세리머니: 수비 위치의 9명이 마운드로 달려가 한 덩어리가 되고, 덕아웃에서 나머지가 쏟아져 나와 합류한다.
 * 모인 뒤에는 저마다 다른 박자로 팔을 들고 뛴다. 원정이면 우리 팀(원정 유니폼)이 3루 덕아웃에서 나온다.
 */
function drawChampionPile(ctx: Ctx, scene: StadiumScene, fx: ChampFx, fxT: number, f: number): void {
  const k = fx.away ? kit(scene.awayColor, false) : kit(scene.homeColor, true);
  const side: -1 | 1 = fx.away ? -1 : 1;
  const list: { x: number; y: number; pose: 0 | 1 | 2; ph: number }[] = [];
  const at = (from: Pt, i: number, t0: number, dur: number) => {
    const g = fx.calm ? 1 : clamp01((fxT - t0) / dur);
    const to = pileSpot(i);
    const e = 1 - (1 - g) * (1 - g);
    list.push({ x: lerp(from.x, to.x, e), y: lerp(from.y, to.y, e), pose: g < 1 ? 1 : 2, ph: i * 3 + (i >> 2) });
  };
  // 투수·포수가 먼저 닿고, 외야수가 마지막
  FIELDERS.forEach((p, i) => at(p, i, 0.05 * i, 0.5 + Math.hypot(p.x - MOUND.x, p.y - MOUND.y) / 150));
  for (let j = 0; j < PILE_BENCH; j++) {
    const from = standToWorld(side, -4, 50 + j * 3);
    at(from, PILE_FIELD + j, 0.35 + j * 0.12, 1.5);
  }
  list.sort((a, b) => a.y - b.y);
  for (const s of list) {
    // 뛰는 박자를 선수마다 어긋나게 (calm 이면 팔만 든 정지 자세)
    const ff = fx.calm ? 0 : (f >> (s.ph & 1)) + s.ph;
    sprite(ctx, X(s.x), Y(s.y), k, s.pose, ff);
  }
  // 헹가래: 깃발이 오른 뒤 덩어리가 감독을 세 번 던져 올린다 (움직임 줄이기면 공중에 뜬 한 장면)
  const tossT = fxT - 2.6;
  if (fx.calm || tossT > 0) {
    const n = fx.calm ? 0.5 : tossT / 0.85; // 한 번에 0.85초
    if (fx.calm || n < 3) {
      const lift = Math.round(Math.abs(Math.sin(Math.PI * (n % 1))) * 13);
      const mx = X(MOUND.x - 6);
      const my = Y(MOUND.y + 2) + 1 - lift; // 덩어리 바로 위에서 솟았다 떨어진다
      // 감독은 정장 차림(짙은 색) — 누운 자세 대신 팔을 든 자세로 위아래만
      sprite(ctx, mx, my, { j: '#2b3350', c: '#1b2233', p: '#3a4563' }, 2, fx.calm ? 0 : f);
    }
  }
  // 다 모이면 덩어리 한가운데서 팀 깃발이 올라간다
  const up = fx.calm ? 1 : clamp01((fxT - 1.7) / 0.6);
  if (up > 0) {
    const px = X(MOUND.x) + 1;
    const py = Y(MOUND.y + 2) - 6;
    const hgt = Math.round(6 + 16 * up);
    const wv = fx.calm ? 0 : (f >> 2) & 1;
    R(ctx, px, py - hgt, 1, hgt, '#f4f6fa');
    R(ctx, px + 1, py - hgt + wv, 9, 6, fx.c1);
    R(ctx, px + 1, py - hgt + 2 + wv, 9, 2, fx.c2 === fx.c1 ? '#ffffff' : fx.c2);
    R(ctx, px + 1, py - hgt + 6 + wv, 9, 1, 'rgba(15,20,32,0.4)');
  }
}

// ───────── fx ─────────

function cheerLevel(scene: StadiumScene, fxT: number): number {
  const fx = scene.fx;
  switch (fx.kind) {
    case 'hr':
      if (!fx.cheer) return 0;
      return fxT > 1.25 && fxT < 6 ? 2 : fxT <= 1.25 ? 1 : 0;
    case 'score':
      return fx.cheer && fxT < 4 ? 2 : 0;
    case 'walkoff':
    case 'win':
      return fxT < 16 ? 2 : 0;
    case 'champion':
      return fx.away ? 0 : 2; // 원정 구장의 홈 관중은 조용하다
    default:
      return 0;
  }
}

function burst(ctx: Ctx, cx: number, cy: number, age: number, seed: number, big: boolean, f: number): void {
  if (age < 0 || age > 1.5) return;
  const cA = FIREWORK_COLORS[Math.floor(hash2(seed, 1) * FIREWORK_COLORS.length)];
  const cB = FIREWORK_COLORS[Math.floor(hash2(seed, 2) * FIREWORK_COLORS.length)];
  if (age < 0.28) {
    const p = age / 0.28;
    const y = cy + 46 * (1 - p);
    R(ctx, cx, y, 1, 5, '#fff6c8');
    R(ctx, cx, y + 5, 1, 4, cA);
    return;
  }
  const te = age - 0.28;
  if (te < 0.08) {
    R(ctx, cx - 2, cy - 2, 5, 5, '#ffffff');
    R(ctx, cx - 4, cy, 9, 1, '#ffffff');
    R(ctx, cx, cy - 4, 1, 9, '#ffffff');
  }
  const n = big ? 30 : 20;
  const rad = big ? 50 : 32;
  const k = 1 - Math.pow(1 - Math.min(1, te / 0.9), 2.2);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + hash2(seed, 3) * 6;
    const v = rad * (i % 2 ? 1 : 0.62) * (0.8 + 0.2 * hash2(seed * 31 + i, 4));
    const x = Math.round(cx + Math.cos(a) * v * k);
    const y = Math.round(cy + Math.sin(a) * v * k * 0.8 + te * te * 12);
    if (te > 0.85 && (i + f) % 2 === 0) continue;
    const c = i % 2 === 0 ? cB : cA;
    const sz = te < 0.5 ? (big ? 3 : 2) : te < 0.95 ? 2 : 1;
    R(ctx, x + 1, y + 1, sz, sz, 'rgba(40,30,70,0.4)');
    R(ctx, x, y, sz, sz, c);
    if (te > 0.12 && te < 0.7) {
      const x2 = cx + Math.cos(a) * v * k * 0.72;
      const y2 = cy + Math.sin(a) * v * k * 0.8 * 0.72 + te * te * 9;
      R(ctx, x2, y2, 1, 1, '#ffffff');
    }
  }
}

function fireworks(ctx: Ctx, t0: number, key: number, n: number, gap: number, big: boolean, loop: number, f: number): void {
  for (let i = 0; i < n; i++) {
    let age = t0 - i * gap - hash2(key + i, 9) * 0.25;
    let cyc = 0;
    if (loop > 0 && age > 0) {
      cyc = Math.floor(age / loop);
      age = age % loop;
    }
    const seed = key * 13 + i * 7 + cyc * 101;
    const cx = Math.round(80 + ((i + hash2(seed, 5)) / n) * 480);
    const cy = Math.round(40 + hash2(seed, 6) * 150);
    burst(ctx, cx, cy, age, seed, big, f);
  }
}

function confetti(ctx: Ctx, fxT: number, key: number): void {
  const n = fxT < 8 ? 90 : Math.max(0, Math.round(90 * (1 - (fxT - 8) / 4)));
  for (let i = 0; i < n; i++) {
    const sp = 34 + hash2(i, key) * 46;
    const y = ((hash2(i, 71) * 460 + fxT * sp) % 460) - 20;
    const x = hash2(i, 72) * STADIUM_W + Math.sin(fxT * 3 + i) * 5;
    const c = FIREWORK_COLORS[i % FIREWORK_COLORS.length];
    if ((Math.floor(fxT * 8) + i) & 1) R(ctx, x, y, 2, 1, c);
    else R(ctx, x, y, 1, 2, c);
  }
}

const CHAMP_CONFETTI = 120; // 폰에서도 프레임이 버티는 상한

/** 팀 색 색종이: 관중석(원정이면 원정 응원석)에서 흩날려 떨어진다 */
function teamConfetti(ctx: Ctx, L: StaticLayers, scene: StadiumScene, fx: ChampFx, fxT: number): void {
  const cols = [fx.c1, fx.c2, '#ffffff', fx.c1, PAL.gold];
  // 홈: 구장 그릇 전체(스탠드 위에서 그라운드로)
  let x0 = 90;
  let x1 = 550;
  let y0 = 100;
  let span = 330;
  let n = CHAMP_CONFETTI;
  if (fx.away) {
    // 원정 응원석 위로만
    const seats = awaySeats(L, scene);
    if (!seats.length) return;
    x0 = Infinity;
    x1 = -Infinity;
    let yMin = Infinity;
    let yMax = -Infinity;
    for (const s of seats) {
      x0 = Math.min(x0, s.x);
      x1 = Math.max(x1, s.x);
      yMin = Math.min(yMin, s.y);
      yMax = Math.max(yMax, s.y);
    }
    x0 -= 10;
    x1 += 10;
    y0 = yMin - 40;
    span = yMax - yMin + 60;
    n = 60;
  }
  if (fx.calm) n = Math.round(n / 4);
  const fade = fxT < 0.3 ? fxT / 0.3 : 1;
  n = Math.round(n * fade);
  for (let i = 0; i < n; i++) {
    const sp = fx.calm ? 0 : 26 + hash2(i, 81) * 34;
    const y = y0 + ((hash2(i, 82) * span + fxT * sp) % span);
    const x = x0 + hash2(i, 83) * (x1 - x0) + (fx.calm ? 0 : Math.sin(fxT * 3 + i) * 4);
    const c = cols[i % cols.length];
    // 3×2 ↔ 2×3 으로 뒤집히며 떨어지는 종이 (그림자 1px 로 밝은 바닥에서도 보이게)
    const flat = ((fx.calm ? 0 : Math.floor(fxT * 7)) + i) & 1;
    const w = flat ? 3 : 2;
    const h = flat ? 2 : 3;
    R(ctx, x + 1, y + 1, w, h, 'rgba(15,20,32,0.35)');
    R(ctx, x, y, w, h, c);
  }
}

/** 전광판 위의 픽셀 폭죽: 정해진 박자에 좌우를 오가며 터진다 */
function champFireworks(ctx: Ctx, fx: ChampFx, fxT: number, key: number, f: number): void {
  const pops = fx.calm ? CHAMP_POPS.slice(0, 2) : CHAMP_POPS;
  const cx0 = SB_FRAME.x + SB_FRAME.w / 2;
  for (let i = 0; i < pops.length; i++) {
    const age = fxT - pops[i] + 0.28; // 0.28초 동안 올라가 pops[i] 에 터진다
    if (age < 0 || age > 1.5) continue;
    const dir = i & 1 ? 1 : -1;
    const cx = Math.round(cx0 + dir * (24 + hash2(i, key + 5) * 70));
    const cy = Math.round(30 + hash2(i, key + 6) * 18);
    burst(ctx, cx, cy, fx.calm ? Math.min(age, 0.6) : age, key * 13 + i * 7, i % 3 !== 2, f);
  }
}

function hrTarget(key: number): { x: number; y: number } {
  const side = hash2(key, 17) < 0.5 ? -1 : 1;
  const phi = (16 + hash2(key, 18) * 22) * DEG * side;
  const rho = 318;
  return { x: rho * Math.sin(phi), y: -rho * Math.cos(phi) };
}

function drawFx(ctx: Ctx, L: StaticLayers, scene: StadiumScene, fxT: number, f: number): void {
  const fx = scene.fx;
  const key = scene.fxKey | 0;
  switch (fx.kind) {
    case 'hr': {
      const T = 1.5;
      const tg = hrTarget(key);
      if (fxT < 0.22) sparkle(ctx, X(0), Y(0, 6), true, '#ffffff');
      if (fxT < T) {
        for (let k = 4; k >= 0; k--) {
          const p = fxT / T - k * 0.035;
          if (p < 0) continue;
          const wx = tg.x * p;
          const wy = tg.y * p;
          const z = 4 + 4 * 92 * p * (1 - p);
          const sx = X(wx);
          const sy = Y(wy, z);
          if (k === 0) {
            R(ctx, sx - 1, Y(wy), 4, 2, 'rgba(0,0,0,0.28)');
            R(ctx, sx - 1, sy, 4, 2, '#3a3320');
            R(ctx, sx, sy - 1, 2, 4, '#3a3320');
            R(ctx, sx, sy, 2, 2, '#ffffff');
          } else {
            R(ctx, sx, sy, k < 3 ? 2 : 1, k < 3 ? 2 : 1, k < 2 ? '#fff6c8' : '#ffe08a');
          }
        }
      } else if (fxT < T + 0.7) {
        const sx = X(tg.x);
        const sy = Y(tg.y, 10);
        const r = Math.round((fxT - T) * 16);
        sparkle(ctx, sx, sy, true);
        sparkle(ctx, sx - r, sy - (r >> 1), false);
        sparkle(ctx, sx + r, sy - (r >> 1), false, '#ffffff');
        sparkle(ctx, sx, sy - r, false);
      }
      if (fx.cheer && fxT > T - 0.1) fireworks(ctx, fxT - T + 0.1, key, 6, 0.42, false, 0, f);
      break;
    }
    case 'score': {
      if (fxT > 1.0 && fxT < 2.4) {
        const r = Math.round((fxT - 1.0) * 14);
        const sx = X(0);
        const sy = Y(0, 8);
        sparkle(ctx, sx, sy - r, true);
        sparkle(ctx, sx - r - 3, sy - (r >> 1), false, '#ffffff');
        sparkle(ctx, sx + r + 3, sy - (r >> 1), false);
        if (fx.cheer) {
          sparkle(ctx, sx - 2 * r, sy - r - 4, false, '#ff9d2e');
          sparkle(ctx, sx + 2 * r, sy - r - 4, false, '#5ec8ff');
        }
      }
      if (fx.cheer && fxT > 0.9) fireworks(ctx, fxT - 0.9, key, 2, 0.5, false, 0, f);
      break;
    }
    case 'walkoff':
      if (fxT < 14) {
        fireworks(ctx, fxT - 0.6, key, 9, 0.33, true, 3.1, f);
        if (fxT > 0.8) confetti(ctx, fxT - 0.8, key);
      }
      break;
    case 'win':
      if (fxT < 12) {
        fireworks(ctx, fxT - 0.2, key, 7, 0.4, true, 3.0, f);
        if (fxT > 0.5) confetti(ctx, fxT - 0.5, key);
      }
      break;
    case 'champion':
      teamConfetti(ctx, L, scene, fx, fxT);
      champFireworks(ctx, fx, fxT, key, f);
      break;
    case 'injury': {
      if (fxT > 8) break;
      // 쓰러진 선수 + 달려오는 트레이너
      const px = X(26);
      const py = Y(-92);
      const k = scene.homeBatting ? scene.awayColor : scene.homeColor;
      R(ctx, px - 3, py, 8, 1, 'rgba(20,50,20,0.28)');
      R(ctx, px - 3, py - 2, 2, 2, PAL.skin);
      R(ctx, px - 1, py - 2, 4, 2, k);
      R(ctx, px + 3, py - 2, 2, 2, '#ffffff');
      const g = clamp01(fxT / 1.3);
      const tx = lerp(X(74), px + 7, g);
      const ty = lerp(Y(-40), py + 1, g);
      sprite(ctx, Math.round(tx), Math.round(ty), { j: '#ffffff', c: PAL.red, p: '#34425e' }, g < 1 ? 1 : 0, f);
      if (g >= 1) R(ctx, px + 9, py - 3, 3, 3, PAL.red);
      // 적십자 점멸
      const cx = 320;
      const cy = 246;
      const on = (f >> 2) & 1;
      R(ctx, cx - 9, cy - 9, 19, 19, on ? '#b3262a' : '#d9a0a2');
      R(ctx, cx - 8, cy - 8, 17, 17, '#ffffff');
      const rc = on ? PAL.red : '#f3b0b1';
      R(ctx, cx - 2, cy - 6, 5, 13, rc);
      R(ctx, cx - 6, cy - 2, 13, 5, rc);
      break;
    }
    case 'build': {
      const D = 2.8;
      if (fxT > D) break;
      const slot = Math.floor(fxT * 7);
      const amt = 1 - fxT / D;
      if (fx.target === 'seats') {
        const n = L.seats.length;
        const cnt = Math.round(46 * amt) + 6;
        for (let i = 0; i < cnt && n > 0; i++) {
          const s = L.seats[Math.floor(hash2(i, slot + key * 7) * n)];
          sparkle(ctx, s.x, s.y, i % 4 === 0, i % 3 ? '#ffe45c' : '#ffffff');
        }
        for (let i = 0; i < 12; i++) {
          const s = L.seats[Math.floor(hash2(i, 991 + key) * n)];
          if (!s) continue;
          const up = (fxT * 14 + i * 3) % 12;
          dust(ctx, s.x, s.y + 4 - up, amt);
        }
      } else {
        const r = fx.target === 'food' ? HOTSPOTS.food : HOTSPOTS.training;
        const cnt = Math.round(26 * amt) + 5;
        for (let i = 0; i < cnt; i++) {
          const x = r.x + 3 + hash2(i, slot + key * 7) * (r.w - 6);
          const y = r.y + 2 + hash2(i, slot + 57 + key) * (r.h - 8);
          sparkle(ctx, Math.round(x), Math.round(y), i % 3 === 0, i % 2 ? '#ffe45c' : '#ffffff');
        }
        for (let i = 0; i < 10; i++) {
          const up = (fxT * 16 + i * 5) % 16;
          dust(ctx, r.x + 6 + hash2(i, 13 + key) * (r.w - 16), r.y + r.h - 6 - up, amt);
        }
        if (fxT < 0.5 && (f & 1)) {
          R(ctx, r.x, r.y, r.w, 1, '#ffe45c');
          R(ctx, r.x, r.y + r.h - 1, r.w, 1, '#ffe45c');
          R(ctx, r.x, r.y, 1, r.h, '#ffe45c');
          R(ctx, r.x + r.w - 1, r.y, 1, r.h, '#ffe45c');
        }
      }
      break;
    }
    default:
      break;
  }
}

function dust(ctx: Ctx, x: number, y: number, amt: number): void {
  const a = (0.25 + 0.45 * amt).toFixed(2);
  const c = `rgba(240,230,205,${a})`;
  R(ctx, x, y, 5, 3, c);
  R(ctx, x + 1, y - 1, 3, 5, c);
}

// ───────── 날씨 / 야간 ─────────

function drawRain(ctx: Ctx, t: number): void {
  ctx.fillStyle = 'rgba(214,234,255,0.72)';
  for (let i = 0; i < 130; i++) {
    const sp = 300 + hash2(i, 3) * 160;
    const y = ((hash2(i, 5) * 460 + t * sp) % 460) - 20;
    const x = ((hash2(i, 7) * 760 - y * 0.3 + 760) % 760) - 60;
    ctx.fillRect(Math.round(x), Math.round(y), 1, 3);
    ctx.fillRect(Math.round(x) - 1, Math.round(y) + 3, 1, 3);
  }
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  const slot = Math.floor(t * 9);
  for (let i = 0; i < 26; i++) {
    const x = hash2(i, slot) * STADIUM_W;
    const y = 120 + hash2(i, slot + 91) * 290;
    ctx.fillRect(Math.round(x) - 1, Math.round(y), 3, 1);
  }
}

function drawClouds(ctx: Ctx, t: number): void {
  // 구름 그림자: 계단식 타원 두 겹
  ctx.fillStyle = 'rgba(40,55,80,0.045)';
  for (let i = 0; i < 3; i++) {
    const cx = Math.round(((t * 7 + i * 300) % 1000) - 180);
    const cy = 80 + i * 120;
    for (const [rx, ry, ox] of [
      [88, 30, 0],
      [60, 20, 14],
    ]) {
      for (let dy = -ry; dy < ry; dy += 2) {
        const hw = Math.round(rx * Math.sqrt(1 - (dy * dy) / (ry * ry)));
        ctx.fillRect(cx + ox - hw, cy + dy, hw * 2, 2);
      }
    }
  }
}

/** 야간 틴트(알파 ≤ 0.24, 그라운드는 조명으로 밝게). Bayer 디더로 픽셀 느낌 유지. */
export function buildNightTint(): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = STADIUM_W;
  cv.height = STADIUM_H;
  const ctx = cv.getContext('2d');
  if (!ctx) return cv;
  const img = ctx.createImageData(STADIUM_W, STADIUM_H);
  const d = img.data;
  const bayer = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  for (let y = 0; y < STADIUM_H; y++) {
    for (let x = 0; x < STADIUM_W; x++) {
      const ex = (x - 320) / 268;
      const ey = (y - 262) / 152;
      let l = Math.max(0, Math.min(1, (1.25 - Math.sqrt(ex * ex + ey * ey)) / 0.45));
      for (const p of [
        [82, 380],
        [558, 380],
        [56, 66],
      ]) {
        const dd = Math.hypot(x - p[0], (y - p[1]) * 1.3);
        l = Math.max(l, Math.max(0, 1 - dd / 80) * 0.7);
      }
      const a = 0.24 - 0.16 * l;
      const step = 0.04;
      const q = Math.floor(a / step + (bayer[(y & 3) * 4 + (x & 3)] + 0.5) / 16) * step;
      const i = (y * STADIUM_W + x) * 4;
      d[i] = 14;
      d[i + 1] = 24;
      d[i + 2] = 84;
      d[i + 3] = Math.round(Math.min(0.24, q) * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}

function drawLampGlow(ctx: Ctx): void {
  for (const tw of TOWERS) {
    const top = tw.y - tw.h;
    R(ctx, tw.x - 15, top - 17, 31, 25, 'rgba(255,244,180,0.16)');
    R(ctx, tw.x - 12, top - 14, 25, 19, 'rgba(255,244,180,0.22)');
    for (let r = 0; r < 3; r++) for (let c = 0; c < 5; c++) R(ctx, tw.x - 7 + c * 3, top - 9 + r * 3, 2, 2, '#ffffff');
  }
  // 전광판 위 전구
  for (let x = 262; x < 378; x += 6) R(ctx, x, 53, 2, 1, '#ffffff');
}

function drawNeon(ctx: Ctx, f: number, night: boolean): void {
  const s = NEON.strip;
  for (let i = 0; i < 7; i++) {
    const x = s.x + ((f * 2 + i * 14) % (s.w - 5));
    R(ctx, x, s.y, 5, s.h, '#ffd6ea');
  }
  const on = (f >> 1) % NEON.side.n;
  R(ctx, NEON.side.x, NEON.side.y + on * NEON.side.step, 4, 4, '#ffffff');
  const g = NEON.sign;
  const c = (f >> 3) & 1 ? '#4fe3ff' : '#c9f8ff';
  R(ctx, g.x, g.y, g.w, 1, c);
  R(ctx, g.x, g.y + g.h - 1, g.w, 1, c);
  R(ctx, g.x, g.y, 1, g.h, c);
  R(ctx, g.x + g.w - 1, g.y, 1, g.h, c);
  for (let i = 0; i < 5; i++) {
    const lit = ((f >> 2) + i) % 6 !== 0;
    R(ctx, 48 + i * 8, 349, 6, 3, lit ? (i === 3 ? '#ffe566' : '#ff6bb3') : '#7a2f58');
  }
  if (night) {
    R(ctx, g.x - 2, g.y - 2, g.w + 4, g.h + 4, 'rgba(79,227,255,0.14)');
    R(ctx, s.x - 2, s.y - 2, s.w + 4, s.h + 4, 'rgba(255,79,163,0.16)');
  }
}

// ───────── 프레임 ─────────

export function drawFrame(inp: FrameInput): void {
  const { ctx, scene, layers: L, t, fxT } = inp;
  const f = Math.floor(t * 14);
  const cheer = cheerLevel(scene, fxT);
  const night = !!scene.night;
  // 응원 문화: fx 로 환호하는 동안은 한 단계 더 격렬하게
  const baseLv = Math.max(0, Math.min(3, Math.round(scene.cheerLv || 0)));
  const champ = scene.fx.kind === 'champion' ? scene.fx : null;
  // 우승 확정: 홈이면 응원이 최대(물결 둘·대형 현수막 펄럭임), 원정 구장의 홈 관중은 응원을 멈춘다
  const cheerLv = champ ? (champ.away ? 0 : 4) : baseLv > 0 && cheer > 0 ? baseLv + 1 : baseLv;

  ctx.globalAlpha = 1;
  ctx.drawImage(L.base, 0, 0);
  drawCars(ctx, scene, t);
  drawRetired(ctx, scene);
  drawTitleWall(ctx, scene);
  if (cheerLv >= 3) drawBigBanner(ctx, scene, t, cheerLv >= 4);
  drawCrowd(ctx, L, scene, t, f, cheer, cheerLv);
  drawAwayFans(ctx, L, scene, f);
  if (scene.oldBanner !== false) drawOldFan(ctx, L, scene, f);
  drawGate(ctx, L, scene, t, f);
  ctx.drawImage(L.over, 0, 0);
  drawAutumn(ctx, scene, f);
  for (let i = 0; i < L.flags.length; i++) {
    flag(ctx, L.flags[i].x, L.flags[i].y, i % 3 === 1 ? scene.homeColor2 : scene.homeColor, f, i);
  }
  drawBanners(ctx, scene, f);
  drawCustomers(ctx, L, scene, f);
  drawTraining(ctx, L, scene, t, f);
  drawPlayers(ctx, scene, t, fxT, f);
  drawDome(ctx, scene.dome, f);

  if (scene.weather === 'cloudy') {
    R(ctx, 0, 0, STADIUM_W, STADIUM_H, 'rgba(96,108,128,0.11)');
    drawClouds(ctx, t);
  } else if (scene.weather === 'rain') {
    R(ctx, 0, 0, STADIUM_W, STADIUM_H, 'rgba(70,92,128,0.15)');
  }
  if (night && inp.night) {
    ctx.drawImage(inp.night, 0, 0);
    drawLampGlow(ctx);
  }
  if (L.lv.food === 4) drawNeon(ctx, f, night);
  drawFx(ctx, L, scene, fxT, f);
  if (scene.weather === 'rain') drawRain(ctx, t);
}
