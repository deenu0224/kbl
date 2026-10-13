// 화면 검증용 세이브 픽스처. 순수 게임 함수와 scripts/bots.ts 의 봇으로 시즌을 굴리며
// 필요한 상태를 만나는 순간의 Core 를 zustand persist 형식({ state, version })으로 떠 둔다.
// 실행: npx tsx scripts/screens/fixtures.ts  →  screens-out/fixtures/*.json (+ index.json)
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Core } from '../../src/game/types';
import { mulberry32, type Rng } from '../../src/game/rng';
import { newCore } from '../../src/game/generate';
import { advanceDay, nextSeason } from '../../src/game/season';
import { farmRoster, rehabRoster, userTeam } from '../../src/game/economy';
import { ensureObjectives, STAGES } from '../../src/game/campaign';
import { maybeDrawEvent, resolveEvent } from '../../src/game/events';
import { drawStoveTrade, tradeOpen } from '../../src/game/trade';
import { closeBriefing, drawBriefing } from '../../src/game/briefing';
import { beginDraft, draftPick, draftSkip, isDraftDone, isUserTurn } from '../../src/game/draft';
import { drawResign } from '../../src/game/contract';
import { postMatch } from '../../src/game/postseason';
import { runway, RUNWAY_DANGER } from '../../src/game/runway';
import { bullpenLoad } from '../../src/game/fixes';
import { todoList } from '../../src/game/todo';
import { emptyHof, recordClub, HOF_KEY, SAVE_VERSION } from '../../src/game/hof';
import { greedy, passive, sensible, type Bot } from '../bots';

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
  event: (c) => inSeason(c) && !!c.campaign.event && !c.campaign.event.id.startsWith('midcheck') && !c.campaign.event.id.startsWith('resign') && !c.campaign.event.id.startsWith('f-') && !c.campaign.event.id.startsWith('trade') && !c.campaign.event.id.startsWith('arm'),
  eventFarm: (c) => inSeason(c) && !!c.campaign.event && c.campaign.event.id.startsWith('f-'),
  briefing: (c) => inSeason(c) && !c.campaign.event && !!c.campaign.briefing && c.campaign.briefing.offers.length >= 2,
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
  regClosed: (c) => inSeason(c) && quiet(c) && c.day >= 73 && c.day < c.schedule.length - 2,
  tradeWindow: (c) => inSeason(c) && quiet(c) && tradeOpen(c) && c.season >= 2 && nextIsHome(c),
  dynasty: (c) => inSeason(c) && stageName(c) === '왕조' && c.day >= 20 && quiet(c) && nextIsHome(c),
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
if (found.injury) found.injuryManual = { ...found.injury, core: { ...structuredClone(found.injury.core), campaign: { ...structuredClone(found.injury.core.campaign), farmAuto: false } } };

mkdirSync(OUT, { recursive: true });
// 명예의 전당: 연고 이전(없으면 결산) 세이브를 한 줄 올려 둔다
const hofSrc = found.over?.core ?? found.ended?.core ?? found.endedFail?.core;
const hof = hofSrc ? JSON.stringify(recordClub(emptyHof(), hofSrc, found.over ? 'relocated' : 'abandoned', '2026-10-13')) : null;

const index: Record<string, { seed: number; bot: string; season: number; day: number; phase: string; stage: number }> = {};
for (const [name, f] of Object.entries(found)) {
  const ui: Record<string, string> = { ...UI_DEFAULT };
  if (hof) ui[UI_KEYS.hof] = hof;
  writeFileSync(resolve(OUT, `${name}.json`), JSON.stringify({ save: { state: f.core, version: SAVE_VERSION }, ui }));
  index[name] = { seed: f.seed, bot: f.bot, season: f.core.season, day: f.core.day, phase: f.core.phase, stage: f.core.campaign.stage };
}
writeFileSync(resolve(OUT, 'index.json'), JSON.stringify({ fixtures: index, missing: missing(), uiKeys: UI_KEYS, crashes }, null, 2));

console.log(`픽스처 ${Object.keys(found).length}개 (봇 실행 ${tried}회)`);
for (const [k, v] of Object.entries(index)) console.log(`  ${k.padEnd(10)} seed ${String(v.seed).padEnd(9)} ${v.bot.padEnd(8)} ${v.season}시즌 ${v.day}일 ${v.phase} ${v.stage}장`);
if (missing().length) console.log(`못 만든 픽스처: ${missing().join(', ')}`);
if (crashes.length) console.log(`봇 오류 ${crashes.length}건: ${crashes.slice(0, 3).join(' / ')}`);
