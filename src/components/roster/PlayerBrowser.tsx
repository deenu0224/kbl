import { useMemo, useState, type ReactNode } from 'react';
import type { Player } from '../../game/types';
import { PITCH_KEYS, fitsKey, type PosKey, type PosRow } from '../../game/analysis';
import { fmtMoney } from '../../game/format';
import { ScoutBadge } from '../PlayerCard';
import { POS_KO, ratingColor } from '../ui';
import PlayerTable, { type TableMode } from './PlayerTable';

type Kind = 'all' | 'B' | 'P';
type SortId = 'ovr' | 'salary' | 'age' | 'scout';
const SORT_KO: Record<SortId, string> = { ovr: 'OVR', salary: '연봉', age: '나이', scout: '등급' };
const SCOUT_ORDER: Record<string, number> = { A: 4, B: 3, C: 2, D: 1 };

function Chip({ on, onClick, children, tone = 'hi', testid }: { on: boolean; onClick: () => void; children: ReactNode; tone?: 'hi' | 'bad'; testid?: string }) {
  return (
    <button
      data-sfx="tab"
      data-testid={testid}
      onClick={onClick}
      className={`shrink-0 cursor-pointer whitespace-nowrap px-1.5 py-0.5 text-[10px] mob:min-h-9 mob:px-2.5 mob:text-[13px] ${on ? (tone === 'bad' ? 'bg-bad text-ink' : 'bg-hi text-ink') : tone === 'bad' ? 'bg-ink text-bad' : 'bg-ink text-white/60'}`}
    >
      {children}
    </button>
  );
}

/**
 * 선수 목록의 기본 모습: 한 줄 = 포지션·이름·나이·OVR·연봉(드래프트는 스카우트 등급) + 줄 버튼. 줄을 누르면 카드.
 * 필터는 한 줄 칩(전체/타자/투수/우리 약점만), 정렬은 OVR 내림차순에 작은 칩 하나. 상세가 필요할 때만 [표로 보기].
 */
export default function PlayerBrowser({
  mode,
  players,
  rows,
  sel,
  onPick,
  initPos = null,
  rowAction,
  band,
  pinned,
  note,
}: {
  mode: TableMode;
  players: Player[];
  rows: PosRow[];
  sel?: string | null;
  onPick: (p: Player) => void;
  initPos?: PosKey | 'weak' | null;
  rowAction?: (p: Player) => ReactNode;
  band?: (p: Player) => { color: string; bg: string } | undefined;
  pinned?: string[]; // OVR 정렬일 때 맨 위에 올릴 선수 (스카우트 명단)
  note?: (p: Player) => ReactNode; // 이름 옆 작은 표시
}) {
  // 특정 포지션으로 걸러서 열렸으면 그 필터를 가진 표로 시작한다
  const [table, setTable] = useState(!!initPos && initPos !== 'weak');
  const [kind, setKind] = useState<Kind>(initPos && initPos !== 'weak' ? (PITCH_KEYS.includes(initPos as 'SP') ? 'P' : 'B') : 'all');
  const [weak, setWeak] = useState(initPos === 'weak');
  const sorts: SortId[] = mode === 'draft' ? ['ovr', 'scout', 'age'] : ['ovr', 'salary', 'age'];
  const [sort, setSort] = useState<SortId>('ovr');
  const draft = mode === 'draft';
  const needKeys = useMemo(() => (draft ? rows.filter((r) => r.thin && r.key !== 'DH') : rows.filter((r) => r.weak)).map((r) => r.key), [rows, draft]);
  const list = useMemo(() => {
    const pin = (p: Player) => (sort === 'ovr' && pinned?.includes(p.id) ? pinned.indexOf(p.id) - 99 : 0);
    const val = (p: Player) => (sort === 'salary' ? -p.salary : sort === 'age' ? p.age : sort === 'scout' ? -(SCOUT_ORDER[p.scout ?? ''] ?? 0) : -p.ovr);
    return players
      .filter((p) => (kind === 'all' || p.kind === kind) && (!weak || needKeys.some((k) => fitsKey(p, k))))
      .sort((a, b) => pin(a) - pin(b) || val(a) - val(b) || b.ovr - a.ovr);
  }, [players, kind, weak, needKeys, sort, pinned]);

  const toggle = (
    <button data-sfx="tab" data-testid="view-toggle" onClick={() => setTable((v) => !v)} className="shrink-0 cursor-pointer whitespace-nowrap bg-ink px-1.5 py-0.5 text-[10px] text-sky mob:min-h-9 mob:px-2.5 mob:text-[13px]">
      {table ? '목록으로' : '표로 보기'}
    </button>
  );

  if (table) {
    return (
      <div className="flex min-h-0 flex-1 flex-col" data-testid={`browser-${mode}`} data-view="table">
        <div className="flex shrink-0 items-center justify-between gap-2 px-1.5 pt-1.5">
          <span className="min-w-0 truncate text-[10px] text-white/50 mob:text-[13px]">열 머리를 누르면 정렬</span>
          {toggle}
        </div>
        <PlayerTable mode={mode} players={players} rows={rows} sel={sel} onPick={onPick} initPos={initPos} rowAction={rowAction} band={band} />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid={`browser-${mode}`} data-view="list">
      <div className="flex shrink-0 items-center gap-1 px-1.5 py-1.5">
        {/* 필터 칩은 한 줄 (가로 스크롤), [표로 보기]는 오른쪽에 고정 */}
        <div className="no-scrollbar flex min-w-0 flex-1 items-center gap-1 overflow-x-auto" data-testid="list-filters">
        {([['all', '전체'], ['B', '타자'], ['P', '투수']] as const).map(([k, label]) => (
          <Chip key={k} on={kind === k} onClick={() => setKind(k)} testid={`lkind-${k}`}>
            {label}
          </Chip>
        ))}
        {mode !== 'roster' && (
          <Chip on={weak} tone="bad" onClick={() => setWeak((v) => !v)} testid="lneed-only">
            {draft ? '빈 뎁스만' : '우리 약점만'}
          </Chip>
        )}
        <span className="mx-0.5 h-4 w-px shrink-0 bg-white/20" />
        <Chip on={false} onClick={() => setSort(sorts[(sorts.indexOf(sort) + 1) % sorts.length])} testid="list-sort">
          {SORT_KO[sort]}순 ⇅
        </Chip>
        </div>
        {toggle}
      </div>
      <div className="px-scroll min-h-0 flex-1 overflow-y-auto px-1.5 pb-1.5" data-testid="player-list">
        {list.map((p) => {
          const bd = band?.(p);
          return (
            <div
              key={p.id}
              data-pid={p.id}
              data-band={bd ? '' : undefined}
              className={`mb-[3px] flex min-h-8 items-center gap-1 px-1.5 text-[12px] mob:min-h-12 mob:text-[14px] ${bd ? '' : sel === p.id ? 'bg-hi/20' : 'bg-ink/40'}`}
              style={bd ? { background: bd.bg, boxShadow: `inset 4px 0 0 ${bd.color}` } : undefined}
            >
              <button type="button" className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 self-stretch text-left" onClick={() => onPick(p)}>
                <span className="w-9 shrink-0 whitespace-nowrap text-[11px] text-sky mob:w-10 mob:text-[13px]">{POS_KO[p.pos]}</span>
                <span className={`min-w-0 flex-1 truncate ${p.injury > 0 ? 'text-bad' : 'text-white'}`}>
                  {p.name}
                  {mode === 'roster' && p.farm && <span className="ml-1 text-[10px] text-sky mob:text-[13px]">2군</span>}
                  {note?.(p)}
                </span>
                <span className="shrink-0 whitespace-nowrap text-[11px] text-white/60 mob:text-[13px]">{p.age}세</span>
                <span className="w-6 shrink-0 text-right font-pixel-lg text-[13px] mob:text-[15px]" style={{ color: ratingColor(p.ovr) }} aria-label={`OVR ${p.ovr}`}>
                  {p.ovr}
                </span>
                {draft ? (
                  <ScoutBadge grade={p.scout} size={20} />
                ) : (
                  <span className="w-12 shrink-0 whitespace-nowrap text-right text-[11px] text-white/80 mob:w-[50px] mob:text-[13px]">{fmtMoney(p.salary)}</span>
                )}
              </button>
              {rowAction && <span className="flex shrink-0 gap-1">{rowAction(p)}</span>}
            </div>
          );
        })}
        {!list.length && <div className="p-3 text-center text-[11px] text-white/40 mob:text-[13px]">조건에 맞는 선수가 없습니다</div>}
      </div>
    </div>
  );
}
