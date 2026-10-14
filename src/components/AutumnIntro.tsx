import { useMemo } from 'react';
import { useCore, useStore } from '../store';
import { rankOf } from '../game/season';
import { postTeams } from '../game/league';
import { autumnStreakLine, firstMatchLines, firstSeries, flagAtSeasonEnd, missLine } from '../game/autumn';
import Bracket from './Bracket';
import Standings from './Standings';
import { useUi } from './layout/uiStore';
import { recText } from './ui';

/**
 * 정규시즌 마감 화면: 정규시즌 마지막 경기 요약을 닫은 뒤, 가을야구 첫 경기(또는 시즌 결산) 전에 한 번.
 * 최종 순위 · 우리 순위 한 줄 · 이번 장 깃발 · 첫 상대와 조건 · 대진표(우리 길). 리그 탭 대진표에서 다시 열 수 있다
 */
export default function AutumnIntro() {
  const core = useCore();
  const close = useStore((s) => s.closeAutumnIntro);
  const reopened = useUi((s) => s.autumnOpen);
  const setOpen = useUi((s) => s.setAutumnOpen);
  const team = core.teams.find((t) => t.id === core.userId) ?? core.teams[0];
  const rank = rankOf(core.teams, core.userId);
  const n = postTeams(core);
  const inPost = !!core.post && core.post.userFinish !== 'none' && core.post.seeds.includes(core.userId);
  const fs = useMemo(() => firstSeries(core), [core]);
  const first = useMemo(() => firstMatchLines(core), [core]);
  const miss = useMemo(() => missLine(core), [core]);
  const flag = useMemo(() => flagAtSeasonEnd(core), [core]);
  const streak = useMemo(() => autumnStreakLine(core), [core]);
  const done = () => {
    close();
    setOpen(false);
  };
  const cta = reopened && !core.post?.intro ? '닫기' : inPost ? '가을야구 시작 ▶' : '시즌 결산 보기 ▶';

  return (
    <div
      className="fixed inset-0 z-30 flex items-center justify-center bg-ink/95 p-4 mob:items-stretch mob:p-0"
      style={{ paddingTop: 'max(env(safe-area-inset-top), 0px)', paddingBottom: 'env(safe-area-inset-bottom)' }}
      role="dialog"
      aria-label="정규시즌 마감"
      data-testid="autumn-intro"
    >
      <div className="px-panel flex max-h-full w-full max-w-[560px] flex-col">
        <div className="px-scroll min-h-0 flex-1 overflow-y-auto p-3">
          <div className="text-[11px] text-sky mob:text-[13px]">
            {core.season}시즌 정규시즌 종료 · {core.schedule.length}경기
          </div>
          <div className="font-pixel-lg text-[20px] leading-tight" style={{ color: team.color, textShadow: '2px 2px 0 #0f1420' }}>
            {team.city} {team.name}
          </div>
          <div className="mt-0.5 text-[13px]">
            최종 <span className={`font-pixel-lg text-[20px] ${inPost ? 'text-hi' : 'text-white'}`}>{rank}위</span> · {recText(team.rec)}
          </div>

          {/* 결과 한 줄 */}
          {inPost ? (
            <div className="mt-2 bg-[#f0a35a]/15 px-2 py-1.5" style={{ boxShadow: 'inset 3px 0 0 #f0a35a' }} data-testid="autumn-in">
              <div className="font-pixel-lg text-[17px] text-[#ffb870]">가을야구 진출!</div>
              <div className="text-[12px] text-white/85 mob:text-[13px]">
                {streak} · {fs ? `${rank}위 — ${fs.s.name}${fs.idx > 0 ? ' 직행' : '부터'}` : `${rank}위`}
              </div>
            </div>
          ) : (
            miss && (
              <div className="mt-2 bg-bad/15 px-2 py-1.5" style={{ boxShadow: 'inset 3px 0 0 #ff6b6b' }} data-testid="autumn-out">
                <div className="font-pixel-lg text-[16px] text-bad">{miss.text}</div>
                <div className="text-[12px] text-white/75 mob:text-[13px]">
                  {miss.close ? `한 칸이 모자랐다 — ${n}위까지가 가을야구` : `${n}위까지가 가을야구`}
                </div>
              </div>
            )
          )}

          {/* 이번 장 깃발 */}
          {flag && (
            <div className="mt-1.5 flex items-center gap-1.5 bg-ink/50 px-2 py-1 text-[12px] mob:text-[13px]" data-testid="autumn-flag">
              <span className="shrink-0 text-white/50">시즌 목표</span>
              <span className="min-w-0 flex-1 truncate">{flag.text}</span>
              <span className={`shrink-0 ${flag.state === 'done' ? 'text-good' : flag.state === 'failed' ? 'text-bad' : 'text-sky'}`}>
                {flag.state === 'done' ? '달성' : flag.state === 'failed' ? '실패' : '가을야구에서 정해진다'}
              </span>
            </div>
          )}

          {/* 첫 상대와 조건 */}
          {inPost && first && (
            <div className="mt-2 bg-ink/60 px-2 py-1.5" data-testid="autumn-first">
              <div className="text-[10px] text-white/50 mob:text-[12px]">첫 경기</div>
              <div className="font-pixel-lg text-[15px] leading-tight text-white">{first.head}</div>
              <div className="mt-0.5 flex flex-wrap gap-1">
                {first.rule.map((r) => (
                  <span key={r} className="bg-panel-2 px-1.5 py-[1px] text-[11px] text-white/80 mob:text-[12px]">
                    {r}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="mt-3">
            <div className="mb-1 text-[11px] text-white/60 mob:text-[13px]">대진표</div>
            <Bracket path />
          </div>

          <div className="mt-3">
            <div className="mb-1 text-[11px] text-white/60 mob:text-[13px]">최종 순위</div>
            <Standings teams={core.teams} userId={core.userId} />
          </div>
        </div>
        <div className="shrink-0 border-t-2 border-ink p-2">
          <button className="px-btn gold min-h-11 w-full text-[15px]" data-testid="autumn-go" onClick={done}>
            {cta}
          </button>
        </div>
      </div>
    </div>
  );
}
