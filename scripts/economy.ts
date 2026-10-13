// 경제 감사: 봇 4종 × 시드 × 시즌의 수입·지출·연봉 구성·1군/2군·장 체류를 시즌별 평균으로 낸다.
// 실행: npm run economy  (인자: 시드 수, 시즌 수, 봇 이름(쉼표, 생략 = 전부) → npx tsx scripts/economy.ts 24 12 sensible)
// 분리 측정: --off=bench(25세 이하 1군 벤치 ×0.5 끔) · --off=farmbig(2군 타자 성과 확대 끔) · --off=svc(보유 기간 할인 끔)
import type { Core, Ledger, Player } from '../src/game/types';
import { mulberry32, type Rng } from '../src/game/rng';
import { newCore } from '../src/game/generate';
import { TRAIN_MAX_AGE, advanceDay, marketSalary, nextSeason, rankOf } from '../src/game/season';
import { AUDIT, FARM_CAP, activeRoster, farmRoster, farmUpkeep, opProfit, opsCost, payroll, userTeam } from '../src/game/economy';
import { POST_DIVIDEND, STAGES, ensureObjectives } from '../src/game/campaign';
import { maybeDrawEvent, resolveEvent } from '../src/game/events';
import { closeBriefing, drawBriefing } from '../src/game/briefing';
import { beginDraft, draftPick, draftSkip, isDraftDone } from '../src/game/draft';
import { drawResign } from '../src/game/contract';
import { BOTS, type Bot } from './bots';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const N_SEEDS = Number(args[0]) || 24;
const N_SEASONS = Number(args[1]) || 12;
const ONLY = args[2] ? args[2].split(',') : null;
const OFF = (process.argv.find((a) => a.startsWith('--off='))?.slice(6) ?? '').split(',').filter(Boolean);
if (OFF.includes('bench')) AUDIT.benchHalf = false;
if (OFF.includes('farmbig')) AUDIT.farmBatBig = false;
if (OFF.includes('svc')) AUDIT.svc = false;
// --base: 2군 도입 직후(이 감사 이전)의 규칙으로 되돌려 잰다 — 보유 기간 없음 · 불펜도 벤치 취급 · 2군 운영비 4만 · 왕조 실패 −20
const BASE = process.argv.includes('--base');
if (BASE) {
  AUDIT.svc = false;
  AUDIT.penGrow = false;
  AUDIT.farmUpkeep = 4;
  STAGES[5].failTrust = 20;
}

type Origin = 'draft' | 'fa' | 'orig';
const originOf = (p: Player): Origin => (p.id.startsWith('dr') ? 'draft' : p.since === undefined ? 'orig' : 'fa');

interface Snap {
  L: Ledger;
  dividend: number;
  reward: number;
  farmSal: number;
  farmUp: number;
  ops: number;
  comp: Record<Origin, { n: number; sal: number; ovr: number }>;
  active: number;
  farm: number;
  callups: number;
  rot: number; // 2군에서 더는 자라지 못하는 선수 (OVR 상한·나이)
  benchYoung: number; // 1군 벤치의 25세 이하 (성장 ×0.5)
  raiseMarket: number; // 다음 시즌 연봉 재산정 인상분 (능력치·나이·인플레)
  raisePrem: number; // 재계약 프리미엄 인상분
  svcCut: number; // 보유 기간 할인 (음수)
  resign: [number, number]; // FA 재계약 [수락, 보냄]
  stage: number;
  cleared: boolean;
  trust: number;
  cash: number;
  payroll: number;
  profit: number;
  avgAtt: number;
  rank: number;
  post: string;
  seats: number;
  food: number;
  train: number;
  flagGap: number; // 깃발 진행 / 목표
}
interface Run {
  snaps: Snap[];
  over: { season: number; stage: number } | null;
  champ: number | null;
  reach: (number | null)[];
  crash: string | null;
}

function playSeason(bot: Bot, c0: Core, rng: Rng, acc: { farmSal: number; farmUp: number; ops: number; callups: number }): Core {
  let c = bot.preseason(c0);
  let wasFarm = new Set(farmRoster(userTeam(c)).map((p) => p.id));
  for (let guard = 0; (c.phase === 'season' || c.phase === 'post') && guard < 400; guard++) {
    if (c.campaign.event) {
      c = resolveEvent(c, bot.event(c, c.campaign.event), rng).core;
      continue;
    }
    if (c.campaign.briefing) {
      c = closeBriefing(c);
      continue;
    }
    if (c.phase === 'season') {
      c = bot.daily(c);
      const t = userTeam(c);
      const farm = farmRoster(t);
      const now = new Set(farm.map((p) => p.id));
      for (const id of wasFarm) if (!now.has(id) && t.roster.some((p) => p.id === id)) acc.callups++;
      wasFarm = now;
      acc.farmSal += farm.reduce((s, p) => s + p.salary, 0) / c.schedule.length;
      acc.farmUp += farmUpkeep(t);
      acc.ops += opsCost(c);
    }
    c = drawBriefing(maybeDrawEvent(advanceDay(c, rng).core, rng));
  }
  return c;
}

function runOne(bot: Bot, seed: number): Run {
  const rng: Rng = mulberry32(seed * 7919 + 101);
  const run: Run = { snaps: [], over: null, champ: null, reach: [null, null, null, null, null, null], crash: null };
  let c = ensureObjectives(newCore(seed), rng);
  try {
    for (let s = 1; s <= N_SEASONS; s++) {
      const acc = { farmSal: 0, farmUp: 0, ops: 0, callups: 0 };
      c = playSeason(bot, c, rng, acc);
      const h = c.campaign.history[c.campaign.history.length - 1];
      const t = userTeam(c);
      const flag = c.campaign.objectives.find((o) => o.main);
      const comp: Snap['comp'] = { draft: { n: 0, sal: 0, ovr: 0 }, fa: { n: 0, sal: 0, ovr: 0 }, orig: { n: 0, sal: 0, ovr: 0 } };
      for (const p of t.roster) {
        const o = comp[originOf(p)];
        o.n++;
        o.sal += p.salary;
        o.ovr += p.ovr;
      }
      const playing = new Set([...t.lineup.map((x) => x.pid), ...t.rotation, ...t.bullpen, ...(t.closer ? [t.closer] : [])]);
      const snap: Snap = {
        L: { ...c.finance.ledger },
        dividend: POST_DIVIDEND[h.post],
        reward: c.campaign.verdict?.cashReward ?? 0,
        ...acc,
        comp,
        active: activeRoster(t).length,
        farm: farmRoster(t).length,
        rot: farmRoster(t).filter((p) => p.age > TRAIN_MAX_AGE || p.ovr >= p.pot || p.ovr >= FARM_CAP).length,
        benchYoung: activeRoster(t).filter((p) => p.age <= 25 && p.ovr < p.pot && !playing.has(p.id)).length,
        raiseMarket: 0,
        raisePrem: 0,
        svcCut: 0,
        resign: [0, 0],
        stage: h.stage,
        cleared: h.cleared,
        trust: c.campaign.trust,
        cash: c.finance.cash,
        payroll: payroll(t),
        profit: h.profit,
        avgAtt: h.avgAtt,
        rank: rankOf(c.teams, c.userId),
        post: h.post,
        seats: c.facilities.seats,
        food: c.facilities.food,
        train: c.facilities.training,
        flagGap: flag && flag.target ? flag.progress / flag.target : NaN,
      };
      run.snaps.push(snap);
      for (let k = 1; k <= 5; k++) if (run.reach[k] === null && c.campaign.stage >= k) run.reach[k] = s;
      if (run.champ === null && c.campaign.titles > 0) run.champ = s;
      if (c.phase === 'over') {
        run.over = { season: s, stage: h.stage };
        break;
      }
      if (s === N_SEASONS) break;
      // 스토브리그: FA 자격 재계약 → 정리 → 드래프트
      c = drawResign(c);
      while (c.campaign.event) {
        const i = bot.event(c, c.campaign.event);
        snap.resign[i === 0 ? 0 : 1]++;
        c = resolveEvent(c, i, rng).core;
      }
      c = bot.beforeDraft(c);
      const d = beginDraft(c, rng);
      if (d.error) throw new Error(d.error);
      c = d.core;
      for (let g = 0; !isDraftDone(c) && g < 10; g++) {
        const pid = bot.draft(c);
        const r = pid ? draftPick(c, pid, rng) : draftSkip(c, rng);
        c = r.error ? draftSkip(c, rng).core : r.core;
      }
      snap.L = { ...c.finance.ledger }; // 드래프트 계약금까지 포함
      const before = new Map(userTeam(c).roster.map((p) => [p.id, p.salary]));
      c = nextSeason(c, rng);
      for (const p of userTeam(c).roster) {
        const s0 = before.get(p.id);
        if (s0 === undefined || p.rookie) continue;
        const m = marketSalary(p, c.season);
        snap.raiseMarket += m - s0;
        if (p.svc !== undefined) snap.svcCut += p.salary - m;
        else snap.raisePrem += p.salary - m;
      }
    }
  } catch (e) {
    run.crash = `seed ${seed}: ${(e as Error).message}\n${(e as Error).stack?.split('\n').slice(1, 4).join('\n')}`;
  }
  return run;
}

const pad = (s: string | number, n: number) => String(s).padStart(n);
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const eok = (v: number) => (Number.isFinite(v) ? (v / 10000).toFixed(1) : '—'); // 만원 → 억
const row = (cells: (string | number)[], w: number[]) => cells.map((x, i) => pad(x, w[i] ?? 7)).join(' ');

console.log(`\n=== 경제 감사: ${N_SEEDS} 시드 × ${N_SEASONS} 시즌${BASE ? ' · 2군 도입 직후 규칙(--base)' : ''}${OFF.length ? ` · 끔: ${OFF.join(',')}` : ''} (단위: 억, 시즌별 생존 런 평균) ===`);
const t0 = Date.now();
const summary: string[] = [];
let crashed = false;
for (const bot of BOTS) {
  if (ONLY && !ONLY.includes(bot.name)) continue;
  const runs: Run[] = [];
  for (let seed = 1; seed <= N_SEEDS; seed++) runs.push(runOne(bot, seed));
  for (const r of runs) {
    if (!r.crash) continue;
    crashed = true;
    console.log(`!! 크래시 [${bot.name}] ${r.crash}`);
  }
  const at = (s: number) => runs.map((r) => r.snaps[s]).filter((x): x is Snap => !!x);
  const seasons = Array.from({ length: N_SEASONS }, (_, s) => s).filter((s) => at(s).length);
  const m = (s: number, f: (x: Snap) => number) => mean(at(s).map(f));
  console.log(`\n━━━ [${bot.name}] ━━━`);

  console.log('── 수입 / 지출 (억) · 영업손익 = 수입 − 지출(시설 투자·보상 제외) ──');
  const w1 = [4, 4, 6, 6, 6, 6, 6, 6, 2, 7, 7, 7, 7, 7, 6, 6, 7, 2, 7, 7];
  console.log(row(['시즌', '생존', '입장', '매점', '굿즈', '분배', '배당', '보상', '|', '1군연봉', '2군연봉', '2군운영', '시설유지', '운영비', '이자', '계약금', '시설투자', '|', '영업손익', '말현금'], w1));
  for (const s of seasons) {
    console.log(
      row(
        [
          s + 1, at(s).length,
          eok(m(s, (x) => x.L.ticket)), eok(m(s, (x) => x.L.food)), eok(m(s, (x) => x.L.merch)), eok(m(s, (x) => x.L.league - x.dividend)), eok(m(s, (x) => x.dividend)), eok(m(s, (x) => x.reward)), '|',
          eok(m(s, (x) => x.L.salary - x.farmSal)), eok(m(s, (x) => x.farmSal)), eok(m(s, (x) => x.farmUp)), eok(m(s, (x) => x.L.upkeep - x.farmUp - x.ops)), eok(m(s, (x) => x.ops)), eok(m(s, (x) => x.L.interest)), eok(m(s, (x) => x.L.signing)), eok(m(s, (x) => x.L.facility)), '|',
          eok(m(s, (x) => opProfit(x.L))), eok(m(s, (x) => x.cash)),
        ],
        w1,
      ),
    );
  }
  // 비중 (전 시즌 합)
  const allS = runs.flatMap((r) => r.snaps);
  const sum = (f: (x: Snap) => number) => allS.reduce((a, x) => a + f(x), 0);
  const inc: [string, number][] = [['입장', sum((x) => x.L.ticket)], ['매점', sum((x) => x.L.food)], ['굿즈', sum((x) => x.L.merch)], ['분배금', sum((x) => x.L.league - x.dividend)], ['배당', sum((x) => x.dividend)], ['보상', sum((x) => x.reward)]];
  const exp: [string, number][] = [['1군 연봉', sum((x) => x.L.salary - x.farmSal)], ['2군 연봉', sum((x) => x.farmSal)], ['2군 운영비', sum((x) => x.farmUp)], ['시설 유지비', sum((x) => x.L.upkeep - x.farmUp - x.ops)], ['운영비', sum((x) => x.ops)], ['이자', sum((x) => x.L.interest)], ['계약금', sum((x) => x.L.signing)], ['시설 투자', sum((x) => x.L.facility)]];
  const share = (xs: [string, number][]) => {
    const tot = xs.reduce((a, x) => a + x[1], 0) || 1;
    return xs.map(([k, v]) => `${k} ${Math.round((v / tot) * 100)}%`).join(' · ');
  };
  console.log(`  수입 비중: ${share(inc)}`);
  console.log(`  지출 비중: ${share(exp)}`);

  console.log('── 연봉 구성 (시즌 말) · 인원 / 연봉 합(억) / 평균 OVR — 다음 시즌 인상분(억) ──');
  const w2 = [4, 16, 16, 16, 7, 7, 2, 7, 7, 7, 9];
  console.log(row(['시즌', '드래프트 출신', 'FA 영입', '원년 멤버', '총액', '1인평균', '|', '재산정', '프리미엄', '보유할인', '재계약 수락/보냄'], w2));
  for (const s of seasons) {
    const c = (o: Origin) => `${m(s, (x) => x.comp[o].n).toFixed(1)}명 ${eok(m(s, (x) => x.comp[o].sal))} ${(mean(at(s).filter((x) => x.comp[o].n).map((x) => x.comp[o].ovr / x.comp[o].n)) || 0).toFixed(0)}`;
    console.log(
      row([s + 1, c('draft'), c('fa'), c('orig'), eok(m(s, (x) => x.payroll)), eok(m(s, (x) => x.payroll / (x.active + x.farm))), '|', eok(m(s, (x) => x.raiseMarket)), eok(m(s, (x) => x.raisePrem)), eok(m(s, (x) => x.svcCut)), `${m(s, (x) => x.resign[0]).toFixed(1)}/${m(s, (x) => x.resign[1]).toFixed(1)}`], w2),
    );
  }

  console.log('── 1군·2군 / 구장 / 성적 ──');
  const w3 = [4, 5, 5, 8, 8, 9, 6, 6, 6, 6, 8, 5, 5, 5];
  console.log(row(['시즌', '1군', '2군', '콜업누적', '2군정체', '벤치≤25', '관중석', '매점', '훈련', '순위', '평균관중', 'PS%', '지지', '장'], w3));
  const cum: number[] = [];
  for (const s of seasons) {
    cum[s] = (cum[s - 1] ?? 0) + m(s, (x) => x.callups);
    console.log(
      row(
        [s + 1, m(s, (x) => x.active).toFixed(1), m(s, (x) => x.farm).toFixed(1), cum[s].toFixed(1), m(s, (x) => x.rot).toFixed(1), m(s, (x) => x.benchYoung).toFixed(1), 'Lv' + (m(s, (x) => x.seats) + 1).toFixed(1), 'Lv' + (m(s, (x) => x.food) + 1).toFixed(1), 'Lv' + (m(s, (x) => x.train) + 1).toFixed(1), m(s, (x) => x.rank).toFixed(1), Math.round(m(s, (x) => x.avgAtt)), Math.round(m(s, (x) => (x.post !== 'none' ? 100 : 0))), Math.round(m(s, (x) => x.trust)), m(s, (x) => x.stage).toFixed(2)],
        w3,
      ),
    );
  }

  console.log('── 장별 체류 시즌 분포 (통과한 런: 1시즌/2/3/4+ · 평균) · 깃발 실패(횟수 · 평균 달성도) · 연고 이전 ──');
  for (let st = 0; st < 6; st++) {
    const spans = runs.map((r) => ({ n: r.snaps.filter((x) => x.stage === st).length, passed: r.snaps.some((x) => x.stage === st && x.cleared) })).filter((x) => x.n > 0);
    if (!spans.length) continue;
    const passed = spans.filter((x) => x.passed).map((x) => x.n);
    const dist = [1, 2, 3].map((k) => passed.filter((n) => n === k).length).concat(passed.filter((n) => n >= 4).length);
    const fails = allS.filter((x) => x.stage === st && !x.cleared);
    const overs = runs.filter((r) => r.over?.stage === st);
    console.log(
      `  ${st}장: 도달 ${pad(spans.length, 2)}런 · 통과 ${pad(passed.length, 2)}런 [${dist.join('/')}] 평균 ${passed.length ? mean(passed).toFixed(2) : '—'}시즌 · 깃발 실패 ${pad(fails.length, 3)}회 (달성도 ${fails.length ? Math.round(mean(fails.map((x) => x.flagGap).filter(Number.isFinite)) * 100) + '%' : '—'}, 그해 가을야구 ${fails.filter((x) => x.post !== 'none').length}회) · 이전 ${overs.length}런${overs.length ? ` (시즌 ${overs.map((r) => r.over!.season).sort((a, b) => a - b).join(',')})` : ''}`,
    );
  }
  const over = runs.filter((r) => r.over);
  const champ = runs.filter((r) => r.champ !== null).map((r) => r.champ!).sort((a, b) => a - b);
  const spanAll: number[] = [];
  for (let st = 0; st < 5; st++) for (const r of runs) if (r.snaps.some((x) => x.stage === st && x.cleared)) spanAll.push(r.snaps.filter((x) => x.stage === st).length);
  const maxCash = Math.max(...seasons.map((s) => m(s, (x) => x.cash)));
  const late = allS.filter((x) => x.stage >= 4);
  const full = late.filter((x) => x.seats === 4 && x.food === 4 && x.avgAtt >= 20000);
  summary.push(
    `${bot.name.padEnd(9)} 이전 ${Math.round((over.length / runs.length) * 100)}% (평균 시즌 ${over.length ? mean(over.map((r) => r.over!.season)).toFixed(1) : '—'}) · 우승 ${champ.length}/${runs.length} 중앙 시즌 ${champ.length ? champ[Math.floor((champ.length - 1) / 2)] : '—'} · 장당 ${mean(spanAll).toFixed(2)}시즌 · 시즌 말 평균 현금 최대 ${eok(maxCash)}억 · 4~5장 영업손익 평균 ${eok(mean(late.map((x) => opProfit(x.L))))}억 (n=${late.length}, 적자 시즌 ${late.filter((x) => opProfit(x.L) < 0).length}) · 그중 시설 풀업+관중 2만 이상 ${eok(mean(full.map((x) => opProfit(x.L))))}억 (n=${full.length}, 적자 ${full.filter((x) => opProfit(x.L) < 0).length})`,
  );
}
console.log('\n── 요약 (목표: passive 이전 3~4시즌 / sensible 장당 1.3~1.8 · 우승 7~10시즌 · 이전 <15% · 현금 ≤100억 / greedy 이전 30%+) ──');
for (const l of summary) console.log(l);
console.log(`\n(${((Date.now() - t0) / 1000).toFixed(1)}초)`);
if (crashed) process.exitCode = 1;
