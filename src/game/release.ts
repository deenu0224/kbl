// 방출 추천: 우리 선수단에서 "내보내도 되는 선수"를 이유와 함께 고른다 (순수 함수 · 읽기 전용).
// 점수가 높을수록 방출 후보. 기준 미만이면 추천하지 않는다 (억지로 채우지 않는다). 실행은 이적 창구의 [− 방출] 담기로만.
import type { Core, Player, Team } from './types';
import { MIN_BATTERS, MIN_PITCHERS, ROSTER_MAX, activeRoster, blockClosedWhy, farmMax, farmRoster, luxTax, releaseCost, userTeam } from './economy';
import { POS_LABEL, canPlay, posScore, valueGap, type PosKey } from './analysis';
import { fixedStarters } from './campaign';
import { isFranchise } from './franchise';
import { fmtMoney, josa } from './format';
import { fixLineup } from './lineup';
import { teamParts } from './ratings';
import { runway } from './runway';
import { isProspect, movable } from './trade';
import { applyTransfer, emptyBasket, previewTransfer, type TransferPreview } from './transfer';

// ── 가중치 (점수 단위: 점) ──
export const RL = {
  overPerEok: 10, // 1. 가성비: 시장가보다 비싼 연봉 1억당 +
  overMax: 30,
  underPerEok: 5, // 시장가보다 싼 선수는 1억당 − (싸게 쓰는 선수는 남긴다)
  underMax: 15,
  blocked: 14, // 2. 쓰임새: 그 자리(수비 가능 자리 포함)에 더 나은 1군 선수가 있어 주전이 아니다
  lowUse: 10, // 출전 경기 비율이 0 이면 + 이만큼 (비율에 비례)
  useFrom: 10, // 팀이 이 경기 수 이상 치른 뒤부터 출전 비율을 본다
  oldAge: 33, // 3. 나이와 하락
  old: 8, // 33세 이상이고 하락 중이거나 성장이 끝났다
  dropPer: 2, // 지난 시즌보다 오버롤이 1 떨어질 때마다 +
  dropMax: 10,
  prospect: 10, // 4. 길을 막음: 그 자리에 잠재력 높은 2군 유망주가 기다린다
  costPerEok: 6, // 5. 방출 비용: 잔여 연봉 지급 1억당 −
  starter: 20, // 주전(라인업·로테이션·마무리)은 −: 빠지면 전력이 바로 준다
  partDrop: 4, // 방출하면 전력 4칸 합이 1 줄 때마다 −
  onlyBackup: 12, // 그 자리(본 포지션)를 볼 수 있는 1군 벤치가 이 선수뿐이면 −
  min: 28, // 이 점수 이상만 추천 (벤치라는 이유 하나로는 넘지 못한다 — 다른 이유가 하나 더 있어야 한다)
  max: 3, // 최대 인원
};
const EOK = 10000;
const PEN_FRONT = 4; // 필승조 (analysis.ts 와 같은 값)

export interface Advice {
  p: Player;
  score: number;
  why: string[]; // 한 줄 이유 (점수가 큰 항목부터, 최대 3줄)
  trade: boolean; // 방출보다 트레이드 시장에 내놓기를 권한다
  cost: number; // 잔여 연봉 지급액
}

type Line = { pts: number; text: string };
const sum = (ls: Line[]) => ls.reduce((s, l) => s + l.pts, 0);
const gamesPlayed = (t: Team) => t.rec.w + t.rec.l + t.rec.t;

/** 추천에서 빼는 선수인가 (사유. 대상이면 null) */
export function releaseExcluded(core: Core, p: Player): string | null {
  const t = userTeam(core);
  if (isFranchise(p, core.season)) return '프랜차이즈 스타';
  if (p.injury > 0 || p.il || p.ban) return '부상·재활·징계';
  if (p.armyDue !== undefined || p.away) return '입대 예정·복무 중';
  if (p.rookie) return '이번 시즌 데뷔 신인';
  if (p.subFor) return '부상 대체 선수';
  if (fixedStarters(core).has(p.id)) return '고정 출전 약속 중';
  if (!p.farm) {
    const same = activeRoster(t).filter((x) => x.kind === p.kind).length;
    if (same <= (p.kind === 'B' ? MIN_BATTERS : MIN_PITCHERS)) return '1군 최소 인원';
  } else if (farmRoster(t).length < farmMax(core)) return '2군 (정원에 여유)';
  if (releaseCost(p, core) > core.finance.cash) return '잔여 연봉 지급액 부족';
  return null;
}

/** 그 선수가 주전인가 (라인업 · 로테이션 · 마무리) */
function isStarter(t: Team, p: Player): boolean {
  return t.lineup.some((l) => l.pid === p.id) || t.rotation.includes(p.id) || t.closer === p.id;
}

/** 리그 같은 포지션 1군 선수의 오버롤 중위값 */
function leagueMedian(core: Core, pos: string): number {
  const xs = core.teams.flatMap((t) => activeRoster(t).filter((p) => p.pos === pos).map((p) => p.ovr)).sort((a, b) => a - b);
  return xs.length ? xs[Math.floor(xs.length / 2)] : 99;
}

function lines(core: Core, p: Player): Line[] {
  const t = userTeam(core);
  const out: Line[] = [];
  // 1. 가성비
  const gap = valueGap(p, core.season);
  if (gap < 0) {
    const pts = Math.min(RL.overMax, (-gap / EOK) * RL.overPerEok);
    if (pts >= 3) out.push({ pts, text: `연봉 ${fmtMoney(p.salary)} · 시장가보다 ${fmtMoney(-gap)} 비쌈` });
  } else if (gap > 0) {
    out.push({ pts: -Math.min(RL.underMax, (gap / EOK) * RL.underPerEok), text: '' });
  }
  // 2. 쓰임새
  if (!p.farm) {
    const n = gamesPlayed(t);
    const byId = new Map(t.roster.map((x) => [x.id, x]));
    if (p.kind === 'B') {
      const g = p.bat.g;
      const use = n >= RL.useFrom ? Math.min(1, g / n) : 1;
      if (!isStarter(t, p)) {
        // 그 선수가 볼 수 있는 자리의 주전 중 가장 약한 자리의 주전 (그 사람에게도 밀린다)
        const spots = [...canPlay(p), 'DH' as const].map((pos) => ({ pos, s: t.lineup.find((l) => l.pos === pos) })).filter((x) => !!x.s);
        const blk = spots
          .map(({ pos, s }) => ({ pos, q: byId.get(s!.pid) }))
          .filter((x): x is { pos: typeof x.pos; q: Player } => !!x.q && posScore(x.q, x.pos) > posScore(p, x.pos))
          .sort((a, b) => Number(b.pos === p.pos) - Number(a.pos === p.pos) || posScore(a.q, a.pos) - posScore(b.q, b.pos))[0]; // 본 포지션 주전이 먼저
        if (blk && blk.q && spots.every(({ pos, s }) => { const q = byId.get(s!.pid); return !!q && posScore(q, pos) > posScore(p, pos); })) {
          const pts = RL.blocked + (1 - use) * RL.lowUse;
          out.push({ pts, text: `${POS_LABEL[blk.pos as PosKey]} 주전 ${blk.q.name}(${blk.q.ovr})에 밀림${n >= RL.useFrom ? ` · 출전 ${g}경기` : ''}` });
        } else if (n >= RL.useFrom && use < 0.3) out.push({ pts: (1 - use) * RL.lowUse, text: `벤치 · 출전 ${g}경기 (팀 ${n}경기)` });
        // 유일한 백업: 본 포지션을 볼 수 있는 다른 1군 벤치가 없다
        const inLu = new Set(t.lineup.map((l) => l.pid));
        const others = activeRoster(t).filter((x) => x.kind === 'B' && x.id !== p.id && !inLu.has(x.id) && canPlay(x).includes(p.pos as never));
        if (p.pos !== 'DH' && !others.length) out.push({ pts: -RL.onlyBackup, text: '' });
      }
    } else {
      const g = p.pit.g;
      const bi = t.bullpen.indexOf(p.id);
      if (!isStarter(t, p) && (bi < 0 || bi >= PEN_FRONT)) {
        const exp = n * (p.pos === 'SP' ? 0.2 : 0.4); // 예상 등판 수 (선발 5인 로테이션 · 구원은 열에 넷)
        const use = n >= RL.useFrom ? Math.min(1, g / Math.max(1, exp)) : 1;
        const pts = RL.blocked * 0.75 + (1 - use) * RL.lowUse;
        out.push({ pts, text: `${bi >= 0 ? `불펜 ${bi + 1}순위` : '로테이션 밖'}${n >= RL.useFrom ? ` · 등판 ${g}경기` : ''}` });
      }
    }
  }
  // 3. 나이와 하락
  if (p.age >= RL.oldAge) {
    const drop = p.prev?.ovr !== undefined ? p.prev.ovr - p.ovr : 0;
    if (drop > 0) out.push({ pts: RL.old + Math.min(RL.dropMax, drop * RL.dropPer), text: `${p.age}세 · 지난 시즌보다 오버롤 −${drop}` });
    else if (p.pot <= p.ovr) out.push({ pts: RL.old, text: `${p.age}세 · 성장 끝 (잠재력 = 오버롤 ${p.ovr})` });
  }
  // 4. 길을 막음
  if (!p.farm) {
    const kid = farmRoster(t)
      .filter((k) => k.pos === p.pos && isProspect(k) && k.pot > p.ovr)
      .sort((a, b) => b.pot - a.pot)[0];
    if (kid) out.push({ pts: RL.prospect, text: `2군 유망주 ${kid.name}(잠재 ${kid.pot}) 대기` });
  }
  // 5. 방출 비용
  const cost = releaseCost(p, core);
  if (cost > 0) out.push({ pts: -(cost / EOK) * RL.costPerEok, text: '' });
  if (isStarter(t, p)) out.push({ pts: -RL.starter, text: '' });
  return out;
}

/** 방출하면 전력 4칸 합이 얼마나 주는가 (팀 복제본: 빼고 편성을 다시 짠다) */
function partsLoss(t0: Team, pid: string): number {
  const t = structuredClone(t0);
  t.roster = t.roster.filter((p) => p.id !== pid);
  fixLineup(t);
  const a = teamParts(t0);
  const b = teamParts(t);
  return (['bat', 'def', 'rot', 'pen'] as const).reduce((s, k) => s + Math.max(0, a[k] - b[k]), 0);
}

/** 트레이드 시장에 내놓을 값이 있는 선수: 내놓을 수 있고, 리그 그 포지션 중위 이상이거나 30세 미만 */
export function tradeWorthy(core: Core, p: Player): boolean {
  return movable(p) && (p.age < 30 || p.ovr >= leagueMedian(core, p.pos));
}

/** 대상 선수 전원의 방출 점수 (정렬용 · 기준 미만 포함). 제외된 선수는 들어 있지 않다 */
export function releaseScores(core: Core): Map<string, Advice> {
  const t = userTeam(core);
  const m = new Map<string, Advice>();
  for (const p of t.roster) {
    if (releaseExcluded(core, p)) continue;
    const ls = lines(core, p);
    let score = sum(ls);
    // 기준 근처 이상인 선수만 실제로 빼 보고 전력 손실을 깎는다 (편성 재계산이 비싸다)
    if (score >= RL.min - RL.partDrop * 2 && !p.farm) score -= partsLoss(t, p.id) * RL.partDrop;
    const trade = tradeWorthy(core, p);
    const why = ls.filter((l) => l.text && l.pts > 0).sort((a, b) => b.pts - a.pts).slice(0, 3).map((l) => l.text);
    m.set(p.id, { p, score: Math.round(score * 10) / 10, why, trade, cost: releaseCost(p, core) });
  }
  return m;
}

/** 포지션 묶음: 투수는 선발/불펜(마무리 포함), 타자는 주 포지션 */
const posKeyOf = (a: Advice): string => (a.p.kind === 'P' ? (a.p.pos === 'SP' ? 'SP' : 'RP') : a.p.pos);

/** 방출 추천: 기준 이상인 선수를 점수순으로 최대 3명 (없으면 빈 배열) */
export function releaseAdvice(core: Core): Advice[] {
  return [...releaseScores(core).values()]
    .filter((a) => a.score >= RL.min && a.why.length > 0)
    .sort((a, b) => b.score - a.score)
    // 한 포지션에서는 한 명만 (같은 자리 백업 둘을 함께 권하면 둘 다 보냈을 때 그 자리가 빈다)
    .filter((a, i, all) => all.findIndex((b) => posKeyOf(b) === posKeyOf(a)) === i)
    .slice(0, RL.max);
}

export const TRADE_HINT = '→ 방출보다 트레이드 시장에 내놓기 권장';

/** 카드의 "방출하면:" 한 줄 — 이적 창구의 담기 미리보기와 같은 계산(previewTransfer) */
export function releaseOutcome(core: Core, pid: string): { pv: TransferPreview; text: string } {
  const b = { ...emptyBasket(), release: [pid] };
  const pv = previewTransfer(core, b);
  const bits: string[] = [];
  const dPay = pv.payroll.b - pv.payroll.a;
  if (dPay) bits.push(`연봉 ${dPay < 0 ? '−' : '+'}${fmtMoney(Math.abs(dPay))}/시즌`);
  bits.push(pv.penalty > 0 ? `잔여 연봉 ${fmtMoney(pv.penalty)} 지급` : '잔여 연봉 없음');
  const KO = { bat: '타선', def: '수비', rot: '선발', pen: '불펜' } as const;
  const moved = (['bat', 'def', 'rot', 'pen'] as const).filter((k) => pv.parts.a[k] !== pv.parts.b[k]);
  bits.push(moved.length ? moved.map((k) => `${KO[k]} ${pv.parts.b[k] > pv.parts.a[k] ? '+' : '−'}${Math.abs(pv.parts.b[k] - pv.parts.a[k])}`).join(' · ') : '전력 그대로');
  // 그 자리를 누가 메우는가: 같은 실행 경로로 돌린 뒤 그 선수가 맡던 칸에 선 사람
  const t0 = userTeam(core);
  const r = pv.error ? null : applyTransfer(core, b);
  if (r && !r.error) {
    const t1 = userTeam(r.core);
    const li = t0.lineup.findIndex((l) => l.pid === pid);
    const ri = t0.rotation.indexOf(pid);
    const inId = li >= 0 ? t1.lineup.find((l) => l.pos === t0.lineup[li].pos)?.pid : ri >= 0 ? t1.rotation.find((id) => !t0.rotation.includes(id)) : t0.closer === pid ? t1.closer : null;
    const sub = inId ? t1.roster.find((p) => p.id === inId) : undefined;
    if (sub) bits.push(`${josa(sub.name, '이', '가')} 그 자리로`);
  }
  const me = t0.roster.find((p) => p.id === pid);
  if (me && !me.farm) {
    const kid = farmRoster(t0).filter((k) => k.pos === me.pos && isProspect(k)).sort((a, b) => b.pot - a.pot)[0];
    if (kid) bits.push(`1군 자리 +1 · 2군 ${kid.name} 콜업 가능`);
  }
  return { pv, text: bits.join(' · ') };
}

// ───────── 할 일: 방출 검토 ─────────

export type ReleaseWhen = 'full' | 'farm' | 'cash' | 'stove' | 'lux';
const WHEN_KO: Record<ReleaseWhen, string> = {
  full: '1군이 꽉 찼습니다',
  farm: '2군이 꽉 찼습니다',
  cash: '자금 경고',
  stove: '스토브리그',
  lux: '경쟁균형세 상한 초과 예상',
};
export const CASH_SOON = 12; // 이 경기 안에 금고가 비면 "자금 경고"

/** 방출을 검토할 상황 (먼저 해당하는 하나) — 없으면 null */
export function releaseWhen(core: Core): ReleaseWhen | null {
  const t = userTeam(core);
  if (activeRoster(t).length >= ROSTER_MAX) return 'full';
  if (farmRoster(t).length >= farmMax(core)) return 'farm';
  if (core.phase === 'season' && core.day < core.schedule.length) {
    const rw = runway(core);
    if (rw.cashOut !== null && rw.cashOut <= CASH_SOON) return 'cash';
  }
  if (core.phase === 'ended' || core.phase === 'draft' || (core.phase === 'season' && core.day === 0)) return 'stove';
  const lux = luxTax(core);
  if (lux.on && lux.tax > 0) return 'lux';
  return null;
}

/** 할 일 항목의 id: 상황이 바뀌면 새 항목이 된다 (닫은 항목은 그 시즌 · 그 상황 동안 다시 오르지 않는다) */
export const releaseTodoId = (core: Core, when: ReleaseWhen): string => `rel-${core.season}-${core.phase === 'season' ? 's' : 'o'}-${when}`;

export function releaseTodo(core: Core): { id: string; text: string; n: number; when: ReleaseWhen } | null {
  const when = releaseWhen(core);
  if (!when) return null;
  const n = releaseAdvice(core).length;
  if (!n) return null;
  return { id: releaseTodoId(core, when), text: `방출 검토 — ${WHEN_KO[when]} · 후보 ${n}명`, n, when };
}

/** 트레이드 시장에 내놓을 수 있는 때(마감 전 · 스토브리그)라면 [⇄ 시장] 버튼을 먼저 보인다 */
export const releaseTradeFirst = (core: Core, a: Advice): boolean => a.trade && !blockClosedWhy(core);
