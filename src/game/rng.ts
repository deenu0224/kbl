// 시드 기반 난수 유틸. 게임 로직은 전부 Rng 를 인자로 받아 재현 가능하게 동작한다.

export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** a..b 포함 정수 */
export function randInt(r: Rng, a: number, b: number): number {
  return a + Math.floor(r() * (b - a + 1));
}

export function pick<T>(r: Rng, arr: T[]): T {
  return arr[Math.floor(r() * arr.length)];
}

/** 표준정규 (Box-Muller) */
export function gauss(r: Rng): number {
  let u = 0;
  while (u < 1e-9) u = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function shuffle<T>(r: Rng, arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
