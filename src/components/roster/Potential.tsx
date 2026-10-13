import { useMemo, useState } from 'react';
import type { Player } from '../../game/types';
import { DEVELOP_BANDS, growthInfo, scoutInfo } from '../../game/analysis';
import { useCore } from '../../store';
import { useIsMobile } from '../layout/useLayout';
import { ratingColor } from '../ui';
import { fmtDelta } from './labels';

const pct = (v: number) => `${Math.round(v * 100)}%`;

/**
 * 잠재력 = 성장 상한 OVR. 막대(현재 → 잠재력)와 실제 성장 규칙을 한 줄씩 보여 준다.
 * 숫자는 전부 analysis.ts growthInfo (season.ts · economy.ts 의 상수) 에서 온다.
 */
export default function Potential({ player: p, prospect = false }: { player: Player; prospect?: boolean }) {
  const core = useCore();
  const mobile = useIsMobile();
  const [open, setOpen] = useState(mobile);
  const g = useMemo(() => growthInfo(core, p), [core, p]);
  const scout = prospect ? scoutInfo(!!core.campaign.analyst, p.scout) : null;
  const span = (v: number) => `${Math.max(0, Math.min(100, ((v - 15) / 85) * 100))}%`;
  const who = g.mine ? '' : '입단하면 ';
  const line = 'flex gap-1 leading-snug';
  const key = 'w-[52px] shrink-0 text-white/50';

  return (
    <div className="mt-1.5 bg-ink/60 px-1.5 py-1 text-[11px]" data-testid="potential">
      {scout ? (
        <div data-testid="pot-scout">
          <div className={line}>
            <span className={key}>잠재력</span>
            <span>
              스카우트 <span className="text-hi">{p.scout}</span> = 잠재력 <span className="text-hi">{scout.hi === null ? `${scout.lo} 이상` : scout.lo === 0 ? `${scout.hi} 이하` : `${scout.lo}~${scout.hi}`}</span> 추정 (오차 ±{scout.noise})
            </span>
          </div>
          <div className={line}>
            <span className={key}>등급 기준</span>
            <span className="text-white/70">{scout.cuts}</span>
          </div>
          <div className={line}>
            <span className={key}>뜻</span>
            <span className="text-white/70">잠재력 = 자랄 수 있는 OVR 상한. 지금 OVR {p.ovr}</span>
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-white/60">잠재력 <span className="text-white/40">(성장 상한 OVR)</span></span>
            <span data-testid="pot-bar">
              <span style={{ color: ratingColor(p.ovr) }}>{p.ovr}</span> → <span style={{ color: ratingColor(p.pot) }}>{p.pot}</span>
              <span className={g.room > 0 ? 'text-good' : 'text-white/45'}> · 여지 +{g.room}</span>
            </span>
          </div>
          <div className="relative mt-0.5 h-[8px]" style={{ background: '#141a29', boxShadow: 'inset 0 0 0 1px #0f1420' }}>
            <div className="absolute inset-y-0 left-0 bg-good/35" style={{ width: span(p.pot) }} />
            <div className="absolute inset-y-0 left-0" style={{ width: span(p.ovr), background: ratingColor(p.ovr) }} />
          </div>
        </>
      )}
      <div className="mt-1 flex flex-col gap-px">
        <div className={line} data-testid="pot-season">
          <span className={key}>시즌 중</span>
          {g.trains || prospect ? (
            <span>
              {who}{g.maxAge}세 이하 · 여지가 있으면 {g.week}경기마다 훈련. {g.facility}에서 주당 <span className="text-hi">{pct(prospect ? g.base : g.chance)}</span> 확률로 능력치 +1~2 와 +1
              {g.playing ? <span className="text-good"> ({g.playAge}세 이하 주전 ×{g.playMult} 적용)</span> : p.age <= g.playAge ? <span className="text-white/55"> (주전이면 ×{g.playMult} = {pct(Math.min(1, g.base * g.playMult))})</span> : null}
            </span>
          ) : (
            <span className="text-white/70">{g.room <= 0 ? '잠재력에 닿아 시즌 중 훈련 성장 없음' : `${g.maxAge}세를 넘어 시즌 중 훈련 성장 없음`}</span>
          )}
        </div>
        {g.decline && (
          <div className={line} data-testid="pot-decline">
            <span className={key}>노쇠</span>
            <span className="text-bad">{g.decline.age}세 이상 · {g.week}경기마다 {pct(g.decline.rate)} 확률로 능력치 −1</span>
          </div>
        )}
        {g.mine && g.trains && g.left > 0 && (
          <div className={line} data-testid="pot-expect">
            <span className={key}>예상</span>
            <span>
              이번 시즌 남은 훈련 <span className="text-hi">{g.left}회</span> · 기대 성장 OVR 약 <span className="text-good">+{g.expect.toFixed(1)}</span>
            </span>
          </div>
        )}
        <button className="flex cursor-pointer gap-1 text-left leading-snug" onClick={() => setOpen((v) => !v)} data-testid="pot-toggle">
          <span className={key}>시즌 교체</span>
          <span>
            내년 {p.age + 1}세 → 능력치마다 <span className={g.nextBand.hi > 0 && g.nextBand.lo >= 0 ? 'text-good' : g.nextBand.hi <= 0 ? 'text-bad' : 'text-white'}>{fmtDelta(g.nextBand.lo)}~{fmtDelta(g.nextBand.hi)}</span>
            <span className="text-sky"> {open ? '▴' : '나이대별 ▾'}</span>
          </span>
        </button>
        {open && (
          <div className="grid grid-cols-4 gap-[2px]" data-testid="pot-bands">
            {DEVELOP_BANDS.map((b) => (
              <div key={b.label} className={`px-0.5 py-0.5 text-center leading-tight ${b === g.nextBand ? 'bg-hi/25' : 'bg-ink/70'}`} style={b === g.nextBand ? { boxShadow: 'inset 0 0 0 1px #ffd84a' } : undefined}>
                <div className="text-[10px] text-white/55">{b.label}</div>
                <div>{fmtDelta(b.lo)}~{fmtDelta(b.hi)}</div>
                {b.note && <div className="text-[9px] text-white/45">{b.note}</div>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
