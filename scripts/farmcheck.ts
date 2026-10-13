// 2군 자동 운영·2군 사건 불변식 점검. 실행: npx tsx scripts/farmcheck.ts [시드 수] [시즌 수]
// sensible 봇으로 돌리면서 매 경기 후 로스터 정합성(정원·중복·입대 선수 분리·전향 페널티 복구)을 확인하고, 사건 선택지를 번갈아 골라 본다.
import type { Core } from '../src/game/types';
import { mulberry32 } from '../src/game/rng';
import { newCore } from '../src/game/generate';
import { advanceDay, nextSeason } from '../src/game/season';
import { FARM_MAX, ROSTER_MAX, activeRoster, awaySupport, farmRoster, payroll, userTeam } from '../src/game/economy';
import { ensureObjectives } from '../src/game/campaign';
import { maybeDrawEvent, resolveEvent } from '../src/game/events';
import { closeBriefing, drawBriefing } from '../src/game/briefing';
import { beginDraft, draftPick, draftSkip, isDraftDone } from '../src/game/draft';
import { drawResign } from '../src/game/contract';
import { setFarmAuto } from '../src/game/farm';
import { sensible } from './bots';

const N_SEEDS = Number(process.argv[2]) || 6;
const N_SEASONS = Number(process.argv[3]) || 8;
const bad: string[] = [];
const seen: Record<string, number[]> = {};
let maxAct = 0;
let maxFarm = 0;

function check(c: Core, where: string): void {
  const t = userTeam(c);
  const ids = t.roster.map((p) => p.id);
  const fail = (m: string) => bad.push(`s${c.season} d${c.day} ${where}: ${m}`);
  if (new Set(ids).size !== ids.length) fail('로스터 중복');
  maxAct = Math.max(maxAct, activeRoster(t).length);
  maxFarm = Math.max(maxFarm, farmRoster(t).length);
  if (activeRoster(t).length > ROSTER_MAX) fail(`1군 ${activeRoster(t).length}명`);
  if (farmRoster(t).length > FARM_MAX + 1) fail(`2군 ${farmRoster(t).length}명`);
  for (const p of t.roster) {
    if (p.away) fail(`${p.name}: 입대 중인데 로스터에 있음`);
    if (p.farm && p.subFor) fail(`${p.name}: 2군인데 subFor`);
    if (p.subFor && !t.roster.some((x) => x.id === p.subFor)) fail(`${p.name}: subFor 대상 없음`);
    if (!Number.isFinite(p.ovr) || p.def > 99 || (p.kind === 'B' && p.def < 20)) fail(`${p.name}: 능력치 이상`);
  }
  for (const p of c.campaign.away ?? []) {
    if (!p.away) fail(`${p.name}: away 목록인데 표시 없음`);
    if (ids.includes(p.id)) fail(`${p.name}: 입대 선수가 로스터에도 있음`);
  }
  const inLu = t.lineup.map((s) => s.pid);
  for (const id of [...inLu, ...t.rotation, ...t.bullpen, ...(t.closer ? [t.closer] : [])]) {
    const p = t.roster.find((x) => x.id === id);
    if (!p) fail(`편성에 없는 선수 ${id}`);
    else if (p.farm) fail(`${p.name}: 2군인데 편성에 있음`);
  }
  if (!Number.isFinite(payroll(t))) fail('연봉 총액 이상');
}

for (let seed = 1; seed <= N_SEEDS; seed++) {
  const rng = mulberry32(seed * 31 + 7);
  let c = ensureObjectives(newCore(seed), rng);
  if (seed % 3 === 0) c = setFarmAuto(c, false); // 세 번에 한 번은 자동 운영을 끄고 돈다
  let turn = seed;
  for (let s = 1; s <= N_SEASONS && c.phase !== 'over'; s++) {
    c = sensible.preseason(c);
    for (let g = 0; (c.phase === 'season' || c.phase === 'post') && g < 400; g++) {
      if (c.campaign.event) {
        const card = c.campaign.event;
        const id = card.id.split('|')[0];
        let i = sensible.event(c, card);
        if (id.startsWith('f-')) {
          // 2군 사건은 두 선택지를 번갈아 고른다
          i = turn++ % 2;
          if (card.choices[i]?.disabled) i = 1 - i;
          (seen[id] ??= [0, 0])[i]++;
          if (!card.who || !card.line || card.choices.some((ch) => !ch.desc)) bad.push(`${id}: 인물·대사·결과 숫자 누락`);
        }
        const r = resolveEvent(c, i, rng);
        if (r.error) bad.push(`${card.id}: ${r.error}`);
        c = r.core;
        check(c, `사건 ${id}[${i}]`);
        continue;
      }
      if (c.campaign.briefing) {
        c = closeBriefing(c);
        continue;
      }
      if (c.phase === 'season') c = sensible.daily(c);
      c = drawBriefing(maybeDrawEvent(advanceDay(c, rng).core, rng));
      check(c, '경기 후');
    }
    if (c.phase === 'over' || s === N_SEASONS) break;
    c = drawResign(c);
    while (c.campaign.event) c = resolveEvent(c, sensible.event(c, c.campaign.event), rng).core;
    c = sensible.beforeDraft(c);
    c = beginDraft(c, rng).core;
    for (let g = 0; !isDraftDone(c) && g < 10; g++) {
      const pid = sensible.draft(c);
      const r = pid ? draftPick(c, pid, rng) : draftSkip(c, rng);
      c = r.error ? draftSkip(c, rng).core : r.core;
    }
    const away0 = (c.campaign.away ?? []).map((p) => `${p.name}(${p.age}세 OVR ${p.ovr}→복귀 ${p.away?.until})`);
    c = nextSeason(c, rng);
    check(c, '시즌 전환');
    if (seed === 1 && away0.length) console.log(`  seed1 s${c.season} 개막 · 입대 중이던 선수: ${away0.join(', ')} → 남은 ${c.campaign.away?.length ?? 0}명`);
  }
}
console.log(`\n2군 불변식 점검: ${N_SEEDS} 시드 × ${N_SEASONS} 시즌 · 1군 최대 ${maxAct}명 · 2군 최대 ${maxFarm}명`);
console.log(`사건별 선택 [첫째, 둘째]: ${Object.entries(seen).map(([k, v]) => `${k} ${v.join('/')}`).join(' · ')}`);
console.log(`원정 응원단 awaySupport: 팬 5천 ${awaySupport({ fans: 5000 })} · 1만 ${awaySupport({ fans: 10000 }).toFixed(3)} · 2만 ${awaySupport({ fans: 20000 }).toFixed(3)} · 3만 ${awaySupport({ fans: 30000 })} · 5만 ${awaySupport({ fans: 50000 })}`);
if (bad.length) {
  console.log(`!! 위반 ${bad.length}건`);
  for (const b of bad.slice(0, 25)) console.log('  ' + b);
  process.exitCode = 1;
} else console.log('위반 0건');
