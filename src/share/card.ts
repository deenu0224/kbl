import { sceneExtras } from '../game/campaign';
import type { HofClub } from '../game/hof';
import { TEAM_DEFS, USER_ID } from '../game/generate';
import type { Core, StadiumScene } from '../game/types';
import { buildNightTint, drawFrame } from '../stadium/dynamicLayer';
import { STADIUM_H, STADIUM_W } from '../stadium/geometry';
import { buildStatic } from '../stadium/staticLayer';
import { PAST_RANKS } from '../game/story';
import { SHARE_HOST } from './config';
import { cardItems, codeInfo, endingLine, serialOf, shareFromCore, SHARE_CITY, SHARE_TITLE, type CodeInfo, type ShareData, type ShareKind } from './shareData';
import { askOf } from './story';
import { BENCH, relocatedPct } from './bench';

/** 기록 카드: 정사각 1080×1080 증명서. 종이색 바탕에 구단 색(주황·초록), 픽셀 글자 */
export const CARD_W = 1080;
export const CARD_H = 1080;
export const OG_W = 1200;
export const OG_H = 630;
const PAD = 56;
const PAPER = '#f6efe0';
const SHEET = '#fffaf0';
const INK = '#2a2420';
const MUTE = '#7a6f62';
const RULE = '#d9cdb6';
const ORANGE = '#f08a1c';
const GREEN = '#1f6b3a';
const GOLD = '#e0a800';
const RED = '#b23a2e';

/** 폭죽은 한 순간에 한두 발만 떠 있다: 선수들이 모인 뒤(6초~)의 여러 순간을 한 장에 겹친다 */
const FX_TIMES = [6.1, 6.9, 7.6, 8.4, 9.3];
const DEF = TEAM_DEFS.find((d) => d.id === USER_ID)!;

/** 순간에 맞춘 구장 장면: 결산 = 지금 시설·깃발·응원 그대로, 우승 = 만원 관중과 폭죽, 연고 이전 = 불 꺼진 빈 구장 */
export function cardScene(core: Core, kind: ShareKind): StadiumScene {
  const team = core.teams.find((t) => t.id === core.userId);
  const cap = core.crowd?.capacity ?? 0;
  const last = core.campaign.history?.[core.campaign.history.length - 1];
  const fill = cap > 0 && last ? Math.max(0.15, Math.min(1, last.avgAtt / cap)) : 0.4;
  return {
    facilities: core.facilities,
    homeColor: team?.color ?? DEF.color,
    homeColor2: team?.color2 ?? DEF.color2,
    awayColor: '#8892b0',
    fill: kind === 'champion' ? 1 : kind === 'relocated' ? 0 : fill,
    weather: kind === 'relocated' ? 'cloudy' : 'sunny',
    night: kind !== 'season',
    playing: false,
    homeBatting: false,
    fx: kind === 'champion' ? { kind: 'walkoff' } : { kind: 'none' },
    fxKey: 7,
    ...sceneExtras(core),
    gateQueue: 0,
  };
}

/** 명예의 전당의 한 줄: 시설 기록이 없으므로 처음 구장에 그 구단의 깃발 수만 건다 */
export function clubScene(club: HofClub): StadiumScene {
  const end = club.end;
  return {
    facilities: { seats: 0, food: 0, training: 0 },
    homeColor: DEF.color,
    homeColor2: DEF.color2,
    awayColor: '#8892b0',
    fill: end === 'champion' ? 1 : end === 'relocated' ? 0 : 0.35,
    weather: end === 'relocated' ? 'cloudy' : 'sunny',
    night: end !== 'abandoned',
    playing: false,
    homeBatting: false,
    fx: end === 'champion' ? { kind: 'walkoff' } : { kind: 'none' },
    fxKey: 7,
    banners: Math.min(3, club.titles),
    oldBanner: true,
  };
}

function canvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** 구장을 원래 크기(640×420)의 오프스크린 캔버스에 한 프레임 그린다 */
export function stadiumFrame(scene: StadiumScene): HTMLCanvasElement {
  const c = canvas(STADIUM_W, STADIUM_H);
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  const layers = buildStatic(scene.facilities, scene.homeColor, scene.homeColor2);
  const night = scene.night ? buildNightTint() : null;
  const frame = (s: StadiumScene, fxT: number) => drawFrame({ ctx, scene: s, layers, t: 3.2, fxT, night });
  if (scene.fx.kind === 'none') {
    frame(scene, 60);
    return c;
  }
  // 폭죽 없는 같은 장면과 달라진 픽셀(폭죽·색종이)만 골라 첫 프레임 위에 얹는다
  frame({ ...scene, fx: { kind: 'none' } }, 60);
  const ref = ctx.getImageData(0, 0, STADIUM_W, STADIUM_H).data;
  const extra = FX_TIMES.slice(1).map((t) => {
    frame(scene, t);
    return ctx.getImageData(0, 0, STADIUM_W, STADIUM_H).data;
  });
  frame(scene, FX_TIMES[0]);
  const out = ctx.getImageData(0, 0, STADIUM_W, STADIUM_H);
  for (const e of extra) {
    for (let k = 0; k < e.length; k += 4) {
      if (e[k] === ref[k] && e[k + 1] === ref[k + 1] && e[k + 2] === ref[k + 2]) continue;
      out.data[k] = e[k];
      out.data[k + 1] = e[k + 1];
      out.data[k + 2] = e[k + 2];
    }
  }
  ctx.putImageData(out, 0, 0);
  return c;
}

async function loadFonts(sample: string): Promise<void> {
  if (!document.fonts?.load) return;
  await Promise.all(['56px Galmuri14', '33px Galmuri11'].map((f) => document.fonts.load(f, sample)));
}

type Ctx = CanvasRenderingContext2D;
type Family = 'Galmuri14' | 'Galmuri11';

/** 픽셀 폰트는 원래 크기의 정수배에서만 또렷하다: 폭에 맞는 가장 큰 배수를 고른다 */
function fit(ctx: Ctx, text: string, family: Family, sizes: number[], maxW: number): number {
  for (const s of sizes) {
    ctx.font = `${s}px ${family}`;
    if (ctx.measureText(text).width <= maxW) return s;
  }
  return sizes[sizes.length - 1];
}

/** 한 줄을 찍고 고른 글자 크기를 돌려준다. 가장 작은 크기로도 넘치면 폭에 맞춰 눌러 찍는다 (잘리지는 않는다) */
function line(ctx: Ctx, text: string, family: Family, sizes: number[], x: number, top: number, color: string, maxW: number, align: CanvasTextAlign = 'left'): number {
  const s = fit(ctx, text, family, sizes, maxW);
  ctx.font = `${s}px ${family}`;
  ctx.textBaseline = 'top';
  ctx.textAlign = align;
  ctx.fillStyle = color;
  ctx.fillText(text, Math.round(x), Math.round(top), maxW);
  ctx.textAlign = 'left';
  return s;
}
function box(ctx: Ctx, x: number, y: number, w: number, h: number, fill: string, edge = INK, t = 4): void {
  ctx.fillStyle = edge;
  ctx.fillRect(x - t, y - t, w + t * 2, h + t * 2);
  ctx.fillStyle = fill;
  ctx.fillRect(x, y, w, h);
}

/** 구장 미니 그림: 640×420 한 프레임을 정수 비율(1/2)로 줄여 테두리 안에 넣는다 */
function miniStadium(ctx: Ctx, scene: StadiumScene, x: number, y: number, dim = false): void {
  const w = STADIUM_W / 2;
  const h = STADIUM_H / 2;
  box(ctx, x, y, w, h, '#141a29');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(stadiumFrame(scene), 0, 0, STADIUM_W, STADIUM_H, x, y, w, h);
  if (dim) {
    ctx.fillStyle = 'rgba(20,26,41,0.45)';
    ctx.fillRect(x, y, w, h);
  }
}
export const MINI_W = STADIUM_W / 2;
export const MINI_H = STADIUM_H / 2;

/** 순위 → 칸 색 (위일수록 초록, 아래일수록 흐린 갈색) */
const RANK_COLOR = ['#1f6b3a', '#2f8a4c', '#5fae6a', '#9cc77f', '#e3c46a', '#e0a15a', '#c9896a', '#a89a8c'];
const rankColor = (rank: number) => RANK_COLOR[Math.max(1, Math.min(8, rank)) - 1];

interface MapCell {
  rank: number;
  past?: boolean; // 부임 전
  champ?: boolean;
  gone?: boolean; // 연고 이전된 시즌
}

/**
 * 시즌 지도: 한 칸 = 한 시즌, 색 = 순위, 우승은 금색 테두리. 부임 전 다섯 시즌은 속이 빈 칸으로 앞에 둔다.
 * (경기별 승패 기록은 세이브에 남지 않아, 시즌이 적을 때도 승패 칸 대신 이 지도를 쓴다)
 */
function seasonMap(ctx: Ctx, cells: MapCell[], x: number, y: number, maxW: number, maxH: number, sizes = [66, 55, 44, 33]): void {
  const gap = 6;
  const perOf = (s: number) => Math.floor((maxW + gap) / (s + gap));
  const rowsOf = (s: number) => Math.floor((maxH + gap) / (s + gap));
  const size = sizes.find((s) => perOf(s) * rowsOf(s) >= cells.length) ?? sizes[sizes.length - 1];
  const per = perOf(size);
  const shown = cells.slice(-per * rowsOf(size));
  const fs = size >= 66 ? 33 : 22;
  shown.forEach((c, i) => {
    const cx = x + (i % per) * (size + gap);
    const cy = y + Math.floor(i / per) * (size + gap);
    const col = rankColor(c.rank);
    ctx.fillStyle = c.champ ? GOLD : c.gone ? RED : c.past ? col : INK;
    ctx.fillRect(cx, cy, size, size);
    const t = c.champ ? 6 : 3;
    ctx.fillStyle = c.past ? SHEET : col;
    ctx.fillRect(cx + t, cy + t, size - t * 2, size - t * 2);
    line(ctx, String(c.rank), 'Galmuri11', [fs], cx + size / 2, cy + (size - fs) / 2 - 1, c.past ? MUTE : c.rank <= 3 ? '#ffffff' : INK, size, 'center');
  });
}

const cellsOf = (ranks: number[], champs: number[], gone: boolean): MapCell[] => [
  ...PAST_RANKS.map((rank) => ({ rank, past: true })),
  ...ranks.map((rank, i) => ({ rank, champ: champs.includes(i + 1), gone: gone && i === ranks.length - 1 })),
];

const toBlob = (c: HTMLCanvasElement): Promise<Blob> => new Promise<Blob>((ok, no) => c.toBlob((b) => (b ? ok(b) : no(new Error('이미지를 만들지 못했습니다'))), 'image/png'));

/** 공유 내용 + 구장 장면 → 기록 카드 PNG */
export async function renderCard(d: ShareData, scene: StadiumScene): Promise<Blob> {
  const r = d.rec;
  const items = cardItems(r);
  await loadFonts(`${SHARE_TITLE}${r.nick}${items.map((s) => s.label + s.value).join('')}단장 기록 시즌 지도 상위 시뮬레이션 대비 너라면 몇 만에 지킬 수 있을까 진행 중 우승 연고 이전 임기 마침 꿈 이룸 걸린 버틴 기준 시점의 진행도 부임 전 을 버텼습니다 명 중 가 같은 결말 돔구장 돔 공사 중 석`);
  const c = canvas(CARD_W, CARD_H);
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  const gone = r.kind === 'relocated';
  const accent = gone ? MUTE : ORANGE;
  const inner = CARD_W - PAD * 2;
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, CARD_W, CARD_H);

  // 위 색 띠: 제목 + 일련번호
  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, CARD_W, 96);
  ctx.fillStyle = INK;
  ctx.fillRect(0, 96, CARD_W, 6);
  line(ctx, SHARE_TITLE, 'Galmuri14', [42], PAD, 26, '#ffffff', 500);
  line(ctx, serialOf(r), 'Galmuri11', [33], CARD_W - PAD, 32, '#ffffff', 400, 'right');

  // 머리말
  line(ctx, '단장 기록', 'Galmuri11', [33], PAD, 128, GREEN, 300);
  ctx.fillStyle = RULE;
  ctx.fillRect(PAD + 160, 144, inner - 160, 4);

  // 구장 미니 그림 + 구단 이름 · 임기 · 결말
  const top = 190;
  miniStadium(ctx, scene, PAD + 4, top + 4, gone);
  const tx = PAD + MINI_W + 40;
  const tw = CARD_W - PAD - tx;
  const ns = line(ctx, `${SHARE_CITY} ${r.nick}`, 'Galmuri14', [70, 56, 42, 28], tx, top + 4, INK, tw);
  line(ctx, `1~${r.seasons}시즌 · 단장 ${r.seasons}년`, 'Galmuri11', [33, 22], tx, top + 4 + ns + 22, MUTE, tw);
  line(ctx, endingLine(r), 'Galmuri11', [33, 22], tx, top + 4 + ns + 22 + 33 + 22, gone ? RED : GREEN, tw);

  // 항목 6칸 (2열 × 3행)
  const gy = 440;
  const gap = 16;
  const cw = (inner - gap) / 2;
  const ch = 86;
  items.forEach((it, i) => {
    const x = PAD + (i % 2) * (cw + gap);
    const y = gy + Math.floor(i / 2) * (ch + gap);
    ctx.fillStyle = RULE;
    ctx.fillRect(x, y, cw, ch);
    ctx.fillStyle = SHEET;
    ctx.fillRect(x + 3, y + 3, cw - 6, ch - 6);
    ctx.fillStyle = i % 2 ? GREEN : ORANGE;
    ctx.fillRect(x, y, 8, ch);
    line(ctx, it.label, 'Galmuri11', [22], x + 26, y + 12, MUTE, cw - 44);
    line(ctx, it.value, 'Galmuri14', [28], x + 26, y + 44, INK, cw - 44);
  });

  // 아래 왼쪽: 시즌 지도 / 오른쪽: 상위 n%
  const by = 756;
  const mapW = 500;
  line(ctx, '시즌 지도', 'Galmuri11', [22], PAD, by, GREEN, mapW);
  line(ctx, '빈 칸 = 부임 전', 'Galmuri11', [22], PAD + mapW, by, MUTE, 300, 'right');
  seasonMap(ctx, cellsOf(r.ranks, r.champs, gone), PAD, by + 36, mapW, 180);

  const px = PAD + mapW + 44;
  const pw = CARD_W - PAD - px;
  ctx.fillStyle = RULE;
  ctx.fillRect(px - 24, by, 4, 224);
  if (gone) {
    // 연고 이전: 큰 숫자 = 버틴 시즌 수
    const big = `${r.seasons}시즌`;
    line(ctx, big, 'Galmuri14', [112, 84], px, by + 2, accent, pw - 8);
    line(ctx, big, 'Galmuri14', [112, 84], px + 8, by + 2, accent, pw - 8); // 한 픽셀 옆에 한 번 더 찍어 굵게
    line(ctx, '을 버텼습니다', 'Galmuri14', [33], px, by + 132, INK, pw);
    const same = relocatedPct();
    if (same !== null) line(ctx, `시뮬레이션 단장 ${d.pct.n}명 중 ${same}%가 같은 결말`, 'Galmuri11', [22, 18], px, by + 190, MUTE, pw);
  } else {
    line(ctx, '상위', 'Galmuri11', [33], px, by - 4, MUTE, pw);
    const pct = `${d.pct.pct}%`;
    line(ctx, pct, 'Galmuri14', [112], px, by + 46, accent, pw);
    line(ctx, pct, 'Galmuri14', [112], px + 8, by + 46, accent, pw); // 한 픽셀 옆에 한 번 더 찍어 굵게
    line(ctx, `시뮬레이션 단장 ${d.pct.n}명 대비`, 'Galmuri11', [22], px, by + 172, INK, pw);
    line(ctx, d.pct.basis, 'Galmuri11', [22], px, by + 202, MUTE, pw);
  }

  // 맨 아래: 질문 + 주소
  ctx.fillStyle = INK;
  ctx.fillRect(PAD, 990, inner, 4);
  line(ctx, askOf(r), 'Galmuri14', [28], PAD, 1014, INK, 560);
  line(ctx, SHARE_HOST, 'Galmuri11', [22], CARD_W - PAD, 1018, MUTE, 440, 'right');
  return toBlob(c);
}

// ───────── 링크 미리보기 (OG) 그림 ─────────

/** 그 유형의 전형적인 순위 흐름 (실제 기록이 아니라 유형을 보여 주는 그림) */
export function typicalRanks(info: CodeInfo): number[] {
  const { n, type, answer } = info;
  const end = type === 'w' ? 1 : type === 'x' ? 8 : { ks: 2, post: 3, flag: 5, near: 5, mid: 6, last: 8 }[answer!];
  const start = type === 'x' ? 7 : 8;
  return Array.from({ length: n }, (_, i) => (n === 1 ? end : Math.round(start + ((end - start) * i) / (n - 1) + (type === 'x' && i % 2 ? 0 : 0))));
}

/** 유형별 구장 미니 그림: 우승 = 큰 구장·만원·폭죽, 연고 이전 = 불 꺼진 처음 구장, 진행 중 = 시즌 수만큼 자란 구장 */
function typeScene(info: CodeInfo): StadiumScene {
  const { type, n } = info;
  const lv = type === 'x' ? 0 : Math.min(4, type === 'w' ? 2 + Math.floor(n / 4) : Math.floor(n / 3));
  return {
    facilities: { seats: lv, food: Math.min(4, lv), training: Math.min(4, lv) },
    homeColor: DEF.color,
    homeColor2: DEF.color2,
    awayColor: '#8892b0',
    fill: type === 'w' ? 1 : type === 'x' ? 0 : info.answer === 'ks' || info.answer === 'post' ? 0.85 : info.answer === 'last' ? 0.2 : 0.5,
    weather: type === 'x' ? 'cloudy' : 'sunny',
    night: type !== 'p',
    playing: false,
    homeBatting: false,
    fx: type === 'w' ? { kind: 'walkoff' } : { kind: 'none' },
    fxKey: 7,
    banners: type === 'w' ? 1 : 0,
    oldBanner: true,
    cheerLv: type === 'x' ? 0 : Math.min(3, lv),
  };
}

/** 결과 유형(w6 · x4 · p3-post)의 미리보기 그림 1200×630. scripts/share/pages.mjs 가 배포 때 유형마다 부른다 */
export async function renderOgFor(code: string): Promise<Blob> {
  const info = codeInfo(code);
  if (!info) throw new Error(`모르는 유형: ${code}`);
  await loadFonts(`${SHARE_TITLE}${info.title}${info.ask}단장 기록 시즌 지도 빈 칸 부임 전 을 버텼습니다 시뮬레이션 명 중 가 같은 결말 0123456789%`);
  const c = canvas(OG_W, OG_H);
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  const gone = info.type === 'x';
  const accent = gone ? RED : ORANGE;
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, OG_W, OG_H);
  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, OG_W, 14);
  ctx.fillStyle = GREEN;
  ctx.fillRect(0, OG_H - 14, OG_W, 14);

  // 왼쪽: 머리말 → 한 줄 → 큰 숫자 → 한 줄 → 질문 + 주소
  const x = 64;
  const lw = 690;
  line(ctx, `${SHARE_TITLE} · 단장 기록`, 'Galmuri11', [22], x, 56, GREEN, lw);
  line(ctx, info.lead, 'Galmuri14', [42], x, 106, INK, lw);
  const bs = 168;
  line(ctx, info.big, 'Galmuri14', [bs], x - 6, 168, accent, lw);
  line(ctx, info.big, 'Galmuri14', [bs], x - 6 + bs / 14, 168, accent, lw); // 한 픽셀 옆에 한 번 더 찍어 굵게
  // 연고 이전 유형: 큰 숫자 = 버틴 시즌 수, 보조 줄 = 같은 결말을 맞은 가상 단장의 비율
  const same = gone ? relocatedPct() : null;
  line(ctx, gone ? '을 버텼습니다' : info.tail.replace(/^[,\s]+/, ''), 'Galmuri14', [56, 42], x, 360, INK, lw);
  if (same !== null) line(ctx, `시뮬레이션 단장 ${BENCH.n}명 중 ${same}%가 같은 결말`, 'Galmuri11', [22], x, 434, MUTE, lw);
  line(ctx, info.ask, 'Galmuri11', [33], x, 478, GREEN, lw);
  line(ctx, SHARE_HOST, 'Galmuri11', [22], x, 540, MUTE, lw);

  // 오른쪽: 구장 미니 그림 + 시즌 지도 카드
  const cx = OG_W - 64 - (MINI_W + 48);
  const cw = MINI_W + 48;
  box(ctx, cx, 56, cw, OG_H - 112, SHEET);
  miniStadium(ctx, typeScene(info), cx + 24, 80, gone);
  const my = 80 + MINI_H + 26;
  line(ctx, '시즌 지도', 'Galmuri11', [22], cx + 24, my, GREEN, 200);
  line(ctx, '빈 칸 = 부임 전', 'Galmuri11', [22], cx + cw - 24, my, MUTE, 200, 'right');
  seasonMap(ctx, cellsOf(typicalRanks(info), info.type === 'w' ? [info.n] : [], gone), cx + 24, my + 36, MINI_W, OG_H - 56 - 24 - (my + 36), [66, 44, 33]);
  return toBlob(c);
}

/** 대표 미리보기 이미지(public/og.png, 1200×630): 종이 바탕에 제목 + 처음 구장. scripts/screens/cards.mjs --og 가 부른다 */
export async function renderOg(): Promise<Blob> {
  const sub = '만년 꼴찌 제주 야구단의 단장이 되는';
  const sub2 = '픽셀 야구 구단 타이쿤';
  await loadFonts(`${SHARE_TITLE}야구 단장을 해도 될까?${sub}${sub2}`);
  const c = canvas(OG_W, OG_H);
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, OG_W, OG_H);
  ctx.fillStyle = ORANGE;
  ctx.fillRect(0, 0, OG_W, 14);
  ctx.fillStyle = GREEN;
  ctx.fillRect(0, OG_H - 14, OG_W, 14);
  const x = 64;
  const lw = 700;
  line(ctx, SHARE_TITLE, 'Galmuri14', [112], x - 4, 120, ORANGE, lw);
  line(ctx, '야구 단장을 해도 될까?', 'Galmuri14', [56], x, 262, INK, lw);
  line(ctx, sub, 'Galmuri11', [33], x, 372, INK, lw);
  line(ctx, sub2, 'Galmuri11', [33], x, 418, INK, lw);
  line(ctx, SHARE_HOST, 'Galmuri11', [22], x, 540, MUTE, lw);
  const cx = OG_W - 64 - (MINI_W + 48);
  box(ctx, cx, 150, MINI_W + 48, MINI_H + 48 + 96, SHEET);
  miniStadium(ctx, { ...clubScene({ seed: 0, nick: DEF.name, seasons: 0, ranks: [], titles: 0, stage: 0, stars: 0, end: 'abandoned', date: '' }), fill: 0.2 }, cx + 24, 174);
  seasonMap(ctx, cellsOf([], [], false), cx + 24, 174 + MINI_H + 28, MINI_W, 60, [55]);
  return toBlob(c);
}

/** 지금 세이브의 기록 카드 */
export function makeCard(core: Core, kind: ShareKind): Promise<Blob> {
  return renderCard(shareFromCore(core, kind), cardScene(core, kind));
}
