// 색 유틸 + 구장 팔레트. 색은 '#rrggbb' 문자열 또는 0xRRGGBB 정수로 다룬다.

const cache = new Map<string, number>();

function parseHex(hex: string): number {
  let h = hex.trim().replace('#', '');
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = parseInt(h.slice(0, 6), 16);
  return Number.isFinite(n) ? n : 0x888888;
}

/** '#rrggbb' → 0xRRGGBB (캐시) */
export function col(hex: string): number {
  let v = cache.get(hex);
  if (v === undefined) {
    v = parseHex(hex);
    cache.set(hex, v);
  }
  return v;
}

export function toHex(n: number): string {
  return '#' + (n & 0xffffff).toString(16).padStart(6, '0');
}

export function mixN(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bl;
}

/** amt > 0 밝게(흰색 쪽), amt < 0 어둡게(검정 쪽) */
export function shadeN(n: number, amt: number): number {
  return amt >= 0 ? mixN(n, 0xffffff, amt) : mixN(n, 0x000000, -amt);
}

export function mix(a: string, b: string, t: number): string {
  return toHex(mixN(col(a), col(b), t));
}

export function shade(hex: string, amt: number): string {
  return toHex(shadeN(col(hex), amt));
}

export function lum(n: number): number {
  return 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
}

export const PAL = {
  grassA: '#74c64e',
  grassB: '#66b942',
  inGrassA: '#7bcc55',
  inGrassB: '#6cc049',
  dirt: '#dfa86c',
  dirtEdge: '#cf955b',
  dirtHi: '#e8b780',
  track: '#cc9860',
  trackB: '#c48e56',
  line: '#fbfbf2',
  wall: '#23795a',
  wallHi: '#3aa57b',
  fence: '#1f7a57',
  fenceDk: '#186348',
  fenceTop: '#f6d33c',
  berm: '#86cf62',
  bermB: '#7ac457',
  lawn: '#8ed46a',
  lawnB: '#82ca5f',
  hedge: '#58a846',
  plazaA: '#ecdfc4',
  plazaB: '#e5d7b9',
  road: '#8b93a3',
  roadLine: '#eef1f5',
  curb: '#cfd4dc',
  asphalt: '#99a2b2',
  conc: '#d5dae0',
  concDk: '#bcc3cc',
  concOld: '#c8c5b8',
  concOldDk: '#b0ad9f',
  concUp: '#cbd5e0',
  concUpDk: '#b1bdcb',
  walk: '#e6e9ee',
  rim: '#a3adb9',
  seat: '#9fb2c6',
  seatDk: '#8a9eb4',
  seatWood: '#8e7656', // 낡은 나무 의자: 관중 색이 도드라지게 어둡게
  seatWoodDk: '#75603f',
  seatUp: '#8f9fc4',
  seatUpDk: '#7b8bb2',
  seatOut: '#9cc3b4',
  seatOutDk: '#86ae9f',
  skin: '#f6c9a0',
  skin2: '#e0a878',
  white: '#ffffff',
  ink: '#1b2233',
  steel: '#8f9bb0',
  steelDk: '#6f7b90',
  glass: '#8fd0f0',
  glassHi: '#c9ecff',
  red: '#e5393a',
  gold: '#ffd23f',
} as const;

export const FAN_EXTRA = ['#ffffff', '#ffd23f', '#ff6b6b', '#5ec8ff', '#b388ff'];
export const CAR_COLORS = ['#e5564a', '#3f7fd6', '#f4f6fa', '#ffd23f', '#3a3f4b', '#5fbf73', '#f08a1c', '#b9c1cb'];
export const FIREWORK_COLORS = ['#ff3b6b', '#ffd400', '#00d0ff', '#ffffff', '#a45bff', '#ff8a00', '#3dff8b'];
