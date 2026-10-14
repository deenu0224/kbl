// 포스트시즌 (KBO 사다리식). 8구단 리그는 4팀, 10구단 리그는 와일드카드 결정전을 더한 5팀. docs/LEVEL_DESIGN.md 3절 · docs/TEN_TEAMS.md
import type { BatStats, BoxSide, Core, Crowd, DayReport, GameEvent, GameResult, KsBox, PitStats, PostFinish, PostRound, PostSeries, Postseason, Team } from './types';
import { clamp, gauss, randInt, type Rng } from './rng';
import { FOOD_LV, SEAT_LV, TRAIN_LV, loanInterest, MERCH_K, calcDemand, opsCost, rainFood, starPower, userTeam } from './economy';
import { fmtInt } from './format';
import { addNews, playGame, rankOf, rollWeather, settleCash, standings } from './season';
import { activeBuffs, concludeMut, hintMut, refreshProgressMut, tickBuffs } from './campaign';
import { memoAdd } from './memo';
import { perGame, postRounds, postTeams } from './league';

// ── 튜닝 상수 ──
// 진출 팀 수와 라운드 순서는 구단 수에서 유도한다 (league.ts postTeams·postRounds): 8구단 4팀 [SPO, PO, KS], 10구단 5팀 [WC, SPO, PO, KS]
// hiHome = 상위 시드가 홈인 경기 번호(0부터). hiLead = 상위 시드가 안고 시작하는 승수. tieHi = 무승부가 있고, 비기면 상위 시드가 통과
const ROUND_DEF: Record<PostRound, { name: string; bestOf: number; hiHome: number[]; hiLead?: number; tieHi?: boolean }> = {
  WC: { name: '와일드카드 결정전', bestOf: 3, hiHome: [0, 1], hiLead: 1, tieHi: true }, // 4위 1승 선취 · 최대 2경기 · 전부 4위 홈
  SPO: { name: '준플레이오프', bestOf: 3, hiHome: [0, 2] },
  PO: { name: '플레이오프', bestOf: 5, hiHome: [0, 1, 4] },
  KS: { name: '한국시리즈', bestOf: 7, hiHome: [0, 1, 5, 6] },
};
// WC 는 준플레이오프 가산(+25%)의 60% (docs/TEN_TEAMS.md 3단계 — 와일드카드 값은 준PO 의 절반~3분의 2)
const DEMAND_MULT: Record<PostRound, number> = { WC: 1.15, SPO: 1.25, PO: 1.4, KS: 1.6 };
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

const TRAVEL_BEST_OF = 5; // 이 이상 길이의 시리즈에는 이동일이 있다
const TRAVEL_AFTER = 2; // 이 경기 수를 치른 뒤 하루 쉰다 (연투 일수 −1)
const need = (s: PostSeries) => Math.floor(s.bestOf / 2) + 1;
const done = (s: PostSeries) => s.winnerId !== null;

export function startPostMut(core: Core): void {
  // 정규시즌과 포스트시즌 사이의 휴식: 연투 피로는 풀린다
  for (const t of core.teams) for (const p of t.roster) delete p.tired;
  core.post = buildPost(core);
}

/** 지금 순위대로의 대진표 (시작 전 상태). 대진표 화면의 "지금 순위대로라면"도 이것을 쓴다 */
export function buildPost(core: Pick<Core, 'teams' | 'userId'>): Postseason {
  const n = postTeams(core);
  const rounds = postRounds(core);
  const seeds = standings(core.teams)
    .slice(0, n)
    .map((t) => t.id);
  const series: PostSeries[] = rounds.map((round, i) => ({
    round,
    name: ROUND_DEF[round].name,
    hiId: seeds[n - 2 - i] ?? null, // 4팀: SPO=3위, PO=2위, KS=1위 · 5팀: WC=4위, SPO=3위, …
    loId: i === 0 ? (seeds[n - 1] ?? null) : null,
    bestOf: ROUND_DEF[round].bestOf,
    hiW: ROUND_DEF[round].hiLead ?? 0,
    loW: 0,
    winnerId: null,
    games: [],
  }));
  // 유저가 처음 나서는 라운드: 최하위 시드는 첫 라운드의 하위 시드로, 그 밖에는 자기 시드가 상위 시드인 라운드부터
  const ui = seeds.indexOf(core.userId);
  const userFinish: PostFinish = ui < 0 ? 'none' : rounds[Math.max(0, n - 2 - ui)];
  return { seeds, series, cur: 0, championId: null, userFinish };
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
  const g = s.games.length;
  const hiHome = ROUND_DEF[s.round].hiHome.includes(g);
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
  const def = ROUND_DEF[s.round];
  const g = s.games.length;
  const hiHome = def.hiHome.includes(g);
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
  if (!def.tieHi) breakTie(res, home, away, rng, track);
  for (const t of [home, away]) {
    for (const p of t.roster) {
      const sn = snap.get(p.id);
      if (sn) {
        p.bat = sn.bat;
        p.pit = sn.pit;
      }
      if (injuredBefore.has(p.id)) {
        p.injury = Math.max(0, p.injury - 1);
        if (p.ban && (p.ban = Math.min(p.ban - 1, p.injury)) <= 0) delete p.ban;
      }
    }
  }

  s.games.push({ homeId, awayId, home: res.home, away: res.away });
  const tied = res.home === res.away; // 와일드카드 결정전만: 비기면 상위 시드가 통과한다
  const winId = res.home > res.away ? homeId : awayId;
  if (tied) s.winnerId = s.hiId;
  else if (winId === s.hiId) s.hiW++;
  else s.loW++;
  if (s.winnerId) {
    // 무승부 통과
  } else if (s.hiW >= need(s)) s.winnerId = s.hiId;
  else if (s.loW >= need(s)) s.winnerId = s.loId;
  if (s.winnerId) {
    // 시리즈 사이의 휴식일: 연투 피로가 풀린다
    for (const t of core.teams) for (const p of t.roster) delete p.tired;
    finishSeries(core, idx);
  } else if (s.bestOf >= TRAVEL_BEST_OF && s.games.length === TRAVEL_AFTER) {
    // 5전제·7전제는 2경기 뒤 이동일: 두 팀 불펜이 하루 쉰다
    for (const t of [home, away]) for (const p of t.roster) if (p.tired) p.tired > 1 ? (p.tired -= 1) : delete p.tired;
  }
  return { res, homeId, awayId };
}

function finishSeries(core: Core, idx: number): void {
  const post = core.post!;
  const s = post.series[idx];
  const w = s.winnerId!;
  const loser = w === s.hiId ? s.loId! : s.hiId!;
  const name = (id: string) => core.teams.find((t) => t.id === id)?.name ?? id;
  // 와일드카드 결정전은 안고 시작한 1승을 빼고 실제 치른 경기로 적는다
  const lead = ROUND_DEF[s.round].hiLead ?? 0;
  const wonG = w === s.hiId ? s.hiW - lead : s.loW;
  const lostG = w === s.hiId ? s.loW : s.hiW - lead;
  const tieG = s.games.length - wonG - lostG;
  const sc = lead ? `${wonG}승 ${lostG}패${tieG ? ` ${tieG}무` : ''}` : `${Math.max(s.hiW, s.loW)}승 ${Math.min(s.hiW, s.loW)}패`;
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

  const tiredBefore = new Map(user.roster.map((p) => [p.id, p.tired ?? 0]));
  const { res } = playSeriesGame(core, idx, rng, true);
  if (s.round === 'KS' && res.box) addKsBox(post, res.box[m.isHome ? 1 : 0]);
  const myRuns = m.isHome ? res.home : res.away;
  const oppRuns = m.isHome ? res.away : res.home;
  const won = myRuns > oppRuns;
  const tie = myRuns === oppRuns; // 와일드카드 결정전만 (비기면 4위 통과)
  // 연투 패전: 전날 던진 투수가 오늘 패전투수가 됐다
  if (!won && res.lossP && (tiredBefore.get(res.lossP) ?? 0) >= 1) {
    memoAdd(core, 'b2bLoss');
    const lp = user.roster.find((p) => p.id === res.lossP);
    if (lp) notes.push(`연투 패전: ${lp.name}`);
    hintMut(core, 'pitchers');
  }

  for (const j of res.injuries) {
    if (j.teamId !== core.userId) continue;
    const msg = `부상: ${j.name} ${j.games}경기 결장`;
    notes.push(msg);
    addNews(core, msg, 'bad');
  }

  // ── 재정 (연봉·분배금 없음, 유지비·이자는 정산) ──
  const att = crowd ? crowd.attendance : 0;
  const ticket = Math.round(att * f.ticketPrice * TICKET_MULT * fx.ticket);
  const food = crowd ? Math.round(att * FOOD_LV[core.facilities.food].spend * fx.food * rainFood(core.facilities, crowd.weather, core)) : 0;
  const merch = Math.round(core.fans * MERCH_K * (starPower(user, core.season) / 100) * (m.isHome ? 1.4 : 0.6) * fx.merch);
  const upkeep =
    (m.isHome ? SEAT_LV[core.facilities.seats].upkeep + FOOD_LV[core.facilities.food].upkeep + fx.upkeep : 0) +
    Math.round(perGame(core, TRAIN_LV[core.facilities.training].upkeep + opsCost(core)));
  const interest = Math.round(loanInterest(core, f.debt) / core.schedule.length);
  const net = ticket + food + merch - upkeep - interest;
  f.cash += net;
  f.ledger.ticket += ticket;
  f.ledger.food += food;
  f.ledger.merch += merch;
  f.ledger.upkeep += upkeep;
  f.ledger.interest += interest;
  core.fans = Math.max(1000, core.fans + (won ? FAN_POST_WIN : tie ? 0 : FAN_POST_LOSS));
  if (crowd) {
    core.crowd = crowd;
    if (crowd.soldOut) notes.push(`매진! ${fmtInt(crowd.attendance)}명이 가을야구를 함께했습니다`);
  }
  tickBuffs(core, m.isHome);

  const myW = s.hiId === core.userId ? s.hiW : s.loW;
  const oppW = s.hiId === core.userId ? s.loW : s.hiW;
  addNews(core, `${s.name} ${m.gameNo}차전 ${opp.name}전 ${myRuns}:${oppRuns} ${won ? '승리' : tie ? '무승부' : '패배'} (시리즈 ${myW}-${oppW})`, won ? 'good' : tie ? 'info' : 'bad');
  notes.push(`${s.name} 시리즈 ${myW}승 ${oppW}패`);

  settleCash(core, notes);
  autoSimMut(core, rng);
  endPostIfDone(core, rng);
  if (core.phase === 'post') refreshProgressMut(core);
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

/** 이 경기로 유저 팀의 한국시리즈 우승이 확정됐는가 (하이라이트 끝의 우승 세리머니용) */
export function clinchesTitle(r: Pick<DayReport, 'post' | 'won'> | null | undefined): boolean {
  const p = r?.post;
  return !!p && p.round === 'KS' && r?.won === true && p.myW >= Math.floor(p.bestOf / 2) + 1;
}

/** 한국시리즈 한 경기의 유저 팀 기록을 시리즈 누적에 더한다 */
function addKsBox(post: Postseason, side: BoxSide): void {
  const k: KsBox = (post.ksBox ??= { bat: {}, pit: {} });
  for (const b of side.bat) {
    const a = (k.bat[b.pid] ??= { name: b.name, pos: b.pos, ab: 0, h: 0, hr: 0, rbi: 0, bb: 0, r: 0 });
    a.ab += b.ab;
    a.h += b.h;
    a.hr += b.hr;
    a.rbi += b.rbi;
    a.bb += b.bb;
    a.r += b.r;
  }
  for (const p of side.pit) {
    const a = (k.pit[p.pid] ??= { name: p.name, outs: 0, h: 0, er: 0, so: 0, w: 0, sv: 0 });
    a.outs += p.outs;
    a.h += p.h;
    a.er += p.er;
    a.so += p.so;
    if (p.dec === 'W') a.w++;
    if (p.dec === 'S') a.sv++;
  }
}

export interface SeriesMvp {
  pid: string;
  name: string;
  kind: 'B' | 'P';
  text: string; // "타율 .412 · 2홈런 · 6타점" / "13⅓이닝 · 2자책 · 2승"
}

const ipText = (outs: number) => `${Math.floor(outs / 3)}${['', '⅓', '⅔'][outs % 3]}`;

/** 한국시리즈 MVP: 시리즈 누적에서 가장 잘한 우리 선수. 타자는 출루·장타·타점, 투수는 이닝·자책·승. 기록이 없으면 null */
export function seriesMvp(box: KsBox | undefined): SeriesMvp | null {
  if (!box) return null;
  let best: (SeriesMvp & { v: number }) | null = null;
  for (const [pid, b] of Object.entries(box.bat)) {
    if (b.ab + b.bb < 4) continue;
    const v = b.h + b.bb * 0.6 + b.hr * 2 + b.rbi * 0.8 + b.r * 0.4;
    if (!best || v > best.v) best = { pid, name: b.name, kind: 'B', v, text: `타율 ${b.ab ? (b.h / b.ab).toFixed(3).replace(/^0/, '') : '.000'} · ${b.hr}홈런 · ${b.rbi}타점` };
  }
  for (const [pid, p] of Object.entries(box.pit)) {
    if (p.outs < 9) continue;
    const v = (p.outs / 3) * 0.9 - p.er * 1.4 + p.so * 0.25 + p.w * 1.5 + p.sv * 1.2;
    if (!best || v > best.v) best = { pid, name: p.name, kind: 'P', v, text: `${ipText(p.outs)}이닝 · ${p.er}자책${p.w ? ` · ${p.w}승` : ''}${p.sv ? ` · ${p.sv}세이브` : ''}` };
  }
  if (!best) return null;
  const { v: _v, ...mvp } = best;
  return mvp;
}
