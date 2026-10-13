// 보유 기간(서비스 타임)과 FA 자격 재계약. 드래프트로 뽑아 키운 선수는 6시즌 동안 싸고, 7년차에 값을 부른다.
// 상수는 economy.ts 상단(SVC_*, RESIGN_*). 재계약 카드는 스토브리그(결산 후·드래프트 전)에 campaign.event 로 뜬다.
import type { Core, EventCard, Player } from './types';
import { clamp } from './rng';
import { MIN_SALARY } from './ratings';
import { AUDIT, MIN_BATTERS, MIN_PITCHERS, RESIGN_ASK_MAX, RESIGN_LEAVE_FANS, RESIGN_LEAVE_SAT, SVC_RATE, SVC_YEARS, activeRoster, userTeam } from './economy';
import { fmtMoney } from './format';
import { isFranchise } from './franchise';
import { fixLineup } from './lineup';
import { addNews, marketSalary } from './season';
import { NEWS } from './story';
import { rowFans, rowInfo, rowPayroll, rowSat, satAfter } from './eventRows';

export const RESIGN_ID = 'resign';

/** season 시즌에 이 선수가 보유 기간 몇 년차인가 (1부터). 보유 기간 대상이 아니면 null */
export function svcYearAt(p: Player, season: number): number | null {
  return p.svc === undefined ? null : Math.max(1, season - p.svc + 1);
}

/** 지금 시즌 기준 보유 기간 n년차 (1~SVC_YEARS). 대상이 아니면 null */
export function svcYear(core: Pick<Core, 'season'>, p: Player): number | null {
  return svcYearAt(p, core.season);
}

/** FA 자격까지 남은 시즌 수 (이번 시즌 포함. 0 = 이번 스토브리그에 자격). 대상이 아니면 null */
export function svcLeft(core: Pick<Core, 'season' | 'phase'>, p: Player): number | null {
  const y = svcYear(core, p);
  if (y === null) return null;
  return Math.max(0, SVC_YEARS - y + (core.phase === 'season' || core.phase === 'post' ? 1 : 0));
}

/** 보유 기간 n년차의 연봉 (시장가의 일부, 최저연봉 하한) */
export function svcSalary(market: number, year: number): number {
  const rate = SVC_RATE[clamp(year, 1, SVC_YEARS) - 1];
  return Math.max(MIN_SALARY, Math.round((market * rate) / 100) * 100);
}

/** 시장가 대비 연봉 비율 (1 = 시장가 그대로. 보유 기간 선수는 1 보다 작다) */
export function marketRatio(core: Pick<Core, 'season'>, p: Player): number {
  const m = marketSalary(p, core.season);
  return m > 0 ? p.salary / m : 1;
}

/** 이번 스토브리그에 FA 자격을 얻는 유저 팀 선수 (결산 후 · 보유 기간 6시즌을 채움) */
export function faEligible(core: Core): Player[] {
  if (core.phase !== 'ended' || !AUDIT.svc) return [];
  return userTeam(core)
    .roster.filter((p) => (svcYear(core, p) ?? 0) >= SVC_YEARS)
    .sort((a, b) => b.ovr - a.ovr);
}

/** 재계약 요구: 다음 시즌 시장가 × (1 ~ 1.15). 스타일수록 많이 부른다 */
export function resignAsk(core: Pick<Core, 'season'>, p: Player): { mult: number; salary: number; market: number } {
  const mult = Math.round((1 + RESIGN_ASK_MAX * clamp((p.star - 30) / 50, 0, 1) + (p.lever ?? 0)) * 100) / 100; // lever: 약점을 잡았거나(+) 믿어 준(−) 선수
  const market = marketSalary(p, core.season + 1);
  return { mult, market, salary: Math.round((market * mult) / 100) * 100 };
}

/** 보낼 수 없는 사유 (1군 최소 인원). 보낼 수 있으면 null */
function leaveBlocked(core: Core, p: Player): string | null {
  if (p.farm) return null;
  const same = activeRoster(userTeam(core)).filter((x) => x.kind === p.kind).length;
  if (p.kind === 'B' && same <= MIN_BATTERS) return `1군 타자는 최소 ${MIN_BATTERS}명이 필요합니다`;
  if (p.kind === 'P' && same <= MIN_PITCHERS) return `1군 투수는 최소 ${MIN_PITCHERS}명이 필요합니다`;
  return null;
}

function resignMut(core: Core, pid: string, accept: boolean): string {
  const t = userTeam(core);
  const p = t.roster.find((x) => x.id === pid);
  core.campaign.resignQueue = (core.campaign.resignQueue ?? []).filter((id) => id !== pid);
  if (!p) return '협상 상대가 이미 팀을 떠났습니다';
  if (accept) {
    const ask = resignAsk(core, p);
    delete p.svc;
    delete p.lever;
    p.ask = ask.mult;
    p.salary = ask.salary;
    return `${p.name} 재계약 — 연봉 ${fmtMoney(ask.salary)}`;
  }
  t.roster = t.roster.filter((x) => x.id !== pid);
  if (isFranchise(p, core.season)) {
    core.fans = Math.max(1000, core.fans - p.star * RESIGN_LEAVE_FANS);
    core.fanSat = satAfter(core, RESIGN_LEAVE_SAT);
    addNews(core, NEWS.franchiseGone(p.name), 'bad');
  }
  delete p.since;
  delete p.svc;
  delete p.ask;
  delete p.lever;
  delete p.tired;
  delete p.farm;
  delete p.il;
  delete p.farmUntil;
  delete p.farmStat;
  core.freeAgents.push(p);
  fixLineup(t);
  return `${p.name}, FA 시장으로 떠났습니다`;
}

/** FA 자격 선수와의 재계약: 수락(요구 연봉으로 계약) / 보낸다(FA 풀로 이탈). 결산 후에만 */
export function resign(core0: Core, pid: string, accept: boolean): { core: Core; error?: string; result: string } {
  const p0 = faEligible(core0).find((p) => p.id === pid);
  if (!p0) return { core: core0, error: 'FA 자격을 얻은 선수가 아닙니다', result: '' };
  const blocked = accept ? null : leaveBlocked(core0, p0);
  if (blocked) return { core: core0, error: blocked, result: '' };
  const core = structuredClone(core0);
  const result = resignMut(core, pid, accept);
  return { core, result };
}

function resignCard(core: Core, p: Player): EventCard {
  const ask = resignAsk(core, p);
  const fr = isFranchise(p, core.season);
  const blocked = leaveBlocked(core, p);
  return {
    id: `${RESIGN_ID}|${p.id}`,
    title: 'FA 자격 — 재계약',
    icon: '📝',
    pid: p.id,
    who: 'player',
    line: '여섯 해를 이 섬에서 뛰었습니다. 이제 제 값을 듣고 싶습니다.',
    body: `${p.name}(${p.age}세 · 오버롤 ${p.ovr})이 ${SVC_YEARS}시즌을 채우고 FA 자격을 얻었습니다. 지금 연봉 ${fmtMoney(p.salary)}, 시장가 ${fmtMoney(ask.market)}.`,
    choices: [
      {
        label: '재계약한다',
        desc: `연봉 ${fmtMoney(p.salary)} → ${fmtMoney(ask.salary)}`,
        detail: {
          rows: [
            rowInfo(`${p.name} 연봉`, fmtMoney(ask.salary), fmtMoney(p.salary), 'bad'),
            rowInfo('시장가 대비', `×${ask.mult.toFixed(2)} (시장가 ${fmtMoney(ask.market)})`),
            rowPayroll(core, ask.salary - p.salary),
            rowInfo('FA 자격', '재계약 (잔류)', `${SVC_YEARS}시즌 채움`, 'good'),
          ],
          pids: [p.id],
        },
      },
      {
        label: '보낸다',
        desc: fr ? `FA 시장으로 이탈 · 팬 −${p.star * RESIGN_LEAVE_FANS}` : `FA 시장으로 이탈 · 연봉 총액 −${fmtMoney(p.salary)}`,
        ...(blocked ? { disabled: blocked } : {}),
        detail: {
          rows: [
            rowInfo(p.name, 'FA 시장으로', `${p.kind === 'B' ? '타자' : '투수'} 오버롤 ${p.ovr}`, 'bad'),
            rowPayroll(core, -p.salary),
            ...(fr ? [rowFans(core, -p.star * RESIGN_LEAVE_FANS), rowSat(core, RESIGN_LEAVE_SAT)] : [rowFans(core, 0)]),
          ],
          pids: [p.id],
        },
      },
    ],
  };
}

/** 대기열의 다음 재계약 카드를 campaign.event 에 올린다 (mutate). 남은 선수가 없으면 대기열을 지운다 */
export function nextResignMut(core: Core): void {
  const c = core.campaign;
  if (c.event) return;
  const p = faEligible(core)[0];
  c.resignQueue = faEligible(core).map((x) => x.id);
  if (!p) delete c.resignQueue;
  else c.event = resignCard(core, p);
}

/** 스토브리그 시작(결산 후·드래프트 전): FA 자격 선수가 있으면 재계약 카드를 띄운다. 없으면 그대로 */
export function drawResign(core0: Core): Core {
  if (core0.campaign.event || !faEligible(core0).length) return core0;
  const core = structuredClone(core0);
  nextResignMut(core);
  return core;
}

/** 재계약 카드의 선택 처리 (events.ts 의 카드 정의가 부른다). 이어서 다음 선수의 카드를 올린다 */
export function resolveResignMut(core: Core, idx: number, card: EventCard): string {
  const result = card.pid ? resignMut(core, card.pid, idx === 0) : '협상이 흐지부지되었습니다';
  nextResignMut(core);
  return result;
}
