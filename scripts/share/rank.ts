// 단장 랭크 경계: 봇 4종 × 다양한 시드로 가상 단장 N명(기본 1,040)을 돌려 시즌 점수(gmscore.ts)의 분포를 재고,
// 시즌 차수별(1·2·3·4·5·6시즌째 이상)과 경력 점수(엔딩 카드)의 랭크 경계를 src/share/rank.json 에 적는다.
// 실행: npm run bench:rank [단장 수] [시즌 수] [프로세스 수]   (TEAMS=8 이면 원년 8구단 표를 같은 파일의 "8" 칸에)
// 경력 표본: 첫 우승 시즌(우승 엔딩 카드), 연고 이전 시즌(연고 이전 카드), 둘 다 없으면 마지막 시즌 시점의 경력 점수.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { NEW_GAME } from '../../src/game/generate';
import { careerScore, gmTotal, RANKS, SEASON_GROUPS } from '../../src/game/gmscore';
import { BOTS, simulate } from './bench';

interface Run {
  g: number[]; // 시즌별 점수
  career: number;
}

/** i번째 가상 단장: 봇은 번갈아, 시드는 큰 소수 간격으로 흩는다 */
const who = (i: number) => ({ bot: BOTS[i % BOTS.length], seed: 1 + ((i * 7919 + 104729) % 999983) });

function runPart(from: number, to: number, seasons: number): Run[] {
  const out: Run[] = [];
  for (let i = from; i < to; i++) {
    const { bot, seed } = who(i);
    let career: number | null = null;
    try {
      const c = simulate(bot, seed, seasons, (c) => {
        const h = c.campaign.history;
        if (career === null && (h[h.length - 1].post === 'champion' || c.phase === 'over')) career = careerScore(h);
      });
      const h = c.campaign.history;
      out.push({ g: h.map((x) => gmTotal(x.gm!)), career: career ?? careerScore(h) ?? 0 });
    } catch (e) {
      console.error(`${bot.name} seed ${seed}: ${(e as Error).message}`);
    }
  }
  return out;
}

/** 목표 누적 비율(위에서부터)에 가장 가까운 경계 점수. 경계는 위에서 아래로 엄격히 줄어든다 */
export function cutsOf(scores: number[]): number[] {
  const xs = [...scores].sort((a, b) => b - a);
  const n = xs.length;
  const vals = [...new Set(xs)]; // 내림차순
  const atLeast = (v: number) => xs.filter((x) => x >= v).length / n;
  const cuts: number[] = [];
  let acc = 0;
  for (const r of RANKS.slice(0, -1)) {
    acc += r.pct / 100;
    const prev = cuts[cuts.length - 1] ?? Infinity;
    let best = vals.find((v) => v < prev) ?? prev - 1;
    for (const v of vals) if (v < prev && Math.abs(atLeast(v) - acc) < Math.abs(atLeast(best) - acc)) best = v;
    cuts.push(best);
  }
  return cuts;
}

/** 경계로 나눈 실제 비율(%) */
export function shares(scores: number[], cuts: number[]): number[] {
  const out = Array(RANKS.length).fill(0);
  for (const s of scores) {
    const i = cuts.findIndex((c) => s >= c);
    out[i < 0 ? RANKS.length - 1 : i]++;
  }
  return out.map((k) => Math.round((k / Math.max(1, scores.length)) * 1000) / 10);
}

async function main() {
  const N = Number(process.argv[2]) || 1040;
  const SEASONS = Number(process.argv[3]) || 12;
  const P = Number(process.argv[4]) || 8;
  const part = process.env.RANK_PART;
  if (part) {
    const [from, to] = part.split('-').map(Number);
    process.stdout.write(JSON.stringify(runPart(from, to, SEASONS)));
    return;
  }
  const t0 = Date.now();
  const self = fileURLToPath(import.meta.url);
  const parts = await Promise.all(
    Array.from({ length: P }, (_, k) => {
      const from = Math.floor((k * N) / P);
      const to = Math.floor(((k + 1) * N) / P);
      return new Promise<Run[]>((ok, no) => {
        const ch = spawn('npx', ['tsx', self, String(N), String(SEASONS), String(P)], { env: { ...process.env, RANK_PART: `${from}-${to}` }, stdio: ['ignore', 'pipe', 'inherit'] });
        let buf = '';
        ch.stdout.on('data', (d) => (buf += d));
        ch.on('error', no);
        ch.on('close', (code) => {
          if (code !== 0) return no(new Error(`조각 ${k}: 종료 코드 ${code}`));
          console.log(`조각 ${k + 1}/${P} 끝 (${Math.round((Date.now() - t0) / 1000)}초)`);
          ok(JSON.parse(buf) as Run[]);
        });
      });
    }),
  );
  const runs = parts.flat();
  const groups: number[][] = Array.from({ length: SEASON_GROUPS }, () => []);
  for (const r of runs) r.g.forEach((s, i) => groups[Math.min(i, SEASON_GROUPS - 1)].push(s));
  const careers = runs.map((r) => r.career);
  const league = {
    season: groups.map((g) => ({ n: g.length, cuts: cutsOf(g) })),
    career: { n: careers.length, cuts: cutsOf(careers) },
  };
  const out = resolve(dirname(self), '../../src/share/rank.json');
  const table = existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : {};
  table[NEW_GAME.teams <= 8 ? '8' : '10'] = league;
  writeFileSync(out, JSON.stringify(table) + '\n');

  console.log(`\n${NEW_GAME.teams}구단 · 가상 단장 ${runs.length}명 × 최대 ${SEASONS}시즌 → ${out}  (${Math.round((Date.now() - t0) / 1000)}초)`);
  console.log(`랭크        ${RANKS.map((r) => r.id.padStart(5)).join('')}`);
  console.log(`목표 %      ${RANKS.map((r) => String(r.pct).padStart(5)).join('')}`);
  const row = (label: string, xs: number[], cuts: number[]) => {
    const sh = shares(xs, cuts);
    const worst = Math.max(...sh.map((v, i) => Math.abs(v - RANKS[i].pct)));
    console.log(`${label.padEnd(11)} ${sh.map((v) => String(v).padStart(5)).join('')}   최대 오차 ${worst.toFixed(1)}%p · 표본 ${xs.length}`);
    console.log(`${''.padEnd(11)} 경계 ${cuts.join(' / ')}`);
  };
  groups.forEach((g, i) => row(`${i + 1}시즌째${i === SEASON_GROUPS - 1 ? '+' : ''}`, g, league.season[i].cuts));
  row('경력', careers, league.career.cuts);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
