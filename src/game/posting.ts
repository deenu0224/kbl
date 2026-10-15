// 메이저리그 포스팅 (스토브리그 카드, 조합장)
//  · 「메이저리그의 부름」: 오래 함께한 젊은 핵심 선수에게 메이저리그 구단이 손을 내민다
//      보내 준다 = 포스팅 이적료(시장 연봉 × MLB.feeMult)로 빚부터 갚고 남으면 금고 · 도민 지지 +MLB.trust
//      붙잡는다 = 다년 대우로 연봉 × MLB.keepRaise · 다음 스토브리그에 한 번 더 온다 (두 번 붙잡으면 끝)
//  · 「돌아온 메이저리거」: 보낸 지 MLB.backAfter 시즌 뒤, 시장 연봉으로 돌아오겠다고 한다 (한 번뿐)
// drawStoveTrade(trade.ts)가 트레이드 제안보다 먼저 부른다. 상태는 시즌을 넘겨 남아야 해서 memo 가 아니라 campaign.mlb · Player.mlbAsk 에 둔다.
import type { Core, EventCard, Player } from './types';
import type { Rng } from './rng';
import { ROSTER_MAX, activeRoster, farmMax, farmRoster, userTeam } from './economy';
import { rowInfo } from './eventRows';
import { fmtMoney, josa } from './format';
import { seasonsWith } from './franchise';
import { fixLineup, slotNewcomer } from './lineup';
import { memoGet, memoSet } from './memo';
import { marketSalary } from './season';
import { TRUST_LABEL } from './story';

export const MLB_ID = 'mlb';
export const MLB = {
  maxAge: 28, // 이 나이 이하
  minOvr: 72, // 오버롤 이 이상
  top: 3, // 팀 내 오버롤 상위 이 인원 안
  minSeasons: 4, // 우리 구단에서 이 시즌 이상 (KBO 포스팅 7년의 축소판)
  chance: 0.4, // 자격이 되는 선수가 있을 때 제안이 올 확률
  gap: 3, // 제안끼리 최소 시즌 간격 (붙잡은 선수의 재요청은 예외)
  feeMult: 2, // 포스팅 이적료 = 시장 연봉 × 이 값
  trust: 3, // 보내 주면 도민 지지
  keepRaise: 1.25, // 붙잡으면 연봉 배율
  asks: 2, // 한 선수에게 오는 최대 횟수
  backAfter: 4, // 보낸 뒤 이 시즌이 지나면 복귀 카드
  backMaxAge: 36, // 돌아올 때 이 나이 이하
};

const top = (core: Core): Player[] =>
  activeRoster(userTeam(core))
    .slice()
    .sort((a, b) => b.ovr - a.ovr)
    .slice(0, MLB.top);

/** 포스팅 대상: 붙잡았던 선수가 아직 자격이 되면 그 선수, 아니면 조건에 맞는 가장 높은 오버롤 */
export function postingTarget(core: Core): Player | null {
  const ok = (p: Player) => !p.foreign && !p.farm && p.age <= MLB.maxAge && p.ovr >= MLB.minOvr && seasonsWith(p, core.season) >= MLB.minSeasons && (p.mlbAsk ?? 0) < MLB.asks;
  const cand = top(core).filter(ok);
  return cand.find((p) => (p.mlbAsk ?? 0) > 0) ?? cand[0] ?? null;
}
export const postingFee = (core: Pick<Core, 'season'>, p: Player): number => Math.round((marketSalary(p, core.season) * MLB.feeMult) / 1000) * 1000;

/** 받은 돈: 빚부터 갚고 남으면 금고. 반환 = [갚은 액수, 금고에 든 액수] */
function payInMut(core: Core, v: number): [number, number] {
  const f = core.finance;
  const repay = Math.min(f.debt, v);
  f.debt -= repay;
  f.cash += v - repay;
  return [repay, v - repay];
}
const moneyRows = (core: Core, v: number) => {
  const repay = Math.min(core.finance.debt, v);
  return [
    ...(repay > 0 ? [rowInfo('부채', core.finance.debt - repay > 0 ? fmtMoney(core.finance.debt - repay) : '없음', fmtMoney(core.finance.debt), 'good' as const)] : []),
    ...(v - repay > 0 ? [rowInfo('현금', fmtMoney(core.finance.cash + v - repay), fmtMoney(core.finance.cash), 'good' as const)] : []),
  ];
};

function postingCard(core: Core, p: Player): EventCard {
  const fee = postingFee(core, p);
  const again = (p.mlbAsk ?? 0) > 0;
  const raise = Math.round((p.salary * MLB.keepRaise) / 100) * 100;
  const repay = Math.min(core.finance.debt, fee);
  return {
    id: `${MLB_ID}|post|${p.id}|${fee}`,
    icon: '✈️',
    who: 'chair',
    pid: p.id,
    title: '메이저리그의 부름',
    line: again
      ? `${josa(p.name, '이', '가')} 다시 찾아왔네. 꿈을 한 번 더 미루라고 하기는 어렵겠어.`
      : `메이저리그 구단이 ${josa(p.name, '을', '를')} 원한다네. 섬에서 메이저리거가 나오는 거야.`,
    body: repay > 0 ? '이적료는 부채부터 갚습니다' : `${p.age}세 · 오버롤 ${p.ovr}`,
    choices: [
      {
        label: '보내 준다',
        desc: `이적료 ${fmtMoney(fee)} · ${TRUST_LABEL} +${MLB.trust}`,
        detail: { rows: [...moneyRows(core, fee), rowInfo('연봉 총액', `−${fmtMoney(p.salary)}`, undefined, 'good'), rowInfo(TRUST_LABEL, `+${MLB.trust}`, undefined, 'good')], pids: [p.id] },
      },
      {
        label: '붙잡는다',
        desc: `연봉 ${fmtMoney(p.salary)} → ${fmtMoney(raise)}${again ? '' : ' · 내년에 다시 온다'}`,
        detail: {
          rows: [rowInfo('연봉', fmtMoney(raise), fmtMoney(p.salary), 'bad')],
          pids: [p.id],
          lasts: again ? '다시 오지 않는다' : '다음 스토브리그에 한 번 더',
        },
      },
    ],
  };
}

/** 돌아올 선수: 보낸 지 backAfter 시즌이 지났고 아직 뛸 나이 */
function comeback(core: Core): { p: Player; season: number } | null {
  return core.campaign.mlb?.gone.find((g) => core.season - g.season >= MLB.backAfter && g.p.age + (core.season - g.season) <= MLB.backMaxAge) ?? null;
}

function backCard(core: Core, g: { p: Player; season: number }): EventCard {
  const t = userTeam(core);
  const salary = marketSalary(g.p, core.season);
  const full = activeRoster(t).length >= ROSTER_MAX && farmRoster(t).length >= farmMax(core);
  return {
    id: `${MLB_ID}|back|${g.p.id}|${salary}`,
    icon: '🛬',
    who: 'chair',
    pid: g.p.id,
    title: '돌아온 메이저리거',
    line: `${josa(g.p.name, '이', '가')} 섬으로 돌아오고 싶다네. 마지막은 여기서 뛰고 싶다고.`,
    body: `${core.season - g.season}시즌 만의 복귀`,
    choices: [
      {
        label: '맞이한다',
        desc: `연봉 ${fmtMoney(salary)}`,
        ...(full ? { disabled: '1군·2군이 가득 찼습니다' } : {}),
        detail: { rows: [rowInfo('연봉 총액', `+${fmtMoney(salary)}`, undefined, 'bad')], pids: [g.p.id] },
      },
      { label: '사양한다', desc: '다른 구단으로 간다', detail: { rows: [rowInfo('변화', '없음')], pids: [g.p.id] } },
    ],
  };
}

/** 스토브리그(결산 뒤) 한 번: 복귀 카드 → 포스팅 카드. 낼 카드가 없으면 원본 */
export function drawMlb(core0: Core, rng: Rng): Core {
  if (core0.phase !== 'ended' || core0.campaign.event || memoGet(core0, 'mlbStove')) return core0;
  const core = structuredClone(core0);
  memoSet(core, 'mlbStove', 1);
  const g = comeback(core);
  if (g) {
    core.campaign.event = backCard(core, g);
    return core;
  }
  const p = postingTarget(core);
  if (!p) return core;
  const again = (p.mlbAsk ?? 0) > 0;
  const last = core.campaign.mlb?.last ?? -99;
  if (!again && (core.season - last < MLB.gap || rng() >= MLB.chance)) return core;
  core.campaign.mlb = { last: core.season, gone: core.campaign.mlb?.gone ?? [] };
  core.campaign.event = postingCard(core, p);
  return core;
}

export function resolveMlbMut(core: Core, idx: number, card: EventCard): string {
  const [, kind, pid, v] = card.id.split('|');
  const amount = Number(v) || 0;
  const t = userTeam(core);
  const mlb = (core.campaign.mlb ??= { last: core.season, gone: [] });
  if (kind === 'back') {
    const g = mlb.gone.find((x) => x.p.id === pid);
    mlb.gone = mlb.gone.filter((x) => x.p.id !== pid);
    if (!g) return '이미 지나간 이야기입니다';
    if (idx !== 0) return `${josa(g.p.name, '은', '는')} 다른 구단 유니폼을 입습니다`;
    const p = g.p;
    p.age += core.season - g.season;
    p.salary = amount;
    p.since = core.season;
    delete p.svc;
    delete p.ask;
    delete p.mlbAsk;
    p.injury = 0;
    if (activeRoster(t).length >= ROSTER_MAX) p.farm = true;
    t.roster.push(p);
    if (!p.farm) slotNewcomer(t, p);
    fixLineup(t);
    return `${p.name} 복귀 — 연봉 ${fmtMoney(amount)}`;
  }
  const p = t.roster.find((x) => x.id === pid);
  if (!p) return '선수가 이미 팀에 없습니다';
  if (idx !== 0) {
    p.mlbAsk = (p.mlbAsk ?? 0) + 1;
    p.salary = Math.round((p.salary * MLB.keepRaise) / 100) * 100;
    return `${josa(p.name, '은', '는')} 한 해 더 섬에 남습니다 — 연봉 ${fmtMoney(p.salary)}`;
  }
  t.roster = t.roster.filter((x) => x.id !== p.id);
  if (core.campaign.block) core.campaign.block = core.campaign.block.filter((id) => id !== p.id);
  fixLineup(t);
  core.finance.ledger.sales += amount;
  const [repay] = payInMut(core, amount);
  core.campaign.trust = Math.min(100, core.campaign.trust + MLB.trust);
  mlb.gone.push({ p: { ...structuredClone(p), mlbAsk: undefined }, season: core.season });
  return `${p.name} 포스팅 — 이적료 ${fmtMoney(amount)}${repay > 0 ? ` (빚 ${fmtMoney(repay)} 상환)` : ''}`;
}

