import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { bonusText, faHeatLine, faSigned, farmMax, farmRoster } from '../../game/economy';
import { luxPiece } from '../../game/runway';
import type { Player } from '../../game/types';
import { play } from '../../audio/sfx';
import { fmtInt, fmtMoney } from '../../game/format';
import { FOREIGN_MAX, ROSTER_MAX, basketCount, basketKindOf, previewTransfer, type BasketKind, type TransferPreview } from '../../game/transfer';
import { TR, trFrom, tradeLeft, tradeOpen } from '../../game/trade';
import { regDeadline, blockClosedWhy, signingClosedWhy, signingOpen } from '../../game/economy';
import { pickCore, useCore, useStore, useUserTeam } from '../../store';
import { signImpact } from '../../game/analysis';
import { useIsMobile } from '../layout/useLayout';
import { POS_FULL } from '../ui';
import { CardPop, FullScreen } from './RosterList';
import PlayerBrowser from './PlayerBrowser';
import Help from '../Help';
import { PART_KO, fmtDelta } from './labels';
import { usePosReport } from './rosterUi';
import { useTransferUi } from './transferUi';
import { TRADE_HINT, releaseAdvice, releaseOutcome, releaseScores, releaseTodo, releaseTradeFirst, type Advice } from '../../game/release';
import { useUi } from '../layout/uiStore';

const PARTS = ['bat', 'def', 'rot', 'pen'] as const;
const DONE_MS = 6000; // 완료 배너 + [되돌리기]
const BAND: Record<BasketKind, { color: string; bg: string; label: string; add: string }> = {
  sign: { color: '#6ee07a', bg: '#27452f', label: '영입', add: '+ 영입' },
  release: { color: '#ff6b6b', bg: '#4a2a30', label: '방출', add: '− 방출' },
  down: { color: '#f0a35a', bg: '#4a3a2a', label: '2군', add: '▼ 2군' },
  up: { color: '#7fd3ff', bg: '#263f52', label: '콜업', add: '▲ 콜업' },
};
const signed = (v: number) => `${v >= 0 ? '+' : '−'}${fmtMoney(Math.abs(v))}`;
const outText = (n: number | null) => (n === null ? '안 빔' : `${n}경기`);

/** 이적 창구 (전체 화면). 어디서든 useTransferUi.openDesk() 로 연다 */
export default function TransferDesk() {
  const open = useTransferUi((s) => s.open);
  if (!open) return null;
  return <Desk />;
}

/** 2군에 자리가 남았는가 (담은 2군행 + / 콜업 · 2군 선수 방출 −). 재활(부상자 명단)은 2군 정원에 들지 않는다 */
function useFarmRoom(): boolean {
  const core = useCore();
  const team = useUserTeam();
  const basket = useTransferUi((s) => s.basket);
  const inFarm = team.roster.filter((p) => p.farm && !p.il && !basket.up.includes(p.id) && !basket.release.includes(p.id)).length;
  return inFarm + basket.down.length < farmMax(core);
}

/** 줄의 담기 버튼: 담으면 색이 차고, 다시 누르면 빠진다 */
export function AddChip({ kind, pid, big = false, onAfter }: { kind: BasketKind; pid: string; big?: boolean; onAfter?: () => void }) {
  const on = useTransferUi((s) => s.basket[kind].includes(pid));
  const toggle = useTransferUi((s) => s.toggle);
  // 등록 마감 뒤와 포스트시즌에는 영입을 담을 수 없다 (이미 담은 것은 뺄 수 있다)
  const farmRoom = useFarmRoom();
  const closed = useStore((s) => (kind === 'sign' ? signingClosedWhy(s) : null)) ?? (kind === 'down' && !farmRoom ? '2군이 가득 찼습니다' : null);
  const b = BAND[kind];
  return (
    <button
      data-testid={`add-${kind}`}
      data-on={on || undefined}
      data-sfx="tab"
      disabled={!!closed && !on}
      title={closed ?? undefined}
      onClick={() => (toggle(kind, pid), onAfter?.())}
      className={`shrink-0 cursor-pointer whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-35 ${big ? 'min-h-9 px-3 text-[13px]' : 'px-1.5 py-0.5 text-[11px] mob:min-h-9 mob:px-1.5 mob:text-[13px]'}`}
      style={on ? { background: b.color, color: '#121110' } : { background: '#121110', color: b.color, boxShadow: `inset 0 0 0 1px ${b.color}88` }}
    >
      {on ? `✓ ${b.label}` : b.add}
    </button>
  );
}

/** [트레이드 시장에] 토글: 내놓으면 트레이드 기간 중 원하는 구단의 제안이 온다 (trade.ts) */
function BlockChip({ pid, big = false, onAfter }: { pid: string; big?: boolean; onAfter?: () => void }) {
  const on = useStore((s) => (s.campaign.block ?? []).includes(pid));
  const toggle = useStore((s) => s.blockToggle);
  const closed = useStore((s) => blockClosedWhy(s));
  const color = '#c9a0ff';
  if (closed && !on) return null; // 막힌 버튼은 흐리게 두지 않고 숨긴다 (스토브리그엔 내놓을 수 없다)
  return (
    <button
      data-testid="add-block"
      data-on={on || undefined}
      data-sfx="tab"
      disabled={!!closed && !on}
      title={closed ?? '트레이드 시장에 내놓기'}
      aria-label="트레이드 시장에 내놓기"
      onClick={() => {
        toggle(pid);
        // 바뀌었을 때만 카드를 닫는다 (인원 초과·신인 등으로 거절되면 카드에 남아 이유를 본다)
        if ((useStore.getState().campaign.block ?? []).includes(pid) !== on) onAfter?.();
      }}
      className={`shrink-0 cursor-pointer whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-35 ${big ? 'min-h-9 px-3 text-[13px]' : 'px-1.5 py-0.5 text-[11px] mob:min-h-9 mob:px-1.5 mob:text-[13px]'}`}
      style={on ? { background: color, color: '#121110' } : { background: '#121110', color, boxShadow: `inset 0 0 0 1px ${color}88` }}
    >
      {on ? '✓' : '⇄'}
      {big ? (on ? ` 시장에 내놓음 · ${TR.blockWithin[0]}~${TR.blockWithin[1]}경기 안 답` : ' 트레이드 시장에 내놓기') : <span className="mob:hidden"> 시장</span>}
    </button>
  );
}

/** 창구 상단 한 줄: 1군 인원 · 현금이 늘 보이게 (꽉 차면 빨강). 트레이드·영입 기간은 막혔거나 곧 막힐 때만 */
function DeskHead({ act, cash, extra }: { act: number; cash: number; extra: string | null }) {
  return (
    <span data-testid="desk-head">
      1군 <span className={act >= ROSTER_MAX ? 'text-bad' : 'text-good'}>{act}/{ROSTER_MAX}</span> · 현금 {fmtMoney(cash)}
      {extra && <span className="text-white/50"> · {extra}</span>}
    </span>
  );
}


/** 계약금 누진 안내 한 줄: 이미 영입한 수 + 담은 수 기준 (담은 선수가 있으면 그렇다고 적는다) */
function heatText(core: Parameters<typeof faHeatLine>[0], inBasket: number): string | null {
  const line = faHeatLine(core, inBasket);
  // 담은 선수가 있으면 "다음"이 누구인지 헷갈린다 → "하나 더 담으면"
  if (!line || inBasket === 0) return line;
  const next = line.split(' · ')[1]; // "다음 영입 계약금 +500%"
  return next ? next.replace('다음 영입', '하나 더 담으면') : line;
}

const squadKinds = (p: Player): BasketKind[] => ['release', p.farm ? 'up' : 'down'];

/** 이름 옆 "방출 추천" 칩 (빨간 테두리) */
function ReleaseBadge() {
  return (
    <span className="shrink-0 whitespace-nowrap px-1 text-[11px] leading-[1.5] text-bad mob:text-[12px]" style={{ boxShadow: 'inset 0 0 0 1px #ff6b6b' }} data-testid="rel-badge">
      방출 추천
    </span>
  );
}

/** 추천 선수 카드의 이유 줄과 "방출하면:" 한 줄 (담기 미리보기와 같은 계산) */
function ReleaseWhy({ a }: { a: Advice }) {
  const core = useCore();
  const out = useMemo(() => releaseOutcome(core, a.p.id), [core, a.p.id]);
  return (
    <div className="mt-1.5 bg-bad/10 px-1.5 py-1 text-[11px] leading-snug mob:text-[13px]" style={{ boxShadow: 'inset 3px 0 0 #ff6b6b' }} data-testid="rel-why">
      <div className="text-bad">▸ 방출 추천</div>
      {a.why.map((w, i) => (
        <div key={i} className="text-white/80" data-testid="rel-line">
          · {w}
          {a.trade && i === a.why.length - 1 && <span className="text-[#c9a0ff]"> {TRADE_HINT}</span>}
        </div>
      ))}
      <div className="mt-0.5 text-white" data-testid="rel-outcome">
        <span className="text-white/55">방출하면: </span>
        {out.text}
      </div>
      {out.pv.error && <div className="text-bad">✕ 불가: {out.pv.error}</div>}
    </div>
  );
}

/** 1군이 가득일 때 내보낼 후보(밀려나는 선수 + 방출 추천) 최대 3명. [2군]은 2군이 가득이면 막는다 */
function OutCands({ fa, pv, advice }: { fa: Player | undefined; pv: TransferPreview; advice: Advice[] }) {
  const core = useCore();
  const team = useUserTeam();
  const basket = useTransferUi((s) => s.basket);
  const put = useTransferUi((s) => s.put);
  const taken = new Set([...basket.release, ...basket.down]);
  const bump = fa ? pv.bumps.find((b) => b.fa.id === fa.id) : pv.bumps[pv.bumps.length - 1];
  const cands: { p: Player; why: string }[] = [];
  const add = (p: Player | undefined, why: string) => p && !p.farm && !taken.has(p.id) && !cands.some((c) => c.p.id === p.id) && cands.length < 3 && cands.push({ p, why });
  add(bump?.p, bump?.starter ? '밀려나는 주전' : '밀려나는 선수');
  for (const a of advice) add(a.p, '방출 추천');
  const farmFull = !useFarmRoom();
  const need = pv.active.b - ROSTER_MAX;
  return (
    <div className="flex flex-col gap-1 bg-ink/60 px-2 py-1.5 text-[12px] mob:text-[13px]" style={{ boxShadow: 'inset 3px 0 0 #e8741a' }} data-testid="inline-cands">
      <span className="text-[#f0a35a]">1군이 가득 · {need}명을 내보내야 해요</span>
      {cands.map(({ p, why }) => (
        <div key={p.id} className="flex items-center gap-1.5" data-testid="inline-cand">
          <span className="min-w-0 flex-1 truncate">
            {p.name} {p.ovr} <span className="text-white/50">{why}</span>
          </span>
          <button className="cursor-pointer whitespace-nowrap px-2 text-[#f0a35a] disabled:cursor-not-allowed disabled:opacity-35 mob:min-h-9" style={{ boxShadow: 'inset 0 0 0 1px #f0a35a88' }} data-sfx="tab" data-testid="cand-down" disabled={farmFull} title={farmFull ? '2군이 가득 찼습니다' : undefined} onClick={() => put('down', p.id)}>
            2군
          </button>
          <button className="cursor-pointer whitespace-nowrap px-2 text-bad mob:min-h-9" style={{ boxShadow: 'inset 0 0 0 1px #ff6b6b88' }} data-sfx="tab" data-testid="cand-release" onClick={() => put('release', p.id)}>
            방출
          </button>
        </div>
      ))}
      {!cands.length && <span className="text-white/55">우리 선수단 탭에서 내보낼 선수를 고르세요</span>}
    </div>
  );
}

/** 영입 줄 아래: 가득이면 후보(OutCands) · 정했으면 내보낼 선수와 [취소]. 마지막에 담은 FA 줄에만 붙는다 — 보이는지 위에 알린다(onShown) */
function InlineOut({ fa, pv, advice, onShown }: { fa: Player; pv: TransferPreview; advice: Advice[]; onShown: (on: boolean) => void }) {
  const team = useUserTeam();
  const basket = useTransferUi((s) => s.basket);
  const toggle = useTransferUi((s) => s.toggle);
  const box = useRef<HTMLDivElement>(null);
  const last = basket.sign[basket.sign.length - 1];
  const over = pv.active.b > ROSTER_MAX;
  const mine = basket.sign.includes(fa.id) && fa.id === last;
  // 펼쳐지면 보이게 (목록 맨 아래 줄을 담으면 후보가 화면 밖에 열렸다)
  useEffect(() => {
    if (mine) box.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [mine, over, basket.release.length, basket.down.length]);
  useEffect(() => {
    if (!mine || !over) return;
    onShown(true);
    return () => onShown(false);
  }, [mine, over, onShown]);
  if (!mine) return null;
  // 콜업도 같이 보인다: 1군 수가 왜 그런지 (방출·콜업·영입을 한꺼번에 담으면 콜업이 안 보여 29/28이 수수께끼였다)
  const outs = [...basket.release, ...basket.down, ...basket.up].map((id) => team.roster.find((p) => p.id === id)).filter((p): p is Player => !!p);
  if (!outs.length && !over) return null;
  const picked = outs.length > 0 && (
    <div className="flex flex-col gap-0.5 bg-ink/60 px-2 py-1 text-[12px] mob:text-[13px]" style={{ boxShadow: 'inset 3px 0 0 #6ee07a' }} data-testid="inline-outs">
      {outs.map((p) => {
        const k = basket.release.includes(p.id) ? 'release' : basket.down.includes(p.id) ? 'down' : 'up';
        return (
          <div key={p.id} className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate">
              {p.name} {p.ovr} → <span className={k === 'release' ? 'text-bad' : k === 'down' ? 'text-[#f0a35a]' : 'text-sky'}>{k === 'release' ? '방출' : k === 'down' ? '2군' : '1군'}</span>
            </span>
            <button className="cursor-pointer px-1.5 text-white/55 mob:min-h-9" data-sfx="tab" data-testid="inline-undo" onClick={() => toggle(k, p.id)}>
              취소
            </button>
          </div>
        );
      })}
    </div>
  );
  return (
    <div ref={box} className="mb-[3px]">
      {picked}
      {over && <OutCands fa={fa} pv={pv} advice={advice} />}
    </div>
  );
}

/** 영입 시장 줄의 전력 변화 칩: 가장 크게 바뀌는 칸 하나 ("타선 +2"). 변화 없으면 흐린 ±0 */
function GainChip({ gain }: { gain: ReturnType<typeof signImpact> | undefined }) {
  if (!gain) return null;
  const moved = (Object.entries(gain.delta) as [keyof typeof PART_KO, number][]).filter(([, v]) => v !== 0);
  if (moved.length > 1)
    return (
      <span className={`shrink-0 whitespace-nowrap px-1 text-[11px] mob:text-[12px] ${gain.total > 0 ? 'bg-good/15 text-good' : 'bg-bad/15 text-bad'}`} title={moved.map(([k, v]) => `${PART_KO[k]} ${fmtDelta(v)}`).join(' · ')} data-testid="gain-chip">
        전력 {fmtDelta(gain.total)}
      </span>
    );
  const top = moved[0];
  if (!top) return <span className="shrink-0 whitespace-nowrap px-1 text-[11px] text-white/35 mob:text-[12px]">±0</span>;
  return (
    <span className={`shrink-0 whitespace-nowrap px-1 text-[11px] mob:text-[12px] ${top[1] > 0 ? 'bg-good/15 text-good' : 'bg-bad/15 text-bad'}`} data-testid="gain-chip">
      {PART_KO[top[0]]} {fmtDelta(top[1])}
    </span>
  );
}

function Desk() {
  const mobile = useIsMobile();
  const core = useCore();
  const team = useUserTeam();
  const rows = usePosReport();
  const freeAgents = useStore((s) => s.freeAgents);
  const scoutIds = useStore((s) => s.campaign.eventsSeen.find((x) => x.startsWith('~scoutList='))?.slice(11) ?? '');
  const transfer = useStore((s) => s.transfer);
  const { basket, side, pos, nonce, sort, close, clear } = useTransferUi();
  // 방출 추천 (최대 3명) · 방출 후보순 정렬 점수
  const advice = useMemo(() => releaseAdvice(core), [core]);
  const relScores = useMemo(() => releaseScores(core), [core]);
  const relSort = useMemo(() => ({ label: '방출 후보순', val: (p: Player) => -(relScores.get(p.id)?.score ?? -999) }), [relScores]);
  // 방출을 담으면 할 일 "방출 검토"는 그 상황 동안 다시 올리지 않는다
  const relTodo = useMemo(() => releaseTodo(core)?.id, [core]);
  useEffect(() => {
    if (basket.release.length && relTodo) useUi.getState().dismissTodo(relTodo);
  }, [basket.release.length, relTodo]);
  const [card, setCard] = useState<string | null>(null);
  const [inlineOn, setInlineOn] = useState(false); // 줄 아래 후보가 보이는가 (표 보기·필터로 그 줄이 없으면 아래 바 위에 띄운다)
  const [done, setDone] = useState<{ text: string; before: ReturnType<typeof pickCore>; after: ReturnType<typeof pickCore> } | null>(null);
  // 영입하면 바뀌는 전력 (영입 시장 줄의 칩 · 전력순 정렬). 표 보기의 "영입 시 전력"과 같은 계산
  const gains = useMemo(() => new Map(freeAgents.map((p) => [p.id, signImpact(team, p)])), [team, freeAgents]);
  const gainSort = useMemo(() => ({ label: '전력순', val: (p: Player) => -(gains.get(p.id)?.total ?? 0) }), [gains]);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  // 담은 채로 열렸으면 그 줄이 보이게
  useEffect(() => {
    document.querySelector('[data-testid=transfer-desk] [data-band]')?.scrollIntoView({ block: 'center' });
  }, [nonce, side]);

  const pv = useMemo(() => previewTransfer(core, basket), [core, basket]);
  const band = (p: Player) => {
    const k = basketKindOf(basket, p.id);
    return k ? BAND[k] : undefined;
  };
  const cardFa = card ? freeAgents.find((p) => p.id === card) : undefined;
  const cardP = cardFa ?? (card ? team.roster.find((p) => p.id === card) : undefined);
  const cardAdv = !cardFa && card ? advice.find((a) => a.p.id === card) : undefined;

  const confirm = () => {
    const moved = PARTS.filter((k) => pv.parts.a[k] !== pv.parts.b[k]).map((k) => `${PART_KO[k]} ${pv.parts.a[k]} → ${pv.parts.b[k]}`);
    const rest = pv.cash.a !== pv.cash.b ? `현금 ${fmtMoney(pv.cash.a)} → ${fmtMoney(pv.cash.b)}` : `1군 ${pv.active.a} → ${pv.active.b}`;
    const text = `✓ ${pv.n}건 완료 · ${moved.length ? moved.join(' · ') : rest}`;
    const before = pickCore(useStore.getState()); // [되돌리기]: 확정 직전 상태로
    if (!transfer(basket)) return;
    play('buy');
    clear();
    setDone({ text, before, after: pickCore(useStore.getState()) });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setDone(null), DONE_MS);
  };

  const regWhy = signingClosedWhy(core);
  // 계약금 누진(10구단): 이미 영입한 수 + 담은 수 기준으로 "다음 영입"의 계약금을 미리 말한다
  const heatN = faSigned(core) + basket.sign.length;
  const heatLine = heatText(core, basket.sign.length);
  const cardAhead = cardFa ? (basket.sign.includes(cardFa.id) ? basket.sign.indexOf(cardFa.id) : basket.sign.length) : 0;
  const blockWhy = blockClosedWhy(core);
  const closedLine = (why: string | null, testid: string) =>
    why && (
      <div className="shrink-0 bg-bad/20 px-1.5 py-1 text-[11px] text-bad mob:text-[13px]" data-testid={testid}>
        ⛔ {why}
      </div>
    );
  const scoutPicks = scoutIds ? scoutIds.split(',') : [];
  const market = (
    <>
    {closedLine(regWhy, 'reg-closed')}
    {!regWhy && heatLine && heatN > 0 && (
      <div className="flex shrink-0 items-center gap-1 bg-[#4a3a2a] px-1.5 py-1 text-[11px] text-[#f0a35a] mob:text-[13px]" data-testid="fa-heat">
        {/* 좁으면 잘린다: 정작 중요한 "다음 영입 계약금"을 앞으로 */}
        <span className="min-w-0 truncate">🔥 {heatLine.split(' · ').reverse().join(' · ')}</span>
        <Help topic="faheat" className="shrink-0" />
      </div>
    )}
    <PlayerBrowser
      key={`m${nonce}`}
      mode="market"
      players={freeAgents}
      rows={rows}
      sel={card}
      onPick={(p) => setCard(p.id)}
      initPos={pos}
      band={band}
      weakChips
      extraSort={gainSort}
      initExtra={!pos || pos === 'weak'}
      note={(p) => (scoutPicks.includes(p.id) ? <span className="ml-1 text-hi" title="스카우트 팀장 추천">★</span> : null)}
      badge={(p) => <GainChip gain={gains.get(p.id)} />}
      rowExtra={(p) => <InlineOut fa={p} pv={pv} advice={advice} onShown={setInlineOn} />}
      rowAction={(p) => <AddChip kind="sign" pid={p.id} />}
    />
    </>
  );
  // 우리 선수단: 주전인지 후보인지 이름 옆에 (2군 표시는 목록이 따로 붙인다)
  const blockIds = core.campaign.block ?? [];
  const isMain = (p: Player) => (p.kind === 'B' ? team.lineup.some((l) => l.pid === p.id) : team.rotation.includes(p.id) || team.closer === p.id);
  // 폰 줄 버튼: 2군은 콜업, 방출 추천은 방출, 나머지 후보는 2군 (이미 담았으면 담은 칸)
  const phoneAction = (p: Player) => {
    const k = basketKindOf(basket, p.id) ?? (p.farm ? 'up' : isMain(p) ? null : advice.some((a) => a.p.id === p.id) ? 'release' : 'down');
    return k && k !== 'sign' ? <AddChip kind={k} pid={p.id} /> : null;
  };
  const roleNote = (p: Player) => {
    if (p.farm) return null;
    const ord = team.lineup.findIndex((l) => l.pid === p.id);
    const rot = team.rotation.indexOf(p.id);
    const text = p.kind === 'B' ? (ord >= 0 ? `주전 ${ord + 1}번` : '백업') : rot >= 0 ? `${rot + 1}선발` : team.closer === p.id ? '마무리' : team.bullpen.includes(p.id) ? `불펜 ${team.bullpen.indexOf(p.id) + 1}` : '대기';
    const main = p.kind === 'B' ? ord >= 0 : rot >= 0 || team.closer === p.id;
    if (blockIds.includes(p.id))
      return (
        <span className="ml-1.5 whitespace-nowrap text-[11px] text-[#c9a0ff] mob:text-[12px]" data-testid="role-note">
          {text} · 시장에 내놓음
        </span>
      );
    return (
      <span className={`ml-1.5 whitespace-nowrap text-[11px] mob:text-[12px] ${main ? 'text-hi' : 'text-white/50'}`} data-testid="role-note">
        {text}
      </span>
    );
  };
  const squad = (
    <>
    {core.phase === 'season' && closedLine(blockWhy, 'block-closed')}
    <PlayerBrowser
      key={`s${nonce}`}
      mode="roster"
      players={team.roster}
      rows={rows}
      sel={card}
      onPick={(p) => setCard(p.id)}
      band={band}
      note={roleNote}
      badge={(p) => (advice.some((a) => a.p.id === p.id) ? <ReleaseBadge /> : null)}
      extraSort={relSort}
      initExtra={sort === 'release'}
      // 폰: 줄에는 버튼 하나만 (셋이면 이름을 밀어낸다). 주전은 버튼 없이 카드에서 — 한 번에 주전을 방출하지 않게
      rowAction={mobile ? phoneAction : (p) => [...squadKinds(p).map((k) => <AddChip key={k} kind={k} pid={p.id} />), <BlockChip key="block" pid={p.id} />]}
    />
    </>
  );
  const tabs: [typeof side, string, number][] = [
    ['market', '영입 시장', freeAgents.length],
    ['squad', '우리 선수단', team.roster.length],
  ];

  return (
    <FullScreen
      title="이적 창구"
      sub={<DeskHead act={pv.active.a} cash={core.finance.cash} extra={regWhy ? '영입 마감' : blockIds.length ? `시장에 내놓음 ${blockIds.length}/${TR.blockMax}` : null} />}
      onClose={close}
      testid="transfer-desk"
      hold={!!cardP}
    >
      {mobile ? (
        <>
          <div className="mt-1 flex shrink-0 gap-1 px-1.5" data-testid="desk-sides">
            {tabs.map(([id, label, n]) => (
              <button
                key={id}
                data-sfx="tab"
                data-testid={`side-${id}`}
                onClick={() => useTransferUi.setState({ side: id })}
                className={`min-h-9 flex-1 cursor-pointer whitespace-nowrap px-2 text-[13px] ${side === id ? 'bg-hi text-ink' : 'bg-ink text-white/70'}`}
              >
                {label} {n}
                {id === 'market' && basket.sign.length > 0 && <span className={side === id ? '' : 'text-good'}> · 담음 {basket.sign.length}</span>}
                {id === 'squad' && basketCount(basket) - basket.sign.length > 0 && <span className={side === id ? '' : 'text-bad'}> · 담음 {basketCount(basket) - basket.sign.length}</span>}
              </button>
            ))}
          </div>
          {side === 'market' ? market : squad}
        </>
      ) : (
        <div className="flex min-h-0 flex-1 gap-1.5 px-1.5 pt-1">
          {tabs.map(([id, label, n]) => (
            <div key={id} className="flex min-h-0 min-w-0 flex-1 flex-col bg-ink/25" data-testid={`col-${id}`}>
              <div className="shrink-0 bg-edge/70 px-1.5 py-0.5 text-[12px] text-hi">
                {label} <span className="text-white/60">{n}</span>
              </div>
              {id === 'market' ? market : squad}
            </div>
          ))}
        </div>
      )}
      {pv.active.b > ROSTER_MAX && !inlineOn && (
        <div className="shrink-0 px-1.5 pb-1" data-testid="cands-fallback">
          <OutCands fa={undefined} pv={pv} advice={advice} />
        </div>
      )}
      <Summary
        pv={pv}
        done={done?.text ?? null}
        mobile={mobile}
        onConfirm={confirm}
        // 그 사이 다른 일이 있었으면(경기·시장 토글 등) 되돌리지 않는다 — 확정 직후 상태 그대로일 때만
        onUndo={done && useStore.getState().teams === done.after.teams && useStore.getState().campaign === done.after.campaign ? () => (useStore.setState(done.before), clearTimeout(timer.current), setDone(null)) : undefined}
      />
      {cardP && (
        <CardPop player={cardP} onClose={() => setCard(null)} extra={cardAdv ? <ReleaseWhy a={cardAdv} /> : undefined}>
          {!cardFa && !cardP.farm && <BlockChip pid={cardP.id} big onAfter={() => setCard(null)} />}
          {cardFa && (
            <span className="mr-auto self-center text-[11px] text-white/75 mob:text-[13px]" data-testid="card-bonus">
              {bonusText(core, cardFa, cardAhead)}
            </span>
          )}
          {(cardFa ? (['sign'] as BasketKind[]) : squadKinds(cardP)).map((k) => (
            <AddChip key={k} kind={k} pid={cardP.id} big onAfter={() => setCard(null)} />
          ))}
        </CardPop>
      )}
    </FullScreen>
  );
}

// ───────── 요약: 얻는 것 / 잃는 것 ─────────

function Pair({ a, b, good }: { a: ReactNode; b: ReactNode; good?: boolean | null }) {
  if (a === b) return <span className="text-white/75">{a}</span>;
  return (
    <span>
      <span className="text-white/60">{a} → </span>
      <span className={good == null ? 'text-white' : good ? 'text-good' : 'text-bad'}>{b}</span>
    </span>
  );
}

function Line({ label, children, testid }: { label: string; children: ReactNode; testid?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 whitespace-nowrap" data-testid={testid}>
      <span className="shrink-0 text-white/55">{label}</span>
      <span className="min-w-0 truncate text-right">{children}</span>
    </div>
  );
}

function Box({ title, children, className = '', testid }: { title: string; children: ReactNode; className?: string; testid?: string }) {
  return (
    <div className={`min-w-0 bg-ink/55 px-1.5 py-1 ${className}`} data-testid={testid}>
      <div className="mb-0.5 text-[11px] text-sky mob:text-[13px]">▸ {title}</div>
      {children}
    </div>
  );
}

function Summary({ pv, done, mobile, onConfirm, onUndo }: { pv: TransferPreview; done: string | null; mobile: boolean; onConfirm: () => void; onUndo?: () => void }) {
  const core = useCore();
  const team = useUserTeam();
  const basket = useTransferUi((s) => s.basket);
  const put = useTransferUi((s) => s.put);
  const clear = useTransferUi((s) => s.clear);
  const [wide, setWide] = useState(false); // 모바일: [자세히] 시트
  const empty = pv.n === 0;
  // 바구니를 비우면 자세히도 접는다 (빈 요약이 목록을 덮고 있었다)
  useEffect(() => {
    if (empty) setWide(false);
  }, [empty]);
  const full = !mobile || wide;
  // 1군 초과는 영입 줄 아래의 "내보낼 후보"가 해결한다 — 아래에는 인원만
  const over = pv.active.b > ROSTER_MAX;
  const ups = basket.up.map((id) => team.roster.find((p) => p.id === id)).filter((p): p is Player => !!p);
  const moved = PARTS.filter((k) => pv.parts.a[k] !== pv.parts.b[k]);
  const wins = Math.round(pv.wins * 10) / 10;
  const winText = `${wins >= 0 ? '+' : '−'}${Math.abs(wins).toFixed(1)}승`;
  const oneOff = pv.bonus + pv.penalty;

  if (done && empty) {
    return (
      <div className="flex shrink-0 items-center gap-2 bg-good/20 px-2 py-2.5 text-[14px] text-good" style={{ boxShadow: 'inset 0 2px 0 #6ee07a' }} data-testid="desk-done">
        <span className="min-w-0 flex-1">{done}</span>
        {onUndo && (
          <button className="px-btn shrink-0 !px-3 text-[13px]" data-testid="desk-undo" onClick={onUndo}>
            되돌리기
          </button>
        )}
      </div>
    );
  }

  const partsRow = (
    <div className="grid grid-cols-4 gap-[3px]" data-testid="sum-parts">
      {PARTS.map((k) => {
        const a = pv.parts.a[k];
        const b = pv.parts.b[k];
        return (
          <div key={k} className={`px-1 py-0.5 text-center leading-tight ${a === b ? 'bg-ink/50' : b > a ? 'bg-good/20' : 'bg-bad/20'}`} data-changed={a !== b || undefined}>
            <div className="text-[11px] text-white/55">{PART_KO[k]}</div>
            <div className={`whitespace-nowrap text-[13px] ${a === b ? 'text-white/70' : b > a ? 'text-good' : 'text-bad'}`}>{a === b ? a : `${a}→${b}`}</div>
          </div>
        );
      })}
    </div>
  );
  const heads: [string, string, { a: number; b: number }, number][] = [
    ['1군', 'sum-active', pv.active, ROSTER_MAX],
    ['2군', 'sum-farm', pv.farm, farmMax(core)],
    ['외국인', 'sum-foreign', pv.foreign, FOREIGN_MAX],
  ];
  const headcount = (
    <div className="flex flex-wrap gap-x-3 gap-y-0.5">
      {heads.map(([label, testid, v, max]) => (
        <span key={testid} className="whitespace-nowrap" data-testid={testid}>
          <span className="text-white/55">{label} </span>
          <Pair a={`${v.a}/${max}`} b={`${v.b}/${max}`} good={v.b > max ? false : null} />
        </span>
      ))}
    </div>
  );
  // 결과를 미리 말한다: 담은 대로 실행하면 연봉 총액이 경쟁균형세 상한을 넘는가 (10구단 리그)
  const lux = luxPiece(core, pv.payroll.b - pv.payroll.a, true);
  const money = (
    <>
      <Line label="연봉 총액/시즌" testid="sum-payroll">
        <Pair a={fmtMoney(pv.payroll.a)} b={fmtMoney(pv.payroll.b)} good={pv.payroll.b < pv.payroll.a} />
      </Line>
      {lux && (
        <div className="text-bad" data-testid="sum-lux">
          {lux}
        </div>
      )}
      <Line label="일회성" testid="sum-oneoff">
        {oneOff ? (
          <>
            <span className="text-bad">−{fmtMoney(oneOff)}</span>
            <span className="text-white/50"> (계약금 {fmtMoney(pv.bonus)} + 잔여 연봉 지급 {fmtMoney(pv.penalty)})</span>
          </>
        ) : (
          <span className="text-white/75">0</span>
        )}
      </Line>
      <Line label="현금" testid="sum-cash">
        <Pair a={fmtMoney(pv.cash.a)} b={fmtMoney(pv.cash.b)} good={pv.cash.b >= pv.cash.a} />
      </Line>
      <Line label="경기당 손익" testid="sum-pergame">
        {pv.perGame ? <Pair a={signed(pv.perGame.a)} b={signed(pv.perGame.b)} good={pv.perGame.b >= pv.perGame.a} /> : <span className="text-white/45">시즌 중에만</span>}
      </Line>
      <Line label="바닥까지" testid="sum-runway">
        {pv.cashOut ? (
          <Pair a={outText(pv.cashOut.a)} b={outText(pv.cashOut.b)} good={pv.cashOut.b === null || (pv.cashOut.a !== null && pv.cashOut.b > pv.cashOut.a)} />
        ) : (
          <span className="text-white/45">시즌 중에만</span>
        )}
      </Line>
    </>
  );
  const ranks = pv.ranks.length ? (
    pv.ranks.map((r, i) => (
      <span key={r.key} className="whitespace-nowrap">
        {i > 0 && <span className="text-white/35"> · </span>}
        <span className="text-white/70">{r.label} {r.a}위 → </span>
        <span className={r.b < r.a ? 'text-good' : 'text-bad'}>{r.b}위 {r.b < r.a ? '▲' : '▼'}</span>
      </span>
    ))
  ) : (
    <span className="text-white/50">{pv.exact ? '순위 변화 없음' : '불가 사유가 풀리면 계산'}</span>
  );
  const fanDiff = Math.round(pv.fans.b - pv.fans.a);
  const people = (
    <div className="flex flex-col gap-[2px]" data-testid="sum-people">
      {pv.ins.map(({ p, bonus, why }) => (
        <div key={p.id} className="truncate" data-testid="sum-in">
          <span className="text-good">+ 영입 </span>
          {p.name} <span className="text-white/60">오버롤 {p.ovr} · {POS_FULL[p.pos]} · 연 {fmtMoney(p.salary)}{!why && ` · 계약금 ${fmtMoney(bonus)}`}</span>
          {why && (
            <div className="truncate pl-3 text-[#f0a35a]" data-testid="sum-in-bonus">
              계약금 {fmtMoney(bonus)} ({why})
            </div>
          )}
        </div>
      ))}
      {ups.map((p) => (
        <div key={p.id} className="truncate" data-testid="sum-up">
          <span className="text-sky">▲ 콜업 </span>
          {p.name} <span className="text-white/60">오버롤 {p.ovr} · {POS_FULL[p.pos]}</span>
        </div>
      ))}
      {pv.outs.map((o) => (
        <div key={o.p.id} className="truncate" data-testid="sum-out">
          <span className={o.to === 'release' ? 'text-bad' : 'text-[#f0a35a]'}>{o.to === 'release' ? '− 방출 ' : '▼ 2군 '}</span>
          {o.p.name}{' '}
          <span className="text-white/60">
            오버롤 {o.p.ovr} · <span className={o.starter ? 'text-hi' : ''}>{o.role}</span>
            {o.to === 'release' && ` · 잔여 연봉 지급 ${fmtMoney(o.cost)}`}
          </span>
          {o.franchise && <span className="text-bad"> · 프랜차이즈 (팬 감소)</span>}
        </div>
      ))}
      {fanDiff !== 0 && (
        <div className={fanDiff > 0 ? 'text-good' : 'text-bad'} data-testid="sum-fans">
          팬 {fmtInt(pv.fans.a)} → {fmtInt(pv.fans.b)} ({fanDiff > 0 ? '+' : '−'}{fmtInt(Math.abs(fanDiff))})
        </div>
      )}
      {empty && <div className="text-white/45">담은 선수 없음</div>}
    </div>
  );


  return (
    <div className="relative shrink-0 bg-panel-2 px-1.5 pt-1 pb-1.5 text-[11px] mob:text-[13px]" style={{ boxShadow: 'inset 0 2px 0 #ffd84a' }} data-testid="desk-summary" data-wide={full || undefined}>
      {!mobile ? (
        <div className="px-scroll grid max-h-[calc(var(--dvh)*34)] grid-cols-[1.15fr_1.25fr_1.35fr] gap-1 overflow-y-auto mob:max-h-[calc(var(--dvh)*52)] mob:grid-cols-1">
          <div className="flex min-w-0 flex-col gap-1">
            <Box title={`전력 · 예상 승수 ${pv.exact && !empty ? winText : '—'} (${pv.winGames}경기 환산)`} testid="sum-power">
              {partsRow}
            </Box>
            <Box title="포지션 순위" testid="sum-ranks">
              <div className="leading-snug">{ranks}</div>
            </Box>
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <Box title="얻는 것 / 잃는 것" className="flex-1">
              {people}
            </Box>
            <Box title="인원">{headcount}</Box>
          </div>
          <Box title="돈" testid="sum-money">
            {money}
          </Box>
        </div>
      ) : wide ? null : (
        <div className="leading-snug" data-testid="sum-compact">
          {empty ? (
            <span className="text-white/50">담은 선수 없음</span>
          ) : over ? (
            <span className="text-bad" data-testid="sum-over">
              1군 {pv.active.b}/{ROSTER_MAX}
            </span>
          ) : (
            <>
              {/* 기본 3줄: 전력 변화(바뀐 칸만) · 연봉 총액 변화 · 현금 변화. 나머지는 [자세히 ▲] */}
              <div data-testid="sum3-power">
                <span className="text-white/55">전력 </span>
                {!pv.exact ? (
                  <span className="text-white/50">불가 사유가 풀리면 계산</span>
                ) : moved.length ? (
                  moved.map((k, i) => (
                    <span key={k} className={pv.parts.b[k] > pv.parts.a[k] ? 'text-good' : 'text-bad'}>
                      {i > 0 && ' · '}
                      {PART_KO[k]} {pv.parts.a[k]}→{pv.parts.b[k]}
                    </span>
                  ))
                ) : (
                  <span className="text-white/60">변화 없음</span>
                )}
                <span className="text-white/35"> · </span>
                <span data-testid="sum3-payroll">
                  <span className="text-white/55">연봉 </span>
                  <span className={pv.payroll.b > pv.payroll.a ? 'text-bad' : pv.payroll.b < pv.payroll.a ? 'text-good' : ''}>{pv.payroll.b === pv.payroll.a ? '그대로' : signed(pv.payroll.b - pv.payroll.a)}</span>
                </span>
              </div>
              {lux && (
                <div className="text-bad" data-testid="sum3-lux">
                  {lux}
                </div>
              )}
              <div data-testid="sum3-cash">
                <span className="text-white/55">현금 </span>
                {fmtMoney(pv.cash.a)} → <span className={pv.cash.b < 0 ? 'text-bad' : 'text-hi'}>{fmtMoney(pv.cash.b)}</span>
                {pv.perGame && pv.perGame.a >= 0 && pv.perGame.b < 0 && (
                  <span className="text-bad" data-testid="sum3-loss">
                    {' '}
                    · 경기당 {signed(pv.perGame.b)} 적자
                  </span>
                )}
              </div>
            </>
          )}
        </div>
      )}
      {/* 폰의 [자세히]: 목록을 밀어내지 않고 위로 열리는 시트 */}
      {mobile && wide && (
        <div className="absolute inset-x-0 bottom-full z-10 bg-panel-2 px-1.5 pt-1.5 pb-1" style={{ boxShadow: '0 -2px 0 #ffd84a' }} data-testid="sum-sheet">
        <div className="px-scroll grid max-h-[calc(var(--dvh)*34)] grid-cols-[1.15fr_1.25fr_1.35fr] gap-1 overflow-y-auto mob:max-h-[calc(var(--dvh)*60)] mob:grid-cols-1">
          <div className="flex min-w-0 flex-col gap-1">
            <Box title={`전력 · 예상 승수 ${pv.exact && !empty ? winText : '—'} (${pv.winGames}경기 환산)`} testid="sum-power">
              {partsRow}
            </Box>
            <Box title="포지션 순위" testid="sum-ranks">
              <div className="leading-snug">{ranks}</div>
            </Box>
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <Box title="얻는 것 / 잃는 것" className="flex-1">
              {people}
            </Box>
            <Box title="인원">{headcount}</Box>
          </div>
          <Box title="돈" testid="sum-money">
            {money}
          </Box>
        </div>
        </div>
      )}
      {pv.error && !over && (
        <div className="mt-1 bg-bad/20 px-1.5 py-1 text-bad" data-testid="desk-error">
          ✕ 불가: {pv.error}
        </div>
      )}
      <div className="mt-1.5 flex items-center gap-2">
        {mobile && !empty && (
          <button className="px-btn !px-2 text-[12px]" data-sfx="tab" data-testid="sum-toggle" onClick={() => setWide((v) => !v)}>
            {wide ? '접기 ▼' : '자세히 ▲'}
          </button>
        )}
        <button className="px-btn mob:!px-2" data-testid="desk-clear" disabled={empty} onClick={clear}>
          비우기
        </button>
        <button className="px-btn primary flex-1 text-[14px] mob:min-h-11" data-sfx="none" data-testid="desk-confirm" disabled={empty || !!pv.error} onClick={onConfirm}>
          확정 ({pv.n}건)
        </button>
      </div>
    </div>
  );
}
