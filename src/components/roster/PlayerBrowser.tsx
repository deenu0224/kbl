import { useMemo, useState, type ReactNode } from 'react';
import type { Player } from '../../game/types';
import { PITCH_KEYS, fitsKey, type PosKey, type PosRow } from '../../game/analysis';
import { fmtMoney } from '../../game/format';
import { ScoutBadge } from '../PlayerCard';
import { POS_KO, ratingColor } from '../ui';
import { play } from '../../audio/sfx';
import { useIsMobile } from '../layout/useLayout';
import PlayerTable, { type TableMode } from './PlayerTable';

type Kind = 'all' | 'B' | 'P';
type SortId = 'ovr' | 'salary' | 'age' | 'scout' | 'extra';
const SORT_KO: Record<Exclude<SortId, 'extra'>, string> = { ovr: '오버롤', salary: '연봉', age: '나이', scout: '등급' };
const BAT_POS = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH'] as const;
const PIT_POS = ['SP', 'RP', 'CP'] as const;
const SCOUT_ORDER: Record<string, number> = { A: 4, B: 3, C: 2, D: 1 };

function Chip({ on, onClick, children, tone = 'hi', testid }: { on: boolean; onClick: () => void; children: ReactNode; tone?: 'hi' | 'bad'; testid?: string }) {
  return (
    <button
      data-sfx="tab"
      data-testid={testid}
      onClick={onClick}
      className={`shrink-0 cursor-pointer whitespace-nowrap px-1.5 py-0.5 text-[11px] mob:min-h-9 mob:px-2.5 mob:text-[13px] ${on ? (tone === 'bad' ? 'bg-bad text-ink' : 'bg-hi text-ink') : tone === 'bad' ? 'bg-ink text-bad' : 'bg-ink text-white/60'}`}
    >
      {children}
    </button>
  );
}

/** 칩 모양 드롭다운: 보이는 것은 칩 글자, 그 위에 투명한 진짜 select (전역 16px: iOS 는 16px 미만 입력칸을 누르면 화면을 확대한다) */
function PickChip({ label, value, on, onChange, testid, aria, children }: { label: string; value: string; on: boolean; onChange: (v: string) => void; testid: string; aria: string; children: ReactNode }) {
  return (
    <label className={`relative inline-flex shrink-0 cursor-pointer items-center gap-1 whitespace-nowrap px-1.5 py-0.5 text-[11px] mob:min-h-9 mob:px-2.5 mob:text-[13px] ${on ? 'bg-hi text-ink' : 'bg-ink text-white/80'}`}>
      {label} <span aria-hidden>▾</span>
      <select data-testid={testid} aria-label={aria} value={value} onChange={(e) => (play('tab'), onChange(e.target.value))} className="absolute inset-0 cursor-pointer opacity-0">
        {children}
      </select>
    </label>
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
  badge,
  chips,
  extraSort,
  initExtra = false,
  weakChips = false,
  rowExtra,
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
  badge?: (p: Player) => ReactNode; // 이름 바로 옆의 작은 칩 (이름이 먼저 줄어든다 — 칩은 잘리지 않는다)
  chips?: ReactNode; // 목록의 전체/타자/투수 칩 대신 쓸 필터 칩 (명단: 전체/1군/2군/타자/투수)
  extraSort?: { label: string; val: (p: Player) => number }; // 정렬 순환에 넣는 정렬 하나 (작을수록 위. 우리 선수단: 방출 후보순)
  initExtra?: boolean; // 그 정렬로 시작한다
  weakChips?: boolean; // "우리 약점만" 대신 약점 포지션마다 칩 하나 (이적 창구 영입 시장)
  rowExtra?: (p: Player) => ReactNode; // 줄 바로 아래에 펼치는 내용 (꽉 찼을 때 내보낼 후보)
}) {
  // 특정 포지션으로 열려도 목록으로 시작한다 (그 경로만 표로 열려 같은 창구가 두 모양이었다) — 포지션 칩을 켠 채로
  const [table, setTable] = useState(false);
  const [kind, setKind] = useState<Kind>(initPos && initPos !== 'weak' ? (PITCH_KEYS.includes(initPos as 'SP') ? 'P' : 'B') : 'all');
  const [weak, setWeak] = useState(initPos === 'weak' && !weakChips);
  const [lvl, setLvl] = useState<'farm' | null>(null); // 우리 선수단: 2군만 (2군이 OVR순으로 맨 아래에 섞여 있었다)
  const [posF, setPosF] = useState<string | null>(initPos && initPos !== 'weak' ? initPos : null); // 포지션 필터 (타자·투수를 고른 뒤 둘째 줄에서)
  const [weakKey, setWeakKey] = useState<string | null>(() => (weakChips && initPos === 'weak' ? (rows.find((r) => r.weak && players.some((p) => fitsKey(p, r.key)))?.key ?? null) : null)); // 약점 포지션 칩 하나로 거르기 (weakChips)
  const sorts: SortId[] = [...(mode === 'draft' ? (['ovr', 'scout', 'age'] as const) : (['ovr', 'salary', 'age'] as const)), ...(extraSort ? (['extra'] as const) : [])];
  const [sort, setSort] = useState<SortId>(initExtra && extraSort ? 'extra' : 'ovr');
  const draft = mode === 'draft';
  const two = useIsMobile() && mode === 'roster' && !!rowAction;
  const needKeys = useMemo(() => (draft ? rows.filter((r) => r.thin && r.key !== 'DH') : rows.filter((r) => r.weak)).map((r) => r.key), [rows, draft]);
  const list = useMemo(() => {
    const pin = (p: Player) => (sort === 'ovr' && pinned?.includes(p.id) ? pinned.indexOf(p.id) - 99 : 0);
    const val = (p: Player) => (sort === 'extra' && extraSort ? extraSort.val(p) : sort === 'salary' ? -p.salary : sort === 'age' ? p.age : sort === 'scout' ? -(SCOUT_ORDER[p.scout ?? ''] ?? 0) : -p.ovr);
    return players
      .filter((p) => (kind === 'all' || p.kind === kind) && (!lvl || !!p.farm) && (!posF || kind === 'all' || p.pos === posF) && (!weak || needKeys.some((k) => fitsKey(p, k))) && (!weakKey || fitsKey(p, weakKey as PosKey)))
      .sort((a, b) => pin(a) - pin(b) || val(a) - val(b) || b.ovr - a.ovr);
  }, [players, kind, lvl, posF, weak, weakKey, needKeys, sort, pinned, extraSort]);
  const nFarm = mode === 'roster' ? players.filter((p) => p.farm).length : 0;

  // 목록에서 거르던 조건을 표로 넘긴다 (약점 칩 · 포지션 · 우리 약점만). 없으면 처음 열린 조건
  const carry: PosKey | 'weak' | null = (weakKey as PosKey | null) ?? (posF as PosKey | null) ?? (weak ? 'weak' : null) ?? initPos;
  const toggle = (
    <button data-sfx="tab" data-testid="view-toggle" onClick={() => setTable((v) => !v)} className="shrink-0 cursor-pointer whitespace-nowrap bg-ink px-1.5 py-0.5 text-[11px] text-sky mob:min-h-9 mob:px-2.5 mob:text-[13px]">
      {table ? '목록으로' : '표로 보기'}
    </button>
  );

  // 타자·투수·포지션을 드롭다운 하나로 (칩이면 타자/투수 칩 + 포지션 칩 줄까지 두세 줄을 먹었다). 0명인 포지션은 빼고 인원을 붙인다
  const nPos = (k: string) => players.filter((p) => p.pos === k).length;
  const posOpts = (keys: readonly string[]) => keys.filter((k) => k === posF || nPos(k) > 0).map((k) => <option key={k} value={k}>{`${POS_KO[k as keyof typeof POS_KO]} ${nPos(k)}`}</option>);
  const posValue = posF ?? kind;
  const nKind = (k: Kind) => (k === 'all' ? players.length : players.filter((p) => p.kind === k).length);
  const posLabel = posF ? `${POS_KO[posF as keyof typeof POS_KO]} ${nPos(posF)}` : `${{ all: '전체', B: '타자', P: '투수' }[kind]} ${nKind(kind)}`;
  const posSelect = (
    <PickChip
      label={posLabel}
      value={posValue}
      on={posValue !== 'all'}
      testid="pos-select"
      aria="포지션"
      onChange={(v) => {
        setWeakKey(null);
        if (v === 'all' || v === 'B' || v === 'P') return void (setKind(v), setPosF(null));
        setKind((PIT_POS as readonly string[]).includes(v) ? 'P' : 'B');
        setPosF(v);
      }}
    >
      <option value="all">{`전체 ${players.length}`}</option>
      <optgroup label="타자">
        <option value="B">{`타자 전체 ${nKind('B')}`}</option>
        {posOpts(BAT_POS)}
      </optgroup>
      <optgroup label="투수">
        <option value="P">{`투수 전체 ${nKind('P')}`}</option>
        {posOpts(PIT_POS)}
      </optgroup>
    </PickChip>
  );
  // 정렬도 드롭다운 (누를 때마다 다음 정렬로 넘기면 무슨 정렬이 있는지 몰랐다)
  const sortName = (id: SortId) => (id === 'extra' && extraSort ? extraSort.label : `${SORT_KO[id as Exclude<SortId, 'extra'>]}순`);
  const sortSelect = (
    <PickChip label={sortName(sort)} value={sort} on={false} testid="list-sort" aria="정렬" onChange={(v) => setSort(v as SortId)}>
      {sorts.map((id) => (
        <option key={id} value={id}>
          {sortName(id)}
        </option>
      ))}
    </PickChip>
  );

  if (table) {
    return (
      <div className="flex min-h-0 flex-1 flex-col" data-testid={`browser-${mode}`} data-view="table">
        <div className="flex shrink-0 items-center justify-between gap-2 px-1.5 pt-1.5">
          <span className="min-w-0 flex-1" />
          {toggle}
        </div>
        <PlayerTable mode={mode} players={players} rows={rows} sel={sel} onPick={onPick} initPos={carry} rowAction={rowAction} band={band} />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid={`browser-${mode}`} data-view="list">
      <div className="flex shrink-0 items-start gap-1 px-1.5 py-1.5">
        {/* 필터 칩은 넘치면 다음 줄로 (가로 스크롤이면 360폭에서 [타자]·[투수]가 정렬 칩 밑에 숨었다), 정렬·[표로 보기]는 오른쪽에 고정 */}
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1" data-testid="list-filters">
        {/* 드롭다운을 맨 앞에: 좁으면 약점 칩이 다음 줄로 간다 (주 필터가 밀려나지 않게) */}
        {chips ?? posSelect}
        {mode !== 'roster' && weakChips
          ? // 약점 포지션을 바로 칩으로: 한 번에 그 자리 FA 만
            // 그 자리 FA가 없는 약점은 칩을 두지 않는다 (누르면 빈 목록뿐이었다)
            needKeys.filter((k) => players.some((p) => fitsKey(p, k as PosKey))).slice(0, 3).map((k) => (
              <Chip key={k} on={weakKey === k} tone="bad" onClick={() => (setWeakKey(weakKey === k ? null : k), setKind('all'), setPosF(null))} testid={`lweak-${k}`}>
                {POS_KO[k] ?? rows.find((r) => r.key === k)?.label ?? k}!
              </Chip>
            ))
          : mode !== 'roster' && (
              <Chip on={weak} tone="bad" onClick={() => setWeak((v) => !v)} testid="lneed-only">
                {draft ? '빈 자리만' : '우리 약점만'}
              </Chip>
            )}
        {/* 2군만 하나 (1군 칩까지 두면 폰에서 칩 줄 밖으로 밀려 안 보였다) */}
        {!chips && nFarm > 0 && (
          <Chip on={lvl === 'farm'} onClick={() => setLvl(lvl === 'farm' ? null : 'farm')} testid="llvl-farm">
            2군<span className="pl-1 opacity-60">{nFarm}</span>
          </Chip>
        )}
        </div>
        {/* 정렬은 스크롤 밖에 고정: 칩이 많으면 [표로 보기]에 가려 지금 정렬이 안 보였다 */}
        {sortSelect}
        {toggle}
      </div>
      <div className="px-scroll min-h-0 flex-1 overflow-y-auto px-1.5 pb-1.5" data-testid="player-list">
        {list.map((p) => {
          const bd = band?.(p);
          const row = (
            <div
              key={p.id}
              data-pid={p.id}
              data-band={bd ? '' : undefined}
              className={`mb-[3px] flex min-h-8 items-center gap-1 px-1.5 text-[12px] mob:min-h-12 mob:text-[14px] ${bd ? '' : sel === p.id ? 'bg-hi/20' : 'bg-ink/40'}`}
              style={bd ? { background: bd.bg, boxShadow: `inset 4px 0 0 ${bd.color}` } : undefined}
            >
              <button type="button" className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 self-stretch text-left" onClick={() => onPick(p)}>
                <span className="w-9 shrink-0 whitespace-nowrap text-[11px] text-sky mob:w-10 mob:text-[13px]">{POS_KO[p.pos]}</span>
                {two ? (
                  // 좁은 화면의 우리 선수단: 줄 버튼이 많아 이름이 잘리므로 두 줄로 (이름 / 역할 · 연봉)
                  <span className="min-w-0 flex-1 leading-tight">
                    <span className="flex min-w-0 items-center gap-1">
                      <span className={`min-w-0 truncate ${p.injury > 0 ? 'text-bad' : 'text-white'}`}>{p.name}</span>
                      {badge?.(p)}
                    </span>
                    <span className="block truncate text-[13px] text-white/55">
                      {p.farm && <span className="text-sky">2군</span>}
                      {note?.(p)}
                      <span className="pl-1.5">{fmtMoney(p.salary)}</span>
                    </span>
                  </span>
                ) : (
                  <>
                <span className={`min-w-0 flex-1 truncate ${p.injury > 0 ? 'text-bad' : 'text-white'}`}>
                  {p.name}
                  {mode === 'roster' && p.farm && <span className="ml-1 text-[11px] text-sky mob:text-[13px]">2군</span>}
                  {note?.(p)}
                </span>
                {badge?.(p)}
                {/* 폰: 나이는 나이순일 때만 (이름이 한 글자로 잘렸다 — 나이는 카드에) */}
                <span className={`shrink-0 whitespace-nowrap text-[11px] text-white/60 mob:text-[13px] ${sort === 'age' ? '' : 'mob:hidden'}`}>{p.age}세</span>
                  </>
                )}
                <span className="w-6 shrink-0 text-right font-pixel-lg text-[14px]" style={{ color: ratingColor(p.ovr) }} aria-label={`오버롤 ${p.ovr}`}>
                  {p.ovr}
                </span>
                {draft ? (
                  <ScoutBadge grade={p.scout} size={20} />
                ) : two ? null : (
                  <span className="w-12 shrink-0 whitespace-nowrap text-right text-[11px] text-white/80 mob:w-[50px] mob:text-[13px]">{fmtMoney(p.salary)}</span>
                )}
              </button>
              {rowAction && <span className="flex shrink-0 gap-1">{rowAction(p)}</span>}
            </div>
          );
          const extra = rowExtra?.(p);
          return extra ? (
            <div key={p.id}>
              {row}
              {extra}
            </div>
          ) : (
            row
          );
        })}
        {!list.length && <div className="p-3 text-center text-[11px] text-white/40 mob:text-[13px]">조건에 맞는 선수가 없습니다</div>}
      </div>
    </div>
  );
}
