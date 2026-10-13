// 2군 성장 측정: 고졸 원석(19세 · OVR ~47 · 잠재 ~82)을 2군에 두고 시즌을 돌려 OVR 추이를 본다.
// 실행: npx tsx scripts/farmgrowth.ts [시드 수]
import { mulberry32 } from '../src/game/rng';
import { newCore, genPlayer, makeCtx } from '../src/game/generate';
import { advanceDay, nextSeason } from '../src/game/season';
import { userTeam, TRAIN_LV } from '../src/game/economy';
import { calcOvr } from '../src/game/ratings';
import { maybeDrawEvent, resolveEvent } from '../src/game/events';
import type { Core, Player } from '../src/game/types';

const N = Number(process.argv[2]) || 12;
const SEASONS = 3;

function prospect(core: Core, seed: number, pos: 'SS' | 'SP', i: number): Player {
  const ctx = makeCtx(mulberry32(seed * 31 + i), `fg${i}-`, []);
  const p = genPlayer(ctx, pos, 47, { age: 19 });
  // OVR 47 근처로 맞춘다
  const keys = p.kind === 'B' ? (['con', 'pow', 'eye', 'spd', 'def'] as const) : (['stf', 'ctl', 'sta'] as const);
  for (let g = 0; g < 200 && calcOvr(p) !== 47; g++) {
    const k = keys[g % keys.length];
    p[k] += calcOvr(p) < 47 ? 1 : -1;
  }
  p.ovr = calcOvr(p);
  p.pot = 82;
  p.farm = true;
  p.salary = 3000;
  return p;
}

function run(lv: number, where: 'farm' | 'bench'): { b: number[]; p: number[] } {
  const b = new Array(SEASONS + 1).fill(0);
  const pp = new Array(SEASONS + 1).fill(0);
  for (let seed = 1; seed <= N; seed++) {
    const rng = mulberry32(seed * 7919);
    let core = newCore(seed);
    core.facilities.training = lv;
    core.finance.cash = 9e6; // 자금 변수 제거
    const t = userTeam(core);
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) {
      const p = prospect(core, seed, i < 2 ? 'SS' : 'SP', i);
      if (where === 'bench') delete p.farm;
      t.roster.push(p);
      ids.push(p.id);
    }
    const rec = (s: number) => {
      const r = userTeam(core).roster;
      ids.forEach((id, i) => {
        const p = r.find((x) => x.id === id);
        if (p) (i < 2 ? b : pp)[s] += p.ovr / (2 * N);
      });
    };
    rec(0);
    for (let s = 1; s <= SEASONS; s++) {
      while (core.phase === 'season' || core.phase === 'post') {
        core = maybeDrawEvent(core, rng);
        if (core.campaign.event) core = resolveEvent(core, core.campaign.event.choices.length - 1, rng).core;
        core = advanceDay(core, rng).core;
      }
      if (core.phase === 'over') break;
      core = nextSeason(core, rng);
      core.finance.cash = 9e6;
      rec(s);
    }
  }
  return { b, p: pp };
}

const f1 = (v: number) => v.toFixed(1).padStart(5);
console.log(`2군 성장 측정 (시드 ${N}개 평균 · 19세 OVR 47 · 잠재 82 · 값은 시즌 교체 뒤 OVR)`);
console.log('훈련장            위치    | 타자: 시작  1시즌  2시즌  3시즌 | 투수: 시작  1시즌  2시즌  3시즌');
for (const lv of [0, 2, 3]) {
  for (const where of ['farm', 'bench'] as const) {
    const r = run(lv, where);
    console.log(`Lv${lv + 1} ${TRAIN_LV[lv].name.padEnd(8, '　')} ${where === 'farm' ? '2군 ' : '1군벤치'} |      ${r.b.map(f1).join('  ')} |      ${r.p.map(f1).join('  ')}`);
  }
}
