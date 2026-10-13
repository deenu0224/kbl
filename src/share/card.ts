import { sceneExtras } from '../game/campaign';
import type { HofClub } from '../game/hof';
import { TEAM_DEFS, USER_ID } from '../game/generate';
import type { Core, StadiumScene } from '../game/types';
import { buildNightTint, drawFrame } from '../stadium/dynamicLayer';
import { STADIUM_H, STADIUM_W } from '../stadium/geometry';
import { buildStatic } from '../stadium/staticLayer';
import { SHARE_BASE } from './config';
import { SHARE_QUESTION, shareFromCore, type ShareData, type ShareKind } from './shareData';

/** 공유 카드: 1080×1350(4:5). 위 60% 는 구장 한 프레임, 아래는 남색 패널에 픽셀 글자 */
export const CARD_W = 1080;
export const CARD_H = 1350;
const ART_H = 810;
const SCALE = 2; // 구장(640×420)을 정수 배율로 키워 가운데를 잘라 쓴다
const PAD = 56;
const INK = '#141a29';
const EDGE = '#0f1420';
const HI = '#ffd84a';
const SKY = '#7fd3ff';

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

/** 픽셀 폰트는 원래 크기의 정수배에서만 또렷하다: 폭에 맞는 가장 큰 배수를 고른다 */
function fit(ctx: Ctx, text: string, family: 'Galmuri14' | 'Galmuri11', sizes: number[], maxW: number): number {
  for (const s of sizes) {
    ctx.font = `${s}px ${family}`;
    if (ctx.measureText(text).width <= maxW) return s;
  }
  return sizes[sizes.length - 1];
}

function line(ctx: Ctx, text: string, family: 'Galmuri14' | 'Galmuri11', sizes: number[], x: number, top: number, color: string, shadow = 0, maxW = CARD_W - PAD * 2): number {
  const s = fit(ctx, text, family, sizes, maxW);
  ctx.font = `${s}px ${family}`;
  ctx.textBaseline = 'top';
  if (shadow) {
    ctx.fillStyle = EDGE;
    ctx.fillText(text, x + shadow, top + shadow, maxW);
  }
  ctx.fillStyle = color;
  ctx.fillText(text, x, top, maxW);
  return s;
}

/** 공유 내용 + 구장 장면 → 카드 PNG */
export async function renderCard(d: ShareData, scene: StadiumScene): Promise<Blob> {
  await loadFonts(`${SHARE_QUESTION}${d.answer}${d.club}${d.ranks}${d.stats.map((s) => s.label + s.value).join('')}`);
  const c = canvas(CARD_W, CARD_H);
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = INK;
  ctx.fillRect(0, 0, CARD_W, CARD_H);

  // 위: 구장 (2배 확대, 가로 가운데·아래쪽 기준으로 자른다)
  const art = stadiumFrame(scene);
  const sw = CARD_W / SCALE;
  const sh = ART_H / SCALE;
  ctx.drawImage(art, (STADIUM_W - sw) / 2, STADIUM_H - sh, sw, sh, 0, 0, CARD_W, ART_H);
  if (d.kind === 'relocated') {
    ctx.fillStyle = 'rgba(15,20,32,0.5)';
    ctx.fillRect(0, 0, CARD_W, ART_H);
  }
  ctx.fillStyle = EDGE;
  ctx.fillRect(0, ART_H - 8, CARD_W, 8);
  ctx.fillStyle = d.kind === 'relocated' ? '#47557f' : scene.homeColor;
  ctx.fillRect(0, ART_H, CARD_W, 8);

  // 아래: 질문(작게) → 대답(가장 크게) → 구단·시즌 → 순위열 → 숫자 3개 → 주소
  const answerColor = d.kind === 'relocated' ? '#ff6b6b' : HI;
  line(ctx, SHARE_QUESTION, 'Galmuri11', [33, 22], PAD, 846, SKY);
  const as = line(ctx, d.answer, 'Galmuri14', [112, 98, 84, 70, 56], PAD, 898, answerColor, 6);
  let y = 898 + as + 26;
  y += line(ctx, d.club, 'Galmuri14', [42, 28], PAD, y, d.kind === 'relocated' ? '#c9d2e8' : scene.homeColor, 3) + 18;
  line(ctx, d.ranks, 'Galmuri11', [44, 33, 22], PAD, y, '#ffffff');

  const boxTop = 1162;
  const boxH = 118;
  const gap = 16;
  const boxW = (CARD_W - PAD * 2 - gap * 2) / 3;
  d.stats.slice(0, 3).forEach((s, i) => {
    const x = PAD + i * (boxW + gap);
    ctx.fillStyle = EDGE;
    ctx.fillRect(x - 4, boxTop - 4, boxW + 8, boxH + 8);
    ctx.fillStyle = '#232c45';
    ctx.fillRect(x, boxTop, boxW, boxH);
    line(ctx, s.label, 'Galmuri11', [22], x + 18, boxTop + 14, '#aab6d6', 0, boxW - 36);
    line(ctx, s.value, 'Galmuri14', [56, 42, 28], x + 18, boxTop + 48, '#ffffff', 0, boxW - 36);
  });
  line(ctx, SHARE_BASE.replace(/^https:\/\//, '').replace(/\/$/, ''), 'Galmuri11', [22], PAD, 1304, '#aab6d6');

  return new Promise<Blob>((ok, no) => c.toBlob((b) => (b ? ok(b) : no(new Error('카드 이미지를 만들지 못했습니다'))), 'image/png'));
}

/** 링크 미리보기 이미지(public/og.png, 1200×630): 처음 구장 위에 제목 로고. scripts/screens/cards.mjs --og 가 부른다 */
export async function renderOg(): Promise<Blob> {
  const W = 1200;
  const H = 630;
  const sub = '만년 꼴찌 제주 야구단의 단장이 되는 픽셀 야구 구단 타이쿤';
  await loadFonts(`${SHARE_QUESTION}${sub}`);
  const c = canvas(W, H);
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  const art = stadiumFrame({ ...clubScene({ seed: 0, nick: DEF.name, seasons: 0, ranks: [], titles: 0, stage: 0, stars: 0, end: 'abandoned', date: '' }), fill: 0.12 });
  ctx.drawImage(art, (STADIUM_W - W / SCALE) / 2, 70, W / SCALE, H / SCALE, 0, 0, W, H);
  ctx.fillStyle = 'rgba(15,20,32,0.62)';
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'center';
  line(ctx, '답답해서 내가', 'Galmuri14', [154], W / 2, 120, HI, 8, W - 80);
  line(ctx, '야구 단장을 해도 될까?', 'Galmuri14', [70], W / 2, 318, '#ffffff', 5, W - 80);
  line(ctx, sub, 'Galmuri11', [33], W / 2, 462, '#dfe6f5', 3, W - 80);
  return new Promise<Blob>((ok, no) => c.toBlob((b) => (b ? ok(b) : no(new Error('og 이미지를 만들지 못했습니다'))), 'image/png'));
}

/** 지금 세이브의 공유 카드 */
export function makeCard(core: Core, kind: ShareKind): Promise<Blob> {
  return renderCard(shareFromCore(core, kind), cardScene(core, kind));
}
