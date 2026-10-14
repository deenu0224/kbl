import { useEffect, useMemo, useState } from 'react';
import { ACHV_CATS, achvProgress, type AchvCat, type AchvDef } from '../game/achievements';
import { ACHV_LIST } from '../game/achievementList';
import { play } from '../audio/sfx';
import { pickCore, useStore } from '../store';
import { useAchv } from './achvStore';
import { useUi } from './layout/uiStore';
import { FullScreen } from './roster/RosterList';
import { Bar } from './ui';

const TIER_COLOR = ['', '#9aa7c7', '#6cc4ff', '#ffd84a', '#ff8a5c'];
const TIER_KO = ['', '쉬움', '보통', '어려움', '매우 어려움'];
const BY_ID = new Map(ACHV_LIST.map((d) => [d.id, d]));
type Filter = 'all' | 'done' | 'todo';
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: '전체' },
  { id: 'done', label: '달성' },
  { id: 'todo', label: '미달성' },
];

function Row({ d, date, prog }: { d: AchvDef; date?: string; prog: [number, number] | null }) {
  const done = !!date;
  const secret = !!d.hidden && !done;
  return (
    <div className={`flex min-h-12 items-center gap-2 px-2 py-1.5 ${done ? 'bg-panel' : 'bg-panel-2/70'}`} style={{ boxShadow: '0 0 0 1px #0f1420' }} data-testid="achv-row" data-done={done ? '1' : undefined}>
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center text-[20px] ${done ? '' : 'opacity-40 grayscale'}`} aria-hidden>
        {secret ? '❔' : d.icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1.5">
          <span className={`text-[14px] leading-snug ${done ? 'text-hi' : 'text-white/85'}`}>{secret ? '???' : d.title}</span>
          <span className="shrink-0 text-[13px]" style={{ color: TIER_COLOR[d.tier] }} title={TIER_KO[d.tier]} aria-label={`난이도 ${TIER_KO[d.tier]}`}>
            {'◆'.repeat(d.tier)}
          </span>
        </div>
        <div className="text-[13px] leading-snug text-white/60">{secret ? d.hidden : d.desc}</div>
        {!done && !secret && prog && (
          <div className="mt-1 flex items-center gap-2">
            <Bar ratio={prog[0] / prog[1]} color="#6cc4ff" h={6} className="min-w-0 flex-1" />
            <span className="shrink-0 text-[13px] text-white/60">
              {prog[0].toLocaleString()}/{prog[1].toLocaleString()}
            </span>
          </div>
        )}
      </div>
      {done && <span className="shrink-0 text-right text-[13px] leading-tight text-good">✓ {date}</span>}
    </div>
  );
}

/** 도전과제 화면: 초기 화면 메뉴와 게임 안 메뉴에서 연다 */
export default function Achievements() {
  const open = useAchv((s) => s.open);
  const setOpen = useAchv((s) => s.setOpen);
  if (!open) return null;
  return <Body onClose={() => setOpen(false)} />;
}

function Body({ onClose }: { onClose: () => void }) {
  const save = useAchv((s) => s.save);
  const onTitle = useUi((s) => s.screen === 'title');
  const hasSave = useUi((s) => s.hasSave);
  const [cat, setCat] = useState<AchvCat | 'all'>('all');
  const [filter, setFilter] = useState<Filter>('all');
  // 진행 막대는 지금 구단의 상태로 계산한다 (초기 화면에서 세이브가 없으면 누적 기록만)
  const core = useMemo(() => pickCore(useStore.getState()), []);
  const nDone = ACHV_LIST.filter((d) => save.done[d.id]).length;
  const total = ACHV_LIST.length;
  const rows = ACHV_LIST.filter((d) => (cat === 'all' || d.cat === cat) && (filter === 'all' || (filter === 'done') === !!save.done[d.id]));
  const chip = (on: boolean) => `flex min-h-10 cursor-pointer items-center gap-1 px-2.5 text-[13px] ${on ? 'bg-panel text-hi' : 'bg-panel-2/60 text-white/65'}`;
  const chipStyle = (on: boolean) => ({ boxShadow: on ? 'inset 0 2px 0 #ffd84a, 0 0 0 1px #0f1420' : '0 0 0 1px #0f1420' });
  return (
    <FullScreen title="도전과제" sub={<span className="text-[13px]">보상은 없습니다. 자랑만 남습니다.</span>} onClose={onClose} testid="achv" top>
      <div className="flex min-h-0 flex-1 flex-col gap-2 p-2 text-[13px]">
        <div className="shrink-0">
          <div className="mb-1 flex items-baseline justify-between">
            <span className="text-[14px] text-hi" data-testid="achv-count">
              달성 {nDone}/{total} · {Math.round((nDone / total) * 100)}%
            </span>
            <span className="text-white/50">숨김 {ACHV_LIST.filter((d) => d.hidden).length}개 포함</span>
          </div>
          <Bar ratio={nDone / total} color="#ffd84a" h={10} />
        </div>
        <div className="px-scroll flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto" data-testid="achv-scroll">
        <div className="flex shrink-0 flex-wrap gap-1" data-testid="achv-cats">
          <button className={chip(cat === 'all')} style={chipStyle(cat === 'all')} data-sfx="tab" data-testid="achv-cat-all" onClick={() => setCat('all')}>
            전체 <span className="text-white/50">{nDone}/{total}</span>
          </button>
          {ACHV_CATS.map((k) => {
            const of = ACHV_LIST.filter((d) => d.cat === k.id);
            return (
              <button key={k.id} className={chip(cat === k.id)} style={chipStyle(cat === k.id)} data-sfx="tab" data-testid={`achv-cat-${k.id}`} onClick={() => setCat(k.id)}>
                {k.name} <span className="text-white/50">{of.filter((d) => save.done[d.id]).length}/{of.length}</span>
              </button>
            );
          })}
        </div>
        <div className="flex shrink-0 gap-1" data-testid="achv-filter">
          {FILTERS.map((f) => (
            <button key={f.id} className={`${chip(filter === f.id)} flex-1 justify-center`} style={chipStyle(filter === f.id)} data-sfx="tab" data-testid={`achv-filter-${f.id}`} onClick={() => setFilter(f.id)}>
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex flex-col gap-1" data-testid="achv-list">
          {rows.length ? (
            rows.map((d) => <Row key={d.id} d={d} date={save.done[d.id]} prog={onTitle && !hasSave && d.on[0] !== 'total' ? null : achvProgress(d, core, save.totals)} />)
          ) : (
            <div className="flex flex-1 items-center justify-center py-10 text-white/50">{filter === 'done' ? '아직 달성한 도전과제가 없습니다' : '이 범주는 전부 달성했습니다'}</div>
          )}
        </div>
        </div>
      </div>
    </FullScreen>
  );
}

const SHOW_MS = 3600;

/** 달성 알림: 화면 위쪽의 한 줄. 여러 개가 한꺼번에 달성되면 "외 n개", 따로 달성되면 차례로 */
export function AchvToast() {
  const batch = useAchv((s) => s.queue[0]);
  const shift = useAchv((s) => s.shift);
  // 하이라이트 재생 중과 경기 결과 화면에서는 미루고, 결과 화면을 닫은 뒤에 띄운다
  const busy = useStore((s) => !!s.playback || !!s.summary);
  const onTitle = useUi((s) => s.screen === 'title');
  const hold = busy || onTitle;
  // 한 묶음은 한 번만 보여 준다: 떠 있는 동안 경기 진행 등으로 가려지면 그 묶음은 버린다
  // (전에는 타이머만 지우고 묶음을 남겨 둬서, 요약을 닫을 때마다 같은 알림이 처음부터 다시 떴다)
  useEffect(() => {
    if (!batch || hold) return;
    play('achievement');
    const id = window.setTimeout(shift, SHOW_MS);
    return () => {
      window.clearTimeout(id);
      if (useAchv.getState().queue[0] === batch) shift();
    };
  }, [batch, hold, shift]);
  if (!batch || hold) return null;
  const d = BY_ID.get(batch[0]);
  if (!d) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-[96px] z-[90] flex justify-center px-3 mob:top-[calc(env(safe-area-inset-top)+48px)]" data-testid="achv-toast" role="status">
      <div className="flex max-w-full items-center gap-2 bg-[#2a2140] px-3 py-1.5 text-[13px] text-white" style={{ boxShadow: '0 0 0 2px #ffd84a, 0 0 0 4px #0f1420, 0 6px 0 rgba(0,0,0,.3)' }}>
        <span className="shrink-0 text-[16px]" aria-hidden>
          {d.icon}
        </span>
        <span className="min-w-0">
          <span className="text-hi">도전과제:</span> {d.title}
          {batch.length > 1 && <span className="text-white/70"> 외 {batch.length - 1}개</span>}
        </span>
      </div>
    </div>
  );
}
