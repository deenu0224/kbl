// 포스트시즌 (KBO 사다리식 8구단 축소판). docs/LEVEL_DESIGN.md 3절.
import type { BatStats, Core, Crowd, DayReport, GameEvent, GameResult, PitStats, PostFinish, PostRound, PostSeries, Postseason, Team } from './types';
import { clamp, gauss, randInt, type Rng } from './rng';
import { FOOD_LV, OPS_COST, SEAT_LV, TRAIN_LV, LOAN_RATE, MERCH_K, RAIN_FOOD, calcDemand, starPower, userTeam } from './economy';
import { fmtInt } from './format';
import { addNews, playGame, rankOf, rollWeather, settleCash, standings } from './season';
import { activeBuffs, concludeMut, refreshProgressMut, tickBuffs, checkAchievementsMut } from './campaign';

// ── 튜닝 상수 ──
export const POST_TEAMS = 4;
const ROUNDS: { round: PostRound; name: string; bestOf: number; hiHome: number[] }[] = [
  { round: 'SPO', name: '준플레이오프', bestOf: 3, hiHome: [0, 2] },
  { round: 'PO', name: '플레이오프', bestOf: 5, hiHome: [0, 1, 4] },
  { round: 'KS', name: '한국시리즈', bestOf: 7, hiHome: [0, 1, 5, 6] },
];
const DEMAND_MULT: Record<PostRound, number> = { SPO: 1.25, PO: 1.4, KS: 1.6 };
const TICKET_MULT = 1.5; // 정산 가격 배율 (표시가와 별개)
const POST_DOW = 4; // 수요 계산용 요일 (토요일급 열기)
const NOISE_SD = 0.05;
const MAX_EXTRA = 15; // 연장 최대 이닝 (표시용)
const TIE_RESIM = 4;
const HOME_TIE_EDGE = 0.52;
const FAN_POST_WIN = 60;
const FAN_POST_LOSS = -10;
const FAN_SERIES_WIN = 300;
const FAN_CHAMPION = 1200;

const need = (s: PostSeries) => Math.floor(s.bestOf / 2) + 1;
const done = (s: PostSeries) => s.winnerId !== null;

export function startPostMut(core: Core): void {
  const seeds = standings(core.teams)
    .slice(0, POST_TEAMS)
    .map((t) => t.id);
  const series: PostSeries[] = ROUNDS.map((r, i) => ({
    round: r.round,
    name: r.name,
    hiId: seeds[POST_TEAMS - 2 - i] ?? null, // SPO=3위, PO=2위, KS=1위
    loId: i === 0 ? seeds[3] : null,
    bestOf: r.bestOf,
    hiW: 0,
    loW: 0,
    winnerId: null,
    games: [],
  }));
  const ui = seeds.indexOf(core.userId);
  const userFinish: PostFinish = ui < 0 ? 'none' : ui === 0 ? 'KS' : ui === 1 ? 'PO' : 'SPO';
  core.post = { seeds, series, cur: 0, championId: null, userFinish };
}

/** 정규시즌 직후 포스트시즌 생성 (순수) */
export function startPostseason(core0: Core, rng: Rng): Core {
  const core = structuredClone(core0);
  startPostMut(core);
  autoSimMut(core, rng);
  return core;
}

const userIn = (core: Core, s: PostSeries) => s.hiId === core.userId || s.loId === core.userId;

/** 다음 유저 경기 정보 (UI 표시용) */
export function postMatch(core: Core): { oppId: string; isHome: boolean; round: PostRound; name: string; gameNo: number } | null {
  if (core.phase !== 'post' || !core.post) return null;
  const s = core.post.series[core.post.cur];
  if (!s || done(s) || !s.hiId || !s.loId || !userIn(core, s)) return null;
  const g = s.hiW + s.loW;
  const hiHome = ROUNDS[core.post.cur].hiHome.includes(g);
  const homeId = hiHome ? s.hiId : s.loId;
  const isHome = homeId === core.userId;
  return { oppId: s.hiId === core.userId ? s.loId : s.hiId, isHome, round: s.round, name: s.name, gameNo: g + 1 };
}

/** 동점이면 승부가 날 때까지 (복제 팀으로 재시뮬해 승자를 정하고 연장 결승점으로 기록) */
function breakTie(res: GameResult, home: Team, away: Team, rng: Rng, track: boolean): void {
  if (res.home !== res.away) return;
  let homeWins: boolean | null = null;
  for (let i = 0; i < TIE_RESIM && homeWins === null; i++) {
    const r = playGame(null, structuredClone(home), structuredClone(away), rng, false);
    if (r.home !== r.away) homeWins = r.home > r.away;
  }
  if (homeWins === null) homeWins = rng() < HOME_TIE_EDGE;
  const last = randInt(rng, res.innings + 1, Math.max(res.innings + 1, MAX_EXTRA));
  for (let inn = res.innings + 1; inn <= last; inn++) {
    const fin = inn === last;
    res.line[0].push(fin && !homeWins ? 1 : 0);
    res.line[1].push(fin && homeWins ? 1 : 0);
  }
  if (homeWins) res.home++;
  else res.away++;
  res.innings = last;
  if (!track) return;
  const winner = homeWins ? home : away;
  const ev: GameEvent = {
    type: homeWins ? 'walkoff' : 'score',
    inning: last,
    half: homeWins ? 1 : 0,
    teamId: winner.id,
    text: homeWins ? `${winner.name} 연장 끝내기!` : `${winner.name} 연장 결승점!`,
    sub: `${last}회${homeWins ? '말' : '초'} · 포스트시즌은 무승부가 없다`,
    away: res.away,
    home: res.home,
  };
  const fi = res.events.findIndex((e) => e.type === 'final');
  const finalEv: GameEvent = {
    type: 'final',
    inning: last,
    half: 1,
    teamId: winner.id,
    text: `${winner.city} ${winner.name} 승리!`,
    sub: `경기 종료 · ${away.name} ${res.away} : ${res.home} ${home.name}`,
    away: res.away,
    home: res.home,
  };
  if (fi >= 0) res.events.splice(fi, 1, ev, finalEv);
  else res.events.push(ev, finalEv);
}

/** 시리즈 한 경기 (선수 정규시즌 기록은 복원, 부상은 반영). mutate. */
function playSeriesGame(core: Core, idx: number, rng: Rng, track: boolean): { res: GameResult; homeId: string; awayId: string } {
  const post = core.post!;
  const s = post.series[idx];
  const g = s.hiW + s.loW;
  const hiHome = ROUNDS[idx].hiHome.includes(g);
  const homeId = hiHome ? s.hiId! : s.loId!;
  const awayId = hiHome ? s.loId! : s.hiId!;
  const home = core.teams.find((t) => t.id === homeId)!;
  const away = core.teams.find((t) => t.id === awayId)!;

  const snap = new Map<string, { bat: BatStats; pit: PitStats }>();
  const injuredBefore = new Set<string>();
  for (const t of [home, away]) {
    for (const p of t.roster) {
      snap.set(p.id, { bat: { ...p.bat }, pit: { ...p.pit } });
      if (p.injury > 0) injuredBefore.add(p.id);
    }
  }
  const res = playGame(core, home, away, rng, track);
  breakTie(res, home, away, rng, track);
  for (const t of [home, away]) {
    for (const p of t.roster) {
      const sn = snap.get(p.id);
      if (sn) {
        p.bat = sn.bat;
        p.pit = sn.pit;
      }
      if (injuredBefore.has(p.id)) p.injury = Math.max(0, p.injury - 1);
    }
  }

  s.games.push({ homeId, awayId, home: res.home, away: res.away });
  const winId = res.home > res.away ? homeId : awayId;
  if (winId === s.hiId) s.hiW++;
  else s.loW++;
  if (s.hiW >= need(s)) s.winnerId = s.hiId;
  else if (s.loW >= need(s)) s.winnerId = s.loId;
  if (s.winnerId) finishSeries(core, idx);
  return { res, homeId, awayId };
}

function finishSeries(core: Core, idx: number): void {
  const post = core.post!;
  const s = post.series[idx];
  const w = s.winnerId!;
  const loser = w === s.hiId ? s.loId! : s.hiId!;
  const name = (id: string) => core.teams.find((t) => t.id === id)?.name ?? id;
  const sc = `${Math.max(s.hiW, s.loW)}승 ${Math.min(s.hiW, s.loW)}패`;
  if (idx + 1 < post.series.length) {
    post.series[idx + 1].loId = w;
    if (w === core.userId) {
      post.userFinish = post.series[idx + 1].round;
      core.fans += FAN_SERIES_WIN;
      addNews(core, `${s.name} 통과! ${name(loser)}를 ${sc}로 꺾고 ${post.series[idx + 1].name} 진출`, 'good');
    } else if (loser === core.userId) {
      addNews(core, `${s.name} 탈락 — ${name(w)}에 ${sc}`, 'bad');
    } else {
      addNews(core, `${s.name}: ${name(w)} ${sc}로 통과`, 'info');
    }
  } else {
    post.championId = w;
    if (w === core.userId) {
      post.userFinish = 'champion';
      core.fans += FAN_CHAMPION;
      addNews(core, `🏆 한국시리즈 우승! ${name(loser)}를 ${sc}로 제압`, 'good');
    } else {
      if (loser === core.userId) addNews(core, `한국시리즈 준우승 — ${name(w)}에 ${sc}`, 'bad');
      addNews(core, `${name(w)} 한국시리즈 우승`, 'info');
    }
  }
  post.cur = idx + 1;
}

/** 유저와 무관한 시리즈를 끝까지 자동 시뮬. 유저가 탈락했거나 진출 못했으면 전부 끝낸다. mutate. */
export function autoSimMut(core: Core, rng: Rng): void {
  const post = core.post;
  if (!post) return;
  while (post.cur < post.series.length) {
    const s = post.series[post.cur];
    if (userIn(core, s)) return;
    // 아직 상대가 정해지지 않았으면(이론상 없음) 안전하게 종료
    if (!s.hiId || !s.loId) {
      post.cur++;
      continue;
    }
    while (!done(s)) playSeriesGame(core, post.cur, rng, false);
  }
}

export function postOver(core: Core): boolean {
  return !core.post || core.post.cur >= core.post.series.length;
}

/** 포스트시즌이 끝났으면 phase 'ended' + 결산 (mutate) */
export function endPostIfDone(core: Core, rng: Rng): void {
  if (!postOver(core)) return;
  core.phase = 'ended';
  concludeMut(core, rng);
}

/** 정규시즌 마지막 경기 직후 호출 (mutate): 진출이면 'post', 아니면 전체 자동 시뮬 후 결산 */
export function afterRegularSeasonMut(core: Core, rng: Rng): void {
  startPostMut(core);
  if (core.post!.userFinish !== 'none') {
    core.phase = 'post';
    addNews(core, `가을야구 진출! 정규시즌 ${rankOf(core.teams, core.userId)}위로 포스트시즌에 나섭니다`, 'good');
    autoSimMut(core, rng);
    return;
  }
  autoSimMut(core, rng);
  endPostIfDone(core, rng);
}

function userPostGames(post: Postseason, userId: string): number {
  return post.series.reduce((n, s) => n + s.games.filter((g) => g.homeId === userId || g.awayId === userId).length, 0);
}

/** phase 'post' 의 하루 (유저 시리즈 한 경기). mutate 후 리포트 반환. */
export function playPostDayMut(core: Core, rng: Rng): DayReport {
  autoSimMut(core, rng);
  const m = postMatch(core);
  if (!m) throw new Error('진행할 포스트시즌 경기가 없습니다');
  const post = core.post!;
  const idx = post.cur;
  const s = post.series[idx];
  const day = core.schedule.length + userPostGames(post, core.userId);
  const notes: string[] = [];
  const rank = rankOf(core.teams, core.userId);
  const user = userTeam(core);
  const opp = core.teams.find((t) => t.id === m.oppId)!;
  const f = core.finance;
  const fx = activeBuffs(core);

  let crowd: Crowd | null = null;
  if (m.isHome) {
    const weather = rollWeather(rng);
    const demand = calcDemand(core, {
      dow: POST_DOW,
      weather,
      oppPop: opp.pop,
      noise: clamp(1 + gauss(rng) * NOISE_SD, 0.85, 1.15),
      mult: DEMAND_MULT[m.round],
    });
    const capacity = Math.round(SEAT_LV[core.facilities.seats].cap * fx.capacity);
    const attendance = Math.min(capacity, demand);
    crowd = { attendance, capacity, demand, turnedAway: Math.max(0, demand - capacity), soldOut: demand >= capacity, weather };
  }

  const { res } = playSeriesGame(core, idx, rng, true);
  const myRuns = m.isHome ? res.home : res.away;
  const oppRuns = m.isHome ? res.away : res.home;
  const won = myRuns > oppRuns;

  for (const j of res.injuries) {
    if (j.teamId !== core.userId) continue;
    const msg = `부상: ${j.name} ${j.games}경기 결장`;
    notes.push(msg);
    addNews(core, msg, 'bad');
  }

  // ── 재정 (연봉·분배금 없음, 유지비·이자는 정산) ──
  const att = crowd ? crowd.attendance : 0;
  const ticket = Math.round(att * f.ticketPrice * TICKET_MULT * fx.ticket);
  const food = crowd ? Math.round(att * FOOD_LV[core.facilities.food].spend * fx.food * (crowd.weather === 'rain' ? RAIN_FOOD : 1)) : 0;
  const merch = Math.round(core.fans * MERCH_K * (starPower(user) / 100) * (m.isHome ? 1.4 : 0.6) * fx.merch);
  const upkeep =
    (m.isHome ? SEAT_LV[core.facilities.seats].upkeep + FOOD_LV[core.facilities.food].upkeep + fx.upkeep : 0) +
    TRAIN_LV[core.facilities.training].upkeep +
    OPS_COST;
  const interest = Math.round((f.debt * LOAN_RATE) / core.schedule.length);
  const net = ticket + food + merch - upkeep - interest;
  f.cash += net;
  f.ledger.ticket += ticket;
  f.ledger.food += food;
  f.ledger.merch += merch;
  f.ledger.upkeep += upkeep;
  f.ledger.interest += interest;
  core.fans = Math.max(1000, core.fans + (won ? FAN_POST_WIN : FAN_POST_LOSS));
  if (crowd) {
    core.crowd = crowd;
    if (crowd.soldOut) notes.push(`매진! ${fmtInt(crowd.attendance)}명이 가을야구를 함께했습니다`);
  }
  tickBuffs(core, m.isHome);

  const myW = s.hiId === core.userId ? s.hiW : s.loW;
  const oppW = s.hiId === core.userId ? s.loW : s.hiW;
  addNews(core, `${s.name} ${m.gameNo}차전 ${opp.name}전 ${myRuns}:${oppRuns} ${won ? '승리' : '패배'} (시리즈 ${myW}-${oppW})`, won ? 'good' : 'bad');
  notes.push(`${s.name} 시리즈 ${myW}승 ${oppW}패`);

  settleCash(core, notes);
  autoSimMut(core, rng);
  endPostIfDone(core, rng);
  if (core.phase === 'post') {
    refreshProgressMut(core);
    checkAchievementsMut(core, false);
  }
  core.cashHistory.push(f.cash);

  return {
    day,
    result: res,
    isHome: m.isHome,
    oppId: opp.id,
    won,
    night: true,
    crowd,
    money: { ticket, food, merch, league: 0, salary: 0, upkeep, interest, net },
    rankBefore: rank,
    rankAfter: rank,
    others: [],
    notes,
    post: { round: s.round, name: s.name, gameNo: m.gameNo, myW, oppW, bestOf: s.bestOf },
  };
}
