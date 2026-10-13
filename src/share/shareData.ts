import { ACHIEVEMENTS } from '../game/campaign';
import { isFranchise } from '../game/franchise';
import { SEAT_LV } from '../game/economy';
import { nickOf, type HofClub } from '../game/hof';
import { PAST_RANKS, TRUST_LABEL } from '../game/story';
import type { Core, PostFinish, SeasonRecord } from '../game/types';
import { percentile, type Percentile } from './bench';
import { SHARE_BASE } from './config';

/** 공유하는 순간: 시즌 결산 · 우승 엔딩 · 연고 이전 (명예의 전당의 역대 구단 한 줄도 이 셋 중 하나). 전부 순수 함수 */
export type ShareKind = 'season' | 'champion' | 'relocated';

export const SHARE_TITLE = '답답해서 내가';
export const SHARE_CITY = '제주';
export const STARS_MAX = ACHIEVEMENTS.length;

/** 구단사 요약: 글·카드·링크가 전부 이것만 읽는다 */
export interface ShareRecord {
  kind: ShareKind;
  seed: number;
  nick: string;
  seasons: number; // 치른 시즌 수 (1 이상)
  ranks: number[]; // 시즌별 정규시즌 순위
  champs: number[]; // 우승한 시즌 (1-based)
  champAt: number | null; // 첫 우승 시즌
  firstPostAt: number | null; // 첫 가을야구 시즌
  firstProfitAt: number | null; // 첫 흑자 시즌
  bestPost: PostFinish;
  last: Pick<SeasonRecord, 'rank' | 'post' | 'cleared'>;
  failStreak: number; // 끝에서부터 연속으로 목표를 놓친 시즌 수
  stage: number;
  stars: number;
  trust: number | null;
  star: string | null; // 간판스타
  retired: string[]; // 영구결번
  seats: string | null; // "24,000석"
  exposed: number; // 덮은 일이 드러난 횟수
}

export interface ShareData {
  rec: ShareRecord;
  code: string; // 결과 유형 (w6 · x4 · p3-post)
  url: string; // 결과가 담긴 주소 (도전 링크)
  pct: Percentile;
}

const int = (n: number): string => Math.round(n).toLocaleString('en-US');
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

// ───────── 결과 유형 코드 ─────────

/** 진행 중 결산의 대답 6종 */
export const ANSWERS = ['ks', 'post', 'flag', 'near', 'mid', 'last'] as const;
export type Answer = (typeof ANSWERS)[number];
export const W_MAX = 20;
export const X_MIN = 2;
export const X_MAX = 12;
export const P_MAX = 20;

/** 결산의 대답: 포스트시즌 결과 → 깃발(메인 목표) 달성 → 순위 순으로 정한다 */
export function seasonAnswer(r: Pick<SeasonRecord, 'rank' | 'post' | 'cleared'>, teams = 8): Answer {
  if (r.post === 'KS' || r.post === 'champion') return 'ks';
  if (r.post !== 'none') return 'post';
  if (r.cleared) return 'flag';
  if (r.rank <= Math.ceil(teams / 2) + 1) return 'near';
  return r.rank >= teams ? 'last' : 'mid';
}

/** 구단사 → 결과 유형 코드. 우승한 적이 있으면 w{첫 우승 시즌}, 연고 이전이면 x{시즌 수}, 아니면 p{시즌 수}-{대답} */
export function resultCode(r: Pick<ShareRecord, 'kind' | 'seasons' | 'champAt' | 'last'>): string {
  if (r.kind === 'relocated') return `x${clamp(r.seasons, X_MIN, X_MAX)}`;
  if (r.champAt) return `w${clamp(r.champAt, 1, W_MAX)}`;
  return `p${clamp(r.seasons, 1, P_MAX)}-${seasonAnswer(r.last)}`;
}

/** 공유 페이지를 만들 모든 유형 (약 150종) */
export function allCodes(): string[] {
  const out: string[] = [];
  for (let n = 1; n <= W_MAX; n++) out.push(`w${n}`);
  for (let n = X_MIN; n <= X_MAX; n++) out.push(`x${n}`);
  for (let n = 1; n <= P_MAX; n++) for (const a of ANSWERS) out.push(`p${n}-${a}`);
  return out;
}

export interface CodeInfo {
  code: string;
  type: 'w' | 'x' | 'p';
  n: number;
  answer: Answer | null;
  lead: string; // "만년 꼴찌 제주 구단을 맡아"
  big: string; // "6시즌"
  tail: string; // "만에 우승했어요"
  title: string; // og:title — 세 조각을 이은 한 문장
  who: string; // 초기 화면: "누군가 6시즌 만에 우승한 리그입니다"
  ask: string; // "너라면 몇 시즌 만에?"
}

const P_TAIL: Record<Answer, [string, string]> = {
  ks: ['째에 한국시리즈에 갔어요', '째에 한국시리즈까지 간'],
  post: ['째에 가을야구를 했어요', '째에 가을야구를 한'],
  flag: ['째에 목표를 이뤘어요', '째에 시즌 목표를 이룬'],
  near: ['째, 가을이 보여요', '째에 가을 문턱까지 간'],
  mid: ['째 버티는 중이에요', '째 버티고 있는'],
  last: ['째, 아직 꼴찌예요', '째 꼴찌와 싸우고 있는'],
};
export const ASK = '너라면 몇 시즌 만에?';
export const ASK_KEEP = '너라면 지킬 수 있을까?';

/** 코드 → 미리보기 그림·제목·초기 화면에 쓰는 문장. 모르는 코드면 null */
export function codeInfo(code: string | null | undefined): CodeInfo | null {
  const m = /^(?:([wx])(\d{1,2})|p(\d{1,2})-([a-z]+))$/.exec(code ?? '');
  if (!m) return null;
  const type = (m[1] ?? 'p') as CodeInfo['type'];
  const n = Number(m[2] ?? m[3]);
  const answer = (m[4] as Answer | undefined) ?? null;
  if (type === 'w' && (n < 1 || n > W_MAX)) return null;
  if (type === 'x' && (n < X_MIN || n > X_MAX)) return null;
  if (type === 'p' && (n < 1 || n > P_MAX || !answer || !ANSWERS.includes(answer))) return null;
  const big = `${n}시즌`;
  const mk = (lead: string, tail: string, who: string, ask: string): CodeInfo => ({
    code: code!,
    type,
    n,
    answer,
    lead,
    big,
    tail,
    title: `${lead} ${big}${/^[째,]/.test(tail) ? '' : ' '}${tail}`,
    who: `누군가 ${big}${/^째/.test(who) ? '' : ' '}${who} 리그입니다`,
    ask,
  });
  if (type === 'w') return mk('만년 꼴찌 제주 구단을 맡아', '만에 우승했어요', '만에 우승한', ASK);
  if (type === 'x') return mk('만년 꼴찌 제주 구단을 맡았지만', '만에 연고지를 내줬어요', '만에 연고지를 내준', ASK_KEEP);
  return mk('만년 꼴찌 제주 구단을 맡아', P_TAIL[answer!][0], P_TAIL[answer!][1], ASK);
}

// ───────── 주소 ─────────

const seed36 = (seed: number) => Math.floor(seed).toString(36);

/**
 * 결과가 담긴 주소: /s/{code}/?l={리그 시드}. 그 정적 페이지가 미리보기(OG)를 갖고, 열면 게임(?l=…&from={code})으로 넘어간다.
 * 시드는 그대로 넣는다 (섞으면 같은 리그가 재현되지 않는다). 별칭·세이브는 넣지 않는다
 */
export const shareUrl = (seed: number, code: string, base = SHARE_BASE): string => `${base}s/${code}/?l=${seed36(seed)}`;

/** 주소의 ?l= 값을 시드로 읽는다. 올바르지 않으면 null */
export function parseChallenge(search: string): number | null {
  const raw = new URLSearchParams(search).get('l');
  if (!raw || !/^[0-9a-z]{1,11}$/.test(raw)) return null;
  const n = parseInt(raw, 36);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** 주소의 &from= 값(공유한 사람의 결과 유형)을 읽는다 */
export const parseFrom = (search: string): CodeInfo | null => codeInfo(new URLSearchParams(search).get('from'));

// ───────── 구단사 요약 ─────────

const POST_ORDER: PostFinish[] = ['none', 'SPO', 'PO', 'KS', 'champion'];
const firstAt = <T,>(xs: T[], f: (x: T) => boolean): number | null => {
  const i = xs.findIndex(f);
  return i < 0 ? null : i + 1;
};
const trailing = <T,>(xs: T[], f: (x: T) => boolean): number => {
  let k = 0;
  for (let i = xs.length - 1; i >= 0 && f(xs[i]); i--) k++;
  return k;
};

/** 지금 세이브의 구단사 (결산·엔딩·연고 이전) */
export function recordFromCore(core: Core, kind: ShareKind): ShareRecord {
  const c = core.campaign;
  const h = c.history ?? [];
  const team = core.teams.find((t) => t.id === core.userId);
  const last = h[h.length - 1] ?? { rank: team ? 8 : 8, post: 'none' as PostFinish, cleared: false };
  const roster = [...(team?.roster ?? [])].sort((a, b) => b.star - a.star);
  const star = roster.find((p) => isFranchise(p, core.season)) ?? roster[0];
  const champs = h.flatMap((x, i) => (x.post === 'champion' ? [i + 1] : []));
  return {
    kind,
    seed: core.seed,
    nick: nickOf(core),
    seasons: Math.max(1, h.length),
    ranks: h.map((x) => x.rank),
    champs,
    champAt: champs[0] ?? (kind === 'champion' ? Math.max(1, h.length) : null),
    firstPostAt: firstAt(h, (x) => x.post !== 'none'),
    firstProfitAt: firstAt(h, (x) => x.profit > 0),
    bestPost: h.reduce<PostFinish>((b, x) => (POST_ORDER.indexOf(x.post) > POST_ORDER.indexOf(b) ? x.post : b), 'none'),
    last: { rank: last.rank, post: last.post, cleared: last.cleared },
    failStreak: trailing(h, (x) => !x.cleared),
    stage: c.stage,
    stars: c.achievements?.length ?? 0,
    trust: Math.round(c.trust),
    star: star?.name ?? null,
    retired: (c.retired ?? []).map((r) => r.name),
    seats: `${int(SEAT_LV[core.facilities.seats]?.cap ?? 0)}석`,
    exposed: c.exposed ?? 0,
  };
}

/** 명예의 전당의 역대 구단 한 줄 (순위·우승 횟수·별만 남아 있다) */
export function recordFromClub(club: HofClub): ShareRecord {
  const kind: ShareKind = club.end === 'champion' ? 'champion' : club.end === 'relocated' ? 'relocated' : 'season';
  const seasons = Math.max(1, club.seasons);
  const champAt = club.end === 'champion' ? seasons : null;
  return {
    kind,
    seed: club.seed,
    nick: club.nick,
    seasons,
    ranks: club.ranks,
    champs: champAt ? [champAt] : [],
    champAt,
    firstPostAt: null,
    firstProfitAt: null,
    bestPost: club.titles > 0 ? 'champion' : 'none',
    last: { rank: club.ranks[club.ranks.length - 1] ?? 8, post: champAt ? 'champion' : 'none', cleared: !!champAt },
    failStreak: 0,
    stage: club.stage,
    stars: club.stars,
    trust: null,
    star: null,
    retired: [],
    seats: null,
    exposed: club.tainted ? 1 : 0,
  };
}

export function shareOf(rec: ShareRecord): ShareData {
  const code = resultCode(rec);
  const pct = percentile({ seasons: rec.seasons, champAt: rec.champAt, relocated: rec.kind === 'relocated', stage: rec.stage, best: Math.min(8, ...rec.ranks) });
  return { rec, code, url: shareUrl(rec.seed, code), pct };
}
export const shareFromCore = (core: Core, kind: ShareKind): ShareData => shareOf(recordFromCore(core, kind));
export const shareFromClub = (club: HofClub): ShareData => shareOf(recordFromClub(club));

// ───────── 카드에 적는 말 ─────────

/** 일련번호: JEJ-{시즌 수}-{시드 base36 끝 4자} */
export const serialOf = (r: Pick<ShareRecord, 'seasons' | 'seed'>): string => `JEJ-${r.seasons}-${seed36(r.seed).toUpperCase().padStart(4, '0').slice(-4)}`;

/** 한 줄 결말 */
export function endingLine(r: ShareRecord): string {
  if (r.kind === 'relocated') return '연고 이전으로 임기를 마침';
  if (r.kind === 'champion') return '한국시리즈 우승으로 꿈을 이룸';
  return r.champAt ? `우승 뒤 ${r.seasons}시즌째 진행 중` : `${r.seasons}시즌째 진행 중`;
}

const BEST_KO: Record<PostFinish, string> = { none: '', SPO: '준플레이오프', PO: '플레이오프', KS: '한국시리즈 준우승', champion: '한국시리즈 우승' };
export function bestLine(r: ShareRecord): string {
  if (r.champs.length > 1) return `한국시리즈 우승 ${r.champs.length}회`;
  return BEST_KO[r.bestPost] || `정규시즌 ${Math.min(8, ...r.ranks)}위`;
}

export const TOOK_OVER = `5년간 ${PAST_RANKS.join('-')}위`;

/** 카드의 항목 6칸 */
export function cardItems(r: ShareRecord): { label: string; value: string }[] {
  return [
    { label: '맡았을 때', value: TOOK_OVER },
    { label: '최고 성적', value: bestLine(r) },
    { label: r.retired.length ? '영구결번' : '간판스타', value: r.retired[0] ?? r.star ?? '—' },
    { label: '구장', value: r.seats ?? '—' },
    { label: '모은 별', value: `★ ${r.stars}/${STARS_MAX}` },
    { label: TRUST_LABEL, value: r.trust === null ? '—' : String(r.trust) },
  ];
}

/** 공유 화면의 제목 */
export const sheetTitle = (kind: ShareKind, club = false): string => (club ? '구단 기록 공유하기' : kind === 'champion' ? '우승 기록 공유하기' : kind === 'relocated' ? '구단 기록 공유하기' : '이번 시즌 공유하기');
