// 빚 갚을 거리: 부채가 한도의 절반을 넘으면 시즌에 한 장 오는 작은 거래 (둘 중 먼저 맞는 것) (events.ts 카드 목록에 들어간다)
//  · 「구장 대관」(마케팅 팀장): 휴식일 콘서트. 대관료(좌석 수 비례)로 빚을 갚고, 잔디가 상해 다음 홈 몇 경기 수비가 흔들린다
//  · 「현금 매입 제안」(조합장): 다른 구단이 우리 후보 선수를 현금으로 산다 (방출 추천 선수가 먼저). 대금으로 빚을 갚는다
// 받은 돈은 금고가 아니라 부채 상환으로 간다 (남으면 금고). 한도 초과는 매각 카드(debt.ts)의 몫이라 여기서는 내지 않는다.
import type { Core, EventCard, Player } from './types';
import { pick, type Rng } from './rng';
import { LOAN_WARN, MIN_BATTERS, MIN_PITCHERS, activeRoster, capacityOf, loanLimit, overLimit, userTeam } from './economy';
import { rowInfo } from './eventRows';
import { fmtInt, fmtMoney, josa } from './format';
import { isFranchise } from './franchise';
import { fixLineup } from './lineup';
import { memoNum } from './memo';
import { marketSalary } from './season';
import { dayAt } from './league';
import { trFrom, trTo } from './trade';
import { powerLoss } from './debt';

export const RF = {
  gap: 8, // 다른 카드와 최소 경기 수 (events.ts EVENT_GAP 과 같은 값 — 모듈 순환을 피하려고 따로 둔다)
  rentPerSeat: 5, // 대관료 = 좌석 수 × 이 값 (만원) — 13,000석이면 6.5억
  turf: -5, // 잔디 손상: 홈경기 수비
  turfGames: 4, // 홈경기 수
  rentFrom: 12, // 대관 제안이 오는 구간 (84경기 기준)
  rentTo: 72,
  buyRate: 0.9, // 매입 대금 = 시장 연봉 × 이 값 (한도 초과 매각 0.6 보다 후하다)
};

interface ReliefCardDef {
  id: string;
  prio: number;
  forced: boolean;
  when: (core: Core) => boolean;
  make: (core: Core, rng: Rng) => EventCard | null;
  resolve: (core: Core, idx: number, card: EventCard, rng: Rng) => string;
}

/** 부채가 한도의 절반 이상(한도 초과는 아님)이고, 다른 카드와 간격이 떨어졌고, 이번 시즌 빚 갚을 거리가 아직 안 왔는가 */
const indebted = (c: Core) =>
  c.finance.debt >= loanLimit(c) * LOAN_WARN && !overLimit(c) && c.day - memoNum(c, 'evDay', -99) >= RF.gap && !c.campaign.eventsSeen.some((id) => RELIEF_IDS.includes(id));
/** 시즌에 둘 중 한 장만 */
const RELIEF_IDS = ['rental', 'buyout'];

/** 받은 돈으로 빚부터 갚는다 (남으면 금고). 반환: 갚은 뒤 부채 */
function repayMut(core: Core, v: number): number {
  const f = core.finance;
  f.debt -= v;
  if (f.debt < 0) {
    f.cash += -f.debt;
    f.debt = 0;
  }
  return f.debt;
}
const debtAfter = (core: Core, v: number) => Math.max(0, core.finance.debt - v);
const debtText = (v: number) => (v > 0 ? fmtMoney(v) : '없음');

const badValue = (p: Player) => p.salary / Math.max(5, p.ovr - 50);

export const rentFee = (core: Core): number => Math.round((capacityOf(core) * RF.rentPerSeat) / 1000) * 1000;

/** 사 갈 선수: 주전·선발·마무리가 아닌 1군 선수 중 연봉 대비 능력이 가장 나쁜 선수 (debt.ts 가성비와 같은 잣대). 최소 인원·프랜차이즈 스타는 건드리지 않는다.
 *  release.ts 는 runway.ts 를 거쳐 economy.ts 로 순환해 앱이 뜨지 않으므로 쓰지 않는다 */
export function buyoutTarget(core: Core): Player | null {
  const t = userTeam(core);
  const act = activeRoster(t);
  const nb = act.filter((p) => p.kind === 'B').length;
  const np = act.filter((p) => p.kind === 'P').length;
  const ok = (p: Player) => !p.farm && !isFranchise(p, core.season) && (p.kind === 'B' ? nb > MIN_BATTERS : np > MIN_PITCHERS);
  const key = new Set([...t.lineup.map((s) => s.pid), ...t.rotation, ...(t.closer ? [t.closer] : [])]);
  return act.filter((p) => ok(p) && !key.has(p.id)).sort((a, b) => badValue(b) - badValue(a))[0] ?? null;
}
export const buyoutPrice = (core: Pick<Core, 'season'>, p: Player): number => Math.round((marketSalary(p, core.season) * RF.buyRate) / 1000) * 1000;

export const RELIEF_CARDS: ReliefCardDef[] = [
  {
    id: 'rental',
    prio: 30,
    forced: true,
    when: (c) => indebted(c) && c.day >= dayAt(c, RF.rentFrom) && c.day <= dayAt(c, RF.rentTo),
    make: (c) => {
      const fee = rentFee(c);
      const debt = c.finance.debt;
      return {
        id: `rental|${fee}`,
        icon: '🎤',
        who: 'marketing',
        title: '구장 대관 제안',
        line: '육지 공연 기획사에서 연락이 왔어요! 쉬는 날 우리 구장에서 콘서트를 하고 싶대요.',
        body: `대관료 ${fmtMoney(fee)}(${fmtInt(capacityOf(c))}석)는 바로 빚을 갚는 데 씁니다.`,
        choices: [
          {
            label: '빌려준다',
            desc: `부채 −${fmtMoney(fee)} · 홈 ${RF.turfGames}경기 수비 ${RF.turf}`,
            detail: {
              rows: [rowInfo('부채', debtText(debtAfter(c, fee)), fmtMoney(debt), 'good'), rowInfo('잔디 손상', `홈경기 수비 ${RF.turf}`, undefined, 'bad')],
              lasts: `홈 ${RF.turfGames}경기`,
            },
          },
          { label: '거절한다', desc: '변화 없음', detail: { rows: [rowInfo('부채', fmtMoney(debt), fmtMoney(debt))] } },
        ],
      };
    },
    resolve: (c, i, cd) => {
      if (i !== 0) return '구장은 야구만 하기로 했습니다';
      const fee = Number(cd.id.split('|')[1]) || 0;
      c.finance.ledger.league += fee;
      const d = repayMut(c, fee);
      c.campaign.buffs.push({ kind: 'turf', value: RF.turf, until: c.schedule.length, left: RF.turfGames, label: `잔디 손상 (홈 수비 ${RF.turf})` });
      return `대관료 ${fmtMoney(fee)} — 부채 ${fmtMoney(d)}`;
    },
  },
  {
    id: 'buyout',
    prio: 31,
    forced: true,
    when: (c) => indebted(c) && c.day >= trFrom(c) && c.day <= trTo(c) && !!buyoutTarget(c),
    make: (c, rng) => {
      const p = buyoutTarget(c);
      if (!p) return null;
      const buyer = pick(rng, c.teams.filter((t) => t.id !== c.userId));
      const price = buyoutPrice(c, p);
      const debt = c.finance.debt;
      const loss = powerLoss(c, p.id);
      return {
        id: `buyout|${p.id}|${buyer.id}|${price}`,
        icon: '💼',
        who: 'chair',
        pid: p.id,
        title: '현금 매입 제안',
        line: `${josa(buyer.name, '이', '가')} ${josa(p.name, '을', '를')} 현금으로 사겠다네. 그 돈이면 빚을 좀 덜 수 있겠어.`,
        body: `매입 대금 ${fmtMoney(price)}는 바로 빚을 갚는 데 씁니다.`,
        choices: [
          {
            label: '판다',
            desc: `부채 −${fmtMoney(price)} · 연봉 −${fmtMoney(p.salary)}${loss > 0 ? ` · 전력 −${loss}` : ''}`,
            detail: {
              rows: [
                rowInfo('부채', debtText(debtAfter(c, price)), fmtMoney(debt), 'good'),
                rowInfo('연봉 총액', `−${fmtMoney(p.salary)}`, undefined, 'good'),
                rowInfo('전력(4칸 합)', loss > 0 ? `−${loss}` : '거의 없음', undefined, loss > 0 ? 'bad' : 'info'),
              ],
              pids: [p.id],
            },
          },
          { label: '거절한다', desc: '변화 없음', detail: { rows: [rowInfo('부채', fmtMoney(debt), fmtMoney(debt))], pids: [p.id] } },
        ],
      };
    },
    resolve: (c, i, cd) => {
      const [, pid, buyerId, priceS] = cd.id.split('|');
      const t = userTeam(c);
      const p = t.roster.find((x) => x.id === pid);
      const buyer = c.teams.find((x) => x.id === buyerId)?.name ?? '상대 구단';
      if (i !== 0) return p ? `${josa(p.name, '은', '는')} 남습니다` : '제안을 돌려보냈습니다';
      if (!p) return '보낼 선수가 이미 팀에 없습니다';
      const price = Number(priceS) || 0;
      t.roster = t.roster.filter((x) => x.id !== p.id);
      if (c.campaign.block) c.campaign.block = c.campaign.block.filter((id) => id !== p.id);
      c.finance.ledger.sales += price;
      const d = repayMut(c, price);
      fixLineup(t);
      return `${p.name} 매각 (${fmtMoney(price)}) — 부채 ${fmtMoney(d)}`;
    },
  },
];
