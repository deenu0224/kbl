// 선수단 분석 (프런트 오피스 화면용): 포지션별 리그 순위, 뎁스, 연봉 가성비, 잠재력 규칙 요약.
// 전부 읽기 전용 계산이다. 규칙 숫자는 season.ts / economy.ts / draft.ts 의 상수를 그대로 쓴다.
import type { BatPos, Core, Player, Team } from './types';
import { batValue, effDef, teamParts, type TeamParts } from './ratings';
import { slotNewcomer } from './lineup';
import { BENCH_GROW, FARM_CAP, FARM_LOCK, farmMax, MIN_BATTERS, MIN_PITCHERS, ROSTER_MAX, TRAIN_LV, activeRoster, farmGrow, farmRoster, payroll, userTeam } from './economy';
import { DECLINE_AGE, DECLINE_RATE, PLAY_GROW, PLAY_GROW_AGE, TRAIN_MAX_AGE, WEEK, farmLockLeft, growChance, ilLock, marketSalary } from './season';
import { ANALYST_NOISE, SCOUT_CUT, SCOUT_NOISE } from './draft';
import { isFranchise } from './franchise';

// ───────── 포지션 점수 ─────────

export type PosKey = BatPos | 'SP' | 'RP' | 'CP';
export const FIELD_KEYS: BatPos[] = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH'];
export const PITCH_KEYS: ('SP' | 'RP' | 'CP')[] = ['SP', 'RP', 'CP'];
export const POS_KEYS: PosKey[] = [...FIELD_KEYS, ...PITCH_KEYS];
export const POS_LABEL: Record<PosKey, string> = {
  C: '포수', '1B': '1루', '2B': '2루', '3B': '3루', SS: '유격', LF: '좌익', CF: '중견', RF: '우익', DH: '지타',
  SP: '선발진', RP: '불펜', CP: '마무리',
};
// 포지션 점수에서 수비가 차지하는 비중 (lineup.ts 의 자리 가치와 같은 값)
const DEF_WEIGHT: Record<BatPos, number> = { C: 0.7, SS: 0.7, CF: 0.6, '2B': 0.5, '3B': 0.45, RF: 0.4, LF: 0.35, '1B': 0.3, DH: 0 };
const PEN_FRONT = 4; // 불펜 점수에 넣는 앞쪽(필승조) 인원
const THIN_GAP = 6; // 백업이 리그 백업 평균보다 이만큼 낮으면 "빈 뎁스"
const FIELD_OK_PEN = 4; // 수비 페널티가 이 이하면 "볼 수 있는 자리"

/** 그 수비 위치에 세웠을 때의 점수 (0~99 눈금): 타격 가치와 그 자리 수비력을 자리별 비중으로 합친다 */
export function posScore(p: Player, pos: BatPos): number {
  const w = DEF_WEIGHT[pos];
  return (batValue(p) + effDef(p, pos) * w) / (1 + w);
}

const mean = (xs: number[]): number => (xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : 0);
const r1 = (v: number): number => Math.round(v * 10) / 10;

interface Unit {
  players: Player[]; // 주전 (타자 1명 / 선발 5 / 불펜 앞 4 / 마무리 1)
  score: number;
  backup: Player | null;
  backupScore: number;
}

function unitOf(t: Team, key: PosKey): Unit {
  const byId = new Map(t.roster.map((p) => [p.id, p]));
  const get = (ids: (string | null)[]) => ids.map((id) => (id ? byId.get(id) : undefined)).filter((p): p is Player => !!p);
  if (key === 'SP' || key === 'RP' || key === 'CP') {
    const rot = get(t.rotation);
    const pen = get(t.bullpen);
    const cl = get([t.closer]);
    const players = key === 'SP' ? rot : key === 'RP' ? pen.slice(0, PEN_FRONT) : cl;
    // 백업: 선발은 로테이션 밖의 선발 자원, 불펜은 필승조 다음 투수, 마무리는 불펜 맨 앞
    const rest = key === 'SP' ? pen.filter((p) => p.pos === 'SP').sort((a, b) => b.ovr - a.ovr) : key === 'RP' ? pen.slice(PEN_FRONT) : pen;
    const backup = rest[0] ?? null;
    return { players, score: mean(players.map((p) => p.ovr)), backup, backupScore: backup ? backup.ovr : 0 };
  }
  const slot = t.lineup.find((l) => l.pos === key);
  const starter = slot ? byId.get(slot.pid) : undefined;
  const inLineup = new Set(t.lineup.map((l) => l.pid));
  const bench = t.roster.filter((p) => p.kind === 'B' && !p.farm && !inLineup.has(p.id)).sort((a, b) => posScore(b, key) - posScore(a, key));
  const backup = bench[0] ?? null;
  return { players: starter ? [starter] : [], score: starter ? posScore(starter, key) : 0, backup, backupScore: backup ? posScore(backup, key) : 0 };
}

export interface PosRow {
  key: PosKey;
  label: string;
  kind: 'B' | 'P';
  players: Player[]; // 우리 주전
  score: number; // 우리 주전의 포지션 점수 (투수는 OVR 평균)
  rank: number; // 리그 순위 (1 = 최고)
  of: number; // 구단 수
  avg: number; // 리그 평균
  diff: number; // 우리 − 리그 평균
  backup: Player | null;
  backupScore: number;
  backupAvg: number; // 리그 백업 평균
  thin: boolean; // 빈 뎁스: 백업이 없거나 리그 백업 평균보다 크게 낮다
  age: number; // 주전 나이 (여럿이면 평균)
  salary: number; // 주전 연봉 (여럿이면 합)
  rank0?: number; // 개막 시점 순위 (campaign.posRank0)
  weak: boolean; // 가장 약한 2곳
  strong: boolean; // 가장 강한 2곳
}

/** 수비 9포지션 + 선발진·불펜·마무리의 리그 내 위치 */
export function positionReport(core: Core): PosRow[] {
  const me = userTeam(core);
  const base = core.campaign.posRank0?.season === core.season ? core.campaign.posRank0.ranks : undefined;
  const rows = POS_KEYS.map((key): PosRow => {
    const all = core.teams.map((t) => ({ id: t.id, u: unitOf(t, key) }));
    const mine = all.find((x) => x.id === me.id)!.u;
    const avg = mean(all.map((x) => x.u.score));
    const backupAvg = mean(all.map((x) => x.u.backupScore));
    return {
      key,
      label: POS_LABEL[key],
      kind: PITCH_KEYS.includes(key as 'SP') ? 'P' : 'B',
      players: mine.players,
      score: r1(mine.score),
      rank: 1 + all.filter((x) => x.u.score > mine.score + 1e-9).length,
      of: all.length,
      avg: r1(avg),
      diff: r1(mine.score - avg),
      backup: mine.backup,
      backupScore: r1(mine.backupScore),
      backupAvg: r1(backupAvg),
      thin: !mine.backup || mine.backupScore < backupAvg - THIN_GAP,
      age: Math.round(mean(mine.players.map((p) => p.age))),
      salary: mine.players.reduce((s, p) => s + p.salary, 0),
      rank0: base?.[key],
      weak: false,
      strong: false,
    };
  });
  const half = Math.ceil(core.teams.length / 2);
  const worst = rows.slice().sort((a, b) => b.rank - a.rank || a.diff - b.diff);
  const best = rows.slice().sort((a, b) => a.rank - b.rank || b.diff - a.diff);
  for (const r of worst.slice(0, 2)) if (r.rank > half) r.weak = true;
  for (const r of best.slice(0, 2)) if (r.rank <= half && !r.weak) r.strong = true;
  return rows;
}

/** 포지션 key → 순위 (개막 시점 기록용) */
export function rankMap(rows: PosRow[]): Record<string, number> {
  return Object.fromEntries(rows.map((r) => [r.key, r.rank]));
}

/** 자유계약·신인이 메울 수 있는 자리 key (지명타자는 타자 전부가 후보) */
export function posKeyOf(p: Player): PosKey {
  return p.pos as PosKey;
}
export const fitsKey = (p: Player, key: PosKey): boolean => (key === 'DH' ? p.kind === 'B' : p.pos === key);

// ───────── 뎁스 ─────────

export interface DepthLine {
  key: PosKey;
  label: string;
  thin: boolean;
  backupAvg: number;
  slots: { p: Player; score: number; starter: boolean; farm?: boolean }[]; // 1~3순위 (+ 2군 후보)
}

/** 포지션별 1·2·3순위. 타자는 그 자리에 세웠을 때의 점수 순(주전이 맨 앞), 투수는 현재 보직 순 */
export function depthChart(core: Core, rows: PosRow[] = positionReport(core)): DepthLine[] {
  const t = userTeam(core);
  const byId = new Map(t.roster.map((p) => [p.id, p]));
  const get = (ids: (string | null)[]) => ids.map((id) => (id ? byId.get(id) : undefined)).filter((p): p is Player => !!p);
  return rows.map((r) => {
    let slots: DepthLine['slots'];
    if (r.kind === 'P') {
      const pen = get(t.bullpen);
      const list = r.key === 'SP' ? [...get(t.rotation), ...pen.filter((p) => p.pos === 'SP')] : r.key === 'RP' ? pen : [...get([t.closer]), ...pen];
      const nStart = r.key === 'SP' ? t.rotation.length : r.key === 'RP' ? PEN_FRONT : 1;
      slots = list.map((p, i) => ({ p, score: p.ovr, starter: i < nStart }));
      if (r.key !== 'CP') slots = slots.slice(0, nStart + 2);
      else slots = slots.slice(0, 3);
    } else {
      const pos = r.key as BatPos;
      const starter = r.players[0];
      const inLineup = new Set(t.lineup.map((l) => l.pid));
      const bench = t.roster.filter((p) => p.kind === 'B' && !p.farm && !inLineup.has(p.id)).sort((a, b) => posScore(b, pos) - posScore(a, pos));
      slots = [...(starter ? [starter] : []), ...bench.slice(0, 2)].map((p, i) => ({ p, score: r1(posScore(p, pos)), starter: i === 0 && !!starter }));
      // 2군 후보: 그 자리가 본 포지션인 2군 최고 선수
      const kid = t.roster.filter((p) => p.farm && !p.il && p.pos === pos).sort((a, b) => b.ovr - a.ovr)[0];
      if (kid) slots.push({ p: kid, score: r1(posScore(kid, pos)), starter: false, farm: true });
    }
    if (r.kind === 'P') {
      const kid = t.roster.filter((p) => p.farm && !p.il && p.pos === r.key).sort((a, b) => b.ovr - a.ovr)[0];
      if (kid) slots.push({ p: kid, score: kid.ovr, starter: false, farm: true });
    }
    return { key: r.key, label: r.label, thin: r.thin, backupAvg: r.backupAvg, slots };
  });
}

/** 본 포지션 말고도 수비 손실이 작은 자리 (페널티 4 이하) */
export function canPlay(p: Player): BatPos[] {
  if (p.kind !== 'B') return [];
  return FIELD_KEYS.filter((pos) => pos !== 'DH' && (pos === p.pos || p.def - effDef(p, pos) <= FIELD_OK_PEN));
}

// ───────── 연봉 ─────────

/** 기대 연봉(그 시즌 시장가: OVR·나이 기준 연봉 곡선) − 실제 연봉. 양수 = 저평가(싸게 쓰는 중) */
export function valueGap(p: Player, season: number): number {
  return marketSalary(p, season) - p.salary;
}
export const VALUE_FAIR = 1000; // 이 안쪽은 "적정" (만원)

export interface SalaryReport {
  total: number;
  rank: number; // 리그에서 몇 번째로 많이 쓰는가
  of: number;
  leagueAvg: number;
  groups: { label: string; n: number; sum: number; share: number }[];
  over: { p: Player; gap: number }[]; // 고평가(비싸게 쓰는) 상위 3
  under: { p: Player; gap: number }[]; // 저평가 상위 3
  ages: { label: string; n: number; sum: number }[];
}

const GROUPS: [string, (p: Player) => boolean][] = [
  ['포수', (p) => p.pos === 'C'],
  ['내야', (p) => ['1B', '2B', '3B', 'SS'].includes(p.pos)],
  ['외야', (p) => ['LF', 'CF', 'RF'].includes(p.pos)],
  ['지타', (p) => p.pos === 'DH'],
  ['선발', (p) => p.pos === 'SP'],
  ['불펜', (p) => p.pos === 'RP' || p.pos === 'CP'],
];
const AGES: [string, (a: number) => boolean][] = [
  ['25세 이하', (a) => a <= 25],
  ['26~32세', (a) => a >= 26 && a <= 32],
  ['33세 이상', (a) => a >= 33],
];

export function salaryReport(core: Core): SalaryReport {
  const t = userTeam(core);
  const total = payroll(t);
  const all = core.teams.map(payroll);
  const sum = (ps: Player[]) => ps.reduce((s, p) => s + p.salary, 0);
  const gaps = t.roster.map((p) => ({ p, gap: valueGap(p, core.season) }));
  return {
    total,
    rank: 1 + all.filter((v) => v > total).length,
    of: all.length,
    leagueAvg: Math.round(mean(all)),
    groups: GROUPS.map(([label, f]) => {
      const ps = t.roster.filter(f);
      return { label, n: ps.length, sum: sum(ps), share: total ? sum(ps) / total : 0 };
    }),
    over: gaps.filter((x) => x.gap < -VALUE_FAIR).sort((a, b) => a.gap - b.gap).slice(0, 3),
    under: gaps.filter((x) => x.gap > VALUE_FAIR).sort((a, b) => b.gap - a.gap).slice(0, 3),
    ages: AGES.map(([label, f]) => {
      const ps = t.roster.filter((p) => f(p.age));
      return { label, n: ps.length, sum: sum(ps) };
    }),
  };
}

// ───────── 영입 시 전력 변화 ─────────

export interface SignImpact {
  role: string; // 들어갈 자리 ("주전 라인업", "벤치" …)
  delta: Partial<Record<keyof TeamParts, number>>; // 변한 칸만
  total: number; // 네 칸 변화의 합
}

/** 이 선수를 데려오면 들어갈 자리와 전력 4칸의 변화 (복제본에만 적용) */
export function signImpact(team: Team, fa: Player): SignImpact {
  const t = structuredClone(team);
  const p = structuredClone(fa);
  t.roster.push(p);
  const role = slotNewcomer(t, p);
  const a = teamParts(team);
  const b = teamParts(t);
  const delta: SignImpact['delta'] = {};
  let total = 0;
  for (const k of ['bat', 'def', 'rot', 'pen'] as const) {
    if (a[k] !== b[k]) delta[k] = b[k] - a[k];
    total += b[k] - a[k];
  }
  return { role, delta, total };
}

// ───────── 잠재력: 실제 성장 규칙 ─────────

/** 시즌이 바뀔 때의 능력치별 변화 범위 (season.ts develop 과 같은 값. 나이는 새 시즌 나이) */
export const DEVELOP_BANDS: { label: string; min: number; max: number; lo: number; hi: number; note?: string }[] = [
  { label: '25세 이하', min: 0, max: 25, lo: 0, hi: 3, note: '잠재력에 닿으면 −1~+1' },
  { label: '26~30세', min: 26, max: 30, lo: -1, hi: 1 },
  { label: '31~33세', min: 31, max: 33, lo: -2, hi: 1, note: '주력·체력은 −1 더' },
  { label: '34세 이상', min: 34, max: 99, lo: -3, hi: 0, note: '주력·체력은 −1 더' },
];
// 훈련 성과 1회: 능력치 하나 +1~2(평균 1.5) 와 다른 하나 +1. OVR 로는 능력치 가중치 평균만큼 오른다
const GAIN_PER_HIT: Record<'B' | 'P', number> = { B: (1.5 + 1) / 5, P: (1.5 + 1) / 3 };

export interface GrowthInfo {
  room: number; // 잠재력 − 현재 OVR
  mine: boolean; // 우리 선수인가 (훈련은 우리 구단만 한다)
  trains: boolean; // 시즌 중 훈련 성장 대상인가
  maxAge: number; // 훈련 성장 나이 상한
  week: number; // 훈련 주기 (경기)
  facility: string; // 지금 훈련장 이름
  base: number; // 훈련장의 주당 성장 확률 (0~1)
  chance: number; // 이 선수의 주당 확률 (주전 가산 반영)
  playing: boolean; // 주전 가산을 받는 중
  playAge: number; // 주전 가산 나이 상한
  playMult: number;
  farm: boolean; // 2군 소속
  rates: { starter: number; bench: number; farm: number }; // 이 선수가 1군 주전 / 1군 벤치 / 2군일 때의 주당 확률
  farmCap: number; // 2군에서 오를 수 있는 OVR 상한
  capped: boolean; // 2군 상한에 닿았다 (1군에서만 더 자란다)
  left: number; // 이번 시즌 남은 훈련 횟수
  expect: number; // 남은 시즌 기대 OVR 성장 (여지를 넘지 않는다)
  decline: { age: number; rate: number } | null; // 시즌 중 노쇠 대상이면
  nextBand: (typeof DEVELOP_BANDS)[number]; // 다음 시즌 나이대
}

export function growthInfo(core: Core, p: Player): GrowthInfo {
  const t = userTeam(core);
  const mine = t.roster.some((x) => x.id === p.id);
  const lv = TRAIN_LV[core.facilities.training];
  const room = Math.max(0, p.pot - p.ovr);
  const trains = p.age <= TRAIN_MAX_AGE && room > 0;
  const inPlay = new Set([...t.lineup.map((x) => x.pid), ...t.rotation, ...(t.closer ? [t.closer] : [])]);
  const playing = mine && p.age <= PLAY_GROW_AGE && inPlay.has(p.id);
  const young = p.age <= PLAY_GROW_AGE;
  const rates = { starter: Math.min(1, lv.grow * (young ? PLAY_GROW : 1)), bench: lv.grow * (young ? BENCH_GROW : 1), farm: p.ovr >= FARM_CAP ? 0 : farmGrow(core.facilities) };
  const farm = mine && !!p.farm;
  const capped = farm && p.ovr >= FARM_CAP && room > 0;
  const chance = !trains ? 0 : !mine ? lv.grow : farm ? rates.farm : playing ? rates.starter : rates.bench;
  const total = core.schedule.length;
  const left = core.phase === 'season' ? Math.max(0, Math.floor(total / WEEK) - Math.floor(core.day / WEEK)) : 0;
  const expect = trains ? Math.min(farm ? Math.max(0, FARM_CAP - p.ovr) : room, r1(left * chance * GAIN_PER_HIT[p.kind] * (farm && p.kind === 'B' ? 2 : 1))) : 0;
  const nextAge = p.age + 1;
  return {
    room,
    mine,
    trains,
    maxAge: TRAIN_MAX_AGE,
    week: WEEK,
    facility: lv.name,
    base: lv.grow,
    chance,
    playing,
    playAge: PLAY_GROW_AGE,
    playMult: PLAY_GROW,
    farm,
    rates,
    farmCap: FARM_CAP,
    capped,
    left,
    expect,
    decline: p.age >= DECLINE_AGE ? { age: DECLINE_AGE, rate: DECLINE_RATE } : null,
    nextBand: DEVELOP_BANDS.find((b) => nextAge >= b.min && nextAge <= b.max) ?? DEVELOP_BANDS[DEVELOP_BANDS.length - 1],
  };
}

/** 스카우트 등급의 뜻: 추정 잠재력 구간과 오차(표준편차). 분석원을 채용하면 오차가 준다 */
export function scoutInfo(analyst: boolean, grade: Player['scout']): { lo: number; hi: number | null; noise: number; cuts: string } {
  const noise = analyst ? ANALYST_NOISE : SCOUT_NOISE;
  const i = SCOUT_CUT.findIndex(([, g]) => g === grade);
  const lo = i >= 0 ? SCOUT_CUT[i][0] : 0;
  const hi = i > 0 ? SCOUT_CUT[i - 1][0] - 1 : i === 0 ? null : SCOUT_CUT[SCOUT_CUT.length - 1][0] - 1;
  const cuts = [...SCOUT_CUT.map(([c, g]) => `${g} ${c}+`), `D ${SCOUT_CUT[SCOUT_CUT.length - 1][0]} 미만`].join(' · ');
  return { lo, hi, noise, cuts };
}

/** 등급으로 본 성장 여지 추정 구간 (신인: 실제 잠재력은 숨겨져 있다) */
export function scoutRoom(analyst: boolean, p: Player): { lo: number; hi: number | null } {
  const s = scoutInfo(analyst, p.scout);
  return { lo: Math.max(0, s.lo - p.ovr), hi: s.hi === null ? null : Math.max(0, s.hi - p.ovr) };
}

/** 표의 상태 칸 */
export function statusTags(p: Player, season: number, mine: boolean): { text: string; tone: 'bad' | 'warn' | 'good' | 'hi' }[] {
  const out: { text: string; tone: 'bad' | 'warn' | 'good' | 'hi' }[] = [];
  const rehab = mine && !!p.farm && !!p.il;
  if (rehab) out.push({ text: p.injury > 0 ? `재활 ${p.injury}경기` : '재활 끝', tone: p.injury > 0 ? 'bad' : 'good' });
  else if (p.injury > 0) out.push({ text: p.ban ? `징계 ${p.ban}경기` : `부상 ${p.injury}`, tone: 'bad' });
  if ((p.tired ?? 0) > 0) out.push({ text: `연투 ${p.tired}`, tone: 'warn' });
  if (mine && p.farm && !rehab) out.push({ text: '2군', tone: 'warn' });
  if (p.rookie) out.push({ text: '신인', tone: 'good' });
  if (mine && isFranchise(p, season)) out.push({ text: '프랜차이즈', tone: 'hi' });
  if (p.foreign) out.push({ text: '외인', tone: 'warn' });
  return out;
}

// ───────── 2군 ─────────

const POS_KO_SHORT: Record<string, string> = { C: '포수', '1B': '1루', '2B': '2루', '3B': '3루', SS: '유격', LF: '좌익', CF: '중견', RF: '우익', DH: '지타', SP: '선발', RP: '불펜', CP: '마무리' };

/** [콜업] 을 누르기 전에 보이는 결과 한 줄. ok=false 면 지금은 올릴 수 없다 */
export function callUpPreview(core: Core, p: Player): { ok: boolean; text: string } {
  const t = userTeam(core);
  const left = farmLockLeft(core, p);
  if (left > 0) return { ok: false, text: p.il ? `${p.ban ? '징계' : '재활'} 중 · ${left}경기 뒤 복귀 가능` : `재등록 ${left}경기 뒤` };
  const n = activeRoster(t).length;
  if (n >= ROSTER_MAX) return { ok: false, text: `1군 ${n}/${ROSTER_MAX} 가득` };
  if (p.injury > 0 || (p.ban ?? 0) > 0) return { ok: true, text: p.ban ? `징계 ${p.ban}경기 · 벤치로` : `부상 ${p.injury}경기 · 벤치로` };
  // 실제 콜업과 같은 함수(slotNewcomer)를 팀 사본에 돌려 본다 — 같은 포지션 주전과 OVR만 비교하던 글은 실제 자리와 자주 달랐다
  const byId = new Map(t.roster.map((x) => [x.id, x]));
  const t2 = structuredClone(t);
  const p2 = t2.roster.find((x) => x.id === p.id)!;
  delete p2.farm;
  delete p2.il;
  delete p2.farmUntil;
  slotNewcomer(t2, p2);
  if (p.kind === 'B') {
    const slot = t2.lineup.find((l) => l.pid === p.id);
    if (!slot) {
      const cur = byId.get(t.lineup.find((l) => l.pos === p.pos)?.pid ?? '');
      return { ok: true, text: `벤치로 (${POS_KO_SHORT[p.pos] ?? p.pos} 주전 ${cur?.ovr ?? '-'})` };
    }
    const was = byId.get(t.lineup.find((l) => l.pos === slot.pos)?.pid ?? '');
    return { ok: true, text: `${POS_KO_SHORT[slot.pos] ?? slot.pos} ${was?.ovr ?? '-'} → ${p.ovr}` };
  }
  if (t2.rotation.includes(p.id)) {
    const out = t.rotation.find((id) => !t2.rotation.includes(id));
    return { ok: true, text: `선발 ${(out && byId.get(out)?.ovr) ?? '-'} → ${p.ovr}` };
  }
  if (t2.closer === p.id) return { ok: true, text: `마무리 ${(t.closer && byId.get(t.closer)?.ovr) ?? '-'} → ${p.ovr}` };
  return { ok: true, text: '불펜으로' };
}

/** [2군으로] 를 누르기 전에 보이는 결과 한 줄 */
export function sendDownPreview(core: Core, p: Player): { ok: boolean; text: string } {
  const t = userTeam(core);
  const same = activeRoster(t).filter((x) => x.kind === p.kind).length;
  const few = same <= (p.kind === 'B' ? MIN_BATTERS : MIN_PITCHERS) ? `1군 ${p.kind === 'B' ? '타자' : '투수'} 최소 ${p.kind === 'B' ? MIN_BATTERS : MIN_PITCHERS}명` : '';
  // 부상·징계 중이면 부상자 명단으로: 2군 정원과 상관없이 1군 자리가 하나 빈다
  if (p.injury > 0) return few ? { ok: false, text: few } : { ok: true, text: `1군 자리 +1 · 복귀 가능: ${core.phase === 'season' ? `${ilLock(p)}경기 뒤` : '개막부터'}` };
  const nf = farmRoster(t).length;
  if (nf >= farmMax(core)) return { ok: false, text: `2군 ${nf}/${farmMax(core)} 가득` };
  if (few) return { ok: false, text: few };
  const pc = (v: number) => `${Math.round(v * 100)}%`;
  const lock = core.phase === 'season' ? `${FARM_LOCK}경기 동안 재등록 불가` : '시즌 전: 재등록 제한 없음';
  const now = growChance(core, t, p);
  const then = growChance(core, t, { ...p, farm: true });
  if (p.age > TRAIN_MAX_AGE || p.ovr >= p.pot) return { ok: true, text: `${lock} · 더 자라지 않는 선수` };
  if (p.ovr >= FARM_CAP) return { ok: true, text: `${lock} · 오버롤 ${FARM_CAP} 이상은 2군에서 안 자란다` };
  return { ok: true, text: `${lock} · 주당 성장 확률 ${pc(now)} → ${pc(then)}` };
}
