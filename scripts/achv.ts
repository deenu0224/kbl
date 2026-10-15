// 도전과제 점검. 실행: npm run achv -- [시드 수] [시즌 수] [--quiet] [--md]   (--md = docs/ACHIEVEMENTS.md 를 다시 만든다)
// 봇 4종으로 여러 시드를 돌리면서 스토어와 같은 방식(직전/현재 상태 비교)으로 판정 함수를 직접 부르고, 도전과제별 달성률 표를 낸다.
// 목록 검사(총 200개 · 중복 id·제목 0 · 범주·난이도 분포)와 판정 중 예외는 실패로 취급한다.
import { writeFileSync } from 'node:fs';
import type { Core, DayReport } from '../src/game/types';
import { mulberry32 } from '../src/game/rng';
import { newCore } from '../src/game/generate';
import { advanceDay, borrow, nextSeason, releasePlayer, setTicketPrice } from '../src/game/season';
import { payroll, userTeam } from '../src/game/economy';
import { isFranchise } from '../src/game/franchise';
import { setFarmAuto } from '../src/game/farm';
import { ensureObjectives } from '../src/game/campaign';
import { maybeDrawEvent, resolveEvent } from '../src/game/events';
import { closeBriefing, drawBriefing, runOffer } from '../src/game/briefing';
import { beginDraft, draftPick, draftSkip, isDraftDone } from '../src/game/draft';
import { drawResign } from '../src/game/contract';
import { drawStoveTrade } from '../src/game/trade';
import { ACHV_CATS, achvLint, achvProgress, achvStep, emptyAchv, type AchvSave } from '../src/game/achievements';
import { ACHV_LIST, ACHV_TOTAL } from '../src/game/achievementList';
import { BOTS, baseId, sensible, type Bot } from './bots';

const N_SEEDS = Number(process.argv[2]) || 6;
const N_SEASONS = Number(process.argv[3]) || 12;
const QUIET = process.argv.includes('--quiet');
const bad: string[] = [];
const errSeen = new Set<string>();
// 봇이 닿은 가장 큰 값 (봇이 못 한 도전과제의 조건이 얼마나 먼지 보는 참고치)
const top = { cash: 0, profit: 0, fans: 0, stars: 0, ovr: 0, lineupMin: 0, att: 0, payRankAtPost: 0 };

let stunt: 'main' | 'price' | 'brief' = 'main';
/** 사람 흉내(기행): sensible 을 바탕으로, 봇은 하지 않지만 사람은 하는 일을 일부러 한다 */
const human: Bot = {
  ...sensible,
  name: 'human',
  event: (c, card) => {
    if (process.env.DBG && baseId(card) === 'dome') console.log('dome card', c.season, card.choices.map((x) => x.disabled ?? 'ok'));
    return baseId(card) === 'dome' ? 1 : sensible.event(c, card);
  },
  daily: (c0) => {
    let c = sensible.daily(c0);
    // 가격 탐침(2시즌만): 티켓값을 바닥(0.5)으로, 천장(4.0)으로, 그다음 2.0 으로. 본 탐침: 5장 이후 한 구간을 2.0 으로 버틴다
    if (stunt === 'price') {
      if (c.season === 2 && c.day < 12) c = setTicketPrice(c, 0.5);
      else if (c.season === 2 && c.day < 24) c = setTicketPrice(c, 4);
      else if (c.season === 2 && c.day < 60) c = setTicketPrice(c, 2);
      return c;
    }
    if (c.campaign.stage >= 4 && c.day >= 30 && c.day < 42) c = setTicketPrice(c, 2);
    // 프랜차이즈 스타가 생기면 한 번 내보낸다
    if (c.season >= 6 && c.day === 30) {
      const fr = userTeam(c).roster.find((p) => isFranchise(p, c.season));
      const r = fr ? releasePlayer(c, fr.id) : null;
      if (process.env.DBG) console.log('franchise', c.season, fr?.name, r?.error);
      if (r && !r.error) c = r.core;
    }
    return c;
  },
};

/** 한 구단(봇 × 시드)의 진행. save 를 이어받아 돌려준다 (누적 도전과제는 봇별로 여러 구단에 걸쳐 쌓는다) */
function run(bot: Bot, seed: number, save0: AchvSave, hit: Set<string>, seasons = N_SEASONS): AchvSave {
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
  for (let s = 1; s <= seasons && c.phase !== 'over'; s++) {
    c = bot.preseason(c);
    see(c);
    for (let g = 0; (c.phase === 'season' || c.phase === 'post') && g < 400; g++) {
      if (c.campaign.event) {
        c = resolveEvent(c, bot.event(c, c.campaign.event), rng).core;
        see(c);
        continue;
      }
      if (c.campaign.briefing) {
        if (bot === human && stunt === 'brief') {
          // 사람은 제안을 실행하기도 한다: 첫 제안 하나
          const o = c.campaign.briefing.offers.find((x) => !x.state);
          const r = o ? runOffer(c, o.id) : null;
          if (r && !r.error) {
            c = r.core;
            see(c);
          }
        }
        c = closeBriefing(c);
        continue;
      }
      if (c.phase === 'season') {
        if (bot === human && stunt === 'brief' && c.season === 1 && c.day === 3) {
          // 2군 자동 운영을 껐다가 다시 켠다
          c = setFarmAuto(c, false);
          see(c);
          c = setFarmAuto(c, true);
        }
        c = bot.daily(c);
        see(c);
      }
      const r = advanceDay(c, rng);
      c = drawBriefing(maybeDrawEvent(r.core, rng));
      see(c, [r.report]);
      top.cash = Math.max(top.cash, c.finance.cash);
      top.fans = Math.max(top.fans, c.fans);
      top.att = Math.max(top.att, r.report.crowd?.attendance ?? 0);
      if (c.campaign.history.length && c.campaign.history[c.campaign.history.length - 1].season === c.season && c.phase !== 'season' && c.phase !== 'post') {
        const h = c.campaign.history[c.campaign.history.length - 1];
        const t = userTeam(c);
        top.profit = Math.max(top.profit, h.profit);
        top.stars = Math.max(top.stars, c.campaign.achievements.length);
        top.ovr = Math.max(top.ovr, ...t.roster.map((p) => p.ovr));
        top.lineupMin = Math.max(top.lineupMin, Math.min(...t.lineup.map((l) => t.roster.find((p) => p.id === l.pid)?.ovr ?? 0)));
        if (h.post !== 'none') top.payRankAtPost = Math.max(top.payRankAtPost, c.teams.filter((x) => payroll(x) > payroll(t)).length + 1);
      }
    }
    if (c.phase === 'over' || s === seasons) break;
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
  if (process.env.DBG) console.log(`${bot.name} seed${seed}: ${c.campaign.history.map((h) => `${h.stage}/${h.rank}`).join(' ')} ${c.phase}`);
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

// ── 사람 흉내 탐침: 봇이 하지 않는 조작으로만 닿는 것들 ──
const humanHit = new Set<string>();
for (let seed = 1; seed <= Math.min(2, N_SEEDS); seed++) run(human, seed + 500, emptyAchv(), humanHit);
stunt = 'price';
run(human, 503, emptyAchv(), humanHit, 2);
stunt = 'brief';
run(human, 504, emptyAchv(), humanHit, 1);
stunt = 'main';
{
  // 선수단을 최소 인원까지 줄여 본다 (돈이 모자라면 빌린다)
  let c = ensureObjectives(newCore(777), mulberry32(777));
  let save = emptyAchv();
  let prev: Core = c;
  for (let i = 0; i < 60 && userTeam(c).roster.length > 20; i++) {
    const t = userTeam(c);
    const cand = [...t.roster].sort((a, b) => a.salary - b.salary);
    let done = false;
    for (const p of cand) {
      let r = releasePlayer(c, p.id);
      if (r.error && /부족/.test(r.error)) {
        const b = borrow(c);
        if (!b.error) r = releasePlayer(b.core, p.id);
      }
      if (!r.error) {
        c = r.core;
        done = true;
        break;
      }
    }
    if (!done) break;
    const st = achvStep(ACHV_LIST, save, prev, c, [], 'probe');
    for (const id of st.gained) humanHit.add(id);
    save = st.save;
    prev = c;
  }
}
{
  // 새 구단을 세 번 시작한다
  let save = emptyAchv();
  let prev: Core | null = null;
  for (let i = 0; i < 4; i++) {
    const c = ensureObjectives(newCore(900 + i), mulberry32(900 + i));
    const st = achvStep(ACHV_LIST, save, prev, c, [], 'probe');
    for (const id of st.gained) humanHit.add(id);
    save = st.save;
    prev = c;
  }
}

// 봇이 못 하는 것의 사유 (보고서·문서의 "봇은 못 하지만 사람은 가능")
const WHY: Record<string, string> = {
  's-brief': '봇은 주간 브리핑을 닫기만 한다. 제안 실행(runOffer)은 briefMemo.done 에 적힌다 — 탐침 확인',
  'c-cash200': '봇은 남는 돈을 시설·왕조 프로젝트(총 267억)·도민 환원에 쓴다. 쓰면서도 최대 183억을 쥐었으므로 쓰지 않고 모으면 닿는다',
  'c-cash300': '위와 같다. 시즌 영업 흑자 최대 89억 + 깃발 지원금으로, 프로젝트를 미루면 몇 시즌 안에 닿는다',
  'c-price2': '봇은 적정가(최대 1.8만원 매진)를 따른다. 5장 이후 2.0만원으로 올려도 매진된다 — 탐침 확인',
  'q-farm-manual': '봇은 2군 자동 운영을 끄지 않는다. 설정의 토글(campaign.farmAuto = false) — 탐침 확인',
  'o-fa-champ': '봇은 키운 선수를 주전에 둔다. FA 영입 선수(Player.from = fa)로만 주전·선발진을 채우고 우승하면 된다 — 사람의 선택',
  'o-home-champ': '우리 드래프트 출신(Player.from = draft)으로 주전 14명을 채우려면 여러 시즌의 지명이 필요하다. 봇은 FA·트레이드를 섞는다 — 사람의 선택',
  'q-run': '봇은 주루 방침을 바꾸지 않는다. 타순 화면의 스위치(campaign.runStyle) — 사람의 선택',
  't-dealt': '봇은 돔구장의 제안을 거절한다. 둘째 선택지가 campaign.dealt 를 세운다 — 탐침 확인',
  't-give50': '봇은 관중석을 다 올리고 돔구장 다음 단계 대금 + 여유 30억이 남을 때만 환원한다(scripts/bots.ts giveSpare). 10구단에서는 12시즌 안에 돔이 설계~착공 단계라 환원이 0회였다. 환원은 왕조 장에서 10억씩 횟수 제한이 없어, 9시즌째 현금 60~97억에서 5회를 사면 바로 닿는다 — 탐침 확인(4단계)',
  't-allproj': '봇은 12시즌 안에 프로젝트 넷을 다 사지 못했다(돔 완공·아카데미·기념관은 각각 달성). 전부 현금으로 사는 것이라 왕조 장을 오래 하면 닿는다',
  'o-cheap-sell': '봇은 티켓값을 0.5만원까지 내리지 않는다 — 탐침 확인',
  'o-greedy': '봇은 티켓값을 4.0만원까지 올리지 않는다 — 탐침 확인',
  'o-franchise-out': '봇은 프랜차이즈 스타를 방출하지 않는다. releasePlayer 가 허용한다 — 탐침 확인',
};

const pctOf = (n: number) => `${Math.round((n / N_SEEDS) * 100)}`.padStart(3) + '%';
console.log(`\n도전과제 점검: 봇 ${BOTS.length}종 × ${N_SEEDS} 시드 × ${N_SEASONS} 시즌 (${((Date.now() - t0) / 1000).toFixed(0)}초) · 누적은 봇별로 ${N_SEEDS}개 구단을 이어서 한 번 더`);
console.log(`목록 ${ACHV_LIST.length}개 · 숨김 ${hidden}개`);
console.log('범주별: ' + ACHV_CATS.map((k) => `${k.name} ${ACHV_LIST.filter((d) => d.cat === k.id).length}`).join(' · '));
console.log('난이도: ' + [1, 2, 3, 4].map((t) => `tier${t} ${ACHV_LIST.filter((d) => d.tier === t).length}`).join(' · '));
const never: string[] = [];
const probed: string[] = [];
const tierRate: number[][] = [[], [], [], [], []];
if (!QUIET) console.log(`\n${'id'.padEnd(18)}T  ${BOTS.map((b) => b.name.padStart(9)).join('')}   누적  제목 — 조건`);
for (const k of ACHV_CATS) {
  if (!QUIET) console.log(`── ${k.name} ──`);
  for (const d of ACHV_LIST.filter((x) => x.cat === k.id)) {
    const per = BOTS.map((b) => rate[d.id]?.[b.name] ?? 0);
    const any = per.some((n) => n > 0) || career.has(d.id);
    if (!any && humanHit.has(d.id)) probed.push(d.id);
    if (!any) never.push(d.id);
    tierRate[d.tier].push(Math.max(...per) / N_SEEDS);
    if (!QUIET) console.log(`${d.id.padEnd(18)}${d.tier}  ${per.map((n) => pctOf(n).padStart(9)).join('')}   ${career.has(d.id) ? ' ○ ' : ' · '}  ${d.hidden ? '🔒' : ''}${d.title} — ${d.desc}`);
  }
}
console.log('\n난이도별 평균 달성률(가장 잘한 봇 기준): ' + [1, 2, 3, 4].map((t) => `tier${t} ${Math.round((tierRate[t].reduce((a, b) => a + b, 0) / Math.max(1, tierRate[t].length)) * 100)}%`).join(' · '));
console.log(`봇이 닿은 최대치: 현금 ${Math.round(top.cash / 10000)}억 · 시즌 영업 흑자 ${Math.round(top.profit / 10000)}억 · 팬 ${Math.round(top.fans)} · 한 경기 관중 ${top.att} · 별 ${top.stars} · 오버롤 ${top.ovr} · 주전 최저 오버롤 ${top.lineupMin} · 포스트시즌 진출 때 연봉 순위(가장 낮았던) ${top.payRankAtPost}위`);
console.log(`봇 4종이 한 번도 달성하지 못한 것 ${never.length}개 (✓ = 사람 흉내 탐침으로 달성 확인):`);
for (const id of never) {
  const d = ACHV_LIST.find((x) => x.id === id)!;
  console.log(`  ${probed.includes(id) ? '✓' : ' '} ${id.padEnd(18)} T${d.tier} ${d.title} — ${d.desc}`);
  console.log(`      봇은 못 하지만 사람은 가능: ${WHY[id] ?? '사유 미기재 — 조건을 다시 확인할 것'}`);
  // 짧게 돌린 점검에서는 못 닿는 것이 당연히 많다 — 기준 규모(6 시드 × 12 시즌) 이상에서만 사유 누락을 문제로 본다
  if (!WHY[id] && N_SEEDS >= 6 && N_SEASONS >= 12) bad.push(`봇 달성 0% 인데 사유가 없다: ${id}`);
}
if (process.argv.includes('--md')) {
  // docs/ACHIEVEMENTS.md: 전체 목록 (id · 제목 · 조건) + 봇 달성률
  const TIER = ['', '쉬움', '보통', '어려움', '매우 어려움'];
  const L: string[] = ['# 도전과제 200개', '', '`npm run achv -- 6 12 --md` 가 만든 문서다. 손으로 고치지 말고 `src/game/achievementList*.ts` 를 고친 뒤 다시 만든다.', ''];
  L.push('- 저장: 세이브와 독립된 localStorage 키 `kbl-achv-v1` (달성 id → 날짜, 누적 카운터). 새로하기·세이브 지우기에도 남고, 설정의 "도전과제도 지우기"로만 지운다.');
  L.push('- 보상은 없다. 게임 수치를 바꾸지 않고 상태 변화와 경기 기록을 관찰만 한다 (`src/game/achievements.ts`).');
  L.push(`- 난이도: ${[1, 2, 3, 4].map((t) => `${TIER[t]} ${ACHV_LIST.filter((d) => d.tier === t).length}`).join(' · ')} · 숨김 ${hidden}개 (🔒 — 달성 전에는 제목 "???" 와 힌트만 보인다)`);
  L.push(`- 달성률: 봇 4종(${BOTS.map((b) => b.name).join(' · ')}) × ${N_SEEDS} 시드 × ${N_SEASONS} 시즌에서 그 도전과제를 달성한 구단의 비율 가운데 가장 높은 봇의 값. "누적"은 봇별로 ${N_SEEDS}개 구단을 이어서 본 결과. "탐침"은 봇이 하지 않는 조작을 스크립트가 일부러 해서 확인한 것.`, '');
  for (const k of ACHV_CATS) {
    const ds = ACHV_LIST.filter((x) => x.cat === k.id);
    L.push(`## ${k.icon} ${k.name} (${ds.length})`, '', '| id | 제목 | 조건 | 난이도 | 봇 달성률 |', '|---|---|---|---|---|');
    for (const d of ds) {
      const best = Math.max(...BOTS.map((b) => rate[d.id]?.[b.name] ?? 0));
      const r = best > 0 ? `${Math.round((best / N_SEEDS) * 100)}%` : career.has(d.id) ? '누적' : probed.includes(d.id) ? '탐침' : '0%';
      L.push(`| \`${d.id}\` | ${d.hidden ? '🔒 ' : ''}${d.icon} ${d.title} | ${d.desc}${d.hidden ? `<br>힌트: ${d.hidden}` : ''} | ${TIER[d.tier]} | ${r} |`);
    }
    L.push('');
  }
  L.push(`## 봇이 한 번도 달성하지 못한 것 (${never.length})`, '', '| id | 제목 | 봇은 못 하지만 사람은 가능: 이유 |', '|---|---|---|');
  for (const id of never) L.push(`| \`${id}\` | ${ACHV_LIST.find((x) => x.id === id)!.title} | ${WHY[id] ?? '—'} |`);
  L.push('');
  writeFileSync(new URL('../docs/ACHIEVEMENTS.md', import.meta.url), L.join('\n'));
  console.log('docs/ACHIEVEMENTS.md 저장');
}
if (bad.length) {
  console.log(`\n!! 문제 ${bad.length}건`);
  for (const b of bad.slice(0, 40)) console.log('  ' + b);
  process.exitCode = 1;
} else console.log('\n목록 검사·판정 예외 0건');
