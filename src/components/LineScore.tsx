import type { DayReport } from '../game/types';
import { useStore } from '../store';
import { postViewOf, useUi } from './layout/uiStore';

/**
 * 가을야구 천천히 보기 동안의 이닝별 점수표 (구장 밖 별도 블록). 재생 중인 장면까지의 점수로 칸을 채운다
 * (경기 종료 장면에서는 경기 결과의 이닝 기록 그대로). 천천히 보기가 아니거나 정규시즌이면 아무것도 그리지 않는다.
 */
/** 지금 재생 중인 경기에 점수표가 뜨는가 (가을야구 경기 + 천천히 보기) — 모바일 셸이 자리를 비워 둔다 */
export function useLineScoreOn(): boolean {
  const seed = useStore((s) => s.seed);
  const season = useStore((s) => s.season);
  const post = useStore((s) => !!s.playback?.report.post);
  const slow = useUi((s) => postViewOf(s, { seed, season }) === 'slow');
  return post && slow;
}

export default function LineScore({ report, step }: { report: DayReport; step: number }) {
  const seed = useStore((s) => s.seed);
  const season = useStore((s) => s.season);
  const teams = useStore((s) => s.teams);
  const userId = useStore((s) => s.userId);
  const slow = useUi((s) => postViewOf(s, { seed, season }) === 'slow');
  if (!report.post || !slow) return null;
  const res = report.result;
  const evs = res.events.slice(0, step + 1);
  const ev = evs[evs.length - 1];
  const done = ev?.type === 'final';
  const runs: [number[], number[]] = [[], []];
  let cur = 1;
  let half: 0 | 1 = 0;
  if (done) {
    runs[0] = [...res.line[0]];
    runs[1] = [...res.line[1]];
    cur = res.innings;
    half = 1;
  } else {
    let pa = 0;
    let ph = 0;
    for (const e of evs) {
      if (e.inning >= 1) {
        cur = e.inning;
        half = e.half;
        runs[0][e.inning - 1] = (runs[0][e.inning - 1] ?? 0) + Math.max(0, e.away - pa);
        runs[1][e.inning - 1] = (runs[1][e.inning - 1] ?? 0) + Math.max(0, e.home - ph);
      }
      pa = e.away;
      ph = e.home;
    }
  }
  const n = Math.max(9, cur, runs[0].length, runs[1].length);
  const away = teams.find((t) => t.id === res.awayId);
  const home = teams.find((t) => t.id === res.homeId);
  const total = (side: 0 | 1) => (done ? (side === 0 ? res.away : res.home) : side === 0 ? (ev?.away ?? 0) : (ev?.home ?? 0));
  // 그 이닝이 지났거나 진행 중이면 숫자(득점 없으면 0), 아직이면 빈칸. 끝난 경기의 9회말 공격이 없으면 x
  const cell = (side: 0 | 1, i: number): string => {
    const inn = i + 1;
    const v = runs[side][i];
    if (done) return v === undefined ? (side === 1 && inn <= res.innings ? 'x' : '') : String(v);
    const reached = inn < cur || (inn === cur && (side === 0 || half === 1));
    return reached ? String(v ?? 0) : '';
  };
  const row = (side: 0 | 1) => {
    const t = side === 0 ? away : home;
    const mine = t?.id === userId;
    return (
      <tr key={side}>
        <td className="pr-1 text-left" style={{ color: mine ? '#ffffff' : '#d4ccc2' }}>{t?.id}</td>
        {Array.from({ length: n }, (_, i) => {
          const c = cell(side, i);
          const live = !done && i + 1 === cur && (side === 0 ? half === 0 : half === 1);
          return (
            <td key={i} style={{ color: c && c !== '0' && c !== 'x' ? '#ffd84a' : '#8f9bbf', background: live ? 'rgba(127,211,255,.18)' : undefined }}>
              {c}
            </td>
          );
        })}
        <td className="pl-1 font-pixel-lg" style={{ color: '#ffd84a' }}>{total(side)}</td>
      </tr>
    );
  };
  return (
    <div className="w-full bg-ink px-1.5 py-1" style={{ boxShadow: '0 0 0 1px #3a3632' }} data-testid="line-board">
      <table className="w-full border-collapse text-center font-pixel text-[13px] leading-[1.35]">
        <thead>
          <tr className="text-[11px]" style={{ color: '#6b7694' }}>
            <td />
            {Array.from({ length: n }, (_, i) => (
              <td key={i}>{i + 1}</td>
            ))}
            <td className="pl-1">R</td>
          </tr>
        </thead>
        <tbody>{[row(0), row(1)]}</tbody>
      </table>
    </div>
  );
}

