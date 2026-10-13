import type { Campaign, Core, Objective, SeasonRecord } from '../game/types';
import { useCore, useStore } from '../store';
import { STAGES, TRUST_MAX, flagForecast, objDisplay } from '../game/campaign';
import { PAST_RANKS, TITLE_YEARS_AGO } from '../game/story';
import { useState } from 'react';
import { fmtInt } from '../game/format';
import Fold from './Fold';
import Help from './Help';
import Dialog from './layout/Dialog';
import { useUi } from './layout/uiStore';
import { Bar, SectionTitle, recText } from './ui';

// ───────── 표시 헬퍼 (데이터는 전부 game/ 에서 온다) ─────────

export const stageName = (i: number): string => STAGES[Math.max(0, Math.min(STAGES.length - 1, i))]?.name ?? '';
export const stageLabel = (i: number): string => `${i + 1}장 · ${stageName(i)}`;
/** 아직 닿지 않은 장의 이름은 실루엣으로만 */
export const silhouette = (i: number): string => '█'.repeat(Math.max(3, Math.min(8, [...stageName(i)].filter((c) => c !== ' ').length)));

export const POST_KO: Record<SeasonRecord['post'], string> = { none: '', SPO: '준플레이오프', PO: '플레이오프', KS: '준우승', champion: '우승' };

const trustColor = (v: number) => (v >= 50 ? '#6ee07a' : v >= 25 ? '#ffd84a' : '#ff6b6b');

/** 7×7 픽셀 깃발 */
export function Flag({ size = 12, color = '#ffd84a', faded = false }: { size?: number; color?: string; faded?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 7 7" shapeRendering="crispEdges" aria-hidden className="shrink-0" style={faded ? { opacity: 0.45 } : undefined}>
      <rect x={1} y={0} width={1} height={7} fill="#cfd6ea" />
      <rect x={2} y={0} width={4} height={1} fill={color} />
      <rect x={2} y={1} width={5} height={1} fill={color} />
      <rect x={2} y={2} width={4} height={1} fill={color} />
      <rect x={2} y={3} width={3} height={1} fill={color} />
    </svg>
  );
}

/** 별 하나: 금색 채움은 결산에서 딴 뒤에만. 시즌 중 "현재 충족"은 테두리만. */
export function Star({ o, met }: { o: Objective; met: boolean }) {
  if (o.state === 'done') return <span className="text-hi">★</span>;
  if (o.state === 'failed') return <span className="text-white/15">★</span>;
  return <span className={met ? 'text-hi' : 'text-white/30'}>{met ? '☆' : '★'}</span>;
}

export function StarRow({ objs, core, size = 12 }: { objs: Objective[]; core: Core; size?: number }) {
  return (
    <span className="inline-flex shrink-0 tracking-tighter" style={{ fontSize: size, lineHeight: 1 }}>
      {objs.map((o) => (
        <Star key={o.id} o={o} met={objDisplay(core, o).met} />
      ))}
    </span>
  );
}

export function TrustGauge({ trust, w = 40, h = 5 }: { trust: number; w?: number; h?: number }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1">
      <span style={{ color: trustColor(trust) }}>{Math.round(trust)}</span>
      <span style={{ width: w }}>
        <Bar ratio={trust / TRUST_MAX} color={trustColor(trust)} h={h} />
      </span>
    </span>
  );
}

/** 구단사 순위열: 부임 전은 흐리게, 이후는 이어 붙인다 ("8-8-7-8-8-7-5") */
export function RankString({ history, size = 16 }: { history: SeasonRecord[]; size?: number }) {
  return (
    <span className="font-pixel-lg" style={{ fontSize: size, lineHeight: 1.2, wordBreak: 'break-all' }}>
      <span className="text-white/30">{PAST_RANKS.join('-')}</span>
      {history.map((h) => (
        <span key={h.season}>
          <span className="text-white/30">-</span>
          <span className={h.post === 'champion' ? 'text-hi' : h.rank <= 4 ? 'text-good' : h.rank >= 7 ? 'text-bad' : 'text-white'}>{h.rank}</span>
        </span>
      ))}
    </span>
  );
}

function useCampaign(): { c: Campaign; core: Core; main: Objective | undefined; stars: Objective[] } {
  const core = useCore();
  const c = core.campaign;
  const objs = c.objectives ?? [];
  return { c, core, main: objs.find((o) => o.main), stars: objs.filter((o) => !o.main) };
}

// ───────── 상단바 칩 ─────────

/**
 * "N장 · 이름" + 깃발 진행 막대 + 별 + 도민 지지. 누르면 캠페인 시트.
 * line: 한 줄(모바일 세로) / 기본: 두 줄(데스크톱·모바일 가로)
 */
export function CampaignChip({ line = false, className = '' }: { line?: boolean; className?: string }) {
  const { c: now, core, main, stars: starsNow } = useCampaign();
  const open = useUi((s) => s.setCampaignOpen);
  // 결산 화면이 변화를 연출하기 전(마지막 경기 요약이 떠 있는 동안)에는 결산 전의 장·지지·별을 보여 준다
  const v = core.phase === 'ended' ? now.verdict : null;
  const c = v ? { ...now, stage: v.stageBefore, trust: v.trustBefore } : now;
  const stars = v ? starsNow.map((o): Objective => (v.newAchievements.includes(o.id) || o.state === 'failed' ? { ...o, state: 'open' } : o)) : starsNow;
  const flag = main ? objDisplay(core, main) : null;
  const flagDone = !!flag?.met;
  const flagBar = <Bar ratio={flag?.ratio ?? 0} color={flagDone ? '#6ee07a' : '#ffd84a'} h={5} />;
  // 깃발 예측: 칩에는 "6위 예상 ✓" 처럼 가운데 조각만
  const fc = flagForecast(core);
  const fcShort = fc.text === '—' ? null : fc.text.split(' · ').find((x) => x.includes('예상')) ?? null;
  const pace = fcShort && (
    <span className={`shrink-0 whitespace-nowrap text-[11px] ${fc.ok ? 'text-good' : 'text-bad'}`} data-testid="chip-forecast">
      {fcShort.replace('지금 페이스: ', '').replace('시즌 평균 관중 ', '평균 ')} {fc.ok ? '✓' : '✗'}
    </span>
  );
  const title = (
    <span className="flex min-w-0 items-center gap-1">
      <Flag size={11} color={flagDone ? '#6ee07a' : '#ffd84a'} />
      <span className="truncate">{stageLabel(c.stage)}</span>
    </span>
  );
  // 도민 지지는 숫자만 (게이지·별 3개는 캠페인 시트에서)
  const trust = (
    <span className="flex shrink-0 items-center gap-1" data-testid="chip-trust">
      <span className="text-[10px] text-white/50 mob:text-[13px]">도민 지지</span>
      <span style={{ color: trustColor(c.trust) }}>{Math.round(c.trust)}</span>
    </span>
  );
  // 깃발 예측은 뒤처졌을 때만
  const behind = !fc.ok ? pace : null;

  if (line) {
    return (
      <div className={`flex w-full items-center pr-1.5 ${className}`}>
        <button className="flex min-h-10 min-w-0 flex-1 cursor-pointer items-center gap-2 px-2 text-left text-[13px] leading-tight short:min-h-9" onClick={() => open(true)} aria-label="캠페인">
          {title}
          <span className="min-w-6 flex-1">{flagBar}</span>
          {behind}
          {trust}
        </button>
        <Help topic="trust" />
      </div>
    );
  }
  return (
    <div className={`flex min-w-0 items-center ${className}`}>
      <button className="flex min-w-0 flex-1 cursor-pointer flex-col justify-center gap-[3px] self-stretch px-2 text-left text-[12px] leading-tight mob:min-h-10 mob:text-[13px]" onClick={() => open(true)} aria-label="캠페인">
        <span className="flex w-full items-center justify-between gap-2">
          {title}
          {trust}
        </span>
        <span className="flex w-full items-center gap-2">
          <span className="min-w-6 flex-1">{flagBar}</span>
          {behind}
        </span>
      </button>
      <Help topic="trust" className="mr-1" />
    </div>
  );
}

// ───────── 캠페인 시트 ─────────

/** 깃발 = 한 줄 + 막대. 별 = 문장과 달성 표시만, 진행 수치는 탭하면 */
function ObjRow({ o, core, flag }: { o: Objective; core: Core; flag?: boolean }) {
  const d = objDisplay(core, o);
  const [open, setOpen] = useState(false);
  const c = o.state === 'failed' ? '#6b7694' : d.met ? '#6ee07a' : flag ? '#ffd84a' : '#7fd3ff';
  const num = (
    <span className="shrink-0 text-[11px] text-white/70 mob:text-[13px]">
      {d.cur} <span className="text-white/40">/ {d.target}</span>
    </span>
  );
  if (flag) {
    return (
      <div className="bg-ink/50 px-2 py-1.5" data-testid="obj-flag">
        <div className="flex items-center gap-1.5 text-[12px] mob:text-[13px]">
          <Flag size={13} color={c} />
          <span className="min-w-0 flex-1">{o.text}</span>
          {num}
        </div>
        <Bar ratio={d.ratio} color={c} h={7} className="mt-1" />
      </div>
    );
  }
  return (
    <button type="button" className="w-full cursor-pointer bg-ink/50 px-2 py-1.5 text-left mob:min-h-10" onClick={() => setOpen(!open)} aria-expanded={open} data-testid="obj-star">
      <div className="flex items-center gap-1.5 text-[12px] mob:text-[13px]">
        <Star o={o} met={d.met} />
        <span className={`min-w-0 flex-1 ${o.state === 'failed' ? 'text-white/45' : ''}`}>{o.text}</span>
        {open ? num : <span className={`shrink-0 text-[11px] ${d.met ? 'text-good' : 'text-white/35'}`}>{o.state === 'done' ? '달성' : d.met ? '충족 중' : '▾'}</span>}
      </div>
      {open && <Bar ratio={d.ratio} color={c} h={5} className="mt-1" />}
    </button>
  );
}

/** 지나온 장 / 현재 / 다음은 실루엣 */
export function StageTrail({ stage, revealNext = false }: { stage: number; revealNext?: boolean }) {
  const last = STAGES.length - 1;
  const rows: { i: number; kind: 'past' | 'now' | 'next' }[] = [];
  for (let i = 0; i < stage; i++) rows.push({ i, kind: 'past' });
  rows.push({ i: stage, kind: 'now' });
  if (stage < last) rows.push({ i: stage + 1, kind: 'next' });
  return (
    <div className="flex flex-col gap-[2px]">
      {rows.map(({ i, kind }) => (
        <div
          key={i}
          className={`flex items-center gap-1.5 px-2 py-1 text-[12px] mob:text-[13px] ${kind === 'now' ? 'bg-hi/20 text-hi' : kind === 'past' ? 'bg-ink/40 text-white/55' : 'bg-ink/40 text-white/25'}`}
          style={kind === 'now' ? { boxShadow: 'inset 2px 0 0 #ffd84a' } : undefined}
        >
          <Flag size={11} color={kind === 'past' ? '#6ee07a' : kind === 'now' ? '#ffd84a' : '#6b7694'} faded={kind === 'next'} />
          <span>
            {i + 1}장 · {kind === 'next' && !revealNext ? silhouette(i) : stageName(i)}
          </span>
        </div>
      ))}
    </div>
  );
}

/** 구단사: 순위열 + 시즌별 한 줄 */
export function Chronicle({ history, rankSize = 18 }: { history: SeasonRecord[]; rankSize?: number }) {
  return (
    <>
      <div className="bg-ink/50 px-2 py-1.5">
        <RankString history={history} size={rankSize} />
      </div>
      {history
        .slice()
        .reverse()
        .map((h) => (
          <div key={h.season} className="flex items-baseline gap-1.5 px-2 py-[3px] text-[11px] odd:bg-white/4 mob:text-[13px]">
            <span className="w-11 shrink-0 text-white/50">{h.season}시즌</span>
            <span className={`w-7 shrink-0 ${h.rank <= 4 ? 'text-good' : h.rank >= 7 ? 'text-bad' : ''}`}>{h.rank}위</span>
            <span className="shrink-0 text-white/65">{recText(h)}</span>
            {h.post !== 'none' && <span className={`shrink-0 ${h.post === 'champion' ? 'text-hi' : 'text-sky'}`}>{POST_KO[h.post]}</span>}
            {h.name && <span className="min-w-0 flex-1 truncate text-right text-white/85">「{h.name}」</span>}
          </div>
        ))}
    </>
  );
}

export function Retired({ list }: { list: NonNullable<Campaign['retired']> }) {
  if (!list.length) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {list.map((r, i) => (
        <span key={`${r.name}-${i}`} className="bg-ink/60 px-2 py-1 text-[11px] mob:text-[13px]" style={{ boxShadow: 'inset 0 2px 0 #ffd84a' }}>
          <span className="text-hi">{r.name}</span>
          <span className="text-white/50">
            {' '}
            {r.pos} · {r.season}시즌
          </span>
        </span>
      ))}
    </div>
  );
}

export function CampaignSheet() {
  const isOpen = useUi((s) => s.campaignOpen);
  const setOpen = useUi((s) => s.setCampaignOpen);
  const { c, core, main, stars } = useCampaign();
  if (!isOpen) return null;
  const history = c.history ?? [];
  const retired = c.retired ?? [];
  const fc = flagForecast(core);

  return (
    <Dialog onClose={() => setOpen(false)} label="캠페인">
      <div className="flex items-center justify-between gap-2">
        <div className="font-pixel-lg text-[18px] leading-tight text-hi" style={{ textShadow: '1px 1px 0 #0f1420' }}>
          {stageLabel(c.stage)}
        </div>
        <div className="flex shrink-0 items-center gap-1 text-[12px]">
          <span className="text-[11px] text-white/50">도민 지지</span>
          <TrustGauge trust={c.trust} w={64} h={7} />
          <Help topic="trust" />
        </div>
      </div>

      <div className="mt-2 flex flex-col gap-[3px]">
        <div className="flex items-center justify-between px-0.5 text-[11px] text-white/55 mob:text-[13px]">
          <span>이번 시즌 목표</span>
          <Help topic="flag" />
        </div>
        {main && <ObjRow o={main} core={core} flag />}
        {main && fc.text !== '—' && !fc.ok && (
          <div className="px-1 text-[12px] leading-snug text-white/85 mob:text-[13px]" data-testid="sheet-forecast">
            {fc.text}
          </div>
        )}
        {stars.map((o) => (
          <ObjRow key={o.id} o={o} core={core} />
        ))}
      </div>

      <div className="mt-2 flex flex-col gap-[3px]">
        <Fold label="팬 · 걸어온 길" testid="fold-trail">
          <div className="mb-1 bg-ink/50 px-2 py-1.5 text-[12px] mob:text-[13px]">
            팬 <span className="text-hi">{fmtInt(Math.round(core.fans))}</span>명 · 만족도 <span className="text-hi">{Math.round(core.fanSat)}</span>/100
          </div>
          {c.opening && <div className="mb-1 px-1 text-[12px] leading-snug text-white/75 mob:text-[13px]">“{c.opening}”</div>}
          <StageTrail stage={c.stage} />
        </Fold>
        <Fold
          testid="fold-history"
          label={
            <span className="flex items-center gap-1">
              구단사
              <Flag size={10} color="#b9a36a" faded />
              <span className="text-white/45">{TITLE_YEARS_AGO}시즌 전</span>
              {Array.from({ length: Math.min(5, c.titles ?? 0) }, (_, i) => (
                <Flag key={i} size={10} />
              ))}
            </span>
          }
        >
          <Chronicle history={history} />
        </Fold>
        {retired.length > 0 && (
          <Fold label={`영구결번 ${retired.length}`} testid="fold-retired">
            <Retired list={retired} />
          </Fold>
        )}
      </div>
    </Dialog>
  );
}
