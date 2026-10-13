// 일정 불변식 점검 (docs/TEN_TEAMS.md). 실행: npx tsx scripts/schedcheck.ts [시드 수=50]
// 10구단·8구단 각각: 모든 날 전 구단이 정확히 1경기 · 상대당 경기 수 균등 · 유저 홈 42 · 다른 구단 홈 39~42 ·
// 3연전이 같은 대진·같은 구장으로 이어짐 · 상대별 홈 3연전 수 차이 ≤ 1. 개막 직후(대본이 일정을 바꾼 뒤)와 2시즌째 일정도 본다.
import type { Core } from '../src/game/types';
import { mulberry32 } from '../src/game/rng';
import { newCore } from '../src/game/generate';
import { ensureObjectives } from '../src/game/campaign';
import { buildSchedule } from '../src/game/schedule';
import { SERIES_LEN, gamesFor } from '../src/game/league';

const N = Number(process.argv[2]) || 50;
const bad: string[] = [];
const homeDist: Record<string, Record<number, number>> = {};

function check(c: Pick<Core, 'teams' | 'schedule' | 'userId'>, tag: string): void {
  const ids = c.teams.map((t) => t.id);
  const n = ids.length;
  const fail = (m: string) => bad.push(`${tag}: ${m}`);
  if (c.schedule.length !== gamesFor(n)) fail(`시즌 ${c.schedule.length}경기 (기대 ${gamesFor(n)})`);
  const home: Record<string, number> = Object.fromEntries(ids.map((id) => [id, 0]));
  const vs: Record<string, number> = {};
  const hostSeries: Record<string, number> = {};
  c.schedule.forEach((day, d) => {
    const seen = day.flatMap((g) => [g.homeId, g.awayId]);
    if (day.length !== n / 2 || new Set(seen).size !== n || seen.some((id) => !ids.includes(id))) fail(`${d}일: 전 구단 1경기씩이 아님`);
    for (const g of day) {
      home[g.homeId]++;
      const k = [g.homeId, g.awayId].sort().join('-');
      vs[k] = (vs[k] ?? 0) + 1;
      if (d % SERIES_LEN === 0) hostSeries[`${g.homeId}>${g.awayId}`] = (hostSeries[`${g.homeId}>${g.awayId}`] ?? 0) + 1;
      else if (!c.schedule[d - 1].some((p) => p.homeId === g.homeId && p.awayId === g.awayId)) fail(`${d}일: 3연전이 이어지지 않음 ${g.awayId}@${g.homeId}`);
    }
  });
  const per = c.schedule.length / (n - 1);
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const k = [ids[i], ids[j]].sort().join('-');
    if (vs[k] !== per) fail(`${k} ${vs[k] ?? 0}경기 (기대 ${per})`);
    const a = hostSeries[`${ids[i]}>${ids[j]}`] ?? 0, b = hostSeries[`${ids[j]}>${ids[i]}`] ?? 0;
    if (Math.abs(a - b) > 1) fail(`${k} 홈 3연전 ${a}:${b}`);
  }
  if (home[c.userId] !== 42) fail(`유저 홈 ${home[c.userId]}경기 (기대 42)`);
  for (const id of ids) {
    if (home[id] < 39 || home[id] > 42) fail(`${id} 홈 ${home[id]}경기`);
    const d = (homeDist[`${n}구단 ${id === c.userId ? '유저' : '그 외'}`] ??= {});
    d[home[id]] = (d[home[id]] ?? 0) + 1;
  }
}

for (const teams of [10, 8]) {
  for (let seed = 1; seed <= N; seed++) {
    const raw = newCore(seed, { teams });
    check(raw, `${teams}구단 seed${seed} 생성 직후`);
    // 대본이 개막 일정·6연전을 옮긴 뒤에도 불변식이 유지되는가
    const c = ensureObjectives(raw, mulberry32(seed));
    check(c, `${teams}구단 seed${seed} 대본 배치 뒤`);
    // 다음 시즌 일정 (nextSeason 과 같은 호출)
    check({ ...c, schedule: buildSchedule(c.teams.map((t) => t.id), mulberry32(seed * 7 + 1), c.userId) }, `${teams}구단 seed${seed} 재생성`);
  }
}
for (const [k, d] of Object.entries(homeDist)) console.log(`${k} 홈경기 수 분포:`, Object.entries(d).map(([h, c]) => `${h}경기 ×${c}`).join(' · '));
console.log(bad.length ? `위반 ${bad.length}건\n${bad.slice(0, 30).join('\n')}` : `일정 불변식 위반 0건 (구단 수 2종 × 시드 ${N}개 × 일정 3종)`);
process.exit(bad.length ? 1 : 0);
