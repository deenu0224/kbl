import type { Core, Team } from './types';
import { mulberry32 } from './rng';
import { playGame } from './season';
import { postMatch } from './postseason';
import { bullpenLoad } from './fixes';
import type { PenStyle } from './sim';

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
  return `${core.seed}/${core.season}/${core.phase}/${core.day}/${core.campaign?.penStyle ?? ''}/${side(home)}/${side(away)}`;
}

const cache = new Map<string, number>();
const CACHE_MAX = 64;

/**
 * 다음 유저 경기의 승리 확률(0~1, 무승부는 0.5). 두 팀을 복제해 n 번 시뮬한다 —
 * 원본 core 는 건드리지 않는다(스탯·부상·다음 선발·연투 전부 복제본에서만).
 * 난수는 경기 번호별로 고정해 같은 편성이면 같은 값이 나온다.
 */
export function winChance(core: Core, n = 120): number {
  const job = winChanceJob(core, n);
  let v = job(n);
  while (v === null) v = job(n);
  return v;
}

/**
 * winChance 를 나눠서 돌린다 (화면이 끊기지 않게): 부를 때마다 최대 k 경기를 시뮬하고,
 * n 경기를 다 채우면 확률을, 아직이면 null 을 돌려준다. 결과는 한 번에 돌린 것과 같다.
 */
export function winChanceJob(core: Core, n = 120): (k: number) => number | null {
  const g = nextGame(core);
  if (!g || n <= 0) return () => 0.5;
  const key = `${n}/${lineupKey(core, g.home, g.away)}`;
  const hit = cache.get(key);
  if (hit !== undefined) return () => hit;
  // playGame 이 고정 출전 메모를 캠페인에 적으므로 캠페인도 복제본을 넘긴다
  const shell: Core = { ...core, campaign: structuredClone(core.campaign) };
  // 경기 번호별로 난수를 고정한다(편성과 무관) — 편성을 바꿔도 같은 운으로 비교해 수리 전후의 표본 오차를 줄인다
  const base = `${core.seed}/${core.season}/${core.phase}/${core.day}`;
  const userHome = g.home.id === core.userId;
  let pts = 0;
  let i = 0;
  return (k) => {
    for (const end = Math.min(n, i + k); i < end; i++) {
      const res = playGame(shell, structuredClone(g.home), structuredClone(g.away), mulberry32(hash(`${base}/${i}`)), false);
      const mine = userHome ? res.home : res.away;
      const theirs = userHome ? res.away : res.home;
      pts += mine > theirs ? 1 : mine === theirs ? 0.5 : 0;
    }
    if (i < n) return null;
    const v = pts / n;
    if (!cache.has(key) && cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
    cache.set(key, v);
    return v;
  };
}

// ───────── 불펜 운영 방침 미리 보기 ─────────

export interface PenForecast {
  win: number; // 승률 0~1 (무승부 0.5)
  ra: number; // 경기당 실점
  spIp: number; // 선발 평균 이닝
  relief: number; // 경기당 구원 등판 수
  over: number; // 불펜 과부하로 맞은 경기의 비율 0~1
}

export const PEN_OVER_RISK = 0.25; // 과부하 비율이 이 이상이면 위험 표시

const penCache = new Map<string, PenForecast>();

/**
 * 유저 팀이 지금 로스터·오더로 방침 style 을 쓸 때의 예상. 다음 12경기의 실제 상대를 돌아가며 n 경기를
 * 이어서 치러 연투가 쌓이게 한다 (상대는 매 경기 쉰 상태, 유저 팀의 부상은 쌓지 않는다).
 * 원본 core 는 건드리지 않고, 난수는 경기 번호별로 고정해 세 방침을 같은 운에서 비교한다.
 * winChanceJob 처럼 나눠 돌린다: 부를 때마다 최대 k 경기, 다 채우기 전에는 null.
 */
export function penStyleJob(core: Core, style: PenStyle, n = 120): (k: number) => PenForecast | null {
  const me0 = core.teams.find((t) => t.id === core.userId);
  const none: PenForecast = { win: 0.5, ra: 0, spIp: 0, relief: 0, over: 0 };
  if (!me0 || n <= 0) return () => none;
  // 상대: 다음 12경기 일정 (없으면 나머지 구단 전부)
  const opps: { id: string; home: boolean }[] = [];
  if (core.phase === 'season') {
    for (let d = core.day; d < core.schedule.length && opps.length < 12; d++) {
      const m = core.schedule[d].find((g) => g.homeId === core.userId || g.awayId === core.userId);
      if (m) opps.push({ id: m.homeId === core.userId ? m.awayId : m.homeId, home: m.homeId === core.userId });
    }
  }
  if (!opps.length) core.teams.forEach((t, i) => t.id !== core.userId && opps.push({ id: t.id, home: i % 2 === 0 }));
  if (!opps.length) return () => none;
  const key = `${n}/${style}/${opps.map((o) => o.id).join(',')}/${lineupKey(core, me0, me0)}`;
  const hit = penCache.get(key);
  if (hit) return () => hit;
  const shell: Core = { ...core, campaign: { ...structuredClone(core.campaign), penStyle: style } };
  const base = `${core.seed}/${core.season}/${core.phase}/${core.day}/pen`;
  const me = structuredClone(me0);
  const inj0 = new Map(me.roster.map((p) => [p.id, p.injury]));
  const oppById = new Map(core.teams.map((t) => [t.id, t]));
  let pts = 0, ra = 0, spOuts = 0, relief = 0, over = 0;
  let i = 0;
  return (k) => {
    for (const end = Math.min(n, i + k); i < end; i++) {
      const o = opps[i % opps.length];
      const opp = structuredClone(oppById.get(o.id)!);
      for (const p of opp.roster) delete p.tired;
      if (bullpenLoad(me).label === '과부하') over++;
      const g0 = new Map(me.roster.filter((p) => p.kind === 'P').map((p) => [p.id, { g: p.pit.g, outs: p.pit.outs }]));
      const res = o.home ? playGame(shell, me, opp, mulberry32(hash(`${base}/${i}`)), false) : playGame(shell, opp, me, mulberry32(hash(`${base}/${i}`)), false);
      const mine = o.home ? res.home : res.away;
      const theirs = o.home ? res.away : res.home;
      pts += mine > theirs ? 1 : mine === theirs ? 0.5 : 0;
      ra += theirs;
      const sid = res.starters[o.home ? 1 : 0];
      for (const p of me.roster) {
        const b = g0.get(p.id);
        if (b && p.pit.g > b.g) {
          if (p.id === sid) spOuts += p.pit.outs - b.outs;
          else relief++;
        }
        p.injury = inj0.get(p.id) ?? 0;
      }
    }
    if (i < n) return null;
    const v: PenForecast = { win: pts / n, ra: ra / n, spIp: spOuts / n / 3, relief: relief / n, over: over / n };
    if (penCache.size >= CACHE_MAX) penCache.delete(penCache.keys().next().value!);
    penCache.set(key, v);
    return v;
  };
}
