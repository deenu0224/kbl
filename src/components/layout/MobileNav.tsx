import { useUi, type MobileTab } from './uiStore';

// 7×7 픽셀 아이콘 ('#' = 칠함)
const ICONS: Record<MobileTab, string[]> = {
  roster: ['..###..', '..###..', '...#...', '.#####.', '#.###.#', '..#.#..', '..#.#..'],
  market: ['...#...', '..###..', '#######', '.#####.', '..###..', '.##.##.', '.#...#.'],
  stadium: ['...#...', '..#.#..', '.#...#.', '#..#..#', '.#...#.', '..#.#..', '...#...'],
  league: ['#######', '#.###.#', '.#####.', '..###..', '...#...', '..###..', '.#####.'],
  club: ['...#...', '..###..', '.#####.', '#######', '#.#.#.#', '#.#.#.#', '#######'],
};

export function PixelIcon({ name, size = 16, color = 'currentColor' }: { name: MobileTab; size?: number; color?: string }) {
  const rows = ICONS[name];
  return (
    <svg width={size} height={size} viewBox="0 0 7 7" shapeRendering="crispEdges" aria-hidden>
      {rows.flatMap((r, y) => [...r].map((c, x) => (c === '#' ? <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill={color} /> : null)))}
    </svg>
  );
}

export const MOBILE_TABS: { id: MobileTab; label: string }[] = [
  { id: 'roster', label: '선수단' },
  { id: 'market', label: '영입' },
  { id: 'stadium', label: '구장' },
  { id: 'league', label: '리그' },
  { id: 'club', label: '구단' },
];

/** 하단(세로) 또는 패널 위(가로) 탭 내비 5개 */
export default function MobileNav({ placement }: { placement: 'bottom' | 'top' }) {
  const tab = useUi((s) => s.tab);
  const setTab = useUi((s) => s.setTab);
  const bottom = placement === 'bottom';
  return (
    <nav className="flex shrink-0 gap-[2px] bg-edge p-[2px]">
      {MOBILE_TABS.map((t) => {
        const on = t.id === tab;
        return (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            aria-current={on ? 'page' : undefined}
            className={`flex flex-1 cursor-pointer items-center justify-center ${bottom ? 'min-h-12 flex-col gap-0.5 short:min-h-10 short:flex-row short:gap-1' : 'min-h-10 gap-1'} text-[12px] ${on ? 'bg-panel text-hi' : 'bg-panel-2/60 text-white/60'}`}
            style={on ? { boxShadow: bottom ? 'inset 0 -3px 0 #ffd84a' : 'inset 0 2px 0 #ffd84a' } : undefined}
          >
            <PixelIcon name={t.id} size={bottom ? 18 : 14} />
            <span>{t.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
