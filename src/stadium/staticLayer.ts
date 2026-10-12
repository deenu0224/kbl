// 정적 레이어: 지형(픽셀 단위 함수) + 관중석 구조물 + 건물. 시설 레벨·팀 색이 바뀔 때만 다시 굽는다.
import type { Facilities } from '../game/types';
import { Buf } from './buf';
import {
  bush,
  drawConcession,
  drawFoulPole,
  drawParkingLines,
  drawScoreboard,
  drawTower,
  drawTraining,
  tree,
} from './buildings';
import {
  AISLE_EVERY,
  B1,
  B2,
  B3,
  BASE_D,
  DECK_GAP,
  DEG,
  DUG_D,
  DUG_T0,
  DUG_T1,
  FENCE_H,
  FENCE_R,
  FENCE_XMAX,
  HX,
  HY,
  MOUND,
  OF_AISLES,
  OF_PHI0,
  OF_PHI1,
  PARK,
  PARKING,
  SEAT_SPEC,
  SQ,
  STADIUM_H,
  STADIUM_W,
  TOWERS,
  YK,
  buildSeats,
  clampLv,
  hash2,
  ofRowR,
  ofRowZ,
  rowD,
  standCoord,
  standOuter,
  standToWorld,
  type Pt,
  type Seat,
} from './geometry';
import { PAL, col, mixN, shadeN } from './palette';

export interface StaticLayers {
  key: string;
  base: HTMLCanvasElement; // 지형 + 구조물
  over: HTMLCanvasElement; // 관중 위에 덮이는 전경(지붕·조명탑)
  seats: Seat[];
  groups: Seat[][]; // 색 인덱스별 좌석
  flags: Pt[]; // 지붕 위 깃대 끝(동적 깃발 위치)
  lv: { seats: number; food: number; training: number };
}

export function staticKey(f: Facilities, home: string, home2: string): string {
  return `${clampLv(f.seats)}|${clampLv(f.food)}|${clampLv(f.training)}|${home}|${home2}`;
}

const C = {
  grassA: col(PAL.grassA),
  grassB: col(PAL.grassB),
  inA: col(PAL.inGrassA),
  inB: col(PAL.inGrassB),
  dirt: col(PAL.dirt),
  dirtEdge: col(PAL.dirtEdge),
  dirtHi: col(PAL.dirtHi),
  track: col(PAL.track),
  trackB: col(PAL.trackB),
  line: col(PAL.line),
  wall: col(PAL.wall),
  wallHi: col(PAL.wallHi),
  berm: col(PAL.berm),
  bermB: col(PAL.bermB),
  lawn: col(PAL.lawn),
  lawnB: col(PAL.lawnB),
  hedge: col(PAL.hedge),
  plazaA: col(PAL.plazaA),
  plazaB: col(PAL.plazaB),
  road: col(PAL.road),
  roadLine: col(PAL.roadLine),
  curb: col(PAL.curb),
  asphalt: col(PAL.asphalt),
  conc: col(PAL.conc),
  concDk: col(PAL.concDk),
  concOld: col(PAL.concOld),
  concOldDk: col(PAL.concOldDk),
  concUp: col(PAL.concUp),
  concUpDk: col(PAL.concUpDk),
  walk: col(PAL.walk),
  rim: col(PAL.rim),
};

// ───────── 배경(구장 바깥) ─────────

function background(sx: number, sy: number): number {
  if (sy < 18) {
    if ((sy === 8 || sy === 9) && sx % 16 < 8) return C.roadLine;
    if (sy === 0 || sy === 17) return shadeN(C.road, -0.12);
    return hash2(sx, sy) < 0.04 ? shadeN(C.road, 0.08) : C.road;
  }
  if (sy < 20) return C.curb;
  if (sx < 4 || sx >= STADIUM_W - 4 || sy >= STADIUM_H - 4) {
    return hash2(sx, sy) < 0.25 ? shadeN(C.hedge, 0.18) : C.hedge;
  }
  // 주차장 + 진입로
  if (sx >= 46 && sx < 66 && sy < PARKING.y) return C.asphalt;
  if (sx >= PARKING.x && sx < PARKING.x + PARKING.w && sy >= PARKING.y && sy < PARKING.y + PARKING.h) {
    const edge =
      sx === PARKING.x || sx === PARKING.x + PARKING.w - 1 || sy === PARKING.y || sy === PARKING.y + PARKING.h - 1;
    if (edge && !(sy === PARKING.y && sx >= 46 && sx < 66)) return C.curb;
    return hash2(sx, sy) < 0.05 ? shadeN(C.asphalt, 0.08) : C.asphalt;
  }
  // 공원(우상단) + 연못
  if (sx >= PARK.x && sx < PARK.x + PARK.w && sy >= PARK.y && sy < PARK.y + PARK.h) {
    const ex = (sx - 584) / 24;
    const ey = (sy - 70) / 12;
    const e = ex * ex + ey * ey;
    if (e < 0.78) {
      if (ex * ex * 3 + (ey + 0.35) * (ey + 0.35) * 6 < 0.35) return 0xc4ecff;
      return ((sx + sy * 2) & 7) === 0 ? 0x8ed8fb : 0x6ec6f0;
    }
    if (e < 1) return 0xf1ead8;
    const edge = sx === PARK.x || sx === PARK.x + PARK.w - 1 || sy === PARK.y || sy === PARK.y + PARK.h - 1;
    if (edge) return C.hedge;
    const h = hash2(sx, sy);
    if (h < 0.012) return 0xffffff;
    if (h < 0.022) return 0xffd23f;
    return ((sx >> 2) + (sy >> 2)) & 1 ? C.lawn : C.lawnB;
  }
  // 광장 타일
  const t = ((sx >> 3) + (sy >> 3)) & 1;
  const h = hash2(sx, sy);
  if (h < 0.015) return 0xd9caa8;
  return t ? C.plazaA : C.plazaB;
}

// ───────── 그라운드 ─────────

function field(x: number, y: number, rho: number, wallD: number, sx: number, sy: number): number {
  const h = hash2(sx, sy);
  // 파울라인
  if (rho > 7 && y < 0) {
    if (x > 0 && Math.abs(x + y) * SQ < 0.8) return C.line;
    if (x < 0 && Math.abs(x - y) * SQ < 0.8) return C.line;
  }
  // 홈 주변 흙
  if (rho < 19) return rho > 17.4 ? C.dirtEdge : h < 0.06 ? C.dirtHi : C.dirt;
  // 마운드
  const dm = Math.hypot(x - MOUND.x, y - MOUND.y);
  if (dm < 10.5) {
    if (dm > 9) return C.dirtEdge;
    return x + (y - MOUND.y) * 0.8 < -2 ? C.dirtHi : C.dirt;
  }
  // 내야 잔디(다이아몬드)
  const dia = Math.abs(x) + Math.abs(y + BASE_D * SQ);
  const inSkinArc = Math.hypot(x, y + 60) < 94 && y < -Math.abs(x) + 7;
  if (dia < BASE_D * SQ - 9) {
    const s = Math.floor((x - y) / 9) & 1;
    const c = s ? C.inA : C.inB;
    return h < 0.04 ? shadeN(c, 0.1) : h > 0.97 ? shadeN(c, -0.06) : c;
  }
  if (inSkinArc) {
    const edge = Math.hypot(x, y + 60) > 92 || dia < BASE_D * SQ - 7.6;
    if (edge) return C.dirtEdge;
    return h < 0.06 ? C.dirtHi : h > 0.96 ? C.dirtEdge : C.dirt;
  }
  // 워닝트랙
  if (rho > 275 || wallD > -7) {
    return h < 0.08 ? C.trackB : C.track;
  }
  // 외야 잔디: 방사형 × 동심원 체커
  const phi = Math.atan2(x, -y);
  const k = Math.floor((phi + Math.PI) / (9 * DEG)) + Math.floor(rho / 44);
  const c = k & 1 ? C.grassA : C.grassB;
  return h < 0.035 ? shadeN(c, 0.1) : h > 0.975 ? shadeN(c, -0.07) : c;
}

// ───────── 내야 관중석 구조 ─────────

function standPixel(lv: number, d: number, t: number, arc: boolean, ang: number, home: number, right: boolean): number {
  const spec = SEAT_SPEC[lv];
  // 덕아웃 지붕
  if (!arc && t > DUG_T0 && t < DUG_T1 && d < DUG_D) {
    const roof = right ? shadeN(home, -0.2) : 0x5b6b8a;
    if (t < DUG_T0 + 1.3 || t > DUG_T1 - 1.3 || d > DUG_D - 1.3) return shadeN(roof, -0.3);
    if (d < 1.6) return shadeN(roof, 0.35);
    return Math.floor(t / 5) & 1 ? roof : shadeN(roof, 0.08);
  }
  if (!arc && t > spec.len) return C.rim;
  if (d < 3.2) return d < 1.3 ? C.wallHi : C.wall;
  if (d < 4.6) return C.walk;
  const dLast = rowD(lv, spec.rows - 1);
  if (d > dLast + 2.4) return d > dLast + 3.3 ? shadeN(C.rim, -0.12) : C.rim;
  const deckLo = rowD(4, 5) + 2.6;
  const deckHi = rowD(4, 6) - 2.6;
  if (lv === 4 && d >= deckLo && d < deckHi) {
    if (d > deckHi - 1.3) return 0x7b8794;
    return 0xece6d6;
  }
  const upper = lv === 4 && d >= deckHi;
  // 통로(계단)
  let aisle = false;
  if (arc) aisle = d >= 16 && Math.abs(ang - Math.PI / 2) * d < 1.5;
  else {
    const m = t % AISLE_EVERY;
    aisle = m < 1.6 || m > AISLE_EVERY - 1.6;
  }
  const rr = (((d - 3.5 - (upper ? DECK_GAP : 0)) % 5) + 5) % 5;
  if (aisle) return rr < 1.3 ? 0xc3c9d1 : 0xeceff3;
  const base = upper ? C.concUp : lv === 0 ? C.concOld : C.conc;
  const dk = upper ? C.concUpDk : lv === 0 ? C.concOldDk : C.concDk;
  return rr < 1.1 ? dk : base;
}

function wallColor(lv: number, k: number, H: number, sx: number, home: number): number {
  if (lv === 0) {
    // 가설 스탠드: 비계 느낌
    if (k === 0) return 0xd8d5c8;
    return sx % 4 === 0 ? 0x7d7a6e : k === 2 ? 0x8f8c80 : 0xa5a296;
  }
  if (k === 0) return 0xeef1f5;
  if (k === 1 || (lv >= 3 && k === 2)) return home;
  if (k === H - 1) return 0x8f9aa8;
  if (lv >= 3 && sx % 6 < 3 && (k === 4 || k === 5 || (lv === 4 && (k === 8 || k === 9)))) return 0x8fd0f0;
  if (sx % 12 === 0) return 0xa4aeba;
  return 0xbcc4ce;
}

// ───────── 빌드 ─────────

export function buildStatic(fac: Facilities, homeHex: string, home2Hex: string): StaticLayers {
  const lv = clampLv(fac.seats);
  const foodLv = clampLv(fac.food);
  const trainLv = clampLv(fac.training);
  const spec = SEAT_SPEC[lv];
  const home = col(homeHex);
  const home2 = col(home2Hex);
  const W = STADIUM_W;
  const H = STADIUM_H;
  const b = new Buf(W, H);
  const mask = new Uint8Array(W * H);
  const dOut = standOuter(lv);

  // 1) 지형
  for (let sy = 0; sy < H; sy++) {
    const y = (sy + 0.5 - HY) / YK;
    for (let sx = 0; sx < W; sx++) {
      const x = sx - HX + 0.5;
      const rho = Math.hypot(x, y);
      const s = standCoord(x, y);
      let c: number;
      if (s.zone === 0) {
        if (rho < FENCE_R) c = field(x, y, rho, s.d, sx, sy);
        else if (rho < FENCE_R + 3) c = C.wall;
        else if (rho < 316) c = berm(sx, sy, rho);
        else c = background(sx, sy);
      } else {
        const arc = s.zone === 2;
        const inStand = s.d <= dOut && (arc || s.t <= spec.len + 2);
        if (inStand) {
          c = standPixel(lv, s.d, s.t, arc, s.ang, home, s.zone === 3);
          mask[sy * W + sx] = 1;
        } else if (!arc && rho < FENCE_R + 1.5 && s.d < 3.2) {
          c = s.d < 1.3 ? C.wallHi : C.wall;
        } else if (!arc && rho < FENCE_R + 1.5 && s.d < 17) {
          c = s.d > 15.6 ? C.hedge : ((sx + sy) >> 2) & 1 ? C.lawn : C.lawnB;
        } else if (rho >= FENCE_R && rho < 316 && Math.abs(x) < -y * 1.12) {
          c = berm(sx, sy, rho);
        } else {
          c = background(sx, sy);
        }
      }
      b.set(sx, sy, c);
    }
  }

  // 2) 관중석 뒷벽(카메라 쪽 면) + 그림자
  for (let sx = 0; sx < W; sx++) {
    for (let sy = 1; sy < H; sy++) {
      if (mask[(sy - 1) * W + sx] && !mask[sy * W + sx]) {
        for (let k = 0; k < spec.wallH; k++) b.set(sx, sy + k, wallColor(lv, k, spec.wallH, sx, home));
        b.shade(sx, sy + spec.wallH, 1, 2, 0.8);
      }
    }
  }

  // 3) 외야 펜스 (카메라를 향한 안쪽 면)
  const fenceTop = (sx: number): number => {
    const x = sx - HX + 0.5;
    return Math.round(HY - YK * Math.sqrt(FENCE_R * FENCE_R - x * x)) - FENCE_H;
  };
  const adCols = [0xffffff, 0xe5564a, 0x3f7fd6, 0xffd23f, 0xf08a1c, 0xffffff];
  for (let sx = Math.ceil(HX - FENCE_XMAX); sx < HX + FENCE_XMAX; sx++) {
    const top = fenceTop(sx);
    const sec = Math.floor((sx - 100) / 22);
    const inSec = (sx - 100) % 22;
    const hasAd = hash2(sec, 5) < 0.55 && inSec > 2 && inSec < 20;
    for (let k = 0; k <= FENCE_H; k++) {
      let c: number;
      if (k === 0) c = col(PAL.fenceTop);
      else if (k === 1) c = 0x2f946c;
      else if (inSec === 0) c = col(PAL.fenceDk);
      else if (hasAd && k >= 3 && k <= 6) {
        const ad = adCols[sec % 6];
        c = k === 3 || k === 6 || inSec === 3 || inSec === 19 ? ad : mixN(ad, 0xffffff, 0.55);
      }
      else c = col(PAL.fence);
      b.set(sx, top + k, c);
    }
    b.shade(sx, top + FENCE_H + 1, 1, 2, 0.86);
  }

  // 4) 백스크린 (중앙)
  for (let sx = HX - 62; sx < HX + 62; sx++) {
    const top = fenceTop(sx);
    for (let sy = 126; sy < top; sy++) {
      const edge = sy === 126 || sx === HX - 62 || sx === HX + 61;
      const h = hash2(sx, sy);
      b.set(sx, sy, edge ? 0x2f8a68 : h < 0.1 ? 0x236e54 : h > 0.93 ? 0x18523f : 0x1d5f48);
    }
  }

  // 5) 외야석 (Lv3+)
  const flags: Pt[] = [];
  if (spec.ofRows > 0) drawOutfieldStands(b, spec.ofRows, fenceTop, home, lv, flags);

  // 6) 전광판, 배너 깃대
  drawScoreboard(b, homeHex);

  // 7) 그라운드 표식
  drawFieldMarks(b);
  drawFoulPole(b, 114, fenceTop(114) - 26, fenceTop(114) + 1, -1);
  drawFoulPole(b, 524, fenceTop(524) - 26, fenceTop(524) + 1, 1);

  // 8) 빈 좌석
  const seats = buildSeats(lv);
  const seatCols: [number, number][] = [
    lv === 0 ? [col(PAL.seatWood), col(PAL.seatWoodDk)] : [col(PAL.seat), col(PAL.seatDk)],
    [col(PAL.seatUp), col(PAL.seatUpDk)],
    [col(PAL.seatOut), col(PAL.seatOutDk)],
  ];
  for (const s of seats) {
    const [a, d] = seatCols[s.sec];
    b.rect(s.x, s.y, 2, 1, a);
    b.rect(s.x, s.y + 1, 2, 1, d);
  }

  // 9) 주변: 나무, 주차선, 건물
  drawParkingLines(b);
  drawSurroundings(b, lv);
  drawConcession(b, foodLv);
  drawTraining(b, trainLv, homeHex);
  for (const t of TOWERS) {
    b.shadeEllipse(t.x + 2, t.y, 6, 2, 0.8);
  }

  // ───── 전경 오버레이 ─────
  const o = new Buf(W, H);
  if (spec.roof > 0) drawRoof(o, lv, home, home2);
  if (lv >= 3) {
    // 지붕 위 깃대
    const dRoof = rowD(lv, spec.rows - 1) + (lv === 4 ? 9 : 7);
    const z = lv === 4 ? 7 : 5;
    const ts = lv === 4 ? [30, 100, 170, 228] : [40, 130, 205];
    for (const side of [-1, 1] as const) {
      for (const t of ts) {
        const p = standToWorld(side, dRoof, t);
        const px = Math.round(HX + p.x);
        const py = Math.round(HY + p.y * YK - z);
        o.rect(px, py - 8, 1, 8, PAL.steelDk);
        flags.push({ x: px + 1, y: py - 8 });
      }
    }
  }
  for (const t of TOWERS) drawTower(o, t.x, t.y, t.h);

  const groups: Seat[][] = [[], [], [], [], [], [], [], []];
  for (const s of seats) groups[s.ci].push(s);

  return {
    key: staticKey(fac, homeHex, home2Hex),
    base: b.toCanvas(),
    over: o.toCanvas(),
    seats,
    groups,
    flags,
    lv: { seats: lv, food: foodLv, training: trainLv },
  };
}

function berm(sx: number, sy: number, rho: number): number {
  if (rho > 313.5) return C.hedge;
  const h = hash2(sx, sy);
  if (h < 0.012) return 0xffffff;
  if (h < 0.022) return 0xffe066;
  return ((sx >> 2) + (sy >> 1)) & 1 ? C.berm : C.bermB;
}

function drawOutfieldStands(
  b: Buf,
  rows: number,
  fenceTop: (sx: number) => number,
  home: number,
  lv: number,
  flags: Pt[],
): void {
  const lastTop: Record<number, number> = {};
  for (let sx = 0; sx < STADIUM_W; sx++) {
    const x = sx - HX + 0.5;
    const ax = Math.abs(x);
    let first = true;
    let topY = -1;
    for (let j = 0; j < rows; j++) {
      const rho = ofRowR(j);
      if (ax >= rho) continue;
      const phi = Math.asin(ax / rho);
      if (phi < OF_PHI0 - 0.012 || phi > OF_PHI1 + 0.012) continue;
      const y = Math.round(HY - YK * Math.sqrt(rho * rho - x * x) - ofRowZ(j));
      const aisle = OF_AISLES.some((a) => Math.abs(phi - a) * rho < 1.6);
      if (first) {
        // 스탠드 전면 벽: 펜스 위까지
        const ft = fenceTop(sx);
        for (let yy = y + 2; yy < ft; yy++) {
          const k = yy - (y + 2);
          b.set(sx, yy, k === 0 ? 0xf4f6fa : k === 1 ? home : sx % 10 === 0 ? 0xaab4c0 : 0xc9d0d9);
        }
        first = false;
      }
      b.set(sx, y - 2, aisle ? 0xeceff3 : C.conc);
      b.set(sx, y - 1, aisle ? 0xeceff3 : C.conc);
      b.set(sx, y, aisle ? 0xeceff3 : C.conc);
      b.set(sx, y + 1, aisle ? 0xc3c9d1 : C.concDk);
      topY = y - 3;
    }
    if (topY >= 0) {
      // 뒤 난간
      b.set(sx, topY, C.rim);
      b.set(sx, topY - 1, C.rim);
      b.set(sx, topY - 2, shadeN(C.rim, 0.25));
      if (lv === 4) {
        b.set(sx, topY - 3, home);
        b.set(sx, topY - 4, shadeN(home, 0.3));
      }
      lastTop[sx] = topY - (lv === 4 ? 4 : 2);
    }
  }
  if (lv === 4) {
    for (const sx of [146, 180, 214, 426, 460, 494]) {
      const ty = lastTop[sx];
      if (ty === undefined) continue;
      b.rect(sx, ty - 8, 1, 8, PAL.steelDk);
      flags.push({ x: sx + 1, y: ty - 8 });
    }
  }
}

function drawRoof(o: Buf, lv: number, home: number, home2: number): void {
  const spec = SEAT_SPEC[lv];
  const z = lv === 4 ? 7 : 5;
  const d0 = rowD(lv, spec.rows - 1) + 1.4;
  const rw = lv === 4 ? 14 : 10;
  const tMax = spec.roof === 1 ? 72 : spec.len + 2;
  const trim = home;
  const glassA = mixN(0xbfe6f7, home2, 0.06);
  for (let sy = 0; sy < STADIUM_H; sy++) {
    const y = (sy + 0.5 - HY + z) / YK;
    for (let sx = 0; sx < STADIUM_W; sx++) {
      const x = sx - HX + 0.5;
      const s = standCoord(x, y);
      if (s.zone === 0) continue;
      const arc = s.zone === 2;
      if (s.d < d0 || s.d > d0 + rw) continue;
      if (!arc && s.t > tMax) continue;
      let c: number;
      const rel = s.d - d0;
      if (rel < 1.4) c = trim;
      else if (rel > rw - 1.3) c = 0x9faab8;
      else {
        const rib = arc ? Math.abs(((s.ang / (Math.PI / 12)) % 1) - 0.5) > 0.44 : s.t % 14 < 1.3;
        if (!arc && s.t > tMax - 1.4) c = 0xb9c3cf;
        else if (rib) c = 0xcdd5df;
        else if (rel > rw * 0.45 && rel < rw * 0.45 + 1.2) c = 0xdfe6ee;
        else if (lv === 4 && rel < rw * 0.45) c = rel < 3 ? 0xd9f1fb : glassA;
        else c = rel < rw * 0.45 ? 0xfafbfd : 0xeef2f6;
      }
      o.set(sx, sy, c);
    }
  }
  // 지붕 아래 그늘 한 줄(두께감)
  for (let sx = 0; sx < STADIUM_W; sx++) {
    for (let sy = 1; sy < STADIUM_H; sy++) {
      if (o.get(sx, sy - 1) >= 0 && o.get(sx, sy) < 0) {
        o.set(sx, sy, 0x7f8b9a);
        sy++;
      }
    }
  }
}

function drawFieldMarks(b: Buf): void {
  // 베이스
  for (const p of [B1, B2, B3]) {
    const x = Math.round(HX + p.x);
    const y = Math.round(HY + p.y * YK);
    b.rect(x - 2, y - 1, 4, 3, 0xffffff);
    b.rect(x - 2, y + 1, 4, 1, 0xd8d8cc);
  }
  // 홈플레이트 + 타석
  b.rect(HX - 2, HY - 1, 5, 2, 0xffffff);
  b.rect(HX - 1, HY + 1, 3, 1, 0xffffff);
  for (const s of [-1, 1]) {
    const x0 = s < 0 ? HX - 11 : HX + 5;
    b.rect(x0, HY - 4, 7, 1, C.line);
    b.rect(x0, HY + 3, 7, 1, C.line);
    b.rect(x0, HY - 4, 1, 8, C.line);
    b.rect(x0 + 6, HY - 4, 1, 8, C.line);
  }
  // 투수판
  const my = Math.round(HY + MOUND.y * YK);
  b.rect(HX - 2, my, 4, 1, 0xffffff);
  // 온덱 서클 대신 코치 박스 표시(1·3루 옆)
  for (const s of [-1, 1]) {
    const cx = Math.round(HX + s * 74);
    const cy = Math.round(HY - 40 * YK);
    b.rect(cx - 3, cy, 7, 1, C.line);
  }
}

function drawSurroundings(b: Buf, lv: number): void {
  // 좌우 가로수
  const L: [number, number, number][] = [
    [20, 136, 0],
    [46, 152, 2],
    [22, 182, 1],
    [52, 208, 0],
    [24, 240, 2],
    [50, 270, 0],
    [22, 302, 1],
    [58, 326, 2],
    [96, 306, 0],
    [78, 280, 0],
  ];
  for (const [x, y, v] of L) {
    tree(b, x, y, v);
    tree(b, STADIUM_W - x, y, v);
  }
  // 상단
  const T: [number, number, number][] = [
    [124, 44, 0],
    [150, 62, 1],
    [178, 42, 0],
    [204, 66, 2],
    [436, 66, 2],
    [462, 42, 0],
    [490, 62, 1],
    [516, 44, 0],
    [546, 44, 0],
    [622, 46, 1],
    [548, 100, 2],
    [620, 98, 0],
  ];
  for (const [x, y, v] of T) tree(b, x, y, v);
  // 하단(홈 뒤 양옆)
  const B: [number, number, number][] = [
    [160, 406, 0],
    [204, 404, 2],
    [232, 412, 0],
  ];
  for (const [x, y, v] of B) {
    tree(b, x, y, v);
    tree(b, STADIUM_W - x, y, v);
  }
  for (const [x, y] of [
    [34, 122],
    [70, 168],
    [36, 222],
    [72, 248],
    [40, 318],
    [118, 76],
    [222, 40],
    [120, 330],
  ] as const) {
    bush(b, x, y);
    bush(b, STADIUM_W - x, y);
  }
  // 외야 잔디 언덕의 나무 (외야석이 없을 때)
  const berms = lv >= 3 ? [45.5] : [16, 24, 32, 39, 45.5];
  for (const deg of berms) {
    for (const s of [-1, 1]) {
      const rho = 306;
      const x = Math.round(HX + s * rho * Math.sin(deg * DEG));
      const y = Math.round(HY - YK * rho * Math.cos(deg * DEG));
      tree(b, x, y, deg === 24 ? 1 : deg === 39 ? 2 : 0);
    }
  }
  // 벤치(공원)
  b.rect(560, 90, 10, 2, '#c98d55');
  b.rect(561, 92, 1, 2, '#6b4a2e');
  b.rect(568, 92, 1, 2, '#6b4a2e');
  b.rect(600, 92, 10, 2, '#c98d55');
  b.rect(601, 94, 1, 2, '#6b4a2e');
  b.rect(608, 94, 1, 2, '#6b4a2e');
}
