// 신인 드래프트 (스토브리그). docs/LEVEL_DESIGN.md 9절.
import type { BatPos, Core, DraftState, PitchRole, Player, Team } from './types';
import { clamp, gauss, pick, randInt, type Rng } from './rng';
import { calcOvr, MIN_SALARY } from './ratings';
import { slotNewcomer } from './lineup';
import { FARM_MAX, ROSTER_MAX, farmRoster, userTeam } from './economy';
import { genPlayer, makeCtx, type GenCtx } from './generate';
import { fmtMoney } from './format';
import { standings } from './season';
import { addNews } from './season';
import { activeBuffs } from './campaign';

// ── 튜닝 상수 ──
// 뉴스용 포지션 이름 (script.ts 의 POS_NAME 과 같은 표기. 순환 참조를 피해 따로 둔다)
const POS_KO_NEWS: Record<string, string> = { SP: '선발', RP: '불펜', CP: '마무리', C: '포수', '1B': '1루수', '2B': '2루수', '3B': '3루수', SS: '유격수', LF: '좌익수', CF: '중견수', RF: '우익수', DH: '지명타자' };

export const DRAFT_POOL = 28;
export const DRAFT_ROUNDS = 3;
export const DRAFT_BONUS = [15000, 8000, 4000]; // 라운드별 계약금 (만원)
const POOL_BAT_SHARE = 0.55; // 풀 중 타자 비율
// 출신별 생성 규칙: 나이, OVR 범위, 잠재력 범위
const ORIGINS: { w: number; age: [number, number]; ovr: [number, number]; pot: [number, number]; tag: string }[] = [
  { w: 0.4, age: [19, 19], ovr: [42, 51], pot: [70, 90], tag: '고졸 원석' },
  { w: 0.25, age: [20, 21], ovr: [47, 56], pot: [64, 80], tag: '얼리 드래프트' },
  { w: 0.35, age: [22, 22], ovr: [53, 62], pot: [55, 72], tag: '대졸 즉전감' },
];
export const SCOUT_NOISE = 5; // 스카우트 등급 산정 시 잠재력 노이즈(표준편차) — 스카우트 팀장의 옛날 눈
export const ANALYST_NOISE = 1.5; // 데이터 분석원을 채용하면
export const SCOUT_CUT: [number, 'A' | 'B' | 'C' | 'D'][] = [
  [80, 'A'],
  [70, 'B'],
  [60, 'C'],
];
const AI_POT_W = 0.6; // AI 지명 점수: 잠재력 추정 비중
const AI_OVR_W = 0.4;
const AI_NEED_BONUS = 5; // 필요 포지션 가산
const AI_NOISE = 4;
export const DRAFT_ID_PREFIX = 'dr'; // 드래프트 출신 선수 id 접두 (업적 판정용)

const BAT_POS: BatPos[] = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'];
const PIT_POS: PitchRole[] = ['SP', 'SP', 'SP', 'RP', 'RP', 'CP'];
type AbilKey = 'con' | 'pow' | 'eye' | 'spd' | 'def' | 'stf' | 'ctl' | 'sta';

/** 능력치를 고르게 밀어 목표 OVR 에 맞춘다 (pot/salary/star 는 건드리지 않음) */
export function shiftOvr(p: Player, target: number): void {
  const keys: AbilKey[] = p.kind === 'B' ? ['con', 'pow', 'eye', 'spd', 'def'] : ['stf', 'ctl', 'sta'];
  for (let i = 0; i < 8; i++) {
    const d = target - calcOvr(p);
    if (d === 0) break;
    for (const k of keys) p[k] = clamp(p[k] + d, 20, 97);
  }
  p.ovr = calcOvr(p);
}

export function scoutGrade(pot: number, rng: Rng, noise = SCOUT_NOISE): 'A' | 'B' | 'C' | 'D' {
  const v = pot + gauss(rng) * noise;
  for (const [cut, g] of SCOUT_CUT) if (v >= cut) return g;
  return 'D';
}

const SCOUT_EST: Record<'A' | 'B' | 'C' | 'D', number> = { A: 84, B: 74, C: 65, D: 57 };

function genProspect(ctx: GenCtx, rng: Rng, quality: number, noise: number): Player {
  const r = rng();
  let acc = 0;
  let o = ORIGINS[ORIGINS.length - 1];
  for (const x of ORIGINS) {
    acc += x.w;
    if (r < acc) {
      o = x;
      break;
    }
  }
  const pos = rng() < POOL_BAT_SHARE ? pick(rng, BAT_POS) : pick(rng, PIT_POS);
  const age = randInt(rng, o.age[0], o.age[1]);
  const p = genPlayer(ctx, pos, 50, { age, tag: o.tag });
  shiftOvr(p, clamp(randInt(rng, o.ovr[0], o.ovr[1]) + Math.round(quality / 2), 30, 80));
  p.pot = clamp(Math.max(p.ovr + 3, randInt(rng, o.pot[0], o.pot[1]) + quality), p.ovr, 99);
  p.salary = MIN_SALARY;
  p.star = clamp(Math.round((p.pot - 60) * 0.8 + gauss(rng) * 6), 0, 60);
  p.scout = scoutGrade(p.pot, rng, noise);
  return p;
}

/** 드래프트 풀 (youth 버프가 있으면 품질↑) */
function genPool(core: Core, rng: Rng): Player[] {
  const names = [...core.teams.flatMap((t) => t.roster.map((p) => p.name)), ...core.freeAgents.map((p) => p.name)];
  const ctx = makeCtx(rng, `${DRAFT_ID_PREFIX}${core.season}-`, names);
  const quality = activeBuffs(core).youth;
  const pool: Player[] = [];
  const noise = core.campaign.analyst ? ANALYST_NOISE : SCOUT_NOISE;
  for (let i = 0; i < DRAFT_POOL; i++) pool.push(genProspect(ctx, rng, quality, noise));
  return pool.sort((a, b) => SCOUT_EST[b.scout!] + b.ovr - (SCOUT_EST[a.scout!] + a.ovr));
}

export function isUserTurn(core: Core): boolean {
  const d = core.draft;
  return core.phase === 'draft' && !!d && d.pick < d.order.length && d.order[d.pick] === core.userId;
}

export function isDraftDone(core: Core): boolean {
  return !core.draft || core.draft.pick >= core.draft.order.length;
}

/** 지금 지명 차례인 라운드 (1부터) */
export function draftRound(d: DraftState): number {
  return Math.min(DRAFT_ROUNDS, Math.floor(d.pick / Math.max(1, d.order.length / DRAFT_ROUNDS)) + 1);
}

/** AI 의 선수 평가 */
function aiScore(t: Team, p: Player, rng: Rng): number {
  const est = SCOUT_EST[p.scout ?? 'C'];
  let s = est * AI_POT_W + p.ovr * AI_OVR_W + gauss(rng) * AI_NOISE;
  const nb = t.roster.filter((x) => x.kind === 'B').length;
  const np = t.roster.length - nb;
  if ((p.kind === 'P' && np < 11) || (p.kind === 'B' && nb < 13)) s += AI_NEED_BONUS;
  const same = t.roster.filter((x) => x.pos === p.pos);
  if (!same.length || Math.max(...same.map((x) => x.ovr)) < p.ovr + 4) s += AI_NEED_BONUS * 0.6;
  return s;
}

function takePlayer(core: Core, t: Team, p: Player, round: number): void {
  const d = core.draft!;
  d.pool = d.pool.filter((x) => x.id !== p.id);
  p.rookie = true;
  p.salary = MIN_SALARY;
  t.roster.push(p);
  // 유저 구단의 지명 선수는 2군에서 시작한다 (AI 구단은 2군을 쓰지 않는다)
  if (t.id === core.userId) p.farm = true;
  else slotNewcomer(t, p);
  d.log.push({ round, teamId: t.id, pid: p.id, name: p.name, pos: p.pos });
  if (t.id === core.userId) {
    p.since = core.season + 1; // 다음 시즌 데뷔
    const bonus = DRAFT_BONUS[round - 1] ?? DRAFT_BONUS[DRAFT_BONUS.length - 1];
    core.finance.cash -= bonus;
    core.finance.ledger.signing += bonus;
    d.mine.push(p.id);
    addNews(core, `드래프트 ${round}라운드: ${p.name}(${POS_KO_NEWS[p.pos] ?? p.pos}, ${p.age}세) 지명 — 계약금 ${fmtMoney(bonus)}`, 'good');
  }
}

/** 유저 차례가 오거나 드래프트가 끝날 때까지 AI 지명 (mutate) */
function runAi(core: Core, rng: Rng): void {
  const d = core.draft!;
  const byId = new Map(core.teams.map((t) => [t.id, t]));
  while (d.pick < d.order.length && d.order[d.pick] !== core.userId) {
    const t = byId.get(d.order[d.pick])!;
    const round = draftRound(d);
    if (d.pool.length && t.roster.length < ROSTER_MAX) {
      let bestP = d.pool[0];
      let bestV = -Infinity;
      for (const p of d.pool) {
        const v = aiScore(t, p, rng);
        if (v > bestV) {
          bestV = v;
          bestP = p;
        }
      }
      takePlayer(core, t, bestP, round);
    }
    d.pick++;
  }
  if (d.pick >= d.order.length) addNews(core, `신인 드래프트 종료 — 우리 구단 ${d.mine.length}명 지명`, 'info');
}

/** phase 'ended' → 'draft'. 풀 생성 + 지명 순서(정규시즌 역순 × 3라운드) + 첫 유저 차례까지 AI 진행 */
export function beginDraft(core0: Core, rng: Rng): { core: Core; error?: string } {
  if (core0.phase !== 'ended') return { core: core0, error: '시즌 결산 후에만 드래프트를 열 수 있습니다' };
  const core = structuredClone(core0);
  const rev = standings(core.teams).reverse().map((t) => t.id);
  const order: string[] = [];
  for (let r = 0; r < DRAFT_ROUNDS; r++) order.push(...rev);
  core.draft = { pool: genPool(core, rng), order, pick: 0, log: [], mine: [] };
  core.phase = 'draft';
  addNews(core, `신인 드래프트 개막 — 유망주 ${DRAFT_POOL}명, ${DRAFT_ROUNDS}라운드`, 'info');
  runAi(core, rng);
  return { core };
}

export function draftPick(core0: Core, pid: string, rng: Rng): { core: Core; error?: string } {
  if (!isUserTurn(core0)) return { core: core0, error: '지금은 우리 구단의 지명 차례가 아닙니다' };
  const d0 = core0.draft!;
  const p0 = d0.pool.find((p) => p.id === pid);
  if (!p0) return { core: core0, error: '지명할 수 없는 선수입니다' };
  if (farmRoster(userTeam(core0)).length >= FARM_MAX) return { core: core0, error: `2군이 가득 찼습니다 (${FARM_MAX}명) — 패스하거나 2군 선수를 방출하세요` };
  const round = draftRound(d0);
  const bonus = DRAFT_BONUS[round - 1] ?? 0;
  if (core0.finance.cash < bonus) return { core: core0, error: `계약금이 부족합니다 (필요 ${fmtMoney(bonus)})` };
  const core = structuredClone(core0);
  const p = core.draft!.pool.find((x) => x.id === pid)!;
  takePlayer(core, userTeam(core), p, round);
  core.draft!.pick++;
  runAi(core, rng);
  return { core };
}

export function draftSkip(core0: Core, rng: Rng): { core: Core; error?: string } {
  if (!isUserTurn(core0)) return { core: core0, error: '지금은 우리 구단의 지명 차례가 아닙니다' };
  const core = structuredClone(core0);
  addNews(core, `드래프트 ${draftRound(core.draft!)}라운드 지명권 행사 포기`, 'info');
  core.draft!.pick++;
  runAi(core, rng);
  return { core };
}
