// 시즌 중 의사결정 이벤트 카드. docs/LEVEL_DESIGN.md 4절.
// 카드 id 는 "기본id" 또는 "기본id|payload…" 형태 (eventsSeen 에는 기본id 만 기록).
import type { Buff, Core, EventCard, Player } from './types';
import { clamp, pick, randInt, type Rng } from './rng';
import { calcOvr, calcSalary } from './ratings';
import { fixLineup, slotNewcomer } from './lineup';
import { ROSTER_MAX, userTeam } from './economy';
import { genPlayer, makeCtx } from './generate';
import { fmtMoney } from './format';
import { addNews } from './season';
import { shiftOvr } from './draft';

// ── 튜닝 상수 ──
export const EVENT_DAYS = [9, 21, 33, 45, 57, 69]; // 이 경기 수를 치른 직후 1장
export const FOREIGN_MAX = 3;
const STAGE_SCALE = 0.3; // 금액 스케일 = 1 + stage × 0.3 + fans / FAN_SCALE
const FAN_SCALE = 40000;
const BUFF_GAMES = 6;
const BUFF_LONG = 12;

const N = {
  sponsorCash: 20000,
  sponsorSat: -3,
  keepSat: 4,
  fanDayCost: 5000,
  fanDayFans: 250,
  fanDaySat: 5,
  campCost: 8000,
  campGain: [3, 5] as [number, number],
  raiseRate: 0.2,
  refuseStar: -10,
  refuseAbil: -2,
  refuseFans: -200,
  typhoonCost: 12000,
  typhoonCap: 0.85,
  docuFans: 400,
  docuFocus: -3,
  foreignCost: 50000,
  foreignOvr: [78, 84] as [number, number],
  meetTicket: 0.8,
  meetSat: 8,
  silentSat: -6,
  goodsCost: 6000,
  goodsMult: 1.5,
  tourDemand: 1.2,
  pledgeRate: 0.55, // 남은 경기 중 이 승률 이상
  holdTrust: -3,
  youthCost: 4000,
  youthFans: 150,
  youthQuality: 4,
  reinjury: 0.3,
  marketFood: 1.25,
  marketSat: 2,
  marketUpkeep: 60,
  halfFans: 150,
  dinnerCost: 3000,
  dinnerFocus: 2,
  seasonTixCash: 15000,
  seasonTixRate: 0.88,
};

interface CardDef {
  id: string;
  cond: (core: Core) => boolean;
  make: (core: Core, rng: Rng) => EventCard | null;
  resolve: (core: Core, idx: number, card: EventCard, rng: Rng) => string;
}

const scale = (core: Core) => 1 + core.campaign.stage * STAGE_SCALE + core.fans / FAN_SCALE;
const money = (core: Core, v: number) => Math.round((v * scale(core)) / 1000) * 1000;
const cashGate = (core: Core, cost: number): string | undefined => (core.finance.cash < cost ? `현금 부족 (필요 ${fmtMoney(cost)})` : undefined);
const sat = (core: Core, d: number) => (core.fanSat = clamp(Math.round((core.fanSat + d) * 10) / 10, 0, 100));
const spend = (core: Core, v: number) => {
  core.finance.cash -= v;
  core.finance.ledger.upkeep += v;
};
const addBuff = (core: Core, b: Buff) => core.campaign.buffs.push(b);
const findUser = (core: Core, pid?: string) => (pid ? userTeam(core).roster.find((p) => p.id === pid) : undefined);
const parts = (card: EventCard) => card.id.split('|');
const foreignCount = (core: Core) => userTeam(core).roster.filter((p) => p.foreign).length;

type AbilKey = 'con' | 'pow' | 'eye' | 'spd' | 'def' | 'stf' | 'ctl' | 'sta';
const keysOf = (p: Player): AbilKey[] => (p.kind === 'B' ? ['con', 'pow', 'eye', 'spd', 'def'] : ['stf', 'ctl', 'sta']);
function bump(p: Player, rng: Rng, d: number, n: number): void {
  const ks = keysOf(p);
  for (let i = 0; i < n; i++) {
    const k = pick(rng, ks);
    p[k] = clamp(p[k] + d, 20, 99);
  }
  p.ovr = calcOvr(p);
  p.pot = Math.max(p.pot, p.ovr);
}

export const CARDS: CardDef[] = [
  {
    id: 'sponsor',
    cond: () => true,
    make: (c) => ({
      id: 'sponsor',
      title: '지역 스폰서 제안',
      icon: '🪧',
      body: '제주 감귤 농협이 외야 펜스 전체를 광고판으로 덮자고 제안했습니다. 팬들은 바다가 보이는 지금의 외야를 좋아합니다.',
      choices: [
        { label: '광고판 설치', desc: `현금 +${fmtMoney(money(c, N.sponsorCash))} · 만족도 ${N.sponsorSat}` },
        { label: '팬 친화 구장 유지', desc: `만족도 +${N.keepSat}` },
      ],
    }),
    resolve: (c, i) => {
      if (i === 0) {
        const v = money(c, N.sponsorCash);
        c.finance.cash += v;
        c.finance.ledger.league += v;
        sat(c, N.sponsorSat);
        return `외야 광고판 설치 — 현금 +${fmtMoney(v)}`;
      }
      sat(c, N.keepSat);
      return '바다가 보이는 외야를 지켰습니다 — 만족도 상승';
    },
  },
  {
    id: 'fanday',
    cond: () => true,
    make: (c) => {
      const cost = money(c, N.fanDayCost);
      return {
        id: 'fanday',
        title: '팬 감사 데이',
        icon: '🎉',
        body: '홈 팬들을 위한 사인회와 경품 추첨 행사를 열자는 의견이 나왔습니다.',
        choices: [
          { label: '개최', desc: `비용 ${fmtMoney(cost)} → 팬 +${N.fanDayFans} · 만족도 +${N.fanDaySat}`, disabled: cashGate(c, cost) },
          { label: '거절', desc: '변화 없음' },
        ],
      };
    },
    resolve: (c, i) => {
      if (i !== 0) return '팬 감사 데이는 다음 기회로';
      spend(c, money(c, N.fanDayCost));
      c.fans += N.fanDayFans;
      sat(c, N.fanDaySat);
      return `팬 감사 데이 성황 — 팬 +${N.fanDayFans}`;
    },
  },
  {
    id: 'camp',
    cond: (c) => userTeam(c).roster.some((p) => p.age <= 25 && p.ovr < p.pot),
    make: (c) => {
      const p = userTeam(c)
        .roster.filter((x) => x.age <= 25 && x.ovr < x.pot)
        .sort((a, b) => b.pot - b.ovr - (a.pot - a.ovr))[0];
      const cost = money(c, N.campCost);
      return {
        id: 'camp',
        title: '유망주 집중 캠프',
        icon: '🏋️',
        pid: p.id,
        body: `코치진이 ${p.name}(${p.age}세, 잠재력 높음)을 위한 특별 캠프를 건의했습니다.`,
        choices: [
          { label: '캠프 보내기', desc: `비용 ${fmtMoney(cost)} → 능력치 +${N.campGain[0]}~${N.campGain[1]}`, disabled: cashGate(c, cost) },
          { label: '거절', desc: '변화 없음' },
        ],
      };
    },
    resolve: (c, i, card, rng) => {
      const p = findUser(c, card.pid);
      if (i !== 0 || !p) return '캠프는 보류했습니다';
      spend(c, money(c, N.campCost));
      const before = p.ovr;
      const n = randInt(rng, N.campGain[0], N.campGain[1]);
      bump(p, rng, 1, n * 2);
      return `${p.name} 캠프 성과 — OVR ${before} → ${p.ovr}`;
    },
  },
  {
    id: 'raise',
    cond: (c) => userTeam(c).roster.some((p) => p.star >= 55),
    make: (c) => {
      const p = userTeam(c).roster.slice().sort((a, b) => b.star - a.star)[0];
      return {
        id: 'raise',
        title: '간판스타 연봉 인상 요구',
        icon: '💼',
        pid: p.id,
        body: `${p.name}의 에이전트가 연봉 ${Math.round(N.raiseRate * 100)}% 인상을 요구합니다. 거절하면 선수와 팬 모두 서운해할 겁니다.`,
        choices: [
          { label: '수락', desc: `연봉 ${fmtMoney(p.salary)} → ${fmtMoney(Math.round(p.salary * (1 + N.raiseRate)))}` },
          { label: '거절', desc: `스타성 ${N.refuseStar} · 컨디션 하락 · 팬 ${N.refuseFans}` },
        ],
      };
    },
    resolve: (c, i, card, rng) => {
      const p = findUser(c, card.pid);
      if (!p) return '협상이 흐지부지되었습니다';
      if (i === 0) {
        p.salary = Math.round(p.salary * (1 + N.raiseRate));
        return `${p.name} 연봉 인상 합의 — ${fmtMoney(p.salary)}`;
      }
      p.star = clamp(p.star + N.refuseStar, 0, 100);
      bump(p, rng, N.refuseAbil, 1);
      c.fans = Math.max(1000, c.fans + N.refuseFans);
      return `${p.name} 인상 거절 — 불만이 쌓입니다`;
    },
  },
  {
    id: 'trade',
    cond: (c) => userTeam(c).roster.some((p) => p.ovr >= 55),
    make: (c, rng) => {
      const u = userTeam(c);
      const top3 = u.roster.slice().sort((a, b) => b.ovr - a.ovr).slice(0, 3).map((p) => p.id);
      const mine = u.roster.filter((p) => p.ovr >= 55 && !top3.includes(p.id));
      if (!mine.length) return null;
      const me = pick(rng, mine);
      const ais = c.teams.filter((t) => t.id !== c.userId);
      const cands = ais.flatMap((t) => t.roster.filter((p) => p.kind === me.kind && p.ovr >= me.ovr - 6 && p.ovr <= me.ovr + 2 && !p.foreign).map((p) => ({ t, p })));
      if (!cands.length) return null;
      const { t, p } = pick(rng, cands);
      const cash = Math.max(0, Math.round(((me.ovr - p.ovr) * 2500 + 5000) * scale(c) / 1000) * 1000);
      return {
        id: `trade|${t.id}|${p.id}|${cash}`,
        title: '트레이드 제안',
        icon: '🔄',
        pid: me.id,
        body: `${t.city} ${t.name}이(가) ${me.name}(${me.pos} OVR${me.ovr}, ${me.age}세, 연봉 ${fmtMoney(me.salary)})을 원합니다. 대가로 ${p.name}(${p.pos} OVR${p.ovr}, ${p.age}세, 연봉 ${fmtMoney(p.salary)})${cash ? ` + 현금 ${fmtMoney(cash)}` : ''}을(를) 제시했습니다.`,
        choices: [
          { label: '수락', desc: `${me.name} ↔ ${p.name}${cash ? ` + ${fmtMoney(cash)}` : ''}` },
          { label: '거절', desc: '현 전력 유지' },
        ],
      };
    },
    resolve: (c, i, card) => {
      if (i !== 0) return '트레이드 제안을 거절했습니다';
      const [, tid, aid, cashS] = parts(card);
      const u = userTeam(c);
      const t = c.teams.find((x) => x.id === tid);
      const me = findUser(c, card.pid);
      const ap = t?.roster.find((x) => x.id === aid);
      if (!t || !me || !ap) return '상대 구단 사정으로 트레이드가 무산되었습니다';
      u.roster = u.roster.filter((x) => x.id !== me.id);
      t.roster = t.roster.filter((x) => x.id !== ap.id);
      u.roster.push(ap);
      t.roster.push(me);
      fixLineup(u);
      slotNewcomer(u, ap);
      fixLineup(t);
      slotNewcomer(t, me);
      const cash = Number(cashS) || 0;
      c.finance.cash += cash;
      c.finance.ledger.sales += cash;
      addNews(c, `트레이드: ${me.name} ↔ ${ap.name}(${t.name})${cash ? ` + ${fmtMoney(cash)}` : ''}`, 'info');
      return `트레이드 성사 — ${ap.name} 합류`;
    },
  },
  {
    id: 'typhoon',
    cond: () => true,
    make: (c) => {
      const cost = money(c, N.typhoonCost);
      return {
        id: 'typhoon',
        title: '태풍 피해',
        icon: '🌀',
        body: '태풍이 제주를 지나가며 관중석 일부가 파손되었습니다.',
        choices: [
          { label: '긴급 보수', desc: `비용 ${fmtMoney(cost)}`, disabled: cashGate(c, cost) },
          { label: '방치', desc: `다음 ${BUFF_GAMES} 홈경기 수용 인원 −${Math.round((1 - N.typhoonCap) * 100)}%` },
        ],
      };
    },
    resolve: (c, i) => {
      if (i === 0) {
        spend(c, money(c, N.typhoonCost));
        return '관중석 긴급 보수 완료';
      }
      addBuff(c, { kind: 'capacity', value: N.typhoonCap, until: 9999, left: BUFF_GAMES, label: `태풍 피해 수용 −${Math.round((1 - N.typhoonCap) * 100)}%` });
      return `파손된 좌석 폐쇄 — ${BUFF_GAMES} 홈경기 동안 수용 인원 감소`;
    },
  },
  {
    id: 'docu',
    cond: () => true,
    make: () => ({
      id: 'docu',
      title: '방송국 다큐 제안',
      icon: '🎥',
      body: '공중파 다큐 팀이 "섬 구단의 도전"을 밀착 취재하고 싶어 합니다. 카메라가 더그아웃까지 들어옵니다.',
      choices: [
        { label: '수락', desc: `팬 +${N.docuFans} · 다음 ${BUFF_GAMES}경기 집중력 ${N.docuFocus}` },
        { label: '거절', desc: '변화 없음' },
      ],
    }),
    resolve: (c, i) => {
      if (i !== 0) return '선수단 집중을 위해 취재를 거절했습니다';
      c.fans += N.docuFans;
      addBuff(c, { kind: 'focus', value: N.docuFocus, until: c.day + BUFF_GAMES, label: `다큐 촬영 집중력 ${N.docuFocus}` });
      return `다큐 방영 확정 — 팬 +${N.docuFans}`;
    },
  },
  {
    id: 'foreign',
    cond: () => true,
    make: (c) => {
      const cost = money(c, N.foreignCost);
      const u = userTeam(c);
      const dis =
        foreignCount(c) >= FOREIGN_MAX
          ? `외국인 보유 한도 ${FOREIGN_MAX}명`
          : u.roster.length >= ROSTER_MAX
            ? '로스터가 가득 찼습니다'
            : cashGate(c, cost);
      return {
        id: 'foreign',
        title: '외인 교체 시장',
        icon: '✈️',
        body: `해외 리그에서 방출된 OVR ${N.foreignOvr[0]}~${N.foreignOvr[1]}급 외국인 선수를 잡을 기회입니다. 연봉은 별도입니다.`,
        choices: [
          { label: '즉시 영입', desc: `이적료 ${fmtMoney(cost)} + 연봉`, disabled: dis },
          { label: '패스', desc: '변화 없음' },
        ],
      };
    },
    resolve: (c, i, _card, rng) => {
      if (i !== 0) return '외인 시장은 지켜만 봤습니다';
      const u = userTeam(c);
      const names = c.teams.flatMap((t) => t.roster.map((p) => p.name));
      const ctx = makeCtx(rng, `ev${c.season}-${c.day}-`, names);
      const pos = pick(rng, ['1B', 'LF', 'RF', '3B', 'SP', 'SP'] as const);
      const p = genPlayer(ctx, pos, 80, { foreign: true, age: randInt(rng, 27, 32), tag: '시즌 중 영입 외인' });
      shiftOvr(p, randInt(rng, N.foreignOvr[0], N.foreignOvr[1]));
      p.pot = Math.max(p.pot, p.ovr);
      p.salary = calcSalary(p);
      p.star = clamp(Math.max(p.star, 60), 0, 100);
      const cost = money(c, N.foreignCost);
      c.finance.cash -= cost;
      c.finance.ledger.signing += cost;
      u.roster.push(p);
      const role = slotNewcomer(u, p);
      addNews(c, `외인 영입: ${p.name}(${p.pos} OVR${p.ovr}) — ${role}`, 'good');
      return `${p.name} 입단 (${role})`;
    },
  },
  {
    id: 'meeting',
    cond: (c) => userTeam(c).rec.streak <= -5,
    make: (c) => ({
      id: 'meeting',
      title: '연패 중 팬 간담회',
      icon: '🙇',
      body: `${-userTeam(c).rec.streak}연패에 성난 팬들이 간담회를 요구합니다.`,
      choices: [
        { label: '사과 + 할인', desc: `${BUFF_GAMES} 홈경기 입장 수입 −${Math.round((1 - N.meetTicket) * 100)}% · 만족도 +${N.meetSat}` },
        { label: '침묵', desc: `만족도 ${N.silentSat}` },
      ],
    }),
    resolve: (c, i) => {
      if (i === 0) {
        sat(c, N.meetSat);
        addBuff(c, { kind: 'ticket', value: N.meetTicket, until: 9999, left: BUFF_GAMES, label: `사과 할인 입장 수입 −${Math.round((1 - N.meetTicket) * 100)}%` });
        return '진심 어린 사과 — 팬심이 조금 누그러졌습니다';
      }
      sat(c, N.silentSat);
      return '침묵… 팬들의 실망이 커집니다';
    },
  },
  {
    id: 'goods',
    cond: (c) => userTeam(c).rec.streak >= 4,
    make: (c) => {
      const cost = money(c, N.goodsCost);
      return {
        id: 'goods',
        title: '연승 굿즈 콜라보',
        icon: '🧢',
        body: '연승 분위기를 타고 캐릭터 브랜드가 한정판 굿즈 콜라보를 제안했습니다.',
        choices: [
          { label: '투자', desc: `비용 ${fmtMoney(cost)} → ${BUFF_LONG}경기 굿즈 ×${N.goodsMult}`, disabled: cashGate(c, cost) },
          { label: '패스', desc: '변화 없음' },
        ],
      };
    },
    resolve: (c, i) => {
      if (i !== 0) return '콜라보는 패스했습니다';
      spend(c, money(c, N.goodsCost));
      addBuff(c, { kind: 'merch', value: N.goodsMult, until: c.day + BUFF_LONG, label: `굿즈 콜라보 ×${N.goodsMult}` });
      return '한정판 굿즈 출시!';
    },
  },
  {
    id: 'tour',
    cond: (c) => userTeam(c).roster.some((p) => p.age >= 35),
    make: (c) => {
      const p = userTeam(c).roster.filter((x) => x.age >= 35).sort((a, b) => b.star - a.star)[0];
      return {
        id: 'tour',
        title: '베테랑 은퇴 투어',
        icon: '🎖️',
        pid: p.id,
        body: `${p.name}(${p.age}세)의 마지막 시즌일지 모릅니다. 기념 경기를 열어 줄까요?`,
        choices: [
          { label: '기념 경기', desc: `${BUFF_GAMES} 홈경기 관중 수요 +${Math.round((N.tourDemand - 1) * 100)}% · ${p.name} 고정 출전` },
          { label: '조용히', desc: '변화 없음' },
        ],
      };
    },
    resolve: (c, i, card) => {
      const p = findUser(c, card.pid);
      if (i !== 0 || !p) return '조용히 시즌을 이어갑니다';
      addBuff(c, { kind: 'demand', value: N.tourDemand, until: 9999, left: BUFF_GAMES, label: `${p.name} 은퇴 투어`, pid: p.id });
      return `${p.name} 은퇴 투어 시작 — 관중 수요 상승`;
    },
  },
  {
    id: 'owner',
    cond: (c) => c.campaign.trust <= 40,
    make: (c) => {
      const u = userTeam(c);
      const remain = Math.max(0, c.schedule.length - c.day);
      const target = u.rec.w + Math.ceil(remain * N.pledgeRate);
      return {
        id: `owner|${target}`,
        title: '구단주 호출',
        icon: '☎️',
        body: `신임이 바닥난 구단주가 단장을 불렀습니다. "올 시즌 ${target}승은 하겠다고 약속할 수 있나?"`,
        choices: [
          { label: '공약 걸기', desc: `시즌 ${target}승 달성 시 신임 +15, 실패 시 −10` },
          { label: '버티기', desc: '신임 −3' },
        ],
      };
    },
    resolve: (c, i, card) => {
      if (i === 0) {
        const target = Number(parts(card)[1]) || 0;
        addBuff(c, { kind: 'pledge', value: target, until: 9999, label: `구단주 공약 ${target}승` });
        return `공약: 시즌 ${target}승`;
      }
      c.campaign.trust = clamp(c.campaign.trust + N.holdTrust, 0, 100);
      return '말을 아꼈습니다 — 신임 소폭 하락';
    },
  },
  {
    id: 'youth',
    cond: () => true,
    make: (c) => {
      const cost = money(c, N.youthCost);
      return {
        id: 'youth',
        title: '지역 유소년 야구 후원',
        icon: '🧒',
        body: '제주 리틀야구단이 장비 후원을 요청했습니다. 섬의 야구 꿈나무를 키우면 언젠가 돌아올지도 모릅니다.',
        choices: [
          { label: '후원', desc: `비용 ${fmtMoney(cost)} → 다음 드래프트 풀 품질↑ · 팬 +${N.youthFans}`, disabled: cashGate(c, cost) },
          { label: '거절', desc: '변화 없음' },
        ],
      };
    },
    resolve: (c, i) => {
      if (i !== 0) return '후원은 다음에';
      spend(c, money(c, N.youthCost));
      c.fans += N.youthFans;
      addBuff(c, { kind: 'youth', value: N.youthQuality, until: 9999, label: '유소년 후원 (드래프트 품질↑)' });
      return `유소년 후원 — 팬 +${N.youthFans}`;
    },
  },
  {
    id: 'early',
    cond: (c) => userTeam(c).roster.some((p) => p.injury >= 4),
    make: (c) => {
      const p = userTeam(c).roster.filter((x) => x.injury >= 4).sort((a, b) => b.ovr - a.ovr)[0];
      return {
        id: 'early',
        title: '부상 선수 조기 복귀',
        icon: '🩹',
        pid: p.id,
        body: `${p.name}(OVR${p.ovr})이 ${p.injury}경기 남은 재활을 건너뛰고 뛰겠다고 합니다.`,
        choices: [
          { label: '강행', desc: `즉시 복귀 · 재부상 위험 ${Math.round(N.reinjury * 100)}%` },
          { label: '대기', desc: '재활 계속' },
        ],
      };
    },
    resolve: (c, i, card, rng) => {
      const p = findUser(c, card.pid);
      if (i !== 0 || !p) return '재활을 끝까지 마치기로 했습니다';
      const left = p.injury;
      if (rng() < N.reinjury) {
        p.injury = left + randInt(rng, 4, 10);
        return `${p.name} 복귀 훈련 중 재부상… ${p.injury}경기 결장`;
      }
      p.injury = 0;
      fixLineup(userTeam(c));
      return `${p.name} 조기 복귀!`;
    },
  },
  {
    id: 'market',
    cond: () => true,
    make: (c) => ({
      id: 'market',
      title: '주차장 야시장',
      icon: '🏮',
      body: '경기 날 주차장에 야시장을 열자는 상인회 제안. 먹거리는 늘지만 관리 비용이 듭니다.',
      choices: [
        {
          label: '야시장 개장',
          desc: `${BUFF_LONG} 홈경기 매점 +${Math.round((N.marketFood - 1) * 100)}% · 만족도 +${N.marketSat} · 유지비 +${fmtMoney(money(c, N.marketUpkeep))}/홈경기`,
        },
        { label: '거절', desc: '변화 없음' },
      ],
    }),
    resolve: (c, i) => {
      if (i !== 0) return '야시장은 열지 않았습니다';
      sat(c, N.marketSat);
      addBuff(c, { kind: 'food', value: N.marketFood, until: 9999, left: BUFF_LONG, label: `야시장 매점 +${Math.round((N.marketFood - 1) * 100)}%` });
      addBuff(c, { kind: 'upkeep', value: money(c, N.marketUpkeep), until: 9999, left: BUFF_LONG, label: '야시장 관리비' });
      return '야시장 개장 — 주차장이 북적입니다';
    },
  },
  {
    id: 'rival',
    cond: () => true,
    make: () => ({
      id: 'rival',
      title: '라이벌전 특별 프로모션',
      icon: '⚔️',
      body: '다음 홈 3연전을 "반값 라이벌전"으로 홍보하자는 마케팅팀 제안입니다.',
      choices: [
        { label: '반값 행사', desc: `3 홈경기 티켓 반값 (관중↑ 수입↓) · 팬 +${N.halfFans}` },
        { label: '정상가', desc: '변화 없음' },
      ],
    }),
    resolve: (c, i) => {
      if (i !== 0) return '정상가로 갑니다';
      c.fans += N.halfFans;
      addBuff(c, { kind: 'halfPrice', value: 0.5, until: 9999, left: 3, label: '반값 라이벌전' });
      return `반값 라이벌전 확정 — 팬 +${N.halfFans}`;
    },
  },
  {
    id: 'dinner',
    cond: () => true,
    make: (c) => {
      const cost = money(c, N.dinnerCost);
      return {
        id: 'dinner',
        title: '선수단 회식',
        icon: '🍖',
        body: '주장이 흑돼지 회식으로 분위기를 바꿔 보자고 합니다.',
        choices: [
          { label: '회식 지원', desc: `비용 ${fmtMoney(cost)} → ${BUFF_GAMES}경기 집중력 +${N.dinnerFocus}`, disabled: cashGate(c, cost) },
          { label: '거절', desc: '변화 없음' },
        ],
      };
    },
    resolve: (c, i) => {
      if (i !== 0) return '회식은 각자 알아서';
      spend(c, money(c, N.dinnerCost));
      addBuff(c, { kind: 'focus', value: N.dinnerFocus, until: c.day + BUFF_GAMES, label: `회식 효과 집중력 +${N.dinnerFocus}` });
      return '선수단 분위기 상승!';
    },
  },
  {
    id: 'seasontix',
    cond: (c) => c.day <= 45,
    make: (c) => ({
      id: 'seasontix',
      title: '후반기 시즌권 조기 판매',
      icon: '🎫',
      body: '후반기 시즌권을 할인가로 미리 팔면 당장 현금이 들어오지만, 이후 입장 수입은 줄어듭니다.',
      choices: [
        { label: '조기 판매', desc: `현금 +${fmtMoney(money(c, N.seasonTixCash))} · ${BUFF_LONG} 홈경기 입장 수입 −${Math.round((1 - N.seasonTixRate) * 100)}%` },
        { label: '보류', desc: '변화 없음' },
      ],
    }),
    resolve: (c, i) => {
      if (i !== 0) return '시즌권 판매는 보류했습니다';
      const v = money(c, N.seasonTixCash);
      c.finance.cash += v;
      c.finance.ledger.ticket += v;
      addBuff(c, { kind: 'ticket', value: N.seasonTixRate, until: 9999, left: BUFF_LONG, label: `시즌권 선판매 입장 −${Math.round((1 - N.seasonTixRate) * 100)}%` });
      return `시즌권 선판매 — 현금 +${fmtMoney(v)}`;
    },
  },
];

const baseId = (id: string) => id.split('|')[0];

/** 이벤트 경기일이면 카드 1장을 뽑아 campaign.event 에 둔다. 해당 없으면 원본 반환. */
export function maybeDrawEvent(core0: Core, rng: Rng): Core {
  if (core0.phase !== 'season' || core0.campaign.event) return core0;
  const k = EVENT_DAYS.indexOf(core0.day);
  if (k < 0 || core0.campaign.eventsSeen.length > k) return core0;
  const seen = new Set(core0.campaign.eventsSeen);
  const pool = CARDS.filter((d) => !seen.has(d.id) && d.cond(core0));
  // 조건부 카드(상황 맞춤)를 조금 더 자주
  const core = structuredClone(core0);
  for (let guard = 0; guard < 6 && pool.length; guard++) {
    const d = pick(rng, pool);
    const card = d.make(core, rng);
    if (card) {
      core.campaign.event = card;
      core.campaign.eventsSeen.push(d.id);
      addNews(core, `${card.icon} 이벤트: ${card.title}`, 'info');
      return core;
    }
    pool.splice(pool.indexOf(d), 1);
  }
  return core0;
}

export function resolveEvent(core0: Core, choiceIdx: number, rng: Rng): { core: Core; error?: string; result: string } {
  const card0 = core0.campaign.event;
  if (!card0) return { core: core0, error: '처리할 이벤트가 없습니다', result: '' };
  const ch = card0.choices[choiceIdx];
  if (!ch) return { core: core0, error: '잘못된 선택입니다', result: '' };
  if (ch.disabled) return { core: core0, error: ch.disabled, result: '' };
  const def = CARDS.find((d) => d.id === baseId(card0.id));
  const core = structuredClone(core0);
  const card = core.campaign.event!;
  core.campaign.event = null;
  const result = def ? def.resolve(core, choiceIdx, card, rng) : '이벤트가 지나갔습니다';
  core.fans = Math.max(1000, Math.round(core.fans));
  addNews(core, `${card.icon} ${card.title}: ${result}`, 'info');
  return { core, result };
}

/** 표시용: 이벤트 카드 풀 크기 */
export const EVENT_POOL_SIZE = CARDS.length;
