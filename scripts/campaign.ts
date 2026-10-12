// 캠페인 난이도 봇 검증 (docs/LEVEL_DESIGN.md 7절). 순수 함수만 사용 — 스토어 미사용.
// 실행: npm run campaign  (인자: 시드 수, 시즌 수 → npx tsx scripts/campaign.ts 12 10)
import type { Core, EventCard, FacilityKind, Player } from '../src/game/types';
import { mulberry32, type Rng } from '../src/game/rng';
import { newCore } from '../src/game/generate';
import { advanceDay, borrow, nextSeason, rankOf, releasePlayer, repay, setTicketPrice, signPlayer, upgradeFacility } from '../src/game/season';
import { LOAN_LIMIT, LOAN_STEP, ROSTER_MAX, payroll, refPrice, signingBonus, upgradeCost, userTeam } from '../src/game/economy';
import { ensureObjectives, STAGES } from '../src/game/campaign';
import { maybeDrawEvent, resolveEvent, FOREIGN_MAX } from '../src/game/events';
import { beginDraft, draftPick, draftSkip, isDraftDone, isUserTurn } from '../src/game/draft';
import { fmtMoney } from '../src/game/format';

const N_SEEDS = Number(process.argv[2]) || 12;
const N_SEASONS = Number(process.argv[3]) || 10;

// ───────── 봇 정의 ─────────

interface Bot {
  name: string;
  preseason(c: Core, rng: Rng): Core;
  midseason(c: Core, rng: Rng): Core;
  event(c: Core, card: EventCard): number;
  beforeDraft(c: Core): Core;
  draft(c: Core): string | null; // pid 또는 패스
}

const ok = (r: { core: Core; error?: string }, c: Core) => (r.error ? c : r.core);
const enabled = (card: EventCard, i: number) => !!card.choices[i] && !card.choices[i].disabled;
const firstEnabled = (card: EventCard, pref: number[]) => pref.find((i) => enabled(card, i)) ?? card.choices.findIndex((x) => !x.disabled);
const SCOUT_V: Record<string, number> = { A: 84, B: 74, C: 65, D: 57 };
const baseId = (card: EventCard) => card.id.split('|')[0];
const foreignN = (c: Core) => userTeam(c).roster.filter((p) => p.foreign).length;

/** 가장 약한 주전 OVR (타선/선발 로테이션) */
function weakest(c: Core, kind: 'B' | 'P'): number {
  const t = userTeam(c);
  const ids = kind === 'B' ? t.lineup.map((s) => s.pid) : t.rotation;
  const ovrs = t.roster.filter((p) => ids.includes(p.id)).map((p) => p.ovr);
  return ovrs.length ? Math.min(...ovrs) : 0;
}

/** 로스터 정리: 시즌 종료 후(위약금 0) 노장·저능력 선수를 target 명까지 방출 */
function trimRoster(c: Core, target: number): Core {
  let core = c;
  for (let g = 0; g < 10 && userTeam(core).roster.length > target; g++) {
    const t = userTeam(core);
    const inUse = new Set([...t.lineup.map((s) => s.pid), ...t.rotation, ...(t.closer ? [t.closer] : [])]);
    const cand = t.roster.filter((p) => !inUse.has(p.id)).sort((a, b) => a.ovr - a.age * 0.5 - (b.ovr - b.age * 0.5))[0];
    if (!cand) break;
    const r = releasePlayer(core, cand.id);
    if (r.error) break;
    core = r.core;
  }
  return core;
}

const passive: Bot = {
  name: 'passive',
  preseason: (c) => c,
  midseason: (c) => c,
  event: (_c, card) => firstEnabled(card, [card.choices.length - 1]),
  beforeDraft: (c) => c,
  draft: () => null,
};

const SENSIBLE_RESERVE = 60000; // 6억 비상금
// 연봉 상한: 기본 30억 + 스테이지 보정 + 여유 현금(15억 초과분)의 절반까지 — 빚은 내지 않는다
const SENSIBLE_PAYROLL = (c: Core) => 300000 + c.campaign.stage * 50000 + Math.max(0, c.finance.cash - 150000) * 0.5;
const SENSIBLE_EVENT: Record<string, number[]> = {
  sponsor: [0], fanday: [0, 1], camp: [0, 1], raise: [1], trade: [1], typhoon: [0, 1], docu: [1], foreign: [1],
  meeting: [0], goods: [0, 1], tour: [0], owner: [0], youth: [0, 1], early: [1], market: [0], rival: [1], dinner: [0, 1], seasontix: [1],
};

function sensibleUpgrades(c0: Core): Core {
  let c = c0;
  for (let g = 0; g < 4; g++) {
    const f = c.facilities;
    const capFull = c.campaign.sellouts >= 8 || (c.attHistory.length > 5 && c.attHistory.slice(-10).every((a) => a >= (c.crowd?.capacity ?? 1) * 0.95));
    const opts: FacilityKind[] = capFull ? ['seats', 'food', 'training'] : ['food', 'training', 'seats'];
    let bought = false;
    const sorted = opts
      .map((k) => ({ k, cost: upgradeCost(k, f) }))
      .filter((o): o is { k: FacilityKind; cost: number } => o.cost !== null)
      .sort((a, b) => (capFull && a.k === 'seats' ? -1 : capFull && b.k === 'seats' ? 1 : a.cost - b.cost));
    for (const o of sorted) {
      if (c.finance.cash - o.cost < SENSIBLE_RESERVE) continue;
      const r = upgradeFacility(c, o.k);
      if (!r.error) {
        c = r.core;
        bought = true;
        break;
      }
    }
    if (!bought) break;
  }
  return c;
}

function sensibleSign(c0: Core): Core {
  let c = c0;
  for (let n = 0; n < 2; n++) {
    if (userTeam(c).roster.length >= ROSTER_MAX) c = trimRoster(c, ROSTER_MAX - 1);
    const pay = payroll(userTeam(c));
    const cand = c.freeAgents
      .filter((p) => !p.foreign || foreignN(c) < FOREIGN_MAX)
      .filter((p) => p.ovr >= weakest(c, p.kind) + 5)
      .filter((p) => pay + p.salary <= SENSIBLE_PAYROLL(c) && c.finance.cash - signingBonus(p) >= SENSIBLE_RESERVE)
      .sort((a, b) => b.ovr - weakest(c, b.kind) - (a.ovr - weakest(c, a.kind)));
    if (!cand.length) break;
    const r = signPlayer(c, cand[0].id);
    if (r.error) break;
    c = r.core;
  }
  return c;
}

const sensible: Bot = {
  name: 'sensible',
  preseason: (c0) => {
    let c = setTicketPrice(c0, refPrice(c0.facilities));
    while (c.finance.debt > 0 && c.finance.cash > SENSIBLE_RESERVE * 3) c = ok(repay(c), c);
    c = sensibleUpgrades(c);
    c = sensibleSign(c);
    return c;
  },
  midseason: (c0) => {
    let c = setTicketPrice(c0, refPrice(c0.facilities));
    c = sensibleUpgrades(c);
    c = sensibleSign(c);
    return c;
  },
  event: (_c, card) => firstEnabled(card, SENSIBLE_EVENT[baseId(card)] ?? [card.choices.length - 1]),
  beforeDraft: (c) => trimRoster(c, 25),
  draft: (c) => bestProspect(c, (p) => SCOUT_V[p.scout ?? 'C'] * 0.6 + p.ovr * 0.4),
};

function bestProspect(c: Core, score: (p: Player) => number): string | null {
  if (!c.draft || userTeam(c).roster.length >= ROSTER_MAX) return null;
  const p = c.draft.pool.slice().sort((a, b) => score(b) - score(a))[0];
  return p ? p.id : null;
}

function greedySign(c0: Core): Core {
  let c = c0;
  for (let n = 0; n < 3; n++) {
    if (userTeam(c).roster.length >= ROSTER_MAX) c = trimRoster(c, ROSTER_MAX - 1);
    const star = c.freeAgents.filter((p) => !p.foreign || foreignN(c) < FOREIGN_MAX).sort((a, b) => b.star - a.star || b.ovr - a.ovr)[0];
    if (!star || star.star < 60) break;
    while (c.finance.cash < signingBonus(star) && c.finance.debt + LOAN_STEP <= LOAN_LIMIT) c = ok(borrow(c), c);
    const r = signPlayer(c, star.id);
    if (r.error) break;
    c = r.core;
  }
  return c;
}

const greedy: Bot = {
  name: 'greedy',
  preseason: (c0) => {
    let c = setTicketPrice(c0, refPrice(c0.facilities) * 1.1);
    c = greedySign(c);
    const cost = upgradeCost('seats', c.facilities);
    if (cost !== null) {
      while (c.finance.cash < cost && c.finance.debt + LOAN_STEP <= LOAN_LIMIT) c = ok(borrow(c), c);
      c = ok(upgradeFacility(c, 'seats'), c);
    }
    return c;
  },
  midseason: (c) => greedySign(c),
  event: (_c, card) => firstEnabled(card, [0]),
  beforeDraft: (c) => trimRoster(c, 25),
  draft: (c) => bestProspect(c, (p) => p.ovr),
};

const BOTS = [passive, sensible, greedy];

// ───────── 실행 ─────────

interface SeasonSnap {
  rank: number;
  cash: number;
  debt: number;
  fans: number;
  seats: number;
  trust: number;
  stage: number;
  avgAtt: number;
}

interface Run {
  reach: (number | null)[]; // reach[k] = stage k 에 처음 도달한 시즌 (k=1..5), 우승은 별도
  champ: number | null;
  fired: number | null;
  forcedSale: boolean;
  snaps: SeasonSnap[];
  events: number;
  postGames: number;
  drafted: number;
  crash: string | null;
}

function runOne(bot: Bot, seed: number): Run {
  const rng = mulberry32(seed * 7919 + 101);
  const run: Run = { reach: [null, null, null, null, null, null], champ: null, fired: null, forcedSale: false, snaps: [], events: 0, postGames: 0, drafted: 0, crash: null };
  let c = ensureObjectives(newCore(seed), rng);
  try {
    for (let s = 1; s <= N_SEASONS; s++) {
      c = bot.preseason(c, rng);
      let midDone = false;
      let guard = 0;
      while (c.phase === 'season' || c.phase === 'post') {
        if (++guard > 400) throw new Error('무한 루프 의심');
        if (c.campaign.event) {
          const card = c.campaign.event;
          const r = resolveEvent(c, bot.event(c, card), rng);
          if (r.error) throw new Error(`이벤트 해소 실패: ${card.id} ${r.error}`);
          c = r.core;
          run.events++;
          continue;
        }
        if (!midDone && c.phase === 'season' && c.day >= 42) {
          c = bot.midseason(c, rng);
          midDone = true;
        }
        const r = advanceDay(c, rng);
        if (r.report.post) run.postGames++;
        if (r.report.notes.some((n) => n.includes('강제 매각'))) run.forcedSale = true;
        c = maybeDrawEvent(r.core, rng);
      }
      const ut = userTeam(c);
      const h = c.campaign.history[c.campaign.history.length - 1];
      run.snaps.push({
        rank: rankOf(c.teams, c.userId),
        cash: c.finance.cash,
        debt: c.finance.debt,
        fans: c.fans,
        seats: c.facilities.seats,
        trust: c.campaign.trust,
        stage: c.campaign.stage,
        avgAtt: h ? h.avgAtt : 0,
      });
      void ut;
      for (let k = 1; k <= 5; k++) if (run.reach[k] === null && c.campaign.stage >= k) run.reach[k] = s;
      if (run.champ === null && c.campaign.titles > 0) run.champ = s;
      if (c.phase === 'over') {
        run.fired = s;
        break;
      }
      if (s === N_SEASONS) break;
      c = bot.beforeDraft(c);
      const d = beginDraft(c, rng);
      if (d.error) throw new Error(`드래프트 시작 실패: ${d.error}`);
      c = d.core;
      for (let g = 0; !isDraftDone(c) && g < 10; g++) {
        if (!isUserTurn(c)) throw new Error('드래프트 진행 멈춤');
        const pid = bot.draft(c);
        const r = pid ? draftPick(c, pid, rng) : draftSkip(c, rng);
        c = r.error ? draftSkip(c, rng).core : r.core;
      }
      run.drafted += c.draft?.mine.length ?? 0;
      c = nextSeason(c, rng);
    }
  } catch (e) {
    run.crash = `seed ${seed}: ${(e as Error).message}\n${(e as Error).stack?.split('\n').slice(1, 4).join('\n')}`;
  }
  return run;
}

const pad = (s: string | number, n: number) => String(s).padStart(n);
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const median = (xs: number[]) => {
  if (!xs.length) return NaN;
  const a = xs.slice().sort((x, y) => x - y);
  return a.length % 2 ? a[(a.length - 1) / 2] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2;
};
const fmtReach = (xs: (number | null)[]) => {
  const got = xs.filter((x): x is number => x !== null);
  if (!got.length) return '      —      ';
  return `${pad(Math.round((got.length / xs.length) * 100), 3)}% 중앙${pad(median(got).toFixed(1), 4)}`;
};

console.log(`\n=== 캠페인 봇 검증: ${N_SEEDS} 시드 × ${N_SEASONS} 시즌 ===`);
console.log(`스테이지: ${STAGES.map((s, i) => `${i}.${s.name}`).join(' → ')}`);
const t0 = Date.now();
const all: Record<string, Run[]> = {};
for (const bot of BOTS) {
  const runs: Run[] = [];
  for (let seed = 1; seed <= N_SEEDS; seed++) runs.push(runOne(bot, seed));
  all[bot.name] = runs;
}

console.log('\n── 스테이지 도달 (도달률 / 도달 시즌 중앙값) · 해임 · 강제 매각 ──');
console.log('봇        | 1.중위권도약  | 2.가을야구    | 3.KS로        | 4.제주의기적  | 5.왕조(우승)  | 해임률 (평균 시즌) | 강제매각 경험 | 크래시');
for (const bot of BOTS) {
  const runs = all[bot.name];
  const fired = runs.filter((r) => r.fired !== null);
  console.log(
    `${bot.name.padEnd(9)} | ${[1, 2, 3, 4, 5].map((k) => fmtReach(runs.map((r) => r.reach[k]))).join(' | ')} | ${pad(Math.round((fired.length / runs.length) * 100), 4)}% (${fired.length ? mean(fired.map((r) => r.fired!)).toFixed(1) : ' — '})      | ${pad(Math.round((runs.filter((r) => r.forcedSale).length / runs.length) * 100), 5)}%        | ${runs.filter((r) => r.crash).length}`,
  );
}

console.log('\n── 시즌별 평균 (생존 런 기준) : 순위 / 현금 / 부채 / 팬 / 관중석Lv / 평균관중 / 신임 / 스테이지 ──');
for (const bot of BOTS) {
  console.log(`[${bot.name}]`);
  console.log(' 시즌 | 생존 | 순위 |   현금   |   부채   |   팬   | 관중석 | 평균관중 | 신임 | 스테이지');
  const runs = all[bot.name];
  for (let s = 0; s < N_SEASONS; s++) {
    const sn = runs.map((r) => r.snaps[s]).filter((x): x is SeasonSnap => !!x);
    if (!sn.length) break;
    console.log(
      ` ${pad(s + 1, 4)} | ${pad(sn.length, 4)} | ${pad(mean(sn.map((x) => x.rank)).toFixed(1), 4)} | ${pad(fmtMoney(mean(sn.map((x) => x.cash))), 8)} | ${pad(fmtMoney(mean(sn.map((x) => x.debt))), 8)} | ${pad(Math.round(mean(sn.map((x) => x.fans))), 6)} | ${pad('Lv' + (mean(sn.map((x) => x.seats)) + 1).toFixed(1), 6)} | ${pad(Math.round(mean(sn.map((x) => x.avgAtt))), 8)} | ${pad(Math.round(mean(sn.map((x) => x.trust))), 4)} | ${mean(sn.map((x) => x.stage)).toFixed(2)}`,
    );
  }
}

console.log('\n── 통과 확인 (런 합계) ──');
for (const bot of BOTS) {
  const runs = all[bot.name];
  console.log(
    `${bot.name.padEnd(9)} 이벤트 ${pad(runs.reduce((a, r) => a + r.events, 0), 4)}장 · 포스트시즌 유저 경기 ${pad(runs.reduce((a, r) => a + r.postGames, 0), 4)} · 드래프트 지명 ${pad(runs.reduce((a, r) => a + r.drafted, 0), 4)}명 · 우승 경험 ${runs.filter((r) => r.champ !== null).length}/${runs.length}`,
  );
}
const crashes = BOTS.flatMap((b) => all[b.name].filter((r) => r.crash).map((r) => `[${b.name}] ${r.crash}`));
if (crashes.length) {
  console.log('\n!! 크래시:');
  for (const x of crashes) console.log(x);
  process.exitCode = 1;
}
console.log(`\n(${((Date.now() - t0) / 1000).toFixed(1)}초)`);
