import { TITLE_YEARS_AGO } from '../game/story';
import { NOTE_MAX, SHARE_TAG } from './config';
import { ASK, ASK_KEEP, type Lesson, type ShareData, type ShareRecord } from './shareData';

/** 공유하는 글 = 야구팬의 자조와 농담. 구단사에 맞는 문장을 골라 잇는다 (연대기·숫자 나열 금지). 전부 순수 함수 */

export const X_LIMIT = 280;
const X_URL = 23; // X 는 주소를 길이와 상관없이 23으로 센다

/** X 의 글자 수 세기: 한글·한자·전각은 2, 나머지는 1, 주소는 23 */
export function xWeight(text: string): number {
  let w = 0;
  for (const part of text.split(/(https?:\/\/\S+)/)) {
    if (/^https?:\/\//.test(part)) w += X_URL;
    else for (const ch of part) w += /[ᄀ-ᇿ⺀-꓏가-힯豈-﫿︰-﹏＀-￯]/u.test(ch) ? 2 : 1;
  }
  return w;
}

/** 시드와 자리로 문장을 고른다 */
function pick<T>(xs: T[], seed: number, slot: number): T {
  let h = (Math.floor(seed) ^ Math.imul(slot + 1, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return xs[((h ^ (h >>> 16)) >>> 0) % xs.length];
}

// ── 문장 풀: 자조와 농담. 승인된 문장만 쓴다 (변형을 늘리지 않는다) ──
const OPEN = ['"내가 해도 저것보단 잘하겠다"를 20년째 말하다가 진짜 해 봤다.', '야구 끊는다고 한 게 올해로 열한 번째다. 이번엔 구단을 맡았다.', '프런트 욕만 하다가 프런트가 됐다.'];
const LAST = '올해는 다르다고 했다. 달랐다. 더 못했다.';
const NEXT = '내년엔 진짜다. 이번엔 진짜 진짜다.';
const RACE = '9월에도 야구가 재밌는 건 처음이다.';
const FALL = '가을에 야구하는 팀이 됐다. 이 문장을 쓰려고 단장을 했다.';
const CHAMP = (w: number) => `${w}시즌 만에 우승했다. 울었냐고 묻지 마라.`;
const CHAMP_MORE = (w: number) => [`바랜 깃발 옆에 새 깃발을 걸었다. ${TITLE_YEARS_AGO + w - 1}년 걸렸다.`, '우승하면 다 용서된다더니, 진짜였다.'];
const MOVED = (n: number) => `${n}시즌을 버텼다. 팀은 섬을 떠났다.`;
const MOVED_MORE = ['"이게 팀이냐" 소리를 내가 들었다. 할 말이 없었다.', '욕하는 것과 하는 것은 달랐다. 인정한다.', '프런트가 문제라고 했는데, 그 프런트가 나였다.'];
const LESSON: Record<Lesson, string> = {
  money: '돈을 쓰라고 소리쳤는데, 써 보니 돈이 없었다.',
  raise: '육성은 언제 하냐고 했는데, 키워 놓으니 연봉을 올려 달란다.',
  trade: '트레이드 왜 안 하냐고 했는데, 해 보니 다 손해였다.',
  pen: '불펜을 왜 저렇게 굴리냐고 했는데, 굴릴 팔이 그게 다였다.',
};
const CLOSE = ['너라면 몇 시즌 만에?', '답답하면 네가 해 봐. 진짜로.', '네가 하면 다를 것 같지? 나도 그랬다.'];

/** 이번 시즌 한 줄: 가을야구를 못 간 시즌의 순위로 고른다 */
function seasonLine(r: ShareRecord): string {
  const rank = r.last.rank;
  if (rank >= 8) return LAST;
  if (rank <= 5 && rank >= 4 && !r.firstPostAt) return RACE;
  return NEXT;
}

export interface Story {
  open: string; // 첫 줄: 왜 단장이 됐나
  results: string[]; // 결과 줄 1~2개 (큰 사건 먼저)
  lesson: string | null; // 운영하다 깨달은 것
  versus: string | null; // 시뮬레이션 단장과 비교
  close: string; // 마지막 줄 (태그·주소 앞)
}

/** 구단사 → 글의 줄들. 같은 구단·같은 시즌이면 언제나 같은 글, 시즌이 바뀌면 첫 줄·마지막 줄이 달라질 수 있다 */
export function storyOf(d: ShareData): Story {
  const r: ShareRecord = d.rec;
  const n = r.seasons;
  const slot = (k: number) => n * 16 + k;
  const moved = r.kind === 'relocated';
  const results: string[] = [];
  if (moved) {
    results.push(MOVED(n), pick(MOVED_MORE, r.seed, slot(1)));
  } else if (r.champAt) {
    const w = r.champAt;
    results.push(`${r.kind === 'season' && n > w ? `${n}시즌째. ` : ''}${CHAMP(w)}`, pick(CHAMP_MORE(w), r.seed, slot(1)));
  } else {
    const now = `${n}시즌째. `;
    const post = r.last.post !== 'none';
    if (r.firstPostAt) results.push(now + FALL);
    if (!post) results.push(r.firstPostAt ? seasonLine(r) : now + seasonLine(r));
  }
  const ls = d.lessons ?? [];
  return {
    open: pick(OPEN, r.seed, slot(0)),
    results,
    lesson: ls.length ? LESSON[pick(ls, r.seed, slot(2))] : null,
    versus: moved ? null : `시뮬레이션 단장 ${d.pct.n}명과 견주면 상위 ${d.pct.pct}%.`,
    close: pick(CLOSE, r.seed, slot(3)),
  };
}

export const cleanNote = (note: string): string => [...note.replace(/\s+/g, ' ').trim()].slice(0, NOTE_MAX).join('');
export const askOf = (r: ShareRecord): string => (r.kind === 'relocated' ? ASK_KEEP : ASK);

/**
 * 올라갈 글: [소감] → 첫 줄 → 결과 1~2줄 → 깨달은 것 0~1줄 → 비교 줄 → "마지막 줄 #답답해서내가 {주소}".
 * X 제한(280)을 넘으면 깨달은 것 → 비교 줄 → 결과 둘째 줄 순으로 뺀다. 소감이 아주 길어 그래도 넘치면 첫 줄을 소감이 대신한다
 */
export function shareText(d: ShareData, note = '', limit = X_LIMIT): string {
  const head = cleanNote(note);
  const s = storyOf(d);
  let open: string[] = [s.open];
  const build = () => [...(head ? [head] : []), ...open, ...s.results, ...(s.lesson ? [s.lesson] : []), ...(s.versus ? [s.versus] : []), `${s.close} ${SHARE_TAG} ${d.url}`].join('\n');
  const drops = [() => (s.lesson = null), () => (s.versus = null), () => (s.results = s.results.slice(0, 1)), () => head && (open = [])];
  for (const drop of drops) {
    if (xWeight(build()) <= limit) break;
    drop();
  }
  return build();
}

/** X 인텐트: 주소까지 든 글 전체를 text 로 넘긴다 */
export const xIntent = (text: string): string => `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`;
/** 스레드 인텐트 */
export const threadsIntent = (text: string): string => `https://www.threads.net/intent/post?text=${encodeURIComponent(text)}`;
