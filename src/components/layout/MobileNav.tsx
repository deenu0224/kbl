import type { HintTab } from '../../game/types';
import { useStore } from '../../store';
import { Badge } from '../ui';
import { useUi, type MobileTab } from './uiStore';

/** 모바일 5탭이 품는 배지 자리 (합으로 표시) */
export const TAB_HINTS: Record<MobileTab, HintTab[]> = {
  roster: ['lineup', 'pitchers'],
  market: ['market'],
  stadium: ['stadium'],
  league: ['league'],
  club: ['finance', 'news'],
};

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
  { id: 'market', label: '이적' },
  { id: 'stadium', label: '구장' },
  { id: 'league', label: '리그' },
  { id: 'club', label: '구단' },
];

/** 하단(세로) 또는 패널 위(가로) 탭 내비 5개 */
export default function MobileNav({ placement }: { placement: 'bottom' | 'top' }) {
  const tab = useUi((s) => s.tab);
  const setTab = useUi((s) => s.setTab);
  const hints = useStore((s) => s.campaign.hints);
  const bottom = placement === 'bottom';
  return (
    <nav className="flex shrink-0 gap-[2px] bg-edge p-[2px]">
      {MOBILE_TABS.map((t) => {
        const on = t.id === tab;
        return (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            data-sfx="tab"
            aria-current={on ? 'page' : undefined}
            className={`relative flex flex-1 cursor-pointer items-center justify-center ${bottom ? 'min-h-12 flex-col gap-0.5 short:min-h-10 short:flex-row short:gap-1' : 'min-h-10 gap-1'} text-[12px] ${on ? 'bg-panel text-hi' : 'bg-panel-2/60 text-white/60'}`}
            style={on ? { boxShadow: bottom ? 'inset 0 -3px 0 #ffd84a' : 'inset 0 2px 0 #ffd84a' } : undefined}
          >
            <PixelIcon name={t.id} size={bottom ? 18 : 14} />
            <span>{t.label}</span>
            <span className={bottom ? 'absolute top-1 left-[calc(50%+8px)] short:static' : ''}>
              <Badge n={TAB_HINTS[t.id].reduce((a, h) => a + (hints?.[h] ?? 0), 0)} />
            </span>
          </button>
        );
      })}
    </nav>
  );
}
