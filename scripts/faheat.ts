// FA 계약금 누진 검증: 화면이 쓰는 미리보기 금액 = 실제 지출 (오차 0)
//   npx tsx scripts/faheat.ts [시드 수=20]
// ① 이적 창구 요약(previewTransfer)의 선수별 계약금·합계·현금 = applyTransfer 뒤의 실제 현금 감소
// ② 한 명씩 영입: signingBonusFor(영입 시장 줄·카드·브리핑·조치 시트가 쓰는 값) = signPlayer 의 현금 감소, 배율은 FA_HEAT 표 그대로
// ③ 시즌 묶음: 스토브리그(결산 뒤)의 영입은 다음 시즌 몫, 그다음 결산 뒤에는 0 으로
// ④ 8구단 리그: 배율 없음 (계약금 = 연봉 × SIGN_BONUS_RATE)
import { newCore } from '../src/game/generate';
import { mulberry32 } from '../src/game/rng';
import { ensureObjectives } from '../src/game/campaign';
import { activeRoster, ROSTER_MAX, userTeam, FA_HEAT, faHeatLine, faHeatMult, faSigned, signingBonus, signingBonusFor, SIGN_BONUS_RATE } from '../src/game/economy';
import { sendDown, signPlayer } from '../src/game/season';
import { applyTransfer, emptyBasket, previewTransfer } from '../src/game/transfer';
import type { Core } from '../src/game/types';

const N = Number(process.argv[2]) || 20;
let fails = 0;
let checks = 0;
const eq = (what: string, a: number, b: number) => {
  checks++;
  if (a !== b) {
    fails++;
    console.log(`  ✗ ${what}: ${a} ≠ ${b}`);
  }
};
const mk = (seed: number, teams?: number): Core => {
  const c = ensureObjectives(newCore(seed, teams ? { teams } : undefined), mulberry32(seed));
  c.finance.cash = 5_000_000;
  // 1군 자리 4개를 비운다 (오버롤이 낮은 선수부터 2군으로)
  let out = c;
  for (const p of userTeam(c).roster.filter((x) => !x.farm).sort((a, b) => a.ovr - b.ovr)) {
    if (activeRoster(userTeam(out)).length <= ROSTER_MAX - 4) break;
    const r = sendDown(out, p.id);
    if (!r.error) out = r.core;
  }
  return out;
};
const pick4 = (c: Core, seed: number) => {
  const r = mulberry32(seed * 31 + 7);
  const pool = c.freeAgents.filter((p) => !p.foreign);
  const out: string[] = [];
  while (out.length < 4) {
    const p = pool[Math.floor(r() * pool.length)];
    if (!out.includes(p.id)) out.push(p.id);
  }
  return out;
};

for (let seed = 1; seed <= N; seed++) {
  // ① 바구니 4명
  const c0 = mk(seed);
  const ids = pick4(c0, seed);
  const basket = { ...emptyBasket(), sign: ids };
  const pv = previewTransfer(c0, basket);
  const done = applyTransfer(c0, basket);
  if (done.error) { fails++; console.log(`  ✗ seed ${seed}: ${done.error}`); continue; }
  eq(`seed ${seed} 요약 계약금 합 = 실제 지출`, pv.bonus, c0.finance.cash - done.core.finance.cash);
  eq(`seed ${seed} 요약 선수별 합 = 합계`, pv.ins.reduce((s, x) => s + x.bonus, 0), pv.bonus);
  eq(`seed ${seed} 요약 현금 = 실제 현금`, pv.cash.b, done.core.finance.cash);
  eq(`seed ${seed} 장부 계약금`, done.core.finance.ledger.signing - c0.finance.ledger.signing, pv.bonus);
  // ② 한 명씩
  let c = c0;
  ids.forEach((id, i) => {
    const p = c.freeAgents.find((x) => x.id === id)!;
    const show = signingBonusFor(c, p);
    eq(`seed ${seed} ${i + 1}번째 미리보기 = 요약의 ${i + 1}번째`, show, pv.ins[i].bonus);
    eq(`seed ${seed} ${i + 1}번째 배율`, show, Math.round(p.salary * SIGN_BONUS_RATE * faHeatMult(i)));
    const r = signPlayer(c, id);
    eq(`seed ${seed} ${i + 1}번째 미리보기 = 실제 지출`, show, c.finance.cash - r.core.finance.cash);
    c = r.core;
    eq(`seed ${seed} 영입 수`, faSigned(c), i + 1);
  });
  eq(`seed ${seed} 배율로 더 낸 몫`, c.campaign.fa!.extra, c.campaign.fa!.paid - ids.reduce((s, id) => s + signingBonus(c0.freeAgents.find((x) => x.id === id)!), 0));
  // ③ 시즌 묶음
  const next = structuredClone(c);
  next.season++;
  eq(`seed ${seed} 다음 시즌에는 0명`, faSigned(next), 0);
  const stove = structuredClone(c0);
  stove.phase = 'ended';
  const s1 = signPlayer(stove, ids[0]).core;
  eq(`seed ${seed} 스토브리그 영입 1명`, faSigned(s1), 1);
  const opened = structuredClone(s1);
  opened.phase = 'season';
  opened.season++;
  eq(`seed ${seed} 스토브리그 영입은 다음 시즌 몫`, faSigned(opened), 1);
  const ended = structuredClone(opened);
  ended.phase = 'ended';
  eq(`seed ${seed} 다음 결산 뒤에는 0명`, faSigned(ended), 0);
  // ④ 8구단
  let e = mk(seed, 8);
  for (const id of pick4(e, seed)) {
    const p = e.freeAgents.find((x) => x.id === id)!;
    eq(`seed ${seed} 8구단 미리보기 = 기본 계약금`, signingBonusFor(e, p), signingBonus(p));
    const r = signPlayer(e, id);
    eq(`seed ${seed} 8구단 실제 지출`, e.finance.cash - r.core.finance.cash, signingBonus(p));
    e = r.core;
  }
  eq(`seed ${seed} 8구단은 세지 않는다`, e.campaign.fa ? 1 : 0, 0);
  if (faHeatLine(e) !== null) { fails++; console.log(`  ✗ seed ${seed}: 8구단에 안내 줄이 보인다`); }
}
console.log(`FA 계약금 누진 검증: ${N}시드 · 배율 ${FA_HEAT.mult.join('/')} (+${FA_HEAT.step}) · 비교 ${checks}건 · 불일치 ${fails}건`);
if (fails) process.exitCode = 1;
