// 방출 추천 점검. 실행: npx tsx scripts/releasecheck.ts [시드 수] [시즌 수]
// 봇 4종 × 시드 × 시즌 동안 매 10경기마다 releaseAdvice 를 불러 본다:
// ① 제외 규칙 위반 0 (프랜차이즈·1군 최소 인원·재활·입대·고정 출전·신인) ② 추천 수 분포
// ③ 추천받은 선수를 실제로 방출했을 때 전력 4칸 합의 변화 (크게 떨어지는 추천이 많으면 점수식이 잘못된 것) ④ 예외 0
import type { Core } from '../src/game/types';
import { mulberry32 } from '../src/game/rng';
import { newCore } from '../src/game/generate';
import { advanceDay, nextSeason, releasePlayer } from '../src/game/season';
import { MIN_BATTERS, MIN_PITCHERS, activeRoster, farmMax, farmRoster, userTeam } from '../src/game/economy';
import { ensureObjectives, fixedStarters } from '../src/game/campaign';
import { maybeDrawEvent, resolveEvent } from '../src/game/events';
import { closeBriefing, drawBriefing } from '../src/game/briefing';
import { beginDraft, draftPick, draftSkip, isDraftDone } from '../src/game/draft';
import { drawResign } from '../src/game/contract';
import { isFranchise } from '../src/game/franchise';
import { teamParts } from '../src/game/ratings';
import { releaseAdvice, releaseOutcome, releaseTodo, type Advice } from '../src/game/release';
import { BOTS, type Bot } from './bots';

const N_SEEDS = Number(process.argv[2]) || 6;
const N_SEASONS = Number(process.argv[3]) || 6;
const EVERY = 10;
const BIG_DROP = 3; // 전력 4칸 합이 이만큼 이상 떨어지면 "큰 하락"
const bad: string[] = [];
const dist = [0, 0, 0, 0];
let calls = 0;
let errors = 0;
let recs = 0;
let dropSum = 0;
let bigDrop = 0;
let tradeHint = 0;
let todoN = 0;
let ms = 0;
const whyFirst: Record<string, number> = {};
const samples: string[] = [];
const todoWhen: Record<string, number> = {};

const partSum = (c: Core) => {
  const p = teamParts(userTeam(c));
  return p.bat + p.def + p.rot + p.pen;
};

function violation(c: Core, a: Advice): string | null {
  const p = a.p;
  const t = userTeam(c);
  if (isFranchise(p, c.season)) return '프랜차이즈';
  if (p.injury > 0 || p.il || p.ban) return '부상·재활';
  if (p.armyDue !== undefined || p.away) return '입대';
  if (p.rookie) return '신인';
  if (fixedStarters(c).has(p.id)) return '고정 출전';
  if (!p.farm) {
    const same = activeRoster(t).filter((x) => x.kind === p.kind).length;
    if (same <= (p.kind === 'B' ? MIN_BATTERS : MIN_PITCHERS)) return '1군 최소 인원';
  } else if (farmRoster(t).length < farmMax(c)) return '2군 정원 여유인데 2군 추천';
  return null;
}

function probe(c: Core, where: string): void {
  calls++;
  try {
    const t0 = Date.now();
    const adv = releaseAdvice(c);
    const todo = releaseTodo(c);
    ms += Date.now() - t0;
    if (todo) {
      todoN++;
      todoWhen[todo.when] = (todoWhen[todo.when] ?? 0) + 1;
    }
    dist[adv.length]++;
    if (adv.length > 3) bad.push(`${where}: 추천 ${adv.length}명`);
    const base = partSum(c);
    for (const a of adv) {
      recs++;
      const v = violation(c, a);
      if (v) bad.push(`${where}: ${a.p.name} — ${v}`);
      if (a.trade) tradeHint++;
      const k = a.why[0]?.replace(/[0-9.]+/g, '#').split(' ')[0] ?? '-';
      whyFirst[k] = (whyFirst[k] ?? 0) + 1;
      const r = releasePlayer(c, a.p.id);
      if (r.error) bad.push(`${where}: ${a.p.name} 방출 불가 — ${r.error}`);
      else {
        const d = partSum(r.core) - base;
        dropSum += d;
        if (d <= -BIG_DROP) bigDrop++;
        // 카드의 "방출하면" 줄의 전력 숫자가 실제 실행과 같은가
        const o = releaseOutcome(c, a.p.id);
        const od = o.pv.parts.b.bat + o.pv.parts.b.def + o.pv.parts.b.rot + o.pv.parts.b.pen - base;
        if (od !== d) bad.push(`${where}: ${a.p.name} 미리보기 전력 ${od} ≠ 실제 ${d}`);
        if (samples.length < 12 && Math.random() < 0.05) samples.push(`${a.p.name}(${a.p.age}세 ${a.p.pos} ${a.p.ovr}) 점수 ${a.score}: ${a.why.join(' / ')}${a.trade ? ' → 트레이드 권장' : ''}\n      방출하면: ${o.text}`);
      }
    }
  } catch (e) {
    errors++;
    bad.push(`${where}: 예외 ${(e as Error).stack?.split('\n').slice(0, 3).join(' | ')}`);
  }
}

function run(bot: Bot, seed: number): void {
  const rng = mulberry32(seed * 31 + 7);
  let c = ensureObjectives(newCore(seed), rng);
  for (let s = 1; s <= N_SEASONS && c.phase !== 'over'; s++) {
    c = bot.preseason(c);
    probe(c, `${bot.name} seed${seed} s${c.season} 개막 전`);
    for (let g = 0; (c.phase === 'season' || c.phase === 'post') && g < 400; g++) {
      if (c.campaign.event) {
        c = resolveEvent(c, bot.event(c, c.campaign.event), rng).core;
        continue;
      }
      if (c.campaign.briefing) {
        c = closeBriefing(c);
        continue;
      }
      if (c.phase === 'season') c = bot.daily(c);
      c = drawBriefing(maybeDrawEvent(advanceDay(c, rng).core, rng));
      if (c.phase === 'season' && c.day > 0 && c.day % EVERY === 0) probe(c, `${bot.name} seed${seed} s${c.season} d${c.day}`);
    }
    if (c.phase === 'over' || s === N_SEASONS) break;
    probe(c, `${bot.name} seed${seed} s${c.season} 결산 뒤`);
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
  }
}

for (const bot of BOTS) for (let seed = 1; seed <= N_SEEDS; seed++) run(bot, seed);

console.log(`\n방출 추천 점검: 봇 ${BOTS.length}종 × ${N_SEEDS} 시드 × ${N_SEASONS} 시즌 · 호출 ${calls}회 (평균 ${(ms / calls).toFixed(1)}ms)`);
console.log(`② 추천 수 분포 0/1/2/3명: ${dist.join(' / ')} (${dist.map((v) => `${Math.round((v / calls) * 100)}%`).join(' / ')}) · 추천 ${recs}건 · 트레이드 권장 ${tradeHint}건`);
console.log(`③ 실제 방출 시 전력 4칸 합 변화: 평균 ${(dropSum / Math.max(1, recs)).toFixed(2)} · −${BIG_DROP} 이하 ${bigDrop}건 (${((bigDrop / Math.max(1, recs)) * 100).toFixed(1)}%)`);
console.log(`첫 이유 종류: ${Object.entries(whyFirst).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
console.log(`할 일 "방출 검토" 뜬 횟수: ${todoN}/${calls} · 상황별 ${Object.entries(todoWhen).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
console.log('예시:');
for (const s of samples) console.log('  ' + s);
console.log(`④ 예외 ${errors}건`);
if (bad.length) {
  console.log(`!! ① 위반 ${bad.length}건`);
  for (const b of bad.slice(0, 25)) console.log('  ' + b);
  process.exitCode = 1;
} else console.log('① 위반 0건');
