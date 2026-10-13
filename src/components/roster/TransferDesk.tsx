import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Player } from '../../game/types';
import { play } from '../../audio/sfx';
import { fmtInt, fmtMoney } from '../../game/format';
import { FARM_MAX, FOREIGN_MAX, ROSTER_MAX, basketCount, basketKindOf, previewTransfer, type BasketKind, type TransferPreview } from '../../game/transfer';
import { useCore, useStore, useUserTeam } from '../../store';
import { useIsMobile } from '../layout/useLayout';
import { POS_KO } from '../ui';
import { CardPop, FullScreen } from './FrontOffice';
import PlayerTable from './PlayerTable';
import { PART_KO } from './labels';
import { usePosReport } from './rosterUi';
import { useTransferUi } from './transferUi';

const PARTS = ['bat', 'def', 'rot', 'pen'] as const;
const DONE_MS = 2000;
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

/** 줄의 담기 버튼: 담으면 색이 차고, 다시 누르면 빠진다 */
function AddChip({ kind, pid, big = false }: { kind: BasketKind; pid: string; big?: boolean }) {
  const on = useTransferUi((s) => s.basket[kind].includes(pid));
  const toggle = useTransferUi((s) => s.toggle);
  const b = BAND[kind];
  return (
    <button
      data-testid={`add-${kind}`}
      data-on={on || undefined}
      data-sfx="tab"
      onClick={() => toggle(kind, pid)}
      className={`shrink-0 cursor-pointer whitespace-nowrap ${big ? 'min-h-9 px-3 text-[13px]' : 'px-1.5 py-0.5 text-[10px] mob:min-h-8 mob:px-2 mob:text-[12px]'}`}
      style={on ? { background: b.color, color: '#0f1420' } : { background: '#0f1420', color: b.color, boxShadow: `inset 0 0 0 1px ${b.color}88` }}
    >
      {on ? `✓ ${b.label}` : b.add}
    </button>
  );
}

const squadKinds = (p: Player): BasketKind[] => ['release', p.farm ? 'up' : 'down'];

function Desk() {
  const mobile = useIsMobile();
  const core = useCore();
  const team = useUserTeam();
  const rows = usePosReport();
  const freeAgents = useStore((s) => s.freeAgents);
  const transfer = useStore((s) => s.transfer);
  const { basket, side, pos, nonce, close, clear } = useTransferUi();
  const [card, setCard] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const pv = useMemo(() => previewTransfer(core, basket), [core, basket]);
  const band = (p: Player) => {
    const k = basketKindOf(basket, p.id);
    return k ? BAND[k] : undefined;
  };
  const cardFa = card ? freeAgents.find((p) => p.id === card) : undefined;
  const cardP = cardFa ?? (card ? team.roster.find((p) => p.id === card) : undefined);

  const confirm = () => {
    const moved = PARTS.filter((k) => pv.parts.a[k] !== pv.parts.b[k]).map((k) => `${PART_KO[k]} ${pv.parts.a[k]} → ${pv.parts.b[k]}`);
    const text = `✓ ${pv.n}건 완료 · ${moved.length ? moved.join(' · ') : `현금 ${fmtMoney(pv.cash.a)} → ${fmtMoney(pv.cash.b)}`}`;
    if (!transfer(basket)) return;
    play('buy');
    clear();
    setDone(text);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setDone(null), DONE_MS);
  };

  const market = (
    <PlayerTable key={`m${nonce}`} mode="market" players={freeAgents} rows={rows} sel={card} onPick={(p) => setCard(p.id)} initPos={pos} band={band} rowAction={(p) => <AddChip kind="sign" pid={p.id} />} />
  );
  const squad = (
    <PlayerTable
      key={`s${nonce}`}
      mode="roster"
      players={team.roster}
      rows={rows}
      sel={card}
      onPick={(p) => setCard(p.id)}
      band={band}
      rowAction={(p) => squadKinds(p).map((k) => <AddChip key={k} kind={k} pid={p.id} />)}
    />
  );
  const tabs: [typeof side, string, number][] = [
    ['market', '영입 시장', freeAgents.length],
    ['squad', '우리 선수단', team.roster.length],
  ];

  return (
    <FullScreen title="이적 창구" sub={`현금 ${fmtMoney(core.finance.cash)} · 1군 ${pv.active.a}/${ROSTER_MAX} · 2군 ${pv.farm.a}/${FARM_MAX} · 담는 동안 실제 선수단은 그대로`} onClose={close} testid="transfer-desk" hold={!!cardP}>
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
      <Summary pv={pv} done={done} mobile={mobile} onConfirm={confirm} />
      {cardP && (
        <CardPop player={cardP} onClose={() => setCard(null)}>
          {(cardFa ? (['sign'] as BasketKind[]) : squadKinds(cardP)).map((k) => (
            <AddChip key={k} kind={k} pid={cardP.id} big />
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
      <div className="mb-0.5 text-[10px] text-sky mob:text-[11px]">▸ {title}</div>
      {children}
    </div>
  );
}

function Summary({ pv, done, mobile, onConfirm }: { pv: TransferPreview; done: string | null; mobile: boolean; onConfirm: () => void }) {
  const team = useUserTeam();
  const basket = useTransferUi((s) => s.basket);
  const put = useTransferUi((s) => s.put);
  const clear = useTransferUi((s) => s.clear);
  const [wide, setWide] = useState(false); // 모바일: 펼침
  const full = !mobile || wide;
  const empty = pv.n === 0;
  const ups = basket.up.map((id) => team.roster.find((p) => p.id === id)).filter((p): p is Player => !!p);
  const moved = PARTS.filter((k) => pv.parts.a[k] !== pv.parts.b[k]);
  const wins = Math.round(pv.wins * 10) / 10;
  const winText = `${wins >= 0 ? '+' : '−'}${Math.abs(wins).toFixed(1)}승`;
  const oneOff = pv.bonus + pv.penalty;

  if (done) {
    return (
      <div className="shrink-0 bg-good/20 px-2 py-3 text-center text-[14px] text-good" style={{ boxShadow: 'inset 0 2px 0 #6ee07a' }} data-testid="desk-done">
        {done}
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
            <div className="text-[10px] text-white/55">{PART_KO[k]}</div>
            <div className={`whitespace-nowrap text-[13px] ${a === b ? 'text-white/70' : b > a ? 'text-good' : 'text-bad'}`}>{a === b ? a : `${a}→${b}`}</div>
          </div>
        );
      })}
    </div>
  );
  const headcount = (
    <>
      <Line label="1군" testid="sum-active">
        <Pair a={`${pv.active.a}/${ROSTER_MAX}`} b={`${pv.active.b}/${ROSTER_MAX}`} good={pv.active.b > ROSTER_MAX ? false : null} />
      </Line>
      <Line label="2군" testid="sum-farm">
        <Pair a={`${pv.farm.a}/${FARM_MAX}`} b={`${pv.farm.b}/${FARM_MAX}`} good={pv.farm.b > FARM_MAX ? false : null} />
      </Line>
      <Line label="외국인" testid="sum-foreign">
        <Pair a={`${pv.foreign.a}/${FOREIGN_MAX}`} b={`${pv.foreign.b}/${FOREIGN_MAX}`} good={pv.foreign.b > FOREIGN_MAX ? false : null} />
      </Line>
    </>
  );
  const money = (
    <>
      <Line label="연봉 총액/시즌" testid="sum-payroll">
        <Pair a={fmtMoney(pv.payroll.a)} b={fmtMoney(pv.payroll.b)} good={pv.payroll.b < pv.payroll.a} />
      </Line>
      <Line label="일회성" testid="sum-oneoff">
        {oneOff ? (
          <>
            <span className="text-bad">−{fmtMoney(oneOff)}</span>
            <span className="text-white/50"> (계약금 {fmtMoney(pv.bonus)} + 위약금 {fmtMoney(pv.penalty)})</span>
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
      {pv.ins.map(({ p, bonus }) => (
        <div key={p.id} className="truncate" data-testid="sum-in">
          <span className="text-good">+ 영입 </span>
          {p.name} <span className="text-white/60">OVR {p.ovr} · {POS_KO[p.pos]} · 연 {fmtMoney(p.salary)} · 계약금 {fmtMoney(bonus)}</span>
        </div>
      ))}
      {ups.map((p) => (
        <div key={p.id} className="truncate" data-testid="sum-up">
          <span className="text-sky">▲ 콜업 </span>
          {p.name} <span className="text-white/60">OVR {p.ovr} · {POS_KO[p.pos]}</span>
        </div>
      ))}
      {pv.outs.map((o) => (
        <div key={o.p.id} className="truncate" data-testid="sum-out">
          <span className={o.to === 'release' ? 'text-bad' : 'text-[#f0a35a]'}>{o.to === 'release' ? '− 방출 ' : '▼ 2군 '}</span>
          {o.p.name}{' '}
          <span className="text-white/60">
            OVR {o.p.ovr} · <span className={o.starter ? 'text-hi' : ''}>{o.role}</span>
            {o.to === 'release' && ` · 위약금 ${fmtMoney(o.cost)}`}
          </span>
          {o.franchise && <span className="text-bad"> · 프랜차이즈 (팬 감소)</span>}
        </div>
      ))}
      {fanDiff !== 0 && (
        <div className={fanDiff > 0 ? 'text-good' : 'text-bad'} data-testid="sum-fans">
          팬 {fmtInt(pv.fans.a)} → {fmtInt(pv.fans.b)} ({fanDiff > 0 ? '+' : '−'}{fmtInt(Math.abs(fanDiff))})
        </div>
      )}
      {empty && <div className="text-white/45">담은 선수 없음 · 줄의 [+ 영입] [− 방출] [▼ 2군] [▲ 콜업] 으로 담는다</div>}
    </div>
  );
  const bumps = pv.bumps.map((b) => (
    <div key={b.fa.id} className="flex flex-wrap items-center gap-1" data-testid="sum-bump">
      <span>
        <span className="text-white/55">{b.fa.name} 영입 시 {b.starter ? '밀려나는 선수' : '남는 선수'}: </span>
        {b.p.name} <span className="text-white/60">(OVR {b.p.ovr}, 연봉 {fmtMoney(b.p.salary)})</span>
      </span>
      <button className="cursor-pointer whitespace-nowrap bg-ink px-1.5 py-0.5 text-bad mob:min-h-8 mob:px-2" style={{ boxShadow: 'inset 0 0 0 1px #ff6b6b88' }} data-sfx="tab" data-testid="bump-release" onClick={() => put('release', b.p.id)}>
        이 선수 방출도 담기
      </button>
      <button className="cursor-pointer whitespace-nowrap bg-ink px-1.5 py-0.5 text-[#f0a35a] mob:min-h-8 mob:px-2" style={{ boxShadow: 'inset 0 0 0 1px #f0a35a88' }} data-sfx="tab" data-testid="bump-down" onClick={() => put('down', b.p.id)}>
        2군으로 담기
      </button>
    </div>
  ));

  return (
    <div className="shrink-0 bg-panel-2 px-1.5 pt-1 pb-1.5 text-[11px] mob:text-[12px]" style={{ boxShadow: 'inset 0 2px 0 #ffd84a' }} data-testid="desk-summary" data-wide={full || undefined}>
      {full ? (
        <div className="px-scroll grid max-h-[34dvh] grid-cols-[1.15fr_1.25fr_1.35fr] gap-1 overflow-y-auto mob:max-h-[46dvh] mob:grid-cols-1">
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
      ) : (
        <div className="leading-snug" data-testid="sum-compact">
          {empty ? (
            <span className="text-white/50">담은 선수 없음 · 줄의 버튼으로 담는다</span>
          ) : (
            <>
              <span className="text-hi">{pv.n}건</span>
              {pv.exact && (
                <>
                  <span className="text-white/35"> · </span>
                  {moved.length ? (
                    moved.map((k, i) => (
                      <span key={k} className={pv.parts.b[k] > pv.parts.a[k] ? 'text-good' : 'text-bad'}>
                        {i > 0 && ' '}
                        {PART_KO[k]} {pv.parts.a[k]}→{pv.parts.b[k]}
                      </span>
                    ))
                  ) : (
                    <span className="text-white/60">전력 변화 없음</span>
                  )}
                  <span className="text-white/35"> · </span>
                  <span className={wins >= 0 ? 'text-good' : 'text-bad'}>{winText}</span>
                </>
              )}
              <span className="text-white/35"> · </span>
              <span className="whitespace-nowrap">
                현금 {fmtMoney(pv.cash.a)}→<span className={pv.cash.b < 0 ? 'text-bad' : ''}>{fmtMoney(pv.cash.b)}</span>
              </span>
              <span className="text-white/35"> · </span>
              <span className="whitespace-nowrap">
                연봉 {signed(pv.payroll.b - pv.payroll.a)}
              </span>
              <span className="text-white/35"> · </span>
              <span className={`whitespace-nowrap ${pv.active.b > ROSTER_MAX ? 'text-bad' : ''}`}>
                1군 {pv.active.a}→{pv.active.b}/{ROSTER_MAX}
              </span>
              {pv.outs.length > 0 && (
                <div className="truncate text-white/70">
                  <span className="text-bad">잃는 것 </span>
                  {pv.outs.map((o) => `${o.p.name} ${o.p.ovr} ${o.role}${o.franchise ? ' ★프랜차이즈' : ''}`).join(' · ')}
                </div>
              )}
            </>
          )}
        </div>
      )}
      {bumps.length > 0 && <div className="mt-1 flex flex-col gap-1 bg-ink/55 px-1.5 py-1">{bumps}</div>}
      {pv.error && (
        <div className="mt-1 bg-bad/20 px-1.5 py-1 text-bad" data-testid="desk-error">
          ✕ 불가: {pv.error}
        </div>
      )}
      <div className="mt-1.5 flex items-center gap-2">
        {mobile && (
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
