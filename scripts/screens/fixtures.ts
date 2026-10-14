// 화면 검증용 세이브 픽스처. 순수 게임 함수와 scripts/bots.ts 의 봇으로 시즌을 굴리며
// 필요한 상태를 만나는 순간의 Core 를 zustand persist 형식({ state, version })으로 떠 둔다.
// 실행: npx tsx scripts/screens/fixtures.ts  →  screens-out/fixtures/*.json (+ index.json)
import { fixedStarters } from '../../src/game/campaign';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Core } from '../../src/game/types';
import { mulberry32, type Rng } from '../../src/game/rng';
import { newCore } from '../../src/game/generate';
import { advanceDay, nextSeason, rankOf, signPlayer, standings } from '../../src/game/season';
import { farmRoster, loanLimit, rehabRoster, userTeam } from '../../src/game/economy';
import { ensureObjectives, STAGES } from '../../src/game/campaign';
import { maybeDrawEvent, resolveEvent } from '../../src/game/events';
import { drawStoveTrade, tradeOpen } from '../../src/game/trade';
import { closeBriefing, drawBriefing } from '../../src/game/briefing';
import { faSigned, luxTax } from '../../src/game/economy';
import { beginDraft, draftPick, draftSkip, isDraftDone, isUserTurn } from '../../src/game/draft';
import { drawResign } from '../../src/game/contract';
import { postMatch } from '../../src/game/postseason';
import { runway, RUNWAY_DANGER } from '../../src/game/runway';
import { bullpenLoad } from '../../src/game/fixes';
import { todoList } from '../../src/game/todo';
import { emptyHof, recordClub, seatsLabel, HOF_KEY, SAVE_VERSION } from '../../src/game/hof';
import { greedy, passive, sensible, type Bot } from '../bots';
import { regDeadline } from '../../src/game/economy';
import { ROSTER_MAX, activeRoster } from '../../src/game/economy';
import { releaseAdvice } from '../../src/game/release';

/** 할 일 카드 맨 앞 3줄 안에 "방출 검토"가 있다 */
const relTop = (c: Core) => todoList(c).slice(0, 3).some((t) => t.id.startsWith('rel-'));

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../../screens-out/fixtures');
const SEED_MAX = 200; // 시드를 바꿔 가며 찾는 상한
const SEASONS = 12;

// 픽스처와 함께 localStorage 에 넣을 UI 값 (uiStore.ts · LineupEditor.tsx · hofStore.ts 의 키).
// 초기 화면을 건너뛰는 플래그는 없다(uiStore.screen 은 항상 'title') — 순회 쪽에서 [이어하기]를 누른다.
export const UI_KEYS = {
  fast: 'kbl-fast-v1', // 하이라이트 빠르게
  tips: 'kbl-tips-v1', // 닫은 "첫 만남 한 문장"
  todo: 'kbl-todo-dismissed-v1', // [×]로 닫은 할 일
  editorHint: 'kbl-editor-hint-v1', // 오더 편집기 안내를 본 적 있음
  hof: HOF_KEY,
};
const UI_DEFAULT: Record<string, string> = { [UI_KEYS.fast]: '1' };

type Pred = (c: Core) => boolean;
const quiet: Pred = (c) => !c.campaign.event && !c.campaign.briefing;
const inSeason: Pred = (c) => c.phase === 'season' && c.day < c.schedule.length;
const nextIsHome = (c: Core) => c.schedule[c.day]?.some((m) => m.homeId === c.userId) ?? false;
const lastWasHome = (c: Core) => c.day > 0 && (c.schedule[c.day - 1]?.some((m) => m.homeId === c.userId) ?? false);
const stageName = (c: Core) => STAGES[Math.min(c.campaign.stage, STAGES.length - 1)].name;
const endingNow: Pred = (c) => {
  const v = c.campaign.verdict;
  return !!v?.cleared && c.campaign.ending && STAGES.slice(v.stageBefore, Math.max(v.stageAfter, v.stageBefore + 1)).some((s) => s.ending);
};

/** 픽스처 이름 → 조건. 시뮬레이션의 모든 중간 상태에 대해 검사하고 처음 맞는 상태를 쓴다 */
const WANT: Record<string, Pred> = {
  opened: (c) => inSeason(c) && c.season === 1 && c.day === 1 && quiet(c),
  away: (c) => inSeason(c) && c.day >= 3 && quiet(c) && !nextIsHome(c),
  injury: (c) => {
    if (!inSeason(c) || !quiet(c) || c.day < 2) return false;
    const t = userTeam(c);
    return t.lineup.some((s) => (t.roster.find((p) => p.id === s.pid)?.injury ?? 0) > 0);
  },
  event: (c) => inSeason(c) && !!c.campaign.event && !c.campaign.event.id.startsWith('midcheck') && !c.campaign.event.id.startsWith('debtsale') && !c.campaign.event.id.startsWith('resign') && !c.campaign.event.id.startsWith('f-') && !c.campaign.event.id.startsWith('sub|') && !c.campaign.event.id.startsWith('trade') && !c.campaign.event.id.startsWith('arm'),
  // 부상 대체 선택 카드: 타자 · 투수 · 10경기 이상(부상자 명단 + 콜업 후보)
  eventSubBat: (c) => inSeason(c) && !!c.campaign.event?.id.startsWith('sub|') && c.campaign.event.who === 'manager' && !c.campaign.event.body.includes('부상자 명단'),
  eventSubPit: (c) => inSeason(c) && !!c.campaign.event?.id.startsWith('sub|') && c.campaign.event.who === 'pitching',
  eventSubIl: (c) => inSeason(c) && !!c.campaign.event?.id.startsWith('sub|') && c.campaign.event.body.includes('부상자 명단') && c.campaign.event.choices.some((ch) => ch.label.startsWith('2군 ')),
  eventFarm: (c) => inSeason(c) && !!c.campaign.event && c.campaign.event.id.startsWith('f-'),
  briefing: (c) => inSeason(c) && !c.campaign.event && !!c.campaign.briefing && c.campaign.briefing.offers.length >= 2,
  // 부채: 한도의 50%·80%·초과 재무 화면, 매각 카드, 한도 초과 결산, 아카데미 뒤 2군 정원, 돔 기록 카드
  debt50: (c) => inSeason(c) && quiet(c) && c.day >= 1 && c.finance.debt >= loanLimit(c) * 0.5 && c.finance.debt < loanLimit(c) * 0.8,
  debt80: (c) => inSeason(c) && quiet(c) && c.day >= 1 && c.finance.debt >= loanLimit(c) * 0.8 && c.finance.debt <= loanLimit(c),
  debtOver: (c) => inSeason(c) && quiet(c) && c.day >= 1 && c.finance.debt > loanLimit(c), // 개막일(0일)은 개막전 오더 화면이라 하단 탭이 없다
  debtSale: (c) => inSeason(c) && !!c.campaign.event && c.campaign.event.id.startsWith('debtsale'),
  endedDebt: (c) => c.phase === 'ended' && !c.campaign.event && !!c.campaign.verdict?.debtOver,
  // 10구단 5단계: 빚더미 구단(첫 해 경고 / 지지 감소) · 경쟁균형세를 낸 결산 · 조합장의 빚더미 브리핑
  endedMoodWarn: (c) => c.phase === 'ended' && !c.campaign.event && c.campaign.verdict?.debtMood?.trust === 0,
  endedMood: (c) => c.phase === 'ended' && !c.campaign.event && (c.campaign.verdict?.debtMood?.trust ?? 0) < 0 && !endingNow(c),
  endedLux: (c) => c.phase === 'ended' && !c.campaign.event && !!c.campaign.verdict?.luxTax,
  briefMood: (c) => inSeason(c) && !c.campaign.event && !!c.campaign.briefing?.alert?.includes('이대로 마치면'),
  luxOver: (c) => inSeason(c) && quiet(c) && c.day >= 1 && luxTax(c).tax > 0,
  academy: (c) => inSeason(c) && quiet(c) && (c.campaign.projects?.academy ?? 0) > 0 && c.day >= 5,
  domeDone: (c) => c.phase === 'ended' && !c.campaign.event && (c.campaign.projects?.dome ?? 0) >= 3 && seatsLabel(c).startsWith('돔구장'),
  midcheck: (c) => !!c.campaign.event && c.campaign.event.id.startsWith('midcheck'),
  penover: (c) => inSeason(c) && quiet(c) && bullpenLoad(userTeam(c)).label === '과부하',
  cashlow: (c) => {
    if (!inSeason(c) || !quiet(c) || c.day < 6) return false;
    const n = runway(c).cashOut;
    return n !== null && n <= RUNWAY_DANGER && n >= 2;
  },
  soldout: (c) => inSeason(c) && quiet(c) && lastWasHome(c) && nextIsHome(c) && (c.crowd?.turnedAway ?? 0) > 0,
  farm: (c) => inSeason(c) && quiet(c) && c.day >= 10 && nextIsHome(c) && farmRoster(userTeam(c)).length >= 5,
  // 부상자 명단: 복귀까지 며칠 남은 재활 타자가 있는 날 (2군 트레이의 재활 칩 · 자리 시트의 재활 줄)
  fixedStart: (c) => inSeason(c) && quiet(c) && c.day >= 1 && [...fixedStarters(c).keys()].some((pid) => userTeam(c).lineup.some((l) => l.pid === pid)),
  rehab: (c) => inSeason(c) && quiet(c) && c.day >= 10 && nextIsHome(c) && farmRoster(userTeam(c)).length >= 3 && rehabRoster(userTeam(c)).some((p) => p.kind === 'B' && (p.farmUntil ?? 0) - c.day >= 3),
  // 할 일에 "매진 —" 줄이 있는 포스트시즌 (todo-action 화면이 그 줄을 누른다)
  post: (c) => c.phase === 'post' && quiet(c) && !!c.post && !!postMatch(c) && todoList(c).some((t) => t.text.startsWith('매진 —')),
  ended: (c) => c.phase === 'ended' && !c.campaign.event && !!c.campaign.verdict?.cleared && !endingNow(c),
  endedFail: (c) => c.phase === 'ended' && !c.campaign.event && !!c.campaign.verdict && !c.campaign.verdict.cleared,
  resign: (c) => c.phase === 'ended' && !!c.campaign.event && c.campaign.event.id.startsWith('resign'),
  draft: (c) => c.phase === 'draft' && !isDraftDone(c) && isUserTurn(c) && (c.draft?.mine.length ?? 0) === 0,
  draftDone: (c) => c.phase === 'draft' && isDraftDone(c) && (c.draft?.mine.length ?? 0) >= 1,
  season3: (c) => inSeason(c) && c.season === 3 && c.day >= 40 && quiet(c) && nextIsHome(c) && c.facilities.seats + c.facilities.food + c.facilities.training >= 2,
  over: (c) => c.phase === 'over',
  ending: (c) => c.phase === 'ended' && !c.campaign.event && endingNow(c),
  // 후반 스캔들: 약물 카드 대기 · 덮은 일이 드러난 결산
  dope: (c) => inSeason(c) && !!c.campaign.event && c.campaign.event.id.startsWith('dope'),
  exposed: (c) => c.phase === 'ended' && !c.campaign.event && !!c.campaign.verdict?.exposures?.length && !endingNow(c),
  // 트레이드 제안 3유형 · 혹사 카드
  tradeNow: (c) => inSeason(c) && c.campaign.event?.id.split('|')[0] === 'trade' && c.campaign.event.id.split('|')[2] === 'now',
  tradeFuture: (c) => inSeason(c) && c.campaign.event?.id.split('|')[0] === 'trade' && c.campaign.event.id.split('|')[2] === 'future',
  tradeDump: (c) => inSeason(c) && c.campaign.event?.id.split('|')[0] === 'trade' && c.campaign.event.id.split('|')[2] === 'dump',
  arm: (c) => inSeason(c) && c.campaign.event?.id.split('|')[0] === 'arm',
  fixcard: (c) => inSeason(c) && c.campaign.event?.id.split('|')[0] === 'fix',
  // 트레이드 기간 중의 조용한 날 (이적 창구의 [트레이드 시장에] 토글)
  // 스토브리그의 트레이드 제안 카드 · 마감 예고(트레이드 마감 6경기 전) · 등록 마감 뒤
  stoveTrade: (c) => c.phase === 'ended' && !!c.campaign.event && c.campaign.event.id.startsWith('trade'),
  deadlineSoon: (c) => inSeason(c) && quiet(c) && c.day >= 49 && c.day <= 52,
  regClosed: (c) => inSeason(c) && quiet(c) && c.day >= regDeadline(c) + 1 && c.day < c.schedule.length - 2,
  tradeWindow: (c) => inSeason(c) && quiet(c) && tradeOpen(c) && c.season >= 2 && nextIsHome(c),
  dynasty: (c) => inSeason(c) && stageName(c) === '왕조' && c.day >= 20 && quiet(c) && nextIsHome(c),
  // 방출 추천: 1군이 꽉 찬 시즌 중(추천 2~3명) · 개막 전(0일) · 결산 뒤 스토브리그
  relFull: (c) => inSeason(c) && quiet(c) && c.day >= 12 && activeRoster(userTeam(c)).length >= ROSTER_MAX && releaseAdvice(c).length >= 2 && relTop(c),
  relOpen: (c) => inSeason(c) && quiet(c) && c.season >= 2 && c.day === 0 && releaseAdvice(c).length >= 1,
  relStove: (c) => c.phase === 'ended' && !c.campaign.event && c.season >= 2 && releaseAdvice(c).length >= 2 && !endingNow(c),
};

const found: Record<string, { core: Core; seed: number; bot: string }> = {};
const missing = () => Object.keys(WANT).filter((k) => !found[k]);
let cur = { seed: 0, bot: '' };
function see(c: Core): void {
  for (const k of Object.keys(WANT)) {
    if (found[k]) continue;
    let hit = false;
    try {
      hit = WANT[k](c);
    } catch {
      hit = false;
    }
    if (hit) found[k] = { core: structuredClone(c), ...cur };
  }
}

function playSeason(bot: Bot, c0: Core, rng: Rng): Core {
  let c = bot.preseason(c0);
  for (let guard = 0; (c.phase === 'season' || c.phase === 'post') && guard < 400; guard++) {
    see(c);
    if (c.campaign.event) {
      const r = resolveEvent(c, bot.event(c, c.campaign.event), rng);
      if (r.error) throw new Error(r.error);
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

function runOne(bot: Bot, seed: number): void {
  cur = { seed, bot: bot.name };
  const rng = mulberry32(seed * 7919 + 101);
  let c = ensureObjectives(newCore(seed), rng);
  for (let s = 1; s <= SEASONS && missing().length; s++) {
    c = playSeason(bot, c, rng);
    see(c);
    if (c.phase === 'over') return;
    c = drawResign(c);
    while (c.campaign.event) {
      see(c);
      c = resolveEvent(c, bot.event(c, c.campaign.event), rng).core;
    }
    c = drawStoveTrade(c, rng);
    see(c);
    if (c.campaign.event) c = resolveEvent(c, bot.event(c, c.campaign.event), rng).core;
    c = bot.beforeDraft(c);
    const d = beginDraft(c, rng);
    if (d.error) throw new Error(d.error);
    c = d.core;
    for (let g = 0; !isDraftDone(c) && g < 10; g++) {
      see(c);
      // 화면에 "내 지명" 이 보이도록 봇이 패스해도 한 명은 뽑는다
      const pid = bot.draft(c) ?? (c.draft?.mine.length ? null : (c.draft?.pool[0]?.id ?? null));
      const r = pid ? draftPick(c, pid, rng) : draftSkip(c, rng);
      c = r.error ? draftSkip(c, rng).core : r.core;
    }
    see(c);
    c = nextSeason(c, rng);
  }
}

// fresh 는 시드 고정의 새 게임 그대로
found.fresh = { core: ensureObjectives(newCore(20261013), mulberry32(1)), seed: 20261013, bot: '-' };

let tried = 0;
const crashes: string[] = [];
outer: for (let seed = 1; seed <= SEED_MAX; seed++) {
  for (const bot of [sensible, passive, greedy]) {
    if (!missing().length) break outer;
    tried++;
    try {
      runOne(bot, seed);
    } catch (e) {
      crashes.push(`seed ${seed} ${bot.name}: ${(e as Error).message}`);
    }
  }
}

// 2군 자동 운영을 끈 부상 세이브: 선수 카드의 [부상자 명단으로] · 조치 시트의 "부상자 명단으로"
if (found.injury) found.injuryManual = { ...found.injury, core: { ...structuredClone(found.injury.core), campaign: { ...structuredClone(found.injury.core.campaign), farmAuto: false, eventsSeen: found.injury.core.campaign.eventsSeen.filter((x) => !x.startsWith('~subdone-')) } } }; // 카드에서 고르지 않은 부상 (할 일에 뜬다)
// FA 계약금 누진: 이번 시즌에 FA 를 이미 2명 영입한 뒤 (영입 시장·선수 카드·요약의 계약금에 배율이 보인다)
if (found.season3) {
  let core = structuredClone(found.season3.core);
  core.finance.cash = Math.max(core.finance.cash, 300000);
  for (const p of core.freeAgents.filter((x) => !x.foreign).sort((a, b) => a.salary - b.salary).slice(0, 2)) {
    const r = signPlayer(core, p.id);
    if (!r.error) core = r.core;
  }
  if (faSigned(core) >= 2) found.faHeat = { ...found.season3, core };
}
// 왕조 프로젝트: 왕조 장 픽스처에서 돔 단계만 바꿔 만든다 (봇이 12시즌 안에 돔까지 가지 못한다)
const hofOf: Record<string, string> = {};
if (found.dynasty) {
  for (const n of [0, 1, 2, 3]) {
    const core = structuredClone(found.dynasty.core);
    core.facilities.seats = 4;
    core.finance.cash = Math.max(core.finance.cash, 1500000);
    core.finance.debt = 0;
    core.campaign.ending = true;
    core.campaign.retired = core.campaign.retired?.length ? core.campaign.retired : [{ name: '고영수', season: 4, pos: 'SS' }];
    core.campaign.projects = n === 0 ? { open: core.season - 1 } : { open: core.season - 2, dome: n, domeAt: core.season - 1, academy: 1, youth: 2, give: 6 };
    const name = n === 0 ? 'projects' : `dome${n}`;
    found[name] = { ...found.dynasty, core };
    if (n === 3) hofOf[name] = JSON.stringify(recordClub(emptyHof(), core, 'champion', '2026-10-13'));
  }
}

// ── 10구단: 와일드카드 결정전 (봇이 4·5위로 시즌을 마치는 일이 드물어 마지막 경기 직전의 순위를 고쳐서 만든다) ──
/** 사건·브리핑을 넘기며 하루 진행 */
function stepDay(c0: Core, rng: Rng): Core {
  let c = c0;
  for (let g = 0; g < 20 && (c.campaign.event || c.campaign.briefing); g++) c = c.campaign.event ? resolveEvent(c, sensible.event(c, c.campaign.event), rng).core : closeBriefing(c);
  return drawBriefing(maybeDrawEvent(advanceDay(c, rng).core, rng));
}
/** 정규시즌 마지막 경기 전의 세이브에서 유저 구단을 정확히 rank 위로 만든다 (다른 구단의 전적을 빌려 온다). 안 되면 null */
function forceRank(c0: Core, rank: number): Core | null {
  const c = structuredClone(c0);
  const others = standings(c.teams).filter((t) => t.id !== c.userId);
  const above = others[rank - 2]?.rec;
  const below = others[rank - 1]?.rec;
  if (!above || !below) return null;
  const me = c.teams.find((t) => t.id === c.userId)!;
  const games = me.rec.w + me.rec.l + me.rec.t;
  // 바로 아래 구단보다 2승 많게 (마지막 경기 결과와 무관하게 순위가 유지되도록 위와의 간격도 본다)
  const w = Math.min(below.w + 2, above.w - 2);
  if (w < below.w + 2) return null;
  me.rec = { ...me.rec, w, l: games - w - me.rec.t, last10: [1, 0, 1, 1, 0, 1, 0, 1, 1, 0], streak: -1 };
  return rankOf(c.teams, c.userId) === rank ? c : null;
}
const lastDay: Pred = (c) => c.phase === 'season' && c.day === c.schedule.length - 1 && quiet(c);
function wildcardFixtures(): void {
  for (let seed = 1; seed <= 12 && !(found.wcHi && found.wcLo && found.wcOut && found.wcTie && found.wcMid); seed++) {
    const rng = mulberry32(seed * 7919 + 101);
    let c = sensible.preseason(ensureObjectives(newCore(seed), rng));
    for (let g = 0; g < 400 && c.phase === 'season' && !lastDay(c); g++) {
      if (!c.campaign.event && !c.campaign.briefing) c = sensible.daily(c);
      c = stepDay(c, rng);
    }
    if (!lastDay(c)) continue;
    for (const rank of [4, 5]) {
      const base = forceRank(c, rank);
      if (!base) continue;
      for (let k = 0; k < 8; k++) {
        const r2 = mulberry32(seed * 31 + rank * 7 + k);
        let p: Core;
        try {
          p = stepDay(base, r2);
        } catch {
          continue;
        }
        const s0 = p.post?.series[0];
        if (p.phase !== 'post' || !p.post || s0?.round !== 'WC' || rankOf(p.teams, p.userId) !== rank) continue;
        const name = rank === 4 ? 'wcHi' : 'wcLo';
        if (!found[name] && quiet(p)) found[name] = { core: structuredClone(p), seed, bot: `forced ${rank}위` };
        // 무승부로 4위가 통과한 뒤: 엔진이 남기는 상태(무승부 한 경기 · 4위 승수 그대로 1 · 다음 라운드의 하위 시드로)를 그대로 만든다
        if (rank === 4 && !found.wcTie && quiet(p)) {
          const t = structuredClone(p);
          const w = t.post!.series[0];
          w.games = [{ homeId: w.hiId!, awayId: w.loId!, home: 3, away: 3 }];
          w.winnerId = w.hiId;
          t.post!.series[1].loId = w.hiId;
          t.post!.cur = 1;
          t.post!.userFinish = t.post!.series[1].round;
          found.wcTie = { core: t, seed, bot: 'forced 4위 무승부' };
        }
        // 한 경기씩 치르며: 1승 1패로 2차전을 앞둔 날 · 와일드카드에서 떨어진 결산
        for (let g = 0; g < 4 && p.phase === 'post'; g++) {
          try {
            p = stepDay(p, r2);
          } catch {
            break;
          }
          const w = p.post?.series[0];
          if (!found.wcMid && p.phase === 'post' && w && !w.winnerId && w.games.length === 1 && quiet(p)) found.wcMid = { core: structuredClone(p), seed, bot: `forced ${rank}위` };
          if (!found.wcOut && p.phase === 'ended' && p.post?.userFinish === 'WC' && !p.campaign.event && !endingNow(p)) found.wcOut = { core: structuredClone(p), seed, bot: `forced ${rank}위` };
        }
      }
    }
  }
}
wildcardFixtures();

// ── 8구단 세이브 (10구단 체제 전에 시작한 게임): 구단 8개 · 84경기. 시즌 중 + 포스트시즌(4팀 사다리) ──
{
  const rng = mulberry32(8 * 7919 + 101);
  let c = sensible.preseason(ensureObjectives(newCore(8, { teams: 8 }), rng));
  for (let g = 0; g < 400 && c.phase === 'season'; g++) {
    if (!found.eight && c.day >= 40 && quiet(c) && nextIsHome(c)) found.eight = { core: structuredClone(c), seed: 8, bot: '8구단' };
    if (lastDay(c)) break;
    if (!c.campaign.event && !c.campaign.briefing) c = sensible.daily(c);
    c = stepDay(c, rng);
  }
  const base = lastDay(c) ? forceRank(c, 4) : null;
  if (base) {
    const p = stepDay(base, rng);
    if (p.phase === 'post' && quiet(p)) found.eightPost = { core: structuredClone(p), seed: 8, bot: '8구단 forced 4위' };
  }
  // 옛 세이브처럼: 구단 이름은 그때 이름 그대로 (세이브는 migrate 로 이름·id 를 바꾸지 않는다)
  const OLD: Record<string, [string, string]> = { SEL: ['서울', '스카이라인즈'], HAN: ['한강', '그리폰즈'], BUS: ['부산', '씨호크스'], DGU: ['대구', '썬더킹스'], GWJ: ['광주', '레드폭스'], DJN: ['대전', '팰컨스'] };
  for (const k of ['eight', 'eightPost']) {
    const f = found[k];
    if (!f) continue;
    for (const t of f.core.teams) if (OLD[t.id]) [t.city, t.name] = OLD[t.id];
  }
}

// ── 진짜 옛 세이브: 10구단 이전 코드(dc7f9fe)로 저장한 파일을 손대지 않고 그대로 넣는다 (scripts/fixtures-old — npm run oldsave 와 같은 파일) ──
for (const [name, file] of [['oldReal', 'sensible-3-s6mid'], ['oldRealPost', 'sensible-1-post']] as const) {
  try {
    const raw = JSON.parse(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../fixtures-old', `${file}.json`), 'utf8')) as { state: Core };
    found[name] = { core: raw.state, seed: raw.state.seed, bot: `옛 세이브 ${file}` };
  } catch {
    // 파일이 없으면 건너뛴다
  }
}

mkdirSync(OUT, { recursive: true });
// 명예의 전당: 연고 이전(없으면 결산) 세이브를 한 줄 올려 둔다
const hofSrc = found.over?.core ?? found.ended?.core ?? found.endedFail?.core;
const hof = hofSrc ? JSON.stringify(recordClub(emptyHof(), hofSrc, found.over ? 'relocated' : 'abandoned', '2026-10-13')) : null;

const index: Record<string, { seed: number; bot: string; season: number; day: number; phase: string; stage: number }> = {};
for (const [name, f] of Object.entries(found)) {
  const ui: Record<string, string> = { ...UI_DEFAULT };
  if (hofOf[name] ?? hof) ui[UI_KEYS.hof] = (hofOf[name] ?? hof)!;
  writeFileSync(resolve(OUT, `${name}.json`), JSON.stringify({ save: { state: f.core, version: SAVE_VERSION }, ui }));
  index[name] = { seed: f.seed, bot: f.bot, season: f.core.season, day: f.core.day, phase: f.core.phase, stage: f.core.campaign.stage };
}
writeFileSync(resolve(OUT, 'index.json'), JSON.stringify({ fixtures: index, missing: missing(), uiKeys: UI_KEYS, crashes }, null, 2));

console.log(`픽스처 ${Object.keys(found).length}개 (봇 실행 ${tried}회)`);
for (const [k, v] of Object.entries(index)) console.log(`  ${k.padEnd(10)} seed ${String(v.seed).padEnd(9)} ${v.bot.padEnd(8)} ${v.season}시즌 ${v.day}일 ${v.phase} ${v.stage}장`);
if (missing().length) console.log(`못 만든 픽스처: ${missing().join(', ')}`);
if (crashes.length) console.log(`봇 오류 ${crashes.length}건: ${crashes.slice(0, 3).join(' / ')}`);
