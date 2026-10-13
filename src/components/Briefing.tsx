import { useEffect, useState } from 'react';
import { play } from '../audio/sfx';
import { openDesk } from './roster/transferUi';
import type { BriefDetail, BriefOffer, BriefResult, Player } from '../game/types';
import { PART_LABELS } from '../game/briefing';
import { flagForecast } from '../game/campaign';
import { CHARACTERS } from '../game/story';
import { findPlayer, useCore, useStore, useUserTeam } from '../store';
import PlayerCard from './PlayerCard';
import { Bar, ratingColor } from './ui';
import { Flag } from './Campaign';
import PixelFace from './PixelFace';
import { useIsMobile } from './layout/useLayout';
import { useUi, type TipId } from './layout/uiStore';

const safe = {
  paddingTop: 'max(env(safe-area-inset-top), 4px)',
  paddingBottom: 'max(env(safe-area-inset-bottom), 6px)',
  paddingLeft: 'max(env(safe-area-inset-left), 4px)',
  paddingRight: 'max(env(safe-area-inset-right), 4px)',
};

/** 깃발 예측 한 줄: "지금 페이스: 6위 예상 · 깃발 7위 이내 ✓" (12경기 전에는 "—") */
export function FlagForecast({ className = '' }: { className?: string }) {
  const core = useCore();
  const f = flagForecast(core);
  return (
    <div className={`flex items-start gap-1.5 text-[12px] leading-snug mob:text-[13px] ${className}`} data-testid="flag-forecast">
      <span className="mt-[2px] shrink-0">
        <Flag size={11} color={f.ok ? '#6ee07a' : '#ffd84a'} />
      </span>
      <span className={f.text === '—' ? 'text-white/50' : f.ok ? 'text-good' : 'text-white/85'}>{f.text === '—' ? '깃발 예측 — (12경기 뒤부터)' : f.text}</span>
    </div>
  );
}

/** 조합장의 자금 경고 한 줄: 제안보다 위에 뜬다 */
function ChairAlert({ text }: { text: string }) {
  const team = useUserTeam();
  const ch = CHARACTERS.chair;
  return (
    <div className="flex items-start gap-2 bg-bad/15 p-2" style={{ boxShadow: 'inset 3px 0 0 #ff6b6b' }} data-testid="brief-alert">
      <div className="shrink-0" style={{ boxShadow: `0 0 0 2px #0f1420, 0 0 0 3px ${team.color2}` }}>
        <PixelFace id={`char-${ch.seed}`} color={team.color} color2={team.color2} size={44} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[12px] leading-tight mob:text-[13px]">
          {ch.name} <span className="text-[11px] text-white/55">{ch.title}</span>
        </div>
        <div className="mt-0.5 text-[12px] leading-snug text-white mob:text-[13px]">“{text}”</div>
      </div>
    </div>
  );
}

/** 스태프 제안 한 장: 초상 + 한 줄 + 예상 결과 숫자 + [실행] 한 번 탭 / 넘기기 */
function OfferCard({ o, onOpen }: { o: BriefOffer; onOpen: () => void }) {
  const team = useUserTeam();
  const run = useStore((s) => s.briefRun);
  const skip = useStore((s) => s.briefSkip);
  const ch = CHARACTERS[o.who];
  const done = o.state === 'done';
  const skipped = o.state === 'skipped';
  return (
    <div className={`bg-ink/55 p-2 ${skipped ? 'opacity-50' : ''}`} style={{ boxShadow: done ? 'inset 3px 0 0 #6ee07a' : 'inset 3px 0 0 #ffd84a' }} data-testid="brief-offer" data-offer={o.id} data-state={o.state ?? 'open'}>
      {/* 카드를 누르면 상세 시트 */}
      <button className="block w-full cursor-pointer text-left" data-testid="brief-open" onClick={onOpen}>
        <div className="flex items-start gap-2">
          <div className="shrink-0" style={{ boxShadow: `0 0 0 2px #0f1420, 0 0 0 3px ${team.color2}` }}>
            <PixelFace id={`char-${ch.seed}`} color={team.color} color2={team.color2} size={44} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-2 text-[12px] leading-tight mob:text-[13px]">
              <span>
                {ch.name} <span className="text-[11px] text-white/55">{ch.title}</span>
              </span>
              <span className="shrink-0 text-[11px] text-sky">상세 ▸</span>
            </div>
            <div className="mt-0.5 text-[12px] leading-snug text-white/85 mob:text-[13px]">“{o.line}”</div>
          </div>
        </div>
        <div className="mt-1.5 text-[12px] leading-snug text-hi mob:text-[13px]" data-testid="brief-effect">
          {o.effect.split(' · ')[0]}
        </div>
      </button>
      <div className="mt-1.5 flex items-center gap-2">
        {done ? (
          <span className="text-[12px] text-good mob:text-[13px]">✓ 실행됨 — 결과는 다음 주 브리핑에</span>
        ) : skipped ? (
          <span className="text-[12px] text-white/60 mob:text-[13px]">넘겼습니다</span>
        ) : (
          <>
            <button className="px-btn primary min-h-10 flex-[2] text-[14px]" data-testid="brief-run" onClick={() => run(o.id)}>
              실행
            </button>
            <button className="px-btn min-h-10 flex-1 text-[12px] mob:text-[13px]" data-testid="brief-skip" onClick={() => skip(o.id)}>
              넘기기
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ───────── 상세 시트 ─────────

const B_STATS: [keyof Player, string][] = [['ovr', '종합'], ['con', '컨택'], ['pow', '파워'], ['eye', '선구'], ['spd', '주력'], ['def', '수비'], ['pot', '잠재']];
const P_STATS: [keyof Player, string][] = [['ovr', '종합'], ['stf', '구위'], ['ctl', '제구'], ['sta', '체력'], ['pot', '잠재']];

/** 들어오는 선수 vs 밀려나는 주전: 능력치마다 막대 2줄 */
function Compare({ a, b }: { a: Player; b: Player }) {
  const line = (v: number, name: string, hi: boolean) => (
    <div className="flex items-center gap-1.5 text-[11px] leading-none">
      <span className={`w-14 shrink-0 truncate ${hi ? 'text-white' : 'text-white/55'}`}>{name}</span>
      <Bar ratio={(v - 15) / 85} color={ratingColor(v)} h={7} />
      <span className="w-5 shrink-0 text-right" style={{ color: ratingColor(v) }}>
        {v}
      </span>
    </div>
  );
  return (
    <div className="bg-ink/55 p-2" data-testid="detail-compare">
      <div className="mb-1 text-[11px] text-sky">
        ▸ {a.name}(위) vs 지금 주전 {b.name}(아래)
      </div>
      <div className="flex flex-col gap-1.5">
        {(a.kind === 'B' ? B_STATS : P_STATS).map(([k, label]) => {
          const va = a[k] as number;
          const vb = b[k] as number;
          return (
            <div key={k} className="flex items-center gap-1.5">
              <span className="w-8 shrink-0 text-[11px] text-white/60">{label}</span>
              <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
                {line(va, a.name, true)}
                {line(vb, b.name, false)}
              </div>
              <span className={`w-7 shrink-0 text-right text-[11px] ${va > vb ? 'text-good' : va < vb ? 'text-bad' : 'text-white/45'}`}>{va === vb ? '=' : `${va > vb ? '+' : '−'}${Math.abs(va - vb)}`}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** 전력 4칸 전 → 후 (cols 가 3개면 실행 전 · 예상 · 지금) */
function PartsTable({ cols }: { cols: { label: string; v: number[] }[] }) {
  const base = cols[0].v;
  return (
    <div className="bg-ink/55 p-2" data-testid="detail-parts">
      <div className="mb-1 text-[11px] text-sky">▸ 전력 4칸</div>
      <table className="w-full border-collapse text-center text-[12px] mob:text-[13px]">
        <thead>
          <tr className="text-[11px] text-white/50">
            <th className="text-left font-normal" />
            {PART_LABELS.map((l) => (
              <th key={l} className="font-normal">
                {l}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {cols.map((c, ci) => (
            <tr key={c.label}>
              <td className="text-left text-[11px] text-white/60">{c.label}</td>
              {c.v.map((v, i) => (
                <td key={i} className={ci === 0 || v === base[i] ? 'text-white/80' : v > base[i] ? 'text-good' : 'text-bad'}>
                  {v}
                  {ci > 0 && v !== base[i] && <span className="text-[10px]"> {v > base[i] ? `+${v - base[i]}` : `−${base[i] - v}`}</span>}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DetailBody({ d }: { d: BriefDetail }) {
  const teams = useStore((s) => s.teams);
  const freeAgents = useStore((s) => s.freeAgents);
  const team = useUserTeam();
  const p = findPlayer({ teams, freeAgents }, d.pid);
  const vs = findPlayer({ teams, freeAgents }, d.vsPid);
  const mine = !!p && team.roster.some((x) => x.id === p.id);
  return (
    <>
      {p && <PlayerCard player={p} team={mine ? team : undefined} />}
      {p && vs && <Compare a={p} b={vs} />}
      {d.shifts && (
        <div className="bg-ink/55 p-2" data-testid="detail-shifts">
          <div className="mb-1 text-[11px] text-sky">▸ 바뀌는 자리</div>
          {d.shifts.map((x) => (
            <div key={x.name + x.from} className="flex items-baseline gap-1.5 text-[12px] leading-relaxed mob:text-[13px]">
              <span className="w-16 shrink-0 truncate text-white">{x.name}</span>
              <span className="text-white/60">{x.from}</span>
              <span className="text-white/40">→</span>
              <span className={/벤치|불펜|대기|방출/.test(x.to) ? 'text-bad' : 'text-good'}>{x.to}</span>
            </div>
          ))}
        </div>
      )}
      {d.parts && <PartsTable cols={[{ label: '지금', v: d.parts.a }, { label: '실행 후', v: d.parts.b }]} />}
      {d.rows && (
        <div className="bg-ink/55 p-2" data-testid="detail-rows">
          <div className="mb-1 flex text-[11px] text-sky">
            <span className="flex-1">▸ 돈과 관중</span>
            <span className="w-[26%] text-right text-white/50">지금</span>
            <span className="w-[30%] text-right text-white/50">실행 후</span>
          </div>
          {d.rows.map((r) => (
            <div key={r.label} className="flex items-baseline text-[12px] leading-relaxed mob:text-[13px]">
              <span className="min-w-0 flex-1 truncate text-white/70">{r.label}</span>
              <span className="w-[26%] text-right text-white/70">{r.a}</span>
              <span className={`w-[30%] text-right ${r.tone === 'good' ? 'text-good' : r.tone === 'bad' ? 'text-bad' : 'text-white'}`}>{r.b}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

type Open = { t: 'offer'; id: string } | { t: 'result'; i: number };

/** 제안·결과 줄을 눌렀을 때의 상세 시트. 하단에 [실행]/[넘기기] — 카드의 한 번 탭 [실행]과 같은 동작 */
function DetailSheet({ o, r, mobile, onClose }: { o?: BriefOffer; r?: BriefResult; mobile: boolean; onClose: () => void }) {
  const run = useStore((s) => s.briefRun);
  const skip = useStore((s) => s.briefSkip);
  const ch = o ? CHARACTERS[o.who] : null;
  const body = (
    <>
      <div className="flex shrink-0 items-center gap-2 px-2 pt-1.5">
        <button className="px-btn min-h-9 !px-2 text-[12px]" data-testid="detail-back" onClick={onClose}>
          ◂ 브리핑
        </button>
        <span className="min-w-0 truncate font-pixel-lg text-[16px] leading-tight text-hi" style={{ textShadow: '1px 1px 0 #0f1420' }}>
          {o && ch ? `${ch.name} ${ch.title}의 제안` : `지난주 ${r?.label ?? ''}`}
        </span>
      </div>
      <div className="px-scroll flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2 pt-2 pb-1">
        {o && (
          <div className="bg-ink/55 px-2 py-1.5 text-[12px] leading-snug mob:text-[13px]" style={{ boxShadow: 'inset 3px 0 0 #ffd84a' }}>
            <div className="text-white/85">“{o.line}”</div>
            <div className="mt-1 text-hi">
              {o.effect}
              {o.flag && <span className="text-good"> · {o.flag}</span>}
            </div>
          </div>
        )}
        {o && !o.state && (o.action.t === 'sign' || o.rescue?.t === 'release') && (
          <button
            className="px-btn min-h-10 shrink-0 text-[13px]"
            data-testid="detail-desk"
            onClick={() => {
              const add: ['sign' | 'release', string] = o.rescue?.t === 'release' ? ['release', o.rescue.pid] : ['sign', (o.action as { pid: string }).pid];
              onClose();
              openDesk({ add: [add] });
            }}
          >
            이적 창구에 담아서 보기 ⤢ <span className="text-white/60">(방출·2군 이동과 합산)</span>
          </button>
        )}
        {o?.detail && <DetailBody d={o.detail} />}
        {o && !o.detail && <div className="text-[12px] text-white/60">상세 내역이 없습니다.</div>}
        {r && (
          <>
            <div className="bg-ink/55 px-2 py-1.5 text-[12px] leading-snug mob:text-[13px]" style={{ boxShadow: 'inset 3px 0 0 #ffd84a' }} data-testid="detail-expect">
              <div className="text-[11px] text-white/55">실행할 때의 예상</div>
              <div className="text-hi">{r.expect ?? '—'}</div>
            </div>
            <div className="bg-good/15 px-2 py-1.5 text-[12px] leading-snug mob:text-[13px]" style={{ boxShadow: 'inset 3px 0 0 #6ee07a' }} data-testid="detail-actual">
              <div className="text-[11px] text-white/55">실제</div>
              <div className="text-white">{r.text.replace(/^지난주 [^:]+: /, '')}</div>
            </div>
            {r.parts && <PartsTable cols={[{ label: '실행 전', v: r.parts.a }, { label: '예상', v: r.parts.b }, { label: '지금', v: r.parts.now }]} />}
          </>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2 px-2 pt-1.5 pb-2">
        {o && !o.state ? (
          <>
            <button
              className="px-btn primary min-h-11 flex-[2] text-[15px]"
              data-testid="detail-run"
              onClick={() => {
                run(o.id);
                onClose();
              }}
            >
              실행
            </button>
            <button
              className="px-btn min-h-11 flex-1 text-[13px]"
              data-testid="detail-skip"
              onClick={() => {
                skip(o.id);
                onClose();
              }}
            >
              넘기기
            </button>
          </>
        ) : (
          <button className="px-btn primary min-h-11 flex-1 text-[15px]" onClick={onClose}>
            {o?.state === 'done' ? '✓ 실행됨 — 돌아가기' : '돌아가기'}
          </button>
        )}
      </div>
    </>
  );
  if (mobile) {
    return (
      <div className="anim-fade fixed inset-0 z-[37] flex h-[calc(var(--dvh)*100)] flex-col bg-panel font-pixel text-[12px] select-none" style={safe} role="dialog" aria-label="제안 상세" data-testid="brief-detail">
        {body}
      </div>
    );
  }
  return (
    <div className="fixed inset-0 z-[37] flex items-center justify-center bg-ink/95 p-3 font-pixel text-[12px] select-none" role="dialog" aria-label="제안 상세" data-testid="brief-detail">
      <div className="px-panel anim-pop flex max-h-[min(720px,100%)] w-full max-w-[520px] flex-col">{body}</div>
    </div>
  );
}

/**
 * 주간 브리핑: 정규시즌 6경기마다 결정이 유저에게 온다. 이벤트 카드·경기 요약이 먼저고, 닫아야 다음 경기를 치른다.
 * 모바일은 전체 화면, 데스크톱은 중앙 모달.
 */
export default function BriefingSheet() {
  const b = useStore((s) => s.campaign.briefing);
  const show = useStore((s) => !!s.campaign.briefing && !s.campaign.event && !s.summary && !s.playback && s.phase === 'season');
  const close = useStore((s) => s.briefClose);
  const mobile = useIsMobile();
  const core = useCore();
  const fc = flagForecast(core);
  const behind = fc.text !== '—' && !fc.ok;
  const [open0, setOpen] = useState<Open | null>(null);
  useEffect(() => {
    if (show) play('event');
    else setOpen(null);
  }, [show]);
  if (!b || !show) return null;
  const openOffer = open0?.t === 'offer' ? b.offers.find((o) => o.id === open0.id) : undefined;
  const openResult = open0?.t === 'result' ? b.resultInfo?.[open0.i] : undefined;
  const detail = openOffer || openResult ? <DetailSheet o={openOffer} r={openResult} mobile={mobile} onClose={() => setOpen(null)} /> : null;
  const open = b.offers.filter((o) => !o.state).length;

  const body = (
    <>
      <div className="flex shrink-0 items-baseline gap-2 px-2 pt-1.5">
        <span className="font-pixel-lg text-[18px] leading-tight text-hi" style={{ textShadow: '1px 1px 0 #0f1420' }}>
          주간 브리핑
        </span>
        <span className="text-[11px] text-white/55 mob:text-[13px]">
          {b.day - 5}~{b.day}차전
        </span>
      </div>
      <div className="px-scroll flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2 pt-2 pb-1">
        {b.results.map((r, i) => (
          <button key={r} className="flex cursor-pointer items-baseline gap-2 bg-good/15 px-2 py-1.5 text-left text-[12px] leading-snug text-white mob:text-[13px]" style={{ boxShadow: 'inset 3px 0 0 #6ee07a' }} data-testid="brief-result" disabled={!b.resultInfo?.[i]} onClick={() => setOpen({ t: 'result', i })}>
            <span className="min-w-0 flex-1">{r}</span>
            {b.resultInfo?.[i] && <span className="shrink-0 text-[11px] text-sky">상세 ▸</span>}
          </button>
        ))}
        <div className="bg-ink/55 px-2 py-1.5">
          <div className="truncate text-[13px] leading-snug mob:text-[14px]" data-testid="brief-summary">
            {b.summary.split(' · ').slice(0, 2).join(' · ')}
          </div>
          {/* 깃발 예측은 뒤처졌을 때만 */}
          {behind && <FlagForecast className="mt-1" />}
        </div>
        {b.alert && <ChairAlert text={b.alert} />}
        {b.offers.map((o) => (
          <OfferCard key={o.id} o={o} onOpen={() => setOpen({ t: 'offer', id: o.id })} />
        ))}
      </div>
      <div className="shrink-0 px-2 pt-1.5 pb-2">
        <button className="px-btn primary min-h-11 w-full text-[15px]" data-testid="brief-close" onClick={close}>
          {open > 0 ? `남은 제안 ${open}장 넘기고 닫기` : '닫기'}
        </button>
      </div>
    </>
  );

  if (mobile) {
    return (
      <div className="anim-fade fixed inset-0 z-[36] flex h-[calc(var(--dvh)*100)] flex-col bg-panel font-pixel text-[12px] select-none" style={safe} role="dialog" aria-label="주간 브리핑" data-testid="briefing">
        {body}
        {detail}
      </div>
    );
  }
  return (
    <div className="fixed inset-0 z-[36] flex items-center justify-center bg-ink/70 p-3 font-pixel text-[12px] select-none" role="dialog" aria-label="주간 브리핑" data-testid="briefing">
      <div className="px-panel anim-pop flex max-h-[min(720px,100%)] w-full max-w-[520px] flex-col">{body}</div>
      {detail}
    </div>
  );
}

const TIP_TEXT: Record<TipId, string> = {
  market: '좋은 선수를 데려오면 전력이 오르고, 연봉이 나갑니다.',
  stadium: '표값을 올리면 경기당 수입이 늘고 관중이 줍니다. 자리가 모자라면 증축.',
  finance: '대출은 당장 쓸 돈을 주고, 시즌 내내 이자를 가져갑니다.',
};

/** 탭별 첫 만남 한 문장: 처음 열 때 한 번만, × 로 닫으면 다시 뜨지 않는다 */
export function FirstTip({ id }: { id: TipId }) {
  const seen = useUi((s) => !!s.tips[id]);
  const closeTip = useUi((s) => s.closeTip);
  if (seen) return null;
  return (
    <div className="mx-1.5 mt-1.5 flex shrink-0 items-start gap-1 bg-sky/15 py-1 pr-0.5 pl-2 text-[12px] leading-snug text-white mob:text-[13px]" style={{ boxShadow: 'inset 2px 0 0 #7fd0ff' }} data-testid={`tip-${id}`}>
      <span className="min-w-0 flex-1 py-0.5">{TIP_TEXT[id]}</span>
      <button className="shrink-0 cursor-pointer px-2 py-0.5 text-[14px] text-white/70 mob:min-h-10 mob:min-w-10" aria-label="닫기" onClick={() => closeTip(id)}>
        ×
      </button>
    </div>
  );
}
