import type { Core, DayReport, Player, SeasonRecord, Team } from './types';

/** 도전과제: 세이브와 독립된 기록 (localStorage 키 ACHV_KEY). 게임 수치에 영향을 주지 않고 관찰만 한다.
 *  전부 순수 함수 — 읽기·쓰기·알림은 화면 쪽(components/achvStore.ts)이 한다. 목록은 achievementList*.ts */
export const ACHV_KEY = 'kbl-achv-v1';

export type AchvCat = 'start' | 'game' | 'season' | 'club' | 'squad' | 'story' | 'odd' | 'total';
export const ACHV_CATS: { id: AchvCat; name: string; icon: string }[] = [
  { id: 'start', name: '첫걸음', icon: '👣' },
  { id: 'game', name: '경기', icon: '⚾' },
  { id: 'season', name: '시즌', icon: '📅' },
  { id: 'club', name: '구단 경영', icon: '🏟️' },
  { id: 'squad', name: '선수단', icon: '🧢' },
  { id: 'story', name: '이야기', icon: '📖' },
  { id: 'odd', name: '기행', icon: '🤪' },
  { id: 'total', name: '누적', icon: '🧮' },
];

/** 판정을 돌리는 사건 종류. 상태가 바뀔 때마다 전부 돌지 않고, 일어난 사건에 묶인 것만 본다 */
export type AchvOn =
  | 'game' // 경기 직후 (경기마다 한 번, ctx.r 이 그 경기)
  | 'season' // 시즌 결산 (ctx.rec 이 방금 적힌 시즌 기록)
  | 'event' // 사건 카드 선택 (ctx.card 가 처리한 카드)
  | 'squad' // 영입·방출·트레이드·콜업·말소·편성
  | 'draft' // 지명 · 드래프트 종료
  | 'story' // 장·별·지지·프로젝트·엔딩·연고 이전 등 캠페인 값의 변화
  | 'manage' // 현금·부채·시설·티켓값
  | 'total'; // 누적 카운터

export interface AchvSave {
  v: 1;
  done: Record<string, string>; // 달성한 id → 달성 날짜 (YYYY-MM-DD)
  totals: Record<string, number>; // 여러 구단에 걸쳐 쌓이는 값 (TOTAL_KEYS)
}
export const emptyAchv = (): AchvSave => ({ v: 1, done: {}, totals: {} });
export function parseAchv(raw: string | null | undefined): AchvSave {
  if (!raw) return emptyAchv();
  try {
    const a = JSON.parse(raw) as Partial<AchvSave>;
    if (!a || a.v !== 1) return emptyAchv();
    return { v: 1, done: a.done && typeof a.done === 'object' ? a.done : {}, totals: a.totals && typeof a.totals === 'object' ? a.totals : {} };
  } catch {
    return emptyAchv();
  }
}

/** 누적 카운터 이름 */
export type TotalKey =
  | 'games' | 'wins' | 'losses' | 'ties' | 'hr' | 'runs' | 'so' | 'errs' | 'walkoffs' | 'shutouts' | 'sellouts' | 'att' | 'postWins'
  | 'seasons' | 'posts' | 'titles' | 'flags' | 'stars' | 'clubs' | 'moved' | 'signs' | 'releases' | 'trades' | 'picks' | 'cards' | 'ups' | 'upgrades' | 'retired';

/** 판정에 넘기는 값. 사건에 따라 r·rec·card 가 채워진다 */
export interface AchvCtx {
  core: Core; // 지금 상태
  prev: Core | null; // 직전 상태 (같은 구단일 때만. 불러오기·새 게임 직후에는 null)
  t: Team; // 유저 구단
  r: DayReport | null; // 'game'
  rec: SeasonRecord | null; // 'season'
  card: { id: string; pid?: string } | null; // 'event': 방금 처리한 카드 (id 는 '|' 앞부분)
  signed: Player[]; // 이번 변화에 FA 에서 온 선수
  released: Player[]; // FA 로 나간 선수
  tradedIn: Player[]; // 다른 구단에서 온 선수
  tradedOut: Player[]; // 다른 구단으로 간 선수
  calledUp: Player[]; // 직접 올린 선수 (경기 진행 중의 자동 이동 제외)
  sentDown: Player[];
  picked: Player[]; // 이번에 지명한 신인
  quiet: boolean; // 경기·사건 카드 없이 유저가 직접 손댄 변화 (같은 경기일 안)
  tot: Record<string, number>; // 누적 카운터 (이번 변화까지 더한 값)
}

export interface AchvDef {
  id: string;
  cat: AchvCat;
  title: string;
  desc: string; // 조건을 숫자로
  icon: string;
  tier: 1 | 2 | 3 | 4; // 1 쉬움 ~ 4 매우 어려움
  on: AchvOn[];
  test: (x: AchvCtx) => boolean;
  hidden?: string; // 숨김: 달성 전에는 제목 "???" 와 이 힌트 한 줄만
  progress?: (x: Pick<AchvCtx, 'core' | 't' | 'tot'>) => [number, number]; // [지금, 목표]
}

export const userOf = (c: Core): Team => c.teams.find((t) => t.id === c.userId) ?? c.teams[0];
const idsOf = (ps: Player[]): Set<string> => new Set(ps.map((p) => p.id));
export const lineupKey = (t: Team): string => `${t.lineup.map((l) => l.pid + l.pos).join(',')}|${t.rotation.join(',')}|${t.bullpen.join(',')}|${t.closer}`;
const squadKey = (t: Team): string => t.roster.map((p) => `${p.id}${p.farm ? 'f' : ''}`).join(',');
const storyKey = (c: Core): string => {
  const k = c.campaign;
  return [c.phase, k.stage, k.trust, k.achievements.length, k.titles, k.ending, k.dealt, k.analyst, k.ethics, k.bailout, k.exposed, k.secrets?.length, k.retired?.length, k.alumni?.length, JSON.stringify(k.projects ?? {}), k.farmAuto, k.subAuto, k.penStyle, k.briefMemo?.done.length, k.block?.length, c.fans, Math.round(c.fanSat)].join('/');
};
const manageKey = (c: Core): string => [c.finance.cash, c.finance.debt, c.finance.ticketPrice, c.facilities.seats, c.facilities.food, c.facilities.training].join('/');

/** 직전 상태와 비교해 일어난 사건과 판정 재료를 뽑는다 */
function diff(prev: Core | null, core: Core, tot: Record<string, number>): { on: Set<AchvOn>; x: AchvCtx } {
  const t = userOf(core);
  const x: AchvCtx = { core, prev, t, r: null, rec: null, card: null, signed: [], released: [], tradedIn: [], tradedOut: [], calledUp: [], sentDown: [], picked: [], quiet: false, tot };
  const on = new Set<AchvOn>();
  if (!prev) {
    // 불러온 세이브·첫 실행: 지금 상태만으로 판정되는 것을 한 번 훑는다
    on.add('squad').add('story').add('manage').add('total');
    return { on, x };
  }
  const pt = userOf(prev);
  const sameDay = prev.season === core.season && prev.day === core.day && prev.phase === core.phase;
  if (prev.season === core.season && squadKey(pt) !== squadKey(t)) {
    const was = new Map(pt.roster.map((p) => [p.id, p]));
    const now = idsOf(t.roster);
    const faWas = idsOf(prev.freeAgents);
    const faNow = idsOf(core.freeAgents);
    const draftWas = idsOf(prev.draft?.pool ?? []);
    for (const p of t.roster) {
      const o = was.get(p.id);
      if (!o) {
        if (faWas.has(p.id)) x.signed.push(p);
        else if (draftWas.has(p.id)) x.picked.push(p);
        else if (prev.teams.some((ot) => ot.id !== prev.userId && ot.roster.some((q) => q.id === p.id))) x.tradedIn.push(p);
      } else if (sameDay && !prev.campaign.event) {
        if (o.farm && !p.farm) x.calledUp.push(p);
        else if (!o.farm && p.farm) x.sentDown.push(p);
      }
    }
    for (const p of pt.roster) {
      if (now.has(p.id)) continue;
      if (faNow.has(p.id)) x.released.push(p);
      else if (core.teams.some((ot) => ot.id !== core.userId && ot.roster.some((q) => q.id === p.id))) x.tradedOut.push(p);
    }
    on.add('squad');
    if (x.picked.length) on.add('draft');
  } else if (lineupKey(pt) !== lineupKey(t)) on.add('squad');
  if (prev.phase === 'draft' && core.phase !== 'draft') on.add('draft').add('squad');
  if (prev.campaign.event && prev.campaign.event !== core.campaign.event && prev.campaign.event.id !== core.campaign.event?.id) {
    x.card = { id: prev.campaign.event.id.split('|')[0], pid: prev.campaign.event.pid };
    on.add('event');
  }
  if (core.campaign.history.length > prev.campaign.history.length) {
    x.rec = core.campaign.history[core.campaign.history.length - 1];
    on.add('season');
  }
  x.quiet = sameDay && !x.card && !x.rec;
  if (storyKey(prev) !== storyKey(core)) on.add('story');
  if (manageKey(prev) !== manageKey(core)) on.add('manage');
  return { on, x };
}

const add = (tot: Record<string, number>, k: TotalKey, n = 1): void => {
  if (n) tot[k] = (tot[k] ?? 0) + n;
};

/** 한 경기의 유저 쪽 숫자 */
export interface GameView {
  my: number; // 우리 득점
  opp: number;
  side: 0 | 1; // 우리가 원정(0)인지 홈(1)인지
  myLine: number[];
  oppLine: number[];
  myHits: number;
  oppHits: number;
  myErrs: number; // 우리 야수의 실책
  oppErrs: number;
  bat: NonNullable<DayReport['result']['box']>[0]['bat']; // 우리 타자 기록 (없으면 빈 배열)
  pit: NonNullable<DayReport['result']['box']>[0]['pit'];
  maxBehind: number; // 이닝이 끝난 시점 기준으로 가장 크게 뒤졌던 점수 차
  maxAhead: number;
  walkoff: boolean; // 홈에서 9회 이후 마지막 공격으로 이겼다
}
export function gameView(r: DayReport): GameView {
  const g = r.result;
  const side = r.isHome ? 1 : 0;
  const my = r.isHome ? g.home : g.away;
  const opp = r.isHome ? g.away : g.home;
  const myLine = g.line[side] ?? [];
  const oppLine = g.line[1 - side] ?? [];
  let a = 0;
  let h = 0;
  let maxBehind = 0;
  let maxAhead = 0;
  let hBeforeLast = 0;
  let aBeforeLast = 0;
  for (let i = 0; i < Math.max(g.line[0].length, g.line[1].length); i++) {
    for (const half of [0, 1] as const) {
      if (i === g.line[1].length - 1 && half === 1) {
        hBeforeLast = h;
        aBeforeLast = a;
      }
      const v = g.line[half][i];
      if (v === undefined) continue;
      if (half === 0) a += v;
      else h += v;
      const d = side === 1 ? h - a : a - h;
      maxBehind = Math.max(maxBehind, -d);
      maxAhead = Math.max(maxAhead, d);
    }
  }
  const walkoff = r.isHome && g.home > g.away && g.innings >= 9 && g.line[1].length === g.innings && hBeforeLast <= aBeforeLast;
  return {
    my, opp, side, myLine, oppLine,
    myHits: g.hits[side], oppHits: g.hits[1 - side],
    myErrs: g.errs?.[side]?.length ?? 0, oppErrs: g.errs?.[1 - side]?.length ?? 0,
    bat: g.box?.[side]?.bat ?? [], pit: g.box?.[side]?.pit ?? [],
    maxBehind, maxAhead, walkoff,
  };
}

/** 이번 변화가 누적 카운터에 더하는 값 (mutate tot) */
function count(tot: Record<string, number>, x: AchvCtx, on: Set<AchvOn>, reports: DayReport[]): void {
  const { core, prev } = x;
  if (!prev) return;
  for (const r of reports) {
    const v = gameView(r);
    add(tot, 'games');
    add(tot, r.won === null ? 'ties' : r.won ? 'wins' : 'losses');
    add(tot, 'runs', v.my);
    add(tot, 'hr', v.bat.reduce((s, b) => s + b.hr, 0));
    add(tot, 'so', v.pit.reduce((s, p) => s + p.so, 0));
    add(tot, 'errs', v.myErrs);
    if (r.won && v.walkoff) add(tot, 'walkoffs');
    if (r.won && v.opp === 0) add(tot, 'shutouts');
    if (r.crowd) add(tot, 'att', r.crowd.attendance);
    if (r.crowd?.soldOut) add(tot, 'sellouts');
    if (r.post && r.won) add(tot, 'postWins');
  }
  if (x.rec) {
    add(tot, 'seasons');
    if (x.rec.post !== 'none') add(tot, 'posts');
    if (x.rec.post === 'champion') add(tot, 'titles');
    if (x.rec.cleared) add(tot, 'flags');
  }
  add(tot, 'stars', Math.max(0, core.campaign.achievements.length - prev.campaign.achievements.length));
  if (core.phase === 'over' && prev.phase !== 'over') add(tot, 'moved');
  add(tot, 'signs', x.signed.length);
  add(tot, 'releases', x.released.length);
  add(tot, 'trades', x.tradedIn.length || x.tradedOut.length ? 1 : 0);
  add(tot, 'picks', x.picked.length);
  add(tot, 'ups', x.calledUp.length);
  if (x.card) add(tot, 'cards');
  const f = core.facilities;
  const pf = prev.facilities;
  if (prev.season === core.season) add(tot, 'upgrades', Math.max(0, f.seats + f.food + f.training - pf.seats - pf.food - pf.training));
  add(tot, 'retired', Math.max(0, (core.campaign.retired?.length ?? 0) - (prev.campaign.retired?.length ?? 0)));
  void on;
}

export interface AchvStep {
  save: AchvSave; // 바뀐 것이 없으면 넘겨받은 객체 그대로
  gained: string[]; // 이번에 달성한 id (정의 순서)
  errors: { id: string; error: string }[]; // 판정 중 예외 (그 도전과제는 실패로 취급)
}

/** 상태 변화 한 번을 본다. prev0 가 다른 구단(시드가 다르거나 시즌이 되돌아감)이면 새 구단으로 친다.
 *  reports = 이 변화에 새로 끝난 경기들 (없으면 빈 배열). date = 달성 날짜로 적을 값 */
export function achvStep(defs: AchvDef[], save: AchvSave, prev0: Core | null, core: Core, reports: DayReport[], date: string): AchvStep {
  const fresh = !!prev0 && (prev0.seed !== core.seed || core.season < prev0.season || (core.season === prev0.season && core.phase === 'season' && prev0.phase === 'season' && core.day < prev0.day));
  const prev = fresh ? null : prev0;
  const tot = { ...save.totals };
  const { on, x } = diff(prev, core, tot);
  // 새 구단: 부임 직후(1시즌 0일)에만 센다 — 세이브 불러오기는 세지 않는다
  if (fresh && core.season === 1 && core.day === 0 && core.campaign.history.length === 0) add(tot, 'clubs');
  if (reports.length) on.add('game');
  if (reports.length) x.quiet = false;
  count(tot, x, on, reports);
  let totalsChanged = false;
  for (const k in tot) if (tot[k] !== save.totals[k]) totalsChanged = true;
  if (totalsChanged) on.add('total');
  if (!on.size) return { save, gained: [], errors: [] };

  const gained: string[] = [];
  const errors: AchvStep['errors'] = [];
  const done = save.done;
  for (const d of defs) {
    if (done[d.id] || !d.on.some((k) => on.has(k))) continue;
    try {
      let ok = false;
      if (d.on.includes('game') && reports.length) {
        for (const r of reports) {
          x.r = r;
          if (d.test(x)) {
            ok = true;
            break;
          }
        }
        x.r = null;
      }
      // 경기 말고 다른 사건에도 묶인 것은 경기 없이 한 번 더 본다
      if (!ok && d.on.some((k) => k !== 'game' && on.has(k))) ok = d.test(x);
      if (ok) gained.push(d.id);
    } catch (e) {
      x.r = null;
      errors.push({ id: d.id, error: e instanceof Error ? e.message : String(e) });
    }
  }
  if (!gained.length && !totalsChanged) return { save, gained, errors };
  const next: AchvSave = { v: 1, done: gained.length ? { ...done } : done, totals: totalsChanged ? tot : save.totals };
  for (const id of gained) next.done[id] = date;
  return { save: next, gained, errors };
}

/** 진행 막대 값. 판정 함수가 던지면 null */
export function achvProgress(d: AchvDef, core: Core, totals: Record<string, number>): [number, number] | null {
  if (!d.progress) return null;
  try {
    const [a, b] = d.progress({ core, t: userOf(core), tot: totals });
    return [Math.max(0, Math.min(a, b)), b];
  } catch {
    return null;
  }
}

/** 목록 점검: 중복 id·제목, 빈 문구 (scripts/achv.ts 와 화면이 함께 쓴다) */
export function achvLint(defs: AchvDef[]): string[] {
  const bad: string[] = [];
  const ids = new Set<string>();
  const titles = new Set<string>();
  for (const d of defs) {
    if (ids.has(d.id)) bad.push(`중복 id: ${d.id}`);
    if (titles.has(d.title)) bad.push(`중복 제목: ${d.title}`);
    ids.add(d.id);
    titles.add(d.title);
    if (!d.title || !d.desc || !d.icon || !d.on.length) bad.push(`빈 칸: ${d.id}`);
  }
  return bad;
}
