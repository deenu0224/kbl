import type { DayReport, Team } from '../game/types';
import { findPlayer, useStore } from '../store';
import { fmtInt, fmtMoney } from '../game/format';
import { PART_LABEL } from './LeftPanel';
import { chanceKey, useUi } from './layout/uiStore';
import { Bar, MoneyBar, TeamDot, WEATHER_ICON, WEATHER_KO, dowOf } from './ui';

/** 팀 색 점 + 구단 약칭. 우리 팀은 밝은 테두리 — 하이라이트 배너·경기 요약에서 "누구 팀 선수인지"를 붙인다 */
export function TeamTag({ team, mine, size = 11 }: { team: Pick<Team, 'id' | 'color' | 'color2'> | undefined; mine: boolean; size?: number | string }) {
  if (!team) return null;
  return (
    <span
      className="inline-flex shrink-0 items-center whitespace-nowrap align-middle font-pixel leading-none"
      style={{ fontSize: size, gap: '0.35em', padding: '0.2em 0.4em', background: 'rgba(15,20,32,.85)', color: mine ? '#fff' : '#b9c3e0', boxShadow: mine ? '0 0 0 1px #ffffff' : '0 0 0 1px #3a4563' }}
      data-testid="team-tag"
      data-mine={mine ? '1' : '0'}
    >
      <span className="inline-block" style={{ width: '0.8em', height: '0.8em', background: team.color, boxShadow: `inset -0.25em 0 0 ${team.color2}` }} />
      {team.id}
    </span>
  );
}

function RankMove({ before, after }: { before: number; after: number }) {
  const d = before - after;
  return (
    <span className="whitespace-nowrap">
      {before !== after && <span className="text-white/50">{before}위 → </span>}
      <span className="font-pixel-lg text-[15px] text-hi">{after}위</span>
      {d !== 0 && <span className={`ml-1 ${d > 0 ? 'text-good' : 'text-bad'}`}>{d > 0 ? `▲${d}` : `▼${-d}`}</span>}
    </span>
  );
}

function MoneyBlock({ m, netLabel = '오늘 순익' }: { m: DayReport['money']; netLabel?: string }) {
  const max = Math.max(1, m.ticket, m.food, m.merch, m.league, m.salary, m.upkeep, m.interest);
  return (
    <div className="flex flex-col gap-[3px]">
      <MoneyBar label="입장" text={`+${fmtMoney(m.ticket)}`} ratio={m.ticket / max} color="#6ee07a" />
      <MoneyBar label="매점" text={`+${fmtMoney(m.food)}`} ratio={m.food / max} color="#6ee07a" />
      <MoneyBar label="굿즈" text={`+${fmtMoney(m.merch)}`} ratio={m.merch / max} color="#6ee07a" />
      <MoneyBar label="분배금" text={`+${fmtMoney(m.league)}`} ratio={m.league / max} color="#6ee07a" />
      <MoneyBar label="연봉" text={`-${fmtMoney(m.salary)}`} ratio={m.salary / max} color="#ff6b6b" />
      <MoneyBar label="유지비" text={`-${fmtMoney(m.upkeep)}`} ratio={m.upkeep / max} color="#ff6b6b" />
      {m.interest > 0 && <MoneyBar label="이자" text={`-${fmtMoney(m.interest)}`} ratio={m.interest / max} color="#ff6b6b" />}
      <div className="mt-0.5 flex items-center justify-between bg-ink/70 px-1.5 py-1">
        <span className="text-[11px]">{netLabel}</span>
        <span className={`font-pixel-lg text-[15px] ${m.net >= 0 ? 'text-good' : 'text-bad'}`}>
          {m.net >= 0 ? '+' : ''}
          {fmtMoney(m.net)}
        </span>
      </div>
    </div>
  );
}

/** 그 경기로 긴급 대출 전환·강제 매각이 일어났으면 요약 맨 위에 빨간 한 줄씩 */
function CashNotes({ notes }: { notes: string[] }) {
  const hit = notes.filter((n) => n.includes('긴급 대출') || n.includes('강제 매각'));
  if (!hit.length) return null;
  return (
    <div className="mb-1.5 bg-bad/20 px-2 py-1 text-[12px] leading-snug text-bad mob:text-[13px]" style={{ boxShadow: 'inset 3px 0 0 #ff6b6b' }} data-testid="cash-note">
      {hit.map((n, i) => (
        <div key={i}>⚠ {n}</div>
      ))}
    </div>
  );
}

function Single({ r, teams, userId }: { r: DayReport; teams: Team[]; userId: string }) {
  const freeAgents = useStore((s) => s.freeAgents);
  // 개막전: 오더지에서 고친 만큼을 한 줄로 되짚는다
  const season = useStore((s) => s.season);
  const edit = useUi((s) => s.orderEdit);
  const edits = !r.post && r.day === 0 && edit?.season === season ? PART_LABEL.filter(([k]) => edit.from[k] !== edit.to[k]) : [];
  const seed = useStore((s) => s.seed);
  const pre = useUi((s) => (r.post ? undefined : s.chances[chanceKey({ seed, season, phase: 'season', day: r.day })]));
  const res = r.result;
  const away = teams.find((t) => t.id === res.awayId);
  const home = teams.find((t) => t.id === res.homeId);
  const name = (pid?: string) => findPlayer({ teams, freeAgents }, pid)?.name;
  const teamOf = (pid?: string) => (pid ? teams.find((t) => t.roster.some((p) => p.id === pid)) : undefined);
  const tag = (t: Team | undefined) => <TeamTag team={t} mine={t?.id === userId} size={10} />;
  const scoring = res.events.filter((e) => e.type === 'hr' || e.type === 'score' || e.type === 'walkoff');
  const n = Math.max(9, res.innings, res.line[0].length, res.line[1].length);
  const verdict = r.won === null ? '무승부' : r.won ? '승리!' : '패배';
  const vColor = r.won === null ? 'text-sky' : r.won ? 'text-hi' : 'text-bad';

  return (
    <>
      <CashNotes notes={r.notes} />
      {pre !== undefined && (
        <div className="mb-1 text-[12px] text-white/70 mob:text-[13px]" data-testid="pre-result">
          경기 전 <span className="text-hi">{pre}%</span> → <span className={vColor}>{r.won === null ? '무승부' : r.won ? '승리' : '패배'}</span>
        </div>
      )}
      <div className="flex items-center justify-between">
        <div>
          <div className={`anim-pop font-pixel-lg text-[26px] leading-none ${vColor}`} style={{ textShadow: '2px 2px 0 #0f1420' }}>
            {verdict}
          </div>
          <div className="mt-1 text-[10px] text-white/55">
            {r.post ? `${r.post.name} ${r.post.gameNo}차전` : `${r.day + 1}차전 · ${dowOf(r.day)}요일 ${r.night ? '야간' : '주간'}`} · {r.isHome ? '홈' : '원정'}
          </div>
          {r.post && (
            <div className="mt-1 text-[13px]">
              시리즈 <span className="font-pixel-lg text-[16px] text-hi">{r.post.myW}승 {r.post.oppW}패</span>
              <span className="ml-1 text-[11px] text-white/50">{Math.floor(r.post.bestOf / 2) + 1}선승제</span>
            </div>
          )}
        </div>
        <div className="text-right text-[11px]">
          <div className="text-white/50">{r.post ? '정규시즌' : '순위'}</div>
          <RankMove before={r.rankBefore} after={r.rankAfter} />
        </div>
      </div>

      {/* 라인스코어 */}
      <div className="mt-2 shrink-0 overflow-x-auto bg-ink p-1.5" style={{ boxShadow: '0 0 0 1px #0f1420' }}>
        <table className="w-full border-collapse text-center text-[12px]">
          <thead>
            <tr className="text-[10px] text-white/45">
              <th className="text-left font-normal">팀</th>
              {Array.from({ length: n }, (_, i) => (
                <th key={i} className="w-5 font-normal">
                  {i + 1}
                </th>
              ))}
              <th className="w-7 font-normal text-hi">R</th>
              <th className="w-7 font-normal">H</th>
            </tr>
          </thead>
          <tbody>
            {([0, 1] as const).map((side) => {
              const t = side === 0 ? away : home;
              const total = side === 0 ? res.away : res.home;
              return (
                <tr key={side} className={t?.id === userId ? 'text-white' : 'text-white/70'}>
                  <td className="text-left">
                    <span className="flex items-center gap-1 whitespace-nowrap">
                      <TeamDot team={t} />
                      {t?.name}
                    </span>
                  </td>
                  {Array.from({ length: n }, (_, i) => {
                    const v = res.line[side][i];
                    return (
                      <td key={i} className={v ? 'text-good' : 'text-white/45'}>
                        {v ?? (side === 1 && i < res.innings ? 'x' : '')}
                      </td>
                    );
                  })}
                  <td className="font-pixel-lg text-[14px] text-hi">{total}</td>
                  <td>{res.hits[side]}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {edit && edits.length > 0 && (
        <div className="mt-1.5 bg-ink/70 px-1.5 py-1 text-[11px]" style={{ boxShadow: 'inset 2px 0 0 #6ee07a' }} data-testid="order-edit">
          <span className="text-white/60">오더 수정: </span>
          {edits.map(([k, label], i) => (
            <span key={k} className="whitespace-nowrap">
              {i > 0 && ' · '}
              {label} {edit.from[k]} → <span className={edit.to[k] > edit.from[k] ? 'text-good' : 'text-bad'}>{edit.to[k]}</span>
            </span>
          ))}
        </div>
      )}

      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px]">
        {res.winP && (
          <span>
            <span className="bg-good px-1 text-ink">승</span> {tag(teamOf(res.winP))} {name(res.winP) ?? '-'}
          </span>
        )}
        {res.lossP && (
          <span>
            <span className="bg-bad px-1 text-ink">패</span> {tag(teamOf(res.lossP))} {name(res.lossP) ?? '-'}
          </span>
        )}
        {res.saveP && (
          <span>
            <span className="bg-sky px-1 text-ink">세</span> {tag(teamOf(res.saveP))} {name(res.saveP) ?? '-'}
          </span>
        )}
        {res.mvp && (
          <span className="text-hi">
            <span className="bg-hi px-1 text-ink">MVP</span> {tag(teams.find((t) => t.id === res.mvp?.teamId))} {res.mvp.name} <span className="text-white/70">{res.mvp.text}</span>
          </span>
        )}
      </div>

      {scoring.length > 0 && (
        <div className="mt-2 flex flex-col gap-[3px]" data-testid="score-log">
          <div className="text-[11px] text-sky">▸ 득점 기록</div>
          {scoring.map((e, i) => {
            const mine = e.teamId === userId;
            return (
              <div key={i} className={`flex items-center gap-1.5 px-1.5 py-[3px] text-[11px] leading-snug mob:text-[12px] ${mine ? 'bg-good/10' : 'bg-bad/10'}`} style={{ boxShadow: `inset 3px 0 0 ${mine ? '#6ee07a' : '#ff6b6b'}` }} data-testid="score-row" data-mine={mine ? '1' : '0'}>
                <span className="w-9 shrink-0 text-[10px] text-white/55">
                  {e.inning}회{e.half === 0 ? '초' : '말'}
                </span>
                {tag(teams.find((t) => t.id === e.teamId))}
                <span className={`min-w-0 flex-1 ${mine ? 'text-white' : 'text-white/75'}`}>{e.text}</span>
                <span className="shrink-0 text-hi">
                  {e.away}:{e.home}
                </span>
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-2 grid grid-cols-2 gap-2 por:grid-cols-1">
        <div className="bg-panel-2 p-1.5" style={{ boxShadow: '0 0 0 1px #0f1420' }}>
          <div className="mb-1 text-[11px] text-sky">▸ 관중</div>
          {r.crowd ? (
            <>
              <div className="flex items-baseline justify-between">
                <span>
                  <span className="font-pixel-lg text-[16px]">{fmtInt(r.crowd.attendance)}</span>
                  <span className="text-[10px] text-white/50"> / {fmtInt(r.crowd.capacity)}</span>
                </span>
                <span className="text-[11px]">
                  {WEATHER_ICON[r.crowd.weather]} {WEATHER_KO[r.crowd.weather]}
                </span>
              </div>
              <Bar ratio={r.crowd.attendance / Math.max(1, r.crowd.capacity)} color={r.crowd.soldOut ? '#ffd84a' : '#7fd3ff'} h={8} className="my-1" />
              {r.crowd.soldOut && <div className="anim-blink text-[11px] text-hi">매진!</div>}
              {r.crowd.turnedAway > 0 && (
                <div className="text-[10px] text-bad">🚶 발길 돌린 팬 {fmtInt(r.crowd.turnedAway)}명</div>
              )}
            </>
          ) : (
            <div className="text-[10px] text-white/45">원정 경기 (입장·매점 수입 없음)</div>
          )}
          {(r.notes.length > 0 || res.injuries.length > 0) && <div className="mt-1.5 mb-0.5 text-[11px] text-sky">▸ 소식</div>}
          {res.injuries
            .filter((x) => x.teamId === userId)
            .map((x) => (
              <div key={x.pid} className="text-[10px] text-bad">
                ✚ {x.name} 부상 ({x.games}경기 결장)
              </div>
            ))}
          {r.notes
            .filter((t) => !t.startsWith('부상: ')) /* 부상은 위의 ✚ 줄로 이미 나왔다 */
            .slice(0, 6)
            .map((t, i) => (
            <div key={i} className="text-[10px] leading-snug text-white/80">
              · {t}
            </div>
          ))}
        </div>
        <div className="bg-panel-2 p-1.5" style={{ boxShadow: '0 0 0 1px #0f1420' }}>
          <div className="mb-1 text-[11px] text-sky">▸ 오늘의 정산</div>
          <MoneyBlock m={r.money} />
        </div>
      </div>
    </>
  );
}

function Multi({ rs, teams }: { rs: DayReport[]; teams: Team[] }) {
  const w = rs.filter((r) => r.won === true).length;
  const l = rs.filter((r) => r.won === false).length;
  const t = rs.length - w - l;
  const sum = rs.reduce(
    (a, r) => {
      (Object.keys(a) as (keyof DayReport['money'])[]).forEach((k) => (a[k] += r.money[k]));
      return a;
    },
    { ticket: 0, food: 0, merch: 0, league: 0, salary: 0, upkeep: 0, interest: 0, net: 0 },
  );
  const homes = rs.filter((r) => r.crowd);
  const att = homes.reduce((a, r) => a + (r.crowd?.attendance ?? 0), 0);
  const sold = homes.filter((r) => r.crowd?.soldOut).length;
  const lastPost = rs[rs.length - 1].post;
  const notes = rs.flatMap((r) => r.notes.map((n) => ({ day: r.day, n }))).slice(-10);

  return (
    <>
      <CashNotes notes={rs.flatMap((r) => r.notes)} />
      <div className="flex items-center justify-between">
        <div>
          <div className="font-pixel-lg text-[20px] leading-none text-hi" style={{ textShadow: '2px 2px 0 #0f1420' }}>
            {rs.length}경기 진행 결과
          </div>
          <div className="mt-1 text-[13px]">
            <span className="text-good">{w}승</span> <span className="text-bad">{l}패</span>
            {t > 0 && <span className="text-sky"> {t}무</span>}
            {lastPost && (
              <span className="ml-2 text-hi">
                {lastPost.name} {lastPost.myW}승 {lastPost.oppW}패
              </span>
            )}
          </div>
        </div>
        <div className="text-right text-[11px]">
          <div className="text-white/50">순위</div>
          <RankMove before={rs[0].rankBefore} after={rs[rs.length - 1].rankAfter} />
        </div>
      </div>

      <div className="mt-2 flex flex-wrap gap-[3px]">
        {rs.map((r) => {
          const opp = teams.find((x) => x.id === r.oppId);
          const my = r.isHome ? r.result.home : r.result.away;
          const their = r.isHome ? r.result.away : r.result.home;
          const c = r.won === null ? '#7fd3ff' : r.won ? '#6ee07a' : '#ff6b6b';
          return (
            <div
              key={r.day}
              className="flex items-center gap-1 bg-ink px-1 py-[2px] text-[10px]"
              style={{ boxShadow: `inset 2px 0 0 ${c}` }}
              title={`${r.post ? `${r.post.name} ${r.post.gameNo}` : r.day + 1}차전 ${r.isHome ? '홈' : '원정'} vs ${opp?.name ?? r.oppId}`}
            >
              <TeamDot team={opp} size={8} />
              <span style={{ color: c }}>
                {my}:{their}
              </span>
              {r.crowd?.soldOut && <span className="text-hi">★</span>}
            </div>
          );
        })}
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2 por:grid-cols-1">
        <div className="bg-panel-2 p-1.5" style={{ boxShadow: '0 0 0 1px #0f1420' }}>
          <div className="mb-1 text-[11px] text-sky">▸ 홈 관중</div>
          <div className="text-[11px]">
            홈 {homes.length}경기 · 총 <span className="text-white">{fmtInt(att)}</span>명
          </div>
          <div className="text-[11px] text-white/70">
            평균 {fmtInt(homes.length ? Math.round(att / homes.length) : 0)}명 · 매진 <span className="text-hi">{sold}회</span>
          </div>
          {notes.length > 0 && <div className="mt-1.5 mb-0.5 text-[11px] text-sky">▸ 소식</div>}
          {notes.map((x, i) => (
            <div key={i} className="text-[10px] leading-snug text-white/80">
              · {x.n}
            </div>
          ))}
        </div>
        <div className="bg-panel-2 p-1.5" style={{ boxShadow: '0 0 0 1px #0f1420' }}>
          <div className="mb-1 text-[11px] text-sky">▸ 기간 정산</div>
          <MoneyBlock m={sum} netLabel="기간 순익" />
        </div>
      </div>
    </>
  );
}

/** 경기 후 요약 카드 — 데스크톱은 야구장 영역 안에서만, 모바일(sheet)은 전체 화면 스크롤 시트. */
export default function GameSummary({ sheet = false }: { sheet?: boolean }) {
  const summary = useStore((s) => s.summary);
  const teams = useStore((s) => s.teams);
  const userId = useStore((s) => s.userId);
  const close = useStore((s) => s.closeSummary);
  const phase = useStore((s) => s.phase);
  const ended = phase === 'ended' || phase === 'over';
  if (!summary || !summary.length) return null;
  const body = summary.length === 1 ? <Single r={summary[0]} teams={teams} userId={userId} /> : <Multi rs={summary} teams={teams} />;

  if (sheet) {
    return (
      <div
        className="anim-sheet fixed inset-0 z-40 flex flex-col bg-panel"
        style={{
          paddingTop: 'env(safe-area-inset-top)',
          paddingBottom: 'env(safe-area-inset-bottom)',
          paddingLeft: 'env(safe-area-inset-left)',
          paddingRight: 'env(safe-area-inset-right)',
        }}
      >
        <div className="px-scroll min-h-0 flex-1 overflow-y-auto p-3">
          <div className="mx-auto max-w-[720px]">{body}</div>
        </div>
        <div className="shrink-0 bg-edge/60 p-2">
          <button className="px-btn primary mx-auto block min-h-11 w-full max-w-[720px] text-[15px]" onClick={close} autoFocus>
            {ended ? '시즌 결산 보기' : '확인'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-ink/70 p-3">
      <div className="px-panel px-scroll flex max-h-full w-full max-w-[560px] flex-col overflow-y-auto p-3">
        {body}
        <div className="mt-2.5 flex justify-end">
          <button className="px-btn primary !px-5 !py-1.5 text-[13px]" onClick={close} autoFocus>
            {ended ? '시즌 결산 보기' : '확인'}
          </button>
        </div>
      </div>
    </div>
  );
}
