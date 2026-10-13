import type { Core, Player, Team } from './types';
import { positionReport } from './analysis';
import { winDelta } from './briefing';
import { FARM_MAX, ROSTER_MAX, activeRoster, farmRoster, payroll, releaseCost, signingBonus, userTeam } from './economy';
import { FOREIGN_MAX } from './events';
import { isFranchise } from './franchise';
import { slotNewcomer } from './lineup';
import { teamParts, type TeamParts } from './ratings';
import { runway, runwayAfter } from './runway';
import { GAMES } from './schedule';
import { callUp, releasePlayer, sendDown, signPlayer } from './season';

/** 이적 창구의 바구니: 담는 동안 실제 core 는 변하지 않는다 */
export interface Basket {
  sign: string[]; // 영입할 FA
  release: string[]; // 방출할 우리 선수
  down: string[]; // 2군으로 내릴 1군 선수
  up: string[]; // 콜업할 2군 선수
}
export type BasketKind = keyof Basket;
export const BASKET_KINDS: BasketKind[] = ['release', 'down', 'up', 'sign']; // 적용 순서
export const emptyBasket = (): Basket => ({ sign: [], release: [], down: [], up: [] });
export const basketCount = (b: Basket): number => b.sign.length + b.release.length + b.down.length + b.up.length;
export const basketKindOf = (b: Basket, pid: string): BasketKind | null => BASKET_KINDS.find((k) => b[k].includes(pid)) ?? null;

const STEP = { release: releasePlayer, down: sendDown, up: callUp, sign: signPlayer } as const;
const CASH_PAD = 1e9; // 현금 부족일 때도 나머지 숫자를 보여 주려고 잠깐 빌려주는 돈 (미리보기 전용)

function nameOf(core: Core, pid: string): string {
  return userTeam(core).roster.find((p) => p.id === pid)?.name ?? core.freeAgents.find((p) => p.id === pid)?.name ?? '선수';
}

/** 방출 → 2군행 → 콜업 → 영입 순으로 기존 순수 함수를 차례로 적용한다. 하나라도 막히면 전체 취소 */
function run(core0: Core, basket: Basket): { core: Core; error?: string } {
  let core = core0;
  for (const k of BASKET_KINDS) {
    for (const pid of basket[k]) {
      const r = STEP[k](core, pid);
      if (r.error) return { core: core0, error: `${nameOf(core, pid)}: ${r.error}` };
      core = r.core;
    }
  }
  return { core };
}

/** 바구니를 한 번에 실행한다 (미리보기와 같은 길). error 가 있으면 core 는 원본 그대로 */
export function applyTransfer(core: Core, basket: Basket): { core: Core; error?: string } {
  return run(core, basket);
}

export interface TransferOut {
  p: Player;
  to: 'release' | 'farm';
  role: string; // "3번 · 좌익", "2선발", "벤치", "2군"
  starter: boolean;
  franchise: boolean; // 방출이면 팬이 줄어든다
  cost: number; // 위약금 (2군행은 0)
}
export interface TransferBump {
  fa: Player; // 이 선수를 영입하면
  p: Player; // 이 선수가 밀려난다
  starter: boolean; // 주전 자리에서 밀려나는가 (아니면 같은 종류의 최저 OVR 대기 선수)
}
interface Pair<T = number> {
  a: T;
  b: T;
}
export interface TransferPreview {
  n: number; // 담은 건수
  error: string | null; // 불가 사유 (있으면 확정 불가)
  exact: boolean; // 전력·순위까지 실제 실행 경로로 계산했는가 (인원·한도 문제로 막히면 false — 돈·인원만 산수로 낸다)
  parts: Pair<TeamParts>;
  wins: number; // 예상 승수 변화
  winGames: number; // 환산 기준 경기 수 (시즌 중 = 남은 경기, 그 외 = 한 시즌)
  ranks: { key: string; label: string; a: number; b: number }[]; // 바뀌는 포지션만
  payroll: Pair; // 연봉 총액 (시즌당)
  bonus: number; // 계약금 합
  penalty: number; // 위약금 합
  cash: Pair;
  perGame: Pair | null; // 경기당 손익 (시즌 중에만)
  cashOut: Pair<number | null> | null; // 바닥까지 경기 수 (시즌 중에만, null = 안 빈다)
  active: Pair; // 1군
  farm: Pair; // 2군
  foreign: Pair;
  fans: Pair;
  ins: { p: Player; bonus: number }[];
  outs: TransferOut[];
  bumps: TransferBump[]; // 교체 영입 추천: 영입으로 밀려나는 선수 (이미 담은 선수는 제외)
}

function roleOf(t: Team, p: Player): { role: string; starter: boolean } {
  if (p.farm) return { role: '2군', starter: false };
  const li = t.lineup.findIndex((l) => l.pid === p.id);
  if (li >= 0) return { role: `주전 ${li + 1}번`, starter: true };
  const ri = t.rotation.indexOf(p.id);
  if (ri >= 0) return { role: `주전 ${ri + 1}선발`, starter: true };
  if (t.closer === p.id) return { role: '주전 마무리', starter: true };
  if (t.bullpen.includes(p.id)) return { role: '불펜', starter: false };
  return { role: p.kind === 'B' ? '벤치' : '대기', starter: false };
}

const starters = (t: Team): Set<string> => new Set([...t.lineup.map((l) => l.pid), ...t.rotation, ...(t.closer ? [t.closer] : [])]);

/** 영입 선수를 차례로 넣어 보며(정원 무시, 팀 복제본) 주전에서 밀려나는 선수를 찾는다 */
function bumpsOf(team0: Team, fas: Player[], skip: Set<string>): TransferBump[] {
  const t = structuredClone(team0);
  const out: TransferBump[] = [];
  for (const fa0 of fas) {
    const before = starters(t);
    const fa = structuredClone(fa0);
    t.roster.push(fa);
    slotNewcomer(t, fa);
    const after = starters(t);
    const taken = (p: Player) => skip.has(p.id) || out.some((x) => x.p.id === p.id) || fas.some((x) => x.id === p.id);
    const lost = t.roster.find((p) => before.has(p.id) && !after.has(p.id) && !taken(p));
    const spare =
      lost ??
      t.roster
        .filter((p) => !p.farm && p.kind === fa.kind && !after.has(p.id) && !taken(p))
        .sort((x, y) => x.ovr - y.ovr)[0];
    if (spare) out.push({ fa: fa0, p: team0.roster.find((x) => x.id === spare.id) ?? spare, starter: !!lost });
  }
  return out;
}

/** 바구니를 실행하면 얻는 것 / 잃는 것. 실제 core 는 건드리지 않는다 */
export function previewTransfer(core: Core, basket: Basket): TransferPreview {
  const t0 = userTeam(core);
  const byId = new Map(t0.roster.map((p) => [p.id, p]));
  const mine = (ids: string[]) => ids.map((id) => byId.get(id)).filter((p): p is Player => !!p);
  const fas = basket.sign.map((id) => core.freeAgents.find((p) => p.id === id)).filter((p): p is Player => !!p);
  const rel = mine(basket.release);
  const down = mine(basket.down);
  const up = mine(basket.up);
  const n = basketCount(basket);

  const real = run(core, basket);
  // 현금만 모자란 경우: 돈을 잠깐 빌려준 복제본으로 나머지 숫자를 같은 길로 계산한다
  let after: Core | null = real.error ? null : real.core;
  if (real.error && n > 0) {
    const padded = run({ ...core, finance: { ...core.finance, cash: core.finance.cash + CASH_PAD } }, basket);
    if (!padded.error) {
      after = padded.core;
      after.finance.cash -= CASH_PAD;
    }
  }

  const bonus = fas.reduce((s, p) => s + signingBonus(p), 0);
  const penalty = rel.reduce((s, p) => s + releaseCost(p, core), 0);
  const pay0 = payroll(t0);
  const payArith = pay0 + fas.reduce((s, p) => s + p.salary, 0) - rel.reduce((s, p) => s + p.salary, 0);
  const nAct = activeRoster(t0).length;
  const nFarm = farmRoster(t0).length;
  const nFor = t0.roster.filter((p) => p.foreign).length;
  const count = (ps: Player[], f: (p: Player) => boolean) => ps.filter(f).length;
  const t1 = after ? userTeam(after) : null;
  const inSeason = core.phase === 'season' && core.day < core.schedule.length;
  const len = core.schedule.length || GAMES;

  const pa = teamParts(t0);
  const pb = t1 ? teamParts(t1) : pa;
  const rows0 = positionReport(core);
  const rows1 = after ? positionReport(after) : rows0;
  const rw0 = runway(core);
  const rw1 = after ? runway(after) : runwayAfter(core, { cash: -(bonus + penalty), perGame: -(payArith - pay0) / len });

  const skip = new Set([...basket.release, ...basket.down]);
  // 밀려나는 선수는 방출·2군행·콜업까지 반영한 팀에서 찾는다 (그 단계가 막히면 지금 팀에서)
  const mid = fas.length ? run({ ...core, finance: { ...core.finance, cash: core.finance.cash + CASH_PAD } }, { ...basket, sign: [] }) : null;

  return {
    n,
    error: n > 0 ? (real.error ?? null) : null,
    exact: !!after,
    parts: { a: pa, b: pb },
    wins: winDelta(pa, pb) * (inSeason ? core.schedule.length - core.day : len),
    winGames: inSeason ? core.schedule.length - core.day : len,
    ranks: rows0
      .map((r, i) => ({ key: r.key, label: r.label, a: r.rank, b: rows1[i].rank }))
      .filter((r) => r.a !== r.b),
    payroll: { a: pay0, b: t1 ? payroll(t1) : payArith },
    bonus,
    penalty,
    cash: { a: core.finance.cash, b: after ? after.finance.cash : core.finance.cash - bonus - penalty },
    perGame: inSeason ? { a: rw0.perGame, b: rw1.perGame } : null,
    cashOut: inSeason ? { a: rw0.cashOut, b: rw1.cashOut } : null,
    active: { a: nAct, b: t1 ? activeRoster(t1).length : nAct + fas.length + up.length - down.length - count(rel, (p) => !p.farm) },
    farm: { a: nFarm, b: t1 ? farmRoster(t1).length : nFarm + down.length - up.length - count(rel, (p) => !!p.farm) },
    foreign: { a: nFor, b: nFor + count(fas, (p) => !!p.foreign) - count(rel, (p) => !!p.foreign) },
    fans: { a: core.fans, b: after ? after.fans : core.fans },
    ins: fas.map((p) => ({ p, bonus: signingBonus(p) })),
    outs: [
      ...rel.map((p): TransferOut => ({ p, to: 'release', ...roleOf(t0, p), franchise: isFranchise(p, core.season), cost: releaseCost(p, core) })),
      ...down.map((p): TransferOut => ({ p, to: 'farm', ...roleOf(t0, p), franchise: false, cost: 0 })),
    ],
    bumps: fas.length ? bumpsOf(mid && !mid.error ? userTeam(mid.core) : t0, fas, skip) : [],
  };
}

export { FARM_MAX, FOREIGN_MAX, ROSTER_MAX };
