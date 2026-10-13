// 도전과제 점검. 실행: npm run achv -- [시드 수] [시즌 수]
// 봇 4종으로 여러 시드를 돌리면서 스토어와 같은 방식(직전/현재 상태 비교)으로 판정 함수를 직접 부르고, 도전과제별 달성률 표를 낸다.
// 목록 검사(총 200개 · 중복 id·제목 0 · 범주·난이도 분포)와 판정 중 예외는 실패로 취급한다.
import type { Core, DayReport } from '../src/game/types';
import { mulberry32 } from '../src/game/rng';
import { newCore } from '../src/game/generate';
import { advanceDay, nextSeason } from '../src/game/season';
import { ensureObjectives } from '../src/game/campaign';
import { maybeDrawEvent, resolveEvent } from '../src/game/events';
import { closeBriefing, drawBriefing } from '../src/game/briefing';
import { beginDraft, draftPick, draftSkip, isDraftDone } from '../src/game/draft';
import { drawResign } from '../src/game/contract';
import { drawStoveTrade } from '../src/game/trade';
import { ACHV_CATS, achvLint, achvProgress, achvStep, emptyAchv, type AchvSave } from '../src/game/achievements';
import { ACHV_LIST, ACHV_TOTAL } from '../src/game/achievementList';
import { BOTS, type Bot } from './bots';

const N_SEEDS = Number(process.argv[2]) || 6;
const N_SEASONS = Number(process.argv[3]) || 12;
const QUIET = process.argv.includes('--quiet');
const bad: string[] = [];
const errSeen = new Set<string>();

/** 한 구단(봇 × 시드)의 진행. save 를 이어받아 돌려준다 (누적 도전과제는 봇별로 여러 구단에 걸쳐 쌓는다) */
function run(bot: Bot, seed: number, save0: AchvSave, hit: Set<string>): AchvSave {
  const rng = mulberry32(seed * 31 + 7);
  let save = save0;
  let prev: Core | null = null;
  const see = (c: Core, reports: DayReport[] = []): void => {
    const r = achvStep(ACHV_LIST, save, prev, c, reports, `s${c.season}`);
    for (const e of r.errors) {
      if (errSeen.has(e.id)) continue;
      errSeen.add(e.id);
      bad.push(`판정 예외 ${e.id}: ${e.error} (${bot.name} seed${seed} s${c.season} d${c.day})`);
    }
    for (const id of r.gained) hit.add(id);
    save = r.save;
    prev = c;
  };
  let c = ensureObjectives(newCore(seed), rng);
  // 새 구단으로 세기 위해 직전 상태(다른 시드)를 한 번 보여 준다
  prev = { ...c, seed: -1 };
  see(c);
  for (let s = 1; s <= N_SEASONS && c.phase !== 'over'; s++) {
    c = bot.preseason(c);
    see(c);
    for (let g = 0; (c.phase === 'season' || c.phase === 'post') && g < 400; g++) {
      if (c.campaign.event) {
        c = resolveEvent(c, bot.event(c, c.campaign.event), rng).core;
        see(c);
        continue;
      }
      if (c.campaign.briefing) {
        c = closeBriefing(c);
        continue;
      }
      if (c.phase === 'season') {
        c = bot.daily(c);
        see(c);
      }
      const r = advanceDay(c, rng);
      c = drawBriefing(maybeDrawEvent(r.core, rng));
      see(c, [r.report]);
    }
    if (c.phase === 'over' || s === N_SEASONS) break;
    c = drawResign(c);
    while (c.campaign.event) {
      c = resolveEvent(c, bot.event(c, c.campaign.event), rng).core;
      see(c);
      if (!c.campaign.event) c = drawResign(c);
    }
    c = drawStoveTrade(c, rng);
    while (c.campaign.event) {
      c = resolveEvent(c, bot.event(c, c.campaign.event), rng).core;
      see(c);
    }
    c = bot.beforeDraft(c);
    see(c);
    c = beginDraft(c, rng).core;
    see(c);
    for (let g = 0; !isDraftDone(c) && g < 10; g++) {
      const pid = bot.draft(c);
      const r = pid ? draftPick(c, pid, rng) : draftSkip(c, rng);
      c = r.error ? draftSkip(c, rng).core : r.core;
      see(c);
    }
    c = nextSeason(c, rng);
    see(c);
  }
  // 진행 막대 함수도 던지지 않는지 본다
  for (const d of ACHV_LIST) if (d.progress && achvProgress(d, c, save.totals) === null) bad.push(`진행 막대 예외 ${d.id}`);
  return save;
}

// ── 목록 검사 ──
for (const m of achvLint(ACHV_LIST)) bad.push(m);
if (ACHV_LIST.length !== ACHV_TOTAL) bad.push(`총 ${ACHV_LIST.length}개 (목표 ${ACHV_TOTAL})`);
const hidden = ACHV_LIST.filter((d) => d.hidden).length;
if (hidden < 20 || hidden > 30) bad.push(`숨김 ${hidden}개 (목표 20~30)`);
for (const d of ACHV_LIST) if (d.desc.length > 60) bad.push(`설명이 길다(${d.desc.length}자): ${d.id}`);

// ── 봇 구동 ──
const rate: Record<string, Record<string, number>> = {}; // id → 봇 → 달성한 구단 수
const career = new Set<string>(); // 여러 구단에 걸친 누적 저장으로 달성한 id
const t0 = Date.now();
for (const bot of BOTS) {
  let carry = emptyAchv();
  for (let seed = 1; seed <= N_SEEDS; seed++) {
    const hit = new Set<string>();
    run(bot, seed, emptyAchv(), hit);
    for (const id of hit) ((rate[id] ??= {})[bot.name] = (rate[id][bot.name] ?? 0) + 1);
    // 같은 시드를 누적 저장으로 한 번 더 (통산 기록용) — 판정은 같고 저장만 이어진다
    const h2 = new Set<string>();
    carry = run(bot, seed + 1000, carry, h2);
    for (const id of h2) career.add(id);
    for (const id of Object.keys(carry.done)) career.add(id);
  }
}

const pctOf = (n: number) => `${Math.round((n / N_SEEDS) * 100)}`.padStart(3) + '%';
console.log(`\n도전과제 점검: 봇 ${BOTS.length}종 × ${N_SEEDS} 시드 × ${N_SEASONS} 시즌 (${((Date.now() - t0) / 1000).toFixed(0)}초) · 누적은 봇별로 ${N_SEEDS}개 구단을 이어서 한 번 더`);
console.log(`목록 ${ACHV_LIST.length}개 · 숨김 ${hidden}개`);
console.log('범주별: ' + ACHV_CATS.map((k) => `${k.name} ${ACHV_LIST.filter((d) => d.cat === k.id).length}`).join(' · '));
console.log('난이도: ' + [1, 2, 3, 4].map((t) => `tier${t} ${ACHV_LIST.filter((d) => d.tier === t).length}`).join(' · '));
const never: string[] = [];
const tierRate: number[][] = [[], [], [], [], []];
if (!QUIET) console.log(`\n${'id'.padEnd(18)}T  ${BOTS.map((b) => b.name.padStart(9)).join('')}   누적  제목 — 조건`);
for (const k of ACHV_CATS) {
  if (!QUIET) console.log(`── ${k.name} ──`);
  for (const d of ACHV_LIST.filter((x) => x.cat === k.id)) {
    const per = BOTS.map((b) => rate[d.id]?.[b.name] ?? 0);
    const any = per.some((n) => n > 0) || career.has(d.id);
    if (!any) never.push(d.id);
    tierRate[d.tier].push(Math.max(...per) / N_SEEDS);
    if (!QUIET) console.log(`${d.id.padEnd(18)}${d.tier}  ${per.map((n) => pctOf(n).padStart(9)).join('')}   ${career.has(d.id) ? ' ○ ' : ' · '}  ${d.hidden ? '🔒' : ''}${d.title} — ${d.desc}`);
  }
}
console.log('\n난이도별 평균 달성률(가장 잘한 봇 기준): ' + [1, 2, 3, 4].map((t) => `tier${t} ${Math.round((tierRate[t].reduce((a, b) => a + b, 0) / Math.max(1, tierRate[t].length)) * 100)}%`).join(' · '));
console.log(`봇이 한 번도 달성하지 못한 것 ${never.length}개:`);
for (const id of never) {
  const d = ACHV_LIST.find((x) => x.id === id)!;
  console.log(`  ${id.padEnd(18)} T${d.tier} ${d.title} — ${d.desc}`);
}
if (bad.length) {
  console.log(`\n!! 문제 ${bad.length}건`);
  for (const b of bad.slice(0, 40)) console.log('  ' + b);
  process.exitCode = 1;
} else console.log('\n목록 검사·판정 예외 0건');
