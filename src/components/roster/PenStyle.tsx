import { useEffect, useRef, useState } from 'react';
import { PEN_OVER_RISK, penStyleJob, type PenForecast } from '../../game/forecast';
import { bullpenLoad } from '../../game/fixes';
import { PEN_STYLES, type PenStyle } from '../../game/sim';
import { pickCore, useStore, useUserTeam } from '../../store';
import Help from '../Help';
import { idle } from '../useWinChance';

const PEN_N = 120; // 방침 하나당 표본 경기 수
const PEN_CHUNK = 12;
const DIFF_MS = 2000; // 방침을 바꾼 뒤 "전 → 후"를 보여주는 시간
export const PEN_STYLE_KO: Record<PenStyle, string> = { trust: '믿음', balance: '균형', swarm: '벌떼' };
const LOAD_TONE = { 여유: 'text-good', 보통: 'text-white/80', 과부하: 'text-bad' } as const;

type Forecasts = Partial<Record<PenStyle, PenForecast>>;

/** 세 방침의 예상 (계산 전에는 빈 칸). 로스터·오더·경기일이 바뀌면 다시 계산한다 */
function usePenForecasts(): Forecasts {
  const team = useUserTeam();
  const day = useStore((s) => s.day);
  const phase = useStore((s) => s.phase);
  const busy = useStore((s) => !!s.playback);
  const [out, setOut] = useState<Forecasts>({});
  useEffect(() => {
    if (busy) return;
    const core = pickCore(useStore.getState());
    const jobs = PEN_STYLES.map((st) => [st, penStyleJob(core, st, PEN_N)] as const);
    const acc: Forecasts = {};
    let at = 0;
    let cancel = () => {};
    const run = () => {
      const [st, job] = jobs[at];
      const r = job(PEN_CHUNK);
      if (r !== null) {
        acc[st] = r;
        at++;
        setOut({ ...acc });
      }
      if (at < jobs.length) cancel = idle(run);
    };
    setOut({});
    cancel = idle(run);
    return () => cancel();
  }, [team, day, phase, busy]);
  return out;
}

/** 불펜 상태 한 줄: 여유/보통/과부하 + 쉰 투수 n/m */
export function PenLoadLine({ className }: { className?: string }) {
  const team = useUserTeam();
  const load = bullpenLoad(team);
  return (
    <div className={`flex items-center gap-2 text-[13px] ${className ?? ''}`} data-testid="pen-load">
      <span className="text-white/60">불펜</span>
      <span className={LOAD_TONE[load.label]}>{load.label}</span>
      <span className="text-white/60">
        쉰 투수 {load.rested}/{load.arms}
      </span>
    </div>
  );
}

/** 투수 화면 맨 위: 방침 3칸 스위치 + 방침별 예상 승률 + 지금 방침의 예상 한 줄 + 불펜 상태 */
export default function PenStyleBar() {
  const style = useStore((s) => s.campaign.penStyle ?? 'balance');
  const setPenStyle = useStore((s) => s.setPenStyle);
  const busy = useStore((s) => !!s.playback);
  const fc = usePenForecasts();
  const [from, setFrom] = useState<PenStyle | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const pick = (st: PenStyle) => {
    if (st === style) return;
    setFrom(style);
    setPenStyle(st);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setFrom(null), DIFF_MS);
  };
  const cur = fc[style];
  const prev = from ? fc[from] : undefined;
  const num = (f: (v: PenForecast) => number) => (cur ? (prev ? `${f(prev).toFixed(1)} → ${f(cur).toFixed(1)}` : f(cur).toFixed(1)) : '—');

  return (
    <div className="pb-2" data-testid="pen-style">
      <div className="flex items-stretch gap-1.5">
        <div className="flex min-w-0 flex-1 gap-[2px] bg-edge p-[2px]">
          {PEN_STYLES.map((st) => {
            const f = fc[st];
            return (
              <button
                key={st}
                data-testid={`pen-style-${st}`}
                data-sfx="tab"
                aria-pressed={style === st}
                disabled={busy}
                className={`relative flex min-h-11 flex-1 cursor-pointer flex-col items-center justify-center leading-tight ${style === st ? 'bg-panel text-hi' : 'bg-panel-2/60 text-white/60'}`}
                style={style === st ? { boxShadow: 'inset 0 2px 0 #ffd84a' } : undefined}
                onClick={() => pick(st)}
              >
                <span className="text-[14px]">{PEN_STYLE_KO[st]}</span>
                <span className="text-[12px] text-white/70" data-testid={`pen-style-win-${st}`}>
                  {f ? `${Math.round(f.win * 100)}%` : '—'}
                </span>
                {f && f.over >= PEN_OVER_RISK && <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-bad" data-testid={`pen-style-risk-${st}`} aria-label="과부하 위험" />}
              </button>
            );
          })}
        </div>
        <Help topic="penStyle" className="self-center" />
      </div>
      <div className="flex flex-wrap items-center gap-x-2 px-0.5 pt-1.5 text-[13px] text-white/80" data-testid="pen-style-line">
        <span>예상 실점 {num((v) => v.ra)}</span>
        <span className="text-white/40">·</span>
        <span>선발 {num((v) => v.spIp)}이닝</span>
        <span className="text-white/40">·</span>
        <span>구원 {num((v) => v.relief)}명/경기</span>
      </div>
      <PenLoadLine className="px-0.5 pt-1" />
    </div>
  );
}
