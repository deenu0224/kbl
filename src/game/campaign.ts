// 캠페인 「제주의 기적」: 스테이지·목표·결산·업적·버프 해석. docs/LEVEL_DESIGN.md 2·6절.
import type { Buff, Core, ObjKind, Objective, Player, PostFinish, SeasonRecord, SeasonVerdict } from './types';
import { clamp, shuffle, type Rng } from './rng';
import { opProfit, userTeam } from './economy';
import { fmtInt, fmtMoney } from './format';
import { addNews, rankOf, seasonAwards } from './season';

// ───────── 튜닝 테이블 ─────────

export const TRUST_START = 60;
export const TRUST_MAX = 100;
export const SIDE_TRUST = 5; // 보조 목표 달성 시 신임
export const MAX_JUMP = 2; // 월반 포함 한 번에 오를 수 있는 최대 스테이지
export const PLEDGE_OK = 15; // 구단주 공약 달성/실패 신임
export const PLEDGE_FAIL = -10;
// 포스트시즌 배당금 (유저 최종 도달 지점별, ledger.league 합산)
export const POST_DIVIDEND: Record<PostFinish, number> = { none: 0, SPO: 30000, PO: 60000, KS: 120000, champion: 250000 };
export const POST_LEVEL: Record<PostFinish, number> = { none: 0, SPO: 1, PO: 2, KS: 3, champion: 4 };

interface ObjSpec {
  kind: ObjKind;
  target: number;
}

export interface StageDef {
  name: string;
  desc: string;
  main: ObjSpec;
  pool: ObjSpec[]; // 보조 목표 풀 (시즌마다 SIDE_COUNT 개 추첨)
  reward: { cash: number; trust: number };
  failTrust: number; // 메인 실패 시 신임 감소(양수)
  sideCash: number; // 보조 목표 현금 보상
  sideFans: number; // 보조 목표 팬 보상 (현금 대신 절반 확률)
  ending?: boolean;
}

export const SIDE_COUNT = 2;

export const STAGES: StageDef[] = [
  {
    name: '꼴찌 탈출',
    desc: '창단 구단의 첫 과제 — 바닥에서 벗어나라.',
    main: { kind: 'rank', target: 7 },
    pool: [{ kind: 'avgAtt', target: 5500 }, { kind: 'facility', target: 1 }, { kind: 'profit', target: 1 }],
    reward: { cash: 80000, trust: 15 },
    failTrust: 15,
    sideCash: 15000,
    sideFans: 300,
  },
  {
    name: '중위권 도약',
    desc: '이제 중위권 싸움이다.',
    main: { kind: 'rank', target: 5 },
    pool: [{ kind: 'fans', target: 8000 }, { kind: 'sellouts', target: 12 }, { kind: 'avgAtt', target: 7500 }, { kind: 'facility', target: 3 }],
    reward: { cash: 120000, trust: 15 },
    failTrust: 20,
    sideCash: 20000,
    sideFans: 400,
  },
  {
    name: '가을야구',
    desc: '제주에 가을야구를!',
    main: { kind: 'post', target: 1 },
    pool: [{ kind: 'sellouts', target: 18 }, { kind: 'profit', target: 100000 }, { kind: 'fans', target: 12000 }, { kind: 'star', target: 80 }],
    reward: { cash: 200000, trust: 15 },
    failTrust: 20,
    sideCash: 25000,
    sideFans: 500,
  },
  {
    name: '한국시리즈로',
    desc: '가을의 끝까지 살아남아라.',
    main: { kind: 'post', target: 3 },
    pool: [{ kind: 'avgAtt', target: 12000 }, { kind: 'facility', target: 7 }, { kind: 'fans', target: 18000 }, { kind: 'debt', target: 0 }],
    reward: { cash: 300000, trust: 15 },
    failTrust: 20,
    sideCash: 30000,
    sideFans: 600,
  },
  {
    name: '제주의 기적',
    desc: '섬의 작은 구단, 정상에 서다.',
    main: { kind: 'post', target: 4 },
    pool: [{ kind: 'avgAtt', target: 16000 }, { kind: 'profit', target: 300000 }, { kind: 'facility', target: 9 }],
    reward: { cash: 500000, trust: 20 },
    failTrust: 20,
    sideCash: 40000,
    sideFans: 800,
    ending: true,
  },
  {
    name: '왕조',
    desc: '정상을 지켜라 — 끝없는 도전.',
    main: { kind: 'post', target: 1 },
    pool: [
      { kind: 'avgAtt', target: 17000 },
      { kind: 'profit', target: 300000 },
      { kind: 'facility', target: 11 },
      { kind: 'fans', target: 25000 },
      { kind: 'sellouts', target: 30 },
      { kind: 'star', target: 88 },
    ],
    reward: { cash: 150000, trust: 10 },
    failTrust: 20,
    sideCash: 30000,
    sideFans: 600,
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
  fixedPid: string | null; // 고정 출전 선수
  list: Buff[];
}

export function buffActive(b: Buff, day: number): boolean {
  if (b.left !== undefined) return b.left > 0;
  return day < b.until;
}

export function activeBuffs(core: Core): BuffEffect {
  const e: BuffEffect = { demand: 1, capacity: 1, merch: 1, food: 1, ticket: 1, price: 1, focus: 0, upkeep: 0, youth: 0, fixedPid: null, list: [] };
  const bs = core.campaign?.buffs ?? [];
  for (const b of bs) {
    if (!buffActive(b, core.day)) continue;
    e.list.push(b);
    switch (b.kind) {
      case 'demand':
        e.demand *= b.value;
        if (b.pid) e.fixedPid = b.pid;
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
      // 'pledge' 는 결산 때만 의미가 있다
    }
  }
  return e;
}

/** 경기 후 버프 만료 처리 (mutate). 홈경기였으면 left 를 1 줄인다. */
export function tickBuffs(core: Core, wasHome: boolean): void {
  const c = core.campaign;
  for (const b of c.buffs) if (wasHome && b.left !== undefined && b.left > 0) b.left--;
  c.buffs = c.buffs.filter((b) => b.kind === 'pledge' || b.kind === 'youth' || buffActive(b, core.day));
}

// ───────── 목표 ─────────

export function stageOf(core: Core): StageDef {
  return STAGES[clamp(core.campaign.stage, 0, STAGES.length - 1)];
}

function facSum(core: Core): number {
  return core.facilities.seats + core.facilities.food + core.facilities.training;
}

export function postLevel(core: Core): number {
  return core.post ? POST_LEVEL[core.post.userFinish] : 0;
}

function avgAtt(core: Core): number {
  const a = core.attHistory;
  return a.length ? Math.round(a.reduce((s, v) => s + v, 0) / a.length) : 0;
}

/** 현재 상태의 목표 지표 값 */
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
      return facSum(core);
    case 'star':
      return t.roster.reduce((m, p) => Math.max(m, p.star), 0);
    case 'post':
      return postLevel(core);
    case 'debt':
      return core.finance.debt;
  }
}

/** 시즌 종료 시점 기준 달성 여부 */
export function objMet(kind: ObjKind, target: number, value: number): boolean {
  if (kind === 'rank' || kind === 'debt') return value <= target;
  return value >= target;
}

function makeObjective(core: Core, spec: ObjSpec, main: boolean, i: number, rng: Rng): Objective {
  const st = stageOf(core);
  const reward = main
    ? { cash: st.reward.cash, fans: 0, trust: st.reward.trust }
    : rng() < 0.5
      ? { cash: st.sideCash, fans: 0, trust: SIDE_TRUST }
      : { cash: 0, fans: st.sideFans, trust: SIDE_TRUST };
  return {
    id: `s${core.season}-${main ? 'main' : `side${i}`}`,
    kind: spec.kind,
    main,
    text: objText(spec.kind, spec.target),
    target: spec.target,
    progress: 0,
    state: 'open',
    reward,
  };
}

/** objectives 가 비어 있으면 현재 스테이지 목표를 채운다 (mutate) */
export function fillObjectivesMut(core: Core, rng: Rng): void {
  if (core.campaign.objectives.length) return;
  const st = stageOf(core);
  // 이미 달성된 '되돌릴 수 없는' 목표(시설 등)는 뒤로 미룬다
  const sides = shuffle(rng, st.pool)
    .sort((a, b) => Number(SURE_KINDS.includes(a.kind) && objMet(a.kind, a.target, objValue(core, a.kind))) - Number(SURE_KINDS.includes(b.kind) && objMet(b.kind, b.target, objValue(core, b.kind))))
    .slice(0, SIDE_COUNT);
  core.campaign.objectives = [makeObjective(core, st.main, true, 0, rng), ...sides.map((s, i) => makeObjective(core, s, false, i + 1, rng))];
  refreshProgressMut(core);
}

export function ensureObjectives(core0: Core, rng: Rng): Core {
  if (core0.campaign.objectives.length) return core0;
  const core = structuredClone(core0);
  fillObjectivesMut(core, rng);
  return core;
}

// 시즌 중에도 되돌릴 수 없는 목표 (달성 즉시 done)
const SURE_KINDS: ObjKind[] = ['facility'];

/** 목표 progress 갱신 (mutate) */
export function refreshProgressMut(core: Core): void {
  for (const o of core.campaign.objectives) {
    if (o.state === 'failed') continue;
    o.progress = objValue(core, o.kind);
    if (o.state === 'open' && SURE_KINDS.includes(o.kind) && objMet(o.kind, o.target, o.progress)) o.state = 'done';
    if (o.kind === 'star' && objMet(o.kind, o.target, o.progress)) o.state = 'done';
  }
}

export function updateProgress(core0: Core): Core {
  const core = structuredClone(core0);
  refreshProgressMut(core);
  return core;
}

// ───────── 업적 ─────────

interface AchCtx {
  season: boolean; // 시즌 결산 시점이면 true
}

interface AchDef {
  id: string;
  name: string;
  desc: string;
  icon: string;
  test: (core: Core, ctx: AchCtx) => boolean;
}

const QUAL_PA = 260;

function batScore(p: Player): number {
  return p.bat.h + p.bat.hr * 3 + p.bat.rbi + p.bat.r * 0.5 + p.bat.bb * 0.4 - (p.bat.ab - p.bat.h) * 0.25;
}
function pitScore(p: Player): number {
  return p.pit.outs / 3 - p.pit.er * 1.3 + p.pit.w * 3 + p.pit.sv * 2 + p.pit.so * 0.15;
}
function playerScore(p: Player): number {
  return p.kind === 'B' ? batScore(p) : pitScore(p);
}

/** 리그 최고 활약 선수 (rookieOnly = 신인왕 후보만) */
export function leagueBest(core: Core, rookieOnly: boolean): { p: Player; teamId: string } | null {
  let best: { p: Player; teamId: string } | null = null;
  let bestV = -Infinity;
  for (const t of core.teams) {
    for (const p of t.roster) {
      if (rookieOnly && !p.rookie) continue;
      if (p.bat.pa === 0 && p.pit.outs === 0) continue;
      const v = playerScore(p);
      if (v > bestV) {
        bestV = v;
        best = { p, teamId: t.id };
      }
    }
  }
  return best;
}

const lastHistory = (core: Core, n: number) => core.campaign.history.slice(-n);

export const ACHIEVEMENTS: AchDef[] = [
  { id: 'first_win', name: '첫 승', desc: '구단 역사상 첫 승리', icon: '⚾', test: (c) => userTeam(c).rec.w >= 1 },
  { id: 'first_sellout', name: '첫 매진', desc: '홈경기 첫 매진', icon: '🎟️', test: (c) => c.campaign.sellouts >= 1 },
  { id: 'streak5', name: '5연승', desc: '5연승 달성', icon: '🔥', test: (c) => userTeam(c).rec.streak >= 5 },
  { id: 'streak10', name: '10연승', desc: '10연승 달성', icon: '☄️', test: (c) => userTeam(c).rec.streak >= 10 },
  { id: 'sellout10', name: '만원 관중 10회', desc: '한 시즌 매진 10회', icon: '🏟️', test: (c) => c.campaign.sellouts >= 10 },
  { id: 'fans10k', name: '팬 1만', desc: '팬 10,000명 돌파', icon: '🙌', test: (c) => c.fans >= 10000 },
  { id: 'fans20k', name: '팬 2만', desc: '팬 20,000명 돌파', icon: '📣', test: (c) => c.fans >= 20000 },
  { id: 'fans30k', name: '팬 3만', desc: '팬 30,000명 돌파', icon: '🌋', test: (c) => c.fans >= 30000 },
  {
    id: 'stadium_max',
    name: '꿈의 구장',
    desc: '관중석·매점·훈련장 모두 최고 단계',
    icon: '🏰',
    test: (c) => c.facilities.seats >= 4 && c.facilities.food >= 4 && c.facilities.training >= 4,
  },
  { id: 'profit_season', name: '첫 흑자 시즌', desc: '영업손익 흑자로 시즌 마감', icon: '💰', test: (c, x) => x.season && opProfit(c.finance.ledger) > 0 },
  { id: 'profit30', name: '알짜 구단', desc: '한 시즌 영업손익 +30억', icon: '💎', test: (c, x) => x.season && opProfit(c.finance.ledger) >= 300000 },
  {
    id: 'no_debt',
    name: '무차입 경영',
    desc: '부채 0 · 현금 30억 이상으로 시즌 마감',
    icon: '🏦',
    test: (c, x) => x.season && c.finance.debt === 0 && c.finance.cash >= 300000,
  },
  {
    id: 'hitter300',
    name: '3할 타자',
    desc: '규정타석 3할 타자 배출',
    icon: '🏏',
    test: (c, x) => x.season && userTeam(c).roster.some((p) => p.kind === 'B' && p.bat.pa >= QUAL_PA && p.bat.h / Math.max(1, p.bat.ab) >= 0.3),
  },
  { id: 'hr20', name: '20홈런', desc: '한 시즌 20홈런 타자 배출', icon: '💥', test: (c) => userTeam(c).roster.some((p) => p.bat.hr >= 20) },
  { id: 'win10', name: '10승 투수', desc: '한 시즌 10승 투수 배출', icon: '🎯', test: (c) => userTeam(c).roster.some((p) => p.pit.w >= 10) },
  { id: 'save20', name: '20세이브', desc: '한 시즌 20세이브 마무리', icon: '🔒', test: (c) => userTeam(c).roster.some((p) => p.pit.sv >= 20) },
  {
    id: 'roy',
    name: '신인왕',
    desc: '리그 신인왕 배출',
    icon: '🌱',
    test: (c, x) => x.season && leagueBest(c, true)?.teamId === c.userId,
  },
  { id: 'mvp', name: '리그 MVP', desc: '리그 최고 활약 선수 배출', icon: '👑', test: (c, x) => x.season && leagueBest(c, false)?.teamId === c.userId },
  { id: 'wins50', name: '50승', desc: '정규시즌 50승', icon: '📈', test: (c) => userTeam(c).rec.w >= 50 },
  { id: 'rank1', name: '정규시즌 1위', desc: '정규시즌 1위로 마감', icon: '🥇', test: (c, x) => x.season && rankOf(c.teams, c.userId) === 1 },
  { id: 'post_first', name: '가을야구', desc: '포스트시즌 첫 진출', icon: '🍂', test: (c) => postLevel(c) >= 1 },
  { id: 'ks_reach', name: '한국시리즈', desc: '한국시리즈 진출', icon: '🏆', test: (c) => postLevel(c) >= 3 },
  { id: 'champion', name: '제주의 기적', desc: '한국시리즈 우승', icon: '🍊', test: (c) => c.campaign.titles >= 1 },
  {
    id: 'repeat',
    name: '2연패',
    desc: '한국시리즈 2년 연속 우승',
    icon: '🏅',
    test: (c, x) => x.season && lastHistory(c, 2).length === 2 && lastHistory(c, 2).every((h) => h.post === 'champion'),
  },
  {
    id: 'draft3',
    name: '육성의 힘',
    desc: '드래프트 출신 주전 3명',
    icon: '🌳',
    test: (c) => userTeam(c).lineup.filter((s) => s.pid.startsWith('dr')).length >= 3,
  },
  { id: 'att15k', name: '구름 관중', desc: '시즌 홈 평균 관중 15,000명', icon: '☁️', test: (c, x) => x.season && avgAtt(c) >= 15000 },
];

/** 새로 달성한 업적 id 목록 (mutate: achievements 추가 + 뉴스) */
export function checkAchievementsMut(core: Core, season: boolean): string[] {
  const got: string[] = [];
  const have = new Set(core.campaign.achievements);
  for (const a of ACHIEVEMENTS) {
    if (have.has(a.id)) continue;
    if (!a.test(core, { season })) continue;
    core.campaign.achievements.push(a.id);
    got.push(a.id);
    addNews(core, `업적 달성 ${a.icon} 「${a.name}」 — ${a.desc}`, 'good');
  }
  return got;
}

// ───────── 결산 ─────────

/** phase 'ended' 진입 시 한 번 실행 (mutate). */
export function concludeMut(core: Core, rng: Rng): SeasonVerdict {
  const c = core.campaign;
  fillObjectivesMut(core, rng);
  const t = userTeam(core);
  const stageBefore = c.stage;
  const trustBefore = c.trust;
  let cashReward = 0;
  let fansReward = 0;
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

  // 목표 판정
  refreshProgressMut(core);
  let cleared = false;
  for (const o of c.objectives) {
    const ok = objMet(o.kind, o.target, o.progress);
    o.state = ok ? 'done' : 'failed';
    if (o.main) {
      cleared = ok;
      continue;
    }
    if (ok) {
      cashReward += o.reward.cash;
      fansReward += o.reward.fans;
      trust += o.reward.trust;
    }
  }

  // 메인: 클리어 + 월반 / 실패
  if (cleared) {
    let stage = c.stage;
    let jumps = 0;
    for (;;) {
      const st = STAGES[stage];
      cashReward += st.reward.cash;
      trust += st.reward.trust;
      jumps++;
      if (st.ending && !c.ending) {
        c.ending = true;
        addNews(core, '🍊 제주의 기적! 창단 구단이 한국시리즈 정상에 섰습니다', 'good');
      }
      if (stage < STAGES.length - 1) stage++;
      else break;
      if (jumps >= MAX_JUMP || stage >= STAGES.length - 1) break;
      const nx = STAGES[stage].main;
      if (!objMet(nx.kind, nx.target, objValue(core, nx.kind))) break;
      addNews(core, `월반! 「${STAGES[stage].name}」 조건까지 이미 달성했습니다`, 'good');
    }
    c.stage = stage;
  } else {
    trust -= stageOf(core).failTrust;
  }

  // 구단주 공약
  for (const b of c.buffs) {
    if (b.kind !== 'pledge') continue;
    const ok = t.rec.w >= b.value;
    trust += ok ? PLEDGE_OK : PLEDGE_FAIL;
    addNews(core, ok ? `구단주 공약 달성 (${b.value}승) — 신임 +${PLEDGE_OK}` : `구단주 공약 실패 (${b.value}승 미달) — 신임 ${PLEDGE_FAIL}`, ok ? 'good' : 'bad');
  }

  core.finance.cash += cashReward;
  core.fans += fansReward;
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
  };
  c.history.push(rec);
  const newAch = checkAchievementsMut(core, true);

  const fired = c.trust <= 0;
  const verdict: SeasonVerdict = {
    cleared,
    stageBefore,
    stageAfter: c.stage,
    trustBefore,
    trustAfter: c.trust,
    cashReward,
    fansReward,
    newAchievements: newAch,
    fired,
  };
  c.verdict = verdict;
  const st = STAGES[stageBefore];
  addNews(
    core,
    cleared
      ? `시즌 결산: 「${st.name}」 클리어! 지원금 ${fmtMoney(cashReward)} · 신임 ${trustBefore}→${c.trust}`
      : `시즌 결산: 「${st.name}」 실패 — 신임 ${trustBefore}→${c.trust}`,
    cleared ? 'good' : 'bad',
  );
  if (fired) {
    core.phase = 'over';
    addNews(core, '구단주가 단장 해임을 통보했습니다. 게임 오버', 'bad');
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
  c.objectives = [];
  c.event = null;
  c.eventsSeen = [];
  c.buffs = [];
  c.sellouts = 0;
  c.verdict = null;
  fillObjectivesMut(core, rng);
}
