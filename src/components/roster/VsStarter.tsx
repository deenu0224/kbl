import type { Player, Team } from '../../game/types';
import { effDef } from '../../game/ratings';
import { OvrBadge, POS_FULL, ratingColor } from '../ui';

/** 이 선수가 오면 밀려날 우리 선수: 타자는 같은 자리 주전, 투수는 그 보직에서 가장 약한 선수 */
export function rivalOf(team: Team, p: Player): { rival: Player; label: string } | null {
  const byId = new Map(team.roster.map((x) => [x.id, x]));
  if (p.kind === 'B') {
    const slot = team.lineup.find((l) => l.pos === p.pos);
    const rival = slot && byId.get(slot.pid);
    return rival ? { rival, label: `우리 ${POS_FULL[p.pos]}` } : null;
  }
  if (p.pos === 'CP') {
    const rival = team.closer ? byId.get(team.closer) : undefined;
    return rival ? { rival, label: '우리 마무리' } : null;
  }
  const ids = p.pos === 'SP' ? team.rotation : team.bullpen;
  const pool = ids.map((id) => byId.get(id)).filter((x): x is Player => !!x);
  if (!pool.length) return null;
  const rival = pool.reduce((a, b) => (b.ovr < a.ovr ? b : a));
  return { rival, label: p.pos === 'SP' ? '우리 선발 중 가장 약한' : '우리 불펜 중 가장 약한' };
}

/** 영입 후보 카드 아래: 우리 주전과 능력치를 나란히 (왼쪽 우리, 오른쪽 후보, 끝에 차이) */
export default function VsStarter({ team, player: p }: { team: Team; player: Player }) {
  const r = rivalOf(team, p);
  if (!r) return null;
  const o = r.rival;
  const defAt = (x: Player) => (p.kind === 'B' && p.pos !== 'DH' ? effDef(x, p.pos as never) : x.def);
  const stats: [string, (x: Player) => number][] =
    p.kind === 'B'
      ? [['종합', (x) => x.ovr], ['컨택', (x) => x.con], ['파워', (x) => x.pow], ['선구', (x) => x.eye], ['주력', (x) => x.spd], ['수비', defAt], ['잠재', (x) => x.pot]]
      : [['종합', (x) => x.ovr], ['구위', (x) => x.stf], ['제구', (x) => x.ctl], ['체력', (x) => x.sta], ['잠재', (x) => x.pot]];
  return (
    <div className="mt-1.5 bg-ink/40 px-1.5 py-1.5 text-[13px]" data-testid="vs-starter">
      <div className="flex items-center gap-1 pb-1">
        <span className="shrink-0 text-sky">{r.label}</span>
        <OvrBadge ovr={o.ovr} size={18} />
        <span className="min-w-0 flex-1 truncate text-white">{o.name}</span>
        <span className="shrink-0 text-white/55">{o.age}세</span>
      </div>
      <div className="grid grid-cols-[1fr_2.5rem_1fr] items-center gap-x-2 gap-y-[3px] leading-none">
        <span className="truncate text-right text-white/55">{o.name}</span>
        <span />
        <span className="truncate text-white/55">{p.name}</span>
        {stats.map(([label, f]) => {
          const a = Math.round(f(o));
          const b = Math.round(f(p));
          const d = b - a;
          return (
            <div key={label} className="contents" data-testid="vs-row">
              <span className="text-right" style={{ color: ratingColor(a) }}>{a}</span>
              <span className="text-center text-white/60">{label}</span>
              <span>
                <span style={{ color: ratingColor(b) }}>{b}</span>
                <span className={`pl-1.5 ${d > 0 ? 'text-good' : d < 0 ? 'text-bad' : 'text-white/35'}`}>{d > 0 ? `+${d}` : d < 0 ? `−${-d}` : '='}</span>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
