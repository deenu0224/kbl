// 내년 살림 미리보기(payforecast.ts) 점검: 결산 직후(스토브리그 전) 예측 vs 다음 시즌 실제의 오차.
// 실행: npx tsx scripts/payforecast.ts [시드 수=8] [시즌 수=6] [봇(쉼표, 생략 = 전부)]
//  · 개막 연봉: 다음 시즌 개막일 연봉 총액·1군 연봉 (재산정 식 자체의 오차 — 스토브리그 선택 포함)
//  · 시즌 1군 연봉: 다음 시즌 장부의 1군 연봉 (시즌 중 영입·방출·콜업까지 섞인 값)
//  · 영업손익: 다음 시즌 장부 (가을야구 배당금·계약금·매각 대금을 뺀 값 / 장부 그대로)
import type { Core } from '../src/game/types';
import { mulberry32, type Rng } from '../src/game/rng';
import { newCore } from '../src/game/generate';
import { advanceDay, nextSeason } from '../src/game/season';
import { farmRoster, opProfit, payroll, userTeam } from '../src/game/economy';
import { POST_DIVIDEND, ensureObjectives } from '../src/game/campaign';
import { maybeDrawEvent, resolveEvent } from '../src/game/events';
import { closeBriefing, drawBriefing } from '../src/game/briefing';
import { beginDraft, draftPick, draftSkip, isDraftDone } from '../src/game/draft';
import { drawResign } from '../src/game/contract';
import { drawStoveTrade } from '../src/game/trade';
import { nextSeasonForecast, type PayForecast } from '../src/game/payforecast';
import { BOTS, type Bot } from './bots';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const N_SEEDS = Number(args[0]) || 8;
const N_SEASONS = Number(args[1]) || 6;
const ONLY = args[2] ? args[2].split(',') : null;

interface Pair {
  bot: string;
  season: number;
  f: PayForecast;
  openTotal: number;
  openActive: number;
  ledActive: number;
  profitAdj: number;
  profitRaw: number;
  faKept: number;
  faLeft: number;
  inc: number; // 실제 수입 (배당금 제외)
  upk: number; // 실제 유지·운영 (경쟁균형세 포함)
  int: number;
  sal: number; // 실제 장부 연봉
}

function playSeason(bot: Bot, c0: Core, rng: Rng, acc: { farmSal: number }): Core {
  let c = bot.preseason(c0);
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
      acc.farmSal += farmRoster(userTeam(c)).reduce((s, p) => s + p.salary, 0) / c.schedule.length;
    }
    c = drawBriefing(maybeDrawEvent(advanceDay(c, rng).core, rng));
  }
  return c;
}

function runOne(bot: Bot, seed: number, out: Pair[]): void {
  const rng: Rng = mulberry32(seed * 7919 + 101);
  let c = ensureObjectives(newCore(seed), rng);
  let pending: Omit<Pair, 'ledActive' | 'profitAdj' | 'profitRaw' | 'inc' | 'upk' | 'int' | 'sal'> | null = null;
  for (let s = 1; s <= N_SEASONS + 1; s++) {
    const acc = { farmSal: 0 };
    c = playSeason(bot, c, rng, acc);
    const L = c.finance.ledger;
    if (pending && c.day < c.schedule.length) pending = null; // 시즌 도중에 끝난 캠페인(이전·해임)은 장부가 반쪽이라 뺀다
    if (pending) {
      const div = POST_DIVIDEND[c.post?.userFinish ?? 'none'] ?? 0;
      out.push({ ...pending, ledActive: L.salary - acc.farmSal, profitRaw: opProfit(L), profitAdj: opProfit(L) - div - L.sales + L.signing, inc: L.ticket + (L.awayGate ?? 0) + L.food + L.merch + L.league - div, upk: L.upkeep, int: L.interest, sal: L.salary });
      pending = null;
    }
    if (c.phase === 'over' || s > N_SEASONS) break;
    const f = nextSeasonForecast(c);
    // 스토브리그: FA 자격 재계약 → 정리 → 드래프트 (scripts/economy.ts 와 같다)
    const before = new Set(userTeam(c).roster.map((p) => p.id));
    const faIds = userTeam(c).roster.filter((p) => p.svc !== undefined && c.season + 1 - p.svc + 1 > 6).map((p) => p.id);
    c = drawResign(c);
    while (c.campaign.event) c = resolveEvent(c, bot.event(c, c.campaign.event), rng).core;
    c = drawStoveTrade(c, rng);
    if (c.campaign.event) c = resolveEvent(c, bot.event(c, c.campaign.event), rng).core;
    c = bot.beforeDraft(c);
    const d = beginDraft(c, rng);
    if (d.error) throw new Error(d.error);
    c = d.core;
    for (let g = 0; !isDraftDone(c) && g < 10; g++) {
      const pid = bot.draft(c);
      const r = pid ? draftPick(c, pid, rng) : draftSkip(c, rng);
      c = r.error ? draftSkip(c, rng).core : r.core;
    }
    const ids = new Set(userTeam(c).roster.map((p) => p.id));
    const faLeft = faIds.filter((id) => before.has(id) && !ids.has(id)).length;
    c = nextSeason(c, rng);
    const t = userTeam(c);
    pending = { bot: bot.name, season: s, f, openTotal: payroll(t), openActive: payroll(t) - farmRoster(t).reduce((a, p) => a + p.salary, 0), faKept: faIds.length - faLeft, faLeft };
  }
}

const q = (xs: number[], p: number) => {
  const a = xs.slice().sort((x, y) => x - y);
  return a.length ? a[Math.min(a.length - 1, Math.max(0, Math.round(p * (a.length - 1))))] : NaN;
};
const pct = (v: number) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`;
const eok = (v: number) => `${v >= 0 ? '+' : ''}${(v / 10000).toFixed(1)}`;
const pad = (s: string | number, n: number) => String(s).padStart(n);

const pairs: Pair[] = [];
const t0 = Date.now();
for (const bot of BOTS.filter((b) => !ONLY || ONLY.includes(b.name))) for (let seed = 1; seed <= N_SEEDS; seed++) runOne(bot, seed, pairs);

console.log(`\n=== 내년 살림 미리보기 오차: ${N_SEEDS} 시드 × ${N_SEASONS} 시즌 · ${pairs.length}쌍 (${((Date.now() - t0) / 1000).toFixed(0)}초) ===`);
console.log('오차 = 실제 − 예측. 비율은 실제 대비. 영업손익은 억 단위 차이. [10% · 중앙 · 90%]');
const groups: [string, Pair[]][] = [['전체', pairs], ...[...new Set(pairs.map((p) => p.bot))].map((b) => [b, pairs.filter((p) => p.bot === b)] as [string, Pair[]])];
const rel = (xs: Pair[], a: (p: Pair) => number, f: (p: Pair) => number) => xs.map((p) => (a(p) - f(p)) / Math.max(1, a(p)));
const band = (v: number[], fmt: (x: number) => string) => `${fmt(q(v, 0.1))} ${fmt(q(v, 0.5))} ${fmt(q(v, 0.9))}`;
console.log(['봇'.padEnd(9), pad('n', 4), pad('개막 연봉 총액', 26), pad('개막 1군 연봉', 26), pad('시즌 1군 연봉(장부)', 26), pad('영업손익(일회성 제외)', 22), pad('영업손익(장부)', 22), pad('|오차|≤10% 총액', 14)].join(' '));
for (const [name, xs] of groups) {
  const tot = rel(xs, (p) => p.openTotal, (p) => p.f.next.total);
  console.log([
    name.padEnd(9), pad(xs.length, 4),
    pad(band(tot, pct), 26),
    pad(band(rel(xs, (p) => p.openActive, (p) => p.f.next.active), pct), 26),
    pad(band(rel(xs, (p) => p.ledActive, (p) => p.f.next.active), pct), 26),
    pad(band(xs.map((p) => p.profitAdj - p.f.profit), eok), 22),
    pad(band(xs.map((p) => p.profitRaw - p.f.profit), eok), 22),
    pad(`${Math.round((tot.filter((v) => Math.abs(v) <= 0.1).length / Math.max(1, tot.length)) * 100)}%`, 14),
  ].join(' '));
}
// 시즌별: 예측 증감 vs 실제 증감 (억, 평균)
console.log('\n시즌별 평균 (억): 지금 총액 → 예측 / 실제 개막 · 증감 분해(재평가 · 보유 기간 · 은퇴 · 전역 · 드래프트) · FA 재계약/보냄 · 영업손익 예측 / 실제(일회성 제외)');
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
for (let s = 1; s <= N_SEASONS; s++) {
  const xs = pairs.filter((p) => p.season === s);
  if (!xs.length) continue;
  const m = (f: (p: Pair) => number) => (mean(xs.map(f)) / 10000).toFixed(1);
  console.log(`${s}→${s + 1}  ${m((p) => p.f.now.total)} → ${m((p) => p.f.next.total)} / ${m((p) => p.openTotal)} · ${m((p) => p.f.parts.rate)} · ${m((p) => p.f.parts.svc)} · ${m((p) => p.f.parts.retire)} · ${m((p) => p.f.parts.back)} · ${m((p) => p.f.parts.draft)} · FA ${mean(xs.map((p) => p.faKept)).toFixed(2)}/${mean(xs.map((p) => p.faLeft)).toFixed(2)} · ${m((p) => p.f.profit)} / ${m((p) => p.profitAdj)}`);
}
console.log('\n항목별 평균 (억, 예측 / 실제): 수입 · 연봉(장부) · 유지·운영(경쟁균형세 포함) · 이자');
for (let s = 1; s <= N_SEASONS; s++) {
  const xs = pairs.filter((p) => p.season === s);
  if (!xs.length) continue;
  const m = (f: (p: Pair) => number) => (mean(xs.map(f)) / 10000).toFixed(1);
  console.log(`${s}→${s + 1}  ${m((p) => p.f.income)} / ${m((p) => p.inc)} · ${m((p) => p.f.next.total)} / ${m((p) => p.sal)} · ${m((p) => p.f.upkeep + (p.f.lux?.tax ?? 0))} / ${m((p) => p.upk)} · ${m((p) => p.f.interest)} / ${m((p) => p.int)}`);
}
