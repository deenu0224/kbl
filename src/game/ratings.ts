import type { BatPos, Player, Team } from './types';
import { clamp } from './rng';

// ── 밸런스 상수 ──
const BAT_W = { con: 0.3, pow: 0.26, eye: 0.17, spd: 0.1, def: 0.17 };
const DH_W = { con: 0.36, pow: 0.32, eye: 0.22, spd: 0.1 };
const SP_W = { stf: 0.42, ctl: 0.36, sta: 0.22 };
const RP_W = { stf: 0.55, ctl: 0.4, sta: 0.05 };

// 연봉 곡선 앵커 [OVR, 만원] — 구간 선형 보간(볼록)
const SALARY_CURVE: [number, number][] = [
  [40, 3000],
  [50, 4000],
  [60, 17000],
  [70, 46000],
  [80, 100000],
  [90, 180000],
  [99, 270000],
];
export const MIN_SALARY = 3000;

const INFIELD: BatPos[] = ['2B', '3B', 'SS'];
const OUTFIELD: BatPos[] = ['LF', 'CF', 'RF'];

export function calcOvr(p: Player): number {
  let v: number;
  if (p.kind === 'B') {
    v =
      p.pos === 'DH'
        ? p.con * DH_W.con + p.pow * DH_W.pow + p.eye * DH_W.eye + p.spd * DH_W.spd
        : p.con * BAT_W.con + p.pow * BAT_W.pow + p.eye * BAT_W.eye + p.spd * BAT_W.spd + p.def * BAT_W.def;
  } else {
    const w = p.pos === 'SP' ? SP_W : RP_W;
    v = p.stf * w.stf + p.ctl * w.ctl + p.sta * w.sta;
  }
  return clamp(Math.round(v), 20, 99);
}

export function calcSalary(p: Player): number {
  const o = p.ovr;
  let v = SALARY_CURVE[0][1];
  if (o >= SALARY_CURVE[SALARY_CURVE.length - 1][0]) {
    v = SALARY_CURVE[SALARY_CURVE.length - 1][1];
  } else {
    for (let i = 0; i < SALARY_CURVE.length - 1; i++) {
      const [o0, s0] = SALARY_CURVE[i];
      const [o1, s1] = SALARY_CURVE[i + 1];
      if (o >= o0 && o < o1) {
        v = s0 + ((s1 - s0) * (o - o0)) / (o1 - o0);
        break;
      }
    }
  }
  // 저연차 할인
  if (p.age <= 22) v *= 0.55;
  else if (p.age <= 24) v *= 0.75;
  return Math.max(MIN_SALARY, Math.round(v / 100) * 100);
}

/** 타격 가치(수비 제외) — 타순·대타 선정용 */
export function batValue(p: Player): number {
  return p.con * 0.36 + p.pow * 0.32 + p.eye * 0.2 + p.spd * 0.12;
}

/** 포지션 불일치 페널티를 반영한 수비력 */
export function effDef(p: Player, pos: BatPos): number {
  if (p.kind !== 'B') return 20;
  if (pos === 'DH' || p.pos === pos) return p.def;
  const from = p.pos as BatPos;
  let pen: number;
  if (pos === 'C') pen = 30;
  else if (from === 'DH') pen = 15;
  else if (pos === '1B') pen = from === 'C' ? 12 : 7;
  else if (INFIELD.includes(pos)) {
    if (INFIELD.includes(from)) pen = pos === 'SS' ? 10 : from === 'SS' ? 3 : 6;
    else pen = from === '1B' ? 14 : 18;
  } else if (OUTFIELD.includes(from)) pen = pos === 'CF' ? 8 : from === 'CF' ? 2 : 4;
  else pen = from === 'C' || from === '1B' ? 16 : 12;
  return clamp(p.def - pen, 10, 99);
}

/** 0~99 표시용 전력: 타선 50% + 선발 30% + 불펜 20% */
export function teamStrength(t: Team): number {
  const byId = new Map(t.roster.map((p) => [p.id, p]));
  const avg = (ids: (string | null)[]): number | null => {
    const ps = ids.map((id) => (id ? byId.get(id) : undefined)).filter((p): p is Player => !!p);
    return ps.length ? ps.reduce((s, p) => s + p.ovr, 0) / ps.length : null;
  };
  const act = t.roster.filter((p) => !p.farm);
  const all = act.length ? act.reduce((s, p) => s + p.ovr, 0) / act.length : 0;
  const bat = avg(t.lineup.map((s) => s.pid)) ?? all;
  const rot = avg(t.rotation) ?? all;
  const pen = avg([t.closer, ...t.bullpen]) ?? all;
  return clamp(Math.round(bat * 0.5 + rot * 0.3 + pen * 0.2), 0, 99);
}

// 타순별 비중: 타석이 많이 돌아오는 상위·중심 타선이 무겁다
const ORDER_W = [1.15, 1.1, 1.3, 1.35, 1.1, 0.95, 0.85, 0.75, 0.65];

export interface TeamParts {
  bat: number; // 타선: 타순 비중을 준 타격 가치
  def: number; // 수비: 맡은 자리 기준(포지션 불일치 페널티 반영)
  rot: number; // 선발: 로테이션을 선발 기준으로 본 값
  pen: number; // 불펜: 마무리 + 불펜을 계투 기준으로 본 값
}

/** 팀 전력 4칸 (타선 탭 상단 막대). 타순·수비 위치·보직을 바꾸면 바로 변한다. */
export function teamParts(t: Team): TeamParts {
  const byId = new Map(t.roster.map((p) => [p.id, p]));
  const slots = t.lineup.map((s) => ({ p: byId.get(s.pid), pos: s.pos })).filter((x): x is { p: Player; pos: BatPos } => !!x.p);
  let bw = 0;
  let bv = 0;
  slots.forEach((x, i) => {
    const w = ORDER_W[i] ?? 0.65;
    bw += w;
    bv += batValue(x.p) * w;
  });
  const field = slots.filter((x) => x.pos !== 'DH');
  const def = field.length ? field.reduce((s, x) => s + effDef(x.p, x.pos), 0) / field.length : 0;
  const pit = (ids: (string | null)[], w: typeof SP_W) => {
    const ps = ids.map((id) => (id ? byId.get(id) : undefined)).filter((p): p is Player => !!p && p.kind === 'P');
    return ps.length ? ps.reduce((s, p) => s + p.stf * w.stf + p.ctl * w.ctl + p.sta * w.sta, 0) / ps.length : 0;
  };
  // 불펜은 앞(필승조)일수록 자주 던진다: 마무리와 앞 3명만 본다
  const r = (v: number) => clamp(Math.round(v), 0, 99);
  return { bat: r(bw ? bv / bw : 0), def: r(def), rot: r(pit(t.rotation, SP_W)), pen: r(pit([t.closer, ...t.bullpen.slice(0, 3)], RP_W)) };
}
