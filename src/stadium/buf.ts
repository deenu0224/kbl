import { col } from './palette';

/** RGBA 픽셀 버퍼. 정적 레이어를 픽셀 단위로 그린 뒤 캔버스로 굽는다. */
export class Buf {
  readonly w: number;
  readonly h: number;
  readonly data: Uint8ClampedArray;

  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.data = new Uint8ClampedArray(w * h * 4);
  }

  set(x: number, y: number, c: number): void {
    x |= 0;
    y |= 0;
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 4;
    const d = this.data;
    d[i] = (c >> 16) & 255;
    d[i + 1] = (c >> 8) & 255;
    d[i + 2] = c & 255;
    d[i + 3] = 255;
  }

  /** 불투명 픽셀이면 0xRRGGBB, 아니면 -1 */
  get(x: number, y: number): number {
    x |= 0;
    y |= 0;
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return -1;
    const i = (y * this.w + x) * 4;
    const d = this.data;
    if (d[i + 3] === 0) return -1;
    return (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
  }

  rect(x: number, y: number, w: number, h: number, c: number | string): void {
    const cc = typeof c === 'string' ? col(c) : c;
    x = Math.round(x);
    y = Math.round(y);
    const x1 = Math.min(this.w, x + Math.round(w));
    const y1 = Math.min(this.h, y + Math.round(h));
    const x0 = Math.max(0, x);
    const y0 = Math.max(0, y);
    for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) this.set(xx, yy, cc);
  }

  /** 기존 불투명 픽셀을 f 배로 어둡게(그림자) */
  shade(x: number, y: number, w: number, h: number, f: number): void {
    x = Math.round(x);
    y = Math.round(y);
    const x1 = Math.min(this.w, x + Math.round(w));
    const y1 = Math.min(this.h, y + Math.round(h));
    const d = this.data;
    for (let yy = Math.max(0, y); yy < y1; yy++) {
      for (let xx = Math.max(0, x); xx < x1; xx++) {
        const i = (yy * this.w + xx) * 4;
        if (d[i + 3] === 0) continue;
        d[i] = d[i] * f;
        d[i + 1] = d[i + 1] * f;
        d[i + 2] = d[i + 2] * f;
      }
    }
  }

  /** 가로로 긴 타원 채우기 */
  ellipse(cx: number, cy: number, rx: number, ry: number, c: number | string): void {
    for (let dy = -ry; dy <= ry; dy++) {
      const k = 1 - (dy * dy) / (ry * ry + 0.35);
      if (k <= 0) continue;
      const hw = Math.round(rx * Math.sqrt(k));
      this.rect(cx - hw, cy + dy, hw * 2 + 1, 1, c);
    }
  }

  shadeEllipse(cx: number, cy: number, rx: number, ry: number, f: number): void {
    for (let dy = -ry; dy <= ry; dy++) {
      const k = 1 - (dy * dy) / (ry * ry + 0.35);
      if (k <= 0) continue;
      const hw = Math.round(rx * Math.sqrt(k));
      this.shade(cx - hw, cy + dy, hw * 2 + 1, 1, f);
    }
  }

  toCanvas(): HTMLCanvasElement {
    const cv = document.createElement('canvas');
    cv.width = this.w;
    cv.height = this.h;
    const ctx = cv.getContext('2d');
    if (ctx) {
      const img = ctx.createImageData(this.w, this.h);
      img.data.set(this.data);
      ctx.putImageData(img, 0, 0);
    }
    return cv;
  }
}
