import { useEffect, useMemo, useState } from 'react';
import { useStore, userMatch, useUserTeam } from '../../store';
import { MobileActionBar, PreGame, useMatchActions } from '../BottomBar';
import GameSummary from '../GameSummary';
import { MarketTab } from '../LeftPanel';
import Squad from '../roster/Squad';
import { fmtMoney } from '../../game/format';
import EventCardModal from '../EventCardModal';
import OrderSheet from '../OrderSheet';
import { FinanceTab, LeagueTab, NewsTab, StadiumTab, useHintTabs } from '../RightPanel';
import StadiumView from '../StadiumView';
import { MobileTopBar, RunwayWarn } from '../TopBar';
import { CampaignChip } from '../Campaign';
import { TodoCard, TodoLines } from '../Todo';
import { useWinChance } from '../useWinChance';
import { TabBar, TeamDot } from '../ui';
import MobileNav, { TAB_TODO } from './MobileNav';
import Sheet from './Sheet';
import { tripInfo } from './away';
import { useUi, type ClubSub } from './uiStore';

const CLUB_SUBS: { id: ClubSub; label: string }[] = [
  { id: 'finance', label: '재무' },
  { id: 'stadium', label: '구장' },
  { id: 'news', label: '뉴스' },
];

/** 홈 탭: "다음 경기" 카드 1장 + "할 일" 카드 (없으면 숨김) */
function TodayCards() {
  const { next, opp, inPost, when, idle } = useMatchActions();
  return (
    <div className="flex shrink-0 flex-col gap-[4px] land:min-h-0 land:flex-1 land:overflow-y-auto" data-testid="today">
      <div className="px-panel flex min-h-12 shrink-0 items-center gap-2 px-2 py-1.5">
        {next && opp ? (
          <>
            <span className={`shrink-0 px-1.5 py-0.5 text-[13px] ${next.isHome ? 'bg-good/25 text-good' : 'bg-white/10 text-white/80'}`}>{next.isHome ? '홈' : '원정'}</span>
            <TeamDot team={opp} size={16} />
            <span className="min-w-0 flex-1 leading-tight">
              <span className="block truncate font-pixel-lg text-[16px]">vs {opp.name}</span>
              <span className={`block truncate text-[13px] ${inPost ? 'text-hi' : 'text-white/55'}`}>{when}</span>
            </span>
            <span className="flex shrink-0 flex-col items-end gap-1">
              <PreGame short />
            </span>
          </>
        ) : (
          <span className="text-[13px] text-white/60">{idle}</span>
        )}
      </div>
      <TodoCard />
    </div>
  );
}

/** 현재 모바일 탭의 내용. 데스크톱 패널과 같은 탭 컴포넌트를 그대로 쓴다. */
function MobilePanel() {
  const tab = useUi((s) => s.tab);
  const clubSub = useUi((s) => s.clubSub);
  const setClubSub = useUi((s) => s.setClubSub);
  const clubTabs = useHintTabs(CLUB_SUBS);

  if (tab === 'home') return <TodayCards />;
  return (
    <div className="px-panel m-shell flex min-h-0 flex-1 flex-col" data-testid="m-panel">
      <TodoLines tab={TAB_TODO[tab]} className="p-1 pb-0" />
      {tab === 'roster' && <Squad />}
      {tab === 'market' && <MarketTab />}
      {tab === 'league' && <LeagueTab />}
      {tab === 'club' && (
        <>
          <TabBar tabs={clubTabs} value={clubSub} onChange={setClubSub} />
          {clubSub === 'finance' ? <FinanceTab /> : clubSub === 'stadium' ? <StadiumTab /> : <NewsTab />}
        </>
      )}
    </div>
  );
}

/** 얇은 줄의 ≡ 메뉴 (가로 폰): 설정 · 초기 화면으로 */
function ThinMenu() {
  const [open, setOpen] = useState(false);
  const playback = useStore((s) => !!s.playback);
  const setScreen = useUi((s) => s.setScreen);
  const setSettingsOpen = useUi((s) => s.setSettingsOpen);
  return (
    <span className="relative shrink-0">
      <button className="flex h-9 w-10 cursor-pointer items-center justify-center text-[18px] text-white/80" aria-label="메뉴" aria-expanded={open} data-testid="thin-menu" onClick={() => setOpen((v) => !v)}>
        {open ? '▲' : '≡'}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="px-panel absolute top-full right-0 z-[31] mt-[4px] flex flex-col gap-1.5 p-2">
            <button
              className="px-btn min-h-10 whitespace-nowrap"
              data-testid="menu-settings"
              onClick={() => {
                setOpen(false);
                setSettingsOpen(true);
              }}
            >
              설정
            </button>
            <button className="px-btn min-h-10 whitespace-nowrap" data-testid="menu-title" disabled={playback} onClick={() => setScreen('title')}>
              초기 화면으로
            </button>
          </div>
        </>
      )}
    </span>
  );
}

/** 홈이 아닌 탭의 얇은 한 줄: 구단 색 점 · "다음: 홈 vs 팰컨스 · 44%" · 현금 (가로 폰은 ≡ 메뉴까지) */
function ThinBar({ menu = false }: { menu?: boolean }) {
  const team = useUserTeam();
  const cash = useStore((s) => s.finance.cash);
  const playback = useStore((s) => !!s.playback);
  const { next, opp, idle } = useMatchActions();
  const pct = useWinChance(!playback);
  return (
    <div className={`px-panel relative flex h-9 shrink-0 items-center gap-2 text-[13px] ${menu ? 'z-30 pl-2' : 'px-2'}`} data-testid="thin-bar">
      <TeamDot team={team} size={12} />
      <span className="min-w-0 flex-1 truncate">
        {playback ? (
          <span className="text-sky">경기 중</span>
        ) : next && opp ? (
          <>
            <span className="text-white/55">다음: </span>
            {next.isHome ? '홈' : '원정'} vs {opp.name}
            {pct !== null && <span className="text-hi"> · {pct}%</span>}
          </>
        ) : (
          <span className="text-white/60">{idle}</span>
        )}
      </span>
      <span className={`shrink-0 text-[14px] ${cash < 0 ? 'text-bad' : 'text-hi'}`}>{fmtMoney(cash)}</span>
      <RunwayWarn className="text-[13px]" />
      {menu && <ThinMenu />}
    </div>
  );
}

/** 홈 상단의 일정 한 줄: "✈ 원정 중 · 팰컨스 3연전 2차전 · 귀항까지 4경기" / "🏠 홈 3연전 1차전" */
function TripLine() {
  const schedule = useStore((s) => s.schedule);
  const userId = useStore((s) => s.userId);
  const day = useStore((s) => s.day);
  const phase = useStore((s) => s.phase);
  const post = useStore((s) => s.post);
  const teams = useStore((s) => s.teams);
  const info = useMemo(() => (phase === 'season' ? tripInfo({ schedule, userId }, day) : null), [schedule, userId, day, phase]);
  const pm = phase === 'post' ? userMatch({ schedule, userId, phase, post }, day) : null;
  let text: string | null = null;
  let away = false;
  if (info) {
    const opp = teams.find((t) => t.id === info.oppId);
    away = !info.home;
    const series = info.len > 1 ? `${info.len}연전 ${info.no}차전` : '1경기';
    text = info.home ? `🏠 홈 ${series} · vs ${opp?.name ?? ''}` : `✈ 원정 중 · ${opp?.name ?? ''} ${series} · 귀항까지 ${info.toHome}경기`;
  } else if (pm) {
    away = !pm.isHome;
    text = pm.isHome ? `🏠 홈 · ${pm.name ?? '포스트시즌'} ${pm.gameNo ?? ''}차전` : `✈ 원정 중 · ${pm.name ?? '포스트시즌'} ${pm.gameNo ?? ''}차전`;
  }
  if (!text) return null;
  return (
    <div className={`px-panel flex h-8 shrink-0 items-center truncate px-2 text-[13px] ${away ? 'text-sky' : 'text-good'}`} data-testid="trip-line">
      <span className="truncate">{text}</span>
    </div>
  );
}

/** 재생 중 구장 아래의 이벤트 줄 */
function LiveLine() {
  const ev = useStore((s) => (s.playback ? (s.playback.report.result.events[s.playback.step] ?? null) : null));
  const userId = useStore((s) => s.userId);
  if (!ev) return null;
  return (
    <div className="px-panel flex min-h-12 flex-1 flex-col justify-center px-3 py-1.5" data-testid="live-line">
      <span className={`font-pixel-lg text-[16px] leading-snug ${ev.type === 'injury' ? 'text-bad' : ev.teamId === userId ? 'text-hi' : 'text-white'}`}>{ev.text}</span>
      {ev.sub && <span className="text-[13px] text-white/60">{ev.sub}</span>}
    </div>
  );
}

/** 구장에서 연 시트: 시설 태그 → 그 시설 카드, 관중 칩 → 티켓 가격 */
function FacSheet() {
  const part = useUi((s) => s.facSheet);
  const close = useUi((s) => s.setFacSheet);
  if (!part) return null;
  return (
    <Sheet onClose={() => close(null)} label={part === 'ticket' ? '티켓 가격' : '시설'}>
      <div className="m-shell">
        <StadiumTab part={part} />
      </div>
    </Sheet>
  );
}

const safe = {
  paddingTop: 'max(env(safe-area-inset-top), 4px)',
  paddingBottom: 'max(env(safe-area-inset-bottom), 4px)',
  paddingLeft: 'max(env(safe-area-inset-left), 4px)',
  paddingRight: 'max(env(safe-area-inset-right), 4px)',
};

/**
 * 모바일 레이아웃. 하단 내비 5탭 = 홈 · 선수단 · 이적 · 리그 · 구단.
 * - portrait: 홈은 [상단바 / 일정 줄 / 큰 구장(57dvh, 경기 중 65dvh) / 오늘 카드 / 액션 바], 다른 탭은 [얇은 줄 / 탭 전체] (선수단 탭 = 선수단 화면 하나)
 * - landscape: [상단바 · 구장(높이 맞춤) · 액션 바] | [탭 · 패널]
 */
export default function MobileShell({ orientation }: { orientation: 'portrait' | 'landscape' }) {
  const tab = useUi((s) => s.tab);
  const playback = useStore((s) => !!s.playback);
  const ended = useStore((s) => s.phase === 'ended' && !s.summary && !s.playback);
  // 하이라이트 재생이 시작되면 홈(구장)으로
  useEffect(() => {
    if (playback) useUi.setState({ tab: 'home', facSheet: null });
  }, [playback]);

  const overlays = (
    <>
      <FacSheet />
      <GameSummary sheet />
      {/* 결산 화면이 떠 있는 동안에는 SeasonEnd 가 사건 카드를 그린다 (두 겹으로 그리지 않게) */}
      {!ended && <EventCardModal sheet />}
      <OrderSheet />
    </>
  );

  if (orientation === 'landscape') {
    return (
      <div className="flex h-[calc(var(--dvh)*100)] gap-[4px] overflow-hidden bg-[#141a29] font-pixel text-[13px] select-none" style={safe}>
        <div className="flex min-w-0 flex-1 flex-col gap-[4px]">
          <ThinBar menu />
          <div className="relative min-h-0 flex-1">
            <div className="absolute inset-0">
              <StadiumView />
            </div>
          </div>
          <MobileActionBar bare />
        </div>
        <div className="flex w-[clamp(300px,calc(var(--vw)*46),460px)] shrink-0 flex-col gap-[4px]">
          <MobileNav placement="top" />
          {playback ? <LiveLine /> : <MobilePanel />}
        </div>
        {overlays}
      </div>
    );
  }
  const home = tab === 'home';
  return (
    <div className="flex h-[calc(var(--dvh)*100)] flex-col gap-[4px] overflow-hidden bg-[#141a29] font-pixel text-[13px] select-none" style={safe}>
      {home && !playback ? <MobileTopBar /> : <ThinBar />}
      {home && (
        <>
          {!playback && <TripLine />}
          {/* 구장이 남는 높이를 채운다: 다음 경기·할 일 카드는 제 높이만큼만 */}
          <div className={`relative w-full ${playback ? 'shrink-0' : 'min-h-[calc(var(--dvh)*34)] flex-1'}`} style={playback ? { height: 'min(calc(var(--dvh)*65), calc(calc(var(--dvh)*100) - 256px))' } : undefined} data-testid="stadium-box">
            <div className="absolute inset-0">
              <StadiumView pan />
            </div>
          </div>
        </>
      )}
      {home && playback ? <LiveLine /> : <MobilePanel />}
      {home && <MobileActionBar bare />}
      <MobileNav placement="bottom" />
      {overlays}
    </div>
  );
}
