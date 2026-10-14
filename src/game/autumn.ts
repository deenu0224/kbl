// 가을야구 화면 문구: 정규시즌 마감 화면 · 상단 바의 시리즈 한 줄 · 상대가 올라온 길. 순수 함수 (난수를 쓰지 않는다)
import type { Core, PostSeries, Team } from './types';
import { postTeams } from './league';
import { standings } from './season';
import { roundDef } from './postseason';
import { objMet, objValue, stageOf } from './campaign';

const SHORT: Record<string, string> = { WC: '와일드카드', SPO: '준PO', PO: 'PO', KS: '한국시리즈' };
export const roundShortName = (r: string) => SHORT[r] ?? r;
const FORMAT: Record<number, string> = { 3: '3전 2선승', 5: '5전 3선승', 7: '7전 4선승' };

const teamName = (core: Pick<Core, 'teams'>, id: string | null) => (id ? (core.teams.find((t) => t.id === id)?.name ?? id) : '');
const need = (s: Pick<PostSeries, 'bestOf'>) => Math.floor(s.bestOf / 2) + 1;
/** 두 팀의 승차 (a 가 위) */
export const gamesBehind = (a: Team, b: Team) => (a.rec.w - b.rec.w + (b.rec.l - a.rec.l)) / 2;
const fmtGb = (g: number) => (Number.isInteger(g) ? String(g) : g.toFixed(1));

/** 우리가 처음 나서는 시리즈 (진출 못 했으면 null) */
export function firstSeries(core: Pick<Core, 'post' | 'userId'>): { s: PostSeries; idx: number } | null {
  const post = core.post;
  if (!post || post.userFinish === 'none') return null;
  const ui = post.seeds.indexOf(core.userId);
  if (ui < 0) return null;
  const n = post.seeds.length;
  const idx = Math.max(0, n - 2 - ui);
  return post.series[idx] ? { s: post.series[idx], idx } : null;
}

/** 시리즈 경기 중 우리 홈 경기 번호 (1부터). 와일드카드 결정전은 최대 2경기 */
function myHomeGames(s: PostSeries, hi: boolean): number[] {
  const def = roundDef(s.round);
  const max = def.hiLead ? s.bestOf - def.hiLead : s.bestOf;
  const out: number[] = [];
  for (let g = 0; g < max; g++) if (def.hiHome.includes(g) === hi) out.push(g + 1);
  return out;
}

/**
 * 첫 상대와 조건 한 줄: "와일드카드 결정전 vs 한강 판다스 · 우리가 1승 안고 시작 · 전부 우리 홈"
 * 상대가 아직 정해지지 않았으면(직행) "플레이오프 직행 · 상대는 준플레이오프 승자"
 */
export function firstMatchLines(core: Pick<Core, 'post' | 'userId' | 'teams'>): { head: string; rule: string[] } | null {
  const f = firstSeries(core);
  if (!f) return null;
  const { s, idx } = f;
  const post = core.post!;
  const hi = s.hiId === core.userId;
  const def = roundDef(s.round);
  const oppId = hi ? s.loId : s.hiId;
  const prev = post.series[idx - 1];
  const opp = oppId ? core.teams.find((t) => t.id === oppId) : undefined;
  const head = oppId ? `${s.name} vs ${opp ? `${opp.city} ${opp.name}` : oppId}` : `${s.name} 직행`;
  const rule: string[] = [];
  if (!oppId && prev) rule.push(`상대는 ${prev.name} 승자`);
  if (def.hiLead) {
    rule.push(hi ? `우리가 ${def.hiLead}승 안고 시작` : `상대가 ${def.hiLead}승 안고 시작`);
    rule.push(hi ? '1승이나 무승부면 통과' : '2연승해야 통과');
  } else rule.push(FORMAT[s.bestOf] ?? `${s.bestOf}전`);
  const home = myHomeGames(s, hi);
  const max = def.hiLead ? s.bestOf - def.hiLead : s.bestOf;
  rule.push(home.length === max ? '전부 우리 홈' : home.length === 0 ? '전부 원정' : `${home.join('·')}차전 우리 홈`);
  return { head, rule };
}

/** 정규시즌 마감 화면의 한 줄: "3년 만의 가을야구" · "2년 연속 가을야구" · "부임 후 첫 가을야구" */
export function autumnStreakLine(core: Pick<Core, 'campaign' | 'season'>): string {
  const prev = (core.campaign.history ?? []).filter((h) => h.season < core.season).sort((a, b) => a.season - b.season);
  let streak = 1;
  for (let i = prev.length - 1; i >= 0 && prev[i].season === core.season - streak && prev[i].post !== 'none'; i--) streak++;
  if (streak >= 2) return `${streak}년 연속 가을야구`;
  const last = [...prev].reverse().find((h) => h.post !== 'none');
  if (last) return `${core.season - last.season}년 만의 가을야구`;
  return '부임 후 첫 가을야구';
}

/** 가을야구에 못 갔을 때: 마지막 진출 팀과의 승차 · 한 칸 차이였는가 */
export function missLine(core: Pick<Core, 'teams' | 'userId'>): { gb: number; text: string; close: boolean } | null {
  const table = standings(core.teams);
  const n = postTeams(core);
  const rank = table.findIndex((t) => t.id === core.userId) + 1;
  if (rank <= n) return null;
  const me = table[rank - 1];
  const gb = Math.max(0, gamesBehind(table[n - 1], me));
  return { gb, text: `가을야구 탈락 — ${table[n - 1].name}에 ${fmtGb(gb)}게임 차`, close: rank === n + 1 };
}

/** 이번 장 깃발이 정규시즌 끝에 정해졌으면 그 결과 (포스트시즌 진출·순위·승수). 아직 가을야구에서 정해질 깃발이면 pending */
export function flagAtSeasonEnd(core: Core): { text: string; state: 'done' | 'failed' | 'pending' } | null {
  const main = core.campaign.objectives?.find((o) => o.main);
  const st = stageOf(core);
  if (!main) return null;
  if (main.kind === 'post') {
    const inPost = !!core.post && core.post.userFinish !== 'none';
    if (!inPost) return { text: main.text, state: 'failed' };
    if (st.main.target <= 1) return { text: main.text, state: 'done' };
    return { text: main.text, state: 'pending' };
  }
  if (main.kind === 'rank' || main.kind === 'wins') {
    return { text: main.text, state: objMet(main.kind, main.target, objValue(core, main.kind)) ? 'done' : 'failed' };
  }
  return null;
}

/**
 * 상단 바의 가을야구 한 줄 (지금 시리즈 · 다음 경기 기준):
 * "와일드카드 결정전 1차전 · 우리 1승 0패(1승 안고 시작)" / "준플레이오프 3차전 · 2승 0패 — 1승 남음"
 */
export function seriesStatus(s: PostSeries, userId: string): string {
  const hi = s.hiId === userId;
  const myW = hi ? s.hiW : s.loW;
  const oppW = hi ? s.loW : s.hiW;
  const def = roundDef(s.round);
  const lead = def.hiLead ?? 0;
  const base = `${myW}승 ${oppW}패`;
  if (lead && s.games.length === 0) return hi ? `우리 ${base}(1승 안고 시작)` : `우리 ${base}(상대가 1승 안고 시작) — 2연승해야 통과`;
  const left = need(s) - myW;
  const edge = need(s) - oppW === 1;
  if (lead && hi) return `${base} — 비기거나 이기면 통과`;
  if (lead) return `${base} — 이겨야 통과 (비기면 탈락)`;
  if (left === 1 && edge) return `${base} — 이기는 팀이 올라간다`;
  if (left === 1) return `${base} — 1승 남음`;
  if (edge) return `${base} — 지면 탈락`;
  return base;
}

/** 시리즈 한 칸: "판다스 2:0 앵커스" (승자 먼저, 와일드카드 결정전은 안고 시작한 1승을 뺀 실제 경기) */
export interface PathStep {
  round: string;
  name: string;
  short: string;
  winner: string;
  loser: string;
  w: number;
  l: number;
  ties: number;
  games: number;
}

/**
 * 상대(teamId)가 가을야구에서 지나온 시리즈들 (끝난 것만, 오래된 것부터).
 * 사다리라서 상대가 하위 시드로 들어온 라운드마다 바로 앞 라운드의 승자다
 */
export function climbPath(core: Pick<Core, 'post' | 'teams'>, teamId: string): PathStep[] {
  const post = core.post;
  if (!post) return [];
  const out: PathStep[] = [];
  for (const s of post.series) {
    if (!s.winnerId || (s.hiId !== teamId && s.loId !== teamId)) continue;
    const lead = roundDef(s.round).hiLead ?? 0;
    const hiW = s.hiW - lead;
    const ties = s.games.filter((g) => g.home === g.away).length;
    const wHi = s.winnerId === s.hiId;
    out.push({
      round: s.round,
      name: s.name,
      short: roundShortName(s.round),
      winner: teamName(core, s.winnerId),
      loser: teamName(core, wHi ? s.loId : s.hiId),
      w: wHi ? hiW : s.loW,
      l: wHi ? s.loW : hiW,
      ties,
      games: s.games.length,
    });
  }
  return out;
}

/** 상대가 어떻게 올라왔는지 한 줄: "판다스 — 와일드카드부터 올라옴 · 가을야구 6경기째" (기다린 팀이면 "듀오스 — 정규시즌 1위로 기다림") */
export function climbLine(core: Pick<Core, 'post' | 'teams'>, teamId: string): string | null {
  const post = core.post;
  if (!post) return null;
  const path = climbPath(core, teamId);
  const t = core.teams.find((x) => x.id === teamId);
  const name = t ? t.name : teamId;
  const seed = post.seeds.indexOf(teamId) + 1;
  if (!path.length) return seed > 0 ? `${name} — 정규시즌 ${seed}위로 기다림` : null;
  const played = post.series.reduce((a, s) => a + s.games.filter((g) => g.homeId === teamId || g.awayId === teamId).length, 0);
  return `${name} — ${path[0].round === 'WC' ? '와일드카드' : path[0].name}부터 올라옴 · 가을야구 ${played + 1}경기째`;
}
