// 주루 방침 (타순 화면 맨 위): 3칸 스위치 + 타선 주력·리그 순위·이번 시즌 도루 한 줄
import { lineupSpeed, RUN_STYLES, type RunStyle } from '../../game/sim';
import { useStore, useUserTeam } from '../../store';
import Help from '../Help';

export const RUN_STYLE_KO: Record<RunStyle, string> = { run: '뛰는 야구', normal: '보통', hold: '자제' };

export default function RunStyleBar() {
  const style = useStore((s) => s.campaign.runStyle ?? 'normal');
  const setRunStyle = useStore((s) => s.setRunStyle);
  const busy = useStore((s) => !!s.playback);
  const teams = useStore((s) => s.teams);
  const team = useUserTeam();
  const spd = lineupSpeed(team);
  const rank = teams.filter((t) => lineupSpeed(t) > spd).length + 1;
  const sb = team.roster.reduce((s, p) => s + p.bat.sb, 0);
  const cs = team.roster.reduce((s, p) => s + p.bat.cs, 0);
  return (
    <div className="pb-1" data-testid="run-style">
      <div className="flex items-stretch gap-1.5">
        <div className="flex min-w-0 flex-1 gap-[2px] bg-edge p-[2px]">
          {RUN_STYLES.map((st) => (
            <button
              key={st}
              data-testid={`run-style-${st}`}
              data-sfx="tab"
              aria-pressed={style === st}
              disabled={busy}
              className={`flex min-h-11 flex-1 cursor-pointer items-center justify-center text-[14px] ${style === st ? 'bg-panel text-hi' : 'bg-panel-2/60 text-white/60'}`}
              style={style === st ? { boxShadow: 'inset 0 2px 0 #ffd84a' } : undefined}
              onClick={() => style !== st && setRunStyle(st)}
            >
              {RUN_STYLE_KO[st]}
            </button>
          ))}
        </div>
        <Help topic="runStyle" className="self-center" />
      </div>
      <div className="px-0.5 pt-1.5 text-[13px] text-white/80" data-testid="run-style-line">
        타선 주력 {Math.round(spd)} (리그 {rank}위) · 도루 {sb} · 실패 {cs}
      </div>
    </div>
  );
}
