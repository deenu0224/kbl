import type { ReactNode } from 'react';
import type { Player, Team } from '../game/types';
import { fmtAvg, fmtIp, fmtEra, fmtMoney } from '../game/format';
import { VALUE_FAIR, valueGap } from '../game/analysis';
import { svcLeft } from '../game/contract';
import { useStore } from '../store';
import Help from './Help';
import type { HelpTopic } from './helpTopics';
import PixelFace from './PixelFace';
import { OvrBadge, POS_FULL, StatBar } from './ui';
import Potential from './roster/Potential';

const SCOUT_COLOR: Record<string, string> = { A: '#ffd84a', B: '#6ee07a', C: '#7fd3ff', D: '#9aa5c4' };

/** 스카우트 등급 (잠재력의 흐릿한 표시) */
export function ScoutBadge({ grade, size = 18 }: { grade: Player['scout']; size?: number }) {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center font-pixel-lg text-ink"
      style={{ width: size, height: size, fontSize: Math.max(13, size * 0.7), background: SCOUT_COLOR[grade ?? ''] ?? '#56607e', boxShadow: '0 0 0 1px #0f1420' }}
    >
      {grade ?? '?'}
    </span>
  );
}

/** 해당될 때만 붙는 작은 태그 (설명은 ? 뒤에) */
function Tag({ text, tone, help }: { text: string; tone: string; help?: HelpTopic }) {
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap bg-ink/70 py-0.5 pl-1.5 pr-1 text-[11px] mob:text-[13px]" data-testid="card-tag">
      <span className={tone}>{text}</span>
      {help && <Help topic={help} />}
    </span>
  );
}

/** 시즌 기록 한 줄: 타자 "84경기 .312 12홈런 45타점 8도루", 투수 "24경기 3.45 8승 5패 2세 120.1이닝" */
function StatLine({ label, p, bat: b, pit: t, testid, dim }: { label: string; p: Player; bat: Player['bat']; pit: Player['pit']; testid: string; dim?: boolean }) {
  const none = p.kind === 'B' ? b.pa === 0 : t.outs === 0;
  const cells: string[] =
    p.kind === 'B'
      ? [`${b.g}경기`, fmtAvg(b.h, b.ab), `${b.hr}홈런`, `${b.rbi}타점`, `${b.sb}도루`]
      : [`${t.g}경기`, fmtEra(t.er, t.outs), `${t.w}승 ${t.l}패${t.sv ? ` ${t.sv}세` : ''}`, `${fmtIp(t.outs)}이닝`, `${t.so}삼진`];
  return (
    <div className={`flex items-center gap-2 leading-tight ${dim ? 'text-white/60' : 'text-white/90'}`} data-testid={testid}>
      <span className="shrink-0 whitespace-nowrap text-white/55">{label}</span>
      {none ? <span className="text-white/40">기록 없음</span> : <span className="flex min-w-0 flex-1 flex-wrap justify-between gap-x-2">{cells.map((c, i) => <span key={i} className="whitespace-nowrap">{c}</span>)}</span>}
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
  prospect = false,
}: {
  player: Player;
  team?: Pick<Team, 'color' | 'color2' | 'name'>;
  roleLabel?: string;
  extra?: ReactNode;
  children?: ReactNode;
  prospect?: boolean; // 드래프트 대상: 잠재력은 숨기고 스카우트 등급만 보인다
}) {
  const color = team?.color ?? '#6b7694';
  const color2 = team?.color2 ?? '#dfe5f5';
  const b = p.bat;
  const t = p.pit;
  const season = useStore((s) => s.season);
  const phase = useStore((s) => s.phase);
  const secret = useStore((s) => (s.campaign.secrets ?? []).some((x) => !x.unknown && x.pid === p.id));
  const mine = !!team && !prospect;
  const left = mine ? svcLeft({ season, phase }, p) : null;
  const gap = mine ? valueGap(p, season) : 0;

  return (
    <div
      className="relative shrink-0 bg-panel-2 p-2"
      style={{ boxShadow: `0 0 0 2px #0f1420, inset 0 0 0 2px ${color}, inset 0 0 0 3px ${color2}55` }}
    >
      {/* 머리띠 */}
      <div className="-mx-0.5 -mt-0.5 mb-1.5 flex items-center justify-between px-1.5 py-0.5 text-[10px]" style={{ background: color, color: '#fff', textShadow: '1px 1px 0 rgba(0,0,0,.5)' }}>
        <span>{team?.name ?? (prospect ? '신인 드래프트' : 'FA · 자유계약')}</span>
        <span>
          {roleLabel ?? POS_FULL[p.pos]} · {p.age}세{p.foreign ? ' · 외인' : ''}
        </span>
      </div>

      <div className="flex gap-2">
        <div className="shrink-0 self-start" style={{ boxShadow: `0 0 0 2px #0f1420, 0 0 0 3px ${color2}` }}>
          <PixelFace id={p.id} color={color} color2={color2} foreign={p.foreign} size={64} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <OvrBadge ovr={p.ovr} size={26} />
            <div className="min-w-0 flex-1 truncate font-pixel-lg text-[15px] leading-tight text-white">{p.name}</div>
            <Help topic="ovr" />
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
          </div>
        </div>
      </div>

      <div className="mt-1.5 flex flex-col gap-1 text-[11px] mob:text-[13px]">
        <div className="flex items-center justify-between gap-2" data-testid="potential">
          {prospect ? (
            <span className="flex items-center gap-1.5 text-white/60">
              스카우트 평가 <ScoutBadge grade={p.scout} />
            </span>
          ) : (
            <span className="text-white/60">
              잠재력 <span className="text-good">{p.pot}</span>
            </span>
          )}
          <Help topic="potential">
            <Potential player={p} prospect={prospect} />
          </Help>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-white/60">
            연봉 <span className="text-white">{fmtMoney(p.salary)}</span>
          </span>
          {/* 출신: 외인 구단 · 섬에서 키웠다 도전과제의 단서 (기록이 생기기 전에 온 선수는 없다) */}
          {mine && p.from && (
            <span className="shrink-0 text-white/50" data-testid="card-from">
              {p.from === 'fa' ? 'FA 영입' : '우리 드래프트'}
            </span>
          )}
        </div>
        {!prospect && (
          <div className="flex flex-col gap-[2px] bg-ink/40 px-1.5 py-1" data-testid="card-stats">
            <StatLine label="이번 시즌" p={p} bat={b} pit={t} testid="card-stat" />
            {p.prev && <StatLine label="지난 시즌" p={p} bat={p.prev.bat} pit={p.prev.pit} testid="card-stat-prev" dim />}
          </div>
        )}
        <div className="flex flex-wrap gap-1 empty:hidden">
          {p.injury > 0 && <Tag text={p.ban ? `징계 ${p.ban}경기` : `부상 ${p.injury}경기`} tone="text-bad" />}
          {secret && <Tag text="🤫 말하지 않은 일" tone="text-[#f0a35a]" help="secrets" />}
          {(p.tired ?? 0) > 0 && <Tag text={`연투 ${p.tired}일째`} tone="text-[#f0a35a]" help="fatigue" />}
          {p.posShift && <Tag text={`전향 중 수비 −${p.posShift.pen}`} tone="text-bad" />}
          {left !== null && <Tag text={left > 0 ? `FA 자격까지 ${left}시즌` : 'FA 자격'} tone="text-sky" help="service" />}
          {Math.abs(gap) >= VALUE_FAIR && <Tag text={`가성비 ${gap > 0 ? '+' : '−'}${fmtMoney(Math.abs(gap))}`} tone={gap > 0 ? 'text-good' : 'text-bad'} help="value" />}
        </div>
      </div>
      {extra}
      {children && <div className="mt-1.5 flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}
