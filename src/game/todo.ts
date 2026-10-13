// "할 일" 목록: 탭 배지의 정체. 누적 카운터가 아니라 지금 상태에서 실제로 해당하는 것만 계산한다 (순수 함수).
import type { Core, HintTab } from './types';
import { MIN_BATTERS, MIN_PITCHERS, ROSTER_MAX, SVC_YEARS, activeRoster, userTeam } from './economy';
import { svcYear } from './contract';
import { orderIssues } from './fixes';
import { fmtInt } from './format';
import { memoGet } from './memo';
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
  if (hurt.length) {
    out.push({
      id: 'hurt', tab: 'roster', hint: hurtB.length ? 'lineup' : 'pitchers', icon: '✚', tone: 'bad', action: 'order',
      text: hurt.length > 1 ? `부상: ${names(hurt)} — 오더 확인` : `부상: ${hurt[0].name} ${hurt[0].injury}경기 — 오더 확인`,
    });
  }
  // 오더에 고칠 곳 (▲벤치 · ⇄제자리 · ▲불펜)
  const o = orderIssues(t);
  if (o.lineup + o.pitchers > 0) {
    out.push({ id: 'fix', tab: 'roster', hint: o.lineup ? 'lineup' : 'pitchers', icon: '▲', tone: 'warn', action: 'order', text: `오더에 고칠 곳 ${o.lineup + o.pitchers}` });
  }
  // 연투
  // 불펜·마무리만 (선발은 로테이션대로 쉰다)
  const pen = new Set([...t.bullpen, ...(t.closer ? [t.closer] : [])]);
  const tired = activeRoster(t).filter((p) => pen.has(p.id) && (p.tired ?? 0) >= TIRED_TODO);
  if (tired.length) {
    out.push({ id: 'tired', tab: 'roster', hint: 'pitchers', icon: '♨', tone: 'warn', action: 'pitchers', text: `연투 ${Math.max(...tired.map((p) => p.tired ?? 0))}일: ${names(tired)} — 쉬게 하세요` });
  }
  // 1군 정원
  const act = activeRoster(t);
  const nb = act.filter((p) => p.kind === 'B').length;
  const np = act.length - nb;
  if (act.length > ROSTER_MAX) out.push({ id: 'over', tab: 'roster', hint: 'lineup', icon: '!', tone: 'bad', action: 'squad', text: `1군 정원 초과 ${act.length}/${ROSTER_MAX} — ${act.length - ROSTER_MAX}명을 내리세요` });
  if (nb < MIN_BATTERS) out.push({ id: 'fewB', tab: 'roster', hint: 'lineup', icon: '!', tone: 'bad', action: 'squad', text: `1군 타자 ${nb}명 — 최소 ${MIN_BATTERS}명이 필요합니다` });
  if (np < MIN_PITCHERS) out.push({ id: 'fewP', tab: 'roster', hint: 'pitchers', icon: '!', tone: 'bad', action: 'squad', text: `1군 투수 ${np}명 — 최소 ${MIN_PITCHERS}명이 필요합니다` });
  // 시즌 뒤 FA 자격 (재계약 대기)
  if (core.phase === 'season' && left <= FA_AHEAD) {
    const fa = t.roster.filter((p) => (svcYear(core, p) ?? 0) >= SVC_YEARS).sort((a, b) => b.ovr - a.ovr);
    if (fa.length) out.push({ id: `fa-${core.season}`, tab: 'roster', hint: 'lineup', icon: '✎', tone: 'info', dismissible: true, text: `시즌 뒤 재계약 대기: ${names(fa)}` });
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
      const text = a.text.endsWith('뒤 바닥') && rw.cashOut !== null ? `${rw.cashOut}경기 뒤 금고가 빕니다` : a.text;
      out.push({ id: 'cash', tab: 'club', hint: 'finance', icon: '₩', tone: a.danger ? 'bad' : 'warn', action: 'finance', text });
    }
  }
  // 매진으로 발길 돌린 팬
  if (core.crowd && core.crowd.turnedAway > 0) {
    out.push({
      id: `away-${core.season}-${core.attHistory.length}`, tab: 'club', hint: 'stadium', icon: '⌂', tone: 'info', action: 'seats', dismissible: true,
      text: `지난 홈경기 ${fmtInt(core.crowd.turnedAway)}명이 돌아갔습니다 — 관중석`,
    });
  }

  // 예보: 가장 가까운 이름 붙은 구간 하나
  if (core.phase === 'season') {
    const b = (core.campaign.beats ?? [])
      .filter((x) => !!x.label && x.from > core.day && x.from - core.day <= FORECAST_AHEAD)
      .sort((x, y) => x.from - y.from)[0];
    if (b) out.push({ id: `beat-${core.season}-${b.id}-${b.from}`, tab: 'league', hint: 'league', icon: b.icon ?? '☂', tone: 'info', action: 'league', dismissible: true, text: `${b.from - core.day}경기 뒤 ${b.label}` });
  }
  return out;
}
