import type { Core } from './types';
import type { LeagueAwards } from './leaders';
import { domePaid, domeStage, giveTotal, projectFx } from './projects';
import { SEAT_LV } from './economy';
import { isFranchise } from './franchise';

/** 명예의 전당: 세이브와 독립된 기록 (localStorage 키 HOF_KEY). 전부 순수 함수 — 읽기·쓰기는 화면 쪽이 한다. */
export const HOF_KEY = 'kbl-hof-v1';

export type HofEnd = 'champion' | 'relocated' | 'abandoned';
export const HOF_END_KO: Record<HofEnd, string> = { champion: '우승 엔딩', relocated: '연고 이전', abandoned: '진행 중 종료' };

export interface HofClub {
  seed: number; // 같은 구단은 한 줄 (우승 엔딩 뒤에 계속하다 끝나면 그 줄을 갱신)
  nick: string;
  seasons: number;
  ranks: number[];
  titles: number;
  stage: number; // 도달한 장 (0-based)
  stars: number; // 모은 별(업적) 수
  end: HofEnd;
  date: string; // YYYY-MM-DD
  tainted?: boolean; // 우승 시즌에 덮었던 일이 드러났다
  give?: number; // 도민 환원 누적 (만원)
  dome?: boolean; // 섬에 돔을 세웠다
  // 구단 종료 시점의 기록 카드 칸 (없으면 카드에 "—")
  star?: string; // 간판스타
  retired?: string[]; // 영구결번
  seats?: string; // 구장 ("24,000석" · "돔구장 30,000석")
  trust?: number; // 도민 지지
}
export interface HofRecord {
  value: number;
  nick: string;
  season: number;
}
export type HofRecordKey = 'wins' | 'pct' | 'avgAtt' | 'profit';
export const HOF_RECORD_KO: Record<HofRecordKey, string> = { wins: '시즌 최다승', pct: '시즌 최고 승률', avgAtt: '최다 평균 관중', profit: '최다 영업 흑자' };
export interface HofPlayer {
  kind: 'retired' | 'mvp' | 'rookie';
  seed: number;
  name: string;
  nick: string;
  season: number;
  note?: string; // 포지션 또는 성적 한 줄
}
export interface Hof {
  v: 1;
  clubs: HofClub[];
  records: Partial<Record<HofRecordKey, HofRecord>>;
  players: HofPlayer[];
}

export const emptyHof = (): Hof => ({ v: 1, clubs: [], records: {}, players: [] });

export function parseHof(raw: string | null | undefined): Hof {
  if (!raw) return emptyHof();
  try {
    const h = JSON.parse(raw) as Partial<Hof>;
    if (!h || h.v !== 1) return emptyHof();
    return { v: 1, clubs: Array.isArray(h.clubs) ? h.clubs : [], records: h.records ?? {}, players: Array.isArray(h.players) ? h.players : [] };
  } catch {
    return emptyHof();
  }
}

export const nickOf = (core: Pick<Core, 'teams' | 'userId'>): string => core.teams.find((t) => t.id === core.userId)?.name ?? '';

/** 기록할 만큼 진행됐는가: 한 시즌 이상 결산을 마쳤다 */
export const hofWorthy = (core: Core): boolean => (core.campaign.history?.length ?? 0) >= 1;

const fmtInt = (v: number) => Math.round(v).toLocaleString('en-US');
/** 기록 카드의 구장 칸: 돔 완공 = "돔구장 30,000석", 착공 뒤 = "돔 공사 중", 그 외 좌석 수 */
export function seatsLabel(core: Pick<Core, 'facilities' | 'campaign' | 'season'>): string {
  const cap = SEAT_LV[core.facilities.seats]?.cap ?? 0;
  const st = domeStage(core);
  if (st >= 3) return `돔구장 ${fmtInt(cap + projectFx(core).seats)}석`;
  return domePaid(core) > 0 ? '돔 공사 중' : `${fmtInt(cap)}석`;
}
/** 기록 카드의 간판스타 칸: 프랜차이즈 스타, 없으면 스타성이 가장 높은 선수 */
export function starName(core: Pick<Core, 'teams' | 'userId' | 'season'>): string | null {
  const roster = [...(core.teams.find((t) => t.id === core.userId)?.roster ?? [])].sort((a, b) => b.star - a.star);
  return (roster.find((p) => isFranchise(p, core.season)) ?? roster[0])?.name ?? null;
}

/** 역대 구단 한 줄을 넣거나(같은 seed 면) 갱신한다 */
export function recordClub(hof: Hof, core: Core, end: HofEnd, date: string): Hof {
  const c = core.campaign;
  const row: HofClub = {
    seed: core.seed,
    nick: nickOf(core),
    seasons: c.history.length,
    ranks: c.history.map((h) => h.rank),
    titles: c.titles,
    stage: c.stage,
    stars: c.achievements.length,
    end,
    date,
    ...(c.history.some((h) => h.tainted) ? { tainted: true } : {}),
    ...(giveTotal(core) > 0 ? { give: giveTotal(core) } : {}),
    ...(domePaid(core) >= 3 ? { dome: true } : {}),
    ...(starName(core) ? { star: starName(core)! } : {}),
    ...((c.retired ?? []).length ? { retired: (c.retired ?? []).map((r) => r.name) } : {}),
    seats: seatsLabel(core),
    trust: Math.round(c.trust),
  };
  const i = hof.clubs.findIndex((x) => x.seed === core.seed);
  const clubs = i >= 0 ? hof.clubs.map((x, j) => (j === i ? row : x)) : [row, ...hof.clubs];
  return { ...hof, clubs: clubs.slice(0, 50) };
}

/** campaign.history 로 시즌 기록 4종을 갱신하고, 영구결번을 옮겨 적는다. 바뀐 게 없으면 같은 객체를 돌려준다 */
export function syncHof(hof: Hof, core: Core): Hof {
  const nick = nickOf(core);
  const records = { ...hof.records };
  let dirty = false;
  const bump = (k: HofRecordKey, value: number, season: number) => {
    if (!Number.isFinite(value) || value <= 0) return;
    const cur = records[k];
    if (cur && cur.value >= value) return;
    records[k] = { value, nick, season };
    dirty = true;
  };
  for (const h of core.campaign.history ?? []) {
    const g = h.w + h.l;
    bump('wins', h.w, h.season);
    if (g > 0) bump('pct', Math.round((h.w / g) * 1000) / 1000, h.season);
    bump('avgAtt', Math.round(h.avgAtt), h.season);
    bump('profit', h.profit, h.season);
  }
  let players = hof.players;
  for (const r of core.campaign.retired ?? []) {
    if (players.some((p) => p.kind === 'retired' && p.seed === core.seed && p.name === r.name)) continue;
    players = [{ kind: 'retired', seed: core.seed, name: r.name, nick, season: r.season, note: r.pos }, ...players];
    dirty = true;
  }
  return dirty ? { ...hof, records, players: players.slice(0, 200) } : hof;
}

/** 결산 시점: 리그 MVP·신인왕이 우리 팀에서 나왔으면 적는다 */
export function recordAwards(hof: Hof, core: Core, awards: Pick<LeagueAwards, 'mvp' | 'rookie'>): Hof {
  const nick = nickOf(core);
  let players = hof.players;
  for (const kind of ['mvp', 'rookie'] as const) {
    const row = awards[kind];
    if (!row || row.teamId !== core.userId) continue;
    if (players.some((p) => p.kind === kind && p.seed === core.seed && p.season === core.season)) continue;
    players = [{ kind, seed: core.seed, name: row.name, nick, season: core.season, note: row.text }, ...players];
  }
  return players === hof.players ? hof : { ...hof, players: players.slice(0, 200) };
}

// ───────── 세이브 내보내기 · 가져오기 ─────────

export const SAVE_VERSION = 3;
const REQUIRED: (keyof Core)[] = ['seed', 'season', 'day', 'phase', 'userId', 'teams', 'schedule', 'freeAgents', 'finance', 'facilities', 'campaign'];

const b64encode = (s: string): string => {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};
const b64decode = (s: string): string => {
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
};

/** 세이브를 압축 없이 base64 텍스트로 */
export function exportSave(core: Core): string {
  return b64encode(JSON.stringify({ app: 'kbl', version: SAVE_VERSION, state: core }));
}

/** 붙여 넣은 텍스트를 검증한다 (버전·필수 필드). 실패하면 사유 */
export function importSave(text: string): { core: Core; version: number } | { error: string } {
  let obj: { app?: string; version?: number; state?: Partial<Core> };
  try {
    obj = JSON.parse(b64decode(text.replace(/\s+/g, '')));
  } catch {
    return { error: '읽을 수 없는 텍스트입니다 (내보낸 글자를 전부 붙여 넣었는지 확인하세요)' };
  }
  if (!obj || obj.app !== 'kbl' || typeof obj.version !== 'number' || !obj.state) return { error: '이 게임의 세이브가 아닙니다' };
  if (obj.version > SAVE_VERSION) return { error: `더 새로운 버전(v${obj.version})의 세이브입니다` };
  const st = obj.state;
  const miss = REQUIRED.filter((k) => st[k] === undefined || st[k] === null);
  if (miss.length) return { error: `세이브가 손상됐습니다 (빠진 항목: ${miss.join(', ')})` };
  if (!Array.isArray(st.teams) || !st.teams.length || !Array.isArray(st.schedule) || !st.teams.some((t) => t.id === st.userId)) return { error: '세이브가 손상됐습니다 (구단 정보)' };
  return { core: st as Core, version: obj.version };
}
