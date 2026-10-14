import type { Player } from '../game/types';
import { useStore } from '../store';

/** 이 선수가 누구 편인지: 우리 구단이면 역할(주전·백업·2군…), 아니면 FA·상대 구단·외부 */
export function useWho(): (p: Player) => { text: string; mine: boolean } {
  const teams = useStore((s) => s.teams);
  const userId = useStore((s) => s.userId);
  const freeAgents = useStore((s) => s.freeAgents);
  const me = teams.find((t) => t.id === userId);
  return (p) => {
    if (me?.roster.some((x) => x.id === p.id)) {
      const cur = me.roster.find((x) => x.id === p.id)!;
      const ord = me.lineup.findIndex((l) => l.pid === p.id);
      const rot = me.rotation.indexOf(p.id);
      const role = cur.il ? '재활' : cur.farm ? '2군' : cur.kind === 'B' ? (ord >= 0 ? '주전' : '백업') : rot >= 0 ? `${rot + 1}선발` : me.closer === p.id ? '마무리' : me.bullpen.includes(p.id) ? '불펜' : '대기';
      return { text: `우리 · ${role}`, mine: true };
    }
    if (freeAgents.some((x) => x.id === p.id)) return { text: 'FA', mine: false };
    const t = teams.find((x) => x.roster.some((r) => r.id === p.id));
    return { text: t ? t.name : '외부', mine: false };
  };
}

/** 이름 옆·아래에 붙이는 작은 표시: 우리 선수는 구단 색 바탕, 그 밖은 회색 테두리 */
export function WhoTag({ who }: { who: { text: string; mine: boolean } }) {
  return (
    <span
      className="inline-block whitespace-nowrap px-1 text-[12px] leading-[1.4]"
      style={who.mine ? { background: '#f08a1c', color: '#0f1420' } : { boxShadow: 'inset 0 0 0 1px #6b7694', color: '#b9c3e0' }}
      data-testid="who-tag"
      data-mine={who.mine ? '1' : '0'}
    >
      {who.text}
    </span>
  );
}
