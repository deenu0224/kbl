// 옛 세이브 호환 점검: 10구단 이전 코드(8구단·84경기)로 만든 세이브를 지금 코드로 불러와 이어 한다.
// 실행: npm run oldsave  (scripts/fixtures-old/ 의 세이브. 다른 폴더는 OLDSAVE_DIR=<폴더>, 더 돌릴 시즌 수는 첫 인자 — 기본 2)
// 세이브 만들기: scripts/oldsave-gen.ts 머리 주석 (옛 커밋의 워크트리에서 그쪽 엔진으로 뜬다).
// 읽는 길은 앱과 같다: persist 가 저장한 { state, version } 을 store.ts migrateSave 에 넣는다.
// 확인: 크래시 0 · 로스터 불변식(scripts/invariants.ts) · 구단 8개와 옛 이름·id 유지 · 일정 84경기(홈 42) · 포스트시즌 4팀(와일드카드 없음)
//       · 장 목표가 8구단 표(STAGES) · 저장된 사건 카드/브리핑/트레이드 제안/드래프트가 그대로 처리됨.
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Core } from '../src/game/types';
import { mulberry32, type Rng } from '../src/game/rng';
import { advanceDay, nextSeason } from '../src/game/season';
import { STAGES, flagForecast, objDisplay, sceneExtras, stageFor, stageOf } from '../src/game/campaign';
import { maybeDrawEvent, resolveEvent } from '../src/game/events';
import { closeBriefing, drawBriefing, runOffer, skipOffer } from '../src/game/briefing';
import { beginDraft, draftPick, draftSkip, isDraftDone } from '../src/game/draft';
import { drawResign } from '../src/game/contract';
import { drawStoveTrade } from '../src/game/trade';
import { buildPost, postMatch } from '../src/game/postseason';
import { teamDef } from '../src/game/generate';
import { inPost, inWildcard, leagueSize, postRounds, postTeams, seasonGames } from '../src/game/league';
import { premiseNews, rankLine } from '../src/game/story';
import { runway } from '../src/game/runway';
import { shareFromCore } from '../src/share/shareData';
import { migrateSave } from '../src/store';
import { BOTS, type Bot } from './bots';
import { rosterCheck } from './invariants';

const DIR = process.env.OLDSAVE_DIR || join(dirname(fileURLToPath(import.meta.url)), 'fixtures-old');
const MORE = Number(process.argv[2]) || 2;
const OLD_IDS = ['BUS', 'DGU', 'DJN', 'GWJ', 'HAN', 'ICN', 'JEJ', 'SEL'];
const OLD_GAMES = 84;

const bad: string[] = [];
let crashes = 0;
let seasons = 0;
let games = 0;
let postGames = 0;
const pending = { event: 0, choices: 0, trade: 0, sub: 0, briefing: 0, offers: 0, draft: 0, roundtrip: 0 };

interface Ctx {
  file: string;
  names: string;
}
const namesOf = (c: Core) => c.teams.map((t) => `${t.id}:${t.name}`).join(',');

/** 8구단 리그의 모양이 그대로인가 (매 경기 뒤) */
function shape(c: Core, x: Ctx, where: string): void {
  const fail = (m: string) => bad.push(`${x.file} s${c.season} d${c.day} ${where}: ${m}`);
  if (leagueSize(c) !== 8) fail(`구단 ${leagueSize(c)}개`);
  if (namesOf(c) !== x.names) fail('구단 이름·id 가 바뀜');
  if (c.schedule.length !== OLD_GAMES) fail(`일정 ${c.schedule.length}경기`);
  if (seasonGames(c) !== OLD_GAMES || postTeams(c) !== 4 || postRounds(c).join() !== 'SPO,PO,KS') fail('리그 헬퍼가 8구단 값이 아님');
  if (inWildcard(c, 4) || inPost(c, 5) || !inPost(c, 4)) fail('가을야구 순위 헬퍼');
  if (c.post) {
    const ids = new Set(c.post.series.flatMap((s) => [s.hiId, s.loId]).filter(Boolean));
    if (ids.size > 4) fail(`포스트시즌 ${ids.size}팀`);
    if (c.post.series.some((s) => (s.round as string) === 'WC')) fail('와일드카드 시리즈');
  }
  if (c.campaign.history.some((h) => (h.post as string) === 'WC')) fail('구단사에 와일드카드');
  for (let k = 0; k < STAGES.length; k++) if (stageFor(c, k) !== STAGES[k]) fail(`${k}장 목표가 8구단 표가 아님`);
  if (stageOf(c) !== STAGES[Math.min(c.campaign.stage, STAGES.length - 1)]) fail('stageOf');
  for (const t of c.teams) if (!teamDef(t.id)) fail(`구단 정의 없음 ${t.id}`);
}

/** 시즌 일정: 구단마다 84경기 · 홈 42 */
function sched(c: Core, x: Ctx): void {
  const n: Record<string, number> = {};
  const h: Record<string, number> = {};
  for (const d of c.schedule) {
    if (d.length !== 4) bad.push(`${x.file} s${c.season}: 하루 ${d.length}경기`);
    for (const g of d) {
      n[g.homeId] = (n[g.homeId] ?? 0) + 1;
      n[g.awayId] = (n[g.awayId] ?? 0) + 1;
      h[g.homeId] = (h[g.homeId] ?? 0) + 1;
    }
  }
  for (const t of c.teams) if (n[t.id] !== OLD_GAMES || h[t.id] !== OLD_GAMES / 2) bad.push(`${x.file} s${c.season}: ${t.id} ${n[t.id]}경기 · 홈 ${h[t.id]}`);
}

/** 화면이 읽는 값들이 예외 없이 나오는가 */
function smoke(c: Core): void {
  buildPost(c);
  if (c.phase === 'post') postMatch(c);
  flagForecast(c);
  for (const o of c.campaign.objectives) objDisplay(c, o);
  sceneExtras(c);
  premiseNews(leagueSize(c));
  rankLine(c.campaign.history, true, leagueSize(c));
  if (c.phase === 'season') runway(c);
  shareFromCore(c, c.phase === 'over' ? 'relocated' : 'season');
}

/** 저장돼 있던 카드·브리핑: 고를 수 있는 선택지를 전부 눌러 본다 (복제본에서) */
function tryPending(c: Core, x: Ctx, rng: Rng): void {
  const card = c.campaign.event;
  if (card) {
    pending.event++;
    const id = card.id.split('|')[0];
    if (id === 'trade') pending.trade++;
    if (id === 'sub') pending.sub++;
    card.choices.forEach((ch, i) => {
      if (ch.disabled) return;
      pending.choices++;
      const r = resolveEvent(structuredClone(c), i, mulberry32(i + 1));
      if (r.error) bad.push(`${x.file}: 저장된 카드 ${card.id}[${i}] ${r.error}`);
      else if (r.core.campaign.event?.id === card.id) bad.push(`${x.file}: 저장된 카드 ${card.id}[${i}] 가 닫히지 않음`);
      else {
        shape(r.core, x, `카드 ${id}[${i}]`);
        for (const m of rosterCheck(r.core, false).msgs) bad.push(`${x.file}: 카드 ${id}[${i}] 뒤 ${m}`);
      }
    });
  }
  const br = c.campaign.briefing;
  if (br) {
    pending.briefing++;
    for (const o of br.offers) {
      pending.offers++;
      const r = runOffer(structuredClone(c), o.id);
      if (!r.error) for (const m of rosterCheck(r.core, false).msgs) bad.push(`${x.file}: 브리핑 제안 ${o.kind} 뒤 ${m}`);
      skipOffer(structuredClone(c), o.id);
    }
    if (closeBriefing(structuredClone(c)).campaign.briefing) bad.push(`${x.file}: 저장된 브리핑이 닫히지 않음`);
  }
  void rng;
}

function check(c: Core, x: Ctx, where: string, strict: boolean): void {
  shape(c, x, where);
  for (const m of rosterCheck(c, strict).msgs) bad.push(`${x.file} s${c.season} d${c.day} ${where}: ${m}`);
}

function run(file: string): void {
  const bot: Bot = BOTS.find((b) => file.startsWith(b.name + '-')) ?? BOTS[1];
  const raw = JSON.parse(readFileSync(join(DIR, file), 'utf8')) as { state: unknown; version: number };
  const rng = mulberry32(file.length * 7919 + raw.version);
  let c = migrateSave(raw.state, raw.version);
  const x: Ctx = { file, names: namesOf(c) };
  if (c.teams.map((t) => t.id).sort().join() !== OLD_IDS.join()) bad.push(`${file}: 옛 구단 id 가 아님 (${c.teams.map((t) => t.id).join()})`);
  check(c, x, '불러온 직후', false);
  smoke(c);
  tryPending(c, x, rng);
  if (c.phase === 'draft') pending.draft++;
  // 진행 중인 시즌을 마친 뒤 MORE 시즌을 더 돈다
  const goal = c.campaign.history.length + MORE + (c.phase === 'season' || c.phase === 'post' ? 1 : 0);
  let tripped = false;
  for (let guard = 0; guard < 12 && c.phase !== 'over' && c.campaign.history.length <= goal; guard++) {
    for (let g = 0; (c.phase === 'season' || c.phase === 'post') && g < 500; g++) {
      if (c.campaign.event) {
        const card = c.campaign.event;
        const r = resolveEvent(c, bot.event(c, card), rng);
        if (r.error) bad.push(`${file} s${c.season} d${c.day}: 카드 ${card.id} ${r.error}`);
        c = r.core;
        check(c, x, `카드 ${card.id.split('|')[0]}`, false);
        continue;
      }
      if (c.campaign.briefing) {
        c = closeBriefing(c);
        continue;
      }
      if (c.phase === 'season') c = bot.daily(c);
      const season = c.phase === 'season';
      c = drawBriefing(maybeDrawEvent(advanceDay(c, rng).core, rng));
      season ? games++ : postGames++;
      check(c, x, '경기 후', season && c.phase === 'season');
      if (g % 20 === 0) smoke(c);
    }
    if (c.phase === 'over') break;
    if (c.phase === 'ended') {
      seasons++;
      smoke(c);
      if (c.campaign.history.length >= goal) break;
      // 중간에 한 번 저장했다 다시 연다 (지금 코드의 세이브 왕복)
      if (!tripped) {
        tripped = true;
        pending.roundtrip++;
        c = migrateSave(JSON.parse(JSON.stringify({ ...c })), raw.version);
      }
      c = drawResign(c);
      for (let g = 0; g < 40; g++) {
        if (!c.campaign.event) {
          c = drawStoveTrade(c, rng);
          if (!c.campaign.event) break;
        }
        const r = resolveEvent(c, bot.event(c, c.campaign.event!), rng);
        if (r.error) bad.push(`${file} s${c.season} 스토브리그: 카드 ${c.campaign.event!.id} ${r.error}`);
        c = r.core;
      }
      c = bot.beforeDraft(c);
      const d = beginDraft(c, rng);
      if (d.error) bad.push(`${file} s${c.season}: 드래프트 시작 실패 ${d.error}`);
      c = d.core;
    }
    if (c.phase === 'draft') {
      for (let g = 0; !isDraftDone(c) && g < 12; g++) {
        const pid = bot.draft(c);
        const r = pid ? draftPick(c, pid, rng) : draftSkip(c, rng);
        c = r.error ? draftSkip(c, rng).core : r.core;
      }
      if (!isDraftDone(c)) bad.push(`${file} s${c.season}: 드래프트가 끝나지 않음`);
      if (c.draft && (c.draft.order.length % 8 !== 0 || new Set(c.draft.order).size !== 8)) bad.push(`${file} s${c.season}: 드래프트 순서 ${c.draft.order.length}칸 · ${new Set(c.draft.order).size}팀`);
      c = bot.preseason(nextSeason(c, rng));
      check(c, x, '시즌 전환', false);
      sched(c, x);
      const flag = c.campaign.objectives.find((o) => o.main);
      if (c.campaign.stage === 0 && flag && flag.target !== 7) bad.push(`${file} s${c.season}: 0장 깃발 목표 ${flag.target} (8구단은 7위 이내)`);
    }
  }
  if (c.phase !== 'over' && c.campaign.history.length < goal) bad.push(`${file}: ${MORE}시즌을 다 못 돎 (phase ${c.phase})`);
}

const files = readdirSync(DIR).filter((f) => f.endsWith('.json')).sort();
const t0 = Date.now();
for (const f of files) {
  try {
    run(f);
  } catch (e) {
    crashes++;
    bad.push(`${f}: 크래시 ${(e as Error).stack?.split('\n').slice(0, 4).join(' | ')}`);
  }
}
console.log(`\n옛 세이브 ${files.length}개 × ${MORE}시즌 더 (${DIR})`);
console.log(`마친 시즌 ${seasons} · 정규시즌 ${games}경기 · 포스트시즌 ${postGames}경기 · ${((Date.now() - t0) / 1000).toFixed(0)}초`);
console.log(`저장돼 있던 것: 사건 카드 ${pending.event}장(선택지 ${pending.choices}개 전부 시도 · 트레이드 제안 ${pending.trade} · 부상 대체 ${pending.sub}) · 브리핑 ${pending.briefing}건(제안 ${pending.offers}) · 드래프트 중 ${pending.draft} · 중간 저장 왕복 ${pending.roundtrip}회`);
console.log(`크래시 ${crashes}건`);
if (bad.length) {
  console.log(`!! 위반 ${bad.length}건`);
  for (const b of bad.slice(0, 30)) console.log('  ' + b);
  process.exitCode = 1;
} else console.log('위반 0건');
