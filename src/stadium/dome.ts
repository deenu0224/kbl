// 우리 돔구장 (왕조 프로젝트): 1 = 구장 옆 조감도 간판 · 2 = 크레인·비계·올라가는 골조 · 3 = 반투명 돔 지붕.
// 돔은 한 번 그려 캐시한다 (픽셀 단위로 찍는다 — 안티앨리어싱 없음). 경기장 안이 비쳐 보여야 한다.
import { STADIUM_H, STADIUM_W } from './geometry';

type Ctx = CanvasRenderingContext2D;

// 돔의 밑테(타원)와 높이: 관중석 바깥을 두르고, 정수리는 전광판 위쪽
const CX = 320;
const CY = 248;
const RX = 252;
const RY = 164;
const H = 104;
const CROWN = 1.36; // 정수리 고리의 고도(rad)
const N_RIB = 16;

/** 돔 표면의 점(방위 phi, 고도 th) → 화면 좌표 */
function domePt(phi: number, th: number): [number, number] {
  const c = Math.cos(th);
  return [CX + RX * c * Math.cos(phi), CY + RY * c * Math.sin(phi) - H * Math.sin(th)];
}

function R(ctx: Ctx, x: number, y: number, w: number, h: number, c: string): void {
  ctx.fillStyle = c;
  ctx.fillRect(Math.round(x), Math.round(y), w, h);
}

const cache: { full: HTMLCanvasElement | null; frame: HTMLCanvasElement | null } = { full: null, frame: null };

/** full = 완공(유리 + 전체 골조), 아니면 착공(뒤쪽 절반의 골조만, 유리 없음) */
function buildDome(full: boolean): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = STADIUM_W;
  cv.height = STADIUM_H;
  const ctx = cv.getContext('2d');
  if (!ctx) return cv;
  const img = ctx.createImageData(STADIUM_W, STADIUM_H);
  const d = img.data;
  const put = (x0: number, y0: number, r: number, g: number, b: number, a: number) => {
    const x = Math.round(x0);
    const y = Math.round(y0);
    if (x < 0 || y < 0 || x >= STADIUM_W || y >= STADIUM_H) return;
    const i = (y * STADIUM_W + x) * 4;
    d[i] = r;
    d[i + 1] = g;
    d[i + 2] = b;
    d[i + 3] = a;
  };
  if (full) {
    // 유리: 표면을 촘촘히 훑어 실루엣을 채운다. 왼쪽 위에서 빛을 받는 면은 조금 더 밝게, 체커 디더로 유리 질감
    for (let th = 0; th <= Math.PI / 2; th += 0.006) {
      for (let phi = 0; phi < Math.PI * 2; phi += 0.003) {
        const [x, y] = domePt(phi, th);
        const lit = Math.cos(phi - Math.PI * 1.22) > 0.55 && th > 0.45 && th < 1.05;
        const xi = Math.round(x);
        const yi = Math.round(y);
        const dith = (xi + yi) % 2 === 0;
        if (lit) put(xi, yi, 255, 255, 255, dith ? 128 : 96);
        else put(xi, yi, 176, 218, 250, dith ? 92 : 68);
      }
    }
  }
  const rib = (phi: number, th0: number, th1: number, w: number, a: number) => {
    for (let th = th0; th <= th1; th += 0.004) {
      const [x, y] = domePt(phi, th);
      for (let k = 0; k < w; k++) put(x + k, y, 236, 244, 252, a);
    }
  };
  const ring = (th: number, w: number, a: number, from = 0, to = Math.PI * 2, c: [number, number, number] = [236, 244, 252]) => {
    for (let phi = from; phi < to; phi += 0.002) {
      const [x, y] = domePt(phi, th);
      for (let k = 0; k < w; k++) put(x, y + k, c[0], c[1], c[2], a);
    }
  };
  // 위도 고리 (가늘게) → 갈빗대 (굵게) → 정수리 고리 → 밑테
  if (full) {
    ring(0.5, 1, 120);
    ring(0.95, 1, 120);
    for (let i = 0; i < N_RIB; i++) rib((i / N_RIB) * Math.PI * 2 + 0.0001, 0, CROWN, 2, 225);
    ring(CROWN, 2, 255, 0, Math.PI * 2, [255, 170, 60]);
    ring(CROWN + 0.08, 2, 255, 0, Math.PI * 2, [255, 196, 96]);
  } else {
    // 공사 중: 뒤쪽(외야 쪽) 절반의 갈빗대만 중간 높이까지 올라가 있다
    for (let i = 0; i <= N_RIB / 2; i++) rib(Math.PI + (i / N_RIB) * Math.PI * 2 + 0.0001, 0, 0.55 + 0.25 * Math.sin((i / (N_RIB / 2)) * Math.PI), 2, 255);
    ring(0.5, 1, 200, Math.PI * 1.15, Math.PI * 1.85);
  }
  // 밑테: 밝은 강철 띠 3px + 아래 그림자 1px. 공사 중에는 뒤쪽 절반만
  const a0 = full ? 0 : Math.PI;
  const a1 = Math.PI * 2;
  ring(0, 3, 255, a0, a1, [222, 232, 244]);
  for (let phi = a0; phi < a1; phi += 0.002) {
    const [x, y] = domePt(phi, 0);
    put(x, y + 3, 84, 104, 134, 255);
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}

/** 조감도 간판: 흰 판 위의 작은 돔 그림 + 주황 머리띠, 기둥 두 개 */
function drawBillboard(ctx: Ctx): void {
  const x = 150;
  const y = 62;
  R(ctx, x + 3, y + 40, 44, 3, 'rgba(60,50,30,0.25)'); // 그림자
  R(ctx, x + 6, y + 30, 3, 12, '#5d6678');
  R(ctx, x + 39, y + 30, 3, 12, '#5d6678');
  R(ctx, x - 1, y - 1, 50, 33, '#2b3246');
  R(ctx, x, y, 48, 31, '#f4f7fb');
  R(ctx, x, y, 48, 6, '#ff9a2e');
  R(ctx, x + 4, y + 2, 18, 2, '#fff3d6');
  // 돔 그림: 하늘색 반원 + 테 + 잔디
  const dome = [8, 14, 18, 20, 22, 24, 24];
  for (let i = 0; i < dome.length; i++) R(ctx, x + 24 - dome[i] / 2 - 0, y + 10 + i * 2, dome[i], 2, i < 2 ? '#bfe2fb' : '#8fc8f2');
  R(ctx, x + 23, y + 8, 2, 2, '#ff9a2e');
  R(ctx, x + 10, y + 24, 28, 2, '#55657e');
  R(ctx, x + 6, y + 26, 36, 3, '#62b94a');
}

/** 타워 크레인 (노랑): 밑동 (bx, by), 팔은 dir 쪽으로 */
function drawCrane(ctx: Ctx, bx: number, by: number, h: number, jib: number, dir: 1 | -1, f: number): void {
  const Y = '#ffcf33';
  const D = '#b8860b';
  R(ctx, bx - 6, by - 3, 18, 5, '#6b7280');
  R(ctx, bx - 1, by - h, 6, h, Y);
  for (let y = by - h + 4; y < by - 2; y += 6) R(ctx, bx - 1, y, 6, 2, D); // 격자
  R(ctx, bx - 1, by - h - 6, 6, 6, '#e9edf3'); // 운전실
  R(ctx, bx, by - h - 5, 3, 3, '#4b6ea8');
  const x0 = dir > 0 ? bx : bx - jib + 4;
  R(ctx, x0, by - h - 10, jib, 5, Y);
  for (let x = x0 + 3; x < x0 + jib - 1; x += 6) R(ctx, x, by - h - 8, 1, 1, D);
  const cb = dir > 0 ? bx - 16 : bx + 4;
  R(ctx, cb, by - h - 10, 16, 5, Y); // 뒤 팔 + 평형추
  R(ctx, dir > 0 ? bx - 16 : bx + 14, by - h - 7, 6, 6, '#55607a');
  R(ctx, bx + 1, by - h - 15, 2, 6, Y); // 꼭대기
  // 줄과 갈고리 (천천히 오르내린다)
  const hx = dir > 0 ? bx + jib - 12 : bx - jib + 14;
  const len = 26 + Math.round(6 * Math.sin(f / 22 + bx));
  R(ctx, hx, by - h - 5, 2, len, '#3a4152');
  R(ctx, hx - 3, by - h - 5 + len, 8, 6, '#9aa5b8');
}

/** 비계: 주황·회색 격자 띠 */
function drawScaffold(ctx: Ctx, x: number, y: number, w: number, h: number): void {
  R(ctx, x, y, w, h, 'rgba(40,48,66,0.35)');
  for (let i = 0; i <= w; i += 6) R(ctx, x + i, y, 1, h, '#c9d1dd');
  for (let j = 0; j <= h; j += 6) R(ctx, x, y + j, w + 1, 1, '#ff9a2e');
}

/** 돔 단계를 그린다 (선수·관중 위, 날씨·밤 틴트 아래) */
export function drawDome(ctx: Ctx, stage: number | undefined, f: number): void {
  if (!stage || stage < 1) return;
  if (stage === 1) return drawBillboard(ctx);
  if (stage === 2) {
    drawBillboard(ctx);
    drawScaffold(ctx, 102, 172, 48, 30);
    drawScaffold(ctx, 490, 172, 48, 30);
    drawScaffold(ctx, 190, 98, 54, 24);
    drawScaffold(ctx, 396, 98, 54, 24);
    ctx.drawImage((cache.frame ??= buildDome(false)), 0, 0);
    // 크레인은 외야석 뒤에 (폰의 확대된 홈 화면에서도 화면 안에 들어온다)
    drawCrane(ctx, 216, 124, 84, 62, 1, f);
    drawCrane(ctx, 424, 124, 70, 54, -1, f);
    return;
  }
  ctx.drawImage((cache.full ??= buildDome(true)), 0, 0);
}
