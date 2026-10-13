import type { CSSProperties } from 'react';
import type { PosKey, PosRow } from '../../game/analysis';
import { useRankFlash } from './rosterUi';

// 다이아몬드 위 칸의 자리 (가운데 x%, 위쪽 y%)
const SPOT: Record<string, [number, number]> = {
  CF: [50, 1], LF: [17, 11], RF: [83, 11], SS: [33, 33], '2B': [67, 33], '3B': [17, 55], '1B': [83, 55], C: [50, 78], DH: [17, 79],
};
const PITCH: PosKey[] = ['SP', 'RP', 'CP'];

/** 순위 → 색: 1~2위 초록, 3~5위 중립, 6위 이하 빨강 */
export function rankTone(r: Pick<PosRow, 'rank' | 'of'>): 'good' | 'mid' | 'bad' {
  if (r.rank <= 2) return 'good';
  return r.rank >= r.of - 2 ? 'bad' : 'mid';
}
const TONE_TEXT = { good: 'text-good', mid: 'text-white/80', bad: 'text-bad' } as const;
const TONE_BG = { good: '#6ee07a', mid: '#8a95b5', bad: '#ff6b6b' } as const;

/** "8위 → 4위 ▲" (개막 순위와 같으면 "4위") */
export function RankText({ row, className = '' }: { row: PosRow; className?: string }) {
  const moved = row.rank0 !== undefined && row.rank0 !== row.rank;
  return (
    <span className={`whitespace-nowrap ${TONE_TEXT[rankTone(row)]} ${className}`}>
      {moved && <span className="text-white/45">{row.rank0}위 → </span>}
      {row.rank}위
      {moved && <span className={row.rank < row.rank0! ? 'text-good' : 'text-bad'}> {row.rank < row.rank0! ? '▲' : '▼'}</span>}
    </span>
  );
}

function Cell({ row, sel, flash, onPick, style, className = '' }: { row: PosRow; sel: boolean; flash: boolean; onPick: (k: PosKey) => void; style?: CSSProperties; className?: string }) {
  const tone = rankTone(row);
  const name = row.kind === 'B' ? (row.players[0]?.name ?? '빈 자리') : row.key === 'CP' ? (row.players[0]?.name ?? '없음') : `${row.players.length}명 평균`;
  const edge = flash ? '#6ee07a' : row.weak ? '#ff6b6b' : sel ? '#ffd84a' : row.strong ? '#6ee07a' : '#0f1420';
  return (
    <button
      data-pos={row.key}
      data-weak={row.weak || undefined}
      data-flash={flash || undefined}
      onClick={() => onPick(row.key)}
      className={`flex cursor-pointer flex-col px-1 py-0.5 text-left leading-tight transition-colors ${flash ? 'bg-good/40' : sel ? 'bg-panel-2' : 'bg-panel/95'} ${className}`}
      style={{ boxShadow: `0 0 0 ${row.weak || flash ? 3 : sel || row.strong ? 2 : 1}px ${edge}`, ...style }}
    >
      <span className="flex items-baseline justify-between gap-1 text-[10px] mob:text-[11px]">
        <span className="text-sky">{row.label}</span>
        <RankText row={row} />
      </span>
      <span className="truncate text-[12px] text-white mob:text-[13px]">{name}</span>
      <span className="flex items-baseline justify-between gap-1 text-[10px] mob:text-[11px]">
        <span className={TONE_TEXT[tone]}>
          {row.score.toFixed(0)} <span className="text-white/45">평균 {row.diff >= 0 ? '+' : '−'}{Math.abs(row.diff).toFixed(0)}</span>
        </span>
        {row.weak ? <span className="bg-bad px-1 text-ink">약점</span> : row.strong ? <span className="bg-good px-1 text-ink">강점</span> : null}
      </span>
    </button>
  );
}

/** 팀 진단 다이아몬드: 수비 9칸 + 아래에 선발·불펜·마무리 3칸 */
export default function Diamond({ rows, sel, onPick }: { rows: PosRow[]; sel: PosKey | null; onPick: (k: PosKey) => void }) {
  const flash = useRankFlash(rows);
  const by = new Map(rows.map((r) => [r.key, r]));
  return (
    <div className="flex w-full flex-col gap-1.5" data-testid="diamond">
      <div className="relative w-full overflow-hidden" style={{ aspectRatio: '1 / 0.92', background: '#2c6a3c', boxShadow: 'inset 0 0 0 2px #0f1420' }}>
        {/* 내야 흙 + 베이스 라인 */}
        <div className="absolute left-1/2 top-[30%] aspect-square w-[52%] -translate-x-1/2 rotate-45" style={{ background: '#a8743f', boxShadow: '0 0 0 2px #e9e3d2' }} />
        <div className="absolute left-1/2 top-[40%] aspect-square w-[32%] -translate-x-1/2 rotate-45" style={{ background: '#2c6a3c' }} />
        {rows
          .filter((r) => SPOT[r.key])
          .map((r) => (
            <Cell
              key={r.key}
              row={r}
              sel={sel === r.key}
              flash={flash.includes(r.key)}
              onPick={onPick}
              className="absolute w-[31%]"
              style={{ left: `${SPOT[r.key][0]}%`, top: `${SPOT[r.key][1]}%`, transform: 'translateX(-50%)' }}
            />
          ))}
      </div>
      <div className="grid grid-cols-3 gap-1.5 px-[3px] pb-[3px]">
        {PITCH.map((k) => {
          const r = by.get(k);
          return r ? <Cell key={k} row={r} sel={sel === k} flash={flash.includes(k)} onPick={onPick} /> : null;
        })}
      </div>
    </div>
  );
}

/** 한 줄 요약의 재료: 약점 2곳과 개막 이후 순위가 오른 자리 */
export function diagSummary(rows: PosRow[]): { weak: PosRow[]; strong: PosRow[]; up: PosRow[] } {
  return {
    weak: rows.filter((r) => r.weak).sort((a, b) => b.rank - a.rank),
    strong: rows.filter((r) => r.strong).sort((a, b) => a.rank - b.rank),
    up: rows.filter((r) => r.rank0 !== undefined && r.rank < r.rank0).sort((a, b) => b.rank0! - b.rank - (a.rank0! - a.rank)),
  };
}

// 미니맵의 점 자리 (x%, y%)
const DOT: Record<string, [number, number]> = {
  CF: [50, 8], LF: [20, 22], RF: [80, 22], SS: [36, 44], '2B': [64, 44], '3B': [22, 64], '1B': [78, 64], C: [50, 86], DH: [8, 86],
};

/** 선수단 탭 상단의 작은 다이아몬드. 탭하면 프런트 오피스(진단)가 전체 화면으로 열린다 */
export function MiniDiamond({ rows, onOpen }: { rows: PosRow[]; onOpen: () => void }) {
  const flash = useRankFlash(rows);
  const { weak, strong, up } = diagSummary(rows);
  const dot = (r: PosRow, style: CSSProperties) => {
    const f = flash.includes(r.key);
    return (
      <span
        key={r.key}
        data-pos={r.key}
        data-flash={f || undefined}
        className={`absolute flex items-center justify-center text-[9px] leading-none text-ink ${f ? 'anim-blink' : ''}`}
        style={{ width: 13, height: 13, background: f ? '#6ee07a' : TONE_BG[rankTone(r)], boxShadow: `0 0 0 ${r.weak ? 2 : 1}px ${r.weak ? '#fff' : '#0f1420'}`, ...style }}
      >
        {r.rank}
      </span>
    );
  };
  return (
    <button className="mx-1.5 mt-1 flex shrink-0 cursor-pointer items-stretch gap-1.5 bg-ink/60 p-1 text-left hover:bg-ink/80" data-testid="mini-diamond" onClick={onOpen} title="팀 진단 크게 보기">
      <span className="relative block shrink-0" style={{ width: 84, height: 62, background: '#2c6a3c', boxShadow: 'inset 0 0 0 1px #0f1420' }}>
        {rows.filter((r) => DOT[r.key]).map((r) => dot(r, { left: `calc(${DOT[r.key][0]}% - 6px)`, top: `calc(${DOT[r.key][1]}% - 6px)` }))}
      </span>
      <span className="flex shrink-0 flex-col justify-between py-px">
        {PITCH.map((k) => {
          const r = rows.find((x) => x.key === k);
          return r ? (
            <span key={k} className="flex items-center gap-1 text-[9px] leading-none text-white/55">
              {dot(r, { position: 'static' })}
              {r.label.slice(0, 2)}
            </span>
          ) : null;
        })}
      </span>
      <span className="flex min-w-0 flex-1 flex-col justify-center gap-0.5 text-[10px] leading-tight mob:text-[11px]">
        <span className="truncate text-bad">
          <span className="text-white/55">약점 </span>
          {weak.length ? weak.map((r) => `${r.label} ${r.rank}위`).join(' · ') : '없음'}
        </span>
        <span className="truncate text-good">
          <span className="text-white/55">강점 </span>
          {strong.length ? strong.map((r) => `${r.label} ${r.rank}위`).join(' · ') : '없음'}
        </span>
        {up.length > 0 && (
          <span className="truncate text-good">
            <span className="text-white/55">보강 </span>
            {up.slice(0, 2).map((r) => `${r.label} ${r.rank0}→${r.rank}위`).join(' · ')}
          </span>
        )}
      </span>
      <span className="shrink-0 self-center bg-panel-2 px-1.5 py-1 text-[10px] text-hi mob:text-[11px]">크게 보기 ⤢</span>
    </button>
  );
}
