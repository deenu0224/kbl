// 이적 창구 바구니 조합 검증: 상태 × 바구니(1~3건) 를 실제로 돌려 본다.
//   헛오류  = 바구니를 다 적용한 최종 상태는 규칙에 맞는데(또는 순서만 바꾸면 되는데) 막힌다
//   헛통과  = 통과했는데 최종 상태가 규칙을 어긴다
//   미리보기 = previewTransfer 의 오류·인원·현금·연봉이 실제 결과와 다르다
// 사용: npx tsx scripts/transfercheck.ts [픽스처…]   (screens-out/fixtures 의 세이브를 쓴다)
import '../src/game/generate';
import '../src/game/season';
import { readFileSync } from 'node:fs';
import type { Core, Player } from '../src/game/types';
import { applyTransfer, previewTransfer, type Basket, type BasketKind } from '../src/game/transfer';
import { callUp, farmLockLeft, releasePlayer, sendDown, signPlayer } from '../src/game/season';
import { MIN_BATTERS, MIN_PITCHERS, ROSTER_MAX, activeRoster, farmMax, farmRoster, overLimit, payroll, releaseCost, signingBonusFor, signingOpen, userTeam } from '../src/game/economy';
import { FOREIGN_MAX } from '../src/game/transfer';

const STEP = { release: releasePlayer, down: sendDown, up: callUp, sign: signPlayer } as const;
const FIX = process.argv.slice(2).length ? process.argv.slice(2) : ['relFull', 'opened', 'farm', 'faHeat', 'rehab', 'relStove', 'debt50', 'regClosed', 'injury', 'season3', 'tradeWindow', 'resign'];

type Act = { k: BasketKind; pid: string; label: string };
type Finding = { kind: '헛오류' | '헛오류(순서)' | '헛통과' | '미리보기'; state: string; basket: string; detail: string };
const found: Finding[] = [];
let runs = 0;

function load(name: string): Core | null {
  try {
    return JSON.parse(readFileSync(`screens-out/fixtures/${name}.json`, 'utf8')).save.state as Core;
  } catch {
    return null;
  }
}

/** 상태 변형: 같은 세이브에 조건을 얹는다 */
function variants(base: Core): [string, Core][] {
  const out: [string, Core][] = [['기본', base]];
  const t0 = userTeam(base);
  // 투수 최소: 1군 투수를 최소 인원까지 2군으로
  {
    const c = structuredClone(base);
    const t = userTeam(c);
    const ps = activeRoster(t).filter((p) => p.kind === 'P').sort((a, b) => a.ovr - b.ovr);
    for (const p of ps.slice(0, Math.max(0, ps.length - MIN_PITCHERS))) p.farm = true;
    out.push(['투수 최소', c]);
  }
  // 타자 최소
  {
    const c = structuredClone(base);
    const t = userTeam(c);
    const lineup = new Set(t.lineup.map((l) => l.pid));
    const bs = activeRoster(t).filter((p) => p.kind === 'B').sort((a, b) => Number(lineup.has(a.id)) - Number(lineup.has(b.id)) || a.ovr - b.ovr);
    for (const p of bs.slice(0, Math.max(0, bs.length - MIN_BATTERS))) p.farm = true;
    out.push(['타자 최소', c]);
  }
  // 2군 가득: 2군 선수를 복제해 정원까지 채운다
  {
    const c = structuredClone(base);
    const t = userTeam(c);
    const f = farmRoster(t).filter((p) => !p.il);
    for (let i = 0; f.length && farmRoster(t).filter((p) => !p.il).length < farmMax(c); i++) t.roster.push({ ...structuredClone(f[i % f.length]), id: `fill${i}` });
    out.push(['2군 가득', c]);
  }
  // 현금 부족
  {
    const c = structuredClone(base);
    c.finance.cash = 5000;
    out.push(['현금 5천만', c]);
  }
  void t0;
  return out;
}

/** 담을 후보 동작: FA 셋(외국인 하나 포함되게), 1군 벤치 타자·불펜 끝 투수, 2군(뛸 수 있는) 둘 */
function actions(c: Core): Act[] {
  const t = userTeam(c);
  const lineup = new Set(t.lineup.map((l) => l.pid));
  const key = new Set([...lineup, ...t.rotation, ...(t.closer ? [t.closer] : [])]);
  const fas = c.freeAgents.slice().sort((a, b) => b.ovr - a.ovr);
  const pickFa = [...fas.filter((p) => p.kind === 'P').slice(0, 1), ...fas.filter((p) => p.kind === 'B').slice(0, 1), ...fas.filter((p) => p.foreign).slice(0, 1)];
  const act = activeRoster(t);
  const benchB = act.filter((p) => p.kind === 'B' && !key.has(p.id)).sort((a, b) => a.ovr - b.ovr).slice(0, 1);
  const benchP = act.filter((p) => p.kind === 'P' && !key.has(p.id)).sort((a, b) => a.ovr - b.ovr).slice(0, 1);
  const farm = farmRoster(t).filter((p) => !p.il && farmLockLeft(c, p) === 0);
  const farmB = farm.filter((p) => p.kind === 'B').slice(0, 1);
  const farmP = farm.filter((p) => p.kind === 'P').slice(0, 1);
  const out: Act[] = [];
  const nm = (p: Player) => `${p.name}(${p.kind === 'B' ? '타' : '투'}${p.foreign ? '·외' : ''})`;
  for (const p of [...new Map(pickFa.map((p) => [p.id, p])).values()]) out.push({ k: 'sign', pid: p.id, label: `영입 ${nm(p)}` });
  for (const p of [...benchB, ...benchP]) {
    out.push({ k: 'release', pid: p.id, label: `방출 ${nm(p)}` });
    out.push({ k: 'down', pid: p.id, label: `2군 ${nm(p)}` });
  }
  for (const p of [...farmB, ...farmP]) out.push({ k: 'up', pid: p.id, label: `콜업 ${nm(p)}` });
  return out;
}

function* combos(acts: Act[], max: number, start = 0, cur: Act[] = []): Generator<Act[]> {
  if (cur.length) yield cur;
  if (cur.length === max) return;
  for (let i = start; i < acts.length; i++) {
    if (cur.some((a) => a.pid === acts[i].pid)) continue;
    yield* combos(acts, max, i + 1, [...cur, acts[i]]);
  }
}

const toBasket = (acts: Act[]): Basket => {
  const b: Basket = { sign: [], release: [], down: [], up: [] };
  for (const a of acts) b[a.k].push(a.pid);
  return b;
};

function* perms<T>(xs: T[]): Generator<T[]> {
  if (xs.length <= 1) return yield xs;
  for (let i = 0; i < xs.length; i++) for (const p of perms([...xs.slice(0, i), ...xs.slice(i + 1)])) yield [xs[i], ...p];
}

/** 순서를 바꿔서라도 되는가 (실제 단계 함수로) */
function anyOrder(c0: Core, acts: Act[]): boolean {
  for (const order of perms(acts)) {
    let c = c0;
    let ok = true;
    for (const a of order) {
      const r = STEP[a.k](c, a.pid);
      if (r.error) {
        ok = false;
        break;
      }
      c = r.core;
    }
    if (ok) return true;
  }
  return false;
}

/** 바구니를 단계 검사 없이 적용한 최종 상태가 규칙에 맞는가. 맞지 않으면 그 사유 */
function idealProblem(c0: Core, acts: Act[]): string | null {
  const c = structuredClone(c0);
  const t = userTeam(c);
  let cash = c.finance.cash;
  const signs = acts.filter((a) => a.k === 'sign');
  if (signs.length && !signingOpen(c)) return '등록 마감';
  if (signs.length && overLimit(c)) return '부채 한도 초과';
  signs.forEach((a, i) => {
    const p = c.freeAgents.find((x) => x.id === a.pid)!;
    cash -= signingBonusFor(c0, p, i);
    t.roster.push({ ...structuredClone(p) });
  });
  for (const a of acts.filter((a) => a.k === 'release')) {
    const p = t.roster.find((x) => x.id === a.pid)!;
    cash -= releaseCost(p, c0);
    t.roster = t.roster.filter((x) => x.id !== a.pid);
  }
  for (const a of acts.filter((a) => a.k === 'down')) t.roster.find((x) => x.id === a.pid)!.farm = true;
  for (const a of acts.filter((a) => a.k === 'up')) {
    const p = t.roster.find((x) => x.id === a.pid)!;
    if (farmLockLeft(c0, p) > 0) return '말소 잠금';
    p.farm = false;
    p.il = false;
  }
  const act = activeRoster(t);
  if (act.length > ROSTER_MAX) return `1군 ${act.length}/${ROSTER_MAX}`;
  if (act.filter((p) => p.kind === 'B').length < MIN_BATTERS) return '타자 최소';
  if (act.filter((p) => p.kind === 'P').length < MIN_PITCHERS) return '투수 최소';
  if (farmRoster(t).filter((p) => !p.il).length > farmMax(c)) return '2군 정원';
  if (t.roster.filter((p) => p.foreign).length > FOREIGN_MAX) return '외국인 한도';
  if (cash < 0) return '현금';
  return null;
}

for (const name of FIX) {
  const base = load(name);
  if (!base) {
    console.log(`(픽스처 없음: ${name})`);
    continue;
  }
  for (const [vname, c] of variants(base)) {
    const state = `${name}/${vname} · 1군 ${activeRoster(userTeam(c)).length} · 2군 ${farmRoster(userTeam(c)).length}/${farmMax(c)} · ${c.phase}`;
    for (const acts of combos(actions(c), 3)) {
      runs++;
      const basket = toBasket(acts);
      const label = acts.map((a) => a.label).join(' + ');
      const real = applyTransfer(c, basket);
      const pv = previewTransfer(c, basket);
      const ideal = idealProblem(c, acts);
      if (real.error) {
        if (!ideal) found.push({ kind: '헛오류', state, basket: label, detail: real.error });
        else if (anyOrder(c, acts)) found.push({ kind: '헛오류(순서)', state, basket: label, detail: real.error });
      } else {
        const t = userTeam(real.core);
        const act = activeRoster(t);
        const bad = act.length > ROSTER_MAX ? '1군 초과' : act.filter((p) => p.kind === 'B').length < MIN_BATTERS ? '타자 최소 미달' : act.filter((p) => p.kind === 'P').length < MIN_PITCHERS ? '투수 최소 미달' : farmRoster(t).filter((p) => !p.il).length > farmMax(real.core) ? '2군 초과' : real.core.finance.cash < 0 ? '현금 음수' : null;
        if (bad) found.push({ kind: '헛통과', state, basket: label, detail: bad });
        const diffs: string[] = [];
        if (pv.active.b !== act.length) diffs.push(`1군 미리보기 ${pv.active.b} ≠ 실제 ${act.length}`);
        if (Math.abs(pv.cash.b - real.core.finance.cash) > 1) diffs.push(`현금 미리보기 ${pv.cash.b} ≠ 실제 ${real.core.finance.cash}`);
        if (Math.abs(pv.payroll.b - payroll(t)) > 1) diffs.push(`연봉 미리보기 ${pv.payroll.b} ≠ 실제 ${payroll(t)}`);
        if (diffs.length) found.push({ kind: '미리보기', state, basket: label, detail: diffs.join(' · ') });
      }
      if (!!pv.error !== !!real.error) found.push({ kind: '미리보기', state, basket: label, detail: `오류 미리보기 ${pv.error ?? '없음'} / 실제 ${real.error ?? '없음'}` });
    }
  }
}

console.log(`바구니 ${runs}개 실행`);
const by = (k: Finding['kind']) => found.filter((f) => f.kind === k);
for (const k of ['헛오류', '헛오류(순서)', '헛통과', '미리보기'] as const) {
  const xs = by(k);
  console.log(`\n== ${k} ${xs.length}건`);
  // 같은 오류 문구끼리 묶어 대표 예만
  const groups = new Map<string, Finding[]>();
  for (const f of xs) {
    const g = f.detail.replace(/^[^:]+: /, '').replace(/\d[\d,.]*(억|만)?/g, 'N');
    groups.set(g, [...(groups.get(g) ?? []), f]);
  }
  for (const [g, fs] of groups) {
    console.log(`  · [${fs.length}] ${g}`);
    for (const f of fs.slice(0, 2)) console.log(`      ${f.state} | ${f.basket} | ${f.detail}`);
  }
}
