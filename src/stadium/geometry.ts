// 투영·좌석 배치·고정 좌표. 월드 좌표: 홈플레이트 원점, 외야 방향이 -y, z 는 높이.
// 화면 투영: sx = 320 + x, sy = 338 + y*0.62 - z

export const STADIUM_W = 640;
export const STADIUM_H = 420;
export const HX = 320;
export const HY = 338;
export const YK = 0.62;
export const FENCE_R = 290;
/** 내야 벽(관중석 앞 벽) 쐐기의 꼭짓점 y */
export const APEX_Y = 24;
export const SQ = Math.SQRT1_2;
export const DEG = Math.PI / 180;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Pt {
  x: number;
  y: number;
}

export function sxOf(x: number): number {
  return HX + x;
}
export function syOf(y: number, z = 0): number {
  return HY + y * YK - z;
}

export function clampLv(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(4, Math.round(v)));
}

/** 정수 2개 → 0~1 고정 난수 */
export function hash2(a: number, b: number): number {
  let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// ───────── 관중석 레벨 스펙 ─────────

export interface SeatSpec {
  rows: number; // 내야석 줄 수
  len: number; // 파울라인 방향 길이(월드)
  ofRows: number; // 외야석 줄 수
  wallH: number; // 뒷벽 높이(px)
  roof: 0 | 1 | 2 | 3; // 0 없음 / 1 홈 뒤만 / 2 전체 / 3 대형
}

export const SEAT_SPEC: SeatSpec[] = [
  { rows: 4, len: 115, ofRows: 0, wallH: 4, roof: 0 },
  { rows: 6, len: 155, ofRows: 0, wallH: 5, roof: 0 },
  { rows: 8, len: 195, ofRows: 0, wallH: 7, roof: 1 },
  { rows: 9, len: 215, ofRows: 4, wallH: 9, roof: 2 },
  { rows: 11, len: 235, ofRows: 7, wallH: 13, roof: 3 },
];

/** Lv4 는 6번째 줄부터 2층(통로 6 만큼 띄움) */
export const DECK_ROW = 6;
export const DECK_GAP = 6;
export const ROW_STEP = 5;
export const SEAT_STEP = 4.5;
export const ROW0_D = 6;
export const AISLE_EVERY = 40;

/** 줄 r 의 벽으로부터의 거리 */
export function rowD(lv: number, r: number): number {
  return ROW0_D + ROW_STEP * r + (lv === 4 && r >= DECK_ROW ? DECK_GAP : 0);
}
/** roof 1(홈 뒤만) 지붕이 직선 구간을 덮는 길이 */
export const ROOF1_T = 72;
/** 관중석 바깥 테두리 거리 */
export function standOuter(lv: number): number {
  return rowD(lv, SEAT_SPEC[lv].rows - 1) + 4;
}

// 덕아웃(양쪽 직선 구간, t 범위)
export const DUG_T0 = 46;
export const DUG_T1 = 76;
export const DUG_D = 12.5;

// 외야석
export const OF_R0 = 299;
export const OF_Z0 = 8;
export const OF_PHI0 = 13 * DEG;
export const OF_PHI1 = 40 * DEG;
export const OF_AISLES = [22 * DEG, 31 * DEG];
export function ofRowR(j: number): number {
  return OF_R0 + ROW_STEP * j;
}
export function ofRowZ(j: number): number {
  return OF_Z0 + j;
}

export const FENCE_H = 8;
/** 내야 벽과 외야 펜스가 만나는 |x| */
export const FENCE_XMAX = 216.5;

// ───────── 내야 스탠드 좌표계 ─────────

export interface StandCoord {
  /** 0 = 구장 안쪽(쐐기 내부), 1 = 좌측 직선, 2 = 홈 뒤 호, 3 = 우측 직선 */
  zone: 0 | 1 | 2 | 3;
  d: number; // 벽으로부터 바깥 방향 거리
  t: number; // 직선 구간: 꼭짓점에서 외야 방향 거리 / 호: 0
  ang: number; // 호 구간 각도(rad). π/2 = 홈 정후방
}

const sc: StandCoord = { zone: 0, d: 0, t: 0, ang: 0 };

/** 월드 (x, y) → 스탠드 좌표. 반환 객체는 재사용되므로 보관하지 말 것. */
export function standCoord(x: number, y: number): StandCoord {
  const py = y - APEX_Y;
  const dl = (-x + py) * SQ;
  const dr = (x + py) * SQ;
  if (dl < 0 && dr < 0) {
    sc.zone = 0;
    sc.d = Math.max(dl, dr);
    sc.t = 0;
    sc.ang = 0;
    return sc;
  }
  const tl = (-x - py) * SQ;
  const tr = (x - py) * SQ;
  if (dl >= 0 && tl >= 0) {
    sc.zone = 1;
    sc.d = dl;
    sc.t = tl;
    sc.ang = 0;
  } else if (dr >= 0 && tr >= 0) {
    sc.zone = 3;
    sc.d = dr;
    sc.t = tr;
    sc.ang = 0;
  } else {
    sc.zone = 2;
    sc.d = Math.hypot(x, py);
    sc.t = 0;
    sc.ang = Math.atan2(py, x);
  }
  return sc;
}

/** 스탠드 좌표 → 월드 */
export function standToWorld(side: -1 | 1, d: number, t: number): Pt {
  return { x: side * (d * SQ + t * SQ), y: APEX_Y + d * SQ - t * SQ };
}

// ───────── 좌석 ─────────

export interface Seat {
  x: number; // 화면 좌상단(2×2)
  y: number;
  rank: number; // 0~1, fill 보다 작으면 팬이 앉는다
  ci: number; // 색 인덱스: 0 홈, 1 홈 보조, 2 원정, 3~7 기타
  ph: number; // 0~255 애니메이션 위상
  sec: 0 | 1 | 2; // 0 내야 1층, 1 내야 2층, 2 외야
  cov: boolean; // 지붕 아래 자리(비를 안 맞는다)
  u: number; // 0~1 구장을 한 바퀴 도는 위치(중견수 뒤 0 → 3루 쪽 → 홈 뒤 0.5 → 1루 쪽 → 1). 응원 물결용
}

function isAisleT(t: number): boolean {
  const m = t % AISLE_EVERY;
  return m < 2.4 || m > AISLE_EVERY - 2.4;
}

export function buildSeats(lvIn: number): Seat[] {
  const lv = clampLv(lvIn);
  const spec = SEAT_SPEC[lv];
  const raw: { x: number; y: number; score: number; sec: 0 | 1 | 2; id: number; cov: boolean }[] = [];
  let id = 0;
  const push = (wx: number, wy: number, z: number, score: number, sec: 0 | 1 | 2, cov = false) => {
    id++;
    raw.push({
      x: Math.round(sxOf(wx)) - 1,
      y: Math.round(syOf(wy, z)) - 1,
      score: score + hash2(id, 7 + lv * 31) * 0.5,
      sec,
      id,
      cov,
    });
  };

  for (let r = 0; r < spec.rows; r++) {
    const d = rowD(lv, r);
    const upper = lv === 4 && r >= DECK_ROW;
    const sec: 0 | 1 = upper ? 1 : 0;
    const rowScore = r * 0.045 + (upper ? 0.12 : 0);
    // 직선 구간
    for (let t = 2.6; t <= spec.len; t += SEAT_STEP) {
      if (isAisleT(t)) continue;
      if (d < DUG_D + 2 && t > DUG_T0 - 2.5 && t < DUG_T1 + 2.5) continue;
      const sc2 = rowScore + (t / 235) * 0.35;
      const l = standToWorld(-1, d, t);
      const rr = standToWorld(1, d, t);
      const cov = spec.roof >= 2 || (spec.roof === 1 && t <= ROOF1_T);
      push(l.x, l.y, 0, sc2, sec, cov);
      push(rr.x, rr.y, 0, sc2, sec, cov);
    }
    // 홈 뒤 호
    const n = Math.floor((d * Math.PI * 0.5) / SEAT_STEP);
    for (let i = 0; i < n; i++) {
      const th = Math.PI / 4 + ((i + 0.5) / n) * (Math.PI / 2);
      if (d >= 16 && Math.abs(th - Math.PI / 2) * d < 2.2) continue;
      push(d * Math.cos(th), APEX_Y + d * Math.sin(th), 0, rowScore, sec, spec.roof >= 1);
    }
  }

  for (let j = 0; j < spec.ofRows; j++) {
    const rho = ofRowR(j);
    const z = ofRowZ(j);
    const span = OF_PHI1 - OF_PHI0;
    const n = Math.floor((rho * span) / SEAT_STEP);
    for (let i = 0; i < n; i++) {
      const phi = OF_PHI0 + ((i + 0.5) / n) * span;
      if (OF_AISLES.some((a) => Math.abs(phi - a) * rho < 2.3)) continue;
      const sc2 = 0.36 + j * 0.04;
      for (const s of [-1, 1]) push(s * rho * Math.sin(phi), -rho * Math.cos(phi), z, sc2, 2);
    }
  }

  const order = raw.map((_, i) => i).sort((a, b) => raw[a].score - raw[b].score);
  const n = raw.length;
  const seats: Seat[] = new Array<Seat>(n);
  order.forEach((idx, k) => {
    const s = raw[idx];
    const rc = hash2(s.id, 101);
    let ci: number;
    if (rc < 0.52) ci = 0;
    else if (rc < 0.66) ci = 1;
    else if (rc < 0.74) ci = 2;
    else ci = 3 + Math.min(4, Math.floor(((rc - 0.74) / 0.26) * 5));
    seats[idx] = {
      x: s.x,
      y: s.y,
      rank: (k + 0.5) / n,
      ci,
      ph: Math.floor(hash2(s.id, 211) * 256),
      sec: s.sec,
      cov: s.cov,
      u: (Math.atan2(s.x + 1 - HX, s.y + 1 - HY) + Math.PI) / (Math.PI * 2),
    };
  });
  return seats;
}

// ───────── 고정 배치 ─────────

/** 시설 핫스팟 (캔버스 픽셀 좌표). scoreboard 는 LED 패널 안쪽 영역. */
export const HOTSPOTS: Record<'seats' | 'food' | 'training' | 'scoreboard', Rect> = {
  seats: { x: 256, y: 350, w: 128, h: 58 },
  food: { x: 12, y: 346, w: 140, h: 68 },
  training: { x: 488, y: 346, w: 140, h: 68 },
  scoreboard: { x: 254, y: 60, w: 132, h: 50 },
};

export const SB_FRAME: Rect = { x: 250, y: 56, w: 140, h: 58 };
export const PARKING: Rect = { x: 6, y: 24, w: 100, h: 86 };
export const PARK: Rect = { x: 534, y: 24, w: 100, h: 86 };

/** 조명탑: 바닥 중심 (x, y) 과 높이 */
export const TOWERS: { x: number; y: number; h: number }[] = [
  { x: 84, y: 232, h: 74 },
  { x: 556, y: 232, h: 74 },
  { x: 178, y: 384, h: 54 },
  { x: 462, y: 384, h: 54 },
];

/** 배너 깃대 x (전광판 양옆) — banners 수만큼 앞에서부터 사용 */
export const BANNER_X = [240, 399, 228];
export const BANNER_Y = 60;
/** 바랜 옛 우승 깃발 자리. 이 깃발이 걸리면 새 깃발은 그 옆(BANNER_X_NEW)부터 채운다 */
export const OLD_BANNER_X = 240;
export const BANNER_X_NEW = [225, 399, 414];

/** 외야 펜스 윗변의 화면 y */
export function fenceTopY(sx: number): number {
  const x = sx - HX + 0.5;
  return Math.round(HY - YK * Math.sqrt(Math.max(0, FENCE_R * FENCE_R - x * x))) - FENCE_H;
}

/** 게이트: 3루 쪽 관중석 바깥벽이 바닥 y = GATE_Y 와 만나는 곳. 대기 줄은 여기서 왼쪽(주차장 쪽)으로 늘어선다 */
export const GATE_Y = 347;
export function gateX(lvIn: number): number {
  const lv = clampLv(lvIn);
  const dOut = standOuter(lv);
  const t = dOut + (APEX_Y - (GATE_Y - HY - SEAT_SPEC[lv].wallH) / YK) / SQ;
  return Math.round(HX - (dOut + t) * SQ);
}

/** 영구결번 표식 중심(백스크린, 전광판 아래) */
export const RETIRED_Y = 138;
export const RETIRED_X = [293, 311, 329, 347];

/** 오랜 팬의 자리(좌중간 외야, 방위각) */
export const OLD_FAN_PHI = 20 * DEG;

/** 주차 칸 좌상단 (7×12 차량 기준) */
export const PARK_SLOTS: Pt[] = (() => {
  const out: Pt[] = [];
  const rows = [28, 50, 66, 88];
  for (const ry of rows) for (let i = 0; i < 9; i++) out.push({ x: 12 + 10 * i, y: ry + 1 });
  // 고정 셔플
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(hash2(i, 9917) * (i + 1));
    const t = out[i];
    out[i] = out[j];
    out[j] = t;
  }
  return out;
})();

export const BASE_D = 80;
export const B1: Pt = { x: BASE_D * SQ, y: -BASE_D * SQ };
export const B2: Pt = { x: 0, y: -BASE_D * 2 * SQ };
export const B3: Pt = { x: -BASE_D * SQ, y: -BASE_D * SQ };
export const MOUND: Pt = { x: 0, y: -BASE_D * SQ };

/** 수비 위치 (월드) : P C 1B 2B SS 3B LF CF RF */
export const FIELDERS: Pt[] = [
  { x: 0, y: MOUND.y + 1 },
  { x: 0, y: 9 },
  { x: 60, y: -72 },
  { x: 30, y: -116 },
  { x: -32, y: -116 },
  { x: -60, y: -72 },
  { x: -128, y: -192 },
  { x: 0, y: -236 },
  { x: 128, y: -192 },
];
