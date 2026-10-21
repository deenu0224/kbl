// 2군 자동 운영·부상자 명단·2군 사건 불변식 점검. 실행: npx tsx scripts/farmcheck.ts [시드 수] [시즌 수]
// 봇 4종(+ 자동 운영을 끄고 손으로 말소·복귀시키는 sensible)으로 돌리면서 매 경기 후 로스터 정합성(정원·중복·입대 선수 분리·전향 페널티 복구)을 확인하고, 사건 선택지를 번갈아 골라 본다.
import type { Core } from '../src/game/types';
import { mulberry32 } from '../src/game/rng';
import { newCore } from '../src/game/generate';
import { advanceDay, callUp, farmLockLeft, nextSeason, sendDown } from '../src/game/season';
import { FARM_MAX, IL_AUTO, MIN_BATTERS, MIN_PITCHERS, ROSTER_MAX, activeRoster, awaySupport, farmRoster, payroll, rehabRoster, userTeam } from '../src/game/economy';
import { ensureObjectives } from '../src/game/campaign';
import { maybeDrawEvent, resolveEvent } from '../src/game/events';
import { closeBriefing, drawBriefing } from '../src/game/briefing';
import { beginDraft, draftPick, draftSkip, isDraftDone } from '../src/game/draft';
import { drawResign } from '../src/game/contract';
import { farmAutoOn, setFarmAuto, subQueue } from '../src/game/farm';
import { memoGet } from '../src/game/memo';
import { BOTS, type Bot } from './bots';
import { rosterCheck } from './invariants';

const N_SEEDS = Number(process.argv[2]) || 12;
const N_SEASONS = Number(process.argv[3]) || 6;
const STALE = 20; // 다 나은 재활 선수가 이 경기 수 넘게 명단에 남으면 위반 (자동 운영)
const bad: string[] = [];
const seen: Record<string, number[]> = {};
let maxAct = 0;
let maxFarm = 0;
let maxRehab = 0;
let seasons = 0;
let games = 0;
let ilOut = 0;
let ilBack = 0;
let ilDays = 0; // 재활 명단 인원 × 경기 (1군 자리가 비워진 양)
let banInOrder = 0; // 참고: 징계 중인 1군 선수가 편성에 남아 있던 경기 수 (경기마다 벤치가 대신 나선다)
let waitDays = 0; // 복귀 대기(1군 자리 없음) 인원 × 경기
let ready: Record<string, number> = {}; // 다 나은 재활 선수 id → 처음 본 day
let wasIl = new Set<string>();
let curSeed = 0;

function check(c: Core, where: string, strict = true): void {
  const t = userTeam(c);
  maxAct = Math.max(maxAct, activeRoster(t).length);
  maxFarm = Math.max(maxFarm, farmRoster(t).length);
  maxRehab = Math.max(maxRehab, rehabRoster(t).length);
  const r = rosterCheck(c, strict);
  banInOrder += r.ban;
  for (const m of r.msgs) bad.push(`seed${curSeed} s${c.season} d${c.day} ${where}: ${m}`);
}

/** 경기 뒤: 재활 명단의 드나듦을 세고, 다 나은 선수가 명단에 묵는지 본다 */
function track(c: Core): void {
  const t = userTeam(c);
  const now = new Set(rehabRoster(t).map((p) => p.id));
  for (const id of now) if (!wasIl.has(id)) ilOut++;
  for (const id of wasIl) if (!now.has(id) && t.roster.some((p) => p.id === id && !p.farm)) ilBack++;
  wasIl = now;
  ilDays += now.size;
  games++;
  const full = activeRoster(t).length >= ROSTER_MAX;
  for (const p of rehabRoster(t)) {
    if (p.injury > 0 || farmLockLeft(c, p) > 0) {
      delete ready[p.id];
      continue;
    }
    ready[p.id] ??= c.day;
    if (full) waitDays++;
    if (farmAutoOn(c) && c.day - ready[p.id] > STALE) bad.push(`s${c.season} d${c.day}: ${p.name} 다 나았는데 ${c.day - ready[p.id]}경기째 재활 명단`);
  }
  for (const id of Object.keys(ready)) if (!now.has(id)) delete ready[id];
  // 자동 운영: 장기 부상자가 1군에 남아 있으면 이유가 있어야 한다 (올릴 선수가 없어 최소 인원이 깨지는 경우뿐)
  if (farmAutoOn(c) && c.phase === 'season') {
    for (const p of activeRoster(t)) {
      if (p.ban || p.injury < IL_AUTO || subQueue(c).includes(p.id)) continue; // 대체 선택 카드가 대기 중이면 고른 뒤에 옮긴다
      const same = activeRoster(t).filter((x) => x.kind === p.kind).length;
      if (same - 1 >= (p.kind === 'B' ? MIN_BATTERS : MIN_PITCHERS)) bad.push(`seed${curSeed} s${c.season} d${c.day}: ${p.name} 부상 ${p.injury}경기인데 1군에 남음`);
    }
  }
}

/** 자동 운영을 끈 유저: 장기 부상자를 직접 명단에 올리고, 나으면 직접 올린다 */
function manual(c0: Core): Core {
  let c = c0;
  for (const p of activeRoster(userTeam(c)).filter((x) => x.injury >= IL_AUTO)) {
    const r = sendDown(c, p.id);
    if (!r.error) c = r.core;
  }
  for (const p of rehabRoster(userTeam(c)).filter((x) => x.injury === 0)) {
    const r = callUp(c, p.id);
    if (!r.error) c = r.core;
  }
  return c;
}

function run(bot: Bot, seed: number, auto: boolean): void {
  const rng = mulberry32(seed * 31 + 7);
  let c = ensureObjectives(newCore(seed), rng);
  if (!auto) c = setFarmAuto(c, false);
  let turn = seed;
  curSeed = seed;
  ready = {};
  wasIl = new Set();
  for (let s = 1; s <= N_SEASONS && c.phase !== 'over'; s++) {
    seasons++;
    c = bot.preseason(c);
    for (let g = 0; (c.phase === 'season' || c.phase === 'post') && g < 400; g++) {
      if (c.campaign.event) {
        const card = c.campaign.event;
        const id = card.id.split('|')[0];
        let i = bot.event(c, card);
        if (id === 'sub') {
          // 부상 대체 카드: 홀수 시드는 선택지를 돌아가며 골라 모든 경로(벤치·재배치·콜업·감독)를 밟는다
          if (seed % 2 === 1) i = turn++ % card.choices.length;
          const sv = (seen.sub ??= []);
          sv[i] = (sv[i] ?? 0) + 1;
          subCards++;
          if (!card.who || !card.line || card.choices.some((ch) => !ch.desc || !ch.detail)) bad.push(`${card.id}: 인물·대사·상세 누락`);
        }
        if (id.startsWith('f-') && bot.name === 'sensible') {
          // 2군 사건은 두 선택지를 번갈아 고른다
          i = turn++ % 2;
          if (card.choices[i]?.disabled) i = 1 - i;
          (seen[id] ??= [0, 0])[i]++;
          if (!card.who || !card.line || card.choices.some((ch) => !ch.desc)) bad.push(`${id}: 인물·대사·결과 숫자 누락`);
        }
        const r = resolveEvent(c, i, rng);
        if (r.error) bad.push(`${card.id}: ${r.error}`);
        c = r.core;
        check(c, `${bot.name} 사건 ${id}[${i}]`, false);
        continue;
      }
      if (c.campaign.briefing) {
        c = closeBriefing(c);
        continue;
      }
      if (c.phase === 'season') c = bot.daily(c);
      if (!auto && c.phase === 'season') c = manual(c);
      const season = c.phase === 'season';
      c = drawBriefing(maybeDrawEvent(advanceDay(c, rng).core, rng));
      const nb0 = bad.length;
      check(c, `${bot.name} 경기 후`, season && c.phase === 'season');
      if (season) track(c);
      if (process.env.DBG && bad.length > nb0) console.log(bad[bad.length - 1], JSON.stringify(c.news.slice(0, 10).map((n) => n.text), null, 1), memoGet(c, 'b3'));
    }
    if (c.phase === 'over' || s === N_SEASONS) break;
    c = drawResign(c);
    while (c.campaign.event) c = resolveEvent(c, bot.event(c, c.campaign.event), rng).core;
    c = bot.beforeDraft(c);
    c = beginDraft(c, rng).core;
    for (let g = 0; !isDraftDone(c) && g < 10; g++) {
      const pid = bot.draft(c);
      const r = pid ? draftPick(c, pid, rng) : draftSkip(c, rng);
      c = r.error ? draftSkip(c, rng).core : r.core;
    }
    c = nextSeason(c, rng);
    check(c, `${bot.name} 시즌 전환`, false);
    ready = {};
    wasIl = new Set(rehabRoster(userTeam(c)).map((p) => p.id));
  }
}

let subCards = 0;
const ONLY = process.argv[4];
for (const bot of BOTS) if (!ONLY || bot.name === ONLY) for (let seed = 1; seed <= N_SEEDS; seed++) run(bot, seed, true);
const autoStat = { seasons, games, ilOut, ilBack, ilDays, waitDays };
const sens = BOTS.find((b) => b.name === 'sensible')!;
for (let seed = 1; seed <= Math.min(4, N_SEEDS); seed++) run(sens, seed + 100, false);

console.log(`\n2군 불변식 점검: 봇 ${BOTS.length}종 × ${N_SEEDS} 시드 × ${N_SEASONS} 시즌 (+ 자동 운영 끔 ${Math.min(4, N_SEEDS)} 시드) · 1군 최대 ${maxAct}명 · 2군 최대 ${maxFarm}명 · 재활 최대 ${maxRehab}명`);
console.log(`자동 운영 ${autoStat.seasons}시즌: 시즌당 자동 말소 ${(autoStat.ilOut / autoStat.seasons).toFixed(2)}회 · 복귀 ${(autoStat.ilBack / autoStat.seasons).toFixed(2)}회 · 비워 준 1군 자리 ${(autoStat.ilDays / autoStat.seasons).toFixed(1)}명·경기/시즌 · 복귀 대기 ${autoStat.waitDays}명·경기`);
console.log(`자동 운영 끔 ${seasons - autoStat.seasons}시즌: 직접 말소 ${ilOut - autoStat.ilOut}회 · 복귀 ${ilBack - autoStat.ilBack}회`);
console.log(`참고: 징계 중인 1군 선수가 편성 칸에 남아 있던 경기 ${banInOrder} (20경기 미만 징계 — 경기마다 벤치가 대신 출전)`);
console.log(`부상 대체 카드: 시즌당 ${(subCards / seasons).toFixed(2)}장 (선택지별 ${(seen.sub ?? []).map((v) => v ?? 0).join('/')})`);
console.log(`사건별 선택 [첫째, 둘째]: ${Object.entries(seen).map(([k, v]) => `${k} ${v.join('/')}`).join(' · ')}`);
console.log(`원정 응원단 awaySupport: 팬 5천 ${awaySupport({ fans: 5000 })} · 1만 ${awaySupport({ fans: 10000 }).toFixed(3)} · 2만 ${awaySupport({ fans: 20000 }).toFixed(3)} · 3만 ${awaySupport({ fans: 30000 })} · 5만 ${awaySupport({ fans: 50000 })}`);
if (bad.length) {
  console.log(`!! 위반 ${bad.length}건`);
  for (const b of bad.slice(0, 25)) console.log('  ' + b);
  process.exitCode = 1;
} else console.log('위반 0건');
