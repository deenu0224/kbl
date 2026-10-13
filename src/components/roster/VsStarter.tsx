import { useState } from 'react';
import type { Player, Team } from '../../game/types';
import { josa } from '../../game/format';
import { effDef } from '../../game/ratings';
import { OvrBadge, POS_FULL, ratingColor } from '../ui';

/**
 * 이 선수가 오면 자리를 내줄 우리 선수. 타자는 같은 자리 주전, 투수는 그 보직에서 가장 약한 선수
 * (새 투수가 몇 번째로 들어오든 명단에서 빠지는 것은 맨 끝 선수다). note 는 들어오는 순번.
 */
export function rivalOf(team: Team, p: Player): { rival: Player; label: string; note: string; bad?: boolean } | null {
  const byId = new Map(team.roster.map((x) => [x.id, x]));
  if (p.kind === 'B') {
    const slot = team.lineup.find((l) => l.pos === p.pos);
    const rival = slot && byId.get(slot.pid);
    if (!rival) return null;
    const better = p.ovr > rival.ovr;
    return {
      rival,
      label: `우리 ${POS_FULL[p.pos]}`,
      note: better ? '오면 주전 — 지금 주전은 벤치로' : '지금 주전보다 낮습니다 — 오면 백업',
      bad: !better,
    };
  }
  if (p.pos === 'CP') {
    const rival = team.closer ? byId.get(team.closer) : undefined;
    if (!rival) return null;
    const better = p.ovr > rival.ovr;
    return {
      rival,
      label: '우리 마무리',
      note: better ? '오면 마무리 — 지금 마무리는 불펜으로' : '지금 마무리보다 낮습니다 — 오면 불펜',
      bad: !better,
    };
  }
  const sp = p.pos === 'SP';
  const pool = (sp ? team.rotation : team.bullpen).map((id) => byId.get(id)).filter((x): x is Player => !!x);
  if (!pool.length) return null;
  const rival = pool.reduce((a, b) => (b.ovr < a.ovr ? b : a));
  const rank = pool.filter((x) => x.ovr >= p.ovr).length + 1;
  const unit = sp ? '선발' : '불펜';
  if (rank > pool.length)
    return {
      rival,
      label: `우리 ${unit} ${pool.length}번째`,
      note: `우리 ${unit} ${pool.length}명 누구보다 낮습니다 — 오면 대기`,
      bad: true,
    };
  return {
    rival,
    label: '자리를 내줄 선수',
    note: `오면 ${unit} ${pool.length}명 중 ${rank}번째 — 맨 끝 ${josa(rival.name, '이', '가')} 빠집니다`,
  };
}

/** 비교해 볼 만한 우리 선수들: 타자는 그 자리 주전과 같은 포지션 백업, 투수는 같은 보직 전원 */
export function rivalsOf(team: Team, p: Player): { p: Player; role: string }[] {
  const byId = new Map(team.roster.map((x) => [x.id, x]));
  const out: { p: Player; role: string }[] = [];
  const add = (id: string | null | undefined, role: string) => {
    const x = id ? byId.get(id) : undefined;
    if (x && !out.some((o) => o.p.id === x.id)) out.push({ p: x, role });
  };
  if (p.kind === 'B') {
    add(team.lineup.find((l) => l.pos === p.pos)?.pid, '주전');
    const inLineup = new Set(team.lineup.map((l) => l.pid));
    for (const x of team.roster) if (x.kind === 'B' && x.pos === p.pos) add(x.id, inLineup.has(x.id) ? '주전' : x.farm ? '2군' : '백업');
  } else if (p.pos === 'SP') {
    team.rotation.forEach((id, i) => add(id, `${i + 1}선발`));
  } else {
    add(team.closer, '마무리');
    team.bullpen.forEach((id, i) => add(id, `불펜 ${i + 1}`));
  }
  return out;
}

/** 영입 후보 카드 아래: 우리 주전과 능력치를 나란히 (왼쪽 우리, 오른쪽 후보, 끝에 차이) */
export default function VsStarter({ team, player: p }: { team: Team; player: Player }) {
  const r = rivalOf(team, p);
  const [pick, setPick] = useState<string | null>(null);
  if (!r) return null;
  const all = rivalsOf(team, p);
  // 처음 비교 상대(자리를 내줄 선수)가 맨 앞에 보이게
  const list = [...all.filter((x) => x.p.id === r.rival.id), ...all.filter((x) => x.p.id !== r.rival.id)];
  const o = list.find((x) => x.p.id === pick)?.p ?? r.rival;
  const defAt = (x: Player) => (p.kind === 'B' && p.pos !== 'DH' ? effDef(x, p.pos as never) : x.def);
  const stats: [string, (x: Player) => number][] =
    p.kind === 'B'
      ? [
          ['종합', (x) => x.ovr],
          ['컨택', (x) => x.con],
          ['파워', (x) => x.pow],
          ['선구', (x) => x.eye],
          ['주력', (x) => x.spd],
          ['수비', defAt],
          ['잠재', (x) => x.pot],
        ]
      : [
          ['종합', (x) => x.ovr],
          ['구위', (x) => x.stf],
          ['제구', (x) => x.ctl],
          ['체력', (x) => x.sta],
          ['잠재', (x) => x.pot],
        ];
  return (
    <div className="mt-1.5 bg-ink/40 px-1.5 py-1.5 text-[13px]" data-testid="vs-starter">
      <div className={`pb-1.5 leading-snug ${r.bad ? 'text-hi' : 'text-good'}`} data-testid="vs-note">
        {r.note}
      </div>
      {/* 비교 상대 고르기: 처음에는 자리를 내줄 선수, 누르면 그 선수와 비교한다 */}
      <div className="flex flex-wrap gap-1 p-0.5 pb-1.5" data-testid="vs-list">
        {list.map((x) => {
          const on = x.p.id === o.id;
          return (
            <button
              key={x.p.id}
              type="button"
              className={`flex min-h-10 cursor-pointer items-center gap-1 px-1.5 text-left leading-tight ${on ? 'bg-hi/20' : 'bg-panel-2'}`}
              style={{ boxShadow: on ? '0 0 0 2px #ffd84a' : '0 0 0 1px #0f1420' }}
              data-testid="vs-pick"
              onClick={() => setPick(x.p.id)}
            >
              <OvrBadge ovr={x.p.ovr} size={20} />
              <span>
                <span className="block whitespace-nowrap text-white">{x.p.name}</span>
                <span className={`block whitespace-nowrap ${x.p.id === r.rival.id ? 'text-sky' : 'text-white/55'}`}>{x.role}</span>
              </span>
            </button>
          );
        })}
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
              <span className="text-right" style={{ color: ratingColor(a) }}>
                {a}
              </span>
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
