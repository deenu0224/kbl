import { sceneExtras } from '../game/campaign';
import type { HofClub } from '../game/hof';
import { LEAGUE_TEAMS, TEAM_DEFS, USER_ID } from '../game/generate';
import type { Core, StadiumScene } from '../game/types';
import { buildNightTint, drawFrame } from '../stadium/dynamicLayer';
import { STADIUM_H, STADIUM_W } from '../stadium/geometry';
import { buildStatic } from '../stadium/staticLayer';
import { pastRanks } from '../game/story';
import { postTeamsFor } from '../game/league';
import { SHARE_HOST } from './config';
import { ASK, codeInfo, gmLineOf, shareFromCore, teamsOf, SHARE_CITY, SHARE_TITLE, type CodeInfo, type ShareData, type ShareKind } from './shareData';
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
/** 구단 수가 달라도 1위 = 첫 색, 꼴찌 = 마지막 색이 되도록 눈금을 맞춘다 */
const rankColor = (rank: number, teams: number) => RANK_COLOR[Math.round(((Math.max(1, Math.min(teams, rank)) - 1) * (RANK_COLOR.length - 1)) / Math.max(1, teams - 1))];

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
function seasonMap(ctx: Ctx, cells: MapCell[], x: number, y: number, maxW: number, maxH: number, sizes = [66, 55, 44, 33], teams = LEAGUE_TEAMS): void {
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
    const col = rankColor(c.rank, teams);
    ctx.fillStyle = c.champ ? GOLD : c.gone ? RED : c.past ? col : INK;
    ctx.fillRect(cx, cy, size, size);
    const t = c.champ ? 6 : 3;
    ctx.fillStyle = c.past ? SHEET : col;
    ctx.fillRect(cx + t, cy + t, size - t * 2, size - t * 2);
    line(ctx, String(c.rank), 'Galmuri11', [fs], cx + size / 2, cy + (size - fs) / 2 - 1, c.past ? MUTE : c.rank <= 3 ? '#ffffff' : INK, size, 'center');
  });
}

const cellsOf = (ranks: number[], champs: number[], gone: boolean, teams = LEAGUE_TEAMS): MapCell[] => [
  ...pastRanks(teams).map((rank) => ({ rank, past: true })),
  ...ranks.map((rank, i) => ({ rank, champ: champs.includes(i + 1), gone: gone && i === ranks.length - 1 })),
];

const toBlob = (c: HTMLCanvasElement): Promise<Blob> => new Promise<Blob>((ok, no) => c.toBlob((b) => (b ? ok(b) : no(new Error('이미지를 만들지 못했습니다'))), 'image/png'));

const POS_FULL: Record<string, string> = { C: '포수', '1B': '1루수', '2B': '2루수', '3B': '3루수', SS: '유격수', LF: '좌익수', CF: '중견수', RF: '우익수', DH: '지명타자', SP: '선발', RP: '불펜', CP: '마무리' };
const ROUND_SHORT: Record<string, string> = { WC: 'WC', SPO: '준PO', PO: 'PO', KS: 'KS' };
const pct3 = (w: number, l: number) => (w + l > 0 ? (w / (w + l)).toFixed(3).replace(/^0/, '') : '.000');
const gbText = (gb: number) => (gb <= 0 ? '1위' : `1위와 ${Number.isInteger(gb) ? gb : gb.toFixed(1)}게임 차`);
/** "76승 4무 61패" (무승부가 없으면 뺀다) */
const wlt = (w: number, l: number, t: number) => `${w}승${t ? ` ${t}무` : ''} ${l}패`;

/** 카드의 줄들 (빈 칸 규칙: 데이터가 없거나 의미가 약한 줄은 빠진다) */
export function cardLines(d: ShareData): { record: string; gb: string | null; mvp: [string, string] | null; marks: string[]; post: string | null; career: string | null } {
  const f = d.rec.card;
  if (!f) return { record: '', gb: null, mvp: null, marks: [], post: null, career: null };
  const teams = teamsOf(d.rec);
  const gb = f.gb === undefined || f.rank === 1 ? null : `(${gbText(f.gb)})`;
  const mvp: [string, string] | null = f.mvp ? [`${f.mvp.name} (${POS_FULL[f.mvp.pos] ?? f.mvp.pos})`, [f.mvp.line, ...f.mvp.titles].join(' · ')] : null;
  const marks = [
    ...(f.scene ? [`⚾ ${f.scene.text}`] : []),
    ...(f.foe ? [`😈 천적 ${f.foe.name} ${wlt(f.foe.w, f.foe.l, f.foe.t)}`] : []),
    ...(f.prey ? [`🍚 밥 ${f.prey.name} ${wlt(f.prey.w, f.prey.l, f.prey.t)}`] : []),
  ];
  const post = f.ps?.length ? `가을야구 ${f.ps.map(([r, a, b]) => `${ROUND_SHORT[r] ?? r} ${a}:${b}`).join(' → ')}${d.rec.last.post === 'champion' && d.rec.champs.includes(f.nth) ? ' 우승!' : ''}` : null;
  const c = f.career;
  return {
    record: `${wlt(f.w, f.l, f.t)} · ${pct3(f.w, f.l)} · ${Math.min(teams, f.rank)}위`,
    gb,
    mvp,
    marks,
    post,
    career: c ? `단장 경력  ${c.seasons}시즌 · 우승 ${c.titles}회 · 통산 ${wlt(c.w, c.l, c.t)}` : null,
  };
}

/** 월별 승률 막대: 6구간(4~9월), .500 선, 막대 위에 승률 */
function monthBars(ctx: Ctx, months: number[], x: number, y: number, w: number, h: number): void {
  const n = months.length;
  const gap = 18;
  const bw = Math.floor((w - gap * (n - 1)) / n);
  const top = y + 30; // 승률 글자 자리
  const base = y + h - 30; // 월 글자 자리
  const span = base - top;
  months.forEach((v, i) => {
    const bx = x + i * (bw + gap);
    const bh = Math.max(4, Math.round(span * Math.max(0, Math.min(1, v))));
    ctx.fillStyle = RULE;
    ctx.fillRect(bx, top, bw, span);
    ctx.fillStyle = v >= 0.5 ? GREEN : ORANGE;
    ctx.fillRect(bx, base - bh, bw, bh);
    line(ctx, v.toFixed(3).replace(/^0/, ''), 'Galmuri11', [22], bx + bw / 2, base - bh - 28, v >= 0.5 ? GREEN : MUTE, bw + gap, 'center');
    line(ctx, `${i + 4}월`, 'Galmuri11', [22], bx + bw / 2, base + 6, MUTE, bw + gap, 'center');
  });
  // .500 선
  ctx.fillStyle = INK;
  for (let px = x; px < x + w; px += 12) ctx.fillRect(px, base - Math.round(span / 2) - 1, 6, 2);
}


/**
 * 공유 내용 + 구장 장면 → 기록 카드 PNG (1080×1080).
 * 위: 제목 + 시즌 이름 · 구단 · 단장 점수 한 줄 + 구장 그림 / 가운데: 성적 · 월별 막대 · 올해의 선수 · 명장면·천적·밥 · 가을야구 / 아래: 질문 + 주소.
 * 빈 줄은 빼고 위로 당기며, 남는 높이는 월별 막대와 줄 간격이 흡수한다
 */
export async function renderCard(d: ShareData, scene: StadiumScene): Promise<Blob> {
  const r = d.rec;
  const f = r.card;
  const L = cardLines(d);
  const gone = r.kind === 'relocated';
  const ending = r.kind !== 'season';
  const gmText = r.gm ? gmLineOf(r.gm) : null;
  const sub = ending ? (gone ? `${r.seasons}시즌 · 연고 이전` : `${r.seasons}시즌 · 우승 엔딩`) : `${f?.nth ?? r.seasons}시즌째`;
  const title = f?.name ? `「${f.name}」` : '';
  const ask = gone ? '너라면 버틸 수 있나?' : r.kind === 'champion' ? ASK : '너라면 몇 승?';
  await loadFonts(`${SHARE_TITLE}${SHARE_CITY}${r.nick}${title}${sub}${gmText ?? ''}${L.record}${L.gb ?? ''}${L.mvp?.join('') ?? ''}${L.marks.join('')}${L.post ?? ''}${L.career ?? ''}${ask}올해의 선수 월별 최장 연승 4월5월6월7월8월9월.0123456789`);
  const c = canvas(CARD_W, CARD_H);
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  const accent = gone ? MUTE : ORANGE;
  const inner = CARD_W - PAD * 2;
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, CARD_W, CARD_H);

  // 위 색 띠: 제목 + 시즌 이름
  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, CARD_W, 96);
  ctx.fillStyle = INK;
  ctx.fillRect(0, 96, CARD_W, 6);
  line(ctx, SHARE_TITLE, 'Galmuri14', [42], PAD, 26, '#ffffff', 420);
  if (title) line(ctx, title, 'Galmuri14', [42, 28], CARD_W - PAD, 26, '#ffffff', 520, 'right');

  // 머리: 구단 · 시즌 · 단장 점수 (왼쪽) + 구장 그림 (오른쪽)
  const top = 132;
  const mx = CARD_W - PAD - MINI_W - 4;
  miniStadium(ctx, scene, mx, top + 4, gone);
  const hw = mx - PAD - 36;
  const ns = line(ctx, `${SHARE_CITY} ${r.nick}`, 'Galmuri14', [56, 42, 28], PAD, top, INK, hw);
  line(ctx, sub, 'Galmuri11', [33, 22], PAD, top + ns + 18, MUTE, hw);
  if (r.gm) {
    // 랭크 딱지 + "명단장 · 742점"
    const gy = top + ns + 18 + 33 + 26;
    const tag = r.gm.id;
    ctx.font = '56px Galmuri14';
    const tw = Math.max(84, ctx.measureText(tag).width + 28);
    box(ctx, PAD + 4, gy, tw, 76, RANK_FILL[tag] ?? GOLD);
    line(ctx, tag, 'Galmuri14', [56], PAD + 4 + tw / 2, gy + 10, INK, tw, 'center');
    const lx = PAD + tw + 30;
    line(ctx, r.gm.career ? '단장 경력' : '단장', 'Galmuri11', [22], lx, gy - 2, MUTE, hw - tw - 30);
    line(ctx, `${r.gm.name} · ${r.gm.score}점`, 'Galmuri14', [42, 28], lx, gy + 28, gone ? INK : GREEN, hw - tw - 30);
  }

  // 가운데 줄들: 높이를 먼저 재고, 남는 높이는 막대와 간격에 나눠 준다
  type Block = { h: number; draw: (y: number, extra: number) => void; grow?: boolean };
  const blocks: Block[] = [];
  const rule = (y: number) => {
    ctx.fillStyle = RULE;
    ctx.fillRect(PAD, y, inner, 4);
  };
  if (L.career)
    blocks.push({ h: 44, draw: (y) => line(ctx, L.career!, 'Galmuri14', [28], PAD, y + 4, INK, inner) });
  if (L.record)
    blocks.push({
      h: 60,
      draw: (y) => {
        const s = line(ctx, L.record, 'Galmuri14', [42, 28], PAD, y, INK, inner);
        if (!L.gb) return;
        ctx.font = `${s}px Galmuri14`;
        const w = ctx.measureText(L.record).width;
        line(ctx, L.gb, 'Galmuri11', [33, 22], PAD + w + 20, y + (s - 33) + 4, MUTE, inner - w - 20);
      },
    });
  if (f?.months?.length)
    blocks.push({
      h: 150,
      grow: true,
      draw: (y, extra) => {
        line(ctx, '월별 승률', 'Galmuri11', [22], PAD, y, GREEN, 300);
        if (f.streak) line(ctx, `최장 ${f.streak}연승`, 'Galmuri11', [22], CARD_W - PAD, y, INK, 300, 'right');
        monthBars(ctx, f.months!, PAD, y + 30, inner, 120 + extra);
      },
    });
  const sep = { h: 4, draw: (y: number) => rule(y) };
  if (L.mvp) {
    blocks.push(sep);
    blocks.push({
      h: 82,
      draw: (y) => {
        line(ctx, '올해의 선수', 'Galmuri11', [22], PAD, y + 4, GREEN, 200);
        line(ctx, L.mvp![0], 'Galmuri14', [28], PAD + 180, y, INK, inner - 180);
        line(ctx, L.mvp![1], 'Galmuri14', [28], PAD + 180, y + 42, INK, inner - 180);
      },
    });
  }
  if (L.marks.length) {
    blocks.push(sep);
    blocks.push({ h: L.marks.length * 42 - 6, draw: (y) => L.marks.forEach((m, i) => line(ctx, m, 'Galmuri14', [28], PAD, y + i * 42, INK, inner)) });
  }
  if (L.post) {
    blocks.push(sep);
    blocks.push({ h: 36, draw: (y) => line(ctx, L.post!, 'Galmuri14', [28], PAD, y, gone ? INK : GREEN, inner) });
  }
  const y0 = top + MINI_H + 44;
  const y1 = 980;
  const need = blocks.reduce((a, b) => a + b.h, 0);
  const free = Math.max(0, y1 - y0 - need);
  const grow = blocks.some((b) => b.grow) ? Math.min(free * 0.6, 160) : 0;
  const gapH = blocks.length > 1 ? Math.min(44, (free - grow) / (blocks.length + 1)) : 0;
  let y = y0 + Math.max(0, (free - grow - gapH * (blocks.length - 1)) / 2 - 10);
  rule(y0 - 22);
  for (const b of blocks) {
    const g = b.grow ? grow : 0;
    b.draw(Math.round(y), g);
    y += b.h + g + gapH;
  }

  // 맨 아래: 질문 + 주소
  ctx.fillStyle = INK;
  ctx.fillRect(PAD, 990, inner, 4);
  line(ctx, ask, 'Galmuri14', [28], PAD, 1014, INK, 560);
  line(ctx, SHARE_HOST, 'Galmuri11', [22], CARD_W - PAD, 1018, MUTE, 440, 'right');
  return toBlob(c);
}
const RANK_FILL: Record<string, string> = { SS: '#ffd84a', S: '#ffc83a', 'A+': '#6ee07a', A: '#8fe68a', 'B+': '#7fd3ff', B: '#a5def5', C: '#f0c35a', D: '#f0a35a', F: '#ff8a7a' };

// ───────── 링크 미리보기 (OG) 그림 ─────────

/** 그 유형의 전형적인 순위 흐름 (실제 기록이 아니라 유형을 보여 주는 그림) */
export function typicalRanks(info: CodeInfo): number[] {
  const { n, type, answer } = info;
  // 새 게임(10구단) 기준: 꼴찌 10위에서 시작하고, 가을야구 막차는 5위
  const last = LEAGUE_TEAMS;
  const cut = postTeamsFor(last);
  const end = type === 'w' ? 1 : type === 'x' ? last : { ks: 2, post: 3, flag: cut + 1, near: cut + 1, mid: cut + 3, last }[answer!];
  const start = type === 'x' ? last - 1 : last;
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
