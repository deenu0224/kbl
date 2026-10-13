import { HOF_END_KO, nickOf, type HofClub } from '../game/hof';
import { PAST_RANKS } from '../game/story';
import type { Core, PostFinish, SeasonRecord } from '../game/types';
import { SHARE_BASE } from './config';

/** 공유하는 순간: 시즌 결산 · 우승 엔딩 · 연고 이전 · 명예의 전당의 역대 구단 한 줄. 전부 순수 함수 */
export type ShareKind = 'season' | 'champion' | 'relocated';

export const SHARE_QUESTION = '답답해서 내가 야구 단장을 해도 될까?';
export const SHARE_CITY = '제주';
const RANKS_MAX = 10; // 순위열은 최근 열 시즌까지만

export interface ShareStat {
  label: string;
  value: string;
}
export interface ShareData {
  kind: ShareKind;
  answer: string; // 제목 질문에 대한 대답
  club: string; // "제주 감귤스 · 3시즌 「9월의 기적」"
  ranks: string; // "8-8-7-5-3-1"
  detail: string; // "71승 55패 · 평균 관중 8,120"
  stats: ShareStat[]; // 카드에 크게 찍는 숫자 3개
  seed: number;
  url: string; // 도전 링크
  text: string; // 공유 문구 (url 제외)
}

const int = (n: number): string => Math.round(n).toLocaleString('en-US');

/** 도전 링크: 리그 시드만 담는다 (별칭·세이브는 넣지 않는다) */
export const challengeUrl = (seed: number, base = SHARE_BASE): string => `${base}?l=${Math.floor(seed).toString(36)}`;

/** 주소의 ?l= 값을 시드로 읽는다. 올바르지 않으면 null */
export function parseChallenge(search: string): number | null {
  const raw = new URLSearchParams(search).get('l');
  if (!raw || !/^[0-9a-z]{1,11}$/.test(raw)) return null;
  const n = parseInt(raw, 36);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** 결산의 대답: 포스트시즌 결과 → 깃발(메인 목표) 달성 → 순위 순으로 정한다 */
export function seasonAnswer(r: Pick<SeasonRecord, 'rank' | 'post' | 'cleared'>, teams = 8): string {
  const post: PostFinish = r.post;
  if (post === 'champion') return '해도 된다.';
  if (post === 'KS') return '거의 다 왔다.';
  if (post !== 'none') return '가을 야구는 해 봤다.';
  if (r.cleared) return '조금만 더.';
  if (r.rank <= Math.ceil(teams / 2) + 1) return '가을이 보인다.';
  if (r.rank >= teams) return '올해는 아니었다.';
  return '아직은 모르겠다.';
}

export const answerOf = (kind: ShareKind, r: Pick<SeasonRecord, 'rank' | 'post' | 'cleared'> | undefined, teams = 8): string =>
  kind === 'champion' ? '해도 된다.' : kind === 'relocated' ? '안 되겠다.' : r ? seasonAnswer(r, teams) : '아직은 모르겠다.';

/** 부임 전 순위를 앞에 붙인 순위열 (최근 RANKS_MAX 개) */
export function shareRanks(ranks: number[]): string {
  return [...PAST_RANKS, ...ranks].slice(-RANKS_MAX).join('-');
}

function build(d: Omit<ShareData, 'url' | 'text'>): ShareData {
  const text = [SHARE_QUESTION, `→ ${d.answer}`, d.club, `${d.ranks} · ${d.detail}`].join('\n');
  return { ...d, url: challengeUrl(d.seed), text };
}

/** 지금 세이브로 만드는 공유 내용 (결산·엔딩·연고 이전) */
export function shareFromCore(core: Core, kind: ShareKind): ShareData {
  const c = core.campaign;
  const history = c.history ?? [];
  const last = history[history.length - 1];
  const team = core.teams.find((t) => t.id === core.userId);
  const w = last?.w ?? team?.rec.w ?? 0;
  const l = last?.l ?? team?.rec.l ?? 0;
  const att = core.attHistory ?? [];
  const avgAtt = Math.round(last?.avgAtt ?? (att.length ? att.reduce((a, b) => a + b, 0) / att.length : 0));
  const stars = c.achievements?.length ?? 0;
  const name = last?.name ?? c.verdict?.seasonName;
  return build({
    kind,
    answer: answerOf(kind, last, core.teams.length),
    club: `${SHARE_CITY} ${nickOf(core)} · ${Math.max(1, history.length)}시즌${name ? ` 「${name}」` : ''}`,
    ranks: shareRanks(history.map((h) => h.rank)),
    detail: `${w}승 ${l}패 · 평균 관중 ${int(avgAtt)}`,
    stats: [
      { label: '승패', value: `${w}-${l}` },
      { label: '평균 관중', value: int(avgAtt) },
      { label: '모은 별', value: `★${stars}` },
    ],
    seed: core.seed,
  });
}

/** 명예의 전당의 역대 구단 한 줄로 만드는 공유 내용 */
export function shareFromClub(club: HofClub): ShareData {
  const kind: ShareKind = club.end === 'champion' ? 'champion' : club.end === 'relocated' ? 'relocated' : 'season';
  const lastRank = club.ranks[club.ranks.length - 1] ?? 8;
  return build({
    kind,
    answer: answerOf(kind, { rank: lastRank, post: 'none', cleared: false }),
    club: `${SHARE_CITY} ${club.nick} · ${club.seasons}시즌 「${HOF_END_KO[club.end]}」`,
    ranks: shareRanks(club.ranks),
    detail: `우승 ${club.titles}회 · 모은 별 ${club.stars}`,
    stats: [
      { label: '시즌', value: String(club.seasons) },
      { label: '우승', value: String(club.titles) },
      { label: '모은 별', value: `★${club.stars}` },
    ],
    seed: club.seed,
  });
}

/** 문구 + 주소 (스레드·문구 복사·시스템 공유용) */
export const fullText = (d: ShareData): string => `${d.text}\n${d.url}`;

/** X 인텐트: 문구와 주소를 따로 넘긴다 */
export const xIntent = (d: ShareData): string => `https://twitter.com/intent/tweet?text=${encodeURIComponent(d.text)}&url=${encodeURIComponent(d.url)}`;

/** 스레드 인텐트: 문구 뒤에 주소를 붙여 한 덩어리로 */
export const threadsIntent = (d: ShareData): string => `https://www.threads.net/intent/post?text=${encodeURIComponent(fullText(d))}`;
