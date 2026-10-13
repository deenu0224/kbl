// 스캔들 선택지 측정: 약물·승부조작 카드가 뜬 그 상태에서 선택지별로 갈라, 같은 난수로 그 시즌 잔여 경기와 이후 3시즌을 돌린다.
// 실행: npm run scandal  (인자: 종류별 목표 표본 수, 최대 시드 수 → npx tsx scripts/scandal.ts 200 96)
//
// - 상태 수집: sensible · greedy 봇의 12시즌 진행. 표본을 빨리 모으려고 수집 중에만 발생 확률을 1 로 올린다
//   (발생 여부는 구단 상태와 거의 무관하므로 카드가 뜬 상태의 분포는 그대로다. 분기 뒤의 시즌들은 원래 확률로 돈다)
// - 분기: 그 카드 한 장의 선택만 다르고, 이후의 스캔들 카드는 모두 신고·협조(첫 선택지)로 처리한다
// - 출력: 선택지별 평균 ± 표준오차, 그리고 같은 상태끼리 뺀 차이(짝지은 차이)의 평균 ± 표준오차
// - 코어 수만큼 자식 프로세스로 나눠 돌린다 (SHARD=i/n)
import { spawn } from 'node:child_process';
import { cpus } from 'node:os';
import type { Core, EventCard } from '../src/game/types';
import { mulberry32, type Rng } from '../src/game/rng';
import { newCore } from '../src/game/generate';
import { advanceDay, nextSeason } from '../src/game/season';
import { ensureObjectives } from '../src/game/campaign';
import { maybeDrawEvent, resolveEvent } from '../src/game/events';
import { closeBriefing, drawBriefing } from '../src/game/briefing';
import { beginDraft, draftPick, draftSkip, isDraftDone } from '../src/game/draft';
import { drawResign } from '../src/game/contract';
import { drawStoveTrade } from '../src/game/trade';
import { SC } from '../src/game/scandal';
import { fmtMoney } from '../src/game/format';
import { baseId, firstEnabled, greedy, sensible, type Bot } from './bots';

const TARGET = Number(process.argv[2]) || 200;
const MAX_SEEDS = Number(process.argv[3]) || 96;
const N_SEASONS = 12;
const AFTER = 3;
type Kind = 'dope' | 'fix';
const CHOICES: Record<Kind, string[]> = { dope: ['자진 신고', '덮는다', '내보낸다'], fix: ['전면 협조', '믿는다', '연봉 인상'] };
const isScn = (card: EventCard) => baseId(card) === 'dope' || baseId(card) === 'fix';

interface Row {
  w0: number; // 그 시즌 승수
  wAfter: number; // 이후 3시즌 승수 합
  trust: number; // 3시즌 뒤 도민 지지
  cash: number; // 카드 시점 대비 순현금(현금 − 부채) 변화
  exposed: number; // 적발 건수
  over: number; // 연고 이전
}
interface Sample { kind: Kind; bot: string; season: number; rows: (Row | null)[] }

type Pick = (c: Core, card: EventCard) => number;
function playSeason(bot: Bot, c0: Core, rng: Rng, pick: Pick, onCard?: (c: Core, card: EventCard) => void, mid = false): Core {
  let c = mid ? c0 : bot.preseason(c0);
  for (let guard = 0; (c.phase === 'season' || c.phase === 'post') && guard < 400; guard++) {
    if (c.campaign.event) {
      const card = c.campaign.event;
      if (onCard && isScn(card)) onCard(c, card);
      const r = resolveEvent(c, pick(c, card), rng);
      if (r.error) throw new Error(`이벤트 해소 실패: ${card.id} ${r.error}`);
      c = r.core;
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
function offseason(bot: Bot, c0: Core, rng: Rng, pick: Pick): Core {
  let c = drawResign(c0);
  for (let g = 0; g < 40; g++) {
    if (!c.campaign.event) {
      c = drawStoveTrade(c, rng);
      if (!c.campaign.event) break;
    }
    c = resolveEvent(c, pick(c, c.campaign.event!), rng).core;
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

const BASE0 = { base: SC.base, max: SC.max };
const boost = (on: boolean) => {
  SC.base = on ? 1 : BASE0.base;
  SC.max = on ? 1 : BASE0.max;
};
/** 이후의 스캔들 카드는 신고·협조로 통일한다 (이 한 장의 선택만 다르게) */
const reportAll = (bot: Bot): Pick => (c, card) => (isScn(card) ? firstEnabled(card, [0, 2, 1]) : bot.event(c, card));

function fork(bot: Bot, c0: Core, card: EventCard): Sample {
  const kind = baseId(card) as Kind;
  const net0 = c0.finance.cash - c0.finance.debt;
  const x0 = c0.campaign.exposed ?? 0;
  boost(false);
  const rows = [0, 1, 2].map((choice): Row | null => {
    if (card.choices[choice]?.disabled) return null;
    const rng = mulberry32(c0.seed * 15485863 + c0.season * 7919 + c0.day * 131 + 7);
    let first = true;
    const rest = reportAll(bot);
    const pick: Pick = (c, cd) => {
      if (first && isScn(cd)) {
        first = false;
        return choice;
      }
      return rest(c, cd);
    };
    try {
      let c = playSeason(bot, c0, rng, pick, undefined, true);
      const row: Row = { w0: c.campaign.history[c.campaign.history.length - 1].w, wAfter: 0, trust: c.campaign.trust, cash: 0, exposed: 0, over: 0 };
      for (let s = 0; s < AFTER && c.phase === 'ended'; s++) {
        c = playSeason(bot, offseason(bot, c, rng, pick), rng, pick);
        row.wAfter += c.campaign.history[c.campaign.history.length - 1].w;
      }
      row.trust = c.campaign.trust;
      row.cash = c.finance.cash - c.finance.debt - net0;
      row.exposed = (c.campaign.exposed ?? 0) - x0;
      row.over = c.phase === 'over' ? 1 : 0;
      return row;
    } catch {
      return null;
    }
  });
  boost(true);
  return { kind, bot: bot.name, season: c0.season, rows };
}

function collect(shard: number, shards: number): Sample[] {
  const out: Sample[] = [];
  const need = Math.ceil(TARGET / shards);
  const count = (k: Kind) => out.filter((x) => x.kind === k).length;
  boost(true);
  for (let seed = 1 + shard; seed <= MAX_SEEDS && (count('dope') < need || count('fix') < need); seed += shards) {
    for (const bot of [sensible, greedy]) {
      const rng = mulberry32(seed * 7919 + 101);
      let c = ensureObjectives(newCore(seed), rng);
      const onCard = (cc: Core, card: EventCard) => {
        if (count(baseId(card) as Kind) < need) out.push(fork(bot, cc, card));
      };
      try {
        for (let s = 1; s <= N_SEASONS - AFTER; s++) {
          c = playSeason(bot, c, rng, bot.event, onCard);
          if (c.phase !== 'ended') break;
          c = offseason(bot, c, rng, bot.event);
        }
      } catch {
        /* 수집 런의 실패는 건너뛴다 */
      }
    }
  }
  return out;
}

// ───────── 출력 ─────────
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const se = (xs: number[]) => {
  if (xs.length < 2) return NaN;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1) / xs.length);
};
const pm = (xs: number[], d = 1, f: (v: number) => string = (v) => v.toFixed(d)) => `${f(mean(xs))} ± ${f(se(xs))}`;
const money = (v: number) => `${v < 0 ? '−' : ''}${fmtMoney(Math.abs(Math.round(v)))}`;
const COLS: [keyof Row, string, (xs: number[]) => string][] = [
  ['w0', '그 시즌 승수', (xs) => pm(xs, 2)],
  ['wAfter', `이후 ${AFTER}시즌 승수 합`, (xs) => pm(xs, 1)],
  ['trust', `${AFTER}시즌 뒤 지지`, (xs) => pm(xs, 1)],
  ['cash', '누적 순현금', (xs) => pm(xs, 0, money)],
  ['exposed', '적발률', (xs) => `${(mean(xs.map((v) => (v > 0 ? 1 : 0))) * 100).toFixed(0)}%`],
  ['over', '연고 이전', (xs) => `${(mean(xs) * 100).toFixed(0)}%`],
];

function report(all: Sample[]): void {
  for (const kind of ['dope', 'fix'] as const) {
    const ss = all.filter((x) => x.kind === kind);
    console.log(`\n── ${kind === 'dope' ? '약물 「트레이너의 보고」' : '승부조작 「사무국의 전화」'} — 상태 ${ss.length}개 (sensible ${ss.filter((x) => x.bot === 'sensible').length} · greedy ${ss.filter((x) => x.bot === 'greedy').length}, 평균 ${mean(ss.map((x) => x.season)).toFixed(1)}번째 시즌) ──`);
    if (!ss.length) continue;
    for (let i = 0; i < 3; i++) {
      const rows = ss.map((x) => x.rows[i]).filter((r): r is Row => !!r);
      console.log(`  ${CHOICES[kind][i].padEnd(6)} (n=${String(rows.length).padStart(3)}) | ${COLS.map(([k, label, f]) => `${label} ${f(rows.map((r) => r[k]))}`).join(' | ')}`);
    }
    for (const i of [1, 2]) {
      const pairs = ss.filter((x) => x.rows[0] && x.rows[i]).map((x) => [x.rows[0]!, x.rows[i]!] as const);
      const d = (k: keyof Row) => pairs.map(([a, b]) => b[k] - a[k]);
      console.log(
        `  ${CHOICES[kind][i]} − ${CHOICES[kind][0]} (같은 상태 ${pairs.length}쌍): 그 시즌 ${pm(d('w0'), 2)}승 | 이후 ${AFTER}시즌 ${pm(d('wAfter'), 1)}승 | 지지 ${pm(d('trust'), 1)} | 순현금 ${pm(d('cash'), 0, money)} | 적발 ${pm(d('exposed'), 2)}건`,
      );
    }
  }
}

const SHARD = process.env.SHARD;
if (SHARD) {
  const [i, n] = SHARD.split('/').map(Number);
  process.stdout.write(JSON.stringify(collect(i, n)));
} else {
  const n = Math.max(1, Math.min(cpus().length - 1, 10));
  const t0 = Date.now();
  console.log(`\n=== 스캔들 선택지 측정: 종류별 목표 ${TARGET}개 · ${n}개 프로세스 ===`);
  const jobs = Array.from({ length: n }, (_, i) =>
    new Promise<Sample[]>((resolve) => {
      const ch = spawn(process.execPath, [...process.execArgv, ...process.argv.slice(1)], { env: { ...process.env, SHARD: `${i}/${n}` }, stdio: ['ignore', 'pipe', 'inherit'] });
      let buf = '';
      ch.stdout.on('data', (d) => (buf += d));
      ch.on('close', () => {
        try {
          resolve(JSON.parse(buf) as Sample[]);
        } catch {
          resolve([]);
        }
      });
    }),
  );
  void Promise.all(jobs).then((parts) => {
    report(parts.flat());
    console.log(`\n목표 모양: 덮기는 그 시즌 +0.6승 이상, ${AFTER}시즌 누적으로 지지 −4 이하 · 순현금 −5억 이하. 내보내기는 그 중간. (${((Date.now() - t0) / 1000).toFixed(0)}초)`);
  });
}
