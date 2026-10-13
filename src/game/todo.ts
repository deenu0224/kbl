// "할 일" 목록: 탭 배지의 정체. 누적 카운터가 아니라 지금 상태에서 실제로 해당하는 것만 계산한다 (순수 함수).
import type { Core, HintTab } from './types';
import { MIN_BATTERS, MIN_PITCHERS, ROSTER_MAX, SVC_YEARS, activeRoster, userTeam } from './economy';
import { svcYear } from './contract';
import { FIX_GAIN_MIN, bullpenLoad, fixGain, orderIssues } from './fixes';
import { fmtInt } from './format';
import { memoGet } from './memo';
import { coachShuttles, injuryNotice, remedies } from './remedy';
import { farmAutoOn, shuttleArms } from './farm';
import { runway, runwayAlert } from './runway';

export type TodoTab = 'home' | 'roster' | 'transfer' | 'league' | 'club';
export type TodoAction = 'order' | 'pitchers' | 'market' | 'finance' | 'seats' | 'league' | 'squad';

export interface Todo {
  id: string;
  tab: TodoTab;
  hint: HintTab; // 하위 탭(데스크톱 탭바) 자리
  icon: string;
  text: string;
  tone: 'bad' | 'warn' | 'info';
  action?: TodoAction;
  dismissible?: boolean; // 확인만 하면 되는 항목: [×]로 닫는다. 없으면 상태가 해소돼야 사라진다
}

export const TIRED_TODO = 3; // 연투 이 일수 이상인 1군 투수
export const FORECAST_AHEAD = 6; // 예보는 이 경기 수 이내로 다가왔을 때
const FA_AHEAD = 12; // 시즌 종료 이 경기 전부터 FA 자격 예고

const names = (xs: { name: string }[]) => (xs.length > 1 ? `${xs[0].name} 외 ${xs.length - 1}명` : (xs[0]?.name ?? ''));

export function todoList(core: Core): Todo[] {
  const out: Todo[] = [];
  const t = userTeam(core);
  const playing = (core.phase === 'season' && core.day < core.schedule.length) || core.phase === 'post';
  if (!t || !playing) return out;
  const byId = new Map(t.roster.map((p) => [p.id, p]));
  const left = core.schedule.length - core.day;

  // 주전·로테이션 부상
  const hurtB = t.lineup.map((l) => byId.get(l.pid)).filter((p) => !!p && p.injury > 0);
  const hurtP = t.rotation.map((id) => byId.get(id)).filter((p) => !!p && p.injury > 0);
  const hurt = [...hurtB, ...hurtP].map((p) => p!);
  // 자동 운영이 켜져 있으면 벤치·2군 코치가 메우는 부상은 올리지 않는다 (메울 수 없을 때만, 이유와 함께)
  const inj = hurt.length ? injuryNotice(core) : { show: false, why: '' };
  if (inj.show) {
    const why = inj.why ? ` — ${inj.why}` : '';
    out.push({
      id: 'hurt', tab: 'roster', hint: hurtB.length ? 'lineup' : 'pitchers', icon: '✚', tone: 'bad', action: 'order',
      text: hurt.length > 1 ? `부상: ${names(hurt)}${why}` : `부상: ${hurt[0].name} ${hurt[0].injury}경기${why}`,
    });
  }
  // 오더 점검: 추천을 전부 적용하면 전력 4칸 합이 눈에 띄게 오를 때만 (부상은 위의 줄이 대신한다)
  if (!hurt.length) {
    const o = orderIssues(t);
    const g = o.lineup + o.pitchers > 0 ? fixGain(t) : null;
    if (g && g.gain >= FIX_GAIN_MIN) {
      out.push({ id: 'fix', tab: 'roster', hint: o.lineup ? 'lineup' : 'pitchers', icon: '▲', tone: 'warn', action: 'order', text: `오더 점검 — 추천 ${g.n}건` });
    }
  }
  // 불펜 과부하: 등판 가능한 투수가 없다 (상태 항목 — 2군 구원 콜업·FA 영입·하루 휴식으로 풀린다)
  // 2군 코치가 다음 경기 뒤 스스로 교대할 수 있으면 올리지 않는다
  const pen = bullpenLoad(t);
  if (pen.label === '과부하' && !coachShuttles(core)) {
    const why = farmAutoOn(core) && !shuttleArms(core).length ? '올릴 2군 투수 없음' : `등판 가능 ${pen.rested}/${pen.arms}`;
    out.push({ id: 'pen', tab: 'roster', hint: 'pitchers', icon: '♨', tone: 'warn', action: 'pitchers', text: `불펜 과부하 — ${why}` });
  }
  // 1군 정원
  const act = activeRoster(t);
  const nb = act.filter((p) => p.kind === 'B').length;
  const np = act.length - nb;
  if (act.length > ROSTER_MAX) out.push({ id: 'over', tab: 'roster', hint: 'lineup', icon: '!', tone: 'bad', action: 'squad', text: `1군 정원 초과 — ${act.length}/${ROSTER_MAX}` });
  if (nb < MIN_BATTERS) out.push({ id: 'fewB', tab: 'roster', hint: 'lineup', icon: '!', tone: 'bad', action: 'squad', text: `1군 타자 부족 — ${nb}/${MIN_BATTERS}` });
  if (np < MIN_PITCHERS) out.push({ id: 'fewP', tab: 'roster', hint: 'pitchers', icon: '!', tone: 'bad', action: 'squad', text: `1군 투수 부족 — ${np}/${MIN_PITCHERS}` });
  // 시즌 뒤 FA 자격 (재계약 대기)
  if (core.phase === 'season' && left <= FA_AHEAD) {
    const fa = t.roster.filter((p) => (svcYear(core, p) ?? 0) >= SVC_YEARS).sort((a, b) => b.ovr - a.ovr);
    if (fa.length) out.push({ id: `fa-${core.season}`, tab: 'roster', hint: 'lineup', icon: '✎', tone: 'info', action: 'squad', dismissible: true, text: `시즌 뒤 재계약 대기: ${names(fa)}` });
  }

  // 스카우트 팀장의 명단 (아직 시장에 남아 있는 사람만)
  const list = memoGet(core, 'scoutList');
  if (list) {
    const n = list.split(',').filter((id) => core.freeAgents.some((p) => p.id === id)).length;
    if (n > 0) out.push({ id: `scout-${core.season}-${list}`, tab: 'transfer', hint: 'market', icon: '★', tone: 'info', action: 'market', dismissible: true, text: `이적 시장에 팀장 추천 ${n}명` });
  }

  // 자금 경고
  if (core.phase === 'season') {
    const rw = runway(core);
    const a = runwayAlert(core, rw);
    if (a) {
      const text = a.text.endsWith('뒤 바닥') && rw.cashOut !== null ? `자금 경고 — ${rw.cashOut}경기 뒤 바닥` : `자금 경고 — ${a.text}`;
      out.push({ id: 'cash', tab: 'club', hint: 'finance', icon: '₩', tone: a.danger ? 'bad' : 'warn', action: 'finance', text });
    }
  }
  // 매진으로 발길 돌린 팬
  if (core.crowd && core.crowd.turnedAway > 0) {
    out.push({
      id: `away-${core.season}-${core.attHistory.length}`, tab: 'club', hint: 'stadium', icon: '⌂', tone: 'info', action: 'seats', dismissible: true,
      text: `매진 — ${fmtInt(core.crowd.turnedAway)}명이 돌아감`,
    });
  }

  // 예보: 가장 가까운 이름 붙은 구간 하나
  if (core.phase === 'season') {
    const b = (core.campaign.beats ?? [])
      .filter((x) => !!x.label && x.from > core.day && x.from - core.day <= FORECAST_AHEAD)
      .sort((x, y) => x.from - y.from)[0];
    if (b) out.push({ id: `beat-${core.season}-${b.id}-${b.from}`, tab: 'league', hint: 'league', icon: b.icon ?? '☂', tone: 'info', action: 'league', dismissible: true, text: `${b.from - core.day}경기 뒤 ${b.label}` });
  }
  // 조치 버튼이 없는 알림은 띄우지 않는다: "그대로 둔다" 말고 할 수 있는 게 없으면 뺀다 (확인 항목은 닫을 수 있으니 둔다)
  return out.filter((x) => x.dismissible || remedies(core, x.id).some((r) => r.run.t !== 'none'));
}
