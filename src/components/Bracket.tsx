import { useMemo } from 'react';
import type { Postseason, PostSeries, Team } from '../game/types';
import { useStore, userMatch } from '../store';
import { standings } from '../game/season';
import { TeamDot } from './ui';

const FORMAT: Record<number, string> = { 3: '3전 2선승', 5: '5전 3선승', 7: '7전 4선승' };
const SHORT: Record<string, string> = { WC: 'WC', SPO: '준PO', PO: 'PO', KS: 'KS' };

/** 포스트시즌 다음 경기 한 줄 정보 ("한국시리즈 3차전 · 2승 1패"). 포스트시즌이 아니면 null */
export function usePostLine(): { name: string; gameNo: number; myW: number; oppW: number; text: string } | null {
  const phase = useStore((s) => s.phase);
  const post = useStore((s) => s.post);
  const schedule = useStore((s) => s.schedule);
  const userId = useStore((s) => s.userId);
  return useMemo(() => {
    if (phase !== 'post' || !post) return null;
    const m = userMatch({ schedule, userId, phase, post }, 0);
    const s = post.series[post.cur];
    if (!m || !s || !m.name || !m.gameNo) return null;
    const myW = s.hiId === userId ? s.hiW : s.loW;
    const oppW = s.hiId === userId ? s.loW : s.hiW;
    return { name: m.name, gameNo: m.gameNo, myW, oppW, text: `${m.name} ${m.gameNo}차전 · ${myW}승 ${oppW}패` };
  }, [phase, post, schedule, userId]);
}

function Side({ team, seed, wins, state, me, wait }: { team: Team | undefined; seed: number; wins: number; state: 'win' | 'lose' | 'live'; me: boolean; wait: string }) {
  return (
    <div
      className={`flex items-center gap-1.5 px-1.5 py-1 text-[12px] mob:min-h-10 mob:text-[13px] ${me ? 'bg-hi/20' : 'bg-ink/50'} ${state === 'lose' ? 'opacity-50' : ''}`}
      style={me ? { boxShadow: 'inset 2px 0 0 #ffd84a' } : undefined}
    >
      {team ? (
        <>
          <span className="w-6 shrink-0 text-[10px] text-white/50">{seed > 0 ? `${seed}위` : ''}</span>
          <TeamDot team={team} />
          <span className={`min-w-0 flex-1 truncate ${me ? 'text-hi' : ''}`}>{team.name}</span>
          <span className={`font-pixel-lg shrink-0 text-[14px] ${state === 'win' ? 'text-hi' : ''}`}>{wins}</span>
        </>
      ) : (
        <span className="text-[11px] text-white/35">{wait}</span>
      )}
    </div>
  );
}

function SeriesBox({ s, prev, byId, seeds, userId, live }: { s: PostSeries; prev?: PostSeries; byId: Map<string, Team>; seeds: string[]; userId: string; live: boolean }) {
  const st = (id: string | null) => (s.winnerId ? (s.winnerId === id ? 'win' : 'lose') : 'live') as 'win' | 'lose' | 'live';
  const wait = prev ? `${prev.name} 승자` : '';
  return (
    <div className="min-w-0 flex-1" style={{ boxShadow: live ? '0 0 0 1px #7fd3ff' : '0 0 0 1px #0f1420' }}>
      <div className="flex items-center justify-between bg-panel-2 px-1.5 py-[3px] text-[11px]">
        <span className={live ? 'text-sky' : 'text-white/75'}>{s.name}</span>
        <span className="text-[10px] text-white/45">{FORMAT[s.bestOf] ?? `${s.bestOf}전`}</span>
      </div>
      <Side team={s.hiId ? byId.get(s.hiId) : undefined} seed={s.hiId ? seeds.indexOf(s.hiId) + 1 : 0} wins={s.hiW} state={st(s.hiId)} me={s.hiId === userId} wait={wait} />
      <Side team={s.loId ? byId.get(s.loId) : undefined} seed={s.loId ? seeds.indexOf(s.loId) + 1 : 0} wins={s.loW} state={st(s.loId)} me={s.loId === userId} wait={wait} />
      {s.games.length > 0 && (
        <div className="flex flex-wrap gap-[3px] bg-ink/30 px-1.5 py-1">
          {s.games.map((g, i) => {
            const hiRuns = g.homeId === s.hiId ? g.home : g.away;
            const loRuns = g.homeId === s.hiId ? g.away : g.home;
            const userIn = s.hiId === userId || s.loId === userId;
            const userWon = userIn && (s.hiId === userId ? hiRuns > loRuns : loRuns > hiRuns);
            return (
              <span key={i} className="bg-ink px-1 text-[10px]" style={{ boxShadow: `inset 0 -2px 0 ${!userIn ? '#47557f' : userWon ? '#6ee07a' : '#ff6b6b'}` }}>
                {hiRuns}:{loRuns}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * 포스트시즌 대진표(사다리). 아래 칸의 승자가 위 칸으로 올라간다.
 * post 가 없으면(정규시즌 중) 현재 순위로 짠 가상의 대진을 보여준다.
 */
export default function Bracket({ wide = false }: { wide?: boolean }) {
  const post = useStore((s) => s.post);
  const teams = useStore((s) => s.teams);
  const userId = useStore((s) => s.userId);
  const byId = useMemo(() => new Map(teams.map((t) => [t.id, t])), [teams]);

  const view = useMemo<Postseason>(() => {
    if (post) return post;
    const seeds = standings(teams)
      .slice(0, 4)
      .map((t) => t.id);
    const mk = (round: PostSeries['round'], name: string, bestOf: number, hi: string | undefined, lo: string | null): PostSeries => ({
      round,
      name,
      hiId: hi ?? null,
      loId: lo,
      bestOf,
      hiW: 0,
      loW: 0,
      winnerId: null,
      games: [],
    });
    return {
      seeds,
      series: [mk('SPO', '준플레이오프', 3, seeds[2], seeds[3] ?? null), mk('PO', '플레이오프', 5, seeds[1], null), mk('KS', '한국시리즈', 7, seeds[0], null)],
      cur: -1,
      championId: null,
      userFinish: 'none',
    };
  }, [post, teams]);

  const champ = view.championId ? byId.get(view.championId) : undefined;
  return (
    <div>
      {!post && <div className="mb-1 text-[10px] text-white/45">지금 순위대로라면</div>}
      {champ && (
        <div className="mb-1.5 flex items-center justify-center gap-1.5 bg-hi/20 px-2 py-1 text-[13px] text-hi">
          <TeamDot team={champ} size={12} />
          <span className="font-pixel-lg">
            {champ.city} {champ.name}
          </span>
          <span>우승</span>
        </div>
      )}
      {/* 사다리: 좁은 곳에선 한국시리즈가 맨 위, 넓은 화면에선 왼쪽 → 오른쪽 */}
      <div className={wide ? 'flex items-start gap-2 por:flex-col-reverse por:items-stretch por:gap-1.5' : 'flex flex-col-reverse gap-1.5'}>
        {view.series.map((s, i) => (
          <SeriesBox key={s.round} s={s} prev={view.series[i - 1]} byId={byId} seeds={view.seeds} userId={userId} live={!!post && post.cur === i && !s.winnerId} />
        ))}
      </div>
    </div>
  );
}

export const roundShort = (r: string) => SHORT[r] ?? r;
