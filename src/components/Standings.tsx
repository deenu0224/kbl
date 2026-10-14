import { useMemo } from 'react';
import type { Team } from '../game/types';
import { standings } from '../game/season';
import { postTeams } from '../game/league';
import { PostLegend, TeamDot, cutShadow, rankTone } from './ui';

/** 순위표 (리그 탭 · 정규시즌 마감 화면): 가을야구 막차 아래 초록 선, 와일드카드 자리 하늘색 숫자, 내 구단 노란 띠 */
export default function Standings({ teams, userId, legend = true }: { teams: Team[]; userId: string; legend?: boolean }) {
  const table = useMemo(() => standings(teams), [teams]);
  const lead = table[0];
  return (
    <>
      <div className="flex px-1 text-[9px] text-white/40 mob:text-[13px]">
        <span className="w-6" />
        <span className="flex-1">구단</span>
        <span className="w-14 text-center">승-패</span>
        <span className="w-9 text-right">승차</span>
      </div>
      {table.map((t, i) => {
        const gb = (lead.rec.w - t.rec.w + (t.rec.l - lead.rec.l)) / 2;
        const me = t.id === userId;
        return (
          <div
            key={t.id}
            className={`flex items-center px-1 py-[3px] text-[11px] mob:py-1 mob:text-[13px] ${me ? 'bg-hi/20 text-hi' : i % 2 ? 'bg-white/4' : ''}`}
            style={cutShadow(me, i + 1 === postTeams({ teams }))}
            data-testid="standing-row"
          >
            <span className={`w-6 ${rankTone({ teams }, i + 1)}`}>{i + 1}</span>
            <span className="flex min-w-0 flex-1 items-center gap-1">
              <TeamDot team={t} />
              <span className="truncate">{t.name}</span>
            </span>
            <span className="w-14 text-center text-white/85">
              {t.rec.w}-{t.rec.l}
            </span>
            <span className="w-9 text-right text-white/60">{i === 0 || gb === 0 ? '-' : gb.toFixed(1)}</span>
          </div>
        );
      })}
      {legend && <PostLegend teams={teams} />}
    </>
  );
}
