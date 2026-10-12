import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useShallow } from 'zustand/react/shallow';
import type { Core, DayReport, FacilityKind, Player, Team } from './game/types';
import { newCore } from './game/generate';
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
import { autoLineup, fixLineup } from './game/lineup';

export type LeftTab = 'lineup' | 'pitchers' | 'market';
export type RightTab = 'league' | 'stadium' | 'finance' | 'news';
export type Tone = 'good' | 'bad' | 'info';

export interface Store extends Core {
  playback: { report: DayReport; next: Core; step: number } | null;
  summary: DayReport[] | null;
  fx: { kind: FacilityKind; key: number } | null;
  toast: { text: string; tone: Tone; key: number } | null;
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
  swapPitchers(pidA: string, pidB: string): void;
  auto(): void;
  startNextSeason(): void;
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
  };
}

const rng = Math.random;
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
        set({ ...pickCore(pb.next), playback: null, summary: [pb.report], lastReport: pb.report });
      };

      return {
        ...newCore(Date.now()),
        playback: null,
        summary: null,
        fx: null,
        toast: null,
        lastReport: null,
        leftTab: 'lineup',
        rightTab: 'league',

        playNext() {
          const s = get();
          if (s.playback || s.summary) return;
          if (s.phase === 'ended' || s.day >= s.schedule.length) return;
          const { core: next, report } = advanceDay(pickCore(s), rng);
          if (!report.result.events.length) {
            set({ ...pickCore(next), playback: null, summary: [report], lastReport: report, fx: null });
            return;
          }
          set({ playback: { report, next, step: 0 }, fx: null });
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
          for (let i = 0; i < n; i++) {
            if (core.phase === 'ended' || core.day >= core.schedule.length) break;
            const r = advanceDay(core, rng);
            core = r.core;
            reports.push(r.report);
          }
          if (!reports.length) return;
          set({ ...pickCore(core), summary: reports, lastReport: reports[reports.length - 1], fx: null });
        },
        closeSummary() {
          set({ summary: null });
        },

        sign(pid) {
          if (locked()) return;
          const s = get();
          const p = s.freeAgents.find((x) => x.id === pid);
          applyResult(signPlayer(pickCore(s), pid), p ? `${p.name} 영입 완료!` : '영입 완료!');
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
          set({ teams: withUserTeam(get(), (t) => autoLineup(t)), toast: mkToast('자동 편성 완료', 'info') });
        },

        startNextSeason() {
          const s = get();
          if (s.playback) return;
          const core = nextSeason(pickCore(s), rng);
          set({ ...pickCore(core), summary: null, playback: null, fx: null, lastReport: null, toast: mkToast(`${core.season}시즌 개막!`, 'good') });
        },
        newGame() {
          set({
            ...newCore(Date.now()),
            playback: null,
            summary: null,
            fx: null,
            lastReport: null,
            leftTab: 'lineup',
            rightTab: 'league',
            toast: mkToast('새 구단으로 시작합니다', 'info'),
          });
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
      version: 1,
      partialize: (s) => pickCore(s),
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

/** 해당 경기일의 유저 팀 대진. */
export function userMatch(s: Pick<Core, 'schedule' | 'userId'>, day: number): { oppId: string; isHome: boolean } | null {
  const m = s.schedule[day]?.find((x) => x.homeId === s.userId || x.awayId === s.userId);
  if (!m) return null;
  const isHome = m.homeId === s.userId;
  return { oppId: isHome ? m.awayId : m.homeId, isHome };
}
