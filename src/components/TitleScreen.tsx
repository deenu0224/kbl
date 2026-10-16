import { SCANDAL_NEWS } from '../game/story';
import { VersionBadge } from './WhatsNew';
import { DONATE_URL, FEEDBACK_URL, gmCount, track, type GmCount } from '../analytics';
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import type { StadiumScene } from '../game/types';
import { HOF_END_KO, HOF_RECORD_KO, clubOf, hofWorthy, type HofClub, type HofRecordKey } from '../game/hof';
import { HofDetail } from './HofDetail';
import { TEAM_DEFS, USER_ID } from '../game/generate';
import { fmtInt, fmtMoney } from '../game/format';
import { rankOf } from '../game/season';
import StadiumCanvas, { HOTSPOTS, STADIUM_H, STADIUM_W } from '../stadium/StadiumCanvas';
import { pickCore, useStore } from '../store';
import { Flag, stageLabel } from './Campaign';
import { hofCloseClub, useHof } from './hofStore';
import { useAchv } from './achvStore';
import { useUi } from './layout/uiStore';
import { parseFrom } from '../share/shareData';
import { ShareClubButton } from './ShareSheet';
import Help from './Help';
import { installed } from './layout/installed';

const DEF = TEAM_DEFS.find((d) => d.id === USER_ID)!;
export const NICK_DEFAULT = DEF.name;
export const NICK_MAX = 8;

const safe: CSSProperties = {
  paddingTop: 'max(env(safe-area-inset-top), 12px)',
  paddingBottom: 'max(env(safe-area-inset-bottom), 16px)',
  paddingLeft: 'max(env(safe-area-inset-left), 16px)',
  paddingRight: 'max(env(safe-area-inset-right), 16px)',
};

/** 우리 구장(빈 좌석, 바랜 깃발)을 화면에 꽉 채운 배경 */
function Backdrop({ dim = 0.55 }: { dim?: number }) {
  const facilities = useStore((s) => s.facilities);
  const hasSave = useUi((s) => s.hasSave);
  const scene = useMemo<StadiumScene>(
    () => ({
      facilities: hasSave ? facilities : { seats: 0, food: 0, training: 0 },
      homeColor: DEF.color,
      homeColor2: DEF.color2,
      awayColor: '#8892b0',
      fill: 0.12,
      weather: 'sunny',
      night: false,
      playing: false,
      homeBatting: false,
      fx: { kind: 'none' },
      fxKey: 0,
      banners: 0,
      oldBanner: true,
    }),
    [facilities, hasSave],
  );
  return (
    <div className="absolute inset-0 overflow-hidden bg-[#0f1420]">
      <StadiumCanvas scene={scene} className="pixel absolute top-0 left-1/2 block h-[62%] w-auto max-w-none -translate-x-1/2" />
      <div className="absolute inset-0" style={{ background: `linear-gradient(180deg, rgba(15,20,32,${dim * 0.8}) 0%, rgba(15,20,32,${Math.min(0.92, dim + 0.2)}) 38%, #141a29 66%)` }} />
    </div>
  );
}

function Logo({ nick }: { nick: string }) {
  return (
    <div className="relative text-center" data-testid="logo">
      <div className="font-pixel-lg title-logo whitespace-nowrap text-[44px] leading-none tracking-[2px] text-hi short:text-[34px]">답답해서 내가</div>
      <div className="font-pixel-lg title-logo mt-2 whitespace-nowrap text-[20px] leading-tight text-white short:text-[17px]">야구 단장을 해도 될까?</div>
      <div className="font-pixel-lg title-logo mt-3 text-[18px] leading-tight short:text-[16px]" style={{ color: DEF.color }}>
        {DEF.city} {nick}
      </div>
      <GmCountLine />
    </div>
  );
}

/** "지금까지 단장 n명 · 오늘 n명": 집계를 읽었을 때만 뜬다 (자리는 미리 잡아 두어 화면이 밀리지 않게) */
function GmCountLine() {
  const [n, setN] = useState<GmCount | null>(null);
  useEffect(() => {
    let live = true;
    void gmCount().then((v) => live && setN(v));
    return () => {
      live = false;
    };
  }, []);
  return (
    <div className="title-logo mt-2 min-h-[36px] text-[13px] leading-tight text-white/75" data-testid="gm-count">
      {n && (
        <>
          지금까지 단장 <span className="text-hi">{fmtInt(n.total)}명</span>
          {n.seasons > 0 && (
            <>
              {' · '}
              <span className="text-hi">{fmtInt(n.seasons)}시즌</span>
            </>
          )}
          {(n.champ > 0 || n.moved > 0) && (
            <span className="mt-1 block text-white/65" data-testid="gm-count-ends">
              {n.champ > 0 && (
                <>
                  우승 <span className="text-hi">{fmtInt(n.champ)}번</span>
                </>
              )}
              {n.champ > 0 && n.moved > 0 && ' · '}
              {n.moved > 0 && <>연고 이전 {fmtInt(n.moved)}번</>}
            </span>
          )}
        </>
      )}
    </div>
  );
}

// ───────── 명예의 전당 ─────────

const PLAYER_KO = { retired: '영구결번', mvp: '리그 MVP', rookie: '신인왕' } as const;
const recText = (k: HofRecordKey, v: number): string => (k === 'wins' ? `${v}승` : k === 'pct' ? v.toFixed(3).replace(/^0/, '') : k === 'avgAtt' ? `${fmtInt(v)}명` : fmtMoney(v));

export function HallOfFame({ onClose }: { onClose: () => void }) {
  const hof = useHof((s) => s.hof);
  const empty = !hof.clubs.length && !hof.players.length && !Object.keys(hof.records).length;
  const H = ({ children }: { children: string }) => <div className="mt-4 mb-1 text-[13px] text-sky">{children}</div>;
  const [open, setOpen] = useState<{ club: HofClub; season?: number } | null>(null);
  // 같은 별칭의 구단이 여럿이면 1기·2기 (목록은 최신이 위 — 아래에 남은 같은 이름 수로 기수를 센다)
  const genOf = (c: HofClub): number | undefined => {
    const i = hof.clubs.indexOf(c);
    return hof.clubs.filter((x) => x.nick === c.nick).length > 1 && i >= 0 ? hof.clubs.slice(i).filter((x) => x.nick === c.nick).length : undefined;
  };
  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-[#141a29] font-pixel text-[13px]" style={safe} data-testid="hof">
      <div className="flex shrink-0 items-center justify-between">
        <span className="font-pixel-lg flex items-center gap-2 text-[20px] text-hi">
          <Flag size={18} /> 명예의 전당
        </span>
        <button className="px-btn min-h-11 px-4 text-[14px]" onClick={onClose}>
          닫기
        </button>
      </div>
      <div className="px-scroll mx-auto min-h-0 w-full max-w-[560px] flex-1 overflow-y-auto pt-1">
        {empty ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-white/55" data-testid="hof-empty">
            <Flag size={40} faded />
            <span className="text-[14px]">아직 기록이 없습니다</span>
            <span className="text-[13px] text-white/40">한 시즌을 마치면 여기에 남습니다</span>
          </div>
        ) : (
          <>
            <H>역대 구단</H>
            {hof.clubs.length ? (
              hof.clubs.map((c, i) => (
                <div key={c.seed} className="mb-1 min-h-12 cursor-pointer bg-panel px-2 py-1.5 active:bg-white/5" style={{ boxShadow: '0 0 0 1px #0f1420' }} onClick={() => setOpen({ club: c })} data-testid="hof-club">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-pixel-lg truncate text-[16px]" style={{ color: DEF.color }}>
                      {DEF.city} {c.nick}
                      {/* 같은 별칭의 구단이 여럿이면 1기·2기 (목록은 최신이 위 — 아래에 남은 같은 이름 수로 기수를 센다) */}
                      {hof.clubs.filter((x) => x.nick === c.nick).length > 1 && (
                        <span className="ml-1 text-[13px] text-white/60" data-testid="hof-gen">
                          {hof.clubs.slice(i).filter((x) => x.nick === c.nick).length}기
                        </span>
                      )}
                    </span>
                    <span className={`shrink-0 ${c.end === 'champion' ? 'text-hi' : c.end === 'relocated' ? 'text-bad' : 'text-white/60'}`}>{HOF_END_KO[c.end]}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="text-white/75">
                        {c.seasons}시즌 · {stageLabel(c.stage)} · 우승 {c.titles}회 · ★ {c.stars}
                      </div>
                      <div className="flex justify-between gap-2 text-white/50">
                        <span className="truncate">순위 {c.ranks.join('-')}</span>
                        <span className="shrink-0">{c.date}</span>
                      </div>
                    </div>
                    <span onClick={(e) => e.stopPropagation()}>
                      <ShareClubButton club={c} />
                    </span>
                  </div>
                  {c.best && (
                    <div className="text-white/75" data-testid="hof-best">
                      최고 시즌 {c.best.nth}시즌째 · 단장 <span className="text-hi">{c.best.id}</span> · {c.best.name} · {c.best.score}점
                    </div>
                  )}
                  {(c.give || c.dome) && (
                    <div className="text-hi/90" data-testid="hof-give">
                      {[c.dome ? '섬에 돔을 세웠다' : '', c.give ? `도민 환원 누적 ${fmtMoney(c.give)}` : ''].filter(Boolean).join(' · ')}
                    </div>
                  )}
                  {c.tainted && <div className="text-white/50">{SCANDAL_NEWS.tainted}</div>}
                </div>
              ))
            ) : (
              <div className="text-white/45">끝난 구단이 아직 없습니다</div>
            )}
            <H>기록</H>
            {(Object.keys(HOF_RECORD_KO) as HofRecordKey[]).map((k) => {
              const r = hof.records[k];
              const club = r ? clubOf(hof, r.seed, r.nick, r.season) : null;
              return (
                <div
                  key={k}
                  className={`mb-1 flex min-h-12 items-center justify-between gap-2 bg-panel px-2 ${club ? 'cursor-pointer active:bg-white/5' : ''}`}
                  style={{ boxShadow: '0 0 0 1px #0f1420' }}
                  onClick={club && r ? () => setOpen({ club, season: r.season }) : undefined}
                  data-testid="hof-record"
                >
                  <span className="text-white/70">{HOF_RECORD_KO[k]}</span>
                  {r ? (
                    <span className="text-right">
                      <span className="font-pixel-lg text-[16px] text-hi">{recText(k, r.value)}</span>
                      <span className="ml-2 text-white/50">
                        {r.nick} {r.season}시즌
                      </span>
                    </span>
                  ) : (
                    <span className="text-white/35">—</span>
                  )}
                </div>
              );
            })}
            <H>선수</H>
            {hof.players.length ? (
              hof.players.map((p, i) => {
                const club = clubOf(hof, p.seed, p.nick, p.season);
                return (
                <div
                  key={i}
                  className={`mb-1 flex min-h-12 items-center justify-between gap-2 bg-panel px-2 ${club ? 'cursor-pointer active:bg-white/5' : ''}`}
                  style={{ boxShadow: '0 0 0 1px #0f1420' }}
                  onClick={club ? () => setOpen({ club, season: p.season }) : undefined}
                  data-testid="hof-player"
                >
                  <span className="min-w-0 truncate">
                    <span className={p.kind === 'retired' ? 'text-hi' : 'text-sky'}>{PLAYER_KO[p.kind]}</span> <span className="text-[15px]">{p.name}</span>
                    {p.note && <span className="ml-1 text-white/50">{p.note}</span>}
                  </span>
                  <span className="shrink-0 text-white/50">
                    {p.nick} {p.season}시즌
                  </span>
                </div>
                );
              })
            ) : (
              <div className="text-white/45">영구결번·MVP·신인왕이 나오면 여기에 남습니다</div>
            )}
          </>
        )}
      </div>
      {open && <HofDetail club={open.club} gen={genOf(open.club)} season={open.season} onClose={() => setOpen(null)} />}
    </div>
  );
}

// ───────── 별칭 입력 ─────────

const VIEW = { x: 225, y: 40, w: 190, h: 95 }; // 전광판 둘레만 잘라 보여 준다

function NickEntry({ onBack }: { onBack: () => void }) {
  // 기본값은 지난번에 쓴 별칭 (지금 세이브의 구단, 없으면 명예의 전당의 가장 최근 구단)
  const lastNick = useStore((st) => (useUi.getState().hasSave ? st.teams.find((t) => t.id === st.userId)?.name : undefined)) ?? useHof.getState().hof.clubs[0]?.nick;
  const [nick, setNick] = useState(lastNick || NICK_DEFAULT);
  const name = nick.trim();
  const ok = name.length >= 1 && [...name].length <= NICK_MAX;
  const sb = HOTSPOTS.scoreboard;
  const scene = useMemo<StadiumScene>(
    () => ({ facilities: { seats: 0, food: 0, training: 0 }, homeColor: DEF.color, homeColor2: DEF.color2, awayColor: '#8892b0', fill: 0, weather: 'sunny', night: false, playing: false, homeBatting: false, fx: { kind: 'none' }, fxKey: 0, banners: 0, oldBanner: true }),
    [],
  );
  const start = () => {
    if (!ok) return;
    const ui = useUi.getState();
    // 지금 구단이 한 시즌 이상 진행됐으면 명예의 전당에 남기고 덮어쓴다
    if (ui.hasSave) {
      const core = pickCore(useStore.getState());
      if (hofWorthy(core)) hofCloseClub(core, 'abandoned');
    }
    useStore.getState().newGame(name);
    track('new-game');
    // 공유 링크의 ?from= 은 시작하면 지운다
    if (window.location.search) window.history.replaceState(null, '', window.location.pathname);
    useUi.setState({ hasSave: true, screen: 'game', tab: 'home', orderOpen: true, orderBase: null, orderEdit: null, draftPeek: false, eventHidden: null });
  };
  return (
    <div className="relative mx-auto flex w-full max-w-[420px] flex-1 flex-col justify-center gap-4" data-testid="nick-entry">
      <div className="text-center text-[14px] text-white/75">구단 별칭을 정하세요</div>
      <div className="relative w-full overflow-hidden" style={{ aspectRatio: `${VIEW.w} / ${VIEW.h}`, boxShadow: '0 0 0 2px #0f1420' }}>
        <div className="absolute" style={{ width: `${(STADIUM_W / VIEW.w) * 100}%`, left: `${(-VIEW.x / VIEW.w) * 100}%`, top: `${(-VIEW.y / VIEW.h) * 100}%`, aspectRatio: `${STADIUM_W} / ${STADIUM_H}`, containerType: 'inline-size' }}>
          <StadiumCanvas scene={scene} className="pixel absolute inset-0 block h-full w-full" />
          <div
            className="absolute flex flex-col items-center justify-center overflow-hidden text-center"
            style={{ left: `${(sb.x / STADIUM_W) * 100}%`, top: `${(sb.y / STADIUM_H) * 100}%`, width: `${(sb.w / STADIUM_W) * 100}%`, height: `${(sb.h / STADIUM_H) * 100}%`, color: '#ffd84a', textShadow: '0 0 0.6cqw rgba(255,216,74,.6)' }}
          >
            <span style={{ fontSize: '1.5cqw', color: '#7fd3ff' }}>{DEF.id} · {DEF.city}</span>
            <span className="font-pixel-lg w-full truncate" style={{ fontSize: `${Math.min(3, 17 / Math.max(4, [...(name || ' ')].length + 3))}cqw` }} data-testid="nick-preview">
              {DEF.city} {name || '　'}
            </span>
          </div>
        </div>
      </div>
      <label className="flex items-center justify-center gap-2 text-[18px]">
        <span className="font-pixel-lg" style={{ color: DEF.color }}>
          {DEF.city}
        </span>
        <input
          value={nick}
          maxLength={NICK_MAX}
          data-testid="nick-input"
          aria-label="구단 별칭"
          className="h-[52px] w-[11em] min-w-0 bg-ink px-3 text-center font-pixel-lg !text-[20px] text-white select-text"
          style={{ boxShadow: '0 0 0 2px #0f1420, inset 0 0 0 2px #ffd84a' }}
          onChange={(e) => setNick(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && start()}
        />
      </label>
      <div className="text-center text-[13px] text-white/50">
        1~{NICK_MAX}자 · 연고지({DEF.city})·약칭({DEF.id})·구단 색은 고정입니다
      </div>
      <div className="flex gap-2">
        <button className="px-btn min-h-[52px] flex-1 text-[15px]" onClick={onBack}>
          뒤로
        </button>
        <button className="px-btn primary min-h-[52px] flex-[2] text-[17px]" data-testid="nick-start" disabled={!ok} onClick={start}>
          시작
        </button>
      </div>
    </div>
  );
}

// ───────── 초기 화면 ─────────

/** 앱을 열면 항상 여기서 시작한다: 이어하기 · 새로하기 · 명예의 전당 · 설정 */
export default function TitleScreen() {
  const hasSave = useUi((s) => s.hasSave);
  const setScreen = useUi((s) => s.setScreen);
  const setSettingsOpen = useUi((s) => s.setSettingsOpen);
  const [view, setView] = useState<'menu' | 'confirm' | 'nick' | 'hof'>('menu');
  // 공유한 사람의 결과 유형(&from=w6): 있으면 "누군가 6시즌 만에 우승한 리그입니다"
  const [from] = useState(() => parseFrom(window.location.search));
  const begin = () => setView(hasSave ? 'confirm' : 'nick');
  const team = useStore((s) => s.teams.find((t) => t.id === s.userId));
  const teams = useStore((s) => s.teams);
  const season = useStore((s) => s.season);
  const day = useStore((s) => s.day);
  const total = useStore((s) => s.schedule.length);
  const stage = useStore((s) => s.campaign.stage);
  const line = team ? `${team.city} ${team.name} · ${season}시즌 ${Math.min(day, total)}경기 · ${stage + 1}장 · ${rankOf(teams, team.id)}위` : '';
  const big = 'px-btn min-h-[54px] w-full text-[17px]';

  return (
    <div className="fixed inset-0 z-[65] flex flex-col font-pixel text-[13px] select-none" style={safe} data-testid="title">
      <Backdrop dim={view === 'menu' ? 0.5 : 0.8} />
      {view === 'nick' ? (
        <NickEntry onBack={() => setView('menu')} />
      ) : (
        <div className="relative mx-auto flex w-full max-w-[420px] flex-1 flex-col land:max-w-[720px] land:flex-row land:items-center land:gap-6">
          <div className="flex flex-[5] flex-col items-center justify-center land:flex-1">
            <Logo nick={hasSave && team ? team.name : NICK_DEFAULT} />
          </div>
          {view === 'confirm' ? (
            <div className="flex flex-[6] flex-col justify-center gap-3 land:flex-1" data-testid="overwrite">
              <div className="bg-panel p-3 text-center text-[14px] leading-relaxed" style={{ boxShadow: '0 0 0 2px #0f1420' }}>
                <div className="text-hi">지금 구단을 덮어씁니다</div>
                <div className="mt-1 text-[13px] text-white/60">{line}</div>
                <div className="mt-1 text-[13px] text-white/45">한 시즌 이상 치른 구단은 명예의 전당에 “진행 중 종료”로 남습니다</div>
              </div>
              <button className={`${big} primary`} data-testid="overwrite-ok" onClick={() => setView('nick')}>
                새 구단 만들기
              </button>
              <button className={big} onClick={() => setView('menu')}>
                취소
              </button>
            </div>
          ) : (
            <div className="flex flex-[6] flex-col justify-center gap-3 land:flex-1 land:gap-2">
              {from && (
                <div className="bg-panel p-2 text-center text-[14px] leading-snug text-hi" style={{ boxShadow: '0 0 0 2px #0f1420' }} data-testid="from-note">
                  {from.who}
                  <div className="mt-0.5 text-[13px] text-white/60">{from.ask}</div>
                </div>
              )}
              <button className={`${big} primary flex flex-col items-center justify-center !py-2 leading-tight`} data-testid="continue" disabled={!hasSave} onClick={() => setScreen('game')}>
                이어하기
                <span className="mt-0.5 text-[13px] text-white/75">{hasSave ? line : '저장된 구단이 없습니다'}</span>
              </button>
              <button className={big} data-testid="new-game" onClick={() => begin()}>
                새로하기
              </button>
              <button className={big} data-testid="open-hof" onClick={() => setView('hof')}>
                명예의 전당
              </button>
              <button className={big} data-testid="open-achv" onClick={() => useAchv.getState().setOpen(true)}>
                도전과제
              </button>
              <button className={big} data-testid="open-settings" onClick={() => setSettingsOpen(true)}>
                설정
              </button>
              {/* 홈 화면 앱이 아니면 설치 안내 한 줄 (사파리의 7일 저장 삭제를 피한다) */}
              {!installed() && (
                <div className="mt-1 flex min-h-10 items-center justify-center gap-1.5 text-[13px] text-white/70" data-testid="install-hint">
                  📲 홈 화면에 추가하면 세이브가 더 안전해요
                  <Help topic="install" />
                </div>
              )}
              {FEEDBACK_URL && (
                <a className="mt-1 flex min-h-10 items-center justify-center text-[13px] text-sky underline" href={FEEDBACK_URL} target="_blank" rel="noopener noreferrer" data-testid="feedback" onClick={() => track('feedback')}>
                  의견 보내기 — 불편한 점을 알려 주세요
                </a>
              )}
              {DONATE_URL && (
                <a className="flex min-h-10 items-center justify-center text-[13px] text-hi underline" href={DONATE_URL} target="_blank" rel="noopener noreferrer" data-testid="donate" onClick={() => track('donate')}>
                  ☕ 재미있었다면 — 개발자에게 커피 한 잔
                </a>
              )}
              <div className="flex justify-center">
                <VersionBadge />
              </div>
            </div>
          )}
        </div>
      )}
      {view === 'hof' && <HallOfFame onClose={() => setView('menu')} />}
    </div>
  );
}
