import { useMemo } from 'react';
import type { Postseason, PostSeries, Team } from '../game/types';
import { useStore, userMatch } from '../store';
import { buildPost } from '../game/postseason';
import { firstSeries } from '../game/autumn';
import { useUi } from './layout/uiStore';
import { TeamDot } from './ui';
import Help from './Help';

const FORMAT: Record<number, string> = { 3: '3전 2선승', 5: '5전 3선승', 7: '7전 4선승' };
const SHORT: Record<string, string> = { WC: 'WC', SPO: '준PO', PO: 'PO', KS: 'KS' };

/**
 * 유저 쪽에서 본 시리즈 전적 한 마디. 와일드카드 결정전은 4위가 1승을 안고 시작하므로 첫 경기 전에는 숫자 대신 조건을 적는다
 * (4위 "1승 안고 시작" · 5위 "2연승해야 통과"). 그 뒤에는 안고 시작한 1승을 포함한 "n승 m패"
 */
export function seriesScore(s: Pick<PostSeries, 'round' | 'hiId' | 'hiW' | 'loW' | 'games'>, userId: string): string {
  const hi = s.hiId === userId;
  if (s.round === 'WC' && s.games.length === 0) return hi ? '1승 안고 시작' : '2연승해야 통과';
  return `${hi ? s.hiW : s.loW}승 ${hi ? s.loW : s.hiW}패`;
}

/** 포스트시즌 다음 경기 한 줄 정보 ("한국시리즈 3차전 · 2승 1패"). 포스트시즌이 아니면 null */
export function usePostLine(): { name: string; gameNo: number; myW: number; oppW: number; score: string; text: string } | null {
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
    const score = seriesScore(s, userId);
    return { name: m.name, gameNo: m.gameNo, myW, oppW, score, text: `${m.name} ${m.gameNo}차전 · ${score}` };
  }, [phase, post, schedule, userId]);
}

/** 와일드카드 결정전의 승수 칸: 2칸 중 채운 칸 = 승수. 안고 시작한 1승은 하늘색, 경기로 딴 승은 노란색 */
function Pips({ wins, given }: { wins: number; given: number }) {
  return (
    <span className="flex shrink-0 items-center gap-[3px]" data-testid="wc-pips" aria-label={given ? `${wins}승 (안고 시작한 1승 포함)` : `${wins}승`}>
      {[0, 1].map((i) => (
        <span key={i} className="inline-block h-2.5 w-2.5" style={i < wins ? { background: i < given ? '#7fd3ff' : '#ffd84a' } : { boxShadow: 'inset 0 0 0 1px #6b7694' }} />
      ))}
    </span>
  );
}

function Side({ team, seed, wins, state, me, wait, wc, given = 0 }: { team: Team | undefined; seed: number; wins: number; state: 'win' | 'lose' | 'live'; me: boolean; wait: string; wc?: boolean; given?: number }) {
  return (
    <div
      className={`flex items-center gap-1.5 px-1.5 py-1 text-[12px] mob:text-[13px] ${team ? 'mob:min-h-8' : ''} ${me ? 'bg-hi/20' : 'bg-ink/50'} ${state === 'lose' ? 'opacity-50' : ''}`}
      style={me ? { boxShadow: 'inset 2px 0 0 #ffd84a' } : undefined}
    >
      {team ? (
        <>
          <span className="w-6 shrink-0 text-[10px] text-white/50">{seed > 0 ? `${seed}위` : ''}</span>
          <TeamDot team={team} />
          <span className={`min-w-0 flex-1 truncate ${me ? 'text-hi' : ''}`}>{team.name}</span>
          {wc && <Pips wins={wins} given={given} />}
          <span className={`font-pixel-lg shrink-0 text-[14px] ${state === 'win' ? 'text-hi' : ''}`}>{wins}</span>
        </>
      ) : (
        <span className="text-[11px] text-white/35">{wait}</span>
      )}
    </div>
  );
}

/** 와일드카드 결정전 칸 아래 한 줄: 시작 전에는 규칙, 진행 중에는 남은 조건, 끝나면 어떻게 통과했는지 */
function wcNote(s: PostSeries, seedOf: (id: string | null) => number): string {
  const hi = `${seedOf(s.hiId)}위`;
  const lo = `${seedOf(s.loId)}위`;
  const tieAt = s.games.findIndex((g) => g.home === g.away);
  if (s.winnerId) {
    if (tieAt >= 0) return `${tieAt + 1}차전 무승부 — ${hi} 통과`;
    return s.winnerId === s.hiId ? `${hi} 통과 (안고 시작한 1승 + ${s.games.length}차전 승)` : `${lo} 2연승으로 통과`;
  }
  if (s.games.length) return `1승 1패 — 2차전을 이기는 팀이 통과 (비기면 ${hi})`;
  return `${hi}는 1승이나 무승부면 통과 · ${lo}는 2연승해야 통과`;
}

function SeriesBox({ s, prev, byId, seeds, userId, live, ours = false }: { s: PostSeries; prev?: PostSeries; byId: Map<string, Team>; seeds: string[]; userId: string; live: boolean; ours?: boolean }) {
  const st = (id: string | null) => (s.winnerId ? (s.winnerId === id ? 'win' : 'lose') : 'live') as 'win' | 'lose' | 'live';
  const wait = prev ? `${prev.name} 승자` : '';
  const wc = s.round === 'WC';
  const seedOf = (id: string | null) => (id ? seeds.indexOf(id) + 1 : 0);
  return (
    <div className="min-w-0 flex-1" style={{ boxShadow: live ? '0 0 0 1px #7fd3ff' : ours ? '0 0 0 1px #f0a35a' : '0 0 0 1px #0f1420' }} data-testid={`series-${s.round}`} data-ours={ours ? '1' : undefined}>
      <div className="flex items-center justify-between gap-1 bg-panel-2 px-1.5 py-[3px] text-[11px]">
        <span className={`min-w-0 truncate ${live ? 'text-sky' : ours ? 'text-[#f0a35a]' : 'text-white/75'}`}>
          {ours && <span aria-hidden>▲ </span>}
          {s.name}
        </span>
        <span className="shrink-0 whitespace-nowrap text-[10px] text-white/45">{wc ? `${seedOf(s.hiId)}위 1승 안고 시작` : (FORMAT[s.bestOf] ?? `${s.bestOf}전`)}</span>
      </div>
      <Side team={s.hiId ? byId.get(s.hiId) : undefined} seed={seedOf(s.hiId)} wins={s.hiW} state={st(s.hiId)} me={s.hiId === userId} wait={wait} wc={wc} given={wc ? 1 : 0} />
      <Side team={s.loId ? byId.get(s.loId) : undefined} seed={seedOf(s.loId)} wins={s.loW} state={st(s.loId)} me={s.loId === userId} wait={wait} wc={wc} />
      {wc && s.hiId && s.loId && (
        <div className="bg-ink/30 px-1.5 py-[3px] text-[10px] leading-snug text-white/55 mob:text-[12px]" data-testid="wc-note">
          {wcNote(s, seedOf)}
        </div>
      )}
      {s.games.length > 0 && (
        <div className="flex flex-wrap gap-[3px] bg-ink/30 px-1.5 py-1">
          {s.games.map((g, i) => {
            const hiRuns = g.homeId === s.hiId ? g.home : g.away;
            const loRuns = g.homeId === s.hiId ? g.away : g.home;
            const userIn = s.hiId === userId || s.loId === userId;
            const tied = hiRuns === loRuns; // 와일드카드 결정전만
            const userWon = userIn && (s.hiId === userId ? hiRuns > loRuns : loRuns > hiRuns);
            return (
              <span key={i} className="bg-ink px-1 text-[10px]" style={{ boxShadow: `inset 0 -2px 0 ${!userIn ? '#47557f' : tied ? '#7fd3ff' : userWon ? '#6ee07a' : '#ff6b6b'}` }}>
                {hiRuns}:{loRuns}
                {tied ? ' 무' : ''}
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
export default function Bracket({ wide = false, path = false, reopen = false }: { wide?: boolean; path?: boolean; reopen?: boolean }) {
  const post = useStore((s) => s.post);
  const teams = useStore((s) => s.teams);
  const userId = useStore((s) => s.userId);
  const byId = useMemo(() => new Map(teams.map((t) => [t.id, t])), [teams]);

  const view = useMemo<Postseason>(() => {
    if (post) return post;
    // 구단 수에 따라 4팀 또는 5팀(와일드카드 결정전) 사다리 — 엔진과 같은 규칙으로 만든다
    return { ...buildPost({ teams, userId }), cur: -1, userFinish: 'none' };
  }, [post, teams, userId]);

  const champ = view.championId ? byId.get(view.championId) : undefined;
  // 우리 길: 우리가 처음 나서는 시리즈부터 한국시리즈까지 (탈락했으면 탈락한 시리즈까지)
  const first = path && post ? firstSeries({ post, userId }) : null;
  const lostAt = post ? post.series.findIndex((s) => s.winnerId && s.winnerId !== userId && (s.hiId === userId || s.loId === userId)) : -1;
  const ours = (i: number) => !!first && i >= first.idx && (lostAt < 0 || i <= lostAt);
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2 text-[10px] text-white/45 mob:text-[12px]">
        <span>{post ? `가을야구 ${view.seeds.length}팀` : '지금 순위대로라면'}</span>
        {first && <span className="text-[#f0a35a]">▲ 우리 길</span>}
        <span className="ml-auto flex items-center gap-1">
          {reopen && post && (
            <button className="px-btn min-h-8 !px-1.5 text-[11px] mob:text-[12px]" data-testid="autumn-reopen" onClick={() => useUi.getState().setAutumnOpen(true)}>
              정규시즌 마감 다시 보기
            </button>
          )}
          <Help topic="postseason" />
        </span>
      </div>
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
      <div className={wide ? 'flex items-start gap-2 por:flex-col-reverse por:items-stretch por:gap-1.5' : 'flex flex-col-reverse gap-1.5'} data-testid="bracket">
        {view.series.map((s, i) => (
          <SeriesBox key={s.round} s={s} prev={view.series[i - 1]} byId={byId} seeds={view.seeds} userId={userId} live={!!post && post.cur === i && !s.winnerId} ours={ours(i)} />
        ))}
      </div>
    </div>
  );
}

export const roundShort = (r: string) => SHORT[r] ?? r;
