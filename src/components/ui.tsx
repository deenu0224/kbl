import type { CSSProperties, ReactNode } from 'react';
import type { BatPos, FacilityKind, PitchRole, Team, Weather } from '../game/types';

export const DOW = ['화', '수', '목', '금', '토', '일'];
export const dowOf = (day: number) => DOW[((day % 6) + 6) % 6];
export const isNightDay = (day: number) => ((day % 6) + 6) % 6 < 4;

export const POS_KO: Record<BatPos | PitchRole, string> = {
  C: '포수',
  '1B': '1루',
  '2B': '2루',
  '3B': '3루',
  SS: '유격',
  LF: '좌익',
  CF: '중견',
  RF: '우익',
  DH: '지타',
  SP: '선발',
  RP: '불펜',
  CP: '마무리',
};

/** 넓은 곳(카드 제목·상세·문장)용 포지션 이름. 좁은 칸은 POS_KO */
export const POS_FULL: Record<BatPos | PitchRole, string> = {
  C: '포수',
  '1B': '1루수',
  '2B': '2루수',
  '3B': '3루수',
  SS: '유격수',
  LF: '좌익수',
  CF: '중견수',
  RF: '우익수',
  DH: '지명타자',
  SP: '선발',
  RP: '불펜',
  CP: '마무리',
};

export const FAC_KO: Record<FacilityKind, string> = { seats: '관중석', food: '매점', training: '훈련장' };

export const WEATHER_KO: Record<Weather, string> = { sunny: '맑음', cloudy: '흐림', rain: '비' };
export const WEATHER_ICON: Record<Weather, string> = { sunny: '☀', cloudy: '☁', rain: '☂' };

/** 능력치(20~99) → 색 */
export function ratingColor(v: number): string {
  if (v >= 80) return '#ffd84a';
  if (v >= 68) return '#6ee07a';
  if (v >= 55) return '#7fd3ff';
  if (v >= 42) return '#f0a35a';
  return '#ff6b6b';
}

export const TONE_CLASS = { good: 'text-good', bad: 'text-bad', info: 'text-sky' } as const;

export function Bar({
  ratio,
  color,
  h = 6,
  bg = '#141a29',
  className = '',
}: {
  ratio: number;
  color: string;
  h?: number;
  bg?: string;
  className?: string;
}) {
  const r = Math.max(0, Math.min(1, Number.isFinite(ratio) ? ratio : 0));
  return (
    <div className={`w-full ${className}`} style={{ height: h, background: bg, boxShadow: 'inset 0 0 0 1px #0f1420' }}>
      <div style={{ width: `${r * 100}%`, height: '100%', background: color, boxShadow: 'inset 0 -2px 0 rgba(0,0,0,.25)' }} />
    </div>
  );
}

/** 능력치 막대: 라벨 · 막대 · 숫자 */
export function StatBar({ label, value }: { label: string; value: number }) {
  const c = ratingColor(value);
  return (
    <div className="flex items-center gap-1.5 text-[11px] leading-none">
      <span className="w-8 shrink-0 text-white/60">{label}</span>
      <Bar ratio={(value - 15) / 85} color={c} h={7} />
      <span className="w-5 shrink-0 text-right" style={{ color: c }}>
        {value}
      </span>
    </div>
  );
}

export function Stars({ star, className = '' }: { star: number; className?: string }) {
  const n = Math.max(0, Math.min(5, Math.round(star / 20)));
  return (
    <span className={`tracking-tighter ${className}`} title={`스타성 ${star}`}>
      <span className="text-hi">{'★'.repeat(n)}</span>
      <span className="text-white/20">{'★'.repeat(5 - n)}</span>
    </span>
  );
}

export function OvrBadge({ ovr, size = 22 }: { ovr: number; size?: number }) {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center font-pixel-lg text-ink"
      style={{
        width: size,
        height: size,
        fontSize: Math.max(13, size * 0.55),
        background: ratingColor(ovr),
        boxShadow: '0 0 0 1px #0f1420, inset 0 -2px 0 rgba(0,0,0,.25)',
      }}
      title={`종합 ${ovr}`}
    >
      {ovr}
    </span>
  );
}

export function TeamDot({ team, size = 10 }: { team: Pick<Team, 'color' | 'color2'> | undefined; size?: number }) {
  return (
    <span
      className="inline-block shrink-0"
      style={{
        width: size,
        height: size,
        background: team?.color ?? '#888',
        boxShadow: `0 0 0 1px #0f1420, inset -${Math.ceil(size / 3)}px 0 0 ${team?.color2 ?? '#444'}`,
      }}
    />
  );
}

export function TabBar<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: { id: T; label: string; badge?: ReactNode }[];
  value: T;
  onChange: (t: T) => void;
}) {
  return (
    <div className="flex shrink-0 gap-[2px] bg-edge p-[2px]">
      {tabs.map((t) => {
        const on = t.id === value;
        return (
          <button
            key={t.id}
            onClick={() => onChange(t.id)}
            data-sfx="tab"
            className={`flex flex-1 cursor-pointer items-center justify-center gap-1 py-1.5 text-[12px] mob:min-h-10 mob:text-[13px] ${on ? 'bg-panel text-hi' : 'bg-panel-2/60 text-white/60 hover:text-white'}`}
            style={on ? { boxShadow: 'inset 0 2px 0 #ffd84a' } : undefined}
          >
            {t.label}
            {t.badge}
          </button>
        );
      })}
    </div>
  );
}

/** 탭 배지: 숫자만. 반짝이지 않는다. */
export function Badge({ n }: { n: number | undefined }) {
  if (!n || n <= 0) return null;
  return (
    <span className="inline-flex h-[14px] min-w-[14px] shrink-0 items-center justify-center bg-[#e2572e] px-[3px] text-[10px] leading-none text-white mob:text-[13px]" style={{ boxShadow: '0 0 0 1px #0f1420' }}>
      {n > 9 ? '9+' : n}
    </span>
  );
}

/** 작은 선택 칩 줄 (서브뷰·카테고리) */
export function Chips<T extends string>({ items, value, onChange }: { items: readonly (readonly [T, string])[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="no-scrollbar flex shrink-0 flex-wrap gap-1 text-[10px] mob:flex-nowrap mob:overflow-x-auto">
      {items.map(([k, label]) => (
        <button key={k} data-sfx="tab" onClick={() => onChange(k)} className={`shrink-0 cursor-pointer whitespace-nowrap px-1.5 py-0.5 mob:min-h-10 mob:px-3 mob:text-[13px] ${value === k ? 'bg-hi text-ink' : 'bg-ink text-white/60'}`}>
          {label}
        </button>
      ))}
    </div>
  );
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mt-2 mb-1 flex items-center justify-between text-[11px] text-sky first:mt-0">
      <span>▸ {children}</span>
      {right}
    </div>
  );
}

/** 가로 금액 막대 (재무/요약용) */
export function MoneyBar({
  label,
  text,
  ratio,
  color,
}: {
  label: string;
  text: string;
  ratio: number;
  color: string;
}) {
  return (
    <div className="flex items-center gap-1.5 text-[11px] leading-tight">
      <span className="w-12 shrink-0 text-white/65">{label}</span>
      <Bar ratio={ratio} color={color} h={9} />
      <span className="w-14 shrink-0 whitespace-nowrap text-right mob:w-auto mob:min-w-[76px]">{text}</span>
    </div>
  );
}

/** div 로 그리는 미니 막대그래프. 음수는 아래로. */
export function MiniBars({
  values,
  height = 48,
  color,
  max,
  style,
  ghost = [],
}: {
  ghost?: number[]; // 예측 구간: 실적 뒤에 점선으로 잇는다
  values: number[];
  height?: number;
  color: (v: number, i: number) => string;
  max?: number;
  style?: CSSProperties;
}) {
  if (!values.length) {
    return (
      <div className="flex items-center justify-center text-[10px] text-white/35" style={{ height, background: '#141a29', ...style }}>
        아직 기록이 없습니다
      </div>
    );
  }
  const hi = Math.max(max ?? 0, ...values, ...ghost, 1);
  const lo = Math.min(0, ...values, ...ghost);
  const span = hi - lo || 1;
  const zero = (hi / span) * 100; // 위에서부터 0선 위치(%)
  return (
    <div className="relative flex items-stretch gap-px overflow-hidden" style={{ height, background: '#141a29', boxShadow: 'inset 0 0 0 1px #0f1420', ...style }}>
      {values.map((v, i) => {
        const h = (Math.abs(v) / span) * 100;
        return (
          <div key={i} className="relative min-w-0 flex-1" title={String(Math.round(v))}>
            <div
              className="absolute inset-x-0"
              style={{
                background: color(v, i),
                height: `${Math.max(h, 2)}%`,
                top: v >= 0 ? `${zero - Math.max(h, 2)}%` : `${zero}%`,
              }}
            />
          </div>
        );
      })}
      {ghost.map((v, i) => {
        const h = Math.max((Math.abs(v) / span) * 100, 2);
        const c = v < 0 ? '#ff6b6b' : '#ffd84a';
        return (
          <div key={`g${i}`} className="relative min-w-0 flex-1" title={`예측 ${Math.round(v)}`} data-testid="ghost-bar">
            {/* 점선: 한 칸 걸러 한 칸만 꼭대기를 찍는다 */}
            {i % 2 === 0 && <div className="absolute inset-x-0 h-[2px]" style={{ background: c, top: v >= 0 ? `${zero - h}%` : `calc(${zero + h}% - 2px)` }} />}
            <div className="absolute inset-x-0" style={{ background: c, opacity: 0.12, height: `${h}%`, top: v >= 0 ? `${zero - h}%` : `${zero}%` }} />
          </div>
        );
      })}
      {lo < 0 && <div className="pointer-events-none absolute inset-x-0 h-px bg-white/40" style={{ top: `${zero}%` }} />}
    </div>
  );
}

export const pctOf = (w: number, l: number) => (w + l > 0 ? w / (w + l) : 0);
export const fmtPct = (w: number, l: number) => (w + l > 0 ? pctOf(w, l).toFixed(3).replace(/^0/, '') : '-');
export const recText = (r: { w: number; l: number; t: number }) => `${r.w}승 ${r.l}패${r.t ? ` ${r.t}무` : ''}`;
