// 부채 한도 초과: 자동 강제 매각 대신 유저가 고르는 매각 카드 (조합장).
//  · 후보 = 1군에서 최소 인원을 지키며 팔 수 있는 선수 중 연봉 높은 순 2명 + 가성비가 가장 나쁜 1명. 대금 = 시장 연봉 × DEBT_SALE_RATE
//  · 1군에 팔 선수가 없으면 2군 선수가 후보. 그것도 없으면 조합 특별 출자(지지 −BAILOUT_TRUST, 부채를 한도까지 탕감, 시즌 1회)
//  · "조합에 맡긴다" = 예전 자동 매각: 최고 연봉 선수를 연봉의 FORCED_SALE_RATE 에
//  · 한 번에 한도 아래로 못 내려가면 다음 경기 뒤 다시 온다 (같은 날 연속 금지 · 일반 카드 예산과 별도)
import type { Core, EventCard, Player, Team } from './types';
import { BAILOUT_TRUST, DEBT_SALE_RATE, FORCED_SALE_RATE, MIN_BATTERS, MIN_PITCHERS, activeRoster, loanLimit, overLimit, userTeam } from './economy';
import { rowInfo } from './eventRows';
import { fmtInt, fmtMoney } from './format';
import { isFranchise } from './franchise';
import { fixLineup } from './lineup';
import { memoNum, memoSet } from './memo';
import { teamParts } from './ratings';
import { addNews, marketSalary } from './season';
import { NEWS, TRUST_LABEL } from './story';

export const DEBT_SALE_ID = 'debtsale';
const FRANCHISE_FANS = 8; // 프랜차이즈 스타를 팔면 팬 − star × 이 값 (방출과 같다)
const FRANCHISE_SAT = -8;

const power = (t: Team) => {
  const p = teamParts(t);
  return p.bat + p.def + p.rot + p.pen;
};
/** 그 선수를 보낸 뒤 전력 4칸 합의 감소 */
export function powerLoss(core: Core, pid: string): number {
  const t = structuredClone(userTeam(core));
  const a = power(t);
  t.roster = t.roster.filter((p) => p.id !== pid);
  fixLineup(t);
  return Math.max(0, Math.round(a - power(t)));
}
export const debtSalePrice = (core: Pick<Core, 'season'>, p: Player) => Math.round(marketSalary(p, core.season) * DEBT_SALE_RATE);
const autoPrice = (p: Player) => Math.round(p.salary * FORCED_SALE_RATE);
/** 가성비: 능력 대비 연봉 (클수록 나쁘다) */
const badValue = (p: Player) => p.salary / Math.max(5, p.ovr - 50);

/** 매각 후보. picks = 유저가 고를 선수(최대 3: 연봉 순 2 + 가성비 최악 1 — 마지막이 가성비 최악), auto = 조합에 맡기면 팔릴 선수 */
export function saleCandidates(core: Core): { picks: Player[]; auto: Player | null; farm: boolean } {
  const t = userTeam(core);
  const act = activeRoster(t);
  const nb = act.filter((p) => p.kind === 'B').length;
  const np = act.filter((p) => p.kind === 'P').length;
  const main = act.filter((p) => (p.kind === 'B' ? nb > MIN_BATTERS : np > MIN_PITCHERS));
  const farm = t.roster.filter((p) => p.farm);
  const pool = (main.length ? main : farm).slice().sort((a, b) => b.salary - a.salary);
  const top = pool.slice(0, 2);
  const rest = pool.slice(2).sort((a, b) => badValue(b) - badValue(a));
  const auto = [...main, ...farm].sort((a, b) => b.salary - a.salary)[0] ?? null;
  return { picks: rest.length ? [...top, rest[0]] : top, auto, farm: !main.length && farm.length > 0 };
}

const after = (core: Core, price: number) => Math.max(0, core.finance.debt - price);

function saleChoice(core: Core, p: Player, price: number, label: string, worst: boolean): EventCard['choices'][number] {
  const fr = isFranchise(p, core.season);
  const loss = powerLoss(core, p.id);
  const debt = core.finance.debt;
  const lim = loanLimit(core);
  return {
    label,
    desc: `매각 ${fmtMoney(price)} · 부채 ${fmtMoney(debt)} → ${fmtMoney(after(core, price))} · 전력 −${loss}${fr ? ' · 팬 반발' : ''}`,
    detail: {
      rows: [
        rowInfo('매각 대금', fmtMoney(price), undefined, 'good'),
        rowInfo('부채', fmtMoney(after(core, price)), fmtMoney(debt), after(core, price) > lim ? 'bad' : 'good'),
        rowInfo('한도', fmtMoney(lim), undefined, 'info'),
        rowInfo('전력(4칸 합)', `−${loss}`, undefined, loss > 0 ? 'bad' : 'info'),
        rowInfo('연봉 총액', `−${fmtMoney(p.salary)}`, undefined, 'good'),
        ...(fr ? [rowInfo('프랜차이즈 스타', `팬 −${fmtInt(p.star * FRANCHISE_FANS)} · 만족도 ${FRANCHISE_SAT}`, undefined, 'bad' as const)] : []),
        ...(worst ? [rowInfo('가성비', '연봉 대비 능력이 가장 낮다', undefined, 'info' as const)] : []),
      ],
      pids: [p.id],
      ...(after(core, price) > lim ? { risk: '한도 아래로 내려가지 않으면 다음 경기 뒤 다시 논의합니다' } : {}),
    },
  };
}

/** 지금 낼 매각 카드 (한도 초과가 아니거나 낼 수 없으면 null) */
export function debtSaleCard(core: Core): EventCard | null {
  if (!overLimit(core)) return null;
  const { picks, auto, farm } = saleCandidates(core);
  const debt = core.finance.debt;
  const lim = loanLimit(core);
  const base = { icon: '🏦', who: 'chair' as const };
  if (!picks.length || !auto) {
    if (core.campaign.bailout === core.season) return null;
    const t0 = core.campaign.trust;
    return {
      id: `${DEBT_SALE_ID}|bailout`, ...base, title: '조합 특별 출자',
      line: '팔 선수도 없다니. 조합원들 주머니를 한 번 더 털겠네. 두 번은 없네.',
      body: `부채 ${fmtMoney(debt)} — 한도 ${fmtMoney(lim)}를 넘었지만 보낼 선수가 없습니다.`,
      choices: [{
        label: '특별 출자를 받는다',
        desc: `부채 ${fmtMoney(debt)} → ${fmtMoney(lim)} · ${TRUST_LABEL} −${BAILOUT_TRUST}`,
        detail: { rows: [rowInfo('부채', fmtMoney(lim), fmtMoney(debt), 'good'), rowInfo(TRUST_LABEL, `${Math.max(0, t0 - BAILOUT_TRUST)}`, `${t0}`, 'bad')], lasts: '시즌 1회' },
      }],
    };
  }
  const worst = picks.length === 3 ? picks[2].id : '';
  return {
    id: `${DEBT_SALE_ID}|${picks.map((p) => p.id).join(',')}|${auto.id}`, ...base, title: '부채 한도 초과',
    line: '누군가를 보내야 하네. 누구를 보낼지는 자네가 정하게.',
    body: `부채 ${fmtMoney(debt)} — 한도 ${fmtMoney(lim)}를 ${fmtMoney(debt - lim)} 넘었습니다.${farm ? ' 1군은 최소 인원이라 2군에서 보냅니다.' : ''}`,
    choices: [
      ...picks.map((p) => saleChoice(core, p, debtSalePrice(core, p), `${p.name}${p.id === worst ? ' (가성비 최악)' : ''}`, p.id === worst)),
      saleChoice(core, auto, autoPrice(auto), '조합에 맡긴다', false),
    ],
  };
}

function sellMut(core: Core, p: Player, price: number): string {
  const t = userTeam(core);
  const f = core.finance;
  t.roster = t.roster.filter((x) => x.id !== p.id);
  if (core.campaign.block) core.campaign.block = core.campaign.block.filter((id) => id !== p.id);
  f.ledger.sales += price;
  f.debt -= price;
  if (f.debt < 0) {
    f.cash += -f.debt;
    f.debt = 0;
  }
  if (isFranchise(p, core.season)) {
    core.fans = Math.max(1000, core.fans - p.star * FRANCHISE_FANS);
    core.fanSat = Math.max(0, Math.min(100, core.fanSat + FRANCHISE_SAT));
    addNews(core, NEWS.franchiseGone(p.name), 'bad');
  }
  fixLineup(t);
  return `${p.name} 매각 (${fmtMoney(price)}) — 부채 ${fmtMoney(f.debt)}`;
}

export function resolveDebtSaleMut(core: Core, idx: number, card: EventCard): string {
  const [, a, b] = card.id.split('|');
  if (a === 'bailout') {
    const lim = loanLimit(core);
    core.finance.debt = Math.min(core.finance.debt, lim);
    core.campaign.trust = Math.max(0, core.campaign.trust - BAILOUT_TRUST);
    core.campaign.bailout = core.season;
    return `조합 특별 출자 — 부채 ${fmtMoney(lim)} · ${TRUST_LABEL} −${BAILOUT_TRUST}`;
  }
  const ids = a.split(',');
  const t = userTeam(core);
  const auto = idx >= ids.length;
  const p = t.roster.find((x) => x.id === (auto ? b : ids[idx]));
  if (!p) return '보낼 선수가 이미 팀에 없습니다';
  return sellMut(core, p, auto ? autoPrice(p) : debtSalePrice(core, p));
}

/** 매 경기 뒤: 한도 초과면 매각 카드를 둔다 (하루 한 장). 없으면 null */
export function drawDebtSale(core0: Core): Core | null {
  if (!overLimit(core0) || memoNum(core0, 'saleDay', -1) === core0.day) return null;
  const cd = debtSaleCard(core0);
  if (!cd) return null;
  const core = structuredClone(core0);
  core.campaign.event = cd;
  memoSet(core, 'saleDay', core.day);
  memoSet(core, 'saleN', memoNum(core, 'saleN') + 1);
  addNews(core, `${cd.icon} 조합장 — ${cd.title}`, 'bad');
  return core;
}
