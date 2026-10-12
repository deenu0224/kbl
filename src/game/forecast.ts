import type { Core, Team } from './types';
import { mulberry32 } from './rng';
import { playGame } from './season';
import { postMatch } from './postseason';

/** 다음 유저 경기의 두 팀 (정규시즌은 오늘 대진, 포스트시즌은 다음 시리즈 경기) */
function nextGame(core: Core): { home: Team; away: Team } | null {
  let homeId: string | undefined;
  let awayId: string | undefined;
  if (core.phase === 'post' && core.post) {
    const m = postMatch(core);
    if (m) [homeId, awayId] = m.isHome ? [core.userId, m.oppId] : [m.oppId, core.userId];
  } else if (core.phase === 'season') {
    const m = core.schedule[core.day]?.find((g) => g.homeId === core.userId || g.awayId === core.userId);
    if (m) [homeId, awayId] = [m.homeId, m.awayId];
  }
  const home = core.teams.find((t) => t.id === homeId);
  const away = core.teams.find((t) => t.id === awayId);
  return home && away ? { home, away } : null;
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** 편성(타순·수비 위치·보직·다음 선발)과 선수 상태가 같으면 같은 값 */
function lineupKey(core: Core, home: Team, away: Team): string {
  const side = (t: Team) =>
    [
      t.id,
      t.lineup.map((l) => `${l.pid}:${l.pos}`).join(','),
      t.rotation.join(','),
      t.bullpen.join(','),
      t.closer ?? '',
      t.nextStarter,
      t.roster.map((p) => `${p.id}${p.ovr}${p.injury ? `i${p.injury}` : ''}${p.tired ? `t${p.tired}` : ''}`).join(','),
    ].join('|');
  return `${core.seed}/${core.season}/${core.phase}/${core.day}/${side(home)}/${side(away)}`;
}

const cache = new Map<string, number>();
const CACHE_MAX = 64;

/**
 * 다음 유저 경기의 승리 확률(0~1, 무승부는 0.5). 두 팀을 복제해 n 번 시뮬한다 —
 * 원본 core 는 건드리지 않는다(스탯·부상·다음 선발·연투 전부 복제본에서만).
 * 난수는 편성 해시로 고정해 같은 편성이면 같은 값이 나온다.
 */
export function winChance(core: Core, n = 120): number {
  const g = nextGame(core);
  if (!g || n <= 0) return 0.5;
  const key = `${n}/${lineupKey(core, g.home, g.away)}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  // playGame 이 고정 출전 메모를 캠페인에 적으므로 캠페인도 복제본을 넘긴다
  const shell: Core = { ...core, campaign: structuredClone(core.campaign) };
  const rng = mulberry32(hash(key));
  const userHome = g.home.id === core.userId;
  let pts = 0;
  for (let i = 0; i < n; i++) {
    const res = playGame(shell, structuredClone(g.home), structuredClone(g.away), rng, false);
    const mine = userHome ? res.home : res.away;
    const theirs = userHome ? res.away : res.home;
    pts += mine > theirs ? 1 : mine === theirs ? 0.5 : 0;
  }
  const v = pts / n;
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
  cache.set(key, v);
  return v;
}
