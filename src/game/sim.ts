import type { BatPos, EvType, GameEvent, GameResult, Player, Team } from './types';
import { clamp, randInt, type Rng } from './rng';
import { effDef } from './ratings';
import { slotValue } from './lineup';
import { fmtIp } from './format';

// ── 밸런스 상수 (능력치 REF = 리그 평균 수준에서 아래 기본 확률이 나온다) ──
export const SIM = {
  REF: 60, // 리그 평균 능력치
  SKILL: 0.55, // 능력치 차이의 반영 강도
  BB: 0.088,
  BB_EYE: 0.9,
  BB_CTL: 1.0,
  K: 0.18,
  K_CON: 0.9,
  K_STF: 1.0,
  HR: 0.024,
  HR_POW: 2.5,
  HR_STF: 0.6,
  BABIP: 0.303,
  BABIP_CON: 0.0019,
  BABIP_SPD: 0.0006,
  BABIP_STF: 0.0013,
  BABIP_DEF: 0.0013,
  HOME_EDGE: 0.006, // 홈팀 BABIP 가산
  D2: 0.2, // 안타 중 2루타 비중
  D2_POW: 0.0022,
  D3: 0.016,
  D3_SPD: 0.0008,
  GB: 0.45, // 인플레이 아웃 중 땅볼
  FB: 0.35, // 뜬공
  DP: 0.27, // 1루 주자 + 2사 미만 땅볼의 병살 확률 (인플레이 아웃의 약 12%)
  SAC_FLY: 0.6,
  GB_SCORE: 0.5, // 땅볼 때 3루 주자 득점
  GB_ADV: 0.55,
  SCORE_2ND_1B: 0.6, // 단타에 2루 주자 득점
  FIRST_TO_3RD: 0.28,
  SCORE_1ST_2B: 0.42, // 2루타에 1루 주자 득점
  TWO_OUT_RUN: 0.15, // 2사 후 스타트 보너스
  SP_LIMIT_BASE: 17,
  SP_LIMIT_STA: 0.14,
  RP_LIMIT_BASE: 4,
  RP_LIMIT_STA: 0.1,
  FAT_STF: 2.2, // 한계 초과 타자 1명당 구위 하락
  FAT_CTL: 2.0,
  SP_HOOK_RUNS: 6, // 선발 즉시 강판 실점
  RP_HOOK_RUNS: 3,
  INJ_RATE: 0.0035,
  MAX_INNINGS: 12,
  MAX_EVENTS: 10,
};

interface PState {
  p: Player;
  bf: number;
  outs: number;
  runs: number;
  so: number;
  limit: number;
  starter: boolean;
  entryLead: number;
}
interface Runner {
  b: Player;
  ps: PState;
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
  def: number;
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
  const batters = t.roster.filter((p) => p.kind === 'B');
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
    const any = batters.length ? batters : t.roster;
    if (!any.length) throw new Error(`${t.id}: 출전 가능한 선수가 없습니다`);
    any.slice(0, 9).forEach((p) => order.push({ p, pos: 'DH' }));
  }
  return order;
}

function makeSide(t: Team, isHome: boolean): Side {
  const byId = new Map(t.roster.map((p) => [p.id, p]));
  const order = gameOrder(t);
  const fielders = order.filter((s) => s.pos !== 'DH');
  const def = fielders.length ? fielders.reduce((s, x) => s + effDef(x.p, x.pos), 0) / fielders.length : SIM.REF;

  // 선발: 로테이션 순번에서 건강한 첫 투수
  const rot = t.rotation.map((id) => byId.get(id)).filter((p): p is Player => !!p && p.kind === 'P');
  let starter: Player | undefined;
  if (rot.length) {
    const start = t.nextStarter % rot.length;
    for (let k = 0; k < rot.length; k++) {
      const i = (start + k) % rot.length;
      if (rot[i].injury === 0) {
        starter = rot[i];
        t.nextStarter = (i + 1) % rot.length;
        break;
      }
    }
  }
  const pitchers = t.roster.filter((p) => p.kind === 'P');
  let pen = t.bullpen.map((id) => byId.get(id)).filter((p): p is Player => !!p && p.kind === 'P' && p.injury === 0);
  if (!starter) {
    // 로테이션 전멸: 체력 좋은 불펜이 대체 선발
    starter = pen.slice().sort((a, b) => b.sta - a.sta)[0] ?? pitchers.find((p) => p.injury === 0) ?? pitchers[0] ?? t.roster[0];
    if (!starter) throw new Error(`${t.id}: 투수가 없습니다`);
  }
  pen = pen.filter((p) => p !== starter);
  const cl = t.closer ? byId.get(t.closer) : undefined;
  const closer = cl && cl.injury === 0 && cl !== starter ? cl : null;

  const side: Side = {
    team: t, isHome, order, idx: 0,
    cur: undefined as unknown as PState,
    used: [], pen, closer, def, runs: 0, hits: 0, line: [], lines: new Map(),
  };
  for (const s of order) {
    s.p.bat.g++;
    side.lines.set(s.p.id, { ab: 0, h: 0, hr: 0, rbi: 0, r: 0, bb: 0 });
  }
  enter(side, starter, true, 0);
  return side;
}

function enter(side: Side, p: Player, starter: boolean, lead: number): void {
  const limit = starter ? SIM.SP_LIMIT_BASE + p.sta * SIM.SP_LIMIT_STA : SIM.RP_LIMIT_BASE + p.sta * SIM.RP_LIMIT_STA;
  const ps: PState = { p, bf: 0, outs: 0, runs: 0, so: 0, limit, starter, entryLead: lead };
  p.pit.g++;
  if (starter) p.pit.gs++;
  side.cur = ps;
  side.used.push(ps);
}

/** 투수 교체 판단. atStart = 이닝 시작 시점 */
function manage(fld: Side, bat: Side, inning: number, atStart: boolean): void {
  const lead = fld.runs - bat.runs;
  const cur = fld.cur;
  const over = cur.bf - cur.limit;
  if (atStart && inning >= 9 && lead >= 0 && lead <= 3 && fld.closer && cur.p !== fld.closer) {
    const c = fld.closer;
    fld.closer = null;
    enter(fld, c, false, lead);
    return;
  }
  let need: boolean;
  if (atStart) {
    if (cur.starter) need = over >= -3;
    else need = over >= 0 || (cur.outs >= 3 && !(inning <= 6 && cur.bf + 4 <= cur.limit));
  } else {
    need = cur.starter ? cur.runs >= SIM.SP_HOOK_RUNS || over >= 5 : cur.runs >= SIM.RP_HOOK_RUNS || over >= 3;
  }
  if (!need) return;
  let next: Player | undefined;
  if (fld.pen.length) {
    // 접전 후반은 필승조부터, 그 외에는 추격조부터
    next = inning >= 7 && lead >= -2 ? fld.pen.shift() : fld.pen.pop();
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
  opts: { track: boolean; injMult?: Record<string, number>; focusId?: string },
): GameResult {
  const H = makeSide(home, true);
  const A = makeSide(away, false);
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

    while (outs < 3 && !over) {
      manage(fld, bat, inning, false);
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
        rn.ps.p.pit.er++;
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
        ps.outs += n;
        ps.p.pit.outs += n;
      };

      // ── 타석 확률 ──
      const fat = Math.max(0, ps.bf - ps.limit);
      const stfRaw = Math.max(20, ps.p.stf - fat * SIM.FAT_STF);
      const stf = norm(stfRaw);
      const ctl = norm(Math.max(20, ps.p.ctl - fat * SIM.FAT_CTL));
      const pBB = clamp((SIM.BB * Math.pow(norm(b.eye), SIM.BB_EYE)) / Math.pow(ctl, SIM.BB_CTL), 0.02, 0.28);
      const pK = clamp((SIM.K * Math.pow(stf, SIM.K_STF)) / Math.pow(norm(b.con), SIM.K_CON), 0.04, 0.45);
      const pHR = clamp((SIM.HR * Math.pow(norm(b.pow), SIM.HR_POW)) / Math.pow(stf, SIM.HR_STF), 0.001, 0.13);
      const babip = clamp(
        SIM.BABIP +
          ((b.con - SIM.REF) * SIM.BABIP_CON + (b.spd - SIM.REF) * SIM.BABIP_SPD - (stfRaw - SIM.REF) * SIM.BABIP_STF - (fld.def - SIM.REF) * SIM.BABIP_DEF) * SIM.SKILL +
          (bat.isHome ? SIM.HOME_EDGE : 0),
        0.2,
        0.43,
      );

      b.bat.pa++;
      const x = rng();
      let kind: 'bb' | 'k' | 'hr' | '1b' | '2b' | '3b' | 'out' | 'sf' = 'out';

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
      } else {
        // 인플레이 아웃
        const t = rng();
        if (t < SIM.GB) {
          if (bases[0] && outs < 2 && rng() < SIM.DP) {
            const r2 = bases[1];
            const r3 = bases[2];
            out(2);
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
      if (kind === 'out') {
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
            kind === 'hr' ? `${HR_NAME[n - 1] ?? ''} 홈런`.trim() : isHit ? hitName : kind === 'bb' ? '밀어내기 볼넷' : kind === 'sf' ? '희생플라이' : '결승타';
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
          const how = kind === 'bb' ? '밀어내기 볼넷' : kind === 'sf' ? '희생플라이' : '내야 땅볼';
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
    for (const p of played) {
      if (p.injury > 0) continue;
      if (rng() < SIM.INJ_RATE * mult) {
        const games = randInt(rng, 3, 16);
        p.injury = games;
        result.injuries.push({ pid: p.id, name: p.name, teamId: side.team.id, games });
      }
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
