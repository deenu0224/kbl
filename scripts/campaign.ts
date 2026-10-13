// 캠페인 봇 검증 (docs/LEVEL_DESIGN.md 11절). 순수 함수만 사용 — 스토어 미사용.
// 실행: npm run campaign  (인자: 시드 수, 시즌 수 → npx tsx scripts/campaign.ts 12 12)
//
// 4봇:
//   passive  — 아무것도 안 한다 (감독에게 맡김)
//   sensible — 그 장(과 지나온 장)의 주제 동사를 상식적으로 쓴다
//   greedy   — 스타 FA 올인 + 대출 한도
//   off-verb — 그 장의 주제 동사만 빼고 다 한다 (주제 동사가 실제 열쇠인지 검증)
// 동사: lineup(타순·편성) · sign(영입) · gate(가격·관중석·매점) · youth(훈련장·지명·젊은 선수 기용) · pitch(투수 운용)
import { DOME_COST } from '../src/game/projects';
import type { Core, EventCard } from '../src/game/types';
import { mulberry32, type Rng } from '../src/game/rng';
import { NEW_GAME, newCore } from '../src/game/generate';
import { postTeamsFor } from '../src/game/league';
import { advanceDay, nextSeason, rankOf } from '../src/game/season';
import { DEBT_MOOD, FA_HEAT, LUX_TAX, LUX_TAX_BIG, luxTax, payroll, userTeam } from '../src/game/economy';
import { ensureObjectives, STAGES } from '../src/game/campaign';
import { maybeDrawEvent, resolveEvent } from '../src/game/events';
import { loanLimit } from '../src/game/economy';
import { closeBriefing, drawBriefing, runOffer } from '../src/game/briefing';
import { beginDraft, draftPick, draftSkip, isDraftDone, isUserTurn } from '../src/game/draft';
import { drawResign } from '../src/game/contract';
import { TRADE_AUDIT, drawStoveTrade, parseOffer, tradePreview } from '../src/game/trade';
import { BOTS, baseId, firstEnabled, offVerb, passive, sensible, type Bot } from './bots';
import { FARM_CARDS, FARM_COACH } from '../src/game/farm';
import { fmtMoney } from '../src/game/format';

const N_SEEDS = Number(process.argv[2]) || 12;
const N_SEASONS = Number(process.argv[3]) || 12;
const AB_REPS = process.argv[4] !== undefined ? Number(process.argv[4]) : 2; // A/B 분기 반복 수 (0 = 끔)
// 원인 측정용 환경 변수: BOTS=greedy (그 봇만 돌리고 요약만 출력) · TRADE=off (트레이드 제안 끔) · TRADE=deny (제안은 오되 봇이 전부 거절)
const ONLY_BOTS = process.env.BOTS ? process.env.BOTS.split(',') : null;
const TRADE_MODE = process.env.TRADE ?? 'on';
if (TRADE_MODE === 'off') TRADE_AUDIT.offers = false;
if (process.env.DOME) DOME_COST.splice(0, 3, ...process.env.DOME.split(',').map((v) => Number(v) * 10000)); // 돔 단계 금액(억)을 바꿔 잰다
if (process.env.LUX === '1') LUX_TAX.on = true; // 경쟁균형세를 켜고 잰다
// 10구단 5단계(빚내는 플레이) 측정용: LUX=0 (경쟁균형세 끔) · LUXK=top,capRate,rate · MOOD=0 (빚더미 여론 끔) · MOODK=at,trust,trustFull,grace
if (process.env.LUX === '0') LUX_TAX_BIG.on = false;
if (process.env.LUXKEEP === '0') LUX_TAX_BIG.keep = false;
if (process.env.LUXK) { const [a, b, d] = process.env.LUXK.split(',').map(Number); Object.assign(LUX_TAX_BIG, { top: a, capRate: b, rate: d }); }
// FA 계약금 누진: FAHEAT=0 (끔) · FAHEAT=1,1.25,1.6,2.2,3 (배율 표) · FAHEATSTEP=1 (표 뒤 한 명당) · FAHEATPAY=0.1 (대안: 연봉에도)
if (process.env.FAHEAT === '0') FA_HEAT.on = false;
else if (process.env.FAHEAT) FA_HEAT.mult = process.env.FAHEAT.split(',').map(Number);
if (process.env.FAHEATSTEP) FA_HEAT.step = Number(process.env.FAHEATSTEP);
if (process.env.FAHEATPAY) FA_HEAT.pay = Number(process.env.FAHEATPAY);
if (process.env.MOOD === '0') Object.assign(DEBT_MOOD, { trust: 0, trustFull: 0 }); // 연속 수는 세되 지지는 깎지 않는다 (기준 측정)
if (process.env.MOODK) { const [a, b, d, e, f] = process.env.MOODK.split(',').map(Number); Object.assign(DEBT_MOOD, { at: a, trust: b, trustFull: d, grace: e ?? 1, full: f ?? DEBT_MOOD.full }); }
const pickOf = (bot: Bot, c: Core, card: EventCard): number => (TRADE_MODE === 'deny' && baseId(card) === 'trade' ? firstEnabled(card, [1]) : bot.event(c, card));


// ───────── 실행 ─────────

interface SeasonSnap {
  limit: number; // 결산 뒤(다음 시즌)의 대출 한도
  over: number; // 한도 초과 결산 연속 수 (0 = 한도 안)
  bail: number;
  rank: number;
  cash: number;
  debt: number;
  fans: number;
  seats: number;
  trust: number;
  stage: number; // 그 시즌에 치른 장
  cleared: boolean;
  avgAtt: number;
  payroll: number;
  profit: number;
  name: string;
  proj: Record<string, number>; // 왕조 프로젝트 상태 (시즌 말)
  // 5단계(빚내는 플레이): 결산 시점의 경쟁균형세·AI 연봉·빚더미 여론
  cap: number;
  tax: number;
  ai: number[]; // AI 구단 연봉 총액 (내림차순)
  heavy: number; // 한도의 80% 이상으로 결산한 연속 수
  moodCut: number; // 빚더미 여론으로 깎인 지지
  ratio: number; // 결산 시점 부채 / 한도 (%). 문턱 아래면 0
  // 6단계(FA 계약금 누진): 그 시즌 묶음(지난 결산 뒤 ~ 이번 결산)의 FA 영입 수 · 계약금 합 · 배율로 더 낸 몫
  faN: number;
  faPaid: number;
  faExtra: number;
}

interface Run {
  reach: (number | null)[]; // reach[k] = 장 k 에 처음 도달한 시즌 (k=1..5)
  champ: number | null;
  over: number | null;
  forcedSale: boolean;
  snaps: SeasonSnap[];
  stars: string[];
  events: number;
  cards: Record<string, number>;
  postGames: number;
  drafted: number;
  retired: number;
  crash: string | null;
  scandal: { dope: number; fix: number; covered: number; exposed: number; ethics: number; fine: number };
  trade: { offers: number; accepts: number; net: number; wins: number; kinds: Record<string, number>; block: number };
  // 2군 자동 운영이 한 일 · 입대/전역
  farm: { up: number; back: number; down: number; cut: number; army: number; armyBack: number };
}
const awayN = (c: Core) => c.campaign.away?.length ?? 0;
/** 뉴스에서 지명 직전 자동 방출을 센다 */
const cutN = (c: Core) => c.news.filter((n) => n.text.startsWith(FARM_COACH) && n.text.includes('지명 자리')).length;

// 주간 브리핑 실측: 시즌당 유저에게 오는 결정 수 (브리핑 제안 + 이벤트 카드)
const BRIEF = { seasons: 0, briefs: 0, offers: 0, byWho: {} as Record<string, { seasons: number; offers: number; cards: number }> };
// 조용한 브리핑 실측: 봇이 제안을 다루는 방식별(전부 넘김 / 전부 실행 / 번갈아) 시즌당 브리핑·제안 수와 번복성 제안 수
// 번복성 제안 = 같은 대상(선수·티켓값)에 대해 방향이 반대인 제안이 6주(36경기) 안에 다시 나온 것
type BriefMode = 'skip' | 'run' | 'half';
let BRIEF_MODE: BriefMode = 'skip';
const QUIET: Record<BriefMode, { seasons: number; briefs: number; offers: number; ran: number; flips: number; min: number; max: number; kinds: Record<string, number> }> = {
  skip: { seasons: 0, briefs: 0, offers: 0, ran: 0, flips: 0, min: 99, max: 0, kinds: {} },
  run: { seasons: 0, briefs: 0, offers: 0, ran: 0, flips: 0, min: 99, max: 0, kinds: {} },
  half: { seasons: 0, briefs: 0, offers: 0, ran: 0, flips: 0, min: 99, max: 0, kinds: {} },
};
const movesOfOffer = (o: { id: string; moves?: { t: string; d: 1 | -1 }[] }) => o.moves ?? (o.id.includes('price:') ? [{ t: 'price', d: (o.id.endsWith('up') ? 1 : -1) as 1 | -1 }] : []);
function quietReport() {
  console.log('\n조용한 브리핑 (목표: 번복 0 · 시즌당 브리핑 6~9회 · 제안 8~14장)');
  for (const [k, label] of [['skip', '전부 넘김'], ['run', '전부 실행'], ['half', '번갈아 실행']] as const) {
    const q = QUIET[k];
    if (!q.seasons) continue;
    const kinds = Object.entries(q.kinds).sort((a, b) => b[1] - a[1]).map(([n, v]) => `${n} ${(v / q.seasons).toFixed(1)}`).join(' · ');
    console.log(`  ${label}: 시즌당 브리핑 ${(q.briefs / q.seasons).toFixed(1)}회(${q.min}~${q.max}) · 제안 ${(q.offers / q.seasons).toFixed(1)}장 · 실행 ${(q.ran / q.seasons).toFixed(1)}장 · 번복성 제안 ${q.flips}건/${q.seasons}시즌 [${kinds}]`);
  }
}
process.on('exit', () => {
  if (!BRIEF.seasons) return;
  quietReport();
  console.log(`\n주간 브리핑(전부 넘김): 시즌당 브리핑 ${(BRIEF.briefs / BRIEF.seasons).toFixed(1)}회 · 제안 ${(BRIEF.offers / BRIEF.seasons).toFixed(1)}장`);
  for (const [k, v] of Object.entries(BRIEF.byWho)) console.log(`  ${k}: 시즌당 제안 ${(v.offers / v.seasons).toFixed(1)}장 + 카드 ${(v.cards / v.seasons).toFixed(1)}장 = 결정 ${((v.offers + v.cards) / v.seasons).toFixed(1)}회 (${v.seasons}시즌)`);
});

/** 트레이드 카드 집계: 제안 수 · 수락 수 · 수락한 트레이드의 가치 손익 */
function tallyTrade(run: Run, c: Core, card: { id: string }, pick: number): void {
  const of = parseOffer(card.id);
  if (!of) return;
  run.trade.offers++;
  run.trade.kinds[of.kind] = (run.trade.kinds[of.kind] ?? 0) + 1;
  if (of.src === 'block') run.trade.block++;
  if (pick !== 0) return;
  const pv = tradePreview(c, of, of.cash);
  run.trade.accepts++;
  run.trade.net += pv.net;
  run.trade.wins += pv.wins;
}
/** 스토브리그의 카드(재계약 → 트레이드 제안 1건)를 봇이 처리한다 */
function stove(bot: Bot, c0: Core, rng: Rng, run?: Run): Core {
  let c = drawResign(c0);
  for (let g = 0; g < 40; g++) {
    if (!c.campaign.event) {
      c = drawStoveTrade(c, rng);
      if (!c.campaign.event) break;
    }
    const card = c.campaign.event!;
    const pick = pickOf(bot, c, card);
    if (run) {
      tallyTrade(run, c, card, pick);
      run.cards[baseId(card)] = (run.cards[baseId(card)] ?? 0) + (baseId(card) === 'trade' ? 1 : 0);
    }
    c = resolveEvent(c, pick, rng).core;
  }
  return c;
}

/** 한 시즌(정규 + 포스트시즌)을 끝까지. 결산이 끝난 Core 를 돌려준다 */
function playSeason(bot: Bot, c0: Core, rng: Rng, run?: Run, mid = false): Core {
  let c = mid ? c0 : bot.preseason(c0);
  let guard = 0;
  const q = QUIET[BRIEF_MODE];
  const offered: { t: string; d: 1 | -1; day: number }[] = [];
  let briefs = 0;
  let turn = 0;
  while (c.phase === 'season' || c.phase === 'post') {
    if (++guard > 400) throw new Error('무한 루프 의심');
    if (c.campaign.event) {
      const card = c.campaign.event;
      const a0 = awayN(c);
      const scn = baseId(card) === 'dope' || baseId(card) === 'fix';
      if (run && scn && bot === sensible && FORK_REPS > 0) forkScandal(c, baseId(card));
      const s0 = c.campaign.secrets?.length ?? 0;
      const pick = pickOf(bot, c, card);
      if (run) tallyTrade(run, c, card, pick);
      const cash0 = c.finance.cash;
      const r = resolveEvent(c, pick, rng);
      if (run && scn && pick === 0) run.scandal.fine += Math.max(0, cash0 - r.core.finance.cash);
      if (run && scn) {
        run.scandal[baseId(card) as 'dope' | 'fix']++;
        run.scandal.covered += Math.max(0, (r.core.campaign.secrets?.length ?? 0) - s0);
      }
      if (r.error) throw new Error(`이벤트 해소 실패: ${card.id} ${r.error}`);
      c = r.core;
      if (run) run.farm.army += Math.max(0, awayN(c) - a0);
      (BRIEF.byWho[bot.name] = BRIEF.byWho[bot.name] ?? { seasons: 0, offers: 0, cards: 0 }).cards++;
      if (run) {
        run.events++;
        run.cards[baseId(card)] = (run.cards[baseId(card)] ?? 0) + 1;
      }
      continue;
    }
    // 주간 브리핑: 봇은 제안을 전부 넘긴다 (브리핑은 로직 수치를 바꾸지 않는다)
    if (c.campaign.briefing) {
      BRIEF.briefs++;
      BRIEF.offers += c.campaign.briefing.offers.length;
      BRIEF.byWho[bot.name] = BRIEF.byWho[bot.name] ?? { seasons: 0, offers: 0, cards: 0 };
      BRIEF.byWho[bot.name].offers += c.campaign.briefing.offers.length;
      briefs++;
      for (const o of c.campaign.briefing.offers) {
        q.offers++;
        q.kinds[o.kind] = (q.kinds[o.kind] ?? 0) + 1;
        for (const x of movesOfOffer(o)) {
          if (offered.some((l) => l.t === x.t && l.d === -x.d && c.day - l.day <= 36)) q.flips++;
          offered.push({ ...x, day: c.day });
        }
        if (BRIEF_MODE === 'run' || (BRIEF_MODE === 'half' && turn++ % 2 === 0)) {
          const r = runOffer(c, o.id);
          if (!r.error) {
            c = r.core;
            q.ran++;
          }
        }
      }
      c = closeBriefing(c);
      continue;
    }
    if (c.phase === 'season') c = bot.daily(c);
    const a1 = awayN(c);
    const r = advanceDay(c, rng);
    if (run) {
      run.farm.army += Math.max(0, awayN(r.core) - a1);
      for (const n of r.report.notes) {
        if (!n.startsWith(FARM_COACH)) continue;
        if (n.includes('2군 복귀')) run.farm.back++;
        else if (n.includes('콜업')) run.farm.up++;
        else if (n.includes('2군행')) run.farm.down++;
      }
    }
    if (run && r.report.post) run.postGames++;
    if (run && r.report.notes.some((n) => n.includes('부채 한도 초과'))) run.forcedSale = true;
    c = drawBriefing(maybeDrawEvent(r.core, rng));
  }
  q.seasons++;
  q.briefs += briefs;
  q.min = Math.min(q.min, briefs);
  q.max = Math.max(q.max, briefs);
  BRIEF.seasons++;
  (BRIEF.byWho[bot.name] = BRIEF.byWho[bot.name] ?? { seasons: 0, offers: 0, cards: 0 }).seasons++;
  return c;
}

/** 시즌 사이: 재계약 → 정리 → 드래프트 → 새 시즌 */
function offseason(bot: Bot, c0: Core, rng: Rng): Core {
  let c = stove(bot, c0, rng);
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

// 스캔들 분기: sensible 이 스캔들 카드를 만난 그 상태에서, 신고(첫 선택지)하는 봇과 덮는(둘째 선택지) 봇으로 갈라
// 그 시즌과 이후 FORK_AFTER 시즌을 따로 돌려 승수와 도민 지지를 비교한다 (같은 난수 시드, FORK_REPS 번)
const FORK_REPS = process.argv[5] !== undefined ? Number(process.argv[5]) : 2;
const FORK_AFTER = 3;
const coverBot: Bot = { ...sensible, event: (c, card) => (baseId(card) === 'dope' || baseId(card) === 'fix' ? firstEnabled(card, [1]) : sensible.event(c, card)) };
interface ForkRow { kind: string; w0: number; trust0: number; wAfter: number; trustEnd: number; exposed: number; over: boolean }
const FORK: { report: ForkRow[]; cover: ForkRow[] } = { report: [], cover: [] };
let FORK_N = 0;
function forkScandal(c0: Core, kind: string): void {
  FORK_N++;
  for (let k = 0; k < FORK_REPS; k++) {
    for (const [key, bot] of [['report', sensible], ['cover', coverBot]] as const) {
      const rng = mulberry32(c0.seed * 15485863 + c0.season * 7919 + c0.day * 131 + k * 17);
      const x0 = c0.campaign.exposed ?? 0;
      try {
        let c = playSeason(bot, c0, rng, undefined, true);
        const h0 = c.campaign.history[c.campaign.history.length - 1];
        const row: ForkRow = { kind, w0: h0.w, trust0: c.campaign.trust, wAfter: 0, trustEnd: c.campaign.trust, exposed: 0, over: c.phase === 'over' };
        for (let s = 0; s < FORK_AFTER && c.phase === 'ended'; s++) {
          c = playSeason(bot, offseason(bot, c, rng), rng);
          row.wAfter += c.campaign.history[c.campaign.history.length - 1].w;
          row.trustEnd = c.campaign.trust;
          row.over = c.phase === 'over';
        }
        row.exposed = (c.campaign.exposed ?? 0) - x0;
        FORK[key].push(row);
      } catch {
        /* 분기 런의 실패는 본 검증에 넣지 않는다 */
      }
    }
  }
}

// A/B 분기: sensible 이 도달한 각 시즌의 출발 상태에서, 그 한 시즌만 sensible / off-verb 로 따로 돌려 깃발 달성을 비교한다
const AB: { stage: number; a: boolean; b: boolean }[] = [];

function runOne(bot: Bot, seed: number): Run {
  const rng: Rng = mulberry32(seed * 7919 + 101);
  const run: Run = { reach: [null, null, null, null, null, null], champ: null, over: null, forcedSale: false, snaps: [], stars: [], events: 0, cards: {}, postGames: 0, drafted: 0, retired: 0, crash: null, scandal: { dope: 0, fix: 0, covered: 0, exposed: 0, ethics: 0, fine: 0 }, trade: { offers: 0, accepts: 0, net: 0, wins: 0, kinds: {}, block: 0 }, farm: { up: 0, back: 0, down: 0, cut: 0, army: 0, armyBack: 0 } };
  let c = ensureObjectives(newCore(seed), rng);
  try {
    for (let s = 1; s <= N_SEASONS; s++) {
      if (bot === sensible) {
        const last = (x: Core) => x.campaign.history[x.campaign.history.length - 1].cleared;
        for (let k = 0; k < AB_REPS; k++) {
          const fa = playSeason(sensible, c, mulberry32(seed * 104729 + s * 977 + k * 31));
          const fb = playSeason(offVerb, c, mulberry32(seed * 104729 + s * 977 + k * 31));
          AB.push({ stage: c.campaign.stage, a: last(fa), b: last(fb) });
        }
      }
      c = playSeason(bot, c, rng, run);
      const h = c.campaign.history[c.campaign.history.length - 1];
      run.snaps.push({
        rank: rankOf(c.teams, c.userId),
        cash: c.finance.cash,
        debt: c.finance.debt,
        fans: c.fans,
        seats: c.facilities.seats,
        trust: c.campaign.trust,
        stage: h.stage,
        cleared: h.cleared,
        avgAtt: h.avgAtt,
        payroll: payroll(userTeam(c)),
        profit: h.profit,
        name: h.name ?? '',
        proj: { ...(c.campaign.projects ?? {}) },
        limit: loanLimit(c),
        over: c.campaign.debtOver ?? 0,
        bail: c.campaign.bailout === c.season || c.campaign.bailout === c.season - 1 ? 1 : 0,
        cap: luxTax(c).cap,
        tax: c.campaign.verdict?.luxTax?.tax ?? 0,
        ai: c.teams.filter((t) => t.id !== c.userId).map(payroll).sort((a, b) => b - a),
        heavy: c.campaign.debtHeavy ?? 0,
        moodCut: -(c.campaign.verdict?.debtMood?.trust ?? 0),
        faN: c.campaign.fa?.season === c.season ? c.campaign.fa.n : 0,
        faPaid: c.campaign.fa?.season === c.season ? c.campaign.fa.paid : 0,
        faExtra: c.campaign.fa?.season === c.season ? c.campaign.fa.extra : 0,
        ratio: c.campaign.verdict?.debtMood ? Math.round((c.campaign.verdict.debtMood.debt / c.campaign.verdict.debtMood.limit) * 100) : c.campaign.verdict?.debtOver ? Math.round((c.campaign.verdict.debtOver.debt / c.campaign.verdict.debtOver.limit) * 100) : 0,
      });
      for (let k = 1; k <= 5; k++) if (run.reach[k] === null && c.campaign.stage >= k) run.reach[k] = s;
      if (run.champ === null && c.campaign.titles > 0) run.champ = s;
      run.stars = c.campaign.achievements.slice();
      run.retired = c.campaign.retired?.length ?? 0;
      run.scandal.exposed = c.campaign.exposed ?? 0;
      run.scandal.ethics = c.campaign.ethics ?? 0;
      if (c.phase === 'over') {
        run.over = s;
        break;
      }
      if (s === N_SEASONS) break;
      c = stove(bot, c, rng, run);
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
      run.farm.cut += cutN(c);
      const a2 = awayN(c);
      c = nextSeason(c, rng);
      run.farm.armyBack += Math.max(0, a2 - awayN(c));
    }
  } catch (e) {
    run.crash = `seed ${seed}: ${(e as Error).message}\n${(e as Error).stack?.split('\n').slice(1, 5).join('\n')}`;
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
const pct = (a: number, b: number) => (b ? `${pad(Math.round((a / b) * 100), 3)}%` : '   —');
const fmtReach = (xs: (number | null)[]) => {
  const got = xs.filter((x): x is number => x !== null);
  if (!got.length) return '        —          ';
  return `${pct(got.length, xs.length)} 중앙${pad(median(got).toFixed(1), 4)} (${Math.min(...got)}~${Math.max(...got)})`.padEnd(19);
};

console.log(`\n=== 캠페인 봇 검증: ${N_SEEDS} 시드 × ${N_SEASONS} 시즌 ===`);
// 제안을 실행하는 유저 흉내: 편성·경영은 손대지 않는 봇(passive)이 브리핑 제안만 실행한다. 3시즌씩, 본 검증 통계와는 섞지 않는다
function quietPass() {
  for (const mode of ['run', 'half'] as const) {
    BRIEF_MODE = mode;
    for (let seed = 1; seed <= N_SEEDS; seed++) {
      const rng: Rng = mulberry32(seed * 6151 + 17);
      let c = ensureObjectives(newCore(seed), rng);
      for (let s = 0; s < 3 && (c.phase === 'season' || c.phase === 'post'); s++) {
        c = playSeason(passive, c, rng);
        if (c.phase !== 'ended') break;
        const d = beginDraft(c, rng);
        if (d.error) break;
        c = d.core;
        let g = 0;
        while (c.phase === 'draft' && !isDraftDone(c) && g++ < 200) c = draftSkip(c, rng).core;
        if (c.phase !== 'draft') break;
        c = nextSeason(c, rng);
      }
    }
  }
  BRIEF_MODE = 'skip';
}
console.log(`장: ${STAGES.map((s, i) => `${i}.${s.name}`).join(' → ')}`);
const t0 = Date.now();
const all: Record<string, Run[]> = {};
for (const bot of BOTS) {
  if (ONLY_BOTS && !ONLY_BOTS.includes(bot.name)) continue;
  const runs: Run[] = [];
  for (let seed = 1; seed <= N_SEEDS; seed++) runs.push(runOne(bot, seed));
  all[bot.name] = runs;
}
if (ONLY_BOTS) {
  console.log(`\n── 원인 측정 (TRADE=${TRADE_MODE}) ──`);
  for (const [name, runs] of Object.entries(all)) {
    const over = runs.filter((r) => r.over !== null);
    const seasons = Math.max(1, runs.reduce((a, r) => a + r.snaps.length, 0));
    const snaps = runs.flatMap((r) => r.snaps);
    const sum = (f: (r: Run) => number) => runs.reduce((a, r) => a + f(r), 0);
    console.log(
      `${name.padEnd(9)} 이전율 ${pct(over.length, runs.length).trim()} (평균 ${over.length ? mean(over.map((r) => r.over!)).toFixed(1) : '—'}시즌) · 우승 ${runs.filter((r) => r.champ !== null).length}/${runs.length} (중앙 ${median(runs.map((r) => r.champ).filter((x): x is number => x !== null)).toFixed(1)}시즌) · 제재금 합계 ${fmtMoney(snaps.reduce((a, x) => a + x.tax, 0))} · 빚더미 지지 −${snaps.reduce((a, x) => a + x.moodCut, 0)} · 평균 순위 ${mean(snaps.map((x) => x.rank)).toFixed(2)} · 시즌 말 현금 ${fmtMoney(mean(snaps.map((x) => x.cash)))} · 부채 ${fmtMoney(mean(snaps.map((x) => x.debt)))} · 연봉 ${fmtMoney(mean(snaps.map((x) => x.payroll)))} · 영업손익 ${fmtMoney(mean(snaps.map((x) => x.profit)))} · 트레이드 제안 ${(sum((r) => r.trade.offers) / seasons).toFixed(2)} 수락 ${(sum((r) => r.trade.accepts) / seasons).toFixed(2)}/시즌 (건당 예상 ${sum((r) => r.trade.accepts) ? (sum((r) => r.trade.wins) / sum((r) => r.trade.accepts)).toFixed(2) : '—'}승, 가치 ${sum((r) => r.trade.accepts) ? fmtMoney(Math.round(sum((r) => r.trade.net) / sum((r) => r.trade.accepts))) : '—'}) · 크래시 ${runs.filter((r) => r.crash).length}`,
    );
  }
  faReport();
  process.exit(0);
}

console.log('\n── 장 도달 시즌 분포 (도달률 · 도달 시즌 중앙값 · 최소~최대) / 우승 / 연고 이전 ──');
console.log('봇        | 1장 도달            | 2장 도달            | 3장 도달            | 4장 도달            | 우승(5장 도달)      | 연고 이전 (평균 시즌) | 한도초과 | 크래시');
for (const bot of BOTS) {
  const runs = all[bot.name];
  const over = runs.filter((r) => r.over !== null);
  console.log(
    `${bot.name.padEnd(9)} | ${[1, 2, 3, 4, 5].map((k) => fmtReach(runs.map((r) => r.reach[k]))).join(' | ')} | ${pct(over.length, runs.length)} (${over.length ? mean(over.map((r) => r.over!)).toFixed(1) : ' — '})          | ${pct(runs.filter((r) => r.forcedSale).length, runs.length)}     | ${runs.filter((r) => r.crash).length}`,
  );
}

console.log('\n── 장별 깃발 달성률 (달성 시즌 / 그 장에서 치른 시즌) · 장당 평균 시즌(통과한 런) ──');
console.log('봇        | ' + STAGES.map((s, i) => `${i}.${s.name}`.padEnd(20)).join(' | '));
const flagRate: Record<string, number[]> = {};
for (const bot of BOTS) {
  const runs = all[bot.name];
  const cells: string[] = [];
  flagRate[bot.name] = [];
  for (let st = 0; st < STAGES.length; st++) {
    const played = runs.flatMap((r) => r.snaps.filter((x) => x.stage === st));
    const cleared = played.filter((x) => x.cleared).length;
    // 장당 시즌: 그 장을 통과한 런에서 그 장에 머문 시즌 수
    const spans = runs.map((r) => ({ n: r.snaps.filter((x) => x.stage === st).length, passed: r.snaps.some((x) => x.stage === st && x.cleared) })).filter((x) => x.passed);
    flagRate[bot.name][st] = played.length ? cleared / played.length : NaN;
    cells.push(`${pct(cleared, played.length)} (${pad(cleared, 2)}/${pad(played.length, 3)}) ${spans.length ? mean(spans.map((x) => x.n)).toFixed(1) + '시즌' : '  —  '}`.padEnd(20));
  }
  console.log(`${bot.name.padEnd(9)} | ${cells.join(' | ')}`);
}
console.log('── A/B 분기 (sensible 이 도달한 시즌의 같은 출발 상태에서 그 한 시즌만 sensible vs off-verb) ──');
console.log(
  STAGES.map((_, st) => {
    const xs = AB.filter((x) => x.stage === st);
    if (!xs.length) return `${st}장 —`;
    const a = xs.filter((x) => x.a).length;
    const b = xs.filter((x) => x.b).length;
    return `${st}장 sensible ${pct(a, xs.length).trim()} / off-verb ${pct(b, xs.length).trim()} (n=${xs.length}, 비 ${a ? (b / a).toFixed(2) : '—'})`;
  }).join(' · ') + '  (목표: 비 ≤ 0.50)',
);
console.log(
  `(참고) 독립 런의 off-verb / sensible 깃발 달성률 비: ${STAGES.map((_, st) => (Number.isFinite(flagRate['off-verb'][st]) && flagRate.sensible[st] > 0 ? `${st}장 ${(flagRate['off-verb'][st] / flagRate.sensible[st]).toFixed(2)}` : `${st}장 —`)).join(' · ')}  (목표 ≤ 0.50)`,
);

console.log('\n── 별 획득 (그 장을 치른 런 기준 평균 개수 · 3개 전부 딴 런 비율) ──');
for (const bot of BOTS) {
  const runs = all[bot.name];
  const cells: string[] = [];
  let tot = 0;
  let n = 0;
  for (let st = 0; st < STAGES.length; st++) {
    const rs = runs.filter((r) => r.snaps.some((x) => x.stage === st));
    const cnt = rs.map((r) => r.stars.filter((a) => a.startsWith(`s${st}-`)).length);
    if (st < 5) {
      tot += cnt.reduce((a, b) => a + b, 0);
      n += rs.length;
    }
    const each = [1, 2, 3].map((k) => rs.filter((r) => r.stars.includes(`s${st}-${k}`)).length);
    cells.push(rs.length ? `${st}장 ${mean(cnt).toFixed(2)}개 [★${each.join('/')}] 올3 ${pct(cnt.filter((x) => x === 3).length, rs.length).trim()}` : `${st}장 —`);
  }
  console.log(`${bot.name.padEnd(9)} | ${cells.join(' | ')} | 장당 평균 ${n ? (tot / n).toFixed(2) : '—'}개`);
}

console.log('\n── 시즌별 평균 (생존 런 기준) ──');
for (const bot of BOTS) {
  console.log(`[${bot.name}]`);
  console.log(' 시즌 | 생존 | 순위 |   현금 (최대)      |   부채   |   팬   | 관중석 | 평균관중 |  연봉총액 | 영업손익 | 지지 | 장');
  const runs = all[bot.name];
  for (let s = 0; s < N_SEASONS; s++) {
    const sn = runs.map((r) => r.snaps[s]).filter((x): x is SeasonSnap => !!x);
    if (!sn.length) break;
    console.log(
      ` ${pad(s + 1, 4)} | ${pad(sn.length, 4)} | ${pad(mean(sn.map((x) => x.rank)).toFixed(1), 4)} | ${pad(fmtMoney(mean(sn.map((x) => x.cash))), 8)} (${pad(fmtMoney(Math.max(...sn.map((x) => x.cash))), 7)}) | ${pad(fmtMoney(mean(sn.map((x) => x.debt))), 8)} | ${pad(Math.round(mean(sn.map((x) => x.fans))), 6)} | ${pad('Lv' + (mean(sn.map((x) => x.seats)) + 1).toFixed(1), 6)} | ${pad(Math.round(mean(sn.map((x) => x.avgAtt))), 8)} | ${pad(fmtMoney(mean(sn.map((x) => x.payroll))), 9)} | ${pad(fmtMoney(mean(sn.map((x) => x.profit))), 8)} | ${pad(Math.round(mean(sn.map((x) => x.trust))), 4)} | ${mean(sn.map((x) => x.stage)).toFixed(2)}`,
    );
  }
}

console.log('\n── 통과 확인 (런 합계) ──');
for (const bot of BOTS) {
  const runs = all[bot.name];
  const cards: Record<string, number> = {};
  for (const r of runs) for (const [k, v] of Object.entries(r.cards)) cards[k] = (cards[k] ?? 0) + v;
  const seasons = runs.reduce((a, r) => a + r.snaps.length, 0);
  console.log(
    `${bot.name.padEnd(9)} 카드 ${pad(runs.reduce((a, r) => a + r.events, 0), 4)}장 (시즌당 ${(runs.reduce((a, r) => a + r.events, 0) / Math.max(1, seasons)).toFixed(1)}) · 포스트시즌 유저 경기 ${pad(runs.reduce((a, r) => a + r.postGames, 0), 4)} · 드래프트 지명 ${pad(runs.reduce((a, r) => a + r.drafted, 0), 4)}명 · 영구결번 ${runs.reduce((a, r) => a + r.retired, 0)} · 우승 경험 ${runs.filter((r) => r.champ !== null).length}/${runs.length}`,
  );
  console.log(`          카드별: ${Object.entries(cards).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
}
console.log('\n── 카드별 시즌당 횟수 ──');
{
  const ids = new Set<string>();
  for (const bot of BOTS) for (const r of all[bot.name]) for (const k of Object.keys(r.cards)) ids.add(k);
  console.log('카드'.padEnd(10) + ' | ' + BOTS.map((b) => b.name.padStart(8)).join(' | '));
  for (const id of [...ids].sort()) {
    const cells = BOTS.map((b) => {
      const runs = all[b.name];
      const seasons = Math.max(1, runs.reduce((a, r) => a + r.snaps.length, 0));
      return (runs.reduce((a, r) => a + (r.cards[id] ?? 0), 0) / seasons).toFixed(2).padStart(8);
    });
    console.log(`${id.padEnd(10)} | ${cells.join(' | ')}`);
  }
}

console.log('\n── 트레이드 (시즌당 · 목표: 제안 1.0~2.0) ──');
for (const bot of BOTS) {
  const runs = all[bot.name];
  const seasons = Math.max(1, runs.reduce((a, r) => a + r.snaps.length, 0));
  const sum = (f: (r: Run) => number) => runs.reduce((a, r) => a + f(r), 0);
  const acc = sum((r) => r.trade.accepts);
  const kinds: Record<string, number> = {};
  for (const r of runs) for (const [k, v] of Object.entries(r.trade.kinds)) kinds[k] = (kinds[k] ?? 0) + v;
  console.log(
    `${bot.name.padEnd(9)} 제안 ${(sum((r) => r.trade.offers) / seasons).toFixed(2)} (내놓은 선수 문의 ${(sum((r) => r.trade.block) / seasons).toFixed(2)}) · 수락 ${(acc / seasons).toFixed(2)} · 수락한 트레이드 평균: 가치 손익 ${acc ? fmtMoney(Math.round(sum((r) => r.trade.net) / acc)) : '—'} · 예상 승수 ${acc ? (sum((r) => r.trade.wins) / acc).toFixed(2) : '—'} [${Object.entries(kinds).map(([k, v]) => `${k} ${(v / seasons).toFixed(2)}`).join(' · ')}]`,
  );
}

console.log('\n── 후반 스캔들 (플레이당 평균 · 목표: 끝까지 간 플레이에서 2~3회) ──');
for (const bot of BOTS) {
  const runs = all[bot.name];
  const m = (f: (r: Run) => number, rs = runs) => (rs.length ? (rs.reduce((a, r) => a + f(r), 0) / rs.length).toFixed(2) : '—');
  const full = runs.filter((r) => r.over === null);
  console.log(
    `${bot.name.padEnd(9)} 발생 ${m((r) => r.scandal.dope + r.scandal.fix)}회 (약물 ${m((r) => r.scandal.dope)} · 승부조작 ${m((r) => r.scandal.fix)}) · 덮은 일 ${m((r) => r.scandal.covered)}건 · 적발 ${m((r) => r.scandal.exposed)}건 · 윤리 교육 ${m((r) => r.scandal.ethics)}단계 · 신고 제재금 ${fmtMoney(Math.round(Number(m((r) => r.scandal.fine))))} | 끝까지 간 ${full.length}런: 발생 ${m((r) => r.scandal.dope + r.scandal.fix, full)}회`,
  );
}
if (FORK.report.length) {
  const avg = (rows: ForkRow[], f: (r: ForkRow) => number) => (rows.length ? rows.reduce((a, r) => a + f(r), 0) / rows.length : NaN);
  console.log(`스캔들 분기 (sensible 이 만난 카드 ${FORK_N}장 × ${FORK_REPS}회, 같은 상태에서 신고 vs 덮기 · 이후 ${FORK_AFTER}시즌)`);
  for (const [key, label] of [['report', '신고·협조'], ['cover', '덮기·믿기 ']] as const) {
    const rows = FORK[key];
    console.log(
      `  ${label}: 그 시즌 ${avg(rows, (r) => r.w0).toFixed(1)}승 · 그 시즌 결산 뒤 지지 ${avg(rows, (r) => r.trust0).toFixed(1)} · 이후 ${FORK_AFTER}시즌 ${avg(rows, (r) => r.wAfter).toFixed(1)}승 · ${FORK_AFTER}시즌 뒤 지지 ${avg(rows, (r) => r.trustEnd).toFixed(1)} · 적발 ${avg(rows, (r) => r.exposed).toFixed(2)}건 · 연고 이전 ${rows.filter((r) => r.over).length}/${rows.length}`,
    );
  }
  for (const kind of ['dope', 'fix']) {
    const a = FORK.report.filter((r) => r.kind === kind);
    const b = FORK.cover.filter((r) => r.kind === kind);
    if (a.length && b.length) console.log(`  ${kind}: 덮기 − 신고 = 그 시즌 ${(avg(b, (r) => r.w0) - avg(a, (r) => r.w0)).toFixed(2)}승 · 이후 ${FORK_AFTER}시즌 ${(avg(b, (r) => r.wAfter) - avg(a, (r) => r.wAfter)).toFixed(2)}승 · ${FORK_AFTER}시즌 뒤 지지 ${(avg(b, (r) => r.trustEnd) - avg(a, (r) => r.trustEnd)).toFixed(1)} (n=${a.length})`);
  }
}

console.log('\n── 2군 자동 운영과 2군 사건 (시즌당) ──');
for (const bot of BOTS) {
  const runs = all[bot.name];
  const seasons = Math.max(1, runs.reduce((a, r) => a + r.snaps.length, 0));
  const per = (v: number) => (v / seasons).toFixed(2);
  const sum = (f: (r: Run) => number) => runs.reduce((a, r) => a + f(r), 0);
  const byCard = FARM_CARDS.map((d) => `${d.id} ${per(sum((r) => r.cards[d.id] ?? 0))}`).join(' · ');
  const farmCards = sum((r) => FARM_CARDS.reduce((a, d) => a + (r.cards[d.id] ?? 0), 0));
  console.log(`${bot.name.padEnd(9)} 2군 사건 ${per(farmCards)}장 [${byCard}]`);
  console.log(`          부상 대체 카드 ${per(sum((r) => r.cards.sub ?? 0))}장/시즌`);
  console.log(`          자동: 부상 대체 콜업 ${per(sum((r) => r.farm.up))} · 대체 선수 복귀 ${per(sum((r) => r.farm.back))} · 벤치 유망주 2군행 ${per(sum((r) => r.farm.down))} · 지명 직전 방출 ${per(sum((r) => r.farm.cut))} | 입대 ${sum((r) => r.farm.army)}명 · 전역 복귀 ${sum((r) => r.farm.armyBack)}명 (${seasons}시즌)`);
}
const names: Record<string, number> = {};
for (const bot of BOTS) for (const r of all[bot.name]) for (const x of r.snaps) names[x.name] = (names[x.name] ?? 0) + 1;
console.log(`\n시즌 이름 분포: ${Object.entries(names).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(' · ')}`);

const champS = all.sensible.map((r) => r.champ).filter((x): x is number => x !== null);
const sStars = (() => {
  const runs = all.sensible;
  let tot = 0;
  let n = 0;
  let all3 = 0;
  for (let st = 0; st < 5; st++) {
    const rs = runs.filter((r) => r.snaps.some((x) => x.stage === st));
    const cnt = rs.map((r) => r.stars.filter((a) => a.startsWith(`s${st}-`)).length);
    tot += cnt.reduce((a, b) => a + b, 0);
    n += rs.length;
    all3 += cnt.filter((x) => x === 3).length;
  }
  return { avg: n ? tot / n : NaN, all3: n ? all3 / n : NaN };
})();
const spanS = (() => {
  const xs: number[] = [];
  for (let st = 0; st < 5; st++) for (const r of all.sensible) if (r.snaps.some((x) => x.stage === st && x.cleared)) xs.push(r.snaps.filter((x) => x.stage === st).length);
  return mean(xs);
})();
const overRate = (b: string) => all[b].filter((r) => r.over !== null).length / all[b].length;
const overAvg = (b: string) => mean(all[b].filter((r) => r.over !== null).map((r) => r.over!));
const maxCash = Math.max(...Array.from({ length: N_SEASONS }, (_, s) => mean(all.sensible.map((r) => r.snaps[s]).filter((x): x is SeasonSnap => !!x).map((x) => x.cash))).filter((v) => Number.isFinite(v)));
console.log('\n── 목표 대비 (LEVEL_DESIGN 11절) ──');
const flag0 = (b: string) => { const xs = all[b].flatMap((r) => r.snaps.filter((x) => x.stage === 0)); return xs.length ? xs.filter((x) => x.cleared).length / xs.length : NaN; };
console.log(`리그 ${NEW_GAME.teams}구단 · 0장 깃발 = ${NEW_GAME.teams - 1}위 이내(탈꼴찌) · 가을야구 = ${postTeamsFor(NEW_GAME.teams)}위 이내`);
console.log(`passive  연고 이전 평균 시즌 ${overAvg('passive').toFixed(1)} (목표 3~4) · 이전율 ${Math.round(overRate('passive') * 100)}%`);
console.log(`sensible 0장 깃발 달성률 ${Math.round(flag0('sensible') * 100)}% (목표 60~80%)`);
console.log(`sensible 장당 평균 ${spanS.toFixed(2)}시즌 (목표 1.3~1.8) · 우승 ${champS.length}/${N_SEEDS} 중앙 시즌 ${champS.length ? median(champS).toFixed(1) : '—'} (목표 7~8) · 이전율 ${Math.round(overRate('sensible') * 100)}% (목표 0%)`);
console.log(`sensible 별 장당 평균 ${sStars.avg.toFixed(2)}개 (목표 1.2~1.6) · 3개 전부 ${Math.round(sStars.all3 * 100)}% (목표 10~15%) · 시즌 말 평균 현금 최대 ${fmtMoney(maxCash)} (목표 ≤100억)`);
console.log(`greedy   2장 도달 중앙 ${median(all.greedy.map((r) => r.reach[2]).filter((x): x is number => x !== null)).toFixed(1)} · 3장 도달률 ${Math.round((all.greedy.filter((r) => r.reach[3] !== null).length / N_SEEDS) * 100)}% · 이전율 ${Math.round(overRate('greedy') * 100)}% (목표 25~40%)`);

// 왕조 프로젝트: 구매 시즌 분포 (시즌 말 스냅샷 기준 — 구매는 그 전 스토브리그)
{
  const KEYS: [string, string, number][] = [['academy', '아카데미', 1], ['dome', '돔 설계', 1], ['dome', '돔 착공', 2], ['dome', '돔 완공', 3], ['museum', '기념관', 1], ['youth', '유소년 1', 1], ['youth', '유소년 4', 4], ['camp', '전지훈련', 1], ['give', '환원 5회(50억)', 5]];
  console.log('\n── 왕조 프로젝트 (구매가 반영된 첫 시즌 말 · 우승 뒤 몇 시즌째) ──');
  for (const b of ['sensible', 'greedy']) {
    const rs = all[b].filter((r) => r.champ !== null);
    console.log(`${b}: 우승 ${rs.length}/${all[b].length}런`);
    if (!rs.length) continue;
    for (const [k, label, n] of KEYS) {
      const at = rs.map((r) => { const i = r.snaps.findIndex((x) => (x.proj[k] ?? 0) >= n); return i < 0 ? null : i + 1 - r.champ!; }).filter((x): x is number => x !== null);
      console.log(`  ${label.padEnd(14)} ${at.length}/${rs.length}런 · 우승 뒤 ${at.length ? `평균 ${mean(at).toFixed(1)} (최소 ${Math.min(...at)} · 최대 ${Math.max(...at)})시즌` : '—'}`);
    }
    const last = rs.map((r) => r.snaps[r.snaps.length - 1].proj);
    console.log(`  마지막 시즌: 도민 환원 평균 ${fmtMoney(mean(last.map((p) => (p.give ?? 0) * 100000)))} · 전지훈련 시즌 수는 매 시즌 재구매 · 돔 완공률 ${Math.round((last.filter((p) => (p.dome ?? 0) >= 3).length / rs.length) * 100)}%`);
  }
  console.log('sensible 시즌별 평균 현금: ' + Array.from({ length: N_SEASONS }, (_, s) => { const xs = all.sensible.map((r) => r.snaps[s]).filter((x): x is SeasonSnap => !!x); return xs.length ? `${s + 1}:${Math.round(mean(xs.map((x) => x.cash)) / 10000)}` : ''; }).filter(Boolean).join(' '));
}

const crashes = BOTS.flatMap((b) => all[b.name].filter((r) => r.crash).map((r) => `[${b.name}] ${r.crash}`));
if (crashes.length) {
  console.log('\n!! 크래시:');
  for (const x of crashes) console.log(x);
  process.exitCode = 1;
}
console.log(`\n(${((Date.now() - t0) / 1000).toFixed(1)}초)`);

quietPass();

// ── 부채: 매각 카드 · 한도 초과 결산 · 시즌별 한도와 부채 ──
console.log('\n── 부채 한도 (매각 카드 · 한도 초과 결산) ──');
console.log('봇        | 한도 초과 런 | 매각 카드/시즌 (본 런) | 한도 초과 결산 (시즌) | 연속 초과 결산 | 부채로 이전(이전 런 중 마지막 시즌 한도 초과)');
for (const bot of BOTS) {
  const runs = all[bot.name];
  const snaps = runs.flatMap((r) => r.snaps);
  const seasons = Math.max(1, snaps.length);
  const cards = runs.reduce((a, r) => a + (r.cards.debtsale ?? 0), 0);
  const over = runs.filter((r) => r.over !== null);
  const byDebt = over.filter((r) => (r.snaps[r.snaps.length - 1]?.over ?? 0) > 0);
  console.log(`${bot.name.padEnd(9)} | ${pct(runs.filter((r) => r.forcedSale).length, runs.length)}        | ${(cards / seasons).toFixed(2)} (${pct(runs.filter((r) => (r.cards.debtsale ?? 0) > 0).length, runs.length).trim()})        | ${snaps.filter((x) => x.over >= 1).length}/${snaps.length}              | ${snaps.filter((x) => x.over >= 2).length}             | ${byDebt.length}/${over.length}`);
}
for (const name of ['sensible', 'greedy']) {
  const runs = all[name];
  if (!runs) continue;
  console.log(`${name} 시즌별 평균 한도/부채(억): ` + Array.from({ length: N_SEASONS }, (_, s) => { const xs = runs.map((r) => r.snaps[s]).filter((x): x is SeasonSnap => !!x); return xs.length ? `${s + 1}:${Math.round(mean(xs.map((x) => x.limit)) / 10000)}/${Math.round(mean(xs.map((x) => x.debt)) / 10000)}` : ''; }).filter(Boolean).join(' '));
}

// ── 5단계(빚내는 플레이): 경쟁균형세 · 빚더미 여론 ──
console.log(`\n── 경쟁균형세·빚더미 여론 (경쟁균형세 ${LUX_TAX_BIG.on ? `상위 ${LUX_TAX_BIG.top} × ${LUX_TAX_BIG.capRate} · 초과분 × ${LUX_TAX_BIG.rate}` : '끔'} · 여론 문턱 ${DEBT_MOOD.at} −${DEBT_MOOD.trust}/−${DEBT_MOOD.trustFull} 유예 ${DEBT_MOOD.grace}) ──`);
{
  const e = (v: number) => (v / 10000).toFixed(0);
  const runs = all.sensible;
  console.log('AI 구단 연봉(억, sensible 런 평균) 시즌: 1위/3위/5위/9위 · 유저 뺀 상위3 평균');
  console.log('  ' + Array.from({ length: N_SEASONS }, (_, s) => { const xs = runs.map((r) => r.snaps[s]).filter((x): x is SeasonSnap => !!x); if (!xs.length) return ''; const at = (i: number) => e(mean(xs.map((x) => x.ai[i] ?? 0))); return `${s + 1}: ${at(0)}/${at(2)}/${at(4)}/${at(8)} · ${e(mean(xs.map((x) => (x.ai[0] + x.ai[1] + x.ai[2]) / 3)))}`; }).filter(Boolean).join(' | '));
  for (const bot of BOTS) {
    const rs = all[bot.name];
    const snaps = rs.flatMap((r) => r.snaps);
    const taxed = snaps.filter((x) => x.tax > 0);
    console.log(`[${bot.name}] 제재금 ${taxed.length}/${snaps.length}시즌 · 합계 ${fmtMoney(taxed.reduce((a, x) => a + x.tax, 0))} (낸 시즌 평균 ${taxed.length ? fmtMoney(mean(taxed.map((x) => x.tax))) : '—'}) · 빚더미 결산 ${snaps.filter((x) => x.heavy > 0).length}시즌 · 지지 감소 ${snaps.filter((x) => x.moodCut > 0).length}시즌 합계 −${snaps.reduce((a, x) => a + x.moodCut, 0)}`);
    console.log('  시즌: 연봉/상한(억) 세금 낸 런·평균 | 빚더미 런(평균 부채비율) 지지 −평균');
    console.log('  ' + Array.from({ length: N_SEASONS }, (_, s) => { const xs = rs.map((r) => r.snaps[s]).filter((x): x is SeasonSnap => !!x); if (!xs.length) return ''; const tx = xs.filter((x) => x.tax > 0); const hv = xs.filter((x) => x.heavy > 0); return `${s + 1}: ${e(mean(xs.map((x) => x.payroll)))}/${e(mean(xs.map((x) => x.cap)))} ${tx.length}런·${tx.length ? (mean(tx.map((x) => x.tax)) / 10000).toFixed(1) : '0'} | ${hv.length}런(${hv.length ? Math.round(mean(hv.map((x) => x.ratio))) : 0}%) −${(mean(xs.map((x) => x.moodCut))).toFixed(1)}`; }).filter(Boolean).join('\n  '));
  }
}

faReport();

// ── 6단계(FA 계약금 누진): 시즌당 FA 영입 수 분포 · 계약금 ──
function faReport(): void {
  console.log(`\n── FA 계약금 누진 (${FA_HEAT.on && NEW_GAME.teams > 8 ? `배율 ${FA_HEAT.mult.join('/')} · 그 뒤 +${FA_HEAT.step}${FA_HEAT.pay ? ` · 연봉 +${FA_HEAT.pay}n` : ''}` : '끔'}) ──`);
  for (const bot of BOTS) {
    const rs = all[bot.name];
    if (!rs) continue;
    const snaps = rs.flatMap((r) => r.snaps);
    if (!snaps.length) continue;
    const dist: number[] = [];
    for (const x of snaps) dist[x.faN] = (dist[x.faN] ?? 0) + 1;
    console.log(`[${bot.name}] 시즌당 FA 영입 수 분포(${snaps.length}시즌): ` + Array.from(dist, (v, i) => `${i}명 ${v ?? 0}`).join(' · ') + ` | 평균 ${mean(snaps.map((x) => x.faN)).toFixed(2)}명 · 계약금 시즌 평균 ${fmtMoney(mean(snaps.map((x) => x.faPaid)))} (배율로 더 낸 몫 ${fmtMoney(mean(snaps.map((x) => x.faExtra)))} · 런당 합계 ${fmtMoney(snaps.reduce((a, x) => a + x.faExtra, 0) / rs.length)})`);
    console.log('  시즌: 영입 수 평균 · 계약금 합(기본 → 실제, 억)');
    console.log('  ' + Array.from({ length: N_SEASONS }, (_, s) => { const xs = rs.map((r) => r.snaps[s]).filter((x): x is SeasonSnap => !!x); return xs.length ? `${s + 1}: ${mean(xs.map((x) => x.faN)).toFixed(1)}명 ${(mean(xs.map((x) => x.faPaid - x.faExtra)) / 10000).toFixed(1)}→${(mean(xs.map((x) => x.faPaid)) / 10000).toFixed(1)}` : ''; }).filter(Boolean).join(' | '));
  }
}
