import type { ReactNode } from 'react';
import type { Player, Team } from '../game/types';
import { fmtAvg, fmtEra, fmtIp, fmtMoney } from '../game/format';
import PixelFace from './PixelFace';
import { OvrBadge, POS_KO, Stars, StatBar } from './ui';

function StatCell({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex flex-col items-center bg-ink/70 px-1 py-0.5">
      <span className="text-[9px] text-white/50">{label}</span>
      <span className="text-[12px] leading-tight">{value}</span>
    </div>
  );
}

/** 야구 카드 느낌의 선수 카드. children 자리에 액션 버튼을 넣는다. */
export default function PlayerCard({
  player: p,
  team,
  roleLabel,
  extra,
  children,
}: {
  player: Player;
  team?: Pick<Team, 'color' | 'color2' | 'name'>;
  roleLabel?: string;
  extra?: ReactNode;
  children?: ReactNode;
}) {
  const color = team?.color ?? '#6b7694';
  const color2 = team?.color2 ?? '#dfe5f5';
  const b = p.bat;
  const t = p.pit;
  const growth = Math.max(0, p.pot - p.ovr);

  return (
    <div
      className="relative shrink-0 bg-panel-2 p-2"
      style={{ boxShadow: `0 0 0 2px #0f1420, inset 0 0 0 2px ${color}, inset 0 0 0 3px ${color2}55` }}
    >
      {/* 머리띠 */}
      <div className="-mx-0.5 -mt-0.5 mb-1.5 flex items-center justify-between px-1.5 py-0.5 text-[10px]" style={{ background: color, color: '#fff', textShadow: '1px 1px 0 rgba(0,0,0,.5)' }}>
        <span>{team?.name ?? 'FA · 자유계약'}</span>
        <span>
          {roleLabel ?? POS_KO[p.pos]} · {p.age}세{p.foreign ? ' · 외인' : ''}
        </span>
      </div>

      <div className="flex gap-2">
        <div className="flex flex-col items-center gap-1">
          <div style={{ boxShadow: `0 0 0 2px #0f1420, 0 0 0 3px ${color2}` }}>
            <PixelFace id={p.id} color={color} color2={color2} foreign={p.foreign} size={64} />
          </div>
          <Stars star={p.star} className="text-[11px]" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <OvrBadge ovr={p.ovr} size={26} />
            <div className="min-w-0">
              <div className="truncate font-pixel-lg text-[15px] leading-tight text-white">{p.name}</div>
              <div className="truncate text-[10px] text-hi">{p.tag ?? (growth >= 6 && p.age <= 25 ? '성장 기대주' : POS_KO[p.pos])}</div>
            </div>
          </div>
          <div className="mt-1.5 flex flex-col gap-[3px]">
            {p.kind === 'B' ? (
              <>
                <StatBar label="컨택" value={p.con} />
                <StatBar label="파워" value={p.pow} />
                <StatBar label="선구" value={p.eye} />
                <StatBar label="주력" value={p.spd} />
                <StatBar label="수비" value={p.def} />
              </>
            ) : (
              <>
                <StatBar label="구위" value={p.stf} />
                <StatBar label="제구" value={p.ctl} />
                <StatBar label="체력" value={p.sta} />
              </>
            )}
            <StatBar label="잠재" value={p.pot} />
          </div>
        </div>
      </div>

      {/* 시즌 기록 */}
      <div className="mt-1.5 grid grid-cols-5 gap-[2px]">
        {p.kind === 'B' ? (
          <>
            <StatCell label="경기" value={b.g} />
            <StatCell label="타율" value={fmtAvg(b.h, b.ab)} />
            <StatCell label="홈런" value={b.hr} />
            <StatCell label="타점" value={b.rbi} />
            <StatCell label="득점" value={b.r} />
          </>
        ) : (
          <>
            <StatCell label="경기" value={t.g} />
            <StatCell label="ERA" value={fmtEra(t.er, t.outs)} />
            <StatCell label="승-패" value={`${t.w}-${t.l}`} />
            <StatCell label={p.pos === 'SP' ? '이닝' : '세이브'} value={p.pos === 'SP' ? fmtIp(t.outs) : t.sv} />
            <StatCell label="탈삼진" value={t.so} />
          </>
        )}
      </div>

      <div className="mt-1.5 flex items-center justify-between text-[11px]">
        <span className="text-white/60">
          연봉 <span className="text-white">{fmtMoney(p.salary)}</span>
        </span>
        {p.injury > 0 ? (
          <span className="anim-blink text-bad">✚ 부상 {p.injury}경기</span>
        ) : growth > 0 && p.age <= 28 ? (
          <span className="text-good">성장 여력 +{growth}</span>
        ) : (
          <span className="text-white/40">건강</span>
        )}
      </div>
      {extra}
      {children && <div className="mt-1.5 flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}
