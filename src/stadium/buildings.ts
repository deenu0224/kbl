// 매점·훈련장·전광판·주차장·나무·조명탑 등 구조물 픽셀아트 (정적 버퍼에 그림)
import type { Buf } from './buf';
import { HOTSPOTS, PARKING, SB_FRAME, hash2, type Pt, type Rect } from './geometry';
import { PAL, shade } from './palette';

const FOOD = HOTSPOTS.food;
const TRAIN = HOTSPOTS.training;

// ───────── 공용 조각 ─────────

/** 부지 바닥. kind: 0 흙바닥, 1 밝은 타일, 2 테라코타 타일, 3 잔디 */
function pad(b: Buf, r: Rect, kind: 0 | 1 | 2 | 3): void {
  const cols: [string, string, string][] = [
    ['#e3d3ad', '#dccba2', '#c9b88e'],
    ['#f3ead4', '#ece1c8', '#d6c8a8'],
    ['#f6d3ae', '#f0c79e', '#d9a97c'],
    ['#8ed46a', '#84cb60', '#63b04a'],
  ];
  const [a, c2, edge] = cols[kind];
  for (let y = r.y; y < r.y + r.h; y++) {
    for (let x = r.x; x < r.x + r.w; x++) {
      const border = x === r.x || y === r.y || x === r.x + r.w - 1 || y === r.y + r.h - 1;
      let c: string;
      if (border) c = edge;
      else if (kind === 0) c = hash2(x, y) < 0.12 ? c2 : a;
      else if (kind === 3) c = ((x + y * 3) >> 2) & 1 ? a : c2;
      else c = ((x - r.x) >> 3) + ((y - r.y) >> 3) & 1 ? a : c2;
      b.rect(x, y, 1, 1, c);
    }
  }
  if (kind === 0) {
    // 잡초
    for (let i = 0; i < 26; i++) {
      const x = r.x + 4 + Math.floor(hash2(i, 51) * (r.w - 8));
      const y = r.y + 4 + Math.floor(hash2(i, 77) * (r.h - 8));
      b.rect(x, y, 1, 2, '#6ab04c');
      b.rect(x + 1, y + 1, 1, 1, '#8ed46a');
    }
  }
}

export function tree(b: Buf, x: number, y: number, variant = 0): void {
  // (x, y) = 밑동
  b.shadeEllipse(x + 1, y, 5, 2, 0.82);
  b.rect(x - 1, y - 4, 2, 4, '#8a5a34');
  b.rect(x, y - 4, 1, 4, '#6e4526');
  const mid = variant === 1 ? '#f59abb' : '#4fb04a';
  const hi = variant === 1 ? '#ffc6da' : '#7fd65f';
  const dk = variant === 1 ? '#d9749b' : '#36903c';
  const ws = [5, 7, 9, 9, 9, 7, 5];
  for (let i = 0; i < ws.length; i++) {
    const w = ws[i];
    const yy = y - 12 + i;
    b.rect(x - (w >> 1), yy, w, 1, mid);
    if (i >= 4) b.rect(x + (w >> 1) - 2, yy, 3, 1, dk);
    if (i === ws.length - 1) b.rect(x - (w >> 1), yy, w, 1, dk);
  }
  b.rect(x - 2, y - 11, 3, 1, hi);
  b.rect(x - 3, y - 10, 2, 2, hi);
  b.rect(x, y - 9, 1, 1, hi);
  if (variant === 2) {
    // 귤나무
    for (const [dx, dy] of [[-2, -8], [2, -10], [1, -7], [-3, -6], [3, -8]] as const) b.rect(x + dx, y + dy, 1, 1, '#ff9d2e');
  }
}

export function bush(b: Buf, x: number, y: number): void {
  b.shadeEllipse(x, y + 1, 3, 1, 0.85);
  b.rect(x - 2, y - 2, 5, 3, '#4fb04a');
  b.rect(x - 1, y - 3, 3, 1, '#4fb04a');
  b.rect(x - 1, y - 3, 2, 1, '#7fd65f');
  b.rect(x + 1, y, 2, 1, '#36903c');
}

function parasol(b: Buf, x: number, y: number, c1: string, c2: string): void {
  // (x, y) = 테이블 중심
  b.shadeEllipse(x + 1, y + 3, 5, 2, 0.84);
  b.rect(x - 3, y + 1, 7, 2, '#f1e9d6');
  b.rect(x - 3, y + 3, 7, 1, '#cbbf9f');
  b.rect(x - 5, y + 2, 1, 2, '#8a5a34');
  b.rect(x + 5, y + 2, 1, 2, '#8a5a34');
  b.rect(x, y - 3, 1, 5, '#8a8f99');
  const ry = 3;
  const rx = 5;
  const cy = y - 5;
  for (let dy = -ry; dy <= ry; dy++) {
    const k = 1 - (dy * dy) / (ry * ry + 0.35);
    if (k <= 0) continue;
    const hw = Math.round(rx * Math.sqrt(k));
    for (let dx = -hw; dx <= hw; dx++) {
      const seg = Math.floor((Math.atan2(dy * 1.6, dx) + Math.PI) / (Math.PI / 3));
      b.rect(x + dx, cy + dy, 1, 1, seg & 1 ? c1 : c2);
    }
  }
  b.rect(x, cy, 1, 1, '#ffffff');
}

function picnicTable(b: Buf, x: number, y: number): void {
  b.shade(x, y + 3, 12, 1, 0.85);
  b.rect(x, y, 12, 2, '#e9dcc0');
  b.rect(x, y + 2, 12, 1, '#c4a877');
  b.rect(x + 1, y - 2, 10, 1, '#c98d55');
  b.rect(x + 1, y + 4, 10, 1, '#c98d55');
}

function signIcons(b: Buf, x: number, y: number, n: number): void {
  const cs = ['#f08a1c', '#e5564a', '#6ec05a', '#34425e', '#ffd23f', '#5ec8ff'];
  for (let i = 0; i < n; i++) b.rect(x + i * 7, y, 5, 4, cs[i % cs.length]);
}

function stringLights(b: Buf, x0: number, x1: number, y: number): void {
  const cs = ['#ffd23f', '#ff6b6b', '#5ec8ff', '#6ee07a'];
  let k = 0;
  for (let x = x0; x <= x1; x += 3) {
    const sag = Math.round(Math.sin(((x - x0) / (x1 - x0)) * Math.PI) * 2);
    b.rect(x, y + sag, 1, 1, '#5a6275');
    b.rect(x + 1, y + sag + 1, 1, 1, cs[k++ % cs.length]);
  }
}

// ───────── 매점 ─────────

/** 창구(줄 서는 곳) x 좌표와 줄 시작 y */
const QUEUE: { xs: number[]; y0: number; cap: number }[] = [
  { xs: [70, 82], y0: 397, cap: 4 },
  { xs: [62, 92], y0: 396, cap: 8 },
  { xs: [47, 74, 101], y0: 396, cap: 12 },
  { xs: [33, 55, 77, 99], y0: 396, cap: 18 },
  { xs: [34, 56, 78, 100], y0: 397, cap: 24 },
];

/** 매점 손님이 설 자리(채워지는 순서). y = 발 위치 */
export function queueSpots(lv: number): Pt[] {
  const q = QUEUE[lv];
  const out: Pt[] = [];
  for (let i = 0; out.length < q.cap; i++) {
    for (const x of q.xs) {
      if (out.length >= q.cap) break;
      out.push({ x: x + (i & 1), y: q.y0 + i * 4 });
    }
  }
  return out;
}

/** 파라솔 자리에 앉는 손님 (Lv3+) */
export function parasolSpots(lv: number): Pt[] {
  if (lv < 3) return [];
  const ps = lv === 3 ? PARASOLS3 : PARASOLS4;
  const out: Pt[] = [];
  for (const p of ps) {
    out.push({ x: p.x - 6, y: p.y + 4 });
    out.push({ x: p.x + 5, y: p.y + 4 });
  }
  return out;
}

const PARASOLS3: Pt[] = [
  { x: 128, y: 362 },
  { x: 142, y: 374 },
  { x: 128, y: 387 },
  { x: 142, y: 400 },
];
const PARASOLS4: Pt[] = [
  { x: 134, y: 364 },
  { x: 144, y: 378 },
  { x: 134, y: 392 },
  { x: 144, y: 405 },
];
const PARASOL_COLS: [string, string][] = [
  ['#ff6b6b', '#ffffff'],
  ['#5ec8ff', '#ffffff'],
  ['#ffd23f', '#ff9d2e'],
  ['#6ee07a', '#ffffff'],
];

/** Lv4 네온 (동적 레이어에서 깜빡임) */
export const NEON = {
  strip: { x: 18, y: 370, w: 98, h: 2 },
  sign: { x: 44, y: 346, w: 48, h: 9 },
  side: { x: 119, y: 354, n: 6, step: 6 },
};

function shop(
  b: Buf,
  x0: number,
  w: number,
  roof: string,
  awnA: string,
  awnB: string,
  wins: number[],
  winW: number,
): void {
  b.shade(x0 + 2, 389, w + 2, 3, 0.8);
  // 지붕(윗면)
  b.rect(x0 - 2, 351, w + 4, 9, roof);
  b.rect(x0 - 2, 351, w + 4, 2, shade(roof, 0.25));
  b.rect(x0 - 2, 359, w + 4, 1, shade(roof, -0.25));
  // 벽
  b.rect(x0, 360, w, 29, '#f7f0e1');
  b.rect(x0, 386, w, 3, '#d9cdb2');
  b.rect(x0, 360, 1, 29, '#e5dcc6');
  b.rect(x0 + w - 1, 360, 1, 29, '#d9cdb2');
  // 차양
  for (let x = x0 - 4, i = 0; x < x0 + w + 4; x += 6, i++) {
    const c = i & 1 ? awnA : awnB;
    const ww = Math.min(6, x0 + w + 4 - x);
    b.rect(x, 362, ww, 6, c);
    b.rect(x, 367, ww, 1, shade(c, -0.15));
    b.rect(x + 1, 368, Math.max(1, ww - 2), 1, c);
  }
  b.rect(x0, 369, w, 1, '#d9cdb2');
  // 창구
  for (const wx of wins) {
    b.rect(wx, 372, winW, 9, '#34425e');
    b.rect(wx + 1, 373, winW - 2, 3, PAL.glass);
    b.rect(wx + 1, 373, 5, 1, PAL.glassHi);
    b.rect(wx + winW - 6, 377, 4, 3, '#ffd23f');
    b.rect(wx - 1, 381, winW + 2, 2, '#c98d55');
    b.rect(wx - 1, 383, winW + 2, 1, '#a57444');
  }
}

export function drawConcession(b: Buf, lv: number): void {
  if (lv === 0) {
    pad(b, FOOD, 0);
    // 포장마차
    b.shade(60, 390, 40, 3, 0.8);
    b.rect(60, 372, 38, 16, '#6b4a2e');
    b.rect(60, 381, 38, 3, '#e0aa6e');
    b.rect(60, 384, 38, 4, '#b9814d');
    b.rect(64, 379, 3, 2, '#ff6b6b');
    b.rect(70, 379, 3, 2, '#ffd23f');
    b.rect(84, 378, 5, 3, '#e9edf2');
    b.rect(85, 376, 1, 2, '#ffffff');
    b.rect(58, 362, 42, 3, '#ffb85a');
    b.rect(56, 365, 46, 7, '#f58a1f');
    for (let i = 0; i < 6; i++) b.rect(56 + i * 8, 365, 4, 7, '#ffa23a');
    b.rect(56, 371, 46, 1, '#c96a12');
    for (let i = 0; i < 12; i++) b.rect(56 + i * 4, 372, 2, 1, '#f58a1f');
    b.rect(60, 373, 1, 15, PAL.steel);
    b.rect(97, 373, 1, 15, PAL.steel);
    b.rect(63, 388, 4, 3, '#3a3f4b');
    b.rect(91, 388, 4, 3, '#3a3f4b');
    b.rect(78, 373, 2, 3, '#fff2a8');
    for (const sx of [46, 106, 114]) {
      b.rect(sx, 386, 4, 2, '#d9534f');
      b.rect(sx + 1, 388, 2, 3, '#6b4a2e');
    }
    b.rect(122, 376, 9, 9, '#c49a62');
    b.rect(122, 380, 9, 1, '#a57c48');
    b.rect(130, 381, 8, 8, '#b98b56');
    b.rect(130, 385, 8, 1, '#946b3c');
    b.rect(24, 380, 5, 7, '#5b8fd6');
    b.rect(24, 380, 5, 1, '#8ab4ea');
    return;
  }
  if (lv === 1) {
    pad(b, FOOD, 1);
    b.shade(46, 389, 64, 3, 0.8);
    b.rect(42, 354, 68, 10, '#e8604c');
    b.rect(42, 354, 68, 2, '#f58773');
    b.rect(42, 363, 68, 1, '#b9432f');
    b.rect(44, 364, 64, 25, '#f7f0e1');
    b.rect(44, 386, 64, 3, '#d9cdb2');
    b.rect(107, 364, 1, 25, '#d9cdb2');
    for (const wx of [52, 82]) {
      b.rect(wx, 369, 22, 11, '#34425e');
      b.rect(wx + 1, 370, 20, 4, PAL.glass);
      b.rect(wx + 1, 370, 6, 2, PAL.glassHi);
      b.rect(wx + 15, 375, 4, 4, '#ffd23f');
      b.rect(wx - 1, 380, 24, 2, '#c98d55');
      b.rect(wx - 1, 382, 24, 1, '#a57444');
    }
    b.rect(76, 369, 4, 9, '#ffd23f');
    b.rect(77, 371, 2, 1, '#e5564a');
    b.rect(77, 374, 2, 1, '#e5564a');
    // 간판
    b.rect(58, 347, 36, 9, '#fff8e6');
    b.rect(58, 347, 36, 1, '#b9432f');
    b.rect(58, 355, 36, 1, '#b9432f');
    b.rect(58, 347, 1, 9, '#b9432f');
    b.rect(93, 347, 1, 9, '#b9432f');
    signIcons(b, 62, 350, 4);
    b.rect(114, 380, 5, 8, '#4f9d6a');
    b.rect(113, 379, 7, 2, '#3a7a52');
    picnicTable(b, 126, 378);
    b.rect(22, 378, 9, 9, '#c49a62');
    b.rect(22, 382, 9, 1, '#a57c48');
    return;
  }
  if (lv === 2) {
    pad(b, FOOD, 1);
    shop(b, 28, 94, '#d9534f', '#e8604c', '#ffffff', [36, 63, 90], 24);
    b.rect(48, 346, 54, 9, '#fff8e6');
    b.rect(48, 346, 54, 1, '#b9432f');
    b.rect(48, 354, 54, 1, '#b9432f');
    b.rect(48, 346, 1, 9, '#b9432f');
    b.rect(101, 346, 1, 9, '#b9432f');
    signIcons(b, 54, 349, 6);
    picnicTable(b, 128, 364);
    picnicTable(b, 134, 380);
    b.rect(16, 380, 5, 8, '#4f9d6a');
    b.rect(15, 379, 7, 2, '#3a7a52');
    return;
  }
  if (lv === 3) {
    pad(b, FOOD, 2);
    shop(b, 20, 94, '#2f9e8f', '#35b8a6', '#fff3c4', [24, 46, 68, 90], 20);
    b.rect(38, 346, 58, 9, '#fff8e6');
    b.rect(38, 346, 58, 1, '#1f7468');
    b.rect(38, 354, 58, 1, '#1f7468');
    b.rect(38, 346, 1, 9, '#1f7468');
    b.rect(95, 346, 1, 9, '#1f7468');
    signIcons(b, 43, 349, 7);
    b.rect(150, 349, 1, 60, PAL.steel);
    stringLights(b, 116, 149, 350);
    PARASOLS3.forEach((p, i) => parasol(b, p.x, p.y, PARASOL_COLS[i % 4][0], PARASOL_COLS[i % 4][1]));
    // 음료 카트
    b.shade(15, 409, 14, 2, 0.82);
    b.rect(14, 398, 14, 9, '#5ec8ff');
    b.rect(14, 398, 14, 2, '#bfe9ff');
    b.rect(13, 395, 16, 3, '#ffffff');
    b.rect(13, 395, 4, 3, '#ff6b6b');
    b.rect(21, 395, 4, 3, '#ff6b6b');
    b.rect(15, 407, 3, 2, '#3a3f4b');
    b.rect(24, 407, 3, 2, '#3a3f4b');
    return;
  }
  // Lv4: 2층 네온 푸드홀
  pad(b, FOOD, 2);
  b.shade(20, 391, 100, 3, 0.78);
  // 옥상
  b.rect(16, 347, 102, 8, '#46527a');
  b.rect(16, 347, 102, 1, '#6675a3');
  b.rect(16, 354, 102, 1, '#2b3350');
  b.rect(22, 349, 9, 4, '#cfd6de');
  b.rect(22, 349, 9, 1, '#eef1f5');
  b.rect(96, 349, 16, 3, '#6ec05a');
  b.rect(98, 348, 3, 1, '#ff9d2e');
  b.rect(105, 348, 3, 1, '#ff6b9d');
  // 네온 간판
  b.rect(NEON.sign.x, NEON.sign.y, NEON.sign.w, NEON.sign.h, '#1b2233');
  b.rect(NEON.sign.x, NEON.sign.y, NEON.sign.w, 1, '#4fe3ff');
  b.rect(NEON.sign.x, NEON.sign.y + 8, NEON.sign.w, 1, '#4fe3ff');
  b.rect(NEON.sign.x, NEON.sign.y, 1, 9, '#4fe3ff');
  b.rect(NEON.sign.x + 47, NEON.sign.y, 1, 9, '#4fe3ff');
  for (let i = 0; i < 5; i++) b.rect(48 + i * 8, 349, 6, 3, i === 3 ? '#ffd23f' : '#ff4fa3');
  // 2층
  b.rect(18, 355, 98, 15, '#fdf6ea');
  b.rect(22, 357, 90, 10, '#5cc8ee');
  for (let i = 0; i <= 6; i++) {
    b.rect(22 + i * 15, 357, 1, 10, '#fdf6ea');
    if (i < 6) {
      b.rect(24 + i * 15, 358, 5, 2, '#c9f1ff');
      b.rect(27 + i * 15, 363, 2, 4, '#2f89b3');
      b.rect(32 + i * 15, 364, 2, 3, '#2f89b3');
    }
  }
  b.rect(18, 368, 98, 2, '#e9dfcb');
  // 네온 띠
  b.rect(NEON.strip.x, NEON.strip.y, NEON.strip.w, NEON.strip.h, '#ff4fa3');
  // 1층
  b.rect(18, 372, 98, 19, '#f4ead6');
  b.rect(18, 388, 98, 3, '#d9cdb2');
  for (let x = 14, i = 0; x < 120; x += 6, i++) {
    const c = i & 1 ? '#ff6b9d' : '#ffffff';
    const ww = Math.min(6, 120 - x);
    b.rect(x, 372, ww, 5, c);
    b.rect(x + 1, 377, Math.max(1, ww - 2), 1, c);
  }
  for (const wx of [24, 46, 68, 90]) {
    b.rect(wx, 379, 20, 7, '#34425e');
    b.rect(wx + 1, 380, 18, 3, PAL.glass);
    b.rect(wx + 1, 380, 5, 1, PAL.glassHi);
    b.rect(wx + 14, 383, 4, 3, '#ffd23f');
    b.rect(wx - 1, 386, 22, 2, '#c98d55');
  }
  // 세로 간판
  b.rect(118, 352, 6, 38, '#1b2233');
  for (let i = 0; i < NEON.side.n; i++) {
    b.rect(NEON.side.x, NEON.side.y + i * NEON.side.step, 4, 4, ['#ffd23f', '#ff4fa3', '#4fe3ff'][i % 3]);
  }
  PARASOLS4.forEach((p, i) => parasol(b, p.x, p.y, PARASOL_COLS[i % 4][0], PARASOL_COLS[i % 4][1]));
  stringLights(b, 124, 150, 350);
}

// ───────── 훈련장 ─────────

export interface TrainActor {
  kind: 'pitch' | 'jog' | 'bat';
  a: Pt; // 발 위치
  b: Pt;
}

export function trainActors(lv: number): TrainActor[] {
  switch (lv) {
    case 1:
      return [{ kind: 'bat', a: { x: 520, y: 380 }, b: { x: 566, y: 381 } }];
    case 2:
      return [
        { kind: 'bat', a: { x: 506, y: 380 }, b: { x: 546, y: 381 } },
        { kind: 'pitch', a: { x: 577, y: 364 }, b: { x: 577, y: 405 } },
      ];
    case 3:
      return [
        { kind: 'pitch', a: { x: 607, y: 360 }, b: { x: 607, y: 407 } },
        { kind: 'jog', a: { x: 498, y: 411 }, b: { x: 578, y: 411 } },
      ];
    case 4:
      return [
        { kind: 'pitch', a: { x: 506, y: 408 }, b: { x: 579, y: 408 } },
        { kind: 'jog', a: { x: 598, y: 412 }, b: { x: 624, y: 412 } },
      ];
    default:
      return [];
  }
}

function cage(b: Buf, x: number, y: number, w: number, h: number): void {
  b.shade(x + 2, y + h, w, 2, 0.84);
  b.rect(x, y, w, h, '#58a946');
  for (let yy = y; yy < y + h; yy += 4) b.rect(x, yy, w, 2, '#52a141');
  const cy = y + (h >> 1);
  b.ellipse(x + w - 10, cy, 7, 5, PAL.dirt);
  b.rect(x + w - 6, cy - 1, 3, 3, '#ffffff');
  // 피칭머신
  b.rect(x + 5, cy - 3, 5, 6, '#e5564a');
  b.rect(x + 5, cy - 3, 5, 1, '#ff8a80');
  b.rect(x + 6, cy + 3, 1, 3, '#3a3f4b');
  b.rect(x + 8, cy + 3, 1, 3, '#3a3f4b');
  b.rect(x + 10, cy - 2, 2, 2, '#3a3f4b');
  // 그물
  for (let yy = y; yy < y + h; yy++) {
    for (let xx = x; xx < x + w; xx++) {
      if ((xx + yy) % 4 === 0 && (xx - yy) % 2 === 0) b.rect(xx, yy, 1, 1, '#d7ead2');
    }
  }
  // 프레임
  b.rect(x - 1, y - 1, w + 2, 1, '#f4f6fa');
  b.rect(x - 1, y + h, w + 2, 1, '#c5cdd8');
  b.rect(x - 1, y - 1, 1, h + 2, '#f4f6fa');
  b.rect(x + w, y - 1, 1, h + 2, '#c5cdd8');
  b.rect(x + (w >> 1), y - 1, 1, h + 2, '#e3e8ee');
  for (const px of [x - 1, x + w]) {
    b.rect(px, y - 4, 1, 3, PAL.steel);
    b.rect(px, y + h + 1, 1, 2, PAL.steelDk);
  }
  b.rect(x - 1, y - 4, w + 2, 1, '#e3e8ee');
}

function bullpenV(b: Buf, cx: number, y0: number, y1: number): void {
  // 세로 불펜 레인: 위에 마운드, 아래 포수
  for (let y = y0 + 6; y < y1 - 4; y += 3) b.rect(cx, y, 1, 1, '#9ad97a');
  b.ellipse(cx, y0 + 4, 7, 4, PAL.dirt);
  b.ellipse(cx, y0 + 3, 4, 2, PAL.dirtHi);
  b.rect(cx - 2, y0 + 4, 4, 1, '#ffffff');
  b.ellipse(cx, y1 - 3, 6, 3, PAL.dirt);
  b.rect(cx - 1, y1 - 4, 3, 2, '#ffffff');
}

function lowFence(b: Buf, r: Rect): void {
  for (let x = r.x; x < r.x + r.w; x++) {
    if (x % 2 === 0) {
      b.rect(x, r.y, 1, 1, '#f4f6fa');
      b.rect(x, r.y + r.h - 1, 1, 1, '#f4f6fa');
    }
  }
  for (let y = r.y; y < r.y + r.h; y++) {
    if (y % 2 === 0) {
      b.rect(r.x, y, 1, 1, '#f4f6fa');
      b.rect(r.x + r.w - 1, y, 1, 1, '#f4f6fa');
    }
  }
  for (let x = r.x; x < r.x + r.w; x += 12) {
    b.rect(x, r.y - 2, 1, 3, PAL.steel);
    b.rect(x, r.y + r.h - 3, 1, 3, PAL.steel);
  }
}

function bench(b: Buf, x: number, y: number, w: number): void {
  b.shade(x, y + 4, w, 1, 0.85);
  b.rect(x, y, w, 2, '#d9a066');
  b.rect(x, y + 2, w, 1, '#a57444');
  b.rect(x + 1, y + 3, 1, 2, '#6b4a2e');
  b.rect(x + w - 2, y + 3, 1, 2, '#6b4a2e');
}

function ballBasket(b: Buf, x: number, y: number): void {
  b.rect(x, y, 7, 5, '#5b8fd6');
  b.rect(x, y, 7, 1, '#8ab4ea');
  b.rect(x + 1, y - 1, 2, 1, '#ffffff');
  b.rect(x + 4, y - 1, 2, 1, '#ffffff');
  b.rect(x + 2, y - 2, 2, 1, '#ffffff');
}

function cone(b: Buf, x: number, y: number): void {
  b.rect(x, y, 3, 1, '#ff8a2a');
  b.rect(x + 1, y - 2, 1, 2, '#ff8a2a');
  b.rect(x + 1, y - 1, 1, 1, '#ffffff');
}

export function drawTraining(b: Buf, lv: number, home: string): void {
  const r = TRAIN;
  if (lv === 0) {
    pad(b, r, 0);
    // 철조망 울타리
    for (let x = r.x + 2; x < r.x + r.w - 2; x++) {
      if (x % 2 === 0) {
        b.rect(x, r.y + 3, 1, 1, '#b9c1cb');
        if (x < 546 || x > 570) b.rect(x, r.y + r.h - 5, 1, 1, '#b9c1cb');
      } else {
        b.rect(x, r.y + 4, 1, 1, '#d5dae0');
      }
    }
    for (let y = r.y + 3; y < r.y + r.h - 4; y += 2) {
      b.rect(r.x + 2, y, 1, 1, '#b9c1cb');
      b.rect(r.x + r.w - 3, y, 1, 1, '#b9c1cb');
    }
    for (let x = r.x + 2; x < r.x + r.w; x += 15) {
      b.rect(x, r.y + 1, 1, 6, PAL.steelDk);
      if (x < 546 || x > 572) b.rect(x, r.y + r.h - 8, 1, 6, PAL.steelDk);
    }
    // 웅덩이, 타이어, 낡은 팻말
    b.ellipse(530, 386, 11, 4, '#a9cbdc');
    b.ellipse(528, 385, 6, 2, '#c7e2ee');
    b.rect(596, 374, 7, 3, '#3a3f4b');
    b.rect(597, 371, 5, 3, '#555b69');
    b.rect(598, 372, 3, 1, '#2a2e38');
    b.rect(606, 377, 7, 3, '#3a3f4b');
    b.rect(516, 360, 1, 10, '#8a5a34');
    b.rect(509, 355, 15, 7, '#f7f0e1');
    b.rect(509, 361, 15, 1, '#c9bf9f');
    b.rect(511, 357, 11, 1, '#d9534f');
    b.rect(511, 359, 7, 1, '#8a8f99');
    b.rect(560, 394, 6, 5, '#8a8f99');
    b.rect(560, 394, 6, 1, '#b9c1cb');
    b.rect(570, 398, 2, 2, '#ffffff');
    b.rect(578, 380, 5, 3, '#ffffff');
    b.rect(578, 382, 5, 1, '#c9c9c0');
    return;
  }
  if (lv === 1) {
    pad(b, r, 3);
    cage(b, 508, 358, 68, 40);
    bench(b, 588, 372, 24);
    ballBasket(b, 590, 386);
    cone(b, 604, 392);
    cone(b, 612, 396);
    b.rect(596, 360, 1, 8, '#8a5a34');
    b.rect(598, 360, 1, 8, '#c98d55');
    b.rect(600, 360, 1, 8, '#8a5a34');
    b.rect(594, 368, 9, 1, '#6b4a2e');
    return;
  }
  if (lv === 2) {
    pad(b, r, 3);
    cage(b, 494, 358, 62, 40);
    const bp: Rect = { x: 562, y: 352, w: 62, h: 58 };
    b.rect(bp.x, bp.y, bp.w, bp.h, '#7cc95a');
    for (let y = bp.y; y < bp.y + bp.h; y += 6) b.rect(bp.x, y, bp.w, 3, '#74c152');
    lowFence(b, bp);
    bullpenV(b, 577, 358, 408);
    bullpenV(b, 607, 358, 408);
    for (let y = bp.y + 2; y < bp.y + bp.h - 2; y += 2) b.rect(592, y, 1, 1, '#f4f6fa');
    bench(b, 500, 404, 22);
    ballBasket(b, 530, 403);
    return;
  }
  if (lv === 3) {
    pad(b, r, 1);
    b.shade(494, 399, 94, 3, 0.8);
    // 지붕
    b.rect(490, 348, 96, 24, '#4f8fd6');
    for (let x = 490; x < 586; x += 6) b.rect(x, 348, 1, 24, '#6fabea');
    b.rect(490, 348, 96, 2, '#9ccaf7');
    b.rect(490, 359, 96, 1, '#3f7cc2');
    b.rect(490, 371, 96, 1, '#2f6bb0');
    for (const sx of [504, 532, 560]) {
      b.rect(sx, 352, 12, 5, '#cfeaff');
      b.rect(sx, 352, 12, 1, '#ffffff');
      b.rect(sx, 363, 12, 5, '#cfeaff');
      b.rect(sx, 363, 12, 1, '#ffffff');
    }
    // 벽
    b.rect(492, 372, 92, 27, '#f1f3f7');
    b.rect(492, 372, 92, 3, home);
    b.rect(492, 396, 92, 3, '#cfd6de');
    b.rect(583, 372, 1, 27, '#cfd6de');
    // 셔터(반쯤 열림) + 실내 인조잔디
    b.rect(499, 379, 28, 20, '#34425e');
    b.rect(500, 380, 26, 9, '#aeb9c6');
    for (let y = 381; y < 389; y += 3) b.rect(500, y, 26, 1, '#93a0af');
    b.rect(500, 393, 26, 6, '#58a946');
    b.rect(500, 389, 26, 4, '#22304a');
    b.rect(510, 394, 3, 2, '#ffffff');
    for (const wx of [534, 548, 562]) {
      b.rect(wx, 379, 10, 8, '#34425e');
      b.rect(wx + 1, 380, 8, 6, PAL.glass);
      b.rect(wx + 1, 380, 3, 2, PAL.glassHi);
    }
    b.rect(574, 384, 7, 15, '#5b6b8a');
    b.rect(575, 385, 5, 5, PAL.glass);
    b.rect(534, 390, 38, 2, home);
    // 불펜
    const bp: Rect = { x: 592, y: 350, w: 32, h: 60 };
    b.rect(bp.x, bp.y, bp.w, bp.h, '#7cc95a');
    for (let y = bp.y; y < bp.y + bp.h; y += 6) b.rect(bp.x, y, bp.w, 3, '#74c152');
    lowFence(b, bp);
    bullpenV(b, 607, 355, 410);
    // 앞마당
    ballBasket(b, 498, 403);
    cone(b, 516, 408);
    cone(b, 528, 408);
    for (let i = 0; i < 7; i++) b.rect(540 + i * 4, 403, 2, 5, '#ffd23f');
    b.rect(540, 403, 26, 1, '#ffd23f');
    b.rect(540, 407, 26, 1, '#ffd23f');
    return;
  }
  // Lv4: 돔형 퍼포먼스 센터 + 의무실
  pad(b, r, 1);
  const cx = 540;
  const by = 380;
  const rx = 46;
  const ry = 29;
  b.shade(496, 395, 95, 3, 0.78);
  // 하단 원통 벽
  b.rect(494, by, 93, 15, '#e3e9f0');
  b.rect(494, by, 93, 1, '#b4c2d2');
  b.rect(496, by + 3, 89, 6, '#5cc8ee');
  for (let x = 496; x < 585; x += 8) b.rect(x, by + 3, 1, 6, '#e3e9f0');
  b.rect(497, by + 4, 87, 1, '#c9f1ff');
  b.rect(494, by + 12, 93, 3, '#c5cfdb');
  b.rect(494, by + 10, 93, 1, home);
  // 돔
  for (let dy = -ry; dy <= 0; dy++) {
    for (let dx = -rx; dx <= rx; dx++) {
      const nx = dx / rx;
      const ny = dy / ry;
      const n = nx * nx + ny * ny;
      if (n > 1) continue;
      const l = -nx * 0.55 - ny * 0.75;
      let c = l > 0.62 ? '#ffffff' : l > 0.32 ? '#f1f5fa' : l > 0.02 ? '#dfe7f0' : '#c7d2df';
      const k = Math.sqrt(Math.max(0.0001, 1 - ny * ny));
      const u = nx / k; // -1..1 경도
      const uu = Math.abs((((u + 1) * 3.5) % 1) - 0.5);
      if (uu > 0.46) c = '#b7c5d5';
      if (Math.abs(n - 0.42) < 0.022 || Math.abs(n - 0.78) < 0.016) c = '#b7c5d5';
      if (n > 0.95) c = '#9fb0c3';
      b.rect(cx + dx, by + dy, 1, 1, c);
    }
  }
  // 꼭대기 채광창
  b.ellipse(cx, by - ry + 5, 9, 3, home);
  b.ellipse(cx, by - ry + 4, 6, 1, shade(home, 0.35));
  b.rect(cx, by - ry - 5, 1, 8, PAL.steelDk);
  // 입구
  b.rect(530, by + 2, 21, 13, '#34425e');
  b.rect(532, by + 4, 8, 11, PAL.glass);
  b.rect(541, by + 4, 8, 11, PAL.glass);
  b.rect(532, by + 4, 3, 3, PAL.glassHi);
  b.rect(527, by, 27, 3, home);
  b.rect(527, by + 2, 27, 1, shade(home, -0.25));
  b.rect(528, 395, 25, 2, '#cfd6de');
  // 의무실
  b.shade(596, 396, 32, 2, 0.8);
  b.rect(592, 360, 36, 9, '#f4f6fa');
  b.rect(592, 360, 36, 1, '#ffffff');
  b.rect(592, 368, 36, 1, '#c5cfdb');
  b.rect(594, 369, 32, 27, '#ffffff');
  b.rect(594, 393, 32, 3, '#cfd6de');
  b.rect(625, 369, 1, 27, '#dfe5ec');
  b.rect(608, 371, 5, 13, PAL.red);
  b.rect(604, 375, 13, 5, PAL.red);
  b.rect(606, 387, 9, 9, '#34425e');
  b.rect(607, 388, 7, 8, PAL.glass);
  b.rect(596, 386, 6, 5, PAL.glass);
  b.rect(619, 386, 5, 5, PAL.glass);
  b.rect(609, 362, 3, 5, PAL.red);
  b.rect(608, 363, 5, 3, PAL.red);
  // 불펜(가로)
  const bp: Rect = { x: 494, y: 399, w: 96, h: 13 };
  b.rect(bp.x, bp.y, bp.w, bp.h, '#7cc95a');
  for (let x = bp.x; x < bp.x + bp.w; x += 8) b.rect(x, bp.y, 4, bp.h, '#74c152');
  lowFence(b, bp);
  b.ellipse(506, 406, 6, 3, PAL.dirt);
  b.rect(505, 405, 1, 3, '#ffffff');
  b.ellipse(579, 406, 5, 3, PAL.dirt);
  b.rect(579, 405, 2, 2, '#ffffff');
  cone(b, 600, 403);
  cone(b, 610, 403);
  ballBasket(b, 618, 399);
}

/** 돔 꼭대기 깃발 위치 (Lv4) */
export const DOME_FLAG: Pt = { x: 541, y: 346 };

// ───────── 전광판 / 주차장 / 조명탑 ─────────

export function drawScoreboard(b: Buf, home: string): void {
  const f = SB_FRAME;
  const led = HOTSPOTS.scoreboard;
  // 다리
  for (const lx of [f.x + 14, f.x + f.w - 20]) {
    b.rect(lx, f.y + f.h, 6, 24, '#6b7689');
    b.rect(lx, f.y + f.h, 2, 24, '#8a95a8');
    b.rect(lx + 5, f.y + f.h, 1, 24, '#525c6e');
  }
  b.rect(f.x + 14, f.y + f.h + 8, f.w - 28, 2, '#6b7689');
  b.shade(f.x + 2, f.y + f.h, f.w - 4, 3, 0.75);
  // 프레임
  b.rect(f.x, f.y, f.w, f.h, '#2a3550');
  b.rect(f.x, f.y, f.w, 2, '#4a5a82');
  b.rect(f.x, f.y, 2, f.h, '#3d4b70');
  b.rect(f.x + f.w - 2, f.y, 2, f.h, '#1c2438');
  b.rect(f.x, f.y + f.h - 2, f.w, 2, '#1c2438');
  b.rect(led.x - 1, led.y - 1, led.w + 2, led.h + 2, '#141b2b');
  b.rect(led.x, led.y, led.w, led.h, '#0a0e17');
  for (let y = led.y + 1; y < led.y + led.h; y += 3) {
    for (let x = led.x + 1; x < led.x + led.w; x += 3) b.rect(x, y, 1, 1, '#121928');
  }
  // 상단 장식: 팀 색 띠 + 전구 + 스피커
  b.rect(f.x + 8, f.y - 5, f.w - 16, 5, home);
  b.rect(f.x + 8, f.y - 5, f.w - 16, 1, shade(home, 0.35));
  b.rect(f.x + 8, f.y - 1, f.w - 16, 1, shade(home, -0.3));
  for (let x = f.x + 12; x < f.x + f.w - 12; x += 6) b.rect(x, f.y - 3, 2, 1, '#fff6c8');
  b.rect(f.x + f.w / 2 - 9, f.y - 12, 18, 7, '#2a3550');
  b.rect(f.x + f.w / 2 - 7, f.y - 10, 14, 3, '#ffd23f');
  b.rect(f.x + f.w / 2 - 9, f.y - 12, 18, 1, '#4a5a82');
  for (const sx of [f.x - 5, f.x + f.w + 1]) {
    b.rect(sx, f.y + 6, 4, 14, '#3a4563');
    b.rect(sx + 1, f.y + 8, 2, 2, '#8a95a8');
    b.rect(sx + 1, f.y + 12, 2, 2, '#8a95a8');
    b.rect(sx + 1, f.y + 16, 2, 2, '#8a95a8');
  }
}

export function drawParkingLines(b: Buf): void {
  const p = PARKING;
  const rows = [28, 50, 66, 88];
  for (const ry of rows) {
    for (let i = 0; i <= 9; i++) b.rect(10 + 10 * i, ry, 1, 14, '#eef1f5');
  }
  b.rect(10, 65, 91, 1, '#eef1f5');
  // 진입로 화살표
  b.rect(54, 20, 4, 3, '#eef1f5');
  b.rect(p.x + 3, 45, 2, 3, '#ffd23f');
  b.rect(p.x + p.w - 5, 83, 2, 3, '#ffd23f');
  // 가로등
  for (const lx of [p.x + 1, p.x + p.w - 2]) {
    b.rect(lx, p.y + p.h - 12, 1, 12, PAL.steelDk);
    b.rect(lx - 1, p.y + p.h - 13, 3, 2, '#fff6c8');
  }
}

/** 조명탑 (오버레이 버퍼) */
export function drawTower(b: Buf, x: number, y: number, h: number): void {
  const top = y - h;
  b.rect(x - 1, top, 3, h, PAL.steel);
  b.rect(x + 1, top, 1, h, PAL.steelDk);
  for (let yy = top + 8; yy < y - 4; yy += 9) b.rect(x - 2, yy, 5, 1, PAL.steelDk);
  b.rect(x - 3, y - 2, 7, 2, '#5b6578');
  // 램프 뱅크
  b.rect(x - 8, top - 10, 17, 11, '#3f4a63');
  b.rect(x - 8, top - 10, 17, 1, '#6a7694');
  b.rect(x - 8, top, 17, 1, '#2a3246');
  for (let r = 0; r < 3; r++) for (let c = 0; c < 5; c++) b.rect(x - 7 + c * 3, top - 9 + r * 3, 2, 2, '#fff6c8');
}

export function drawFoulPole(b: Buf, x: number, yTop: number, yBot: number, side: -1 | 1): void {
  b.rect(x, yTop, 2, yBot - yTop, '#ffd400');
  b.rect(x + 1, yTop, 1, yBot - yTop, '#e0b400');
  for (let y = yTop + 1; y < yTop + 12; y += 2) b.rect(x + (side < 0 ? 2 : -2), y, 2, 1, '#ffe566');
}

export { FOOD as FOOD_RECT, TRAIN as TRAIN_RECT };
