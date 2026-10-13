import type { BatPos, BatStats, Campaign, Core, Ledger, PitchRole, PitStats, Player, Team, TeamRecord } from './types';
import { clamp, gauss, mulberry32, pick, randInt, shuffle, type Rng } from './rng';
import { calcOvr, calcSalary } from './ratings';
import { autoLineup } from './lineup';
import { buildSchedule } from './schedule';
import { PREMISE_NEWS } from './story';

// ── 밸런스 상수 ──
const ABIL_SD = 7.5; // 능력치 편차
const STARTER_BONUS = 1.5; // 주전 타자 중심값 보정
const BENCH_PENALTY = 6; // 벤치 타자 중심값 보정
const SP_OFFSETS = [3, 1, 0, -1, -3]; // 1~5선발
// 유저 팀(전임 체제의 유산): 몇몇 포지션에 "왕년의 주전"과 그 뒤에서 기회를 기다리는 더 나은 선수가 겹쳐 있다.
// 감독의 편성(나이·이름값 가중)은 왕년의 주전을 쓰고, 실력대로 짜면 뒤의 선수가 나온다.
const LEGACY_N = 4; // 겹치는 포지션 수
const LEGACY_VET = -6; // 왕년의 주전 중심값 (tier 기준)
const LEGACY_VET_AGE: [number, number] = [33, 37];
const LEGACY_VET_STAR = 16; // 이름값
const LEGACY_NEXT = 3; // 뒤에서 기다리는 선수 중심값
const LEGACY_NEXT_AGE: [number, number] = [23, 27];
const RP_OFFSET = -1;
const CP_OFFSET = 2;
const ARCH_TIER_REF = 62; // 아키타입 능력치의 기준 tier
export const START_CASH = 150000; // 15억
export const START_FANS = 5200;
export const START_PRICE = 1.1;
export const USER_ID = 'JEJ';

interface TeamDef {
  id: string;
  city: string;
  name: string;
  color: string;
  color2: string;
  tier: number;
  pop: number;
  stars: number; // 아키타입 스타 수
}

// tier: KBO 기준으로 시뮬 민감도를 키운 만큼 구단 간 격차가 벌어지지 않도록 AI 구단을 한두 단계 낮췄다 (유저 팀 연봉·경제 밸런스는 그대로)
export const TEAM_DEFS: TeamDef[] = [
  { id: 'SEL', city: '서울', name: '스카이라인즈', color: '#c2185b', color2: '#1b2233', tier: 63, pop: 0.95, stars: 4 },
  { id: 'HAN', city: '한강', name: '그리폰즈', color: '#1a3a8f', color2: '#ffffff', tier: 61, pop: 0.85, stars: 4 },
  { id: 'BUS', city: '부산', name: '씨호크스', color: '#0e7fb8', color2: '#f26a1b', tier: 59, pop: 0.9, stars: 3 },
  { id: 'DGU', city: '대구', name: '썬더킹스', color: '#1e56c4', color2: '#ffd23f', tier: 59, pop: 0.7, stars: 3 },
  { id: 'GWJ', city: '광주', name: '레드폭스', color: '#d32f2f', color2: '#111111', tier: 60, pop: 0.8, stars: 4 },
  { id: 'ICN', city: '인천', name: '앵커스', color: '#b71c1c', color2: '#f5c518', tier: 57, pop: 0.6, stars: 3 },
  { id: 'DJN', city: '대전', name: '팰컨스', color: '#f57c00', color2: '#212121', tier: 54, pop: 0.55, stars: 2 },
  { id: USER_ID, city: '제주', name: '탠저린즈', color: '#f08a1c', color2: '#1f6b3a', tier: 55, pop: 0.25, stars: 1 },
];

// ── 가명 생성 ──
const SURNAMES =
  '김김김김김이이이이박박박최최정정강조윤장임한오서신권황안송전홍유고문양손배백허남심노하곽성차주우구민류나진지엄채원천방공현함변염여추도소석선설마길연위표명기반라왕금옥육인맹제모탁국어은편용'.split(
    '',
  );
const GIVEN_A = '서민지도준현태성재승우시하건동영정상진유은주예윤경기세수선형종원규강석찬한'.split('');
const GIVEN_B = '준호우현민훈석진혁원빈환수영성윤재욱범철규찬기태한겸후율건섭열용'.split('');
const FOREIGN_FIRST = [
  '로건', '데릭', '마커스', '타일러', '브록', '제이크', '라이언', '코디', '닉', '오스카', '미겔', '던컨',
  '웨이드', '트레이', '루카스', '헥터', '앤디', '빅터', '칼렙', '도미닉', '레오', '사무엘', '브렛', '콜비',
];
const FOREIGN_LAST = [
  '베일', '스톤', '헤일', '크로스', '해먼드', '모로', '케인', '웨스트', '발렌', '리마', '산토로', '프라이',
  '콜튼', '매독', '펜', '살바', '그레이브', '로웬', '아처', '바스케', '드레이크', '휘트', '노바', '델가',
];

// 실존 유명 선수명 차단 목록 — 우연히 겹치면 다시 뽑는다
const BLOCKED = new Set(
  (
    '이승엽 이대호 류현진 김광현 양현종 박병호 이정후 김하성 강백호 최정 양의지 김현수 나성범 손아섭 박건우 구자욱 ' +
    '오승환 선동열 이종범 박찬호 추신수 김태균 이병규 박용택 장효조 최동원 김재환 강민호 최형우 김도영 문동주 안우진 ' +
    '원태인 고우석 정우람 임창용 이만수 김성한 양준혁 장종훈 박재홍 홍성흔 이용규 정근우 김선빈 박민우 오지환 노시환 ' +
    '구창모 곽빈 박세웅 김원중 한유섬 전준우 황재균 허경민 박해민 홍창기 문보경 김혜성 송성문 이의리 소형준 고영표 ' +
    '임찬규 김택연 정해영 박영현 조상우 채은성 박동원 최지훈 김주원 윤동희 나승엽 정수빈 김상수 서건창 박석민 이호준 ' +
    '김동주 심정수 송진우 정민철 구대성 배영수 윤석민 봉중근 김병현 서재응 최희섭 이범호 김민재 박경완 진갑용 조인성 ' +
    '이재원 김강민 정성훈 유한준 박한이 김주찬 이택근 손민한 장원준 차우찬 유희관 김재호 오재원 민병헌 김재윤 이용찬'
  ).split(' '),
);

export interface GenCtx {
  rng: Rng;
  used: Set<string>;
  prefix: string; // 선수 id 접두 (시즌마다 달라야 중복이 없다)
  seq: number;
}

export function makeCtx(rng: Rng, prefix: string, usedNames: Iterable<string> = []): GenCtx {
  return { rng, used: new Set(usedNames), prefix, seq: 0 };
}

function genName(ctx: GenCtx, foreign: boolean): string {
  const r = ctx.rng;
  for (let i = 0; i < 500; i++) {
    let name: string;
    if (foreign) {
      name = `${pick(r, FOREIGN_FIRST)} ${pick(r, FOREIGN_LAST)}`;
    } else {
      const a = pick(r, GIVEN_A);
      const b = pick(r, GIVEN_B);
      if (a === b) continue;
      name = pick(r, SURNAMES) + a + b;
      if (BLOCKED.has(name)) continue;
    }
    if (ctx.used.has(name)) continue;
    ctx.used.add(name);
    return name;
  }
  // 극단적으로 이름이 고갈된 경우의 안전장치
  const fallback = `선수${ctx.prefix}${ctx.seq}`;
  ctx.used.add(fallback);
  return fallback;
}

export function batZero(): BatStats {
  return { g: 0, pa: 0, ab: 0, h: 0, d2: 0, hr: 0, rbi: 0, bb: 0, so: 0, r: 0, d3: 0, sb: 0, cs: 0 };
}
export function pitZero(): PitStats {
  return { g: 0, gs: 0, outs: 0, er: 0, h: 0, bb: 0, so: 0, hr: 0, w: 0, l: 0, sv: 0 };
}
export function recZero(): TeamRecord {
  return { w: 0, l: 0, t: 0, rs: 0, ra: 0, streak: 0, last10: [] };
}
export function ledgerZero(): Ledger {
  return { ticket: 0, food: 0, merch: 0, league: 0, sales: 0, salary: 0, upkeep: 0, interest: 0, signing: 0, facility: 0 };
}

// ── 능력치 ──
type BatKey = 'con' | 'pow' | 'eye' | 'spd' | 'def';
type PitKey = 'stf' | 'ctl' | 'sta';
type Abil = Partial<Record<BatKey | PitKey, number>>;

const POS_ADJ: Record<BatPos, Record<BatKey, number>> = {
  C: { con: -2, pow: 0, eye: 0, spd: -8, def: 8 },
  '1B': { con: 0, pow: 8, eye: 1, spd: -6, def: -5 },
  '2B': { con: 1, pow: -4, eye: 0, spd: 4, def: 3 },
  '3B': { con: 0, pow: 3, eye: 0, spd: -1, def: 1 },
  SS: { con: 0, pow: -5, eye: -1, spd: 3, def: 8 },
  LF: { con: 1, pow: 3, eye: 0, spd: 1, def: -3 },
  CF: { con: 0, pow: -3, eye: 0, spd: 8, def: 6 },
  RF: { con: 0, pow: 3, eye: 0, spd: 1, def: 0 },
  DH: { con: 2, pow: 8, eye: 3, spd: -6, def: -15 },
};
const ROLE_ADJ: Record<PitchRole, Record<PitKey, number>> = {
  SP: { stf: 0, ctl: 0, sta: 10 },
  RP: { stf: 2, ctl: 0, sta: -14 },
  CP: { stf: 5, ctl: 1, sta: -14 },
};

const rate = (v: number) => clamp(Math.round(v), 20, 97);

/** star: OVR 기반 + 운 */
export function baseStar(ovr: number): number {
  return (ovr - 48) * 2;
}

function genAge(r: Rng): number {
  return clamp(20 + Math.floor(Math.abs(gauss(r)) * 4.5 + r() * 7), 19, 38);
}

interface PlayerOpts {
  age?: number;
  foreign?: boolean;
  tag?: string;
  abil?: Abil; // 지정하면 해당 능력치는 고정값(약간의 흔들림)
  starBonus?: number;
  potMin?: number;
}

export function genPlayer(ctx: GenCtx, pos: BatPos | PitchRole, center: number, o: PlayerOpts = {}): Player {
  const r = ctx.rng;
  const isBat = pos !== 'SP' && pos !== 'RP' && pos !== 'CP';
  const foreign = !!o.foreign;
  const p: Player = {
    id: `${ctx.prefix}${ctx.seq++}`,
    name: genName(ctx, foreign),
    age: o.age ?? (foreign ? randInt(r, 27, 33) : genAge(r)),
    kind: isBat ? 'B' : 'P',
    pos,
    foreign,
    con: 0, pow: 0, eye: 0, spd: 0, def: 0,
    stf: 0, ctl: 0, sta: 0,
    pot: 0, ovr: 0, salary: 0, star: 0, injury: 0,
    bat: batZero(),
    pit: pitZero(),
  };
  if (o.tag) p.tag = o.tag;
  const val = (key: BatKey | PitKey, adj: number) => {
    const fixed = o.abil?.[key];
    return rate(fixed !== undefined ? fixed + gauss(r) * 2 : center + adj + gauss(r) * ABIL_SD);
  };
  if (isBat) {
    const adj = POS_ADJ[pos as BatPos];
    (['con', 'pow', 'eye', 'spd', 'def'] as BatKey[]).forEach((k) => (p[k] = val(k, adj[k])));
  } else {
    const adj = ROLE_ADJ[pos as PitchRole];
    (['stf', 'ctl', 'sta'] as PitKey[]).forEach((k) => (p[k] = val(k, adj[k])));
  }
  finalize(ctx.rng, p, o);
  return p;
}

function finalize(r: Rng, p: Player, o: PlayerOpts = {}): void {
  p.ovr = calcOvr(p);
  const room = p.age <= 22 ? randInt(r, 6, 18) : p.age <= 24 ? randInt(r, 3, 12) : p.age <= 27 ? randInt(r, 0, 5) : 0;
  p.pot = clamp(Math.max(p.ovr + room, o.potMin ?? 0), p.ovr, 99);
  p.salary = calcSalary(p);
  p.star = clamp(Math.round(baseStar(p.ovr) + gauss(r) * 7 + (o.starBonus ?? 0) + (p.foreign ? 5 : 0)), 0, 100);
}

/** 능력치 전체를 밀어 목표 OVR 에 맞춘다 (FA 등급 생성용) */
function shiftToOvr(r: Rng, p: Player, target: number, o: PlayerOpts = {}): void {
  const keys: (BatKey | PitKey)[] = p.kind === 'B' ? ['con', 'pow', 'eye', 'spd', 'def'] : ['stf', 'ctl', 'sta'];
  for (let i = 0; i < 6; i++) {
    const d = target - calcOvr(p);
    if (d === 0) break;
    for (const k of keys) p[k] = rate(p[k] + d);
  }
  finalize(r, p, o);
}

// ── KBO 스타 유형 아키타입 (이름은 전부 가명) ──
interface Arch {
  pos: (BatPos | PitchRole)[];
  tag: string;
  abil: Abil;
  age: [number, number];
  foreign?: boolean;
}

const ARCHETYPES: Arch[] = [
  { pos: ['CF', 'RF', 'LF'], tag: '교타형 외야수 · 타격왕 후보', abil: { con: 92, pow: 62, eye: 80, spd: 76, def: 70 }, age: [25, 30] },
  { pos: ['1B'], tag: '홈런왕형 1루수', abil: { con: 67, pow: 94, eye: 74, spd: 40, def: 52 }, age: [28, 34] },
  { pos: ['3B'], tag: '30-30형 3루수', abil: { con: 78, pow: 84, eye: 66, spd: 88, def: 68 }, age: [22, 27] },
  { pos: ['C'], tag: '안방마님 포수', abil: { con: 72, pow: 76, eye: 74, spd: 36, def: 88 }, age: [30, 36] },
  { pos: ['SS'], tag: '수비형 유격수 · 골든글러브급', abil: { con: 64, pow: 48, eye: 60, spd: 76, def: 94 }, age: [26, 32] },
  { pos: ['DH'], tag: '베테랑 지명타자', abil: { con: 77, pow: 80, eye: 84, spd: 30, def: 30 }, age: [36, 39] },
  { pos: ['2B'], tag: '리드오프 2루수 · 출루 머신', abil: { con: 82, pow: 46, eye: 84, spd: 90, def: 74 }, age: [25, 31] },
  { pos: ['LF', 'RF', '1B'], tag: '외인 거포', abil: { con: 69, pow: 92, eye: 64, spd: 56, def: 56 }, age: [27, 32], foreign: true },
  { pos: ['SP'], tag: '토종 에이스', abil: { stf: 85, ctl: 84, sta: 86 }, age: [26, 32] },
  { pos: ['SP'], tag: '외인 1선발', abil: { stf: 89, ctl: 77, sta: 83 }, age: [27, 32], foreign: true },
  { pos: ['SP'], tag: '파이어볼러 · 150km 중반', abil: { stf: 93, ctl: 58, sta: 72 }, age: [21, 25] },
  { pos: ['SP'], tag: '제구형 좌완', abil: { stf: 66, ctl: 93, sta: 80 }, age: [27, 34] },
  { pos: ['CP'], tag: '끝판왕 마무리', abil: { stf: 93, ctl: 82, sta: 40 }, age: [28, 36] },
  { pos: ['RP'], tag: '필승조 셋업', abil: { stf: 85, ctl: 75, sta: 46 }, age: [24, 31] },
];
const VETERAN_DH = 5; // ARCHETYPES 인덱스

interface Slot {
  pos: BatPos | PitchRole;
  center: number;
  starter: boolean;
  age?: [number, number];
  tag?: string;
  starBonus?: number;
}

function rosterSlots(r: Rng, tier: number, legacy = false): Slot[] {
  const starters: BatPos[] = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH'];
  const pitchers: Slot[] = [
    ...SP_OFFSETS.map((d): Slot => ({ pos: 'SP', center: tier + d, starter: true })),
    ...[0, 1, 2, 3].map((): Slot => ({ pos: 'RP', center: tier + RP_OFFSET, starter: true })),
    { pos: 'CP', center: tier + CP_OFFSET, starter: true },
  ];
  if (legacy) {
    const dup = new Set(shuffle(r, ['1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH'] as BatPos[]).slice(0, LEGACY_N));
    const bat: Slot[] = [];
    for (const pos of starters) {
      if (!dup.has(pos)) {
        bat.push({ pos, center: tier + STARTER_BONUS, starter: true });
        continue;
      }
      bat.push({ pos, center: tier + LEGACY_VET, starter: true, age: LEGACY_VET_AGE, tag: '왕년의 주전', starBonus: LEGACY_VET_STAR });
      bat.push({ pos, center: tier + LEGACY_NEXT, starter: false, age: LEGACY_NEXT_AGE });
    }
    return [...bat, ...pitchers];
  }
  const bench: BatPos[] = ['C', pick(r, ['2B', 'SS', '3B'] as BatPos[]), pick(r, ['LF', 'CF', 'RF'] as BatPos[]), pick(r, ['1B', '3B', 'LF'] as BatPos[])];
  return [
    ...starters.map((pos): Slot => ({ pos, center: tier + STARTER_BONUS, starter: true })),
    ...bench.map((pos): Slot => ({ pos, center: tier - BENCH_PENALTY, starter: false })),
    ...pitchers,
  ];
}

function genTeam(ctx: GenCtx, def: TeamDef, archs: Arch[], prospect: boolean): Team {
  const r = ctx.rng;
  const slots = rosterSlots(r, def.tier, def.id === USER_ID);
  const roster: (Player | null)[] = slots.map(() => null);
  const shift = (def.tier - ARCH_TIER_REF) * 0.4;

  for (const a of archs) {
    const idx = slots.findIndex((s, i) => s.starter && !roster[i] && a.pos.includes(s.pos));
    if (idx < 0) continue;
    const abil: Abil = {};
    for (const [k, v] of Object.entries(a.abil)) abil[k as BatKey | PitKey] = (v as number) + shift;
    roster[idx] = genPlayer(ctx, slots[idx].pos, def.tier, {
      abil,
      tag: a.tag,
      foreign: a.foreign,
      age: randInt(r, a.age[0], a.age[1]),
      starBonus: 14,
    });
  }
  if (prospect) {
    // 유저 팀 전용: 당장은 평범하지만 잠재력이 큰 유망주
    const cands = slots.map((s, i) => i).filter((i) => slots[i].starter && !roster[i] && slots[i].pos !== 'DH' && slots[i].pos !== 'RP');
    const idx = pick(r, cands);
    roster[idx] = genPlayer(ctx, slots[idx].pos, def.tier + 5, {
      tag: '특급 유망주',
      age: randInt(r, 19, 21),
      starBonus: 22,
      potMin: randInt(r, 84, 91),
    });
  }
  slots.forEach((s, i) => {
    if (!roster[i]) roster[i] = genPlayer(ctx, s.pos, s.center, { ...(s.age ? { age: randInt(r, s.age[0], s.age[1]) } : {}), tag: s.tag, starBonus: s.starBonus });
  });

  const team: Team = {
    id: def.id,
    city: def.city,
    name: def.name,
    color: def.color,
    color2: def.color2,
    pop: def.pop,
    roster: roster as Player[],
    lineup: [],
    rotation: [],
    bullpen: [],
    closer: null,
    nextStarter: 0,
    rec: recZero(),
  };
  autoLineup(team);
  return team;
}

/** FA 풀 18명: 스타 3 / 준척 6 / 저가·유망주 9 */
export function genFreeAgents(ctx: GenCtx): Player[] {
  const r = ctx.rng;
  const batPos: BatPos[] = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH'];
  const anyPos = (): BatPos | PitchRole => (r() < 0.58 ? pick(r, batPos) : pick(r, ['SP', 'SP', 'SP', 'RP', 'RP', 'CP'] as PitchRole[]));
  const out: Player[] = [];

  // 스타급: 타자 1 · 선발 1 · 무작위 1
  const starPos: (BatPos | PitchRole)[] = [pick(r, ['1B', '3B', 'LF', 'RF', 'CF'] as BatPos[]), 'SP', anyPos()];
  for (const pos of starPos) {
    const foreign = r() < 0.35;
    // FA 자격은 늦게 온다: 대어는 전성기의 끝자락에 시장에 나온다
    const p = genPlayer(ctx, pos, 80, { foreign, age: randInt(r, 30, 34), tag: foreign ? 'FA 대어 · 외인 스타' : 'FA 대어' });
    shiftToOvr(r, p, randInt(r, 78, 85));
    p.star = clamp(Math.max(p.star, randInt(r, 74, 90)), 0, 100);
    out.push(p);
  }
  // 준척급
  for (let i = 0; i < 6; i++) {
    const p = genPlayer(ctx, anyPos(), 69, { age: randInt(r, 26, 34), tag: '준척급 FA' });
    shiftToOvr(r, p, randInt(r, 65, 74));
    out.push(p);
  }
  // 저가 베테랑 + 유망주
  for (let i = 0; i < 9; i++) {
    const prospect = i < 4;
    const o: PlayerOpts = prospect
      ? { age: randInt(r, 19, 22), tag: '미완의 유망주', potMin: randInt(r, 72, 86) }
      : { age: randInt(r, 28, 36), tag: '저가 FA' };
    const p = genPlayer(ctx, anyPos(), 56, o);
    shiftToOvr(r, p, prospect ? randInt(r, 50, 57) : randInt(r, 54, 62), o);
    out.push(p);
  }
  return out;
}

/** 8개 구단 + 선수 + FA + 일정 생성. 유저 = 'JEJ' */
export function newCore(seed: number, nickname?: string): Core {
  const rng = mulberry32(seed);
  const ctx = makeCtx(rng, 'p');

  // 아키타입 덱을 섞어 구단별로 나눠 준다 (팀 내 중복 없음, 타자·투수 섞임)
  let deck: Arch[] = [];
  const draw = (n: number, taken: Arch[]): Arch[] => {
    const got: Arch[] = [];
    let guard = 0;
    while (got.length < n && guard++ < 200) {
      if (!deck.length) deck = shuffle(rng, ARCHETYPES);
      const a = deck.shift()!;
      const clash = [...taken, ...got].some((x) => x === a || (x.pos.length === 1 && a.pos.length === 1 && x.pos[0] === a.pos[0] && a.pos[0] !== 'SP'));
      if (clash) continue;
      got.push(a);
    }
    return got;
  };

  const teams = TEAM_DEFS.map((def0) => {
    // 유저 구단은 별칭만 바꿀 수 있다 (연고지·약칭·색은 고정)
    const def = def0.id === USER_ID && nickname ? { ...def0, name: nickname } : def0;
    if (def.id === USER_ID) {
      const veteran = rng() < 0.5;
      return genTeam(ctx, def, veteran ? [ARCHETYPES[VETERAN_DH]] : [], !veteran);
    }
    return genTeam(ctx, def, draw(def.stars, []), false);
  });

  const freeAgents = genFreeAgents(ctx);
  const schedule = buildSchedule(teams.map((t) => t.id), rng);

  return {
    seed,
    season: 1,
    day: 0,
    phase: 'season',
    userId: USER_ID,
    teams,
    schedule,
    freeAgents,
    finance: { cash: START_CASH, debt: 0, ticketPrice: START_PRICE, ledger: ledgerZero() },
    facilities: { seats: 0, food: 0, training: 0 },
    fans: START_FANS,
    fanSat: 50,
    crowd: null,
    attHistory: [],
    cashHistory: [START_CASH],
    // 첫 뉴스: 부임 기사 + 지난 다섯 시즌 순위 (story.ts)
    news: PREMISE_NEWS.map((text, i) => ({ id: PREMISE_NEWS.length - 1 - i, season: 1, day: 0, text, tone: 'info' as const })),
    newsSeq: PREMISE_NEWS.length,
    campaign: campaignZero(),
    post: null,
    draft: null,
  };
}

/** 빈 캠페인 상태. 시즌 목표(objectives)는 campaign.ts 가 첫 진행 때 채운다. */
export function campaignZero(): Campaign {
  return {
    stage: 0,
    trust: 60,
    objectives: [],
    achievements: [],
    titles: 0,
    history: [],
    event: null,
    eventsSeen: [],
    buffs: [],
    sellouts: 0,
    ending: false,
    verdict: null,
    hints: {},
    retired: [],
    managerYielded: false,
    analyst: false,
    dealt: false,
  };
}
