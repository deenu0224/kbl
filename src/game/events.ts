// 사건은 생긴다 (docs/LEVEL_DESIGN.md 5절). 카드는 무작위 덱이 아니라 지금 상태의 결과다.
// 카드마다 when(core)·우선순위·인물이 있고, 매 경기 후 검사해 1장을 낸다.
// 카드 id 는 "기본id" 또는 "기본id|payload…" 형태 (eventsSeen 에는 기본id 만 기록).
import { RESIGN_ID, resolveResignMut } from './contract';
import type { BatPos, Buff, CharId, Core, EventCard, Player } from './types';
import { clamp, pick, randInt, type Rng } from './rng';
import { calcOvr } from './ratings';
import { fixLineup, slotNewcomer, slotValue } from './lineup';
import { ROSTER_MAX, userTeam } from './economy';
import { fmtMoney } from './format';
import { addNews } from './season';
import { flagForecast, flagOnTrack, hintMut, MID_UP_FAIL_TRUST, stageOf } from './campaign';
import { beatOn, MID_DAY, POS_NAME } from './script';
import { memoGet, memoNum, memoSet, seenCards } from './memo';
import { CARD_LINES, CHARACTERS, NEWS, STAGE_STORY, TRUST_LABEL } from './story';
import { batLeaders, era, ops, pitLeaders } from './leaders';
import { isFranchise } from './franchise';

const posKo = (pos: string): string => POS_NAME[pos] ?? pos;

// ── 튜닝 상수 ──
export const EVENT_GAP = 8; // 카드 간 최소 경기 수
export const EVENT_MAX = 5; // 시즌 최대 장수 (중간 점검·장의 대본 카드는 따로)
export const FOREIGN_MAX = 3;
const STAGE_SCALE = 0.3; // 금액 스케일 = 1 + stage × 0.3 + fans / FAN_SCALE
const FAN_SCALE = 40000;
const BUFF_GAMES = 6;
const BUFF_LONG = 12;

const N = {
  vetGames: 12, // 베테랑 복귀: 고정 출전 경기 수
  vetFocus: 1,
  holdSat: -6,
  holdFocus: -2,
  analystCost: 30000,
  trustYouth: 2, // 팀장을 믿어 주면 다음 드래프트 풀 품질
  coldYouth: -2, // 팀장과 서먹해지면
  crackCostMin: 10000, // 단속 비용: 팬 규모 비례, 최소 1억
  crackCostPerFan: 1.5,
  crackSat: 4,
  crackFans: 100,
  crackDemand: 0.95, // 검문 대기로 다음 홈경기 수요가 준다
  crackGames: 3,
  ignoreSat: -4,
  hikeTicket: 1.12, // 가격 인상 안내: 암표 웃돈을 정가로 흡수
  hikeGames: 5,
  hikeSat: -7,
  meetTicket: 0.8,
  meetSat: 8,
  silentSat: -6,
  goodsCostMin: 15000, // 굿즈 콜라보 투자: 팬 규모 비례, 최소 1.5억
  goodsCostPerFan: 2.5,
  goodsMult: 3,
  goodsFans: 0.05, // 한정판을 사러 온 새 팬 (팬 규모 대비)
  goodsStar: 70,
  tourDemand: 1.15, // 관광객 패키지
  tourTicket: 0.9,
  tourSat: -3,
  weekendFill: 0.8,
  raiseRate: 0.2,
  refuseStar: -10,
  refuseAbil: -2,
  refuseFans: -200,
  tradeBench: 65,
  tradeWeak: 55,
  earlyGames: 5,
  reinjury: 0.3,
  pushGain: 3,
  pushSlump: -3,
  benchSat: -2,
  restGames: 3,
  armInjury: 0.25,
  retireDemand: 1.2,
  retireAge: 38, // 은퇴를 꺼내는 나이 (KBO 스타들은 대개 38~41세에 은퇴). 40세가 되면 season.ts 가 은퇴시킨다
  stayBonus: 0.2, // '한 해 더' 설득 비용 (연봉 대비)
  staySat: 2,
  retireStar: 60,
  retireCost: 4000, // 기념 경기 행사 비용 (스케일 적용)
  quietSat: -3,
  typhoonTired: 2,
  typhoonFocus: -3,
  typhoonGames: 3,
  domeTrust: 10,
  domeCash: 200000,
  dealTrust: -25,
  dealSat: -10,
};

interface CardDef {
  id: string;
  prio: number; // 높을수록 먼저
  forced?: boolean; // 중간 점검·장의 대본 카드: 간격·상한 예외
  when: (core: Core) => boolean;
  make: (core: Core, rng: Rng) => EventCard | null;
  resolve: (core: Core, idx: number, card: EventCard, rng: Rng) => string;
}

const scale = (core: Core) => 1 + core.campaign.stage * STAGE_SCALE + core.fans / FAN_SCALE;
const money = (core: Core, v: number) => Math.round((v * scale(core)) / 1000) * 1000;
const fanCost = (core: Core, min: number, perFan: number) => Math.max(min, Math.round((core.fans * perFan) / 1000) * 1000);
const goodsCut = (m: number) => 1 + (m - 1) / 2;
const cashGate = (core: Core, cost: number): string | undefined => (core.finance.cash < cost ? `현금 부족 (필요 ${fmtMoney(cost)})` : undefined);
const sat = (core: Core, d: number) => (core.fanSat = clamp(Math.round((core.fanSat + d) * 10) / 10, 0, 100));
const spend = (core: Core, v: number) => {
  core.finance.cash -= v;
  core.finance.ledger.upkeep += v;
};
const addBuff = (core: Core, b: Buff) => core.campaign.buffs.push(b);
const findUser = (core: Core, pid?: string) => (pid ? userTeam(core).roster.find((p) => p.id === pid) : undefined);
const parts = (card: EventCard) => card.id.split('|');
const sgn = (v: number) => (v >= 0 ? `+${v}` : `${v}`);
const pctTxt = (m: number) => `${m >= 1 ? '+' : '−'}${Math.abs(Math.round((m - 1) * 100))}%`;
/** 방금 치른 경기일 */
const lastDay = (core: Core) => core.day - 1;

type AbilKey = 'con' | 'pow' | 'eye' | 'spd' | 'def' | 'stf' | 'ctl' | 'sta';
const keysOf = (p: Player): AbilKey[] => (p.kind === 'B' ? ['con', 'pow', 'eye', 'spd', 'def'] : ['stf', 'ctl', 'sta']);
function bump(p: Player, rng: Rng, d: number, n: number): void {
  const ks = keysOf(p);
  for (let i = 0; i < n; i++) {
    const k = pick(rng, ks);
    p[k] = clamp(p[k] + d, 20, 99);
  }
  p.ovr = calcOvr(p);
  p.pot = Math.max(p.pot, p.ovr);
}

/** 카드 공통 필드: 인물·대사는 story.ts 에서 */
function card(id: string, lineKey: string | null, o: Omit<EventCard, 'id' | 'who' | 'line'> & { who?: CharId; line?: string }): EventCard {
  const l = lineKey ? CARD_LINES[lineKey] : undefined;
  return { id, ...o, ...(o.who ?? l?.who ? { who: o.who ?? l!.who } : {}), ...(o.line ?? l?.line ? { line: o.line ?? l!.line } : {}) };
}

const lineupIds = (core: Core) => new Set(userTeam(core).lineup.map((s) => s.pid));
const keyIds = (core: Core) => {
  const t = userTeam(core);
  return new Set([...t.lineup.map((s) => s.pid), ...t.rotation, ...(t.closer ? [t.closer] : [])]);
};
const benchBatters = (core: Core) => {
  const ids = lineupIds(core);
  return userTeam(core).roster.filter((p) => p.kind === 'B' && !p.farm && !ids.has(p.id) && p.injury === 0);
};

// ── 카드별 보조 ──

/** 베테랑 복귀 요구의 대상: 벤치의 30세 이상 타자 중 이름값이 가장 큰 선수와, 그가 밀어낼 자리 */
function veteranCase(core: Core): { vet: Player; slot: number; out: Player } | null {
  const t = userTeam(core);
  const vets = benchBatters(core).filter((p) => p.age >= 30);
  if (!vets.length) return null;
  const vet = vets.reduce((a, b) => (a.age + a.salary / 10000 >= b.age + b.salary / 10000 ? a : b));
  const byId = new Map(t.roster.map((p) => [p.id, p]));
  const cands = t.lineup.map((s, i) => ({ i, s, p: byId.get(s.pid) })).filter((x): x is { i: number; s: { pid: string; pos: BatPos }; p: Player } => !!x.p);
  if (!cands.length) return null;
  const same = cands.filter((x) => x.s.pos === vet.pos || x.s.pos === 'DH');
  const tgt = (same.length ? same : cands).reduce((a, b) => (a.p.age <= b.p.age ? a : b));
  // 감독이 미는 건 이름값이다 — 실력이 더 나은 선수를 벤치에 둔 경우(전임 체제의 유산)는 이 갈등이 아니다
  if (slotValue(vet, tgt.s.pos) >= slotValue(tgt.p, tgt.s.pos)) return null;
  return { vet, slot: tgt.i, out: tgt.p };
}

/** 스카우트 팀장이 고른 선수의 상태 */
function scoutPickCase(core: Core): { p: Player; state: 'unsigned' | 'slump' } | null {
  const pid = memoGet(core, 'scoutPick');
  if (!pid) return null;
  const fa = core.freeAgents.find((p) => p.id === pid);
  if (fa) return { p: fa, state: 'unsigned' };
  const mine = findUser(core, pid);
  if (!mine) return null;
  const slump = mine.kind === 'B' ? mine.bat.pa >= 30 && ops(mine) < 0.66 : mine.pit.outs >= 30 && era(mine) > 5.0;
  return slump ? { p: mine, state: 'slump' } : null;
}

function recentSellouts(core: Core): number {
  return (memoGet(core, 'so') ?? '').slice(-5).split('').filter((ch) => ch === '1').length;
}

/** 간판(star 최고) 선수가 타이틀 3위 이내인가 */
function titleRace(core: Core): Player | null {
  const t = userTeam(core);
  const act = t.roster.filter((x) => !x.farm);
  if (!act.length) return null;
  const p = act.reduce((a, b) => (a.star >= b.star ? a : b));
  if (p.star < 55) return null;
  const top3 = (rows: { pid: string }[]) => rows.some((r) => r.pid === p.id);
  const hit =
    p.kind === 'B'
      ? (['avg', 'hr', 'rbi', 'sb'] as const).some((c) => top3(batLeaders(core, c, 3)))
      : (['era', 'w', 'sv', 'so'] as const).some((c) => top3(pitLeaders(core, c, 3)));
  return hit ? p : null;
}

function tradeCase(core: Core): { me: Player; slot: number; weak: Player } | null {
  const t = userTeam(core);
  const bench = benchBatters(core).filter((p) => p.ovr >= N.tradeBench);
  if (!bench.length) return null;
  const byId = new Map(t.roster.map((p) => [p.id, p]));
  let slot = -1;
  let weak: Player | null = null;
  t.lineup.forEach((s, i) => {
    const p = byId.get(s.pid);
    if (p && s.pos !== 'DH' && (!weak || p.ovr < weak.ovr)) {
      weak = p;
      slot = i;
    }
  });
  if (!weak || (weak as Player).ovr >= N.tradeWeak) return null;
  return { me: bench.reduce((a, b) => (a.ovr >= b.ovr ? a : b)), slot, weak };
}

const hurtStarters = (core: Core) => {
  const ids = keyIds(core);
  return userTeam(core).roster.filter((p) => ids.has(p.id) && p.injury >= N.earlyGames);
};

/** 세대교체 구간에서 새로 주전에 오른 23세 이하 */
function promotedYoung(core: Core): Player | null {
  const before = new Set((memoGet(core, 'lu48') ?? '').split(','));
  if (before.size <= 1) return null;
  const t = userTeam(core);
  const ids = lineupIds(core);
  return t.roster.find((p) => ids.has(p.id) && p.age <= 23 && !before.has(p.id)) ?? null;
}

const overworked = (core: Core) => userTeam(core).roster.filter((p) => p.kind === 'P' && (p.tired ?? 0) >= 3 && p.injury === 0);
const retiree = (core: Core) =>
  userTeam(core)
    .roster.filter((p) => !p.farm && p.age >= N.retireAge && p.star >= N.retireStar)
    .sort((a, b) => b.star - a.star)[0];

export const CARDS: CardDef[] = [
  // ───────── FA 자격 재계약 (스토브리그. 시즌 중에는 뽑히지 않고 contract.ts drawResign 이 올린다) ─────────
  { id: RESIGN_ID, prio: 0, forced: true, when: () => false, make: () => null, resolve: (c, i, cd) => resolveResignMut(c, i, cd) },
  // ───────── 중간 점검 (42경기 직후, 매 시즌, 조합장) ─────────
  {
    id: 'midcheck',
    prio: 100,
    forced: true,
    when: (c) => c.day >= MID_DAY && c.day < MID_DAY + 6,
    make: (c) => {
      const ahead = flagOnTrack(c);
      const st = stageOf(c);
      const story = STAGE_STORY[clamp(c.campaign.stage, 0, STAGE_STORY.length - 1)];
      const flag = c.campaign.objectives.find((o) => o.main)?.text ?? st.name;
      return card(`midcheck|${ahead ? 'ahead' : 'behind'}`, null, {
        title: '조합장 면담',
        icon: '🍊',
        who: 'chair',
        line: ahead ? story.midAhead : story.midBehind,
        body: `${ahead ? `시즌 절반. 지금 페이스면 「${flag}」에 닿습니다.` : `시즌 절반. 지금 페이스로는 「${flag}」에 닿지 못합니다.`}${flagForecast(c).text === '—' ? '' : ` ${flagForecast(c).text}`}`,
        choices: ahead
          ? [
              { label: '목표 상향을 약속한다', desc: `깃발 달성 시 지원금 2배 (${fmtMoney(st.reward.cash)} → ${fmtMoney(st.reward.cash * 2)}) · 실패 시 ${TRUST_LABEL} 추가 −${MID_UP_FAIL_TRUST}` },
              { label: '사양한다', desc: '변화 없음' },
            ]
          : [
              { label: '조합원 특별 출자를 받는다', desc: `현금 +${fmtMoney(st.midCash)} · 깃발 실패 시 ${TRUST_LABEL} 추가 −5` },
              { label: '지금대로 간다', desc: '변화 없음' },
            ],
      });
    },
    resolve: (c, i, cd) => {
      const ahead = parts(cd)[1] === 'ahead';
      if (i !== 0) return ahead ? '약속은 아껴 두었습니다' : '조합원들의 주머니는 건드리지 않았습니다';
      if (ahead) {
        memoSet(c, 'mid', 'up');
        return '조합장에게 더 높은 곳을 약속했습니다';
      }
      const v = stageOf(c).midCash;
      c.finance.cash += v;
      c.finance.ledger.league += v;
      memoSet(c, 'mid', 'loan');
      hintMut(c, 'finance');
      return `조합원 특별 출자 — 현금 +${fmtMoney(v)}`;
    },
  },

  // ───────── 장의 대본 카드 ─────────
  {
    id: 'dome',
    prio: 95,
    forced: true,
    when: (c) => c.campaign.stage === 4 && !!beatOn(c, c.day, 'dome'),
    make: () =>
      card('dome', 'dome', {
        title: '돔구장의 제안',
        icon: '🏟️',
        body: '육지의 한 도시가 신축 돔구장과 이전 지원금을 내밀었습니다. 우승을 눈앞에 둔 지금.',
        choices: [
          { label: '거절한다', desc: `${TRUST_LABEL} ${sgn(N.domeTrust)}` },
          { label: '협상 테이블에 앉는다', desc: `현금 +${fmtMoney(N.domeCash)} · ${TRUST_LABEL} ${N.dealTrust} · 팬 만족 ${N.dealSat}` },
        ],
      }),
    resolve: (c, i) => {
      if (i === 0) {
        c.campaign.trust = clamp(c.campaign.trust + N.domeTrust, 0, 100);
        return '"이 팀은 섬의 것입니다" — 제안을 돌려보냈습니다';
      }
      c.finance.cash += N.domeCash;
      c.finance.ledger.league += N.domeCash;
      c.campaign.trust = clamp(c.campaign.trust + N.dealTrust, 0, 100);
      c.campaign.dealt = true;
      sat(c, N.dealSat);
      return '협상 테이블에 앉았습니다 — 소문은 하루 만에 섬을 돌았습니다';
    },
  },
  {
    id: 'veteran',
    prio: 90,
    forced: true,
    when: (c) => c.campaign.stage === 0 && !c.campaign.managerYielded && !!beatOn(c, lastDay(c), 'road-trip') && userTeam(c).rec.streak <= -3 && !!veteranCase(c),
    make: (c) => {
      const v = veteranCase(c);
      if (!v) return null;
      return card(`veteran|${v.slot}`, 'veteran', {
        title: '베테랑 복귀 요구',
        icon: '🧓',
        pid: v.vet.id,
        body: `원정 ${-userTeam(c).rec.streak}연패. 감독이 벤치의 ${v.vet.name}(${v.vet.age}세, OVR ${v.vet.ovr})을 ${v.out.name}(${v.out.age}세, OVR ${v.out.ovr}) 자리에 쓰겠다고 합니다.`,
        choices: [
          { label: '복귀시킨다', desc: `${v.vet.name} ${N.vetGames}경기 고정 출전 (그 뒤 ${v.out.name} 복귀) · ${BUFF_GAMES}경기 집중력 ${sgn(N.vetFocus)}` },
          { label: '지금 타순을 고수한다', desc: `팬 만족 ${N.holdSat} · ${BUFF_GAMES}경기 집중력 ${N.holdFocus} · 이후 감독이 편성에서 손을 뗀다` },
        ],
      });
    },
    resolve: (c, i, cd) => {
      const t = userTeam(c);
      const vet = findUser(c, cd.pid);
      if (i === 0) {
        const slot = t.lineup[Number(parts(cd)[1])];
        if (vet && slot && !t.lineup.some((s) => s.pid === vet.id)) {
          memoSet(c, `fx-${vet.id}`, slot.pid); // 고정 출전이 끝나면 밀려난 선수가 제자리로 돌아온다
          slot.pid = vet.id;
        }
        if (vet) addBuff(c, { kind: 'fixed', value: 1, until: c.day + N.vetGames, label: `${vet.name} 고정 출전`, pid: vet.id });
        addBuff(c, { kind: 'focus', value: N.vetFocus, until: c.day + BUFF_GAMES, label: `라커룸 안정 집중력 ${sgn(N.vetFocus)}` });
        hintMut(c, 'lineup');
        return `${vet?.name ?? '베테랑'} 선발 복귀 — 감독의 얼굴이 폈습니다`;
      }
      sat(c, N.holdSat);
      addBuff(c, { kind: 'focus', value: N.holdFocus, until: c.day + BUFF_GAMES, label: `라커룸 동요 집중력 ${N.holdFocus}` });
      c.campaign.managerYielded = true;
      addNews(c, NEWS.managerYield, 'info');
      return '타순을 지켰습니다 — 감독은 말없이 수첩을 덮었습니다';
    },
  },
  {
    id: 'notyet',
    prio: 90,
    forced: true,
    when: (c) => c.campaign.stage === 2 && !!beatOn(c, lastDay(c), 'gen-change') && !!promotedYoung(c),
    make: (c) => {
      const p = promotedYoung(c);
      if (!p) return null;
      return card('notyet', 'notyet', {
        title: '아직 이릅니다',
        icon: '🌱',
        pid: p.id,
        body: `${p.name}(${p.age}세, OVR ${p.ovr} · 잠재력 ${p.pot})이 주전 명단에 올랐습니다. 2군 코치가 찾아왔습니다.`,
        choices: [
          { label: '밀어붙인다', desc: `50% 능력치 +${N.pushGain} 성장 / 50% ${BUFF_LONG}경기 슬럼프(능력치 ${N.pushSlump})` },
          { label: '내린다', desc: `${p.name} 벤치로 · 팬 만족 ${N.benchSat}` },
        ],
      });
    },
    resolve: (c, i, cd, rng) => {
      const p = findUser(c, cd.pid);
      if (!p) return '없던 일이 되었습니다';
      if (i === 0) {
        if (rng() < 0.5) {
          const before = p.ovr;
          bump(p, rng, 1, N.pushGain * 2);
          return `${p.name}, 1군 무대에서 껍질을 깼습니다 — OVR ${before} → ${p.ovr}`;
        }
        addBuff(c, { kind: 'slump', value: N.pushSlump, until: c.day + BUFF_LONG, label: `${p.name} 슬럼프`, pid: p.id });
        return `${p.name}, 1군의 벽에 부딪혔습니다 — ${BUFF_LONG}경기 슬럼프`;
      }
      const t = userTeam(c);
      const slot = t.lineup.find((s) => s.pid === p.id);
      const bench = benchBatters(c);
      if (slot && bench.length) slot.pid = bench.reduce((a, b) => (slotValue(a, slot.pos) >= slotValue(b, slot.pos) ? a : b)).id;
      sat(c, N.benchSat);
      return `${p.name}을(를) 벤치로 내렸습니다`;
    },
  },
  {
    id: 'arm',
    prio: 85,
    forced: true,
    when: (c) => c.campaign.stage >= 3 && overworked(c).length > 0,
    make: (c) => {
      const p = overworked(c).sort((a, b) => b.ovr - a.ovr)[0];
      if (!p) return null;
      return card('arm', 'arm', {
        title: '팔은 소모품이 아니다',
        icon: '💪',
        pid: p.id,
        body: `${p.name}(${posKo(p.pos)}, OVR ${p.ovr})이 사흘 연속 마운드에 올랐습니다.`,
        choices: [
          { label: '휴식을 보장한다', desc: `${p.name} ${N.restGames}경기 등판 불가` },
          { label: '강행한다', desc: `부상 위험 ${Math.round(N.armInjury * 100)}% (8~15경기 결장)` },
        ],
      });
    },
    resolve: (c, i, cd, rng) => {
      const p = findUser(c, cd.pid);
      if (!p) return '없던 일이 되었습니다';
      if (i === 0) {
        addBuff(c, { kind: 'rest', value: 1, until: c.day + N.restGames, label: `${p.name} 휴식 보장`, pid: p.id });
        delete p.tired;
        return `${p.name}에게 ${N.restGames}경기 휴식을 주었습니다`;
      }
      if (rng() < N.armInjury) {
        p.injury = randInt(rng, 8, 15);
        hintMut(c, 'pitchers');
        return `${p.name}, 팔꿈치를 잡고 내려왔습니다 — ${p.injury}경기 결장`;
      }
      return `${p.name}은(는) 오늘도 불펜에서 몸을 풉니다`;
    },
  },
  {
    id: 'typhoon',
    prio: 80,
    forced: true,
    when: (c) => {
      const b = beatOn(c, c.day, 'rainy');
      return !!b && c.day >= b.from + 2;
    },
    make: () =>
      card('typhoon', null, {
        title: '태풍 결항',
        icon: '🌀',
        body: '태풍으로 육지행 비행기가 전부 결항되었습니다. 다음 원정 경기를 어떻게든 치러야 합니다.',
        choices: [
          { label: '경기를 연기한다', desc: '더블헤더 편성 — 불펜 전원 2연투 피로 상태' },
          { label: '배편으로 강행한다', desc: `${N.typhoonGames}경기 집중력 ${N.typhoonFocus}` },
        ],
      }),
    resolve: (c, i) => {
      if (i === 0) {
        const t = userTeam(c);
        const ids = new Set([...t.bullpen, ...(t.closer ? [t.closer] : [])]);
        for (const p of t.roster) if (ids.has(p.id)) p.tired = Math.max(p.tired ?? 0, N.typhoonTired);
        hintMut(c, 'pitchers');
        return '경기 연기 — 더블헤더로 불펜이 바닥났습니다';
      }
      addBuff(c, { kind: 'focus', value: N.typhoonFocus, until: c.day + N.typhoonGames, label: `뱃멀미 집중력 ${N.typhoonFocus}` });
      return '밤배를 탔습니다 — 선수단 얼굴이 하얗습니다';
    },
  },
  {
    id: 'oldeye',
    prio: 75,
    forced: true,
    when: (c) => c.campaign.stage === 0 && c.day >= 24 && c.day < MID_DAY && !!scoutPickCase(c),
    make: (c) => {
      const s = scoutPickCase(c);
      if (!s) return null;
      const { p } = s;
      const t = userTeam(c);
      const hired = !!c.campaign.analyst;
      // 2지선다: 믿어 준다 / 데이터 분석원 채용. 이미 채용했거나 현금이 모자라면 둘째는 "수첩을 밀어낸다"(항상 고를 수 있다)
      const hire = !hired && !cashGate(c, N.analystCost);
      const second = [
        hire
          ? { label: '데이터 분석원을 채용한다', desc: `비용 ${fmtMoney(N.analystCost)} · 드래프트 등급이 정확해진다 · 팀장과 서먹(다음 드래프트 풀 품질 ${N.coldYouth})` }
          : { label: hired ? '분석원의 보고서를 따른다' : '수첩을 밀어낸다', desc: `팀장과 서먹 — 다음 드래프트 풀 품질 ${N.coldYouth}` },
      ];
      const tail = hire ? 'hire' : 'cold';
      if (s.state === 'unsigned') {
        const dis = t.roster.filter((x) => !x.farm).length >= ROSTER_MAX ? '1군이 가득 찼습니다' : undefined;
        return card(`oldeye|unsigned|${tail}`, 'oldeyeUnsigned', {
          title: '옛날 눈',
          icon: '📓',
          pid: p.id,
          body: `팀장이 명단 맨 위에 올린 ${p.name}(${posKo(p.pos)}, ${p.age}세, OVR ${p.ovr}, 스타성 ${p.star})은 아직 시장에 있습니다.`,
          choices: [{ label: '믿어 준다', desc: `${p.name} 영입 (계약금 면제 · 연봉 ${fmtMoney(p.salary)}) · 다음 드래프트 풀 품질 ${sgn(N.trustYouth)}`, disabled: dis }, ...second],
        });
      }
      return card(`oldeye|slump|${tail}`, 'oldeyeSlump', {
        title: '옛날 눈',
        icon: '📓',
        pid: p.id,
        body: `팀장이 민 ${p.name}(${p.age}세, OVR ${p.ovr})이 부진합니다.`,
        choices: [{ label: '믿어 준다', desc: `${p.name} ${N.vetGames}경기 고정 출전 · 다음 드래프트 풀 품질 ${sgn(N.trustYouth)}` }, ...second],
      });
    },
    resolve: (c, i, cd) => {
      const t = userTeam(c);
      if (i === 0) {
        addBuff(c, { kind: 'youth', value: N.trustYouth, until: 9999, label: '스카우트 팀장의 신뢰 (드래프트 품질↑)' });
        if (parts(cd)[1] === 'unsigned') {
          const p = c.freeAgents.find((x) => x.id === cd.pid);
          if (!p) return '그 사이 다른 팀이 데려갔습니다';
          c.freeAgents = c.freeAgents.filter((x) => x.id !== p.id);
          p.since = c.season;
          t.roster.push(p);
          const role = slotNewcomer(t, p);
          c.fans += p.star * 2;
          hintMut(c, 'lineup');
          return `${p.name} 입단 (${role}) — 팀장이 오랜만에 웃었습니다`;
        }
        const p = findUser(c, cd.pid);
        if (p) addBuff(c, { kind: 'fixed', value: 1, until: c.day + N.vetGames, label: `${p.name} 고정 출전`, pid: p.id });
        return '한 번 더 믿어 보기로 했습니다';
      }
      addBuff(c, { kind: 'youth', value: N.coldYouth, until: 9999, label: '스카우트 팀장과 서먹 (드래프트 품질↓)' });
      if (c.campaign.analyst || parts(cd)[2] !== 'hire') return '팀장의 수첩을 조용히 밀어냈습니다';
      spend(c, N.analystCost);
      c.campaign.analyst = true;
      return '데이터 분석원 채용 — 드래프트 보고서의 등급이 정확해집니다';
    },
  },

  // ───────── 상태가 만드는 카드 (카드 간 8경기, 시즌 5장) ─────────
  {
    id: 'meeting',
    prio: 60,
    when: (c) => userTeam(c).rec.streak <= -5,
    make: (c) =>
      card('meeting', 'meeting', {
        title: '팬 간담회',
        icon: '🙇',
        body: `${-userTeam(c).rec.streak}연패. 팬들이 간담회를 요구합니다.`,
        choices: [
          { label: '사과 + 할인', desc: `${BUFF_GAMES} 홈경기 입장 수입 ${pctTxt(N.meetTicket)} · 팬 만족 ${sgn(N.meetSat)}` },
          { label: '침묵', desc: `팬 만족 ${N.silentSat}` },
        ],
      }),
    resolve: (c, i) => {
      if (i === 0) {
        sat(c, N.meetSat);
        addBuff(c, { kind: 'ticket', value: N.meetTicket, until: 9999, left: BUFF_GAMES, label: `사과 할인 입장 수입 ${pctTxt(N.meetTicket)}` });
        return '진심 어린 사과 — 팬심이 조금 누그러졌습니다';
      }
      sat(c, N.silentSat);
      return '침묵… 팬들의 실망이 커집니다';
    },
  },
  {
    id: 'scalper',
    prio: 55,
    when: (c) => recentSellouts(c) >= 4,
    make: (c) => {
      const cost = fanCost(c, N.crackCostMin, N.crackCostPerFan);
      return card('scalper', 'scalper', {
        title: '암표 소동',
        icon: '🎟️',
        body: '매진이 이어지자 게이트 앞에 암표상이 나타났습니다.',
        choices: [
          { label: '단속한다', desc: `비용 ${fmtMoney(cost)} · 검문 대기로 ${N.crackGames} 홈경기 관중 수요 ${pctTxt(N.crackDemand)} · 팬 만족 ${sgn(N.crackSat)} · 팬 +${N.crackFans}`, disabled: cashGate(c, cost) },
          { label: '방치한다', desc: `비용 없음 · 팬 만족 ${N.ignoreSat}` },
          { label: '가격 인상을 안내한다', desc: `${N.hikeGames} 홈경기 입장 수입 ${pctTxt(N.hikeTicket)} · 팬 만족 ${N.hikeSat}` },
        ],
      });
    },
    resolve: (c, i) => {
      if (i === 0) {
        spend(c, fanCost(c, N.crackCostMin, N.crackCostPerFan));
        sat(c, N.crackSat);
        c.fans += N.crackFans;
        addBuff(c, { kind: 'demand', value: N.crackDemand, until: 9999, left: N.crackGames, label: `게이트 검문 수요 ${pctTxt(N.crackDemand)}` });
        return '암표 단속 — 정가에 표를 산 팬들이 박수를 보냅니다';
      }
      if (i === 1) {
        sat(c, N.ignoreSat);
        return '암표상이 활개 칩니다 — 팬들의 불만이 쌓입니다';
      }
      addBuff(c, { kind: 'ticket', value: N.hikeTicket, until: 9999, left: N.hikeGames, label: `인상 안내 입장 수입 ${pctTxt(N.hikeTicket)}` });
      sat(c, N.hikeSat);
      hintMut(c, 'stadium');
      return '웃돈이 매표소로 들어옵니다 — 정가를 믿던 팬들은 씁쓸합니다';
    },
  },
  {
    id: 'early',
    prio: 50,
    when: (c) => hurtStarters(c).length > 0,
    make: (c) => {
      const p = hurtStarters(c).sort((a, b) => b.ovr - a.ovr)[0];
      if (!p) return null;
      return card('early', 'early', {
        title: '조기 복귀',
        icon: '🩹',
        pid: p.id,
        body: `${p.name}(OVR ${p.ovr})이 ${p.injury}경기 남은 재활을 건너뛰고 뛰겠다고 합니다.`,
        choices: [
          { label: '강행', desc: `즉시 복귀 · 재부상 위험 ${Math.round(N.reinjury * 100)}% (4~10경기 추가)` },
          { label: '대기', desc: `재활 계속 (${p.injury}경기 결장)` },
        ],
      });
    },
    resolve: (c, i, cd, rng) => {
      const p = findUser(c, cd.pid);
      if (i !== 0 || !p) return '재활을 끝까지 마치기로 했습니다';
      const left = p.injury;
      if (rng() < N.reinjury) {
        p.injury = left + randInt(rng, 4, 10);
        return `${p.name} 복귀 훈련 중 재부상… ${p.injury}경기 결장`;
      }
      p.injury = 0;
      fixLineup(userTeam(c));
      return `${p.name} 조기 복귀!`;
    },
  },
  {
    id: 'goods',
    prio: 45,
    when: (c) => userTeam(c).rec.streak >= 4 && userTeam(c).roster.some((p) => p.star >= N.goodsStar),
    make: (c) => {
      const cost = fanCost(c, N.goodsCostMin, N.goodsCostPerFan);
      const fans = Math.round(c.fans * N.goodsFans);
      return card('goods', 'goods', {
        title: '굿즈 콜라보',
        icon: '🧢',
        body: `${userTeam(c).rec.streak}연승. 캐릭터 브랜드가 한정판 굿즈 콜라보를 제안했습니다.`,
        choices: [
          { label: '투자', desc: `비용 ${fmtMoney(cost)} → ${BUFF_LONG}경기 굿즈 ×${N.goodsMult} · 팬 +${fans} · 연승이 끊기면 남은 기간 효과 절반(×${goodsCut(N.goodsMult)})`, disabled: cashGate(c, cost) },
          { label: '패스', desc: '변화 없음' },
        ],
      });
    },
    resolve: (c, i) => {
      if (i !== 0) return '콜라보는 패스했습니다';
      spend(c, fanCost(c, N.goodsCostMin, N.goodsCostPerFan));
      c.fans += Math.round(c.fans * N.goodsFans);
      // pid 'streak' = 연승이 이어지는 동안의 표시. 끊기면 cutGoodsMut 이 효과를 절반으로 줄인다
      addBuff(c, { kind: 'merch', value: N.goodsMult, until: c.day + BUFF_LONG, label: `굿즈 콜라보 ×${N.goodsMult}`, pid: 'streak' });
      return '한정판 굿즈 출시!';
    },
  },
  {
    id: 'trade',
    prio: 40,
    when: (c) => !!tradeCase(c),
    make: (c, rng) => {
      const tc = tradeCase(c);
      if (!tc) return null;
      const { me, slot, weak } = tc;
      const pos = userTeam(c).lineup[slot].pos;
      const cands = c.teams
        .filter((t) => t.id !== c.userId)
        .flatMap((t) => t.roster.filter((p) => p.kind === 'B' && p.pos === pos && !p.foreign && p.ovr >= weak.ovr + 6 && p.ovr <= me.ovr + 2).map((p) => ({ t, p })));
      if (!cands.length) return null;
      const { t, p } = pick(rng, cands);
      const cash = Math.max(0, Math.round((((me.ovr - p.ovr) * 2500 + 3000) * scale(c)) / 1000) * 1000);
      return card(`trade|${t.id}|${p.id}|${cash}`, 'trade', {
        title: '트레이드 제안',
        icon: '🔄',
        pid: me.id,
        body: `${t.city} ${t.name}이(가) 벤치의 ${me.name}(${posKo(me.pos)} OVR ${me.ovr}, ${me.age}세, 연봉 ${fmtMoney(me.salary)})을 원합니다. 대가는 ${p.name}(${posKo(p.pos)} OVR ${p.ovr}, ${p.age}세, 연봉 ${fmtMoney(p.salary)})${cash ? ` + 현금 ${fmtMoney(cash)}` : ''}.`,
        choices: [
          { label: '수락', desc: `${me.name} ↔ ${p.name}${cash ? ` + ${fmtMoney(cash)}` : ''} · 연봉 ${sgn(Math.round((p.salary - me.salary) / 100) / 100)}억` },
          { label: '거절', desc: '현 전력 유지' },
        ],
      });
    },
    resolve: (c, i, cd) => {
      if (i !== 0) return '트레이드 제안을 거절했습니다';
      const [, tid, aid, cashS] = parts(cd);
      const u = userTeam(c);
      const t = c.teams.find((x) => x.id === tid);
      const me = findUser(c, cd.pid);
      const ap = t?.roster.find((x) => x.id === aid);
      if (!t || !me || !ap) return '상대 구단 사정으로 트레이드가 무산되었습니다';
      if (isFranchise(me, c.season)) {
        c.fans = Math.max(1000, c.fans - me.star * 8);
        sat(c, -8);
        addNews(c, NEWS.franchiseGone(me.name), 'bad');
      }
      u.roster = u.roster.filter((x) => x.id !== me.id);
      t.roster = t.roster.filter((x) => x.id !== ap.id);
      delete me.since;
      ap.since = c.season;
      u.roster.push(ap);
      t.roster.push(me);
      fixLineup(u);
      slotNewcomer(u, ap);
      fixLineup(t);
      slotNewcomer(t, me);
      const cash = Number(cashS) || 0;
      c.finance.cash += cash;
      c.finance.ledger.sales += cash;
      addNews(c, `트레이드: ${me.name} ↔ ${ap.name}(${t.name})${cash ? ` + ${fmtMoney(cash)}` : ''}`, 'info');
      hintMut(c, 'lineup');
      return `트레이드 성사 — ${ap.name} 합류`;
    },
  },
  {
    id: 'tourist',
    prio: 35,
    when: (c) => {
      const d = lastDay(c);
      const m = c.schedule[d]?.find((g) => g.homeId === c.userId);
      return !!m && d % 6 >= 4 && !!c.crowd && c.crowd.capacity > 0 && c.crowd.attendance / c.crowd.capacity < N.weekendFill;
    },
    make: () =>
      card('tourist', 'tourist', {
        title: '관광객 패키지',
        icon: '🧳',
        body: '여행사가 "야구장 포함 제주 패키지"를 제안했습니다.',
        choices: [
          { label: '여행사와 제휴한다', desc: `${BUFF_LONG} 홈경기 관중 수요 ${pctTxt(N.tourDemand)} · 입장 수입 ${pctTxt(N.tourTicket)} · 팬 만족 ${N.tourSat}` },
          { label: '거절한다', desc: '변화 없음' },
        ],
      }),
    resolve: (c, i) => {
      if (i !== 0) return '도민의 야구장으로 남기로 했습니다';
      sat(c, N.tourSat);
      addBuff(c, { kind: 'demand', value: N.tourDemand, until: 9999, left: BUFF_LONG, label: `관광객 패키지 수요 ${pctTxt(N.tourDemand)}` });
      addBuff(c, { kind: 'ticket', value: N.tourTicket, until: 9999, left: BUFF_LONG, label: `패키지 할인 입장 수입 ${pctTxt(N.tourTicket)}` });
      return '관광버스가 주차장을 채우기 시작했습니다';
    },
  },
  {
    id: 'tour',
    prio: 30,
    when: (c) => c.day >= 60 && !!retiree(c),
    make: (c) => {
      const p = retiree(c);
      if (!p) return null;
      const fr = isFranchise(p, c.season);
      const cost = money(c, N.retireCost);
      // 고정 출전의 값: 그가 밀어낼 주전과의 OVR 차 (이미 주전이면 손해 없음)
      const t = userTeam(c);
      const cur = t.lineup.some((s) => s.pid === p.id) || t.rotation.includes(p.id) || p.kind !== 'B' ? null : t.lineup.find((s) => s.pos === p.pos) ?? t.lineup.find((s) => s.pos === 'DH');
      const out = cur ? t.roster.find((x) => x.id === cur.pid) : undefined;
      const loss = out ? `${out.name}(OVR ${out.ovr}) 대신 출전 — OVR ${sgn(p.ovr - out.ovr)}` : '전력 손해 없음';
      return card('tour', 'tour', {
        title: '은퇴 투어',
        icon: '🎖️',
        pid: p.id,
        body: `${p.name}(${p.age}세, OVR ${p.ovr})이 올해를 끝으로 유니폼을 벗겠다고 합니다.`,
        choices: [
          { label: '기념 경기', desc: `행사 비용 ${fmtMoney(cost)} · ${BUFF_GAMES} 홈경기 관중 수요 ${pctTxt(N.retireDemand)} · 그동안 ${p.name} 고정 출전(${loss}) · 시즌 뒤 은퇴${fr ? ' (영구결번)' : ''}`, disabled: cashGate(c, cost) },
          { label: '조용히', desc: `비용 없음 · 팬 만족 ${N.quietSat} · 시즌 뒤 은퇴${fr ? ' (영구결번)' : ''}` },
          ...(p.age <= N.retireAge
            ? [{ label: '한 해 더', desc: `잔류 보너스 ${fmtMoney(Math.round(p.salary * N.stayBonus))} · 팬 만족 +${N.staySat} · 은퇴하지 않음 (내년 ${p.age + 1}세, 능력치는 더 내려갑니다)`, disabled: cashGate(c, Math.round(p.salary * N.stayBonus)) }]
            : []),
        ],
      });
    },
    resolve: (c, i, cd) => {
      const p = findUser(c, cd.pid);
      if (!p) return '조용히 시즌을 이어갑니다';
      if (i === 2) {
        spend(c, Math.round(p.salary * N.stayBonus));
        sat(c, N.staySat);
        return `${p.name}이(가) 한 해 더 뛰기로 했습니다`;
      }
      memoSet(c, 'retire', p.id);
      if (i === 0) {
        spend(c, money(c, N.retireCost));
        addBuff(c, { kind: 'demand', value: N.retireDemand, until: 9999, left: BUFF_GAMES, label: `${p.name} 은퇴 투어`, pid: p.id });
        return `${p.name} 은퇴 투어 시작 — 마지막을 보러 팬들이 모입니다`;
      }
      sat(c, N.quietSat);
      return `${p.name}은(는) 인사 없이 마지막 시즌을 보냅니다`;
    },
  },
  {
    id: 'raise',
    prio: 25,
    when: (c) => c.day >= 30 && !!titleRace(c),
    make: (c) => {
      const p = titleRace(c);
      if (!p) return null;
      return card('raise', 'raise', {
        title: '간판의 연봉 요구',
        icon: '💼',
        pid: p.id,
        body: `타이틀 경쟁 중인 ${p.name}의 에이전트가 연봉 ${Math.round(N.raiseRate * 100)}% 인상을 요구합니다.`,
        choices: [
          { label: '인상', desc: `연봉 ${fmtMoney(p.salary)} → ${fmtMoney(Math.round(p.salary * (1 + N.raiseRate)))}` },
          { label: '거절', desc: `스타성 ${N.refuseStar} · 능력치 ${N.refuseAbil} · 팬 ${N.refuseFans}` },
        ],
      });
    },
    resolve: (c, i, cd, rng) => {
      const p = findUser(c, cd.pid);
      if (!p) return '협상이 흐지부지되었습니다';
      if (i === 0) {
        p.salary = Math.round(p.salary * (1 + N.raiseRate));
        hintMut(c, 'finance');
        return `${p.name} 연봉 인상 합의 — ${fmtMoney(p.salary)}`;
      }
      p.star = clamp(p.star + N.refuseStar, 0, 100);
      bump(p, rng, N.refuseAbil, 1);
      c.fans = Math.max(1000, c.fans + N.refuseFans);
      return `${p.name} 인상 거절 — 불만이 쌓입니다`;
    },
  },
];

const baseId = (id: string) => id.split('|')[0];
const DEF = new Map(CARDS.map((d) => [d.id, d]));
const BY_PRIO = CARDS.slice().sort((a, b) => b.prio - a.prio);

/** 매 경기 후: 조건이 맞는 카드 중 우선순위가 가장 높은 1장을 campaign.event 에 둔다. 해당 없으면 원본 반환. */
export function maybeDrawEvent(core0: Core, rng: Rng): Core {
  if (core0.phase !== 'season' || core0.campaign.event || core0.day >= core0.schedule.length) return core0;
  const seen = new Set(seenCards(core0));
  const normalSeen = [...seen].filter((id) => !DEF.get(id)?.forced).length;
  const normalOk = core0.day - memoNum(core0, 'evDay', -99) >= EVENT_GAP && normalSeen < EVENT_MAX;
  for (const d of BY_PRIO) {
    if (seen.has(d.id) || (!d.forced && !normalOk) || !d.when(core0)) continue;
    const core = structuredClone(core0);
    const cd = d.make(core, rng);
    if (!cd) continue;
    core.campaign.event = cd;
    core.campaign.eventsSeen.push(d.id);
    memoSet(core, 'evDay', core.day);
    const who = cd.who && cd.who !== 'player' ? `${CHARACTERS[cd.who].name} ${CHARACTERS[cd.who].title} — ` : '';
    addNews(core, `${cd.icon} ${who}${cd.title}`, 'info');
    return core;
  }
  return core0;
}

export function resolveEvent(core0: Core, choiceIdx: number, rng: Rng): { core: Core; error?: string; result: string } {
  const card0 = core0.campaign.event;
  if (!card0) return { core: core0, error: '처리할 이벤트가 없습니다', result: '' };
  const ch = card0.choices[choiceIdx];
  if (!ch) return { core: core0, error: '잘못된 선택입니다', result: '' };
  if (ch.disabled) return { core: core0, error: ch.disabled, result: '' };
  const def = DEF.get(baseId(card0.id));
  const core = structuredClone(core0);
  const cd = core.campaign.event!;
  core.campaign.event = null;
  const result = def ? def.resolve(core, choiceIdx, cd, rng) : '이벤트가 지나갔습니다';
  core.fans = Math.max(1000, Math.round(core.fans));
  addNews(core, `${cd.icon} ${cd.title}: ${result}`, 'info');
  return { core, result };
}

/** 표시용: 이벤트 카드 종류 수 */
/** 굿즈 콜라보: 연승이 끊기면 남은 기간 효과가 절반이 된다 (mutate, 매 경기 후) */
export function cutGoodsMut(core: Core): void {
  if (userTeam(core).rec.streak > 0) return;
  for (const b of core.campaign.buffs) {
    if (b.kind !== 'merch' || b.pid !== 'streak') continue;
    b.value = goodsCut(b.value);
    b.label = `굿즈 콜라보 ×${b.value} (연승 끝)`;
    delete b.pid;
  }
}

export const EVENT_POOL_SIZE = CARDS.length;
