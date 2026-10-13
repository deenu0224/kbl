import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { FacilityKind, StadiumFx, StadiumScene } from '../game/types';
import StadiumCanvas, { HOTSPOTS, STADIUM_H, STADIUM_W } from '../stadium/StadiumCanvas';
import { useCore, useStore, useUserTeam, userMatch } from '../store';
import { sceneExtras } from '../game/campaign';
import { fmtInt, fmtMoney } from '../game/format';
import { SEAT_LV, upgradeCost } from '../game/economy';
import { usePostLine } from './Bracket';
import EventCardModal from './EventCardModal';
import GameSummary, { TeamTag } from './GameSummary';
import { useIsMobile } from './layout/useLayout';
import { useUi } from './layout/uiStore';
import { awayFacilities, awayFanShare } from './layout/away';
import { TEAM_DEFS } from '../game/generate';
import { FAC_KO, WEATHER_ICON, WEATHER_KO, dowOf, isNightDay } from './ui';

const KINDS: FacilityKind[] = ['seats', 'food', 'training'];

function rectStyle(r: { x: number; y: number; w: number; h: number }): CSSProperties {
  return {
    left: `${(r.x / STADIUM_W) * 100}%`,
    top: `${(r.y / STADIUM_H) * 100}%`,
    width: `${(r.w / STADIUM_W) * 100}%`,
    height: `${(r.h / STADIUM_H) * 100}%`,
  };
}

/** cqw 글자 크기. 모바일에선 폰에서도 읽히도록 최소 px 를 보장한다. */
const fz = (mobile: boolean, cqw: number, minPx: number) => (mobile ? `max(${cqw}cqw, ${minPx}px)` : `${cqw}cqw`);

const chip: CSSProperties = {
  background: 'rgba(27,34,51,.88)',
  boxShadow: '0 0 0 0.25cqw #0f1420',
  fontSize: '1.7cqw',
  padding: '0.5cqw 1cqw',
  lineHeight: 1.25,
};

/** 하이라이트 재생 드라이버: 이벤트마다 타이머 하나 (App 에서 한 번). cleanup 으로 지우므로 StrictMode 이중 실행에도 안전. */
export function usePlaybackDriver(): void {
  const report = useStore((s) => s.playback?.report ?? null);
  const step = useStore((s) => s.playback?.step ?? 0);
  const stepPlayback = useStore((s) => s.stepPlayback);
  const fast = useUi((s) => s.fast);
  const evType = report?.result.events[step]?.type;
  useEffect(() => {
    if (!report) return;
    const ms = (evType === 'hr' || evType === 'walkoff' ? 2600 : 1800) * (fast ? 0.5 : 1);
    const id = window.setTimeout(stepPlayback, ms);
    return () => window.clearTimeout(id);
  }, [report, step, evType, stepPlayback, fast]);
}

/**
 * 세로 폰의 큰 구장: 높이에 맞춰 확대하고 좌우는 끌어서 본다. 두 번 탭하면 전체 보기(폭 맞춤) ↔ 확대.
 * 확대 여부와 가로 위치(0~1)는 uiStore 에 둔다: 탭을 옮기거나 경기가 시작·종료돼 구장이 다시 그려져도 그대로다.
 * 오버레이는 children 안에 있어 캔버스와 같이 움직이고, fixed 는 구장 영역의 화면 고정 자리에 놓인다.
 */
function PanZoom({ children, fixed, onTagsOff }: { children: (style: CSSProperties) => ReactNode; fixed?: ReactNode; onTagsOff(off: boolean): void }) {
  const zoomed = useUi((s) => s.stadiumZoom);
  const setView = useUi((s) => s.setStadiumView);
  const ref = useRef<HTMLDivElement | null>(null);
  const lastTap = useRef(0);
  const drag = useRef<{ x: number; left: number } | null>(null);
  const dims = useRef(''); // 마지막으로 위치를 맞춘 때의 크기 (크기가 바뀌며 생긴 스크롤은 저장하지 않는다)
  const check = (el: HTMLDivElement) => {
    const off = KINDS.some((k) => {
      const x = ((HOTSPOTS[k].x + HOTSPOTS[k].w / 2) / STADIUM_W) * el.scrollWidth - el.scrollLeft;
      return x < 28 || x > el.clientWidth - 28;
    });
    onTagsOff(off && useUi.getState().stadiumZoom); // 시설 태그 중 하나라도 화면 밖
  };
  // 저장해 둔 위치로 (마운트·확대 전환·영역 크기 변화 때마다)
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const apply = () => {
      const range = el.scrollWidth - el.clientWidth;
      dims.current = `${el.scrollWidth}/${el.clientWidth}`;
      el.scrollLeft = range * useUi.getState().stadiumPan;
      check(el);
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => ro.disconnect();
  }, [zoomed]);
  return (
    <div className="relative h-full w-full" style={{ containerType: 'size' }} data-testid="stadium-pan" data-zoomed={zoomed ? '1' : '0'}>
      <div
        ref={ref}
        className="no-scrollbar flex h-full w-full items-center overflow-x-auto overflow-y-hidden"
        style={{ overscrollBehavior: 'contain', background: '#0f1420' }}
        onScroll={(e) => {
          const el = e.currentTarget;
          const range = el.scrollWidth - el.clientWidth;
          if (dims.current !== `${el.scrollWidth}/${el.clientWidth}`) return;
          if (range > 0) setView({ pan: el.scrollLeft / range });
          check(el);
        }}
        onClick={(e) => {
          if ((e.target as Element).closest('button')) return;
          const now = performance.now();
          if (now - lastTap.current < 320) {
            lastTap.current = 0;
            setView({ zoom: !zoomed });
          } else lastTap.current = now;
        }}
        onPointerDown={(e) => {
          if (e.pointerType === 'mouse' && ref.current) drag.current = { x: e.clientX, left: ref.current.scrollLeft };
        }}
        onPointerMove={(e) => {
          if (drag.current && ref.current) ref.current.scrollLeft = drag.current.left - (e.clientX - drag.current.x);
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerLeave={() => (drag.current = null)}
      >
        {children({ width: zoomed ? `max(100cqw, calc(100cqh * ${STADIUM_W} / ${STADIUM_H}))` : '100cqw', flexShrink: 0 })}
      </div>
      {fixed}
    </div>
  );
}

const FAC_ICON: Record<FacilityKind, string> = { seats: '🏟', food: '🍢', training: '💪' };

export default function StadiumView({ pan = false }: { pan?: boolean }) {
  const core = useCore();
  const playback = useStore((s) => s.playback);
  const lastReport = useStore((s) => s.lastReport);
  const fans = useStore((s) => s.fans);
  const setFacSheet = useUi((s) => s.setFacSheet);
  const skipPlayback = useStore((s) => s.skipPlayback);
  const fxUp = useStore((s) => s.fx);
  const summaryOpen = useStore((s) => !!s.summary);
  const facilities = useStore((s) => s.facilities);
  const crowd = useStore((s) => s.crowd);
  const teams = useStore((s) => s.teams);
  const userId = useStore((s) => s.userId);
  const schedule = useStore((s) => s.schedule);
  const day = useStore((s) => s.day);
  const phase = useStore((s) => s.phase);
  const post = useStore((s) => s.post);
  const postLine = usePostLine();
  const setTab = useStore((s) => s.setTab);
  const user = useUserTeam();
  const mobile = useIsMobile();
  const [tagsOff, setTagsOff] = useState(false); // 확대해서 시설 태그가 화면 밖 (세로 폰): 하단 고정 버튼으로 대신한다
  const chipM: CSSProperties = mobile ? { ...chip, fontSize: fz(true, 1.9, 13), padding: '4px 7px', color: '#fff' } : chip;

  const report = playback?.report ?? null;
  const step = playback?.step ?? 0;
  const ev = report ? (report.result.events[step] ?? null) : null;

  const next = useMemo(
    () => (phase === 'season' || phase === 'post' ? userMatch({ schedule, userId, phase, post }, day) : null),
    [schedule, userId, day, phase, post],
  );
  // 원정이면 상대 구장: 재생 중·요약 중엔 그 경기, 경기 사이엔 다음 유저 경기가 원정인 동안 계속
  const shownRep = report ?? (summaryOpen ? lastReport : null);
  const away = shownRep ? !shownRep.isHome : !!next && !next.isHome;
  const awayRep = shownRep && !shownRep.isHome ? shownRep : null;
  const oppId = shownRep ? shownRep.oppId : next?.oppId;
  const opp = teams.find((t) => t.id === oppId);
  const cap = SEAT_LV[facilities.seats]?.cap ?? crowd?.capacity ?? 1;
  const idleFill = crowd ? Math.min(1, crowd.attendance / Math.max(1, cap)) : 0;

  // 게이트 밖 줄: 직전(또는 진행 중인) 홈경기에서 발길을 돌린 팬 / 좌석 수
  const gateCrowd = report ? (report.isHome ? report.crowd : null) : crowd;
  const gateQueue = gateCrowd ? Math.max(0, Math.min(1, gateCrowd.turnedAway / Math.max(1, gateCrowd.capacity))) : 0;
  const extras = useMemo(() => sceneExtras(core), [core]);

  const scene = useMemo<StadiumScene>(() => {
    let fill = idleFill;
    let fx: StadiumFx = { kind: 'none' };
    let fxKey = 0;
    let homeBatting = false;
    if (away) fill = Math.min(0.95, 0.45 + 0.5 * (TEAM_DEFS.find((d) => d.id === oppId)?.pop ?? 0.6));
    if (report) {
      if (!away) fill = report.isHome && report.crowd ? Math.min(1, report.crowd.attendance / Math.max(1, report.crowd.capacity)) : idleFill * 0.15;
      fxKey = (report.day + 1) * 100 + step;
      if (ev) {
        const mine = ev.teamId === userId;
        const cheer = mine && report.isHome;
        // 화면의 구장 주인("홈")은 실제 홈팀: 홈경기면 우리, 원정이면 상대 (관중은 구장 주인 편)
        homeBatting = ev.half === 1;
        const host = away ? !mine : mine;
        if (ev.type === 'hr') fx = { kind: 'hr', byHome: host, cheer: away ? host : cheer };
        else if (ev.type === 'score') fx = { kind: 'score', cheer: away ? host : cheer };
        else if (ev.type === 'walkoff') fx = host ? { kind: 'walkoff' } : { kind: 'score', cheer: false };
        else if (ev.type === 'injury') fx = { kind: 'injury' };
        else if (ev.type === 'final' && report.isHome && report.won === true) fx = { kind: 'win' };
      }
    } else if (fxUp) {
      fx = { kind: 'build', target: fxUp.kind };
      fxKey = fxUp.key;
    }
    if (away && opp) {
      return {
        facilities: awayFacilities(opp.id),
        homeColor: opp.color,
        homeColor2: opp.color2,
        awayColor: user.color,
        fill,
        weather: awayRep?.crowd?.weather ?? 'sunny',
        night: !!awayRep?.night,
        playing: !!report,
        homeBatting,
        fx,
        fxKey,
        banners: 0,
        oldBanner: false,
        cheerLv: 1,
        awayFans: awayFanShare(fans),
      };
    }
    return {
      facilities,
      homeColor: user.color,
      homeColor2: user.color2,
      awayColor: opp?.color ?? '#8892b0',
      fill,
      // 평소에는 맑게, 경기 중·요약 중에만 그날 날씨
      weather: report ? (report.crowd?.weather ?? 'sunny') : summaryOpen ? (crowd?.weather ?? 'sunny') : 'sunny',
      night: report ? report.night : false,
      playing: !!report,
      homeBatting,
      fx,
      fxKey,
      ...extras,
      gateQueue, // 재생 중에는 그 경기의 줄
    };
  }, [report, step, ev, fxUp, facilities, user.color, user.color2, opp, idleFill, crowd?.weather, summaryOpen, userId, gateQueue, extras, away, awayRep, fans, oppId]);

  const star = useMemo(() => user.roster.reduce<(typeof user.roster)[number] | null>((a, p) => (!a || p.star > a.star ? p : a), null), [user.roster]);

  // 관중 칩에 보여줄 값
  const shownCrowd = report ? report.crowd : crowd;
  const weather = scene.weather;

  const awayTeam = report ? teams.find((t) => t.id === report.result.awayId) : undefined;
  const homeTeam = report ? teams.find((t) => t.id === report.result.homeId) : undefined;
  const mineEv = ev?.teamId === userId;
  const evTeam = ev ? teams.find((t) => t.id === ev.teamId) : undefined;
  // 득점 장면은 왼쪽 띠로 편을 가른다: 우리 팀 초록, 상대 빨강
  const scoreEv = ev?.type === 'hr' || ev?.type === 'score' || ev?.type === 'walkoff';
  const band = scoreEv ? `max(1.2cqw, 6px) solid ${mineEv ? '#6ee07a' : '#ff6b6b'}` : undefined;
  const tagged = !!ev && ev.type !== 'start' && ev.type !== 'final';

  // 관중 칩: 세로 폰(pan)에서는 캔버스가 아니라 구장 영역의 좌상단에 고정한다 (확대해도 잘리지 않게)
  const crowdChip = (
        <button
          className={`absolute z-[2] flex items-center overflow-hidden whitespace-nowrap text-left ${mobile && !away ? 'cursor-pointer' : 'pointer-events-none'}`}
          data-testid="crowd-chip"
          data-sfx="tab"
          style={pan ? { ...chipM, left: 6, top: 6, gap: 6, maxWidth: 'calc(100% - 12px)' } : { ...chipM, left: '1.2cqw', top: '1.2cqw', gap: '1.2cqw' }}
          onClick={() => setFacSheet('ticket')}
        >
          <span title={WEATHER_KO[weather]}>{WEATHER_ICON[weather]}</span>
          {away ? (
            <span className="text-white/80">원정 · {opp?.city} 구장</span>
          ) : shownCrowd ? (
            <>
              <span>
                관중 <span className="text-hi">{fmtInt(shownCrowd.attendance)}</span>
                <span className="text-white/50"> / {fmtInt(shownCrowd.capacity)}</span>
              </span>
              {shownCrowd.soldOut && (
                <span className="anim-blink font-pixel-lg shrink-0" style={{ color: '#ff6b6b' }}>
                  매진!
                </span>
              )}
            </>
          ) : (
            <span className="text-white/70">좌석 {fmtInt(cap)}석 · 개막 대기</span>
          )}
          {report?.night && <span className="text-sky">야간</span>}
          {report?.post && <span className="text-hi">{report.post.name}</span>}
          {mobile && !away && <span className="text-hi">티켓 ▸</span>}
        </button>
  );
  // 확대해서 시설 태그가 화면 밖이면: 구장 하단의 작은 고정 버튼 3개
  const facButtons =
    pan && tagsOff && !away && !report ? (
      <div className="absolute bottom-1.5 left-1/2 z-[2] flex -translate-x-1/2 gap-1.5" data-testid="fac-fixed">
        {KINDS.map((kd) => (
          <button
            key={kd}
            className="flex h-9 min-w-11 cursor-pointer items-center justify-center gap-1 px-1.5 text-[13px] text-white"
            style={{ background: 'rgba(27,34,51,.9)', boxShadow: '0 0 0 2px #0f1420' }}
            aria-label={`${FAC_KO[kd]} Lv${facilities[kd] + 1}`}
            data-testid={`fac-fixed-${kd}`}
            data-sfx="tab"
            onClick={() => setFacSheet(kd)}
          >
            <span aria-hidden>{FAC_ICON[kd]}</span>
            <span className="text-hi">{facilities[kd] + 1}</span>
          </button>
        ))}
      </div>
    ) : null;

  // 모바일은 오버레이 글자를 한 단계 키운다 (확대한 구장에서 읽히게)
  const k = mobile ? 1.3 : 1;
  const body = (size: CSSProperties) => (
      <div
        className="relative overflow-hidden"
        data-testid="stadium"
        data-away={away ? '1' : '0'}
        style={{
          ...size,
          aspectRatio: `${STADIUM_W} / ${STADIUM_H}`,
          containerType: 'inline-size',
          boxShadow: '0 0 0 2px #0f1420',
          background: '#7fc96b',
        }}
      >
        <StadiumCanvas scene={scene} className="pixel absolute inset-0 block h-full w-full" />

        {/* 전광판 */}
        <div
          className="pointer-events-none absolute flex flex-col items-center justify-center overflow-hidden text-center"
          style={{ ...rectStyle(HOTSPOTS.scoreboard), color: '#ffd84a', lineHeight: 1.15, textShadow: '0 0 0.6cqw rgba(255,216,74,.6)' }}
        >
          {report && ev ? (
            <>
              <div style={{ fontSize: `${1.35 * k}cqw`, color: '#7fd3ff' }}>
                {ev.type === 'final' ? '경기 종료' : ev.type === 'start' ? '플레이볼' : `${ev.inning}회${ev.half === 0 ? '초' : '말'}`}
              </div>
              <div className="font-pixel-lg flex items-center" style={{ fontSize: `${2.6 * k}cqw`, gap: '0.8cqw' }}>
                <span style={{ fontSize: '1.5cqw', color: awayTeam?.id === userId ? '#fff' : '#b9c3e0' }}>{awayTeam?.id}</span>
                <span key={`a${ev.away}`} className={step > 0 ? 'anim-pop' : ''}>
                  {ev.away}
                </span>
                <span style={{ color: '#6b7694' }}>:</span>
                <span key={`h${ev.home}`} className={step > 0 ? 'anim-pop' : ''}>
                  {ev.home}
                </span>
                <span style={{ fontSize: '1.5cqw', color: homeTeam?.id === userId ? '#fff' : '#b9c3e0' }}>{homeTeam?.id}</span>
              </div>
            </>
          ) : next && opp ? (
            <>
              <div className="w-full truncate" style={{ fontSize: `${1.25 * k}cqw`, color: '#7fd3ff' }}>
                {postLine ? `${postLine.name} ${postLine.gameNo}차전` : `NEXT · ${day + 1}차전`}
              </div>
              <div className="font-pixel-lg w-full truncate" style={{ fontSize: `${1.9 * k}cqw` }}>
                vs {opp.name}
              </div>
              <div style={{ fontSize: `${1.25 * k}cqw`, color: '#fff' }}>
                {next.isHome ? '홈' : '원정'} · {postLine ? `${postLine.myW}승 ${postLine.oppW}패` : `${dowOf(day)}요일 ${isNightDay(day) ? '야간' : '주간'}`}
              </div>
            </>
          ) : (
            <div className="font-pixel-lg" style={{ fontSize: '1.9cqw' }}>
              {phase === 'draft' ? '스토브리그' : '시즌 종료'}
            </div>
          )}
        </div>

        {/* 시설 핫스팟 */}
        {!away && KINDS.map((k) => {
          const cost = upgradeCost(k, facilities);
          const built = fxUp?.kind === k && !report;
          return (
            <button
              key={k}
              className="group absolute cursor-pointer"
              style={rectStyle(HOTSPOTS[k])}
              data-testid={`fac-${k}`}
              onClick={() => (mobile ? setFacSheet(k) : setTab('right', 'stadium'))}
            >
              <span className="absolute inset-0 opacity-0 group-hover:opacity-100" style={{ boxShadow: 'inset 0 0 0 0.3cqw #ffd84a', background: 'rgba(255,216,74,.12)' }} />
              {pan && tagsOff ? null : mobile ? (
                // 터치에는 hover 가 없으므로 항상 작은 태그로 보인다
                <span
                  className="absolute bottom-[4%] left-1/2 -translate-x-1/2 whitespace-nowrap text-center"
                  style={{ ...chip, fontSize: 'max(1.9cqw, 13px)', padding: '3px 6px', color: '#fff', lineHeight: 1.2 }}
                >
                  {FAC_KO[k]} Lv{facilities[k] + 1}
                  {cost == null && <span style={{ color: '#6ee07a' }}> MAX</span>}
                </span>
              ) : (
                <span
                  className="absolute left-1/2 -translate-x-1/2 whitespace-nowrap opacity-0 group-hover:opacity-100"
                  style={{ ...chip, bottom: '100%', marginBottom: '0.6cqw', color: '#fff', fontSize: '1.5cqw' }}
                >
                  {FAC_KO[k]} Lv{facilities[k] + 1}
                  {cost == null && <span style={{ color: '#6ee07a' }}> MAX</span>}
                </span>
              )}
              {built && fxUp && (
                <span
                  key={fxUp.key}
                  className="anim-float font-pixel-lg pointer-events-none absolute left-1/2 top-0 -translate-x-1/2 whitespace-nowrap"
                  style={{ fontSize: fz(mobile, 2.2, 13), color: '#ffd84a', textShadow: '0.2cqw 0.2cqw 0 #0f1420' }}
                >
                  ▲ Lv{facilities[k] + 1}!
                </span>
              )}
            </button>
          );
        })}

        {!pan && crowdChip}

        {/* 하이라이트 배너 */}
        {report && ev && (
          <div className="pointer-events-none absolute inset-x-0 flex justify-center" style={{ top: '34%' }}>
            <div
              key={`${report.day}-${step}`}
              className="anim-pop text-center"
              style={{
                background: 'rgba(15,20,32,.82)',
                boxShadow: `0 0 0 0.3cqw ${mineEv ? user.color : '#0f1420'}, 0 0.8cqw 0 rgba(0,0,0,.25)`,
                borderLeft: band,
                padding: '1.2cqw 3cqw',
                maxWidth: mobile ? '92%' : '80%',
              }}
            >
              <div
                className="font-pixel-lg"
                style={{
                  fontSize: ev.type === 'hr' || ev.type === 'walkoff' ? fz(mobile, 4.4, 16) : fz(mobile, 3.4, 14),
                  lineHeight: 1.15,
                  color: ev.type === 'injury' ? '#ff6b6b' : mineEv ? '#ffd84a' : '#ffffff',
                  textShadow: '0.3cqw 0.3cqw 0 #0f1420',
                }}
              >
                {tagged && (
                  <span className="mr-[0.4em] inline-block align-middle" style={{ textShadow: 'none' }}>
                    <TeamTag team={evTeam} mine={mineEv} size={fz(mobile, 1.9, 11)} />
                  </span>
                )}
                {ev.text}
              </div>
              {ev.sub && <div style={{ fontSize: fz(mobile, 1.8, 12), color: '#b9c3e0', marginTop: '0.4cqw' }}>{ev.sub}</div>}
            </div>
          </div>
        )}

        {/* 재생 진행 + 건너뛰기 */}
        {report && (
          <div className="absolute inset-x-0 flex items-center justify-center" style={{ bottom: '20%', gap: '1.2cqw' }}>
            <div className="flex" style={{ gap: '0.4cqw' }}>
              {report.result.events.map((_, i) => (
                <span key={i} style={{ width: '1cqw', height: '1cqw', background: i <= step ? '#ffd84a' : 'rgba(15,20,32,.6)', boxShadow: '0 0 0 0.15cqw #0f1420' }} />
              ))}
            </div>
            {/* 모바일은 엄지 위치(액션 바)에 건너뛰기가 있다 */}
            {!mobile && (
              <button className="px-btn" style={{ fontSize: 'max(11px, 1.5cqw)' }} onClick={skipPlayback}>
                건너뛰기 ▶▶
              </button>
            )}
          </div>
        )}

        {/* 모바일 요약은 셸에서 전체 화면 시트로 띄운다 */}
        {!mobile && <GameSummary />}
        {!mobile && <EventCardModal />}
      </div>
  );

  if (pan) return <PanZoom fixed={<>{crowdChip}{facButtons}</>} onTagsOff={setTagsOff}>{body}</PanZoom>;
  return (
    <div className="flex h-full w-full items-center justify-center" style={{ containerType: 'size' }}>
      {body({ width: `min(100cqw, calc(100cqh * ${STADIUM_W} / ${STADIUM_H}))` })}
    </div>
  );
}
