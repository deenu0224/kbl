// v3 규칙 점검: 대사 규칙(2문장·숫자 금지), 일정 재배열 불변식, 정지 사유, 구 세이브 마이그레이션.
// 실행: npm run verify
import { mulberry32 } from '../src/game/rng';
import { newCore } from '../src/game/generate';
import { advanceDay } from '../src/game/season';
import { ensureObjectives, stopReason, sceneExtras, ACHIEVEMENTS } from '../src/game/campaign';
import { maybeDrawEvent, resolveEvent, CARDS } from '../src/game/events';
import { CARD_LINES, STAGE_STORY, STAGE0_RETRY_YIELDED, SEASON_NAME_RULES, PREMISE_NEWS } from '../src/game/story';
import { forecastOn, jetLag, upcomingForecasts } from '../src/game/script';
import { migrateSave } from '../src/store';

// 1) 대사 규칙: 2문장 이하, 숫자 금지
const lines: string[] = [...Object.values(CARD_LINES).map((l) => l.line), STAGE0_RETRY_YIELDED.line];
for (const s of STAGE_STORY) lines.push(s.open.line, s.retry.line, s.clear.line, s.fail.line, s.midBehind, s.midAhead);
let bad = 0;
for (const l of lines) {
  const sentences = l.split(/[.!?]+/).filter((x) => x.trim()).length;
  if (/[0-9]/.test(l) || sentences > 2) { bad++; console.log('대사 규칙 위반:', l); }
}
console.log(`대사 ${lines.length}줄 검사 — 위반 ${bad} · 시즌 이름 규칙 ${SEASON_NAME_RULES.length}개 · 카드 ${CARDS.length}종 · 별 ${ACHIEVEMENTS.length}개`);
console.log('첫 뉴스:', PREMISE_NEWS.join(' / '), /창단/.test(PREMISE_NEWS.join('')) ? '!! 창단 문구' : '');

// 2) 일정 재배열 후 팀별 홈/원정 수·상대별 경기 수 불변
for (const seed of [1, 2, 3, 4, 5]) {
  const rng = mulberry32(seed);
  let c = ensureObjectives(newCore(seed), rng);
  const count = () => {
    const m: Record<string, number> = {};
    for (const d of c.schedule) for (const g of d) { m[g.homeId + ':H'] = (m[g.homeId + ':H'] ?? 0) + 1; m[g.homeId + '>' + g.awayId] = (m[g.homeId + '>' + g.awayId] ?? 0) + 1; }
    return JSON.stringify(Object.entries(m).sort());
  };
  const before = count();
  let stops: string[] = [];
  let cards: string[] = [];
  while (c.phase === 'season') {
    if (c.campaign.event) { cards.push(`${c.day}:${c.campaign.event.id.split('|')[0]}(${c.campaign.event.who ?? '-'})`); c = resolveEvent(c, 0, rng).core; continue; }
    const r = advanceDay(c, rng);
    c = maybeDrawEvent(r.core, rng);
    const why = stopReason(c, r.report);
    if (why && !c.campaign.event) stops.push(`${c.day}:${why}`);
  }
  const u = c.userId;
  const opp = (d: number) => { const g = c.schedule[d].find((x) => x.homeId === u || x.awayId === u)!; return (g.homeId === u ? 'vs ' : '@ ') + (g.homeId === u ? g.awayId : g.homeId); };
  console.log(`seed ${seed}: 일정 불변 ${before === count()} · 48~53 ${[48, 51].map(opp).join(', ')} · 78~83 ${[78, 81].map(opp).join(', ')}`);
  if (seed === 1) { console.log('  카드', cards.join(' ')); console.log('  정지', stops.join(' | ')); console.log('  예보(0일)', upcomingForecasts(ensureObjectives(newCore(1), rng), 84).map((b) => `${b.from}~${b.to} ${b.icon}${b.label}`).join(', ')); console.log('  scene', JSON.stringify(sceneExtras(c)), 'hints', JSON.stringify(c.campaign.hints), 'opening', c.campaign.opening, '/ 시즌 이름', c.campaign.history[0]?.name); }
  void forecastOn; void jetLag;
}
// 3) 구 세이브 마이그레이션
const old = newCore(9) as any;
old.campaign = { stage: 1, trust: 55, objectives: [{ id: 's1-main', kind: 'rank', main: true, text: 'x', target: 5, progress: 0, state: 'open', reward: { cash: 0, fans: 0, trust: 0 } }], achievements: ['first_win'], titles: 0, history: [], event: null, eventsSeen: ['sponsor'], buffs: [], sellouts: 3, ending: false, verdict: null };
old.day = 30;
const mig = migrateSave(old, 2);
console.log('마이그레이션:', mig.campaign.objectives.map((o) => o.id).join(','), 'beats', mig.campaign.beats?.length, 'ach', mig.campaign.achievements.length);
