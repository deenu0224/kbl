// 시즌 대본 (docs/LEVEL_DESIGN.md 3절): 구간(Beat)을 깔고, 일정·날씨·사건을 그 구간에 맞춘다.
// 구간 이름(기승전결)은 유저에게 보이지 않고, label 이 있는 구간만 일정표의 예보로 보인다.
import type { Beat, Core, Player, Weather } from './types';
import { clamp, randInt, type Rng } from './rng';
import { calcOvr, calcSalary, teamStrength } from './ratings';
import { breakLineup, fixLineup } from './lineup';
import { payroll, userTeam } from './economy';
import { genPlayer, makeCtx } from './generate';
import { addNews, standings } from './season';
import { shiftOvr } from './draft';
import { hintMut } from './campaign';
import { memoSet } from './memo';
import { NEWS, openingLine } from './story';

// ───────── 튜닝 상수 ─────────

export const MID_DAY = 42; // 중간 점검 (이 경기 수를 치른 직후)
export const JEON_FIX_DAY = 42; // 전 구간의 순위 연동 일정을 확정하는 시점
export const GYEOL_FIX_DAY = 60; // 결 구간의 순위 연동 일정을 확정하는 시점
export const FORECAST_LEAD = 6; // 구간 시작 몇 경기 전에 예보가 뜨는가
export const RAIN_BASE = 0.15; // 평소 비 확률
export const RAIN_RAINY = 0.6; // 장마 구간 비 확률
export const JETLAG_GAMES = 6; // 원정 연속 이 경기 수 뒤 첫 홈경기
export const JETLAG_FOCUS = -2; // 그 경기의 팀 컨디션
const SERIES = 3;
const OPENING_SUNNY = 3; // 개막 홈 3연전은 날씨 맑음 고정
const KI_BLOCKS = 4; // 0장 기 구간: 첫 12경기(3연전 4번)
const FA_DROUGHT_PRICE = 1.3; // 2장: 준척 FA 몸값
const GEN_DROP: [number, number] = [4, 6]; // 세대교체: 능력치 하락 폭
const GEN_DROP_MILD: [number, number] = [2, 3];
const GEN_AGE = 33;
const ACE_OUT = 10; // 에이스 이탈 결장 경기
const ACE_OUT_MILD = 5;
const SCOUT_FAME_STAR: [number, number] = [62, 74];
const SCOUT_FAME_SALARY_OVR = 8; // 옛 명성: 실제 OVR 보다 이만큼 높은 선수의 연봉을 받는다

type Rank = 'top' | 'bottom' | 'mid';
interface SeriesWant {
  rank: Rank | null; // 상대의 순위대
  venue: 'home' | 'away' | null;
}
// 6연전을 일정에 박아 넣는 구간
const SERIES_BEATS: Record<string, SeriesWant> = {
  'road-trip': { rank: 'top', venue: 'away' },
  'rivals-low': { rank: 'bottom', venue: null },
  'rivals-mid': { rank: 'mid', venue: null },
  'rivals-top': { rank: 'top', venue: null },
  'home-stand': { rank: null, venue: 'home' },
};

const B = (id: string, part: Beat['part'], from: number, to: number, label?: string, icon?: string): Beat => ({
  id, part, from, to, ...(label ? { label } : {}), ...(icon ? { icon } : {}),
});

/** 이번 시즌의 대본. 장마다 기·승·(중간 점검)·전·결. */
export function buildBeats(stage: number, _core: Core, rng: Rng): Beat[] {
  const mid = B('midcheck', 'mid', MID_DAY, MID_DAY);
  switch (stage) {
    case 0:
      return [
        B('broken-lineup', 'ki', 0, 11),
        B('scout-list', 'seung', 12, 41),
        mid,
        B('road-trip', 'jeon', 48, 53, '죽음의 원정 6연전', '✈️'),
        B('rivals-low', 'gyeol', 78, 83, '꼴찌 직접 대결 6연전', '⚔️'),
      ];
    case 1:
      return [
        B('opening-home', 'ki', 0, 11),
        B('crowds', 'seung', 12, 41),
        mid,
        B('rainy', 'jeon', 48, 59, '장마 예보', '☔'),
        B('home-stand', 'gyeol', 78, 83, '시즌 마지막 홈 6연전', '🏟️'),
      ];
    case 2:
      return [
        B('rookie-camp', 'ki', 0, 11),
        B('fa-drought', 'seung', 12, 41),
        mid,
        B('gen-change', 'jeon', 48, 59),
        B('rivals-mid', 'gyeol', 78, 83, '가을야구 길목 6연전', '⚔️'),
      ];
    case 3:
      return [
        B('first-fatigue', 'ki', 0, 11),
        B('six-straight', 'seung', 12, 41),
        mid,
        B('ace-out', 'jeon', 48, 48 + ACE_OUT - 1),
        B('rivals-top', 'gyeol', 78, 83, '선두권 6연전', '⚔️'),
      ];
    case 4:
      // 앞의 네 "전"이 약하게 전부 온다 → 돔구장의 제안 → 한국시리즈
      return [
        B('road-trip', 'seung', 18, 23, '원정 6연전', '✈️'),
        B('gen-change', 'seung', 24, 29),
        B('rainy', 'seung', 30, 35, '장마 예보', '☔'),
        B('ace-out', 'seung', 36, 36 + ACE_OUT_MILD - 1),
        mid,
        B('dome', 'jeon', 48, 59),
      ];
    default: {
      // 왕조: 매 시즌 다른 조합 둘
      const jeon = rng() < 0.5 ? B('rainy', 'jeon', 48, 59, '장마 예보', '☔') : B('road-trip', 'jeon', 48, 53, '원정 6연전', '✈️');
      const gyeol = rng() < 0.5 ? B('rivals-top', 'gyeol', 78, 83, '선두권 6연전', '⚔️') : B('home-stand', 'gyeol', 78, 83, '시즌 마지막 홈 6연전', '🏟️');
      return [mid, jeon, gyeol];
    }
  }
}

// ───────── 조회 (UI·규칙 공용) ─────────

export function beatById(core: Core, id: string): Beat | undefined {
  return core.campaign.beats?.find((b) => b.id === id);
}

/** 그 경기일에 걸친 구간 중 id 가 맞는 것 */
export function beatOn(core: Core, day: number, id: string): Beat | undefined {
  return core.campaign.beats?.find((b) => b.id === id && day >= b.from && day <= b.to);
}

/** 그 경기일의 예보(일정표 표시용): label 이 있는 구간만 */
export function forecastOn(core: Core, day: number): Beat | undefined {
  return core.campaign.beats?.find((b) => !!b.label && day >= b.from && day <= b.to);
}

/** 다가오는 예보 (오늘 포함, 시작이 lead 경기 이내이거나 진행 중인 구간) */
export function upcomingForecasts(core: Core, lead = 12): Beat[] {
  return (core.campaign.beats ?? []).filter((b) => !!b.label && b.to >= core.day && b.from - core.day <= lead);
}

function userGame(core: Core, day: number): { oppId: string; home: boolean } | null {
  const m = core.schedule[day]?.find((g) => g.homeId === core.userId || g.awayId === core.userId);
  if (!m) return null;
  const home = m.homeId === core.userId;
  return { oppId: home ? m.awayId : m.homeId, home };
}

/** 유저 홈경기의 경기일 목록 (attHistory 와 같은 순서) */
export function userHomeDays(core: Core): number[] {
  const out: number[] = [];
  for (let d = 0; d < core.schedule.length; d++) if (userGame(core, d)?.home) out.push(d);
  return out;
}

/** 섬 팀: 원정 6연전 뒤 첫 홈경기인가 (일정표에 보인다) */
export function jetLag(core: Core, day: number): boolean {
  if (day < JETLAG_GAMES || !userGame(core, day)?.home) return false;
  for (let d = day - JETLAG_GAMES; d < day; d++) if (userGame(core, d)?.home !== false) return false;
  return true;
}

/** 그 경기일의 날씨. 장마 구간은 비 확률이 뛴다. */
export function weatherFor(core: Core, day: number, rng: Rng): Weather {
  const x = rng();
  // 개막 홈 3연전은 맑다 (정식 규칙)
  if (day < OPENING_SUNNY && userGame(core, day)?.home) return 'sunny';
  const rain = beatOn(core, day, 'rainy') ? RAIN_RAINY : RAIN_BASE;
  if (x < rain) return 'rain';
  return x < rain + (1 - rain) * 0.3 ? 'cloudy' : 'sunny';
}

// ───────── 일정 재배열: 3연전 블록을 통째로 맞바꾼다 (팀별 홈/원정 수는 그대로) ─────────

function swapBlocks(core: Core, a: number, b: number): void {
  if (a === b) return;
  for (let k = 0; k < SERIES; k++) {
    const i = a * SERIES + k;
    const j = b * SERIES + k;
    [core.schedule[i], core.schedule[j]] = [core.schedule[j], core.schedule[i]];
  }
}

/** 상대 선호 순서. projected = 개막 전(전력 기준), 아니면 현재 순위 기준 */
function opponentOrder(core: Core, rank: Rank, projected: boolean): string[] {
  const all = projected ? core.teams.slice().sort((a, b) => teamStrength(b) - teamStrength(a) || (a.id < b.id ? -1 : 1)) : standings(core.teams);
  const others = all.map((t, i) => ({ id: t.id, pos: i + 1 })).filter((x) => x.id !== core.userId);
  if (rank === 'top') return others.map((x) => x.id);
  if (rank === 'bottom') return others.reverse().map((x) => x.id);
  return others.sort((a, b) => Math.abs(a.pos - 4.5) - Math.abs(b.pos - 4.5)).map((x) => x.id);
}

/**
 * 구간의 6연전(3연전 블록 2개)을 조건에 맞게 채운다. 남은 일정(firstFree 블록 이후) 안에서만 교환한다.
 * 반환: 두 시리즈의 상대 teamId.
 */
function arrangeSeries(core: Core, beat: Beat, projected: boolean): string[] {
  const want = SERIES_BEATS[beat.id];
  if (!want) return [];
  const nBlocks = Math.floor(core.schedule.length / SERIES);
  const firstFree = Math.ceil(core.day / SERIES);
  const b0 = Math.floor(beat.from / SERIES);
  const targets = [b0, b0 + 1].filter((b) => b < nBlocks && b >= firstFree);
  // 다른 6연전 구간의 블록은 건드리지 않는다
  const locked = new Set<number>();
  if (projected) for (let b = 0; b < openingBlocks(core); b++) locked.add(b);
  for (const o of core.campaign.beats ?? []) {
    if (o === beat || !SERIES_BEATS[o.id]) continue;
    const ob = Math.floor(o.from / SERIES);
    locked.add(ob);
    locked.add(ob + 1);
  }
  const prefs: (string | null)[] = want.rank ? opponentOrder(core, want.rank, projected) : [null];
  const usedOpp = new Set<string>();
  const out: string[] = [];
  for (const tb of targets) {
    const fits = (block: number, opp: string | null): boolean => {
      const g = userGame(core, block * SERIES);
      if (!g) return false;
      if (opp && g.oppId !== opp) return false;
      if (want.venue && g.home !== (want.venue === 'home')) return false;
      return true;
    };
    let done = false;
    for (const opp of prefs) {
      if (opp && usedOpp.has(opp)) continue;
      let src = -1;
      if (fits(tb, opp)) src = tb;
      else {
        for (let b = firstFree; b < nBlocks; b++) {
          if (b === tb || locked.has(b) || !fits(b, opp)) continue;
          src = b;
          break;
        }
      }
      if (src < 0) continue;
      swapBlocks(core, src, tb);
      done = true;
      break;
    }
    locked.add(tb);
    const g = userGame(core, tb * SERIES);
    if (g) {
      usedOpp.add(g.oppId);
      if (done) out.push(g.oppId);
    }
  }
  return out;
}

/** 개막 전에 이미 자리가 정해진 앞쪽 블록 수 (개막 홈 3연전, 0장은 기 구간 4연속 시리즈) */
function openingBlocks(core: Core): number {
  return beatById(core, 'broken-lineup') ? KI_BLOCKS : 1;
}

/**
 * 개막 일정. 매 시즌 개막 3연전은 홈이다.
 * 0장의 기 구간(0~11경기)은 전력 하위 두 구단과의 3연전 4번: 홈 → 원정 → 홈 → 원정.
 */
function arrangeOpening(core: Core): void {
  const nBlocks = Math.floor(core.schedule.length / SERIES);
  const place = (tb: number, home: boolean, opp: string | null): boolean => {
    for (let b = tb; b < nBlocks; b++) {
      const g = userGame(core, b * SERIES);
      if (!g || g.home !== home || (opp && g.oppId !== opp)) continue;
      swapBlocks(core, b, tb);
      return true;
    }
    return false;
  };
  if (!beatById(core, 'broken-lineup')) {
    place(0, true, null);
    return;
  }
  const [a, b] = opponentOrder(core, 'bottom', true);
  const plan: [boolean, string][] = [[true, a], [false, a], [true, a], [false, b]];
  plan.forEach(([home, opp], i) => place(i, home, opp) || place(i, home, null));
}

// ───────── 구간 효과 ─────────

type AbilKey = 'con' | 'pow' | 'eye' | 'spd' | 'def' | 'stf' | 'ctl' | 'sta';
const keysOf = (p: Player): AbilKey[] => (p.kind === 'B' ? ['con', 'pow', 'eye', 'spd', 'def'] : ['stf', 'ctl', 'sta']);

export const POS_NAME: Record<string, string> = { SP: '선발', RP: '불펜', CP: '마무리', C: '포수', '1B': '1루수', '2B': '2루수', '3B': '3루수', SS: '유격수', LF: '좌익수', CF: '중견수', RF: '우익수', DH: '지명타자' };

/** 0장 승: 스카우트 팀장의 명단 — 최약 포지션 후보 3명을 FA 풀에 올린다. 1명은 옛 명성만 높다. */
function scoutListMut(core: Core, rng: Rng): void {
  const t = userTeam(core);
  const byId = new Map(t.roster.map((p) => [p.id, p]));
  const slots = t.lineup.filter((s) => s.pos !== 'DH' && byId.has(s.pid));
  if (!slots.length) return;
  const weak = slots.reduce((a, b) => (byId.get(a.pid)!.ovr <= byId.get(b.pid)!.ovr ? a : b));
  const inc = byId.get(weak.pid)!.ovr;
  const names = [...core.teams.flatMap((x) => x.roster.map((p) => p.name)), ...core.freeAgents.map((p) => p.name)];
  const ctx = makeCtx(rng, `sc${core.season}-`, names);

  // 팀장이 고른 선수: 이름값은 높고 몸은 내리막
  const fame = genPlayer(ctx, weak.pos, inc, { age: randInt(rng, 34, 36), tag: '옛 명성 · 하락세' });
  shiftOvr(fame, clamp(inc + 1, 50, 62));
  fame.pot = fame.ovr;
  fame.star = randInt(rng, SCOUT_FAME_STAR[0], SCOUT_FAME_STAR[1]);
  fame.salary = calcSalary({ ...fame, ovr: fame.ovr + SCOUT_FAME_SALARY_OVR });
  // 견실한 준척
  const solid = genPlayer(ctx, weak.pos, inc, { age: randInt(rng, 26, 29), tag: '스카우트 명단 · 견실' });
  shiftOvr(solid, clamp(inc + 10, 62, 70));
  solid.pot = Math.max(solid.pot, solid.ovr);
  solid.salary = calcSalary(solid);
  solid.star = clamp(solid.star, 0, 40);
  // 미완의 젊은 선수
  const young = genPlayer(ctx, weak.pos, inc, { age: randInt(rng, 22, 23), tag: '스카우트 명단 · 미완' });
  shiftOvr(young, clamp(inc + 4, 55, 64));
  young.pot = clamp(young.ovr + randInt(rng, 9, 14), young.ovr, 95);
  young.salary = calcSalary(young);
  young.star = clamp(young.star, 0, 35);

  core.freeAgents.unshift(fame, solid, young);
  memoSet(core, 'scoutPick', fame.id);
  memoSet(core, 'scoutList', [fame.id, solid.id, young.id].join(','));
  addNews(core, NEWS.scoutList(POS_NAME[weak.pos] ?? weak.pos), 'info');
  hintMut(core, 'market');
}

/** 세대교체: 33세 이상 주전 n명의 능력치가 급락한다 */
function genChangeMut(core: Core, rng: Rng, n: number, drop: [number, number]): void {
  const t = userTeam(core);
  const ids = new Set([...t.lineup.map((s) => s.pid), ...t.rotation, ...(t.closer ? [t.closer] : [])]);
  const vets = t.roster.filter((p) => ids.has(p.id) && p.age >= GEN_AGE).sort((a, b) => b.ovr - a.ovr || b.age - a.age).slice(0, n);
  memoSet(core, 'lu48', t.lineup.map((s) => s.pid).join(','));
  if (!vets.length) return;
  for (const p of vets) {
    for (const k of keysOf(p)) p[k] = clamp(p[k] - randInt(rng, drop[0], drop[1]), 20, 99);
    p.ovr = calcOvr(p);
  }
  addNews(core, NEWS.genChange(vets.map((p) => `${p.name}(${p.age}세)`).join(', ')), 'bad');
  hintMut(core, vets.some((p) => p.kind === 'B') ? 'lineup' : 'pitchers');
}

/** 에이스 이탈: 1선발 결장 */
function aceOutMut(core: Core, games: number): void {
  const t = userTeam(core);
  const rot = t.rotation.map((id) => t.roster.find((p) => p.id === id)).filter((p): p is Player => !!p && p.injury === 0);
  if (!rot.length) return;
  const ace = rot.reduce((a, b) => (a.ovr >= b.ovr ? a : b));
  ace.injury = games;
  addNews(core, NEWS.aceOut(ace.name, games), 'bad');
  hintMut(core, 'pitchers');
}

/** FA 가뭄: 스타 0, 준척 가격 +30% */
function faDroughtMut(core: Core): void {
  core.freeAgents = core.freeAgents.filter((p) => !(p.tag ?? '').startsWith('FA 대어'));
  // 준척도 절반만 시장에 나온다
  let k = 0;
  core.freeAgents = core.freeAgents.filter((p) => p.tag !== '준척급 FA' || k++ % 2 === 0);
  for (const p of core.freeAgents) if (p.tag === '준척급 FA') p.salary = Math.round((p.salary * FA_DROUGHT_PRICE) / 100) * 100;
  addNews(core, NEWS.faDrought, 'info');
}

// ───────── 시즌 시작 / 매 경기 후 ─────────

/** 시즌 대본을 깐다 (mutate). 새 게임·새 시즌의 첫 진행 때 한 번. 진행 중인 구 세이브는 구간만 깔고 개막 효과는 건너뛴다. */
export function startSeasonScriptMut(core: Core, rng: Rng): void {
  const c = core.campaign;
  const stage = clamp(c.stage, 0, 5);
  c.beats = buildBeats(stage, core, rng);
  c.hints = c.hints ?? {};
  const last = c.history[c.history.length - 1];
  const retry = !!last && last.stage === stage && !last.cleared;
  c.opening = openingLine(stage, retry, !!c.managerYielded).line;
  if (core.day !== 0) return;

  const t = userTeam(core);
  // 0장: 고장 난 타순 — 부임 첫 시즌에만. 재도전 때는 유저가 고쳐 둔 편성을 그대로 둔다
  if (stage === 0 && !c.managerYielded && c.history.length === 0) {
    breakLineup(t);
    fixLineup(t);
    addNews(core, NEWS.brokenLineup, 'info');
    hintMut(core, 'lineup');
    hintMut(core, 'pitchers');
  }
  if (beatById(core, 'fa-drought')) faDroughtMut(core);
  memoSet(core, 'pay0', payroll(t));
  // 일정: 6연전 구간을 개막 전 전력 기준으로 먼저 깔아 둔다 (순위 연동 구간은 시즌 중 확정)
  arrangeOpening(core);
  for (const b of c.beats) if (SERIES_BEATS[b.id]) arrangeSeries(core, b, true);
  if (core.season > 1) addNews(core, NEWS.fanLine(core.season), 'info');
}

/** 매 정규시즌 경기 후(core.day 는 다음 경기일) 대본을 한 칸 진행한다 (mutate) */
export function scriptTickMut(core: Core, rng: Rng): void {
  const c = core.campaign;
  const d = core.day;
  if (core.phase !== 'season' || !c.beats || d >= core.schedule.length) return;
  const name = (id: string) => core.teams.find((t) => t.id === id)?.name ?? id;

  for (const b of c.beats) {
    const want = SERIES_BEATS[b.id];
    // 순위 연동 6연전 확정
    if (want?.rank && ((b.part === 'jeon' && d === JEON_FIX_DAY) || (b.part === 'gyeol' && d === GYEOL_FIX_DAY))) {
      const opp = arrangeSeries(core, b, false);
      if (b.label && opp.length === 2) addNews(core, NEWS.fixture(b.label, name(opp[0]), name(opp[1])), 'info');
    }
    // 예보
    if (b.label && b.from - FORECAST_LEAD === d && d > 0) {
      addNews(core, NEWS.forecast(b.label, FORECAST_LEAD), 'info');
      hintMut(core, 'league');
    }
    if (b.from !== d) continue;
    // 구간 시작 효과
    switch (b.id) {
      case 'scout-list':
        scoutListMut(core, rng);
        break;
      case 'gen-change':
        if (b.part === 'jeon') genChangeMut(core, rng, 2, GEN_DROP);
        else genChangeMut(core, rng, 1, GEN_DROP_MILD);
        break;
      case 'ace-out':
        aceOutMut(core, b.to - b.from + 1);
        break;
      case 'rainy':
        addNews(core, NEWS.rainStart, 'info');
        break;
    }
  }
}
