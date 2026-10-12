import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useShallow } from 'zustand/react/shallow';
import type { HintTab, Core, DayReport, FacilityKind, Player, PostRound, Team } from './game/types';
import { campaignZero, newCore } from './game/generate';
import {
  advanceDay,
  signPlayer,
  releasePlayer,
  upgradeFacility,
  setTicketPrice,
  borrow as borrowLoan,
  repay as repayLoan,
  nextSeason,
} from './game/season';
import { autoLineup, fixLineup, managerLineup } from './game/lineup';
import { ensureObjectives, fillObjectivesMut, stopReason } from './game/campaign';
import { CHARACTERS, OVER_LABEL } from './game/story';
import { maybeDrawEvent, resolveEvent as resolveEventFn } from './game/events';
import { beginDraft as beginDraftFn, draftPick as draftPickFn, draftSkip as draftSkipFn, isDraftDone } from './game/draft';
import { postMatch } from './game/postseason';
import { useUi } from './components/layout/uiStore';

export type LeftTab = 'lineup' | 'pitchers' | 'market';
export type RightTab = 'league' | 'stadium' | 'finance' | 'news';
export type Tone = 'good' | 'bad' | 'info';

export interface Store extends Core {
  playback: { report: DayReport; next: Core; step: number; cleared: HintTab[] } | null;
  summary: DayReport[] | null;
  fx: { kind: FacilityKind; key: number } | null;
  toast: { text: string; tone: Tone; key: number } | null;
  flash: { pid: string; at: number } | null; // 방금 영입한 선수 (타선·투수 탭에서 그 자리를 잠깐 강조, 저장 안 함)
  lastReport: DayReport | null; // 마지막으로 커밋된 경기 (리그 탭 "타구장 결과"용, 저장 안 함)
  leftTab: LeftTab;
  rightTab: RightTab;
  playNext(): void;
  stepPlayback(): void;
  skipPlayback(): void;
  simDays(n: number): void;
  closeSummary(): void;
  sign(pid: string): void;
  release(pid: string): void;
  upgrade(kind: FacilityKind): void;
  setPrice(v: number): void;
  borrow(): void;
  repay(): void;
  swapLineup(i: number, j: number): void;
  substitute(slot: number, benchPid: string): void;
  swapPos(i: number, j: number): void; // 주전 둘의 수비 위치만 맞바꾼다 (타순은 그대로)
  swapPitchers(pidA: string, pidB: string): void;
  auto(): void;
  startNextSeason(): void; // 'ended' → 드래프트 시작, 드래프트 종료 후 → 다음 시즌
  resolveEvent(i: number): void; // 대기 중인 이벤트 카드 선택
  beginDraft(): void;
  draftPick(pid: string): void;
  draftSkip(): void;
  finishDraft(): void; // 드래프트가 끝났으면 다음 시즌 개막 (= startNextSeason)
  clearHint(tab: HintTab): void; // 탭을 열었을 때 배지를 지운다
  newGame(): void;
  setTab(side: 'left', tab: LeftTab): void;
  setTab(side: 'right', tab: RightTab): void;
  notify(text: string, tone?: Tone): void;
}

/** 스토어 상태에서 직렬화 대상(Core) 필드만 뽑는다. */
export function pickCore(s: Core): Core {
  return {
    seed: s.seed,
    season: s.season,
    day: s.day,
    phase: s.phase,
    userId: s.userId,
    teams: s.teams,
    schedule: s.schedule,
    freeAgents: s.freeAgents,
    finance: s.finance,
    facilities: s.facilities,
    fans: s.fans,
    fanSat: s.fanSat,
    crowd: s.crowd,
    attHistory: s.attHistory,
    cashHistory: s.cashHistory,
    news: s.news,
    newsSeq: s.newsSeq,
    campaign: s.campaign,
    post: s.post,
    draft: s.draft,
  };
}

const rng = Math.random;
const freshCore = (): Core => ensureObjectives(newCore(Date.now()), rng);
/** 경기 진행이 가능한 상태인지 (불가하면 사유) */
function playBlock(s: Core): string | null {
  if (s.campaign?.event) return '이벤트 카드를 먼저 처리하세요';
  if (s.phase === 'season') return s.day < s.schedule.length ? null : '정규시즌이 끝났습니다';
  if (s.phase === 'post') return s.post && postMatch(s) ? null : '진행할 포스트시즌 경기가 없습니다';
  return '지금은 경기를 진행할 수 없습니다';
}
let seq = 100000;
const mkToast = (text: string, tone: Tone) => ({ text, tone, key: ++seq });

const FAC_NAME: Record<FacilityKind, string> = { seats: '관중석', food: '매점', training: '훈련장' };

function withUserTeam(s: Core, fn: (t: Team) => void): Team[] {
  return s.teams.map((t) => {
    if (t.id !== s.userId) return t;
    const c = structuredClone(t);
    fn(c);
    return c;
  });
}

type Loc = { k: 'rot'; i: number } | { k: 'pen'; i: number } | { k: 'cl' } | null;
function pitcherLoc(t: Team, pid: string): Loc {
  const ri = t.rotation.indexOf(pid);
  if (ri >= 0) return { k: 'rot', i: ri };
  if (t.closer === pid) return { k: 'cl' };
  const bi = t.bullpen.indexOf(pid);
  if (bi >= 0) return { k: 'pen', i: bi };
  return null;
}
function putPitcher(t: Team, l: Loc, pid: string) {
  if (!l) return;
  if (l.k === 'rot') t.rotation[l.i] = pid;
  else if (l.k === 'pen') t.bullpen[l.i] = pid;
  else t.closer = pid;
}

export const useStore = create<Store>()(
  persist(
    (set, get) => {
      /** 재생 중(커밋 전)에는 구단 운영 액션을 막는다 — 커밋 시 덮어써지기 때문. */
      const locked = (): boolean => {
        if (get().playback) {
          set({ toast: mkToast('경기 중에는 변경할 수 없습니다', 'info') });
          return true;
        }
        return false;
      };
      const applyResult = (r: { core: Core; error?: string }, okText?: string): boolean => {
        if (r.error) {
          set({ toast: mkToast(r.error, 'bad') });
          return false;
        }
        set({ ...pickCore(r.core), ...(okText ? { toast: mkToast(okText, 'good') } : {}) });
        return true;
      };
      const commitPlayback = () => {
        const pb = get().playback;
        if (!pb) return;
        // 재생 중에 지운 탭 배지는 커밋 때 되살리지 않는다 (pb.next 는 재생 시작 시점의 스냅샷)
        const next = pickCore(pb.next);
        if (pb.cleared.length && next.campaign.hints) {
          const hints = { ...next.campaign.hints };
          for (const t of pb.cleared) delete hints[t];
          next.campaign = { ...next.campaign, hints };
        }
        set({ ...next, playback: null, summary: [pb.report], lastReport: pb.report });
      };

      return {
        ...freshCore(),
        playback: null,
        summary: null,
        fx: null,
        toast: null,
        lastReport: null,
        flash: null,
        leftTab: 'lineup',
        rightTab: 'league',

        playNext() {
          const s = get();
          if (s.playback || s.summary) return;
          const block = playBlock(s);
          if (block) {
            if (s.campaign?.event) set({ toast: mkToast(block, 'info') });
            return;
          }
          const r = advanceDay(pickCore(s), rng);
          const report = r.report;
          const next = maybeDrawEvent(r.core, rng);
          if (!report.result.events.length) {
            set({ ...pickCore(next), playback: null, summary: [report], lastReport: report, fx: null });
            return;
          }
          set({ playback: { report, next, step: 0, cleared: [] }, fx: null });
        },
        stepPlayback() {
          const pb = get().playback;
          if (!pb) return;
          if (pb.step + 1 >= pb.report.result.events.length) commitPlayback();
          else set({ playback: { ...pb, step: pb.step + 1 } });
        },
        skipPlayback() {
          commitPlayback();
        },
        simDays(n) {
          const s = get();
          if (s.playback || s.summary) return;
          let core = pickCore(s);
          const reports: DayReport[] = [];
          let stopped: string | null = null;
          for (let i = 0; i < n; i++) {
            if (playBlock(core)) break;
            const r = advanceDay(core, rng);
            core = maybeDrawEvent(r.core, rng);
            reports.push(r.report);
            // 이벤트 카드 · 전/결 구간의 시작 · 중간 점검 · 주전 부상에서 멈춘다
            stopped = stopReason(core, r.report);
            if (stopped) break;
          }
          if (!reports.length) return;
          const early = stopped && reports.length < n && !playBlock({ ...core, campaign: { ...core.campaign, event: null } });
          set({
            ...pickCore(core),
            summary: reports,
            lastReport: reports[reports.length - 1],
            fx: null,
            ...(early ? { toast: mkToast(`진행 정지 — ${stopped}`, 'info') } : {}),
          });
        },
        closeSummary() {
          set({ summary: null });
        },

        sign(pid) {
          if (locked()) return;
          const s = get();
          const p = s.freeAgents.find((x) => x.id === pid);
          if (!applyResult(signPlayer(pickCore(s), pid), p ? `${p.name} 영입 완료!` : '영입 완료!') || !p) return;
          // 들어간 자리를 바로 보여 준다
          const sub = p.kind === 'B' ? 'lineup' : 'pitchers';
          set({ flash: { pid, at: Date.now() }, leftTab: sub });
          useUi.setState({ tab: 'roster', rosterSub: sub });
        },
        release(pid) {
          if (locked()) return;
          const s = get();
          const p = findPlayer(s, pid);
          applyResult(releasePlayer(pickCore(s), pid), p ? `${p.name} 방출` : '방출 완료');
        },
        upgrade(kind) {
          if (locked()) return;
          const ok = applyResult(upgradeFacility(pickCore(get()), kind), `${FAC_NAME[kind]} 업그레이드 완료!`);
          if (ok) set({ fx: { kind, key: ++seq } });
        },
        setPrice(v) {
          if (locked()) return;
          const price = Math.round(Math.min(4, Math.max(0.5, v)) * 10) / 10;
          set(pickCore(setTicketPrice(pickCore(get()), price)));
        },
        borrow() {
          if (locked()) return;
          applyResult(borrowLoan(pickCore(get())), '대출 실행');
        },
        repay() {
          if (locked()) return;
          applyResult(repayLoan(pickCore(get())), '대출 상환');
        },

        swapLineup(i, j) {
          if (locked()) return;
          if (i === j) return;
          set({
            teams: withUserTeam(get(), (t) => {
              const a = t.lineup[i];
              const b = t.lineup[j];
              if (!a || !b) return;
              // 타순만 맞바꾼다 (수비 위치는 선수를 따라감)
              t.lineup[i] = b;
              t.lineup[j] = a;
            }),
          });
        },
        swapPos(i, j) {
          if (locked()) return;
          if (i === j) return;
          set({
            teams: withUserTeam(get(), (t) => {
              const a = t.lineup[i];
              const b = t.lineup[j];
              if (!a || !b) return;
              t.lineup[i] = { ...a, pos: b.pos };
              t.lineup[j] = { ...b, pos: a.pos };
            }),
          });
        },
        substitute(slot, benchPid) {
          if (locked()) return;
          set({
            teams: withUserTeam(get(), (t) => {
              const cur = t.lineup[slot];
              if (!cur) return;
              const other = t.lineup.findIndex((l) => l.pid === benchPid);
              if (other >= 0) {
                const tmp = t.lineup[other].pid;
                t.lineup[other] = { ...t.lineup[other], pid: cur.pid };
                t.lineup[slot] = { ...cur, pid: tmp };
                return;
              }
              const p = t.roster.find((x) => x.id === benchPid);
              if (!p || p.kind !== 'B') return;
              t.lineup[slot] = { ...cur, pid: benchPid }; // 교체 선수가 그 자리 수비 위치를 맡는다
            }),
          });
        },
        swapPitchers(pidA, pidB) {
          if (locked()) return;
          if (pidA === pidB) return;
          set({
            teams: withUserTeam(get(), (t) => {
              const la = pitcherLoc(t, pidA);
              const lb = pitcherLoc(t, pidB);
              if (!la && !lb) return;
              putPitcher(t, la, pidB);
              putPitcher(t, lb, pidA);
              if (!la || !lb) fixLineup(t); // 보직 없는 투수와 바꾼 경우 정리
            }),
          });
        },
        auto() {
          if (locked()) return;
          // 0장을 넘기기 전(감독이 승복하기 전)의 자동 편성은 "감독에게 맡기기"다
          const yielded = !!get().campaign.managerYielded;
          set({
            teams: withUserTeam(get(), (t) => (yielded ? autoLineup(t) : managerLineup(t))),
            toast: mkToast(yielded ? '자동 편성 완료' : `${CHARACTERS.manager.name} 감독에게 편성을 맡겼습니다`, 'info'),
          });
        },

        startNextSeason() {
          const s = get();
          if (s.playback) return;
          if (s.phase === 'ended') {
            get().beginDraft();
            return;
          }
          if (s.phase === 'over') {
            set({ toast: mkToast(`${OVER_LABEL}이 확정되었습니다 — 새 게임을 시작하세요`, 'bad') });
            return;
          }
          if (s.phase !== 'draft') return;
          if (!isDraftDone(s)) {
            set({ toast: mkToast('드래프트를 먼저 마치세요', 'info') });
            return;
          }
          const core = nextSeason(pickCore(s), rng);
          set({ ...pickCore(core), summary: null, playback: null, fx: null, lastReport: null, toast: mkToast(`${core.season}시즌 개막!`, 'good') });
        },
        resolveEvent(i) {
          const s = get();
          if (s.playback || !s.campaign.event) return;
          const r = resolveEventFn(pickCore(s), i, rng);
          if (r.error) {
            set({ toast: mkToast(r.error, 'bad') });
            return;
          }
          set({ ...pickCore(r.core), toast: mkToast(r.result, 'info') });
        },
        beginDraft() {
          const s = get();
          if (s.playback) return;
          const r = beginDraftFn(pickCore(s), rng);
          if (applyResult(r)) set({ summary: null, toast: mkToast('신인 드래프트 개막!', 'good') });
        },
        draftPick(pid) {
          const s = get();
          const p = s.draft?.pool.find((x) => x.id === pid);
          applyResult(draftPickFn(pickCore(s), pid, rng), p ? `${p.name} 지명!` : undefined);
        },
        draftSkip() {
          applyResult(draftSkipFn(pickCore(get()), rng), '지명권 패스');
        },
        finishDraft() {
          get().startNextSeason();
        },
        newGame() {
          set({
            ...freshCore(),
            playback: null,
            summary: null,
            fx: null,
            lastReport: null,
            leftTab: 'lineup',
            rightTab: 'league',
            toast: mkToast('단장으로 부임했습니다', 'info'),
          });
        },
        clearHint(tab) {
          const c = get().campaign;
          const pb = get().playback;
          if (pb && pb.next.campaign.hints?.[tab] && !pb.cleared.includes(tab)) set({ playback: { ...pb, cleared: [...pb.cleared, tab] } });
          if (!c.hints || !c.hints[tab]) return;
          const hints = { ...c.hints };
          delete hints[tab];
          set({ campaign: { ...c, hints } });
        },
        setTab(side: 'left' | 'right', tab: LeftTab | RightTab) {
          if (side === 'left') set({ leftTab: tab as LeftTab });
          else set({ rightTab: tab as RightTab });
        },
        notify(text, tone = 'info') {
          set({ toast: mkToast(text, tone) });
        },
      };
    },
    {
      name: 'kbl-save-v1',
      version: 3,
      partialize: (s) => pickCore(s),
      migrate: (persisted, version) => migrateSave(persisted, version) as unknown as Store,
    },
  ),
);

// ───────── 셀렉터 헬퍼 ─────────

/** Core 스냅샷 (필드가 바뀔 때만 새 객체). */
export const useCore = (): Core => useStore(useShallow(pickCore));

export const useUserTeam = (): Team => useStore((s) => s.teams.find((t) => t.id === s.userId) ?? s.teams[0]);

export function findPlayer(s: Pick<Core, 'teams' | 'freeAgents'>, pid: string | undefined | null): Player | undefined {
  if (!pid) return undefined;
  for (const t of s.teams) {
    const p = t.roster.find((x) => x.id === pid);
    if (p) return p;
  }
  return s.freeAgents.find((x) => x.id === pid);
}

/** 해당 경기일의 유저 팀 대진. phase/post 를 함께 넘기면 포스트시즌에는 다음 시리즈 경기를 돌려준다. */
export function userMatch(
  s: Pick<Core, 'schedule' | 'userId'> & Partial<Pick<Core, 'phase' | 'post'>>,
  day: number,
): { oppId: string; isHome: boolean; round?: PostRound; name?: string; gameNo?: number } | null {
  if (s.phase === 'post' && s.post) return postMatch(s as Core);
  const m = s.schedule[day]?.find((x) => x.homeId === s.userId || x.awayId === s.userId);
  if (!m) return null;
  const isHome = m.homeId === s.userId;
  return { oppId: isHome ? m.awayId : m.homeId, isHome };
}

// ───────── 세이브 마이그레이션 ─────────

/** v1 → v2: campaign/post/draft 필드와 타격 스탯 d3/sb/cs 기본값 채우기. v2 → v3: 캠페인 v3 재편 */
export function migrateSave(persisted: unknown, version: number): Core {
  const st = (persisted ?? {}) as Partial<Core> & Record<string, unknown>;
  if (version < 2) {
    st.campaign = st.campaign ?? campaignZero();
    st.post = st.post ?? null;
    st.draft = st.draft ?? null;
    if (!st.phase || !['season', 'post', 'ended', 'draft', 'over'].includes(st.phase)) st.phase = 'season';
    const fix = (p: Player) => {
      p.bat = { ...p.bat, d3: p.bat?.d3 ?? 0, sb: p.bat?.sb ?? 0, cs: p.bat?.cs ?? 0 };
    };
    for (const t of st.teams ?? []) t.roster.forEach(fix);
    (st.freeAgents ?? []).forEach(fix);
  }
  const core = st as Core;
  if (version < 3 && core.campaign) {
    // v2 → v3: 장 테이블·목표·업적 체계가 바뀌었다. 장은 유지하고 목표·별·대본은 새로 깐다.
    const c = core.campaign;
    c.objectives = [];
    c.achievements = [];
    c.eventsSeen = [];
    c.event = null;
    c.buffs = (c.buffs ?? []).filter((b) => b.kind !== 'pledge');
    c.beats = undefined;
    c.hints = {};
    c.retired = c.retired ?? [];
    c.managerYielded = c.managerYielded ?? c.stage > 0;
  }
  if (core.teams?.length && core.campaign && (core.phase === 'season' || core.phase === 'post') && (!core.campaign.objectives.length || !core.campaign.beats)) {
    fillObjectivesMut(core, rng);
  }
  return core;
}
