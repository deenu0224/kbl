// 옛 세이브 생성기 — 10구단 이전 코드에서 돌려 8구단·84경기 세이브(JSON)를 뜬다. scripts/oldsave.ts 가 읽는다.
// 이 파일은 옛 코드(예: 커밋 dc7f9fe)의 워크트리에 복사해 그쪽 엔진으로 실행한다 (src/game 만 쓰므로 node_modules 는 없어도 된다):
//   git worktree add /tmp/kbl-old dc7f9fe
//   cp scripts/oldsave-gen.ts /tmp/kbl-old/scripts/
//   npx tsx /tmp/kbl-old/scripts/oldsave-gen.ts <출력 폴더> [시드 수=3]
//   git worktree remove --force /tmp/kbl-old
//   OLDSAVE_DIR=<출력 폴더> npm run oldsave
// 봇 4종 × 시드 × 시점(아래 want)마다 localStorage 'kbl-save-v1' 값과 같은 모양({ state: pickCore, version })으로 한 파일씩 남긴다.
import { mkdirSync, writeFileSync } from 'node:fs';
import type { Core } from '../src/game/types';
import { mulberry32 } from '../src/game/rng';
import { newCore } from '../src/game/generate';
import { advanceDay, nextSeason } from '../src/game/season';
import { ensureObjectives } from '../src/game/campaign';
import { maybeDrawEvent, resolveEvent } from '../src/game/events';
import { closeBriefing, drawBriefing } from '../src/game/briefing';
import { beginDraft, draftPick, draftSkip, isDraftDone } from '../src/game/draft';
import { drawResign } from '../src/game/contract';
import { drawStoveTrade } from '../src/game/trade';
import { BOTS, type Bot } from './bots';

const OUT = process.argv[2] || 'oldsaves';
const N_SEEDS = Number(process.argv[3]) || 3;
const VERSION = 3; // 옛 store.ts persist 의 version
const LAST = 6;

/** 옛 store.ts pickCore 와 같은 필드 */
const pickCore = (s: Core): Core => ({
  seed: s.seed, season: s.season, day: s.day, phase: s.phase, userId: s.userId, teams: s.teams, schedule: s.schedule, freeAgents: s.freeAgents,
  finance: s.finance, facilities: s.facilities, fans: s.fans, fanSat: s.fanSat, crowd: s.crowd, attHistory: s.attHistory, cashHistory: s.cashHistory,
  news: s.news, newsSeq: s.newsSeq, campaign: s.campaign, post: s.post, draft: s.draft,
});

let files = 0;
function run(bot: Bot, seed: number): void {
  const rng = mulberry32(seed * 7919 + 13);
  const done = new Set<string>();
  const snap = (label: string, c: Core): void => {
    if (done.has(label)) return;
    done.add(label);
    writeFileSync(`${OUT}/${bot.name}-${seed}-${label}.json`, JSON.stringify({ state: pickCore(c), version: VERSION }));
    files++;
  };
  /** 지금 상태가 뜨려는 시점이면 남긴다 (봇이 손대기 전) */
  const want = (c: Core): void => {
    const idle = !c.campaign.event && !c.campaign.briefing;
    if (c.phase === 'season' && idle) {
      if (c.season === 1 && c.day === 40) snap('s1d40', c);
      if (c.season === 1 && c.day === 80) snap('s1d80', c);
      if (c.season === 3 && c.day === 42) snap('s3mid', c);
      if (c.season === 6 && c.day === 42) snap('s6mid', c);
    }
    // 포스트시즌 진행 중: 유저가 올라간 첫 포스트시즌의 두 번째 경기 전 (없으면 아무 포스트시즌)
    if (c.phase === 'post' && c.post && idle) {
      const mine = c.post.series.some((s) => (s.hiId === c.userId || s.loId === c.userId) && s.games.length >= 1);
      if (mine) snap('post', c);
      else if (c.season >= 2 && c.post.series.some((s) => s.games.length >= 1)) snap('postx', c);
    }
    // 처리 대기 중인 카드·브리핑 (시즌 1의 20경기 이후 처음 것)
    if (c.phase === 'season' && c.day >= 20) {
      const id = c.campaign.event?.id.split('|')[0];
      if (id === 'trade') snap('trade', c);
      else if (id === 'sub') snap('sub', c);
      else if (id) snap('event', c);
      if (c.campaign.briefing && !c.campaign.event) snap(c.campaign.briefing.offers.length ? 'brief' : 'brief0', c);
    }
  };
  let c = ensureObjectives(newCore(seed), rng);
  snap('s1d0', c);
  for (let s = 1; s <= LAST && c.phase !== 'over'; s++) {
    c = bot.preseason(c);
    for (let g = 0; (c.phase === 'season' || c.phase === 'post') && g < 400; g++) {
      want(c);
      if (s === LAST && done.has('s6mid')) return;
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
    if (c.phase === 'over') {
      snap('over', c);
      return;
    }
    if (s === 1) snap('ended', c);
    c = drawResign(c);
    if (c.campaign.event) snap('resign', c); // 재계약 카드가 떠 있는 결산
    for (let g = 0; g < 40; g++) {
      if (!c.campaign.event) {
        c = drawStoveTrade(c, rng);
        if (!c.campaign.event) break;
        snap('stovetrade', c); // 스토브리그 트레이드 제안이 떠 있는 결산
      }
      c = resolveEvent(c, bot.event(c, c.campaign.event!), rng).core;
    }
    c = bot.beforeDraft(c);
    c = beginDraft(c, rng).core;
    for (let g = 0; !isDraftDone(c) && g < 10; g++) {
      if (g === 1) snap('draft', c); // 한 번 지명한 뒤 (드래프트 중)
      const pid = bot.draft(c);
      const r = pid ? draftPick(c, pid, rng) : draftSkip(c, rng);
      c = r.error ? draftSkip(c, rng).core : r.core;
    }
    snap('draftdone', c); // 지명을 마치고 다음 시즌 버튼을 누르기 전
    c = nextSeason(c, rng);
  }
}

mkdirSync(OUT, { recursive: true });
for (const bot of BOTS) for (let seed = 1; seed <= N_SEEDS; seed++) run(bot, seed);
console.log(`옛 세이브 ${files}개 → ${OUT} (봇 ${BOTS.length}종 × 시드 ${N_SEEDS})`);
