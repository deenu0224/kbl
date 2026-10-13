// 유저 구단 로스터 불변식 (정원·중복·입대 선수 분리·편성 정합성). scripts/farmcheck.ts 와 scripts/oldsave.ts 가 함께 쓴다.
import type { Core } from '../src/game/types';
import { FARM_MAX, MIN_BATTERS, MIN_PITCHERS, ROSTER_MAX, activeRoster, farmRoster, payroll, userTeam } from '../src/game/economy';
import { farmAutoOn } from '../src/game/farm';
import { memoGet } from '../src/game/memo';

/** 위반 문구 목록과, 징계 중인 1군 선수가 편성에 남아 있는 칸 수(참고) */
export function rosterCheck(c: Core, strict = true): { msgs: string[]; ban: number } {
  const msgs: string[] = [];
  let ban = 0;
  const t = userTeam(c);
  const ids = t.roster.map((p) => p.id);
  const fail = (m: string) => msgs.push(m);
  if (new Set(ids).size !== ids.length) fail('로스터 중복');
  const act = activeRoster(t);
  if (act.length > ROSTER_MAX) fail(`1군 ${act.length}명`);
  if (farmRoster(t).length > FARM_MAX + (strict ? 0 : 1)) fail(`2군 ${farmRoster(t).length}명 (재활 제외)`);
  if (strict) {
    const nb = act.filter((p) => p.kind === 'B').length;
    if (nb < MIN_BATTERS) fail(`1군 타자 ${nb}명`);
    if (act.length - nb < MIN_PITCHERS) fail(`1군 투수 ${act.length - nb}명`);
  }
  const auto = farmAutoOn(c);
  const b3 = (memoGet(c, 'b3') ?? '').split('|');
  for (const p of t.roster) {
    if (p.away) fail(`${p.name}: 입대 중인데 로스터에 있음`);
    if (p.il && !p.farm) fail(`${p.name}: 1군인데 재활 표시`);
    if (p.farm && p.subFor) fail(`${p.name}: 2군인데 subFor`);
    if (p.subFor) {
      const o = t.roster.find((x) => x.id === p.subFor);
      if (!o) fail(`${p.name}: subFor 대상 없음`);
      // 대상이 다 나아 1군에 있으면 대체 선수는 그날 정리된다 (예외: 오늘 사건 B3 로 물었다 · 대체 선수 본인이 부상)
      else if (auto && strict && o.injury === 0 && !o.il && p.injury === 0 && !(b3[0] === p.id && Number(b3[2]) === c.day)) fail(`${p.name}: subFor 대상(${o.name})이 건강한데 정리 안 됨`);
    }
    if (!Number.isFinite(p.ovr) || p.def > 99 || (p.kind === 'B' && p.def < 20)) fail(`${p.name}: 능력치 이상`);
  }
  for (const p of c.campaign.away ?? []) {
    if (!p.away) fail(`${p.name}: away 목록인데 표시 없음`);
    if (ids.includes(p.id)) fail(`${p.name}: 입대 선수가 로스터에도 있음`);
  }
  const inLu = t.lineup.map((s) => s.pid);
  for (const id of [...inLu, ...t.rotation, ...t.bullpen, ...(t.closer ? [t.closer] : [])]) {
    const p = t.roster.find((x) => x.id === id);
    if (!p) fail(`편성에 없는 선수 ${id}`);
    else if (p.il) fail(`${p.name}: 재활 중인데 편성에 있음`);
    else if (p.farm) fail(`${p.name}: 2군인데 편성에 있음`);
    else if (p.ban && strict) ban++;
  }
  if (!Number.isFinite(payroll(t))) fail('연봉 총액 이상');
  return { msgs, ban };
}
