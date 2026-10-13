// 캠페인 「제주의 기적」: 장(스테이지)·깃발·별·결산·버프 해석. docs/LEVEL_DESIGN.md 2·7절.
// 시즌 대본(일정 배치·구간 효과)은 script.ts, 이벤트 카드는 events.ts, 대사·문구는 story.ts.
import type { Buff, CharId, Core, DayReport, HintTab, ObjKind, Objective, Player, PostFinish, SeasonRecord, SeasonVerdict, StadiumScene, Team } from './types';
import { clamp, type Rng } from './rng';
import { luxTax, opProfit, payroll, userTeam } from './economy';
import { fmtInt, fmtMoney } from './format';
import { addNews, rankOf, seasonAwards } from './season';
import { memoGet, memoNum, memoSet } from './memo';
import { ENDING, NEWS, TRUST_LABEL, endingText, nameSeason, verdictLine, withTeam } from './story';
import { beatById, startSeasonScriptMut, userHomeDays } from './script';
import { exposeMut } from './scandal';

// ───────── 튜닝 테이블 ─────────

export const TRUST_START = 60;
export const TRUST_MAX = 100;
export const STAR_TRUST = 5; // 별 1개당 도민 지지
export const MAX_JUMP = 2; // 월반 포함 한 번에 오를 수 있는 최대 장 수
export const STOP_INJ_GAP = 3; // 부상으로 일괄 진행을 멈춘 뒤 이 경기 수 안에는 부상으로 다시 멈추지 않는다
export const DYNASTY_FAIL_TRUST = 10; // 왕조(5장): 우승 엔딩을 본 뒤에는 깃발 실패의 벌이 가볍다
export const MID_FAIL_TRUST = 5; // 중간 점검에서 출자를 받고 깃발 실패 시 추가 감소
export const MID_UP_FAIL_TRUST = 12; // 목표 상향을 약속하고 깃발 실패 시 추가 감소
export const MID_UP_MULT = 2; // 목표 상향 약속 성공 시 깃발 지원금 배율
// 포스트시즌 배당금 (유저 최종 도달 지점별, ledger.league 합산)
export const POST_DIVIDEND: Record<PostFinish, number> = { none: 0, SPO: 30000, PO: 60000, KS: 120000, champion: 250000 };
export const POST_LEVEL: Record<PostFinish, number> = { none: 0, SPO: 1, PO: 2, KS: 3, champion: 4 };
// 깃발은 놓쳤어도 가을야구를 한 시즌은 섬이 덜 등을 돌린다 (깃발 실패 감소분을 이만큼 덜어 준다)
export const POST_CONSOLE: Record<PostFinish, number> = { none: 0, SPO: 5, PO: 8, KS: 12, champion: 12 };
export const DRAFT_PREFIX = 'dr'; // 드래프트 출신 선수 id 접두 (draft.ts 의 DRAFT_ID_PREFIX 와 같다)

interface ObjSpec {
  kind: ObjKind; // 깃발은 kind 로 판정. 별은 표시 방향(이상/이하)만 kind 를 따르고 판정은 STAR_EVAL[id]
  target: number;
  text?: string;
}

export interface StageDef {
  name: string;
  desc: string; // 장 설명 (주제 동사는 말하지 않는다)
  who: CharId[]; // 이 장의 인물
  main: ObjSpec; // 깃발
  stars: [ObjSpec, ObjSpec, ObjSpec]; // 고정 별 3개 — id 는 "s<stage>-<n>"
  reward: { cash: number; trust: number };
  failTrust: number; // 깃발 실패 시 도민 지지 감소(양수)
  starCash: number; // 별 1개 현금 보상
  midCash: number; // 중간 점검 조합원 특별 출자
  ending?: boolean;
}

export const STAGES: StageDef[] = [
  {
    name: '고장 난 팀',
    desc: '전임 체제가 남긴 팀. 꼴찌에서 한 칸만 올라서도 섬이 달라진다.',
    who: ['manager', 'scout'],
    main: { kind: 'rank', target: 7 },
    stars: [
      { kind: 'wins', target: 450, text: '승률 .450 이상' },
      { kind: 'star', target: 58, text: '주전 타자 9명 전원 오버롤 58 이상' },
      { kind: 'debt', target: 50000, text: '연봉 총액 증가 5억 이내로 깃발 달성' },
    ],
    reward: { cash: 80000, trust: 15 },
    failTrust: 15,
    starCash: 15000,
    midCash: 20000,
  },
  {
    name: '돌아온 관중',
    desc: '달라진 팀을 보러 사람들이 돌아온다. 그들을 담을 그릇이 필요하다.',
    who: ['marketing'],
    main: { kind: 'avgAtt', target: 7000 },
    stars: [
      { kind: 'sellouts', target: 15, text: '매진 15회' },
      { kind: 'avgAtt', target: 6500, text: '장마 구간 홈 평균 관중 6,500명' },
      { kind: 'profit', target: 100000, text: '영업 흑자 10억' },
    ],
    reward: { cash: 120000, trust: 15 },
    failTrust: 20,
    starCash: 20000,
    midCash: 30000,
  },
  {
    name: '가을야구',
    desc: '제주에 가을야구를. 올해의 승리와 내년의 얼굴 사이에서.',
    who: ['farm'],
    main: { kind: 'post', target: 1 },
    stars: [
      { kind: 'sellouts', target: 7, text: '25세 이하 주전 7명' },
      { kind: 'sellouts', target: 70, text: '시즌 훈련 성장 70회' },
      { kind: 'sellouts', target: 3, text: '드래프트 출신 주력 3명 (260타석·90이닝)' },
    ],
    reward: { cash: 200000, trust: 15 },
    failTrust: 20,
    starCash: 25000,
    midCash: 40000,
  },
  {
    name: '한국시리즈로',
    desc: '가을의 끝까지. 긴 시리즈는 마운드가 버텨야 닿는다.',
    who: ['pitching'],
    main: { kind: 'post', target: 3 },
    stars: [
      { kind: 'rank', target: 2, text: '팀 평균자책점 리그 2위 이내' },
      { kind: 'sellouts', target: 20, text: '20세이브 마무리' },
      { kind: 'debt', target: 0, text: '포스트시즌 연투 패전 0' },
    ],
    reward: { cash: 300000, trust: 15 },
    failTrust: 20,
    starCash: 30000,
    midCash: 50000,
  },
  {
    name: '제주의 기적',
    desc: '바랜 깃발 옆에 새 깃발을. 그리고 육지에서 온 손님.',
    who: ['suitor', 'chair'],
    main: { kind: 'post', target: 4 },
    stars: [
      { kind: 'rank', target: 1, text: '정규시즌 1위' },
      { kind: 'avgAtt', target: 18000, text: '홈 평균 관중 18,000명' },
      { kind: 'debt', target: 0, text: '시즌 종료 시 무차입' },
    ],
    reward: { cash: 500000, trust: 20 },
    failTrust: 20,
    starCash: 40000,
    midCash: 60000,
    ending: true,
  },
  {
    name: '왕조',
    desc: '정상을 지켜라 — 끝없는 도전.',
    who: ['chair'],
    main: { kind: 'post', target: 1 },
    stars: [
      { kind: 'post', target: 4, text: '한국시리즈 우승' },
      { kind: 'profit', target: 300000, text: '영업 흑자 30억' },
      { kind: 'avgAtt', target: 20000, text: '홈 평균 관중 20,000명' },
    ],
    reward: { cash: 60000, trust: 10 }, // 15억 → 6억: 시설을 다 올린 뒤의 지원금은 쓸 곳이 없어 현금만 쌓였다 (감사: 시즌 12 평균 164억)
    failTrust: DYNASTY_FAIL_TRUST,
    starCash: 30000,
    midCash: 40000,
  },
];

const POST_TEXT = ['', '포스트시즌 진출', '플레이오프 진출', '한국시리즈 진출', '한국시리즈 우승'];

export function objText(kind: ObjKind, t: number): string {
  switch (kind) {
    case 'rank':
      return `정규시즌 ${t}위 이내`;
    case 'wins':
      return `정규시즌 ${t}승 이상`;
    case 'avgAtt':
      return `홈 평균 관중 ${fmtInt(t)}명`;
    case 'sellouts':
      return `매진 ${t}회`;
    case 'profit':
      return t <= 1 ? '영업 흑자' : `영업손익 +${fmtMoney(t)}`;
    case 'fans':
      return `팬 ${fmtInt(t)}명`;
    case 'facility':
      return `시설 레벨 합 ${t} 이상`;
    case 'star':
      return `스타성 ${t}+ 선수 보유`;
    case 'post':
      return POST_TEXT[t] ?? '포스트시즌';
    case 'debt':
      return t <= 0 ? '시즌 종료 시 무차입' : `부채 ${fmtMoney(t)} 이하`;
  }
}

// ───────── 탭 배지 (4절) ─────────

const HINT_MAX = 9;

/** 관련 상황이 생긴 탭에 숫자 배지를 올린다 (mutate). 지우는 건 store.clearHint */
export function hintMut(core: Core, tab: HintTab, n = 1): void {
  const c = core.campaign;
  c.hints = c.hints ?? {};
  c.hints[tab] = Math.min(HINT_MAX, (c.hints[tab] ?? 0) + n);
}

// ───────── 버프 해석 (Buff.kind 의 의미는 여기서만 정의) ─────────

export interface BuffEffect {
  demand: number; // 관중 수요 배율
  capacity: number; // 수용 인원 배율
  merch: number; // 굿즈 배율
  food: number; // 매점 배율
  ticket: number; // 입장 수입 배율 (정산만)
  price: number; // 수요 계산용 체감 가격 배율
  focus: number; // 유저 선수 능력치 가감 (경기 시뮬 중에만)
  upkeep: number; // 홈경기 유지비 가산 (만원)
  youth: number; // 다음 드래프트 풀 품질 가산
  fixedPid: string | null; // 고정 출전 선수 (첫 번째)
  fixed: string[]; // 고정 출전 선수 전부
  rest: string[]; // 휴식 보장 투수 (등판 불가)
  slump: Record<string, number>; // 선수별 능력치 가감 (경기 시뮬 중에만)
  list: Buff[];
}

export function buffActive(b: Buff, day: number): boolean {
  if (b.left !== undefined) return b.left > 0;
  return day < b.until;
}

export function activeBuffs(core: Core): BuffEffect {
  const e: BuffEffect = {
    demand: 1, capacity: 1, merch: 1, food: 1, ticket: 1, price: 1, focus: 0, upkeep: 0, youth: 0,
    fixedPid: null, fixed: [], rest: [], slump: {}, list: [],
  };
  const bs = core.campaign?.buffs ?? [];
  for (const b of bs) {
    if (!buffActive(b, core.day)) continue;
    e.list.push(b);
    switch (b.kind) {
      case 'demand':
        e.demand *= b.value;
        if (b.pid) e.fixed.push(b.pid);
        break;
      case 'capacity':
        e.capacity *= b.value;
        break;
      case 'merch':
        e.merch *= b.value;
        break;
      case 'food':
        e.food *= b.value;
        break;
      case 'ticket':
        e.ticket *= b.value;
        break;
      case 'halfPrice':
        e.ticket *= b.value;
        e.price *= b.value;
        break;
      case 'focus':
        e.focus += b.value;
        break;
      case 'upkeep':
        e.upkeep += b.value;
        break;
      case 'youth':
        e.youth += b.value;
        break;
      case 'fixed':
        if (b.pid) e.fixed.push(b.pid);
        break;
      case 'rest':
        if (b.pid) e.rest.push(b.pid);
        break;
      case 'slump':
        if (b.pid) e.slump[b.pid] = (e.slump[b.pid] ?? 0) + b.value;
        break;
    }
  }
  e.fixedPid = e.fixed[0] ?? null;
  return e;
}

/** 경기 후 버프 만료 처리 (mutate). 홈경기였으면 left 를 1 줄인다. */
export function tickBuffs(core: Core, wasHome: boolean): void {
  const c = core.campaign;
  for (const b of c.buffs) if (wasHome && b.left !== undefined && b.left > 0) b.left--;
  for (const b of c.buffs) if (b.pid && (b.kind === 'fixed' || b.kind === 'demand') && !buffActive(b, core.day)) unfixMut(core, b.pid);
  c.buffs = c.buffs.filter((b) => b.kind === 'youth' || buffActive(b, core.day));
}

/** 고정 출전이 끝나면 그 선수에게 밀려났던 주전이 제자리로 돌아온다 (mutate). 밀려난 선수는 메모 `fx-<pid>` 에 있다. */
export function unfixMut(core: Core, pid: string): void {
  const outId = memoGet(core, `fx-${pid}`);
  if (!outId) return;
  memoSet(core, `fx-${pid}`, '');
  const t = userTeam(core);
  const slot = t.lineup.find((s) => s.pid === pid);
  const out = t.roster.find((p) => p.id === outId);
  if (!slot || !out || out.kind !== 'B' || t.lineup.some((s) => s.pid === outId)) return;
  slot.pid = outId;
  addNews(core, `고정 출전이 끝나 ${out.name}이(가) 선발 명단에 돌아왔습니다`, 'info');
  hintMut(core, 'lineup');
}

// ───────── 지표 ─────────

export function stageOf(core: Core): StageDef {
  return STAGES[clamp(core.campaign.stage, 0, STAGES.length - 1)];
}

export function postLevel(core: Core): number {
  return core.post ? POST_LEVEL[core.post.userFinish] : 0;
}

function avgAtt(core: Core): number {
  const a = core.attHistory;
  return a.length ? Math.round(a.reduce((s, v) => s + v, 0) / a.length) : 0;
}

/** 장마 구간의 홈 평균 관중 (구간이 없거나 아직 홈경기가 없으면 null) */
export function rainyAvgAtt(core: Core): number | null {
  const b = beatById(core, 'rainy');
  if (!b) return null;
  const xs = userHomeDays(core)
    .map((day, i) => ({ day, att: core.attHistory[i] }))
    .filter((x) => x.att !== undefined && x.day >= b.from && x.day <= b.to)
    .map((x) => x.att);
  return xs.length ? Math.round(xs.reduce((s, v) => s + v, 0) / xs.length) : null;
}

const starters = (t: Team): Player[] => {
  const ids = new Set([...t.lineup.map((s) => s.pid), ...t.rotation, ...(t.closer ? [t.closer] : [])]);
  return t.roster.filter((p) => ids.has(p.id));
};

/** 팀 평균자책 순위 (1 = 최저) */
export function eraRank(core: Core): number {
  const era = (t: Team) => {
    const outs = t.roster.reduce((s, p) => s + p.pit.outs, 0);
    return outs > 0 ? (t.roster.reduce((s, p) => s + p.pit.er, 0) * 27) / outs : 99;
  };
  const mine = era(userTeam(core));
  return 1 + core.teams.filter((t) => t.id !== core.userId && era(t) < mine).length;
}

/** 깃발(kind 기반) 지표 값 */
export function objValue(core: Core, kind: ObjKind): number {
  const t = userTeam(core);
  switch (kind) {
    case 'rank':
      return rankOf(core.teams, core.userId);
    case 'wins':
      return t.rec.w;
    case 'avgAtt':
      return avgAtt(core);
    case 'sellouts':
      return core.campaign.sellouts;
    case 'profit':
      return opProfit(core.finance.ledger);
    case 'fans':
      return core.fans;
    case 'facility':
      return core.facilities.seats + core.facilities.food + core.facilities.training;
    case 'star':
      return t.roster.reduce((m, p) => Math.max(m, p.star), 0);
    case 'post':
      return postLevel(core);
    case 'debt':
      return core.finance.debt;
  }
}

/** kind 의 방향: rank·debt 는 "이하", 나머지는 "이상" */
export function objMet(kind: ObjKind, target: number, value: number): boolean {
  if (kind === 'rank' || kind === 'debt') return value <= target;
  return value >= target;
}

interface StarEval {
  value: (core: Core) => number;
  needFlag?: boolean; // 깃발을 달성해야 인정
  needPost?: boolean; // 포스트시즌에 나가야 인정
}

/** 별 조건 평가기. ObjKind 로 표현 안 되는 조건은 Objective.id 로 분기한다. */
export const STAR_EVAL: Record<string, StarEval> = {
  // 0장
  's0-1': { value: (c) => { const r = userTeam(c).rec; return r.w + r.l > 0 ? Math.round((r.w / (r.w + r.l)) * 1000) : 0; } },
  's0-2': { value: (c) => { const t = userTeam(c); const ids = new Set(t.lineup.map((s) => s.pid)); return t.roster.filter((p) => ids.has(p.id)).reduce((m, p) => Math.min(m, p.ovr), 99); } },
  's0-3': { value: (c) => Math.max(0, payroll(userTeam(c)) - memoNum(c, 'pay0', payroll(userTeam(c)))), needFlag: true },
  // 1장
  's1-1': { value: (c) => c.campaign.sellouts },
  's1-2': { value: (c) => rainyAvgAtt(c) ?? 0 },
  's1-3': { value: (c) => opProfit(c.finance.ledger) },
  // 2장
  's2-1': { value: (c) => starters(userTeam(c)).filter((p) => p.age <= 25).length },
  's2-2': { value: (c) => memoNum(c, 'grow') },
  's2-3': { value: (c) => userTeam(c).roster.filter((p) => p.id.startsWith(DRAFT_PREFIX) && (p.bat.pa >= 260 || p.pit.outs >= 270)).length },
  // 3장
  's3-1': { value: (c) => eraRank(c) },
  's3-2': { value: (c) => userTeam(c).roster.reduce((m, p) => Math.max(m, p.pit.sv), 0) },
  's3-3': { value: (c) => memoNum(c, 'b2bLoss'), needPost: true },
  // 4장
  's4-1': { value: (c) => rankOf(c.teams, c.userId) },
  's4-2': { value: (c) => avgAtt(c) },
  's4-3': { value: (c) => c.finance.debt },
  // 5장
  's5-1': { value: (c) => postLevel(c) },
  's5-2': { value: (c) => opProfit(c.finance.ledger) },
  's5-3': { value: (c) => avgAtt(c) },
};

/** 목표의 현재 값 (별은 평가기, 깃발은 kind) */
export function objectiveValue(core: Core, o: Pick<Objective, 'id' | 'kind'>): number {
  const ev = STAR_EVAL[o.id];
  return ev ? ev.value(core) : objValue(core, o.kind);
}

// ───────── 목표 표시 (UI 는 이것만 쓴다) ─────────

export const MIN_GAMES_RANKED = 12; // 순위·승률류는 이 경기 수 전에는 진행을 표시하지 않는다

type ObjUnit = 'rank' | 'pct' | 'ovr' | 'payUp' | 'att' | 'rainAtt' | 'money' | 'debt' | 'post' | 'losses' | 'times' | 'people' | 'saves' | 'fans' | 'level' | 'wins';

// 별은 id 로, 깃발은 kind 로 표시 단위를 정한다
const STAR_UNIT: Record<string, ObjUnit> = {
  's0-1': 'pct', 's0-2': 'ovr', 's0-3': 'payUp',
  's1-1': 'times', 's1-2': 'rainAtt', 's1-3': 'money',
  's2-1': 'people', 's2-2': 'times', 's2-3': 'people',
  's3-1': 'rank', 's3-2': 'saves', 's3-3': 'losses',
  's4-1': 'rank', 's4-2': 'att', 's4-3': 'debt',
  's5-1': 'post', 's5-2': 'money', 's5-3': 'att',
};
const KIND_UNIT: Record<ObjKind, ObjUnit> = {
  rank: 'rank', wins: 'wins', avgAtt: 'att', sellouts: 'times', profit: 'money', fans: 'fans', facility: 'level', star: 'ovr', post: 'post', debt: 'debt',
};
const POST_SHORT = ['–', '준PO', 'PO', '한국시리즈', '우승'];
const fmtPct = (v: number) => `.${String(clamp(Math.round(v), 0, 999)).padStart(3, '0')}`;

export interface ObjDisplay {
  cur: string; // 현재 값 ("—" = 아직 판단할 수 없음)
  target: string; // 목표 값
  ratio: number; // 진행 막대 0~1
  met: boolean; // 결산 전: 지금 조건을 충족 중 / 결산 후: 달성
}

/** 목표 한 줄의 표시값. 판정(STAR_EVAL·objMet)과 같은 값을 같은 단위로 보여준다. */
export function objDisplay(core: Core, o: Objective): ObjDisplay {
  const ev = STAR_EVAL[o.id];
  const unit: ObjUnit = STAR_UNIT[o.id] ?? KIND_UNIT[o.kind];
  const v = o.progress;
  const t = o.target;
  const rec = userTeam(core).rec;
  const games = rec.w + rec.l + rec.t;
  const nTeams = core.teams.length;
  // 아직 판단할 수 없는 지표: 개막 직후의 순위·승률, 홈경기 전의 관중, 장마 전의 장마 관중
  const early =
    ((unit === 'rank' || unit === 'pct') && games < MIN_GAMES_RANKED) ||
    (unit === 'att' && core.attHistory.length === 0) ||
    (unit === 'rainAtt' && rainyAvgAtt(core) === null) ||
    (unit === 'losses' && ev?.needPost && postLevel(core) < 1);

  let cur: string;
  let target: string;
  let ratio: number;
  switch (unit) {
    case 'rank':
      cur = `${v}위`;
      target = `${t}위 이내`;
      ratio = (nTeams - v) / Math.max(1, nTeams - t);
      break;
    case 'pct':
      cur = fmtPct(v);
      target = fmtPct(t);
      ratio = v / t;
      break;
    case 'ovr':
      cur = o.id === 's0-2' ? `최저 ${v}` : `${v}`;
      target = `${t}`;
      ratio = (v - 40) / Math.max(1, t - 40);
      break;
    case 'payUp':
      cur = `+${fmtMoney(v)}`;
      target = `${fmtMoney(t)} 이내`;
      ratio = v <= t ? 1 : t / v;
      break;
    case 'att':
    case 'rainAtt':
      cur = `${fmtInt(v)}명`;
      target = `${fmtInt(t)}명`;
      ratio = v / t;
      break;
    case 'money':
      cur = fmtMoney(v);
      target = t <= 1 ? '흑자' : fmtMoney(t);
      ratio = v / Math.max(1, t);
      break;
    case 'debt':
      cur = v <= 0 ? '무차입' : fmtMoney(v);
      target = t <= 0 ? '무차입' : `${fmtMoney(t)} 이하`;
      ratio = v <= t ? 1 : Math.max(t, 1) / v;
      break;
    case 'post':
      cur = POST_SHORT[v] ?? `${v}`;
      target = POST_SHORT[t] ?? `${t}`;
      ratio = v / Math.max(1, t);
      break;
    case 'losses':
      cur = `${v}패`;
      target = `${t}패`;
      ratio = v <= t ? 1 : 0;
      break;
    case 'saves':
      cur = `${v}세이브`;
      target = `${t}세이브`;
      ratio = v / t;
      break;
    case 'people':
      cur = `${v}명`;
      target = `${t}명`;
      ratio = v / t;
      break;
    case 'fans':
      cur = `${fmtInt(v)}명`;
      target = `${fmtInt(t)}명`;
      ratio = v / t;
      break;
    case 'level':
      cur = `Lv ${v}`;
      target = `Lv ${t}`;
      ratio = v / t;
      break;
    case 'wins':
      cur = `${v}승`;
      target = `${t}승`;
      ratio = v / t;
      break;
    default:
      cur = `${v}회`;
      target = `${t}회`;
      ratio = v / Math.max(1, t);
  }

  if (o.state !== 'open') {
    const met = o.state === 'done';
    return { cur, target, ratio: met ? 1 : clamp(Number.isFinite(ratio) ? ratio : 0, 0, 0.97), met };
  }
  if (early) return { cur: '—', target, ratio: 0, met: false };
  let met = objMet(o.kind, t, v);
  // 깃발·가을야구가 전제인 별은 그 전제도 지금 충족 중이어야 한다
  if (met && ev?.needFlag) {
    const main = core.campaign.objectives.find((x) => x.main);
    met = !!main && objDisplay(core, main).met;
  }
  if (met && ev?.needPost) met = postLevel(core) >= 1;
  ratio = clamp(Number.isFinite(ratio) ? ratio : 0, 0, 1);
  return { cur, target, ratio: met ? 1 : Math.min(ratio, 0.97), met };
}

const starId = (stage: number, n: number) => `s${stage}-${n}`;

/** 별 정의 목록 (UI 캠페인 시트용). 구 업적 20개는 v3 에서 없앴다 — 호환을 위해 같은 이름으로 내보낸다. */
export const ACHIEVEMENTS: { id: string; name: string; desc: string; icon: string; stage: number }[] = STAGES.flatMap((st, stage) =>
  st.stars.map((s, i) => ({ id: starId(stage, i + 1), name: `${st.name} ★${i + 1}`, desc: s.text ?? objText(s.kind, s.target), icon: '⭐', stage })),
);

/** 이 장에서 이미 딴 별 수 */
export function starsOf(core: Core, stage: number): number {
  return core.campaign.achievements.filter((a) => a.startsWith(`s${stage}-`)).length;
}

/** objectives 가 비어 있으면 현재 장의 깃발 1 + 별 3 을 채우고, 대본이 없으면 시즌 대본을 깐다 (mutate) */
export function fillObjectivesMut(core: Core, rng: Rng): void {
  const c = core.campaign;
  if (!c.objectives.length) {
    const stage = clamp(c.stage, 0, STAGES.length - 1);
    const st = STAGES[stage];
    const have = new Set(c.achievements);
    const main: Objective = {
      id: `s${stage}-main`,
      kind: st.main.kind,
      main: true,
      text: st.main.text ?? objText(st.main.kind, st.main.target),
      target: st.main.target,
      progress: 0,
      state: 'open',
      reward: { cash: st.reward.cash, fans: 0, trust: st.reward.trust },
    };
    const stars = st.stars.map((s, i): Objective => {
      const id = starId(stage, i + 1);
      return {
        id,
        kind: s.kind,
        main: false,
        text: s.text ?? objText(s.kind, s.target),
        target: s.target,
        progress: 0,
        state: have.has(id) ? 'done' : 'open', // 한 번 딴 별은 재도전해도 남는다
        reward: { cash: st.starCash, fans: 0, trust: STAR_TRUST },
      };
    });
    c.objectives = [main, ...stars];
  }
  if (!c.beats && core.phase === 'season') startSeasonScriptMut(core, rng);
  refreshProgressMut(core);
}

export function ensureObjectives(core0: Core, rng: Rng): Core {
  if (core0.campaign.objectives.length && (core0.campaign.beats || core0.phase !== 'season')) return core0;
  const core = structuredClone(core0);
  fillObjectivesMut(core, rng);
  return core;
}

/** 목표 progress 갱신 (mutate). 달성 판정은 결산에서만 한다. */
export function refreshProgressMut(core: Core): void {
  for (const o of core.campaign.objectives) o.progress = objectiveValue(core, o);
}

export function updateProgress(core0: Core): Core {
  const core = structuredClone(core0);
  refreshProgressMut(core);
  return core;
}

/** 중간 점검용: 지금 페이스면 깃발에 닿는가 */
export function flagOnTrack(core: Core): boolean {
  const st = stageOf(core);
  const rank = rankOf(core.teams, core.userId);
  switch (st.main.kind) {
    case 'rank':
      return rank <= st.main.target;
    case 'post':
      return rank <= (st.main.target >= 3 ? 2 : 4);
    default:
      return objMet(st.main.kind, st.main.target, objValue(core, st.main.kind));
  }
}

/**
 * 깃발을 예측 단위로: 지금 페이스로 시즌을 마치면 깃발 지표가 어디에 닿는가.
 * 순위류는 모든 구단이 지금 승률을 유지한다고 보고(예상 순위 = 지금 승률 순위) 예상 승패를 함께 적는다.
 * 관중류는 남은 홈경기를 최근 홈 6경기 평균으로 채운 시즌 평균. 12경기 전에는 "—".
 */
export function flagForecast(core: Core): { text: string; ok: boolean } {
  const st = stageOf(core);
  const { kind, target } = st.main;
  const t = userTeam(core);
  const games = t.rec.w + t.rec.l + t.rec.t;
  if (core.phase !== 'season' || games < MIN_GAMES_RANKED) return { text: '—', ok: false };
  const total = core.schedule.length;
  const left = Math.max(0, total - core.day);
  const mark = (ok: boolean) => (ok ? '✓' : '✗');
  const decided = t.rec.w + t.rec.l;
  const pct = decided ? t.rec.w / decided : 0.5;
  const w = Math.round(t.rec.w + left * pct);
  const pace = `${w}승 ${Math.max(0, total - t.rec.t - w)}패`;
  const rank = rankOf(core.teams, core.userId);
  switch (kind) {
    case 'rank': {
      const ok = rank <= target;
      return { text: `지금 페이스: ${pace} · ${rank}위 예상 · 깃발 ${target}위 이내 ${mark(ok)}`, ok };
    }
    case 'post': {
      const need = target >= 3 ? 2 : 4;
      const ok = rank <= need;
      return { text: `지금 페이스: ${pace} · ${rank}위 예상 · ${objText(kind, target)}은 ${need}위 이내부터 ${mark(ok)}`, ok };
    }
    case 'wins': {
      const ok = w >= target;
      return { text: `지금 페이스: ${w}승 예상 · 깃발 ${target}승 ${mark(ok)}`, ok };
    }
    case 'avgAtt': {
      const a = core.attHistory;
      if (!a.length) return { text: '—', ok: false };
      const homeLeft = core.schedule.slice(core.day).filter((d) => d.some((g) => g.homeId === core.userId)).length;
      const recent = a.slice(-6);
      const rAvg = recent.reduce((s, v) => s + v, 0) / recent.length;
      const v = Math.round((a.reduce((s, x) => s + x, 0) + rAvg * homeLeft) / (a.length + homeLeft));
      const ok = v >= target;
      return { text: `지금 페이스: 시즌 평균 관중 ${fmtInt(v)}명 예상 · 깃발 ${fmtInt(target)}명 ${mark(ok)}`, ok };
    }
    default: {
      const ok = objMet(kind, target, objValue(core, kind));
      return { text: `지금 그대로면: ${objText(kind, target)} ${mark(ok)}`, ok };
    }
  }
}

// ───────── 연대기: 응원 문화·구장 풍경 ─────────

/** 응원 문화 0~3 (주황 물결 → 깃발 → 대형 현수막) */
export function cheerLv(core: Pick<Core, 'fans' | 'fanSat' | 'season'>): number {
  let lv = 0;
  if (core.fans >= 7500 && core.fanSat >= 45) lv = 1;
  if (core.fans >= 12000 && core.fanSat >= 50 && core.season >= 3) lv = 2;
  if (core.fans >= 18000 && core.fanSat >= 55 && core.season >= 5) lv = 3;
  return lv;
}

/** StadiumScene 의 v3 필드 (구장 렌더러 입력) */
export function sceneExtras(core: Core): Pick<StadiumScene, 'oldBanner' | 'gateQueue' | 'cheerLv' | 'retiredNums' | 'banners'> {
  const cr = core.crowd;
  return {
    oldBanner: true,
    gateQueue: cr && cr.capacity > 0 ? clamp(cr.turnedAway / cr.capacity, 0, 1) : 0,
    cheerLv: cheerLv(core),
    retiredNums: Math.min(4, core.campaign.retired?.length ?? 0),
    banners: Math.min(3, core.campaign.titles),
  };
}

// ───────── 일괄 진행의 정지 (3절) ─────────

/** 방금 치른 경기(report) 뒤에 일괄 진행을 멈춰야 하면 그 이유 (토스트용). 부상으로 멈춘 날은 core 의 시즌 메모에 적는다 */
export function stopReason(core: Core, report: DayReport): string | null {
  const c = core.campaign;
  if (c.event) return `${c.event.icon} ${c.event.title}`;
  if (core.phase !== 'season') return null;
  // 주전 부상: OVR 기준 타자 상위 9명 또는 선발 로테이션 상위 3명. 한 번 멈춘 뒤 STOP_INJ_GAP 경기 안에는 같은 사유로 다시 멈추지 않는다
  const t = userTeam(core);
  const byOvr = (a: Player, b: Player) => b.ovr - a.ovr;
  const rot = new Set(t.rotation);
  const key = new Set([
    ...t.roster.filter((p) => p.kind === 'B' && !p.farm).sort(byOvr).slice(0, 9).map((p) => p.id),
    ...t.roster.filter((p) => rot.has(p.id)).sort(byOvr).slice(0, 3).map((p) => p.id),
  ]);
  const hurt = report.result.injuries.find((j) => j.teamId === core.userId && key.has(j.pid));
  if (hurt && core.day - memoNum(core, 'injStop', -99) > STOP_INJ_GAP) {
    memoSet(core, 'injStop', core.day);
    return `주전 부상: ${hurt.name} ${hurt.games}경기 결장`;
  }
  const b = (c.beats ?? []).find((x) => (x.part === 'jeon' || x.part === 'gyeol') && x.from === core.day);
  if (b) return b.label ? `다음 경기부터 ${b.icon ?? ''} ${b.label}`.replace('  ', ' ') : '시즌의 흐름이 바뀝니다';
  return null;
}

// ───────── 결산 ─────────

/** phase 'ended' 진입 시 한 번 실행 (mutate). */
export function concludeMut(core: Core, rng: Rng): SeasonVerdict {
  const c = core.campaign;
  fillObjectivesMut(core, rng);
  const t = userTeam(core);
  const stageBefore = c.stage;
  const trustBefore = c.trust;
  const titlesBefore = c.titles;
  let cashReward = 0;
  const fansReward = 0;
  let trust = c.trust;

  // 포스트시즌 배당금
  const finish: PostFinish = core.post?.userFinish ?? 'none';
  const div = POST_DIVIDEND[finish];
  if (div > 0) {
    core.finance.cash += div;
    core.finance.ledger.league += div;
    addNews(core, `포스트시즌 배당금 ${fmtMoney(div)} 수령`, 'good');
  }
  if (finish === 'champion') c.titles++;

  // 덮은 일의 적발 판정: 선수 징계·승수 몰수·벌금은 여기서, 지지와 별은 아래에서
  const exposures = exposeMut(core, rng, finish === 'champion');
  for (const ex of exposures) trust += ex.trust;

  // 경쟁균형세 (economy.ts LUX_TAX — 기본 꺼짐): 연봉 총액이 상한을 넘은 만큼 제재금
  const lux = luxTax(core);
  if (lux.tax > 0) {
    core.finance.cash -= lux.tax;
    core.finance.ledger.upkeep += lux.tax;
    addNews(core, `경쟁균형세 ${fmtMoney(lux.tax)} 납부 — 연봉 총액 ${fmtMoney(lux.payroll)} · 상한 ${fmtMoney(lux.cap)}`, 'bad');
  }

  // 깃발
  refreshProgressMut(core);
  const main = c.objectives.find((o) => o.main);
  const cleared = !!main && objMet(main.kind, main.target, main.progress);
  if (main) main.state = cleared ? 'done' : 'failed';

  // 별: 장마다 고정, 한 번 딴 별은 다시 보상하지 않는다
  const newStars: string[] = [];
  const have = new Set(c.achievements);
  for (const o of c.objectives) {
    if (o.main) continue;
    if (have.has(o.id)) {
      o.state = 'done';
      continue;
    }
    const ev = STAR_EVAL[o.id];
    const ok = objMet(o.kind, o.target, o.progress) && (!ev?.needFlag || cleared) && (!ev?.needPost || postLevel(core) >= 1);
    o.state = ok && !exposures.length ? 'done' : 'failed';
    if (!ok) continue;
    if (exposures.length) {
      // 덮은 일이 드러난 시즌의 별은 인정되지 않는다 (다음에 다시 딸 수 있다)
      exposures[0].stars++;
      addNews(core, `별 박탈: ${o.text}`, 'bad');
      continue;
    }
    c.achievements.push(o.id);
    newStars.push(o.id);
    cashReward += o.reward.cash;
    trust += o.reward.trust;
    addNews(core, `⭐ 별 획득: ${o.text}`, 'good');
  }

  // 중간 점검의 출자·약속
  const mid = memoGet(core, 'mid');

  // 깃발: 클리어 + 월반 / 실패
  if (cleared) {
    let stage = c.stage;
    let jumps = 0;
    for (;;) {
      const st = STAGES[stage];
      cashReward += st.reward.cash * (jumps === 0 && mid === 'up' ? MID_UP_MULT : 1);
      trust += st.reward.trust;
      jumps++;
      if (stage === 0 && !c.managerYielded) {
        c.managerYielded = true;
        addNews(core, NEWS.managerYield, 'good');
      }
      if (st.ending && !c.ending) {
        c.ending = true;
        addNews(core, endingText(c).news, 'good');
      }
      if (stage < STAGES.length - 1) stage++;
      else break;
      if (jumps >= MAX_JUMP || stage >= STAGES.length - 1) break;
      const nx = STAGES[stage].main;
      if (!objMet(nx.kind, nx.target, objValue(core, nx.kind))) break;
      addNews(core, `월반! 「${STAGES[stage].name}」의 깃발까지 이미 닿았습니다`, 'good');
    }
    c.stage = stage;
  } else {
    trust -= stageOf(core).failTrust;
    if (POST_CONSOLE[finish] > 0) {
      trust += POST_CONSOLE[finish];
      addNews(core, `깃발에는 닿지 못했지만 가을야구가 섬을 달랬습니다 — ${TRUST_LABEL} +${POST_CONSOLE[finish]}`, 'info');
    }
    if (mid) {
      trust -= mid === 'up' ? MID_UP_FAIL_TRUST : MID_FAIL_TRUST;
      addNews(core, mid === 'up' ? `조합장에게 한 약속을 지키지 못했습니다 — ${TRUST_LABEL} −${MID_UP_FAIL_TRUST}` : `조합원 출자금을 받고도 깃발에 닿지 못했습니다 — ${TRUST_LABEL} −${MID_FAIL_TRUST}`, 'bad');
    }
  }

  core.finance.cash += cashReward;
  c.trust = clamp(Math.round(trust), 0, TRUST_MAX);

  const rank = rankOf(core.teams, core.userId);
  const rec: SeasonRecord = {
    season: core.season,
    stage: stageBefore,
    rank,
    w: t.rec.w,
    l: t.rec.l,
    t: t.rec.t,
    post: finish,
    profit: opProfit(core.finance.ledger),
    avgAtt: avgAtt(core),
    grade: seasonAwards(core).grade,
    cleared,
    ...(exposures.some((ex) => ex.tainted && ex.season === core.season) ? { tainted: true } : {}),
  };
  rec.name = nameSeason(rec, {
    results: (memoGet(core, 'wl') ?? '').split('').map((ch) => (ch === 'W' ? 1 : ch === 'L' ? 0 : 0.5)),
    rainyAtt: rainyAvgAtt(core),
    sellouts: c.sellouts,
    prev: c.history,
    dealt: !!c.dealt,
    titlesBefore,
  });
  c.history.push(rec);

  const fired = c.trust <= 0;
  const verdict: SeasonVerdict = {
    cleared,
    stageBefore,
    stageAfter: c.stage,
    trustBefore,
    trustAfter: c.trust,
    cashReward,
    fansReward,
    seasonName: rec.name,
    newAchievements: newStars,
    fired,
    ...(exposures.length ? { exposures } : {}),
    ...(lux.tax > 0 ? { luxTax: lux } : {}),
  };
  c.verdict = verdict;
  const st = STAGES[stageBefore];
  addNews(core, `${core.season}번째 시즌의 이름 — 「${rec.name}」 (구단사 ${c.history.map((h) => h.rank).join('-')})`, 'info');
  addNews(
    core,
    cleared
      ? `시즌 결산: 「${st.name}」 깃발 달성! 지원금 ${fmtMoney(cashReward)} · ${TRUST_LABEL} ${trustBefore}→${c.trust}`
      : `시즌 결산: 「${st.name}」 깃발 실패 — ${TRUST_LABEL} ${trustBefore}→${c.trust}`,
    cleared ? 'good' : 'bad',
  );
  if (fired) {
    core.phase = 'over';
    addNews(core, withTeam(c.dealt ? NEWS.overDealt : NEWS.over, userTeam(core).name), 'bad');
  }
  return verdict;
}

export function concludeSeason(core0: Core, rng: Rng): Core {
  const core = structuredClone(core0);
  concludeMut(core, rng);
  return core;
}

/** 새 시즌용 캠페인 필드 리셋 (mutate) — nextSeason 에서 호출 */
export function resetSeasonCampaignMut(core: Core, rng: Rng): void {
  const c = core.campaign;
  // 시즌이 끝나면 고정 출전도 끝난다: 다음 시즌 개막 타순에 남지 않게 원래 편성으로
  for (const b of c.buffs) if (b.pid && (b.kind === 'fixed' || b.kind === 'demand')) unfixMut(core, b.pid);
  c.objectives = [];
  c.event = null;
  c.eventsSeen = [];
  c.buffs = [];
  c.sellouts = 0;
  c.verdict = null;
  c.beats = undefined;
  c.hints = {};
  fillObjectivesMut(core, rng);
}

/** 구 업적 판정 자리. v3 에서 업적은 없고 별은 결산 때만 판정한다 (호환용 no-op). */
export function checkAchievementsMut(_core: Core, _season: boolean): string[] {
  return [];
}

export { ENDING, TRUST_LABEL, verdictLine };
