import { NOTE_MAX, SHARE_TAG } from './config';
import { ASK, ASK_KEEP, seasonAnswer, type Answer, type ShareData, type ShareRecord } from './shareData';

/** 공유하는 글 = 이야기. 구단사에서 문장을 뽑아 시간 순으로 잇는다 (숫자 나열 금지). 전부 순수 함수 */

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

/** 시드와 자리로 문장 변형을 고른다 (같은 구단은 언제나 같은 글) */
function pick<T>(xs: T[], seed: number, slot: number): T {
  let h = (Math.floor(seed) ^ (slot * 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return xs[((h ^ (h >>> 16)) >>> 0) % xs.length];
}

interface Sentence {
  at: number; // 일어난 시즌 (정렬용. 0 = 부임, 99 = 결말, 100 = 가상 단장 대비)
  keep: number; // 작을수록 끝까지 남는다
  text: string;
}

const NOW: Record<Answer, (n: number, rank: number) => string[]> = {
  ks: (n) => [`${n}시즌째에 한국시리즈까지 갔다. 한 걸음이 모자랐다.`, `${n}시즌째, 한국시리즈에서 졌다. 거의 다 왔다.`],
  post: (n) => [`${n}시즌째인 올해도 가을까지 야구를 했다.`, `지금은 ${n}시즌째. 올해는 가을야구에서 멈췄다.`],
  flag: (n, r) => [`${n}시즌째인 올해는 ${r}위. 약속한 목표는 지켰다.`, `지금은 ${n}시즌째. ${r}위로 올해 목표를 이뤘다.`],
  near: (n, r) => [`${n}시즌째인 올해는 ${r}위. 가을이 보이기 시작했다.`, `지금은 ${n}시즌째. ${r}위, 가을야구가 코앞이다.`],
  mid: (n, r) => [`${n}시즌째인 올해는 ${r}위로 버텼다.`, `지금은 ${n}시즌째. ${r}위, 아직 갈 길이 멀다.`],
  last: (n) => [`${n}시즌째인 올해도 꼴찌였다. 그래도 안 그만뒀다.`, `지금은 ${n}시즌째. 또 꼴찌지만 아직 내 자리다.`],
};

/** 구단사에서 뽑은 문장들 (시간 순) */
export function storySentences(d: ShareData): Sentence[] {
  const r: ShareRecord = d.rec;
  const n = r.seasons;
  const out: Sentence[] = [];
  const add = (at: number, keep: number, variants: string[]) => out.push({ at, keep, text: pick(variants, r.seed, out.length + at * 7) });

  add(0, 2, [`만년 꼴찌 제주 ${r.nick}의 단장이 됐다.`, `다섯 해를 바닥에서 보낸 제주 ${r.nick}의 단장을 맡았다.`, `답답해서 내가 맡았다. 만년 꼴찌 제주 ${r.nick}.`]);

  const end = r.champAt ?? n;
  const r1 = r.ranks[0];
  if (r1 !== undefined && end > 1 && r.firstPostAt !== 1) {
    if (r1 >= 8) add(1, 6, ['첫해는 또 꼴찌였다.', '첫해에는 달라진 게 없었다. 또 꼴찌.']);
    else if (r1 <= 5) add(1, 5, [`첫해에 ${r1}위까지 끌어올렸다.`, `부임 첫해, 꼴찌 팀이 ${r1}위를 했다.`]);
    else add(1, 7, [`첫해는 ${r1}위. 꼴찌만 면했다.`, `첫해에는 ${r1}위로 겨우 꼴찌를 벗어났다.`]);
  }
  if (r.firstProfitAt && r.firstProfitAt < end && r.firstProfitAt !== r.firstPostAt) {
    const k = r.firstProfitAt;
    add(k + 0.1, 8, [k === 1 ? '첫해부터 장부를 흑자로 돌려놨다.' : `${k}년째에 처음 흑자를 냈다.`, k === 1 ? '적자 구단이 첫해에 흑자를 냈다.' : `${k}년째, 장부가 처음으로 흑자가 됐다.`]);
  }
  if (r.firstPostAt && r.firstPostAt !== r.champAt && !(r.kind === 'season' && r.firstPostAt === n && !r.champAt)) {
    const k = r.firstPostAt;
    add(k + 0.2, 3, [k === 1 ? '첫해부터 가을야구를 했다.' : `${k}년째에 처음 가을야구를 했다.`, k === 1 ? '부임 첫해에 가을까지 야구를 했다.' : `${k}년째, 제주에 처음 가을야구가 왔다.`]);
  }
  if (r.exposed > 0) add(end - 0.5, 4, ['덮어 둔 일이 드러나 고개를 숙인 해도 있었다.', '감춘 일이 드러나 도민 앞에 사과한 해도 있었다.']);
  if (r.retired.length) add(end - 0.4, 5, [`${r.retired[0]}의 등번호는 영구결번이 됐다.`, `${r.retired[0]}의 번호는 이제 아무도 달지 못한다.`]);
  else if (r.star && n >= 2) add(end - 0.4, 7, [`팀의 얼굴은 ${r.star}.`, `관중은 ${r.star}의 이름을 가장 크게 불렀다.`]);

  if (r.kind === 'relocated') {
    const k = Math.max(1, r.failStreak);
    add(99, 1, [
      k >= 2 ? `${k}시즌 연속 약속을 못 지켰고, ${n}시즌 만에 구단은 제주를 떠났다.` : `도민의 마음을 잃었고, ${n}시즌 만에 구단은 제주를 떠났다.`,
      k >= 2 ? `${k}년 내리 목표를 놓쳤다. ${n}시즌 만에 연고지를 내줬다.` : `지지가 바닥났다. ${n}시즌 만에 연고지를 내줬다.`,
    ]);
  } else if (r.champAt) {
    const w = r.champAt;
    add(w, 1, [w === 1 ? '그리고 첫 시즌에 한국시리즈에서 우승했다.' : `${w}시즌 만에 한국시리즈에서 우승했다.`, w === 1 ? '첫 시즌에 우승 깃발을 걸었다.' : `${w}시즌 만에 제주에 우승 깃발을 걸었다.`]);
    if (r.kind === 'season' && n > w) add(99, 4, r.champs.length > 1 ? [`지금은 ${n}시즌째, 깃발이 ${r.champs.length}개다.`] : [`지금은 ${n}시즌째. 두 번째 깃발을 노린다.`, `${n}시즌째인 지금도 그 자리에 있다.`]);
  } else {
    add(99, 1, NOW[seasonAnswer(r.last)](n, r.last.rank));
  }
  // 가상 단장 대비: 자랑할 만할 때만 (절반 안쪽)
  if (d.pct.pct <= 50) add(100, r.champAt ? 2 : 5, [`시뮬레이션 단장 ${d.pct.n}명 가운데 상위 ${d.pct.pct}%.`, `시뮬레이션 단장 ${d.pct.n}명과 견주면 상위 ${d.pct.pct}%.`]);
  return out.sort((a, b) => a.at - b.at);
}

export const cleanNote = (note: string): string => [...note.replace(/\s+/g, ' ').trim()].slice(0, NOTE_MAX).join('');
export const askOf = (r: ShareRecord): string => (r.kind === 'relocated' ? ASK_KEEP : ASK);

/** 올라갈 글: [소감] + 이야기 3~6문장 + "너라면…? #답답해서내가 {주소}". X 제한(280)에 맞게 덜 중요한 문장부터 뺀다 */
export function shareText(d: ShareData, note = '', limit = X_LIMIT): string {
  const head = cleanNote(note);
  const tail = `${askOf(d.rec)} ${SHARE_TAG} ${d.url}`;
  let ss = storySentences(d);
  const build = () => [...(head ? [head] : []), ...ss.map((s) => s.text), tail].join('\n');
  // 여섯 문장까지만: 덜 중요한 것부터
  const dropWorst = () => {
    const worst = ss.reduce((a, b) => (b.keep >= a.keep ? b : a));
    ss = ss.filter((s) => s !== worst);
  };
  while (ss.length > 6) dropWorst();
  while (ss.length > 1 && xWeight(build()) > limit) dropWorst();
  return build();
}

/** X 인텐트: 주소까지 든 글 전체를 text 로 넘긴다 */
export const xIntent = (text: string): string => `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`;
/** 스레드 인텐트 */
export const threadsIntent = (text: string): string => `https://www.threads.net/intent/post?text=${encodeURIComponent(text)}`;
