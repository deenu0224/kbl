import type { BatPos, Campaign, EvType, GameEvent, GameResult, Player, Team } from './types';
import { clamp, randInt, type Rng } from './rng';
import { effDef } from './ratings';
import { slotValue } from './lineup';
import { fmtIp } from './format';
import { KBO_AVG } from './kbo';

// (연투 피로 도입으로 불펜 유효 구위가 평균 2 안팎 내려간 만큼 BB/K/BABIP 를 다시 맞췄다)
// ── 보정 계수: 능력치 분포가 비대칭이라 "평균 능력치의 확률" ≠ "리그 평균 확률". balance 스크립트로 맞춘 값 ──
const CAL = {
  BB: 0.975,
  K: 1.05,
  HR: 0.79,
  BABIP: -0.0105, // 자동 편성이 수비 위치를 정리하면서 오른 리그 수비력만큼 보정
  D2: 0.95,
  D3: 0.92,
};
// 안타 종류는 홈런을 뺀 인플레이 안타 중 비율로 굴린다
const D2_OF_BIP_HITS = KBO_AVG.d2OfHits / (1 - KBO_AVG.hrOfHits);
const D3_OF_BIP_HITS = KBO_AVG.d3OfHits / (1 - KBO_AVG.hrOfHits);

// ── 밸런스 상수 (능력치 REF = 리그 평균 수준에서 아래 기본 확률이 나온다). 기준값은 KBO 2022~2025 평균 (kbo.ts) ──
export const SIM = {
  REF: 60, // 리그 평균 능력치
  SKILL: 0.5, // 능력치 차이의 반영 강도
  BB: KBO_AVG.walkPct * CAL.BB, // 볼넷+사구 / 타석 (시뮬은 사구를 볼넷으로 기록)
  BB_EYE: 0.9,
  BB_CTL: 1.0,
  K: KBO_AVG.kPct * CAL.K, // 삼진 / 타석
  K_CON: 1.1,
  K_STF: 1.3, // 에이스 탈삼진·평균자책 1위 규모를 KBO 수준으로
  HR: KBO_AVG.hrPct * CAL.HR, // 홈런 / 타석
  HR_POW: 4.3, // 거포에 홈런을 몰아준다 (리그 HR% 는 CAL.HR 로 유지, 홈런왕 규모는 KBO 84경기 환산치)
  HR_STF: 1.0,
  BABIP: KBO_AVG.babip + CAL.BABIP, // 인플레이 타구 안타 확률
  BABIP_CON: 0.0045, // 컨택 차이 → 타율 분산 (3할 타자 수·타격왕 규모)
  BABIP_SPD: 0.0006,
  BABIP_STF: 0.0018,
  BABIP_DEF: 0.0013,
  HOME_EDGE: 0.006, // 홈팀 BABIP 가산
  D2: D2_OF_BIP_HITS * CAL.D2, // 인플레이 안타 중 2루타
  D2_POW: 0.0022,
  D3: D3_OF_BIP_HITS * CAL.D3, // 인플레이 안타 중 3루타
  D3_SPD: 0.0008,
  ROE: 0.03, // 인플레이 아웃 → 실책 출루 (비자책 실점의 원천. KBO 총실점/자책 ≈ 1.12 에 맞춤, 팀 경기당 약 0.55개)
  GB: 0.45, // 인플레이 아웃 중 땅볼
  FB: 0.35, // 뜬공
  DP: 0.37, // 1루 주자 + 2사 미만 땅볼의 병살 확률
  // 도루: 1루(2루 빈 상황) 주자가 타석마다 시도할 확률 = SBA × exp((주력−REF)/SBA_SPD)
  SBA: 0.078,
  SBA_SPD: 28,
  SBA_3B: 0.2, // 3루 도루는 2루 도루 시도율의 이 비율
  SB_SUCC: 0.75, // 평균 주자 vs 평균 포수 성공률
  SB_SUCC_SPD: 0.006,
  SB_SUCC_DEF: 0.005,
  SAC_FLY: 0.6,
  GB_SCORE: 0.5, // 땅볼 때 3루 주자 득점
  GB_ADV: 0.55,
  SCORE_2ND_1B: 0.6, // 단타에 2루 주자 득점
  FIRST_TO_3RD: 0.28,
  SCORE_1ST_2B: 0.42, // 2루타에 1루 주자 득점
  TWO_OUT_RUN: 0.15, // 2사 후 스타트 보너스
  SP_LIMIT_BASE: 11, // 선발 한계 타자 수 = BASE + 체력 × STA (평균 5⅓이닝 안팎, 체력 좋은 에이스는 더 길게)
  SP_LIMIT_STA: 0.19,
  RP_AS_SP: 0.55, // 구원 전문(RP·CP)이 선발 등판할 때의 한계 타자 수 배율
  RP_AS_SP_PEN: 12, // 그때의 구위·제구 하락 (선발 수업을 받지 않은 팔)
  // 수비 조직력: 한두 명이 낯선 자리를 보는 건 버티지만(페널티 합 MISFIT_FREE 까지), 그 이상 뒤섞이면 수비가 무너진다
  MISFIT_FREE: 65,
  MISFIT_ROE: 0.0012, // 초과분 1점당 실책 출루 확률 가산
  MISFIT_BABIP: 0.0012, // 초과분 1점당 인플레이 안타 확률 가산
  RP_LIMIT_BASE: 4,
  RP_LIMIT_STA: 0.1,
  FAT_STF: 2.2, // 한계 초과 타자 1명당 구위 하락
  FAT_CTL: 2.0,
  SP_HOOK_RUNS: 6, // 선발 즉시 강판 실점
  RP_HOOK_RUNS: 3,
  TIRED_1: 16, // 연투 피로: 전날 던진 불펜 구위 하락
  TIRED_2: 32, // 2일 연속 던진 뒤 (3연투째)
  TIRED_CTL_1: 6, // 연투 피로의 제구 하락
  TIRED_CTL_2: 12,
  TIRED_INJ_1: 1.6, // 연투 상태로 등판한 경기의 부상 확률 배율
  TIRED_INJ_2: 2.5,
  // 타순 바퀴 수: 같은 투수를 두·세·네 번째 만나는 타자는 공이 눈에 익는다 (구위 하락). 구위가 낮은 투수일수록 크게 읽힌다
  TTO_STF: [0, 2, 9, 14],
  TTO_REF: 60, // 가중 = 1 + (TTO_REF − 구위) / TTO_SLOPE, TTO_MIN~TTO_MAX
  TTO_SLOPE: 12,
  TTO_MIN: 0.3,
  TTO_MAX: 2.0,
  SHORT_BF: 4, // 구원이 한 경기에서 상대한 타자가 이 수 이하인 동안은 전력 투구
  SHORT_STF: 3, // 전력 투구의 구위 가산
  // 불펜 운영 방침 (믿음 / 균형 / 벌떼)
  TRUST_SP_LIMIT: 4, // 믿음: 선발 교체 시점을 한계 타자 수보다 이만큼 늦춘다 (지치는 시점은 그대로 — 넘겨 던지는 타석은 구위가 떨어진다)
  TRUST_SP_HOOK: 1, // 믿음: 선발 강판 실점 가산
  TRUST_CORE: 2, // 믿음: 필승조 인원 (불펜 앞에서부터). 나머지 구원은 TRUST_REST 점 차 이상 뒤지거나 크게 벌어진 경기에서만
  TRUST_REST: 3,
  TRUST_CLOSER_INN: 8, // 믿음: 마무리가 이 이닝 도중부터 나설 수 있다 (4~5아웃 세이브)
  SWARM_SP_LIMIT: -4, // 벌떼: 선발 교체 시점을 이만큼 당긴다 (타순 두 바퀴 반에서 교체)
  SWARM_BF: 6, // 벌떼: 구원 1인당 최대 타자 수
  SWARM_BF_TIGHT: 5, // 벌떼: 7회 이후 접전(SWARM_TIGHT 점 차 이내)에서는 이 타자 수에서 이닝 중에도 바꾼다
  SWARM_TIGHT: 2,
  SWARM_STF: 6, // 벌떼: 타순에 맞춰 끊어 넣는 구원의 전력 투구 가산 (SHORT_STF 에 더한다)
  AI_STYLE_GAP: 4, // AI 구단: 선발 평균 OVR − 불펜 평균 OVR 이 이만큼 높으면 믿음, 낮으면(구원 AI_SWARM_ARMS 명 이상) 벌떼
  AI_SWARM_ARMS: 7,
  CLOSER_MAX_TIRED: 1, // 마무리도 3연투는 하지 않는다: 이틀 연속 던졌으면 쉰 불펜이 9회를 맡는다 (쉰 팔이 없을 때만 나선다)
  BLOWOUT: 5, // 이 점수 차 이상이면 추격조 1명이 길게 던진다 (필승조를 아낀다)
  LONG_MULT: 2.2, // 그때의 한계 타자 수 배율
  CALM: 3, // 7회 이후에도 이 점수 차 이상이면 구원 투수가 한계 타자 수까지 이닝을 이어 던진다
  INJ_RATE: 0.0035,
  MAX_INNINGS: 12,
  MAX_EVENTS: 10,
};

/** 스탯 필드가 없는 사건 집계 (balance 스크립트 측정용, 게임 로직은 읽지 않는다) */
export const SIM_TALLY = { dp: 0, roe: 0 };

interface PState {
  p: Player;
  bf: number;
  outs: number;
  runs: number;
  so: number;
  limit: number;
  starter: boolean;
  entryLead: number;
  tiredPen: number; // 연투 피로로 깎이는 구위
  tiredCtl: number; // 연투 피로로 깎이는 제구
  tired: number; // 등판 시점의 연투 일수 (구원)
}
interface Runner {
  b: Player;
  ps: PState;
  ue?: boolean; // 실책으로 출루 → 득점해도 비자책
}
interface BLine {
  ab: number;
  h: number;
  hr: number;
  rbi: number;
  r: number;
  bb: number;
}
interface Side {
  team: Team;
  isHome: boolean;
  order: { p: Player; pos: BatPos }[];
  idx: number;
  cur: PState;
  used: PState[];
  pen: Player[]; // 아직 안 쓴 불펜 (앞이 필승조)
  closer: Player | null;
  style: PenStyle;
  core: Set<string>; // 믿음 방침의 필승조
  def: number;
  misfit: number; // 낯선 자리에 선 야수들의 수비 페널티 합 중 MISFIT_FREE 초과분
  cDef: number; // 포수 수비 (도루 저지)
  runs: number;
  hits: number;
  line: number[];
  lines: Map<string, BLine>;
}
interface Cand {
  ev: GameEvent;
  prio: number;
  seq: number;
}

/** 부상자를 벤치 최적 선수로 바꾼 오늘의 타순 (team.lineup 은 건드리지 않음) */
function gameOrder(t: Team): { p: Player; pos: BatPos }[] {
  const byId = new Map(t.roster.map((p) => [p.id, p]));
  const batters = t.roster.filter((p) => p.kind === 'B' && !p.farm);
  const used = new Set<string>();
  const slots = t.lineup.map((s) => {
    const p = byId.get(s.pid);
    const ok = !!p && p.kind === 'B' && p.injury === 0 && !used.has(p.id);
    if (ok) used.add(p!.id);
    return { p: ok ? p! : undefined, raw: p, pos: s.pos };
  });
  const order: { p: Player; pos: BatPos }[] = [];
  for (const s of slots) {
    let p = s.p;
    if (!p) {
      const cand = batters.filter((x) => x.injury === 0 && !used.has(x.id));
      cand.sort((a, b) => slotValue(b, s.pos) - slotValue(a, s.pos));
      // 건강한 대체 선수가 없으면 부상자라도 그대로 출전
      p = cand[0] ?? (s.raw && s.raw.kind === 'B' && !used.has(s.raw.id) ? s.raw : batters.find((x) => !used.has(x.id)));
      if (p) used.add(p.id);
    }
    if (p) order.push({ p, pos: s.pos });
  }
  if (!order.length) {
    const any = batters.length ? batters : t.roster.filter((p) => !p.farm);
    if (!any.length) throw new Error(`${t.id}: 출전 가능한 선수가 없습니다`);
    any.slice(0, 9).forEach((p) => order.push({ p, pos: 'DH' }));
  }
  return order;
}

/** 연투 피로에 따른 구위 페널티 (tired = 오늘 이전의 연속 등판 일수) */
export function tiredPenalty(tired: number | undefined): number {
  const n = tired ?? 0;
  return n >= 2 ? SIM.TIRED_2 : n === 1 ? SIM.TIRED_1 : 0;
}
function tiredCtlPenalty(tired: number | undefined): number {
  const n = tired ?? 0;
  return n >= 2 ? SIM.TIRED_CTL_2 : n === 1 ? SIM.TIRED_CTL_1 : 0;
}

/** 불펜 운영 방침: 믿음(선발을 길게, 뒤는 필승조와 마무리) / 균형 / 벌떼(선발을 일찍 내리고 여럿이 짧게) */
export type PenStyle = NonNullable<Campaign['penStyle']>;
export const PEN_STYLES: PenStyle[] = ['trust', 'balance', 'swarm'];

/** 선발 평균 OVR − 불펜(마무리 포함) 평균 OVR 과 불펜 인원. 어느 한쪽이 비면 null */
export function rotPenGap(t: Team): { gap: number; arms: number } | null {
  const byId = new Map(t.roster.map((p) => [p.id, p]));
  const pick = (ids: (string | null)[]) => ids.map((id) => (id ? byId.get(id) : undefined)).filter((p): p is Player => !!p && p.kind === 'P' && !p.farm);
  const avg = (ps: Player[]) => ps.reduce((s, p) => s + p.ovr, 0) / ps.length;
  const sp = pick(t.rotation);
  const pen = pick([...t.bullpen, t.closer]);
  return sp.length && pen.length ? { gap: avg(sp) - avg(pen), arms: pen.length } : null;
}

/** 팀 구성에 맞는 방침 (AI 구단이 쓴다): 선발이 불펜보다 확실히 강하면 믿음, 불펜이 강하고 두터우면 벌떼 */
export function autoPenStyle(t: Team): PenStyle {
  const g = rotPenGap(t);
  if (!g) return 'balance';
  if (g.gap >= SIM.AI_STYLE_GAP) return 'trust';
  if (g.gap <= -SIM.AI_STYLE_GAP && g.arms >= SIM.AI_SWARM_ARMS) return 'swarm';
  return 'balance';
}

function makeSide(t: Team, isHome: boolean, rest: Set<string> | undefined, style: PenStyle): Side {
  const byId = new Map(t.roster.map((p) => [p.id, p]));
  const order = gameOrder(t);
  const fielders = order.filter((s) => s.pos !== 'DH');
  const def = fielders.length ? fielders.reduce((s, x) => s + effDef(x.p, x.pos), 0) / fielders.length : SIM.REF;
  const misfit = Math.max(0, fielders.reduce((s, x) => s + Math.max(0, x.p.def - effDef(x.p, x.pos)), 0) - SIM.MISFIT_FREE);
  const catcher = order.find((s) => s.pos === 'C');
  const cDef = catcher ? effDef(catcher.p, 'C') : SIM.REF - 15;

  // 선발: 로테이션 순번대로. 그 순번의 선발이 부상인데 자리를 바꿔 주지 않았으면 불펜 끝의 팔이 임시 선발로 나선다
  const rot = t.rotation.map((id) => byId.get(id)).filter((p): p is Player => !!p && p.kind === 'P');
  let starter: Player | undefined;
  if (rot.length) {
    const i = t.nextStarter % rot.length;
    t.nextStarter = (i + 1) % rot.length;
    if (rot[i].injury === 0) starter = rot[i];
  }
  const pitchers = t.roster.filter((p) => p.kind === 'P' && !p.farm);
  const canPitch = (p: Player | undefined): p is Player => !!p && p.kind === 'P' && !p.farm && p.injury === 0 && !rest?.has(p.id);
  let pen = t.bullpen.map((id) => byId.get(id)).filter(canPitch);
  if (!starter) {
    // 임시 선발: 추격조(불펜 뒤쪽) 중 체력이 좋은 팔. 불펜도 없으면 건강한 아무 투수
    const back = pen.slice(Math.floor(pen.length / 2));
    starter = (back.length ? back : pen).slice().sort((a, b) => b.sta - a.sta)[0] ?? rot.find((p) => p.injury === 0) ?? pitchers.find((p) => p.injury === 0) ?? pitchers[0] ?? t.roster[0];
    if (!starter) throw new Error(`${t.id}: 투수가 없습니다`);
  }
  pen = pen.filter((p) => p !== starter);
  const cl = t.closer ? byId.get(t.closer) : undefined;
  // 이틀 연속 던진 마무리도 일단 대기시킨다 (쉰 불펜이 있으면 manage 가 그를 건너뛴다)
  const closer = canPitch(cl) && cl !== starter ? cl : null;

  const side: Side = {
    team: t, isHome, order, idx: 0,
    cur: undefined as unknown as PState,
    used: [], pen, closer, style, core: new Set(pen.slice(0, SIM.TRUST_CORE).map((p) => p.id)), def, misfit, cDef, runs: 0, hits: 0, line: [], lines: new Map(),
  };
  for (const s of order) {
    s.p.bat.g++;
    side.lines.set(s.p.id, { ab: 0, h: 0, hr: 0, rbi: 0, r: 0, bb: 0 });
  }
  enter(side, starter, true, 0);
  return side;
}

function enter(side: Side, p: Player, starter: boolean, lead: number): void {
  // 선발 수업을 받지 않은 구원 투수가 선발로 나서면 금방 지친다. 크게 벌어진 경기의 구원은 길게 던진다
  const limit = starter
    ? (SIM.SP_LIMIT_BASE + p.sta * SIM.SP_LIMIT_STA) * (p.pos === 'SP' ? 1 : SIM.RP_AS_SP)
    : (SIM.RP_LIMIT_BASE + p.sta * SIM.RP_LIMIT_STA) * (Math.abs(lead) >= SIM.BLOWOUT ? SIM.LONG_MULT : 1);
  const asSp = starter ? (p.pos === 'SP' ? 0 : SIM.RP_AS_SP_PEN) : 0;
  const ps: PState = {
    p, bf: 0, outs: 0, runs: 0, so: 0, limit, starter, entryLead: lead,
    tiredPen: starter ? asSp : tiredPenalty(p.tired),
    tiredCtl: starter ? asSp : tiredCtlPenalty(p.tired),
    tired: starter ? 0 : (p.tired ?? 0),
  };
  p.pit.g++;
  if (starter) p.pit.gs++;
  side.cur = ps;
  side.used.push(ps);
}

/** 투수 교체 판단. atStart = 이닝 시작 시점 */
function manage(fld: Side, bat: Side, inning: number, atStart: boolean): void {
  const lead = fld.runs - bat.runs;
  const cur = fld.cur;
  const over = cur.bf - cur.limit - (cur.starter ? (fld.style === 'trust' ? SIM.TRUST_SP_LIMIT : fld.style === 'swarm' ? SIM.SWARM_SP_LIMIT : 0) : 0);
  const tired = (p: Player) => p.tired ?? 0;
  if (atStart && inning >= 9 && lead >= 0 && lead <= 3 && fld.closer && cur.p !== fld.closer) {
    // 3연투 금지: 이틀 연속 던진 마무리는 쉰 불펜이 남아 있으면 내지 않는다
    if (tired(fld.closer) < 2 || !fld.pen.some((p) => tired(p) < 2)) {
      const c = fld.closer;
      fld.closer = null;
      enter(fld, c, false, lead);
      return;
    }
  }
  const long = cur.limit > SIM.RP_LIMIT_BASE + cur.p.sta * SIM.RP_LIMIT_STA; // 크게 벌어진 경기에 길게 던지러 나온 구원
  let need: boolean;
  if (fld.style === 'swarm' && !cur.starter && !long) {
    // 벌떼: 구원은 짧게 끊어 던진다. 다음 이닝을 맡기지 않고, 접전에서는 이닝 중에도 바꾼다
    const tight = inning >= 7 && Math.abs(lead) <= SIM.SWARM_TIGHT;
    if (atStart) need = cur.bf >= 4;
    else need = cur.runs >= SIM.RP_HOOK_RUNS || cur.bf >= (tight ? SIM.SWARM_BF_TIGHT : SIM.SWARM_BF);
  } else if (atStart) {
    if (cur.starter) need = over >= -3;
    // 한 이닝을 막은 구원: 6회까지, 그리고 승부가 기운 경기(CALM 점 차 이상)에서는 한계 타자 수까지 이어 던진다
    else need = over >= 0 || (cur.outs >= 3 && !((inning <= 6 || Math.abs(lead) >= SIM.CALM) && cur.bf + 4 <= cur.limit));
  } else {
    need = cur.starter ? cur.runs >= SIM.SP_HOOK_RUNS + (fld.style === 'trust' ? SIM.TRUST_SP_HOOK : 0) || over >= 5 : cur.runs >= SIM.RP_HOOK_RUNS + (long ? 2 : 0) || over >= 3;
  }
  if (!need) return;
  let next: Player | undefined;
  const rest = fld.style === 'trust' && (lead <= -SIM.TRUST_REST || lead >= SIM.BLOWOUT); // 믿음: 필승조를 아끼는 점수 차
  if (fld.style === 'trust' && fld.closer && tired(fld.closer) < 2 && inning >= SIM.TRUST_CLOSER_INN && lead >= 1 && lead <= 3 && (inning >= 9 || !atStart)) {
    // 믿음: 8회 도중의 위기는 마무리가 끊는다 (4~5아웃 세이브)
    next = fld.closer;
    fld.closer = null;
  } else if (fld.style === 'trust' && !rest && fld.pen.some((p) => fld.core.has(p.id) && tired(p) < 2)) {
    // 믿음: 승부가 걸린 이닝은 필승조만 맡는다 (전날 던졌어도 나선다)
    next = fld.pen.find((p) => fld.core.has(p.id) && tired(p) < 2)!;
    fld.pen.splice(fld.pen.indexOf(next), 1);
  } else if (fld.pen.length) {
    // 접전 후반은 필승조부터, 그 외에는 추격조부터. 이틀 연속 던진 팔(3연투째)은 쉰 팔이 하나도 없을 때만 낸다
    const key = inning >= 7 && lead >= -2 && lead < SIM.BLOWOUT && !rest;
    const order = key ? fld.pen : fld.pen.slice().reverse();
    // (벌떼는 접전에서도 쉰 팔부터 — 여럿이 돌아가며 던진다)
    next = (key && fld.style !== 'swarm' ? undefined : order.find((p) => tired(p) === 0)) ?? order.find((p) => tired(p) < 2);
    // 불펜이 전부 이틀 연속 던졌으면: 덜 지친 마무리가 남아 있으면 그가, 아니면 가장 덜 지친 팔이 나선다
    if (!next && fld.closer && tired(fld.closer) < 2) {
      next = fld.closer;
      fld.closer = null;
    } else {
      next ??= order.reduce((a, p) => (tired(p) < tired(a) ? p : a));
      fld.pen.splice(fld.pen.indexOf(next), 1);
    }
  } else if (fld.closer) {
    next = fld.closer;
    fld.closer = null;
  }
  if (next) enter(fld, next, false, lead);
}

const HR_NAME = ['솔로', '투런', '스리런', '만루'];

export function simulateGame(
  home: Team,
  away: Team,
  rng: Rng,
  opts: { track: boolean; injMult?: Record<string, number>; focusId?: string; rest?: Set<string>; awayEdge?: Record<string, number>; penStyle?: Record<string, PenStyle> },
): GameResult {
  // 방침을 따로 주지 않은 팀(AI 구단)은 팀 구성으로 고른다
  const H = makeSide(home, true, opts.rest, opts.penStyle?.[home.id] ?? autoPenStyle(home));
  const A = makeSide(away, false, opts.rest, opts.penStyle?.[away.id] ?? autoPenStyle(away));
  const track = opts.track;
  const cands: Cand[] = [];
  let seq = 0;
  let winP: PState | undefined;
  let lossP: PState | undefined;
  let over = false;

  const norm = (v: number) => Math.max(0.3, 1 + ((v - SIM.REF) / SIM.REF) * SIM.SKILL);

  const playHalf = (bat: Side, fld: Side, inning: number, half: 0 | 1): void => {
    bat.line.push(0);
    manage(fld, bat, inning, true);
    let outs = 0;
    let bases: (Runner | null)[] = [null, null, null];
    const halfTxt = `${inning}회${half ? '말' : '초'}`;
    // 실책을 아웃으로 쳤을 때 이미 3아웃이면 이후 실점은 전부 비자책 (자책점 재구성 규칙의 근사)
    let ueRest = false;
    let errs = 0;

    while (outs < 3 && !over) {
      manage(fld, bat, inning, false);

      // ── 도루: 다음 주자가 빈 베이스 앞에 있을 때 타석마다 시도 판정 ──
      {
        const from = bases[0] && !bases[1] ? 0 : !bases[0] && bases[1] && !bases[2] ? 1 : -1;
        const rn = from >= 0 ? bases[from] : null;
        if (rn) {
          const att = SIM.SBA * Math.exp((rn.b.spd - SIM.REF) / SIM.SBA_SPD) * (from === 1 ? SIM.SBA_3B : 1);
          if (rng() < att) {
            const succ = clamp(SIM.SB_SUCC + (rn.b.spd - SIM.REF) * SIM.SB_SUCC_SPD - (fld.cDef - SIM.REF) * SIM.SB_SUCC_DEF, 0.4, 0.95);
            bases[from] = null;
            if (rng() < succ) {
              rn.b.bat.sb++;
              bases[from + 1] = rn;
            } else {
              rn.b.bat.cs++;
              outs++;
              if (outs + errs >= 3) ueRest = true;
              fld.cur.outs++;
              fld.cur.p.pit.outs++;
              if (outs >= 3) break;
            }
          }
        }
      }

      const b = bat.order[bat.idx % bat.order.length].p;
      bat.idx++;
      const bl = bat.lines.get(b.id)!;
      const ps = fld.cur;
      ps.bf++;
      const leadBefore = bat.runs - fld.runs;
      const runsBefore = bat.runs;
      let rbi = 0;

      const plate = (rn: Runner, credit: boolean): void => {
        const before = bat.runs - fld.runs;
        bat.runs++;
        bat.line[bat.line.length - 1]++;
        rn.b.bat.r++;
        const rl = bat.lines.get(rn.b.id);
        if (rl) rl.r++;
        rn.ps.runs++;
        if (!rn.ue && !ueRest) rn.ps.p.pit.er++;
        if (credit) rbi++;
        if (before === 0) {
          winP = bat.cur;
          lossP = rn.ps;
        } else if (before === -1) {
          winP = undefined;
          lossP = undefined;
        }
      };
      const out = (n: number): void => {
        outs += n;
        if (outs + errs >= 3) ueRest = true;
        ps.outs += n;
        ps.p.pit.outs += n;
      };

      // ── 타석 확률 ──
      const fat = Math.max(0, ps.bf - ps.limit);
      const tto = SIM.TTO_STF[Math.min(SIM.TTO_STF.length - 1, Math.floor((ps.bf - 1) / 9))] * clamp(1 + (SIM.TTO_REF - ps.p.stf) / SIM.TTO_SLOPE, SIM.TTO_MIN, SIM.TTO_MAX);
      const stfRaw = Math.max(20, ps.p.stf - fat * SIM.FAT_STF - tto - ps.tiredPen + (!ps.starter && ps.bf <= SIM.SHORT_BF ? SIM.SHORT_STF + (fld.style === 'swarm' ? SIM.SWARM_STF : 0) : 0));
      const stf = norm(stfRaw);
      const ctl = norm(Math.max(20, ps.p.ctl - fat * SIM.FAT_CTL - ps.tiredCtl));
      const pBB = clamp((SIM.BB * Math.pow(norm(b.eye), SIM.BB_EYE)) / Math.pow(ctl, SIM.BB_CTL), 0.02, 0.28);
      const pK = clamp((SIM.K * Math.pow(stf, SIM.K_STF)) / Math.pow(norm(b.con), SIM.K_CON), 0.04, 0.45);
      const pHR = clamp((SIM.HR * Math.pow(norm(b.pow), SIM.HR_POW)) / Math.pow(stf, SIM.HR_STF), 0.001, 0.13);
      const babip = clamp(
        SIM.BABIP +
          ((b.con - SIM.REF) * SIM.BABIP_CON + (b.spd - SIM.REF) * SIM.BABIP_SPD - (stfRaw - SIM.REF) * SIM.BABIP_STF - (fld.def - SIM.REF) * SIM.BABIP_DEF) * SIM.SKILL +
          fld.misfit * SIM.MISFIT_BABIP +
          (bat.isHome ? SIM.HOME_EDGE : SIM.HOME_EDGE * (opts.awayEdge?.[bat.team.id] ?? 0)),
        0.2,
        0.43,
      );

      b.bat.pa++;
      const x = rng();
      let kind: 'bb' | 'k' | 'hr' | '1b' | '2b' | '3b' | 'out' | 'sf' | 'roe' = 'out';

      if (x < pBB) {
        kind = 'bb';
        b.bat.bb++;
        bl.bb++;
        ps.p.pit.bb++;
        const me: Runner = { b, ps };
        if (bases[0]) {
          if (bases[1]) {
            if (bases[2]) plate(bases[2], true);
            bases[2] = bases[1];
          }
          bases[1] = bases[0];
        }
        bases[0] = me;
      } else if (x < pBB + pK) {
        kind = 'k';
        b.bat.ab++;
        b.bat.so++;
        bl.ab++;
        ps.so++;
        ps.p.pit.so++;
        out(1);
      } else if (x < pBB + pK + pHR) {
        kind = 'hr';
        for (const rn of bases) if (rn) plate(rn, true);
        plate({ b, ps }, true);
        bases = [null, null, null];
      } else if (rng() < babip) {
        const t = rng();
        const p3 = Math.max(0.003, SIM.D3 + (b.spd - SIM.REF) * SIM.D3_SPD);
        const p2 = clamp(SIM.D2 + (b.pow - SIM.REF) * SIM.D2_POW + (b.spd - SIM.REF) * 0.0005, 0.08, 0.38);
        kind = t < p3 ? '3b' : t < p3 + p2 ? '2b' : '1b';
        const two = outs === 2 ? SIM.TWO_OUT_RUN : 0;
        const [r1, r2, r3] = bases;
        const me: Runner = { b, ps };
        if (kind === '3b') {
          for (const rn of bases) if (rn) plate(rn, true);
          bases = [null, null, me];
        } else if (kind === '2b') {
          if (r3) plate(r3, true);
          if (r2) plate(r2, true);
          let third: Runner | null = null;
          if (r1) {
            if (rng() < SIM.SCORE_1ST_2B + two + (r1.b.spd - SIM.REF) * 0.004) plate(r1, true);
            else third = r1;
          }
          bases = [null, me, third];
        } else {
          if (r3) plate(r3, true);
          let third: Runner | null = null;
          let second: Runner | null = null;
          if (r2) {
            if (rng() < SIM.SCORE_2ND_1B + two + (r2.b.spd - SIM.REF) * 0.004) plate(r2, true);
            else third = r2;
          }
          if (r1) {
            if (!third && rng() < SIM.FIRST_TO_3RD + two + (r1.b.spd - SIM.REF) * 0.004) third = r1;
            else second = r1;
          }
          bases = [me, second, third];
        }
      } else if (rng() < SIM.ROE + fld.misfit * SIM.MISFIT_ROE) {
        // 실책 출루: 주자 전원 한 베이스씩, 이 플레이의 득점과 타자 주자는 비자책
        kind = 'roe';
        SIM_TALLY.roe++;
        errs++;
        if (outs + errs >= 3) ueRest = true;
        const [r1, r2, r3] = bases;
        if (r3) plate({ ...r3, ue: true }, false);
        bases = [{ b, ps, ue: true }, r1, r2];
      } else {
        // 인플레이 아웃
        const t = rng();
        if (t < SIM.GB) {
          if (bases[0] && outs < 2 && rng() < SIM.DP) {
            const r2 = bases[1];
            const r3 = bases[2];
            out(2);
            SIM_TALLY.dp++;
            bases = [null, null, null];
            if (outs < 3) {
              if (r3) plate(r3, false);
              if (r2) bases[2] = r2;
            }
          } else {
            out(1);
            if (outs < 3) {
              if (bases[2] && rng() < SIM.GB_SCORE) {
                plate(bases[2], true);
                bases[2] = null;
              }
              if (bases[1] && !bases[2] && rng() < SIM.GB_ADV) {
                bases[2] = bases[1];
                bases[1] = null;
              }
              if (bases[0] && !bases[1] && rng() < SIM.GB_ADV) {
                bases[1] = bases[0];
                bases[0] = null;
              }
            }
          }
        } else if (t < SIM.GB + SIM.FB) {
          out(1);
          if (outs < 3) {
            if (bases[2] && rng() < SIM.SAC_FLY) {
              kind = 'sf';
              plate(bases[2], true);
              bases[2] = null;
            }
            if (bases[1] && !bases[2] && rng() < 0.2) {
              bases[2] = bases[1];
              bases[1] = null;
            }
          }
        } else {
          out(1);
        }
      }

      // ── 기록 ──
      const isHit = kind === '1b' || kind === '2b' || kind === '3b' || kind === 'hr';
      if (kind === 'out' || kind === 'roe') {
        b.bat.ab++;
        bl.ab++;
      } else if (isHit) {
        b.bat.ab++;
        b.bat.h++;
        bl.ab++;
        bl.h++;
        bat.hits++;
        ps.p.pit.h++;
        if (kind === '2b') b.bat.d2++;
        if (kind === '3b') b.bat.d3++;
        if (kind === 'hr') {
          b.bat.hr++;
          bl.hr++;
          ps.p.pit.hr++;
        }
      }
      b.bat.rbi += rbi;
      bl.rbi += rbi;

      const n = bat.runs - runsBefore;
      const leadAfter = bat.runs - fld.runs;
      const walkoff = half === 1 && inning >= 9 && leadAfter > 0;
      if (walkoff) over = true;

      if (track && n > 0) {
        const goAhead = leadBefore <= 0 && leadAfter > 0;
        const tying = leadBefore < 0 && leadAfter === 0;
        const hitName = kind === '2b' ? '2루타' : kind === '3b' ? '3루타' : '안타';
        let type: EvType | null = null;
        let text = '';
        let sub = '';
        if (walkoff) {
          type = 'walkoff';
          const how =
            kind === 'hr' ? `${HR_NAME[n - 1] ?? ''} 홈런`.trim() : isHit ? hitName : kind === 'bb' ? '밀어내기 볼넷' : kind === 'sf' ? '희생플라이' : kind === 'roe' ? '실책 출루' : '결승타';
          text = `${b.name} 끝내기 ${how}!`;
          sub = kind === 'hr' ? `${halfTxt} · 시즌 ${b.bat.hr}호 · 경기 종료` : `${halfTxt} · 경기 종료`;
        } else if (kind === 'hr') {
          type = 'hr';
          const k = HR_NAME[n - 1] ?? '';
          text = `${b.name} ${leadBefore < 0 && goAhead ? '역전 ' : tying ? '동점 ' : ''}${k} 홈런!`;
          sub = `${halfTxt} · 시즌 ${b.bat.hr}호`;
        } else if (isHit && (goAhead || rbi >= 2 || (tying && inning >= 7))) {
          type = 'score';
          if (goAhead && leadBefore < 0) text = `${b.name} 역전 ${rbi >= 2 ? `${rbi}타점 ` : ''}적시타!`;
          else if (goAhead) text = `${b.name} 균형을 깨는 적시타!`;
          else if (tying) text = `${b.name} 동점 적시타!`;
          else text = `${b.name} ${rbi}타점 적시${kind === '1b' ? '타' : ` ${hitName}`}!`;
          sub = `${halfTxt} · ${hitName}${rbi > 0 ? ` · ${rbi}타점` : ''}`;
        } else if (!isHit && goAhead) {
          type = 'score';
          const how = kind === 'bb' ? '밀어내기 볼넷' : kind === 'sf' ? '희생플라이' : kind === 'roe' ? '상대 실책' : '내야 땅볼';
          text = `${b.name} ${how}${leadBefore < 0 ? '로 역전' : '로 균형을 깼다'}!`;
          sub = `${halfTxt} · ${leadBefore < 0 ? '역전' : '리드'} 득점`;
        }
        if (type) {
          let prio = n * 5 + inning;
          if (goAhead) prio += 50;
          if (tying) prio += 15;
          if (kind === 'hr') prio += 20;
          if (opts.focusId && bat.team.id === opts.focusId) prio += 30;
          if (walkoff) prio += 1000;
          cands.push({
            ev: { type, inning, half, teamId: bat.team.id, text, sub, away: A.runs, home: H.runs, rbi, pid: b.id },
            prio,
            seq: seq++,
          });
        }
      }
    }
  };

  // ── 경기 진행 ──
  let innings = 0;
  for (let inning = 1; inning <= SIM.MAX_INNINGS; inning++) {
    innings = inning;
    playHalf(A, H, inning, 0);
    if (inning >= 9 && H.runs > A.runs) break;
    playHalf(H, A, inning, 1);
    if (inning >= 9 && H.runs !== A.runs) break;
  }

  const result: GameResult = {
    homeId: home.id,
    awayId: away.id,
    home: H.runs,
    away: A.runs,
    innings,
    line: [A.line, H.line],
    hits: [A.hits, H.hits],
    events: [],
    starters: [A.used[0].p.id, H.used[0].p.id],
    injuries: [],
  };

  // ── 승/패/세이브 ──
  const W = H.runs > A.runs ? H : A.runs > H.runs ? A : null;
  let savePs: PState | undefined;
  if (W && winP && lossP) {
    let w: PState = winP;
    if (w.starter && w.outs < 15) {
      // 선발 5이닝 미만이면 가장 길게 던진 구원에게 승리
      const rel = W.used.filter((x) => !x.starter).sort((a, b) => b.outs - a.outs)[0];
      if (rel) w = rel;
    }
    const l: PState = lossP;
    w.p.pit.w++;
    l.p.pit.l++;
    result.winP = w.p.id;
    result.lossP = l.p.id;
    const last = W.used[W.used.length - 1];
    if (last !== w && last.outs >= 1 && ((last.entryLead >= 1 && last.entryLead <= 3) || last.outs >= 9)) {
      last.p.pit.sv++;
      result.saveP = last.p.id;
      savePs = last;
    }
  }

  // ── MVP ──
  {
    let top: { pid: string; teamId: string; name: string; text: string } | undefined;
    let topV = -Infinity;
    for (const side of W ? [W] : [A, H]) {
      for (const s of side.order) {
        const l = side.lines.get(s.p.id)!;
        const v = l.h * 1.1 + l.hr * 2.2 + l.rbi * 1.2 + l.r * 0.5 + l.bb * 0.3;
        if (v > topV) {
          topV = v;
          const parts = [`${l.ab}타수 ${l.h}안타`];
          if (l.hr) parts.push(`${l.hr}홈런`);
          if (l.rbi) parts.push(`${l.rbi}타점`);
          top = { pid: s.p.id, teamId: side.team.id, name: s.p.name, text: parts.join(' ') };
        }
      }
      for (const ps of side.used) {
        const v = ps.outs * 0.4 - ps.runs * 1.6 + ps.so * 0.25 + (ps === savePs ? 2 : 0) - 2;
        if (v > topV) {
          topV = v;
          top = {
            pid: ps.p.id,
            teamId: side.team.id,
            name: ps.p.name,
            text: `${fmtIp(ps.outs)}이닝 ${ps.runs}실점 ${ps.so}K${ps === savePs ? ' 세이브' : ''}`,
          };
        }
      }
    }
    if (top) result.mvp = top;
  }

  // ── 부상 판정 ──
  for (const side of [A, H]) {
    const mult = opts.injMult?.[side.team.id] ?? 1;
    const played = [...side.order.map((s) => s.p), ...side.used.map((u) => u.p)];
    // 연투 상태로 등판한 구원은 다치기 쉽다
    const tiredInj = new Map(side.used.map((u) => [u.p.id, u.tired >= 2 ? SIM.TIRED_INJ_2 : u.tired === 1 ? SIM.TIRED_INJ_1 : 1]));
    for (const p of played) {
      if (p.injury > 0) continue;
      if (rng() < SIM.INJ_RATE * mult * (tiredInj.get(p.id) ?? 1)) {
        const games = randInt(rng, 3, 16);
        p.injury = games;
        result.injuries.push({ pid: p.id, name: p.name, teamId: side.team.id, games });
      }
    }
  }

  // ── 연투 피로 갱신: 오늘 구원 등판한 투수는 +1, 나머지는 회복 ──
  for (const side of [A, H]) {
    const relieved = new Set(side.used.filter((u) => !u.starter).map((u) => u.p.id));
    for (const p of side.team.roster) {
      if (p.kind !== 'P') continue;
      if (relieved.has(p.id)) p.tired = Math.min(3, (p.tired ?? 0) + 1); // 3일 이상은 구분하지 않는다 (페널티는 2일에서 상한)
      else if (p.tired) delete p.tired;
    }
  }

  // ── 하이라이트 ──
  if (track) {
    const sc = { away: A.runs, home: H.runs };
    const aS = A.used[0].p;
    const hS = H.used[0].p;
    const startEv: GameEvent = {
      type: 'start', inning: 1, half: 0, teamId: home.id,
      text: `${aS.name} vs ${hS.name}`, sub: '선발 맞대결', away: 0, home: 0,
    };
    const injEv = result.injuries.slice(0, 2).map(
      (j): GameEvent => ({
        type: 'injury', inning: innings, half: 1, teamId: j.teamId,
        text: `${j.name} 부상 이탈`, sub: `${j.games}경기 결장 예상`, away: sc.away, home: sc.home, pid: j.pid,
      }),
    );
    const finalEv: GameEvent = {
      type: 'final', inning: innings, half: 1, teamId: W ? W.team.id : home.id,
      text: W ? `${W.team.city} ${W.team.name} 승리!` : '무승부',
      sub: `경기 종료 · ${away.name} ${sc.away} : ${sc.home} ${home.name}`,
      away: sc.away, home: sc.home,
    };
    const quota = Math.max(0, SIM.MAX_EVENTS - 2 - injEv.length);
    const kept = cands
      .slice()
      .sort((a, b) => b.prio - a.prio)
      .slice(0, quota)
      .sort((a, b) => a.seq - b.seq)
      .map((c) => c.ev);
    result.events = [startEv, ...kept, ...injEv, finalEv];
  }

  return result;
}
