// 가상 단장 분포: 봇 4종(passive·sensible·greedy·off-verb)으로 시드 N개 × 15시즌을 돌려 src/share/bench.json 을 만든다.
// 실행: npm run bench  (인자: 시드 수, 시즌 수 → npx tsx scripts/share/bench.ts 60 15). 새 게임과 같은 10구단 리그로 돌고, 표에 구단 수(teams)를 적는다. 원년 8구단 표(src/share/bench8.json)는 TEAMS=8 npm run bench
// 공유 카드의 "상위 n%"(src/share/bench.ts percentile)가 이 표를 읽는다. 순수 함수만 사용 — 스토어 미사용.
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Core } from '../../src/game/types';
import { mulberry32, type Rng } from '../../src/game/rng';
import { NEW_GAME, newCore } from '../../src/game/generate';
import { advanceDay, nextSeason } from '../../src/game/season';
import { ensureObjectives } from '../../src/game/campaign';
import { maybeDrawEvent, resolveEvent } from '../../src/game/events';
import { closeBriefing, drawBriefing } from '../../src/game/briefing';
import { beginDraft, draftPick, draftSkip, isDraftDone } from '../../src/game/draft';
import { drawResign } from '../../src/game/contract';
import { drawStoveTrade } from '../../src/game/trade';
import { BOTS, type Bot } from '../bots';

/** 한 시즌(정규 + 포스트시즌)을 결산까지 */
function playSeason(bot: Bot, c0: Core, rng: Rng): Core {
  let c = bot.preseason(c0);
  for (let guard = 0; c.phase === 'season' || c.phase === 'post'; guard++) {
    if (guard > 600) throw new Error('무한 루프 의심');
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
  }
  return c;
}

/** 시즌 사이: 재계약·트레이드 카드 → 정리 → 드래프트 → 새 시즌 */
function offseason(bot: Bot, c0: Core, rng: Rng): Core {
  let c = drawResign(c0);
  for (let g = 0; g < 40; g++) {
    if (!c.campaign.event) {
      c = drawStoveTrade(c, rng);
      if (!c.campaign.event) break;
    }
    c = resolveEvent(c, bot.event(c, c.campaign.event!), rng).core;
  }
  c = bot.beforeDraft(c);
  const d = beginDraft(c, rng);
  if (d.error) throw new Error(`드래프트 시작 실패: ${d.error}`);
  c = d.core;
  for (let g = 0; !isDraftDone(c) && g < 10; g++) {
    const pid = bot.draft(c);
    const r = pid ? draftPick(c, pid, rng) : draftSkip(c, rng);
    c = r.error ? draftSkip(c, rng).core : r.core;
  }
  return nextSeason(c, rng);
}

/** 봇 한 명의 플레이: 시즌마다 결산이 끝난 Core 를 넘긴다 (연고 이전이면 거기서 끝) */
export function simulate(bot: Bot, seed: number, seasons: number, each?: (c: Core, s: number) => void): Core {
  const rng = mulberry32(seed * 7919 + 101);
  let c = ensureObjectives(newCore(seed), rng);
  for (let s = 1; s <= seasons; s++) {
    c = playSeason(bot, c, rng);
    each?.(c, s);
    if (c.phase === 'over' || s === seasons) break;
    c = offseason(bot, c, rng);
  }
  return c;
}

export { BOTS };

export interface BenchTable {
  n: number; // 표본(가상 단장) 수
  seasons: number;
  champ: number[]; // champ[s-1] = s 시즌째에 첫 우승한 단장 수
  over: number[]; // over[s-1] = s 시즌째에 연고 이전된 단장 수
  /** progress[s-1] = s 시즌 종료 시점의 [도달한 장, 최고 순위, 단장 수] (연고 이전된 단장은 장 -1) */
  progress: [number, number, number][][];
  teams?: number; // 표를 만든 리그의 구단 수
}

interface RunRow {
  bot: string;
  champ: number; // 첫 우승 시즌 (0 = 없음)
  over: number; // 연고 이전 시즌 (0 = 없음)
  rows: { stage: number; best: number }[];
}

/** 봇 한 종류로 시드 1~N 을 돈다 (자식 프로세스 하나의 일) */
function runBot(bot: Bot, nSeeds: number, nSeasons: number): { runs: RunRow[]; crash: number } {
  const runs: RunRow[] = [];
  let crash = 0;
  for (let seed = 1; seed <= nSeeds; seed++) {
    const run: RunRow = { bot: bot.name, champ: 0, over: 0, rows: [] };
    let best = NEW_GAME.teams; // 꼴찌에서 시작
    try {
      simulate(bot, seed, nSeasons, (c, s) => {
        best = Math.min(best, c.campaign.history[c.campaign.history.length - 1].rank);
        if (!run.champ && c.campaign.titles > 0) run.champ = s;
        if (c.phase === 'over') run.over = s;
        run.rows.push({ stage: c.phase === 'over' ? -1 : c.campaign.stage, best });
      });
      runs.push(run);
    } catch (e) {
      crash++;
      console.error(`${bot.name} seed ${seed}: ${(e as Error).message}`);
    }
  }
  return { runs, crash };
}

async function main() {
  const N_SEEDS = Number(process.argv[2]) || 60;
  const N_SEASONS = Number(process.argv[3]) || 15;
  // 자식: 봇 하나만 돌려 결과를 한 줄 JSON 으로 내보낸다
  const part = process.env.BENCH_PART;
  if (part) {
    process.stdout.write(JSON.stringify(runBot(BOTS.find((b) => b.name === part)!, N_SEEDS, N_SEASONS)));
    return;
  }
  // 부모: 봇마다 프로세스를 하나씩 띄워 동시에 돌린다
  const t0 = Date.now();
  const self = fileURLToPath(import.meta.url);
  const parts = await Promise.all(
    BOTS.map(
      (bot) =>
        new Promise<{ runs: RunRow[]; crash: number }>((ok, no) => {
          const ch = spawn('npx', ['tsx', self, String(N_SEEDS), String(N_SEASONS)], { env: { ...process.env, BENCH_PART: bot.name }, stdio: ['ignore', 'pipe', 'inherit'] });
          let buf = '';
          ch.stdout.on('data', (d) => (buf += d));
          ch.on('error', no);
          ch.on('close', (code) => {
            if (code !== 0) return no(new Error(`${bot.name}: 종료 코드 ${code}`));
            const r = JSON.parse(buf) as { runs: RunRow[]; crash: number };
            console.log(`${bot.name.padEnd(9)} ${r.runs.length}명 · 우승 ${r.runs.filter((x) => x.champ).length} · 연고 이전 ${r.runs.filter((x) => x.over).length}  (${Math.round((Date.now() - t0) / 1000)}초)`);
            ok(r);
          });
        }),
    ),
  );
  const runs = parts.flatMap((p) => p.runs);
  const crash = parts.reduce((a, p) => a + p.crash, 0);
  const t: BenchTable = { n: runs.length, seasons: N_SEASONS, teams: NEW_GAME.teams, champ: Array(N_SEASONS).fill(0), over: Array(N_SEASONS).fill(0), progress: [] };
  const prog: Map<string, number>[] = Array.from({ length: N_SEASONS }, () => new Map());
  for (const run of runs) {
    if (run.champ) t.champ[run.champ - 1]++;
    if (run.over) t.over[run.over - 1]++;
    for (let s = 0; s < N_SEASONS; s++) {
      const r = run.rows[s] ?? { stage: -1, best: run.rows[run.rows.length - 1].best }; // 연고 이전 뒤의 시즌
      const k = `${r.stage},${r.best}`;
      prog[s].set(k, (prog[s].get(k) ?? 0) + 1);
    }
  }
  t.progress = prog.map((m) => [...m.entries()].map(([k, n]) => [...k.split(',').map(Number), n] as [number, number, number]).sort((a, b) => b[0] - a[0] || a[1] - b[1]));
  // 10구단(새 게임) 표는 bench.json, 원년 8구단 표(TEAMS=8 npm run bench)는 bench8.json — src/share/bench.ts benchFor 가 기록의 구단 수로 고른다
  const out = resolve(dirname(fileURLToPath(import.meta.url)), `../../src/share/${NEW_GAME.teams <= 8 ? 'bench8' : 'bench'}.json`);
  writeFileSync(out, JSON.stringify(t) + '\n');
  const cum = (xs: number[]) => xs.map(((a) => (x: number) => (a += x))(0));
  console.log(`\n가상 단장 ${t.n}명 × ${N_SEASONS}시즌 (실패 ${crash}) → ${out}`);
  console.log(`첫 우승 시즌  : ${t.champ.join(' ')}`);
  console.log(`  누적 %      : ${cum(t.champ).map((x) => Math.round((x / t.n) * 100)).join(' ')}`);
  console.log(`연고 이전 시즌: ${t.over.join(' ')}`);
  console.log(`  누적 %      : ${cum(t.over).map((x) => Math.round((x / t.n) * 100)).join(' ')}`);
  for (const s of [1, 3, 5, 10, N_SEASONS].filter((x) => x <= N_SEASONS)) console.log(`${s}시즌 뒤 [장,최고순위,수]: ${t.progress[s - 1].map((r) => r.join('/')).join('  ')}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
