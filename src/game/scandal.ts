import { josa } from './format';
// 후반 스캔들: 약물 · 승부조작 (docs/IDEA_BANK.md E절).
// 원칙: 사전 징후 → 발각 전 선택 → 오래 따라오는 대가. 예방책(윤리 교육)이 있다.
// - scandalTickMut: 매 경기 후. 시즌에 최대 1건을 정하고(징후 → 카드), 징후를 낸다
// - SCANDAL_CARDS: 「트레이너의 보고」(약물) · 「사무국의 전화」(승부조작). events.ts 의 카드 목록에 들어간다
// - exposeMut: 결산(concludeMut)에서 덮은 일(campaign.secrets)의 적발 판정
// - buyEthics: 구단 탭의 선수단 윤리 교육
import type { CharId, Core, EventCard, Exposure, Player, Secret } from './types';
import { clamp, pick, randInt, type Rng } from './rng';
import { calcOvr } from './ratings';
import { MIN_SALARY } from './ratings';
import { MIN_BATTERS, MIN_PITCHERS, activeRoster, payroll, releaseCost, userTeam } from './economy';
import { fmtMoney } from './format';
import { fixLineup } from './lineup';
import { isFranchise, seasonsWith } from './franchise';
import { batZero, pitZero } from './generate';
import { addNews, marketSalary, rankOf } from './season';
import { marketRatio } from './contract';
import { cardRested, markCardMut, memoGet, memoSet } from './memo';
import { rowCash, rowFans, rowInfo, rowPayroll, rowSat, rowTrust, satAfter, trustAfter } from './eventRows';
import { CHARACTERS, SCANDAL_NEWS, TRUST_LABEL } from './story';
import { dayAt } from './league';

// ── 튜닝 상수 ──
export const SC = {
  // 발생
  stage: 2, // 이 장(가을야구)부터, 또는 정규시즌 topRank 위 이내였던 다음 시즌부터
  topRank: 4,
  base: 0.36, // 시즌당 기본 발생 확률 (조건을 채운 시즌. 종류별 재등장 간격 3시즌이 실제 빈도를 더 낮춘다)
  perLow: 0.03, // 저연봉 선수 1명당 가산
  max: 0.6,
  rollDay: 8, // 이 경기 뒤에 그 시즌의 일을 정한다
  cardFrom: 30, // 카드가 뜨는 경기 범위
  cardTo: 54,
  // 윤리 교육
  ethicsMax: 3,
  ethicsMult: 0.8, // 단계마다 발생 확률 배율 (3단계 0.51배)
  ethicsRate: 0.015, // 비용 = 연봉 총액 × 이 값
  ethicsMin: 5000,
  // 적발
  detect0: 0.2, // 덮은 그 시즌 결산
  detectStep: 0.05, // 시즌마다
  detectMax: 0.4,
  trust: { dope: -18, fix: -40 },
  // 약물
  dopeAge: 28,
  dopeLead: [12, 18],
  dopeUp: [5, 6],
  reportBan: 48,
  reportExtra: 1, // 자진 신고: 올랐던 능력치를 되돌리고 이만큼 더
  reportStar: -15,
  reportTrust: 3,
  reportSat: -6,
  coverAsk: 0.15, // 덮으면 그 선수의 재계약·연봉 요구가 이만큼 강해진다
  outFans: 8, // 조용히 내보낸다: 프랜차이즈면 star × 이 값
  outSat: -8,
  exposeBan: 72,
  exposeStar: -40,
  // 승부조작
  fixRatio: 0.6, // 시장가 대비 연봉이 이 이하
  fixMinSeasons: 3, // 또는 최저 연봉으로 이 시즌 이상
  fixLead: [6, 12],
  coopTrust: -5,
  coopSat: -4,
  coopSeasons: 2,
  coopMult: 0.5,
  trueRate: 0.55, // 선수 말을 믿었을 때 사실일 확률
  loyal: -0.1, // 무혐의로 끝난 선수의 다음 재계약 요구
  hushRate: 0.3, // 연봉을 올려 주고 넘겼을 때 덮은 일로 남을 확률
  forfeit: 8, // 적발 시 몰수 승수
  // 제재금 = max(최소액, (현금 + 직전 시즌 영업이익) × 비율). 돈을 잘 버는 구단일수록 크다
  fine: {
    dopeReport: [30000, 0.15], // 약물 자진 신고 (관리 책임)
    fixCoop: [60000, 0.22], // 승부조작 전면 협조
    dopeExposed: [80000, 0.35], // 약물 적발 (덮었다가)
    fixExposed: [150000, 0.5], // 승부조작 적발
  },
  leagueCut: 0.6, // 승부조작 적발: 다음 시즌 리그 분배금 배율
  // 기자 카드 「기자가 냄새를 맡았다」: 덮은 다음 시즌부터, 덮은 일 1건당 최대 2번 · 시즌에 1장
  press: {
    from: 30, // 84경기 기준 이 사이의 하루 (선수·시즌 해시로 정한다. 난수를 쓰지 않는다)
    to: 55,
    max: 2,
    hush: -0.15, // 입막음: 이번 시즌 말 적발 위험
    hushCost: 0.25, // 입막음 비용 = 그 일의 적발 제재금 × 이 값
    hushLate: 0.05, // 입막음도 기록이 남는다: 다음 시즌부터 시즌마다 이만큼 (입막음 1번당)
    ignore: 0.1, // 모른 척: 이번 시즌 말 적발 위험
    floor: 0.05,
    cap: 0.6,
    confess: 0.5, // 털어놓는다: 적발 때 도민 지지 하락의 이만큼. 제재금은 자진 신고·협조 수준, 승수 몰수·분배금 삭감 없음
  },
};

type Kind = Secret['kind'];
type AbilKey = 'con' | 'pow' | 'eye' | 'spd' | 'def' | 'stf' | 'ctl' | 'sta';
const KIND_KO: Record<Kind, string> = { dope: '금지 약물 사용', fix: '승부조작' };
const sgn = (v: number) => (v >= 0 ? `+${v}` : `−${-v}`);
const pctTxt = (v: number) => `${Math.round(v * 100)}%`;
const find = (core: Core, pid?: string) => (pid ? userTeam(core).roster.find((p) => p.id === pid) : undefined);
const chairSays = (line: string) => `${CHARACTERS.chair.name} ${CHARACTERS.chair.title} — "${line}"`;
const secretsN = (core: Core) => (core.campaign.secrets ?? []).filter((x) => !x.unknown).length;
const rowSecret = (core: Core) => rowInfo('말하지 않은 일', `${secretsN(core) + 1}건`, `${secretsN(core)}건`, 'bad');
type FineKey = keyof typeof SC.fine;
/** 제재금의 기준액: 지금 현금 + 직전 시즌 영업이익 (적자는 0) */
export const fineBase = (core: Pick<Core, 'finance' | 'campaign'>): number => Math.max(0, core.finance.cash) + Math.max(0, core.campaign.history[core.campaign.history.length - 1]?.profit ?? 0);
/** 제재금. 표시와 적용이 같이 쓴다 */
export const fineOf = (core: Pick<Core, 'finance' | 'campaign'>, key: FineKey): number => Math.max(SC.fine[key][0], Math.round((fineBase(core) * SC.fine[key][1]) / 100) * 100);
const fineRule = (key: FineKey) => `최소 ${fmtMoney(SC.fine[key][0])} · 그때 (현금 + 직전 시즌 영업이익)의 ${pctTxt(SC.fine[key][1])}`;
function payFineMut(core: Core, key: FineKey): number {
  const v = fineOf(core, key);
  core.finance.cash -= v; // 모자라면 다음 정산에서 부채로 넘어간다 (season.ts settleCash)
  core.finance.ledger.upkeep += v;
  return v;
}
/** 이 시즌의 리그 분배금 배율 (승부조작 적발 다음 시즌) */
export const leagueMult = (core: Pick<Core, 'campaign' | 'season'>): number => (core.campaign.leagueCut?.season === core.season ? core.campaign.leagueCut.mult : 1);
const DETECT_RISK = `매 시즌 결산에서 드러날 수 있음: 첫 시즌 ${pctTxt(SC.detect0)}, 해마다 +${Math.round(SC.detectStep * 100)}%p (상한 ${pctTxt(SC.detectMax)})`;

// ───────── 윤리 교육 ─────────

export const ethicsLv = (core: Pick<Core, 'campaign'>): number => clamp(core.campaign.ethics ?? 0, 0, SC.ethicsMax);
export const ethicsMult = (lv: number): number => Math.round(SC.ethicsMult ** lv * 100) / 100;
export const ethicsCost = (core: Core): number => Math.max(SC.ethicsMin, Math.round((payroll(userTeam(core)) * SC.ethicsRate) / 100) * 100);
/** 윤리 교육을 지금 살 수 없는 사유. 살 수 있으면 null */
export function ethicsBlocked(core: Core): string | null {
  if (ethicsLv(core) >= SC.ethicsMax) return '교육 과정을 모두 마쳤습니다';
  if (core.campaign.ethicsSeason === core.season) return '이번 시즌에는 이미 실시했습니다';
  if (core.finance.cash < ethicsCost(core)) return `현금 부족 (필요 ${fmtMoney(ethicsCost(core))})`;
  return null;
}
export function buyEthics(core0: Core): { core: Core; error?: string } {
  const blocked = ethicsBlocked(core0);
  if (blocked) return { core: core0, error: blocked };
  const core = structuredClone(core0);
  const cost = ethicsCost(core);
  core.finance.cash -= cost;
  core.finance.ledger.upkeep += cost;
  core.campaign.ethics = ethicsLv(core) + 1;
  core.campaign.ethicsSeason = core.season;
  addNews(core, `선수단 윤리 교육 ${core.campaign.ethics}단계 실시 (${fmtMoney(cost)})`, 'info');
  return { core };
}

// ───────── 발생 ─────────

/** 스캔들이 생길 수 있는 구단인가: 후반 장이거나, 정규시즌 상위권을 해 본 다음 시즌부터 */
export function scandalOpen(core: Core): boolean {
  return core.campaign.stage >= SC.stage || core.campaign.history.some((h) => h.rank <= SC.topRank);
}

const keyIds = (core: Core) => {
  const t = userTeam(core);
  return new Set([...t.lineup.map((s) => s.pid), ...t.rotation, ...(t.closer ? [t.closer] : [])]);
};
/** 약물 대상: 28세 이상 1군 주전 */
export function dopeTargets(core: Core): Player[] {
  const ids = keyIds(core);
  return userTeam(core).roster.filter((p) => ids.has(p.id) && !p.farm && p.age >= SC.dopeAge && p.injury === 0 && !p.ban);
}
/** 승부조작 대상: 시장가보다 크게 싸게 쓰는 1군 선수, 최저 연봉으로 오래 뛴 1군 선수 */
export function fixTargets(core: Core): Player[] {
  const clear = new Set(core.campaign.fixClear ?? []);
  return activeRoster(userTeam(core)).filter(
    (p) => !clear.has(p.id) && !p.ban && !p.rookie && (marketRatio(core, p) <= SC.fixRatio || (p.salary <= MIN_SALARY && seasonsWith(p, core.season) >= SC.fixMinSeasons)),
  );
}
/** 이번 시즌 스캔들 발생 확률 (조건을 채운 구단) */
export function scandalChance(core: Core): number {
  if (!scandalOpen(core)) return 0;
  return clamp(SC.base + SC.perLow * fixTargets(core).length, 0, SC.max) * ethicsMult(ethicsLv(core));
}

interface Plan {
  kind: Kind;
  pid: string;
  sign: number; // 징후가 나오는 day
  card: number; // 카드가 뜨는 day
  ups: string; // 약물로 오른 능력치 "con:3,pow:4" (징후 전에는 '')
  state: 'wait' | 'sign' | 'done';
}
const PLAN = 'scn';
function planOf(core: Core): Plan | null {
  const v = memoGet(core, PLAN);
  if (!v || v === 'none') return null;
  const [kind, pid, sign, card, ups, state] = v.split('/');
  return { kind: kind as Kind, pid, sign: Number(sign), card: Number(card), ups, state: state as Plan['state'] };
}
const savePlan = (core: Core, p: Plan) => memoSet(core, PLAN, [p.kind, p.pid, p.sign, p.card, p.ups, p.state].join('/'));
const parseUps = (ups: string): [AbilKey, number][] => (ups ? ups.split(',').map((x) => [x.split(':')[0] as AbilKey, Number(x.split(':')[1])]) : []);

/** 약물로 오른 능력치를 되돌린 뒤의 선수 (extra 만큼 더 깎는다). 표시와 적용이 같이 쓴다 */
export function reverted(p: Player, ups: string, extra: number): Player {
  const q = { ...p };
  for (const [k, d] of parseUps(ups)) q[k] = clamp(q[k] - d - extra, 20, 99);
  q.ovr = calcOvr(q);
  return q;
}
function revertMut(p: Player, ups: string, extra: number): void {
  const q = reverted(p, ups, extra);
  for (const [k] of parseUps(ups)) p[k] = q[k];
  p.ovr = q.ovr;
}

/** 덮은 승부조작: 그 선수가 팀에 있는 동안 시즌에 1~2번 "또 이상한 하루" 뉴스 (뉴스만. 난수 대신 해시로 날을 정한다) */
function fixAgainMut(core: Core): void {
  for (const s of core.campaign.secrets ?? []) {
    if (s.kind !== 'fix' || s.unknown || s.season >= core.season) continue;
    const p = find(core, s.pid);
    if (!p || p.farm) continue;
    const h = hashOf(`fix|${s.pid}|${core.season}`);
    const days = [dayAt(core, 14 + (h % 20)), ...(h & 64 ? [dayAt(core, 48 + ((h >>> 8) % 26))] : [])];
    const n = days.indexOf(core.day);
    if (n >= 0) addNews(core, SCANDAL_NEWS.fixAgain(p.name, n + (h & 1)), 'bad');
  }
}

/** 매 경기 후 (mutate): 시즌의 스캔들을 정하고, 때가 되면 징후를 낸다 */
export function scandalTickMut(core: Core, rng: Rng): void {
  if (core.phase !== 'season') return;
  fixAgainMut(core);
  if (memoGet(core, PLAN) === undefined) {
    if (core.day < SC.rollDay) return;
    memoSet(core, PLAN, 'none');
    const p = scandalChance(core);
    if (p <= 0 || rng() >= p) return;
    const dope = cardRested(core, 'dope') ? dopeTargets(core) : [];
    const coop = (core.campaign.fixCoop ?? 0) >= core.season ? SC.coopMult : 1;
    const fix = cardRested(core, 'fix') ? fixTargets(core) : [];
    const wDope = dope.length ? 1 : 0;
    const wFix = fix.length ? Math.min(1.2, 0.3 + 0.15 * fix.length) * coop : 0;
    if (wDope + wFix <= 0) return;
    const kind: Kind = rng() * (wDope + wFix) < wDope ? 'dope' : 'fix';
    const who = pick(rng, kind === 'dope' ? dope : fix);
    const card = randInt(rng, Math.max(dayAt(core, SC.cardFrom), core.day + SC.dopeLead[1] + 1), dayAt(core, SC.cardTo));
    const lead = kind === 'dope' ? SC.dopeLead : SC.fixLead;
    savePlan(core, { kind, pid: who.id, sign: card - randInt(rng, lead[0], lead[1]), card, ups: '', state: 'wait' });
    return;
  }
  const plan = planOf(core);
  if (!plan || plan.state !== 'wait' || core.day < plan.sign) return;
  const p = find(core, plan.pid);
  if (!p || p.farm) {
    memoSet(core, PLAN, 'none'); // 그 사이 팀을 떠났거나 2군으로 갔다: 없던 일
    return;
  }
  if (plan.kind === 'dope') {
    // 징후: 훈련 규칙으로 설명되지 않는 상승 (실제 경기력이 오른다)
    const keys: AbilKey[] = p.kind === 'B' ? ['con', 'pow', 'eye', 'spd'] : ['stf', 'ctl', 'sta'];
    const a = pick(rng, keys);
    const b = pick(rng, keys.filter((k) => k !== a));
    const ups: [AbilKey, number][] = [a, b].map((k) => [k, Math.min(99 - p[k], randInt(rng, SC.dopeUp[0], SC.dopeUp[1]))]);
    for (const [k, d] of ups) p[k] += d;
    p.ovr = calcOvr(p);
    p.pot = Math.max(p.pot, p.ovr);
    plan.ups = ups.map(([k, d]) => `${k}:${d}`).join(',');
    addNews(core, SCANDAL_NEWS.dopeSign(p.name, p.age), 'info');
  } else {
    addNews(core, p.kind === 'P' ? SCANDAL_NEWS.fixSignP(p.name) : SCANDAL_NEWS.fixSignB(p.name), 'info');
  }
  plan.state = 'sign';
  savePlan(core, plan);
}

const WARN = 'scnWarn';
/** 주간 브리핑의 징후 경고 한 줄: 징후가 나온 뒤 첫 브리핑에 한 번 (트레이너·감독) */
export function scandalWarn(core: Core): { who: CharId; line: string } | null {
  const plan = planOf(core);
  if (!plan || plan.state !== 'sign' || core.day < plan.sign || memoGet(core, WARN) === String(core.season)) return null;
  const p = find(core, plan.pid);
  if (!p) return null;
  return plan.kind === 'dope'
    ? { who: p.kind === 'P' ? 'pitching' : 'farm', line: SCANDAL_NEWS.dopeWarn(p.name) }
    : { who: 'manager', line: SCANDAL_NEWS.fixWarn(p.name) };
}
export const markScandalWarnMut = (core: Core): void => memoSet(core, WARN, String(core.season));

// ───────── 선수 처리 ─────────

/** 징계: 부상과 같은 방식으로 결장한다 (injury 와 같이 줄고, 시즌을 넘기면 이월) */
export function banMut(core: Core, p: Player, games: number): void {
  p.ban = Math.max(p.ban ?? 0, games);
  p.injury = Math.max(p.injury, p.ban);
  fixLineup(userTeam(core));
}
/** 1군 최소 인원 때문에 내보낼 수 없는 사유 */
function leaveBlocked(core: Core, p: Player): string | undefined {
  const same = activeRoster(userTeam(core)).filter((x) => x.kind === p.kind).length;
  if (p.kind === 'B' && same <= MIN_BATTERS) return `1군 타자는 최소 ${MIN_BATTERS}명이 필요합니다`;
  if (p.kind === 'P' && same <= MIN_PITCHERS) return `1군 투수는 최소 ${MIN_PITCHERS}명이 필요합니다`;
  return undefined;
}
/** 로스터에서 뺀다 (toFa: FA 풀로. 아니면 영구 제명). 1군이 최소 인원 아래로 내려가면 2군에서 한 명 올린다 */
function removeMut(core: Core, p: Player, toFa: boolean): void {
  const t = userTeam(core);
  t.roster = t.roster.filter((x) => x.id !== p.id);
  const min = p.kind === 'B' ? MIN_BATTERS : MIN_PITCHERS;
  if (!p.farm && activeRoster(t).filter((x) => x.kind === p.kind).length < min) {
    const up = t.roster.filter((x) => x.farm && !x.il && x.kind === p.kind).sort((a, b) => b.ovr - a.ovr)[0];
    if (up) {
      delete up.farm;
      delete up.farmUntil;
      addNews(core, `${josa(up.name, '이', '가')} 빈자리를 메우러 1군에 올라왔습니다`, 'info');
    }
  }
  if (toFa) {
    for (const k of ['since', 'svc', 'ask', 'deal', 'lever', 'tired', 'farm', 'il', 'farmUntil', 'farmStat', 'subFor', 'subFrom', 'armyDue', 'ban'] as const) delete p[k];
    p.injury = 0;
    p.salary = marketSalary(p, core.season);
    p.left = core.season;
    core.freeAgents.push(p);
  }
  fixLineup(t);
}
function addSecretMut(core: Core, kind: Kind, p: Player, unknown = false): void {
  core.campaign.secrets = [...(core.campaign.secrets ?? []), { kind, pid: p.id, name: p.name, season: core.season, ...(unknown ? { unknown: true } : {}) }];
}
/** 약점을 잡힌(또는 믿어 준) 선수의 다음 재계약·연봉 요구 */
function leverMut(p: Player, d: number): void {
  if (p.svc !== undefined) p.lever = Math.round(((p.lever ?? 0) + d) * 100) / 100; // 보유 기간 중: FA 재계약 때 반영 (contract.ts resignAsk)
  else p.ask = Math.round(((p.ask ?? 1) + d) * 100) / 100; // 그 밖: 다음 시즌 연봉 재산정부터
}

// ───────── 카드 ─────────

interface ScandalCardDef {
  id: string;
  prio: number;
  forced: boolean;
  when: (core: Core) => boolean;
  make: (core: Core, rng: Rng) => EventCard | null;
  resolve: (core: Core, idx: number, card: EventCard, rng: Rng) => string;
}

const due = (core: Core, kind: Kind): { plan: Plan; p: Player } | null => {
  const plan = planOf(core);
  if (!plan || plan.kind !== kind || plan.state !== 'sign' || core.day < plan.card) return null;
  const p = find(core, plan.pid);
  return p && !p.farm ? { plan, p } : null;
};
const closePlan = (core: Core) => {
  const plan = planOf(core);
  if (plan) savePlan(core, { ...plan, state: 'done' });
};
const upsText = (ups: string) => {
  const KO: Record<string, string> = { con: '컨택', pow: '파워', eye: '선구', spd: '주력', def: '수비', stf: '구위', ctl: '제구', sta: '체력' };
  return parseUps(ups).map(([k, d]) => `${KO[k]} +${d}`).join(' · ');
};

export const SCANDAL_CARDS: ScandalCardDef[] = [
  // ───────── 약물 「트레이너의 보고」 ─────────
  {
    id: 'dope',
    prio: 88,
    forced: true,
    when: (c) => !!due(c, 'dope'),
    make: (c) => {
      const x = due(c, 'dope');
      if (!x) return null;
      const { p, plan } = x;
      markCardMut(c, 'dope');
      const back = reverted(p, plan.ups, SC.reportExtra);
      const out = reverted(p, plan.ups, 0);
      const fr = isFranchise(p, c.season);
      const cost = releaseCost(p, c);
      const blocked = leaveBlocked(c, p) ?? (c.finance.cash < cost ? `현금 부족 (필요 ${fmtMoney(cost)})` : undefined);
      return {
        id: `dope|${plan.ups}`,
        title: '트레이너의 보고',
        icon: '🧪',
        pid: p.id,
        who: p.kind === 'P' ? 'pitching' : 'farm',
        line: '혈액 검사에서 걸릴 수치입니다. 아직은 저만 압니다.',
        body: `${p.name}(${p.age}세, 오버롤 ${p.ovr})의 최근 상승(${upsText(plan.ups)})은 훈련으로 설명되지 않습니다. 구단 자체 검사에서 금지 약물 반응이 나왔습니다.`,
        choices: [
          {
            label: '자진 신고한다',
            desc: `출장 정지 ${SC.reportBan}경기 · 제재금 ${fmtMoney(fineOf(c, 'dopeReport'))}`,
            detail: {
              rows: [
                rowInfo(`${p.name} 출장 정지`, `${SC.reportBan}경기`, '0경기', 'bad'),
                rowInfo(`${p.name} 오버롤`, `${back.ovr}`, `${p.ovr}`, 'bad'),
                rowInfo('스타성', `${clamp(p.star + SC.reportStar, 0, 100)}`, `${p.star}`, 'bad'),
                rowCash(c, -fineOf(c, 'dopeReport')),
                rowTrust(c, SC.reportTrust),
                rowSat(c, SC.reportSat),
              ],
              pids: [p.id],
              lasts: `정지 ${SC.reportBan}경기 (시즌을 넘기면 다음 시즌으로 이월)`,
            },
          },
          {
            label: '덮는다',
            desc: `전력 유지 · 말하지 않은 일 +1`,
            detail: {
              rows: [
                rowInfo(`${p.name} 오버롤`, `${p.ovr}`, `${p.ovr}`),
                rowInfo(`${p.name} 연봉 요구`, `+${pctTxt(SC.coverAsk)}`, '기준', 'bad'),
                rowSecret(c),
                rowInfo(`드러나면 ${TRUST_LABEL}`, `${trustAfter(c, SC.trust.dope)}`, `${c.campaign.trust}`, 'bad'),
                rowInfo('드러나면 제재금', `${fmtMoney(fineOf(c, 'dopeExposed'))} (${fineRule('dopeExposed')})`, undefined, 'bad'),
                rowInfo('드러나면', `그 시즌 별 박탈 · ${p.name} ${SC.exposeBan}경기 정지`, undefined, 'bad'),
              ],
              pids: [p.id],
              risk: DETECT_RISK,
            },
          },
          {
            label: '조용히 내보낸다',
            desc: `방출 · 잔여 연봉 ${fmtMoney(cost)}`,
            ...(blocked ? { disabled: blocked } : {}),
            detail: {
              rows: [
                rowInfo(p.name, `FA 시장으로 (오버롤 ${out.ovr})`, `1군 오버롤 ${p.ovr}`, 'bad'),
                rowCash(c, -cost),
                rowPayroll(c, -p.salary),
                ...(fr ? [rowFans(c, -p.star * SC.outFans), rowSat(c, SC.outSat)] : []),
                rowInfo('말하지 않은 일', `${secretsN(c)}건`, `${secretsN(c)}건`),
              ],
              pids: [p.id],
            },
          },
        ],
      };
    },
    resolve: (c, i, cd) => {
      const p = find(c, cd.pid);
      const ups = cd.id.split('|')[1] ?? '';
      closePlan(c);
      if (!p) return '없던 일이 되었습니다';
      if (i === 0) {
        revertMut(p, ups, SC.reportExtra);
        p.star = clamp(p.star + SC.reportStar, 0, 100);
        c.campaign.trust = trustAfter(c, SC.reportTrust);
        c.fanSat = satAfter(c, SC.reportSat);
        banMut(c, p, SC.reportBan);
        const paid = payFineMut(c, 'dopeReport');
        addNews(c, chairSays(SCANDAL_NEWS.chairReport), 'info');
        return `${p.name}의 금지 약물 사용을 리그에 신고했습니다 — ${SC.reportBan}경기 출장 정지 · 제재금 ${fmtMoney(paid)}`;
      }
      if (i === 1) {
        addSecretMut(c, 'dope', p);
        leverMut(p, SC.coverAsk);
        return '보고서는 서랍에 들어갔습니다';
      }
      const cost = releaseCost(p, c);
      if (isFranchise(p, c.season)) {
        c.fans = Math.max(1000, c.fans - p.star * SC.outFans);
        c.fanSat = satAfter(c, SC.outSat);
      }
      revertMut(p, ups, 0);
      c.finance.cash -= cost;
      c.finance.ledger.signing += cost;
      removeMut(c, p, true);
      return `${josa(p.name, '을', '를')} 이유를 밝히지 않고 방출했습니다 (잔여 연봉 ${fmtMoney(cost)})`;
    },
  },
  // ───────── 승부조작 「사무국의 전화」 ─────────
  {
    id: 'fix',
    prio: 87,
    forced: true,
    when: (c) => !!due(c, 'fix'),
    make: (c) => {
      const x = due(c, 'fix');
      if (!x) return null;
      const { p } = x;
      markCardMut(c, 'fix');
      const market = Math.max(p.salary, marketSalary(p, c.season));
      const blocked = leaveBlocked(c, p);
      return {
        id: 'fix',
        title: '사무국의 전화',
        icon: '☎️',
        pid: p.id,
        who: 'chair',
        line: '사무국에서 전화가 왔네. 그 아이 연봉이 얼마였는지, 나는 오늘 처음 들여다봤네.',
        body: `리그 사무국이 ${p.name}(${p.age}세, 연봉 ${fmtMoney(p.salary)} · 시장가 ${fmtMoney(marketSalary(p, c.season))})의 지난 ${p.kind === 'P' ? '등판' : '출전'} 기록을 요청했습니다.`,
        choices: [
          {
            label: '전면 협조한다',
            desc: `${p.name} 영구 제명 · 제재금 ${fmtMoney(fineOf(c, 'fixCoop'))}`,
            ...(blocked ? { disabled: blocked } : {}),
            detail: {
              rows: [
                rowInfo(p.name, '영구 제명', `1군 오버롤 ${p.ovr}`, 'bad'),
                rowPayroll(c, -p.salary),
                rowCash(c, -fineOf(c, 'fixCoop')),
                rowTrust(c, SC.coopTrust),
                rowSat(c, SC.coopSat),
                rowInfo('승부조작 발생 확률', `×${SC.coopMult}`, '기준', 'good'),
              ],
              pids: [p.id],
              lasts: `발생 확률은 다음 ${SC.coopSeasons}시즌`,
            },
          },
          {
            label: '선수 말을 믿는다',
            desc: `무혐의 ${pctTxt(1 - SC.trueRate)} · 사실 ${pctTxt(SC.trueRate)}`,
            detail: {
              rows: [
                rowInfo(`무혐의 ${pctTxt(1 - SC.trueRate)}`, `${p.name} 다음 재계약 요구 −${pctTxt(-SC.loyal)}`, undefined, 'good'),
                rowInfo(`사실 ${pctTxt(SC.trueRate)}`, '말하지 않은 일 +1 (어느 쪽인지 알 수 없다)', undefined, 'bad'),
                rowInfo(`드러나면 ${TRUST_LABEL}`, `${trustAfter(c, SC.trust.fix)}`, `${c.campaign.trust}`, 'bad'),
                rowInfo('드러나면 제재금', `${fmtMoney(fineOf(c, 'fixExposed'))} (${fineRule('fixExposed')})`, undefined, 'bad'),
                rowInfo('드러나면', `${SC.forfeit}승 몰수 · 다음 시즌 분배금 −${pctTxt(1 - SC.leagueCut)} · 그 시즌 별 박탈`, undefined, 'bad'),
              ],
              pids: [p.id],
              risk: `사실이면 ${DETECT_RISK}`,
            },
          },
          {
            label: '연봉을 올려 주고 넘긴다',
            desc: `연봉 ${fmtMoney(p.salary)} → ${fmtMoney(market)}`,
            detail: {
              rows: [
                rowInfo(`${p.name} 연봉`, fmtMoney(market), fmtMoney(p.salary), 'bad'),
                rowPayroll(c, market - p.salary),
                rowInfo('승부조작 대상', '제외', '대상', 'good'),
                rowInfo(`드러나면 ${TRUST_LABEL}`, `${trustAfter(c, SC.trust.fix)}`, `${c.campaign.trust}`, 'bad'),
                rowInfo('드러나면 제재금', `${fmtMoney(fineOf(c, 'fixExposed'))} (${fineRule('fixExposed')})`, undefined, 'bad'),
              ],
              pids: [p.id],
              risk: `입막음으로 보여 덮은 일로 남을 확률 ${pctTxt(SC.hushRate)}`,
            },
          },
        ],
      };
    },
    resolve: (c, i, cd, rng) => {
      const p = find(c, cd.pid);
      closePlan(c);
      if (!p) return '없던 일이 되었습니다';
      if (i === 0) {
        c.campaign.trust = trustAfter(c, SC.coopTrust);
        c.fanSat = satAfter(c, SC.coopSat);
        c.campaign.fixCoop = c.season + SC.coopSeasons;
        removeMut(c, p, false);
        const paid = payFineMut(c, 'fixCoop');
        addNews(c, chairSays(SCANDAL_NEWS.chairReport), 'info');
        return `자체 조사 자료를 사무국에 넘겼습니다 — ${p.name} 영구 제명 · 제재금 ${fmtMoney(paid)}`;
      }
      if (i === 1) {
        if (rng() < SC.trueRate) addSecretMut(c, 'fix', p, true); // 유저는 사실인지 모른다
        else {
          leverMut(p, SC.loyal);
          c.campaign.fixClear = [...(c.campaign.fixClear ?? []), p.id];
        }
        return '조사가 흐지부지됐습니다';
      }
      const market = Math.max(p.salary, marketSalary(p, c.season));
      p.salary = market;
      delete p.svc; // 보유 기간의 싼 연봉을 끝낸다
      c.campaign.fixClear = [...(c.campaign.fixClear ?? []), p.id];
      if (rng() < SC.hushRate) addSecretMut(c, 'fix', p);
      return `${p.name}의 연봉을 ${josa(fmtMoney(market), '으로', '로')} 올렸습니다 — 사무국의 전화는 다시 오지 않았습니다`;
    },
  },
];

/** 결정적 해시 (난수를 쓰지 않는 연출용) */
const hashOf = (str: string): number => {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
};
/** 기자 카드가 이번 시즌에 찾아올 덮은 일과 그날 (없으면 null) */
function pressDue(core: Core): Secret | null {
  for (const s of core.campaign.secrets ?? []) {
    const n = s.press ?? 0;
    if (s.unknown || s.season >= core.season || n >= SC.press.max || s.pressSeason === core.season) continue;
    const h = hashOf(`${s.pid}|${core.season}`);
    if (n > 0 && h % 2) continue; // 두 번째는 시즌마다 반반
    if (core.day >= dayAt(core, SC.press.from + (h % (SC.press.to - SC.press.from + 1)))) return s;
  }
  return null;
}
const fineKeyOf = (k: Kind, exposed: boolean): FineKey => (k === 'dope' ? (exposed ? 'dopeExposed' : 'dopeReport') : exposed ? 'fixExposed' : 'fixCoop');
export const hushCost = (core: Core, s: Secret): number => Math.round((fineOf(core, fineKeyOf(s.kind, true)) * SC.press.hushCost) / 100) * 100;
const confessTrust = (s: Secret) => Math.round(SC.trust[s.kind] * SC.press.confess);

/** 「기자가 냄새를 맡았다」: 덮은 일이 시즌 중에 다시 찾아온다 */
const PRESS_CARD: ScandalCardDef = {
  id: 'press',
  prio: 86,
  forced: true,
  when: (c) => !!pressDue(c),
  make: (c) => {
    const s = pressDue(c);
    if (!s) return null;
    s.press = (s.press ?? 0) + 1;
    s.pressSeason = c.season;
    const p = find(c, s.pid);
    const r0 = secretRisk(c, s);
    const rHush = secretRisk(c, s, SC.press.hush);
    const rIgn = secretRisk(c, s, SC.press.ignore);
    const cost = hushCost(c, s);
    const fine = fineOf(c, fineKeyOf(s.kind, false));
    const tr = confessTrust(s);
    const what = KIND_KO[s.kind];
    return {
      id: `press|${s.pid}|${s.season}`,
      title: '기자가 냄새를 맡았다',
      icon: '🕵️',
      ...(p ? { pid: p.id } : {}),
      who: 'marketing',
      line: `기자 한 명이 자꾸 전화를 해요. ${josa(s.name, '이', '가')} ${s.season}번째 시즌에 어땠는지만 물어요. 뭘 아는 것 같아요.`,
      body: `${s.season}번째 시즌에 덮은 ${s.name}의 ${what}. 이번 시즌 결산에서 드러날 확률은 지금 ${pctTxt(r0)}입니다.`,
      choices: [
        {
          label: '입막음한다',
          desc: `적발 위험 ${pctTxt(r0)} → ${pctTxt(rHush)} · ${fmtMoney(cost)}`,
          cashNeed: cost,
          ...(c.finance.cash < cost ? { disabled: `현금 부족 (필요 ${fmtMoney(cost)})` } : {}),
          detail: {
            rows: [
              rowCash(c, -cost),
              rowInfo('이번 시즌 말 적발 위험', pctTxt(rHush), pctTxt(r0), 'good'),
              rowInfo('다음 시즌부터 적발 위험', `+${Math.round(SC.press.hushLate * 100)}%p`, '기준', 'bad'),
              rowInfo('말하지 않은 일', `${secretsN(c)}건`, `${secretsN(c)}건`),
            ],
            ...(p ? { pids: [p.id] } : {}),
            risk: `입막음도 기록이 남는다 — 비용은 그 일의 적발 제재금(${fmtMoney(fineOf(c, fineKeyOf(s.kind, true)))})의 ${pctTxt(SC.press.hushCost)}`,
          },
        },
        {
          label: '모른 척한다',
          desc: `적발 위험 ${pctTxt(r0)} → ${pctTxt(rIgn)}`,
          detail: {
            rows: [rowInfo('이번 시즌 말 적발 위험', pctTxt(rIgn), pctTxt(r0), 'bad'), rowInfo('말하지 않은 일', `${secretsN(c)}건`, `${secretsN(c)}건`)],
            ...(p ? { pids: [p.id] } : {}),
            risk: DETECT_RISK,
          },
        },
        {
          label: '지금이라도 털어놓는다',
          desc: `${TRUST_LABEL} ${sgn(tr)} · 제재금 ${fmtMoney(fine)}`,
          detail: {
            rows: [
              rowTrust(c, tr),
              rowCash(c, -fine),
              ...(p
                ? [s.kind === 'dope' ? rowInfo(`${p.name} 출장 정지`, `${SC.reportBan}경기`, '0경기', 'bad') : rowInfo(p.name, '영구 제명', `오버롤 ${p.ovr}`, 'bad')]
                : [rowInfo(s.name, '이미 팀을 떠났습니다', undefined)]),
              rowInfo('말하지 않은 일', `${secretsN(c) - 1}건`, `${secretsN(c)}건`, 'good'),
              rowInfo('드러났을 때와 비교', `${TRUST_LABEL} ${SC.trust[s.kind]} → ${tr} · 제재금 ${fmtMoney(fineOf(c, fineKeyOf(s.kind, true)))} → ${fmtMoney(fine)}${s.kind === 'fix' ? ` · ${SC.forfeit}승 몰수 없음` : ''}`, undefined, 'good'),
            ],
            ...(p ? { pids: [p.id] } : {}),
          },
        },
      ],
    };
  },
  resolve: (c, i, cd) => {
    const [, pid, ss] = cd.id.split('|');
    const s = (c.campaign.secrets ?? []).find((x) => x.pid === pid && x.season === Number(ss));
    if (!s) return '없던 일이 되었습니다';
    if (i === 0) {
      const cost = hushCost(c, s);
      c.finance.cash -= cost;
      c.finance.ledger.upkeep += cost;
      s.heat = SC.press.hush;
      s.heatSeason = c.season;
      s.hushAt = [...(s.hushAt ?? []), c.season];
      return `기자는 더 묻지 않았습니다 (${fmtMoney(cost)}) — 이번 시즌 말 적발 위험 ${pctTxt(secretRisk(c, s))}`;
    }
    if (i === 1) {
      s.heat = SC.press.ignore;
      s.heatSeason = c.season;
      return `전화를 받지 않았습니다 — 이번 시즌 말 적발 위험 ${pctTxt(secretRisk(c, s))}`;
    }
    c.campaign.secrets = (c.campaign.secrets ?? []).filter((x) => x !== s);
    c.campaign.trust = trustAfter(c, confessTrust(s));
    const paid = payFineMut(c, fineKeyOf(s.kind, false));
    const p = find(c, s.pid);
    if (p && s.kind === 'dope') {
      p.star = clamp(p.star + SC.reportStar, 0, 100);
      banMut(c, p, SC.reportBan);
    } else if (p) removeMut(c, p, false);
    addNews(c, chairSays(SCANDAL_NEWS.chairReport), 'info');
    return `${s.season}번째 시즌에 덮은 ${s.name}의 ${KIND_KO[s.kind]} 사실을 리그에 털어놓았습니다 — ${TRUST_LABEL} ${sgn(confessTrust(s))} · 제재금 ${fmtMoney(paid)}${p ? (s.kind === 'dope' ? ` · ${p.name} ${SC.reportBan}경기 정지` : ` · ${p.name} 영구 제명`) : ''}`;
  },
};
SCANDAL_CARDS.push(PRESS_CARD);

// ───────── 적발 (결산) ─────────

export const detectChance = (elapsed: number): number => Math.min(SC.detectMax, SC.detect0 + SC.detectStep * Math.max(0, elapsed));
/** 덮은 일 한 건의 이번 시즌 결산 적발 확률: 기본(해마다 오른다) + 기자 카드의 선택 */
export function secretRisk(core: Pick<Core, 'season'>, s: Secret, heat = s.heatSeason === core.season ? (s.heat ?? 0) : 0): number {
  const late = SC.press.hushLate * (s.hushAt ?? []).filter((x) => x < core.season).length;
  const r = detectChance(core.season - s.season) + heat + late;
  return heat || late ? clamp(r, SC.press.floor, SC.press.cap) : r;
}
/** 유저가 아는 덮은 일 중 한 건 이상이 이번 시즌 말에 드러날 확률 (없으면 null) */
export function exposeRisk(core: Core): number | null {
  const xs = (core.campaign.secrets ?? []).filter((x) => !x.unknown);
  const at = { season: core.phase === 'season' || core.phase === 'post' ? core.season : core.season + 1 }; // 결산 뒤에는 다음 시즌 말
  return xs.length ? 1 - xs.reduce((q, s) => q * (1 - secretRisk(at, s)), 1) : null;
}
/** 이 선수와 관련된, 유저가 아는 덮은 일 */
export const secretOf = (core: Pick<Core, 'campaign'>, pid: string): Secret | undefined => (core.campaign.secrets ?? []).find((x) => !x.unknown && x.pid === pid);

/**
 * 결산의 맨 앞 (mutate): 덮은 일마다 적발 판정. 드러난 건은 선수 징계·승수 몰수·벌금을 바로 적용하고 목록을 돌려준다.
 * 도민 지지와 별 박탈은 concludeMut 이 이 목록으로 처리한다.
 */
export function exposeMut(core: Core, rng: Rng, champion: boolean): Exposure[] {
  const c = core.campaign;
  const out: Exposure[] = [];
  const keep: Secret[] = [];
  let trustNow = c.trust;
  for (const s of c.secrets ?? []) {
    if (rng() >= secretRisk(core, s)) {
      keep.push(s);
      continue;
    }
    const t = userTeam(core);
    const p = t.roster.find((x) => x.id === s.pid);
    const past = c.history.find((h) => h.season === s.season);
    const tainted = past ? past.post === 'champion' : champion;
    if (past && tainted) past.tainted = true;
    const ex: Exposure = { kind: s.kind, name: s.name, season: s.season, trust: SC.trust[s.kind], stars: 0, wins: 0, fine: 0, ban: 0, tainted, trustFrom: trustNow };
    trustNow = clamp(trustNow + ex.trust, 0, 100);
    if (s.kind === 'dope') {
      if (p) {
        p.bat = batZero();
        p.pit = pitZero();
        p.star = clamp(p.star + SC.exposeStar, 0, 100);
        banMut(core, p, SC.exposeBan);
        ex.ban = SC.exposeBan;
      }
      ex.fine = payFineMut(core, 'dopeExposed');
    } else {
      if (p) removeMut(core, p, false);
      const r0 = rankOf(core.teams, core.userId);
      ex.wFrom = t.rec.w;
      ex.wins = Math.min(SC.forfeit, t.rec.w);
      t.rec.w -= ex.wins;
      t.rec.l += ex.wins;
      ex.rank = [r0, rankOf(core.teams, core.userId)];
      ex.fine = payFineMut(core, 'fixExposed');
      c.leagueCut = { season: core.season + 1, mult: SC.leagueCut };
    }
    c.exposed = (c.exposed ?? 0) + 1;
    addNews(core, SCANDAL_NEWS.exposed(KIND_KO[s.kind], s.name, s.season), 'bad');
    out.push(ex);
  }
  if (c.secrets) c.secrets = keep;
  if (out.length) addNews(core, chairSays(SCANDAL_NEWS.chairExposed), 'bad');
  return out;
}

/** 적발 한 건을 결산 화면에 적는 줄들 */
export function exposureLines(ex: Exposure): { what: string; lost: string[] } {
  const lost = [`${TRUST_LABEL} ${ex.trust}`];
  if (ex.stars) lost.push(`이번 시즌 별 ${ex.stars}개 박탈`);
  if (ex.wins) lost.push(`${ex.wins}승 몰수`);
  if (ex.fine) lost.push(`제재금 ${fmtMoney(ex.fine)}`);
  if (ex.kind === 'fix') lost.push(`다음 시즌 리그 분배금 −${pctTxt(1 - SC.leagueCut)}`);
  lost.push(ex.kind === 'fix' ? `${ex.name} 영구 제명` : ex.ban ? `${ex.name} ${ex.ban}경기 정지 · 시즌 기록 삭제` : '선수는 이미 팀을 떠났습니다');
  if (ex.tainted) lost.push(SCANDAL_NEWS.tainted);
  return { what: `${ex.season}번째 시즌에 덮은 ${ex.name}의 ${KIND_KO[ex.kind]} 사실이 드러났습니다`, lost };
}

/** 리그 사무국 긴급 발표 화면의 전 → 후 줄들 (결산 전 장면) */
export function exposureRows(ex: Exposure): { label: string; from?: string; to: string }[] {
  const rows: { label: string; from?: string; to: string }[] = [];
  rows.push(ex.trustFrom !== undefined ? { label: TRUST_LABEL, from: `${ex.trustFrom}`, to: `${clamp(ex.trustFrom + ex.trust, 0, 100)}` } : { label: TRUST_LABEL, to: `${ex.trust}` });
  if (ex.wins) rows.push({ label: `${ex.wins}승 몰수`, ...(ex.wFrom !== undefined ? { from: `${ex.wFrom}승`, to: `${ex.wFrom - ex.wins}승` } : { to: `−${ex.wins}승` }) });
  if (ex.rank && ex.rank[0] !== ex.rank[1]) rows.push({ label: '정규시즌 순위', from: `${ex.rank[0]}위`, to: `${ex.rank[1]}위` });
  if (ex.fine) rows.push({ label: '제재금', to: `−${fmtMoney(ex.fine)}` });
  if (ex.kind === 'fix') rows.push({ label: '다음 시즌 리그 분배금', from: '100%', to: pctTxt(SC.leagueCut) });
  rows.push({ label: ex.name, to: ex.kind === 'fix' ? '영구 제명' : ex.ban ? `${ex.ban}경기 출장 정지 · 시즌 기록 삭제` : '이미 팀을 떠났습니다' });
  return rows;
}
export const exposureWhat = (ex: Exposure): string => `${ex.season}번째 시즌에 덮은 ${ex.name}의 ${KIND_KO[ex.kind]}`;
