import { useStore } from './store';
import { titleStreak } from './game/season';
import { loanLimit } from './game/economy';

// 익명 방문 통계(GoatCounter)와 의견 창구. 둘 다 비어 있으면 아무것도 하지 않는다.
// - 쿠키·고정 번호·별칭·세이브 내용은 보내지 않는다. 보내는 것은 "어떤 일이 일어났다"는 이름뿐이다.
// - 설정에서 끌 수 있다 (kbl-no-stats).
/** GoatCounter 사이트 코드 (https://{코드}.goatcounter.com). 가입 뒤 여기에 적는다 */
export const STATS_CODE: string = 'deenu0224';
/** 의견 보내기 링크 (구글 폼). 비어 있으면 버튼이 뜨지 않는다 */
export const FEEDBACK_URL: string = 'https://docs.google.com/forms/d/e/1FAIpQLSdF2ceTEtSme1Ph4mGg-h8k5n8e8W8hLTY94MMJKtnU-usYBw/viewform';
/** 후원 링크 (카카오페이 송금코드). 비어 있으면 버튼이 뜨지 않는다. 후원에 게임 안 대가는 걸지 않는다 */
export const DONATE_URL: string = 'https://qr.kakaopay.com/Ej8FYHCrH';

const OFF_KEY = 'kbl-no-stats';
const local = () => /^(localhost|127\.|\[::1\]|192\.168\.|10\.)/.test(location.hostname) || location.hostname.endsWith('.local');

export const statsAvailable = () => !!STATS_CODE;
export function statsOn(): boolean {
  try {
    return localStorage.getItem(OFF_KEY) !== '1';
  } catch {
    return true;
  }
}
export function setStatsOn(on: boolean) {
  try {
    if (on) localStorage.removeItem(OFF_KEY);
    else localStorage.setItem(OFF_KEY, '1');
  } catch {
    /* 이번 세션만 */
  }
}

function send(path: string, event: boolean) {
  if (!STATS_CODE || !statsOn() || local() || navigator.webdriver) return;
  const q = new URLSearchParams({ p: path, t: event ? path : document.title, rnd: Math.random().toString(36).slice(2, 8) });
  if (event) q.set('e', 'true');
  else if (document.referrer) q.set('r', document.referrer);
  // 스크립트를 싣지 않고 1픽셀 요청만 보낸다
  new Image().src = `https://${STATS_CODE}.goatcounter.com/count?${q}`;
}

/** 사건 하나를 센다. 이름은 가짓수가 적어야 한다 (예: 'season-1', 'share-x') */
export const track = (name: string) => send(name, true);

/** 한 세이브에서 같은 사건을 한 번만 세기 위한 표시 (새 게임이면 지워진다) */
const once = new Set<string>();
const trackOnce = (name: string, key = name) => {
  if (once.has(key)) return;
  once.add(key);
  track(name);
};

export function initAnalytics() {
  send(location.pathname, false);
  track(`ver-${__APP_VERSION__}`); // 어느 버전으로 들어왔는지 (업데이트 전후 비교)
  if (new URLSearchParams(location.search).has('from')) track('from-share'); // 공유 글을 타고 온 방문
  // 진행 지표: 첫 경기 · 시즌 결산 · 장 도달 · 연고 이전. 화면 코드에 흩지 않고 상태 변화로 센다
  let prev = useStore.getState();
  useStore.subscribe((s) => {
    const p = prev;
    prev = s;
    if (s.season < p.season || (s.season === 1 && s.day < p.day)) once.clear(); // 새 게임
    if (s.season === 1 && p.day === 0 && s.day === 1) trackOnce('first-game');
    if (s.phase !== p.phase && s.phase === 'ended') {
      trackOnce(`season-${Math.min(s.season, 12)}`);
      // 초기 화면의 누적 시즌 · 우승 수 (시즌마다 한 번. 이름은 하나로 모아 한 번에 읽는다)
      trackOnce('season-done', `sd-${s.season}`);
      if (s.campaign.history[s.campaign.history.length - 1]?.post === 'champion') trackOnce('title', `ti-${s.season}`);
      // 연속 우승 보정 관찰: 몇 연패까지 가는가 (season.ts DYN)
      const streak = titleStreak(s);
      if (streak > 0) trackOnce(`title-streak-${Math.min(streak, 6)}`);
      // 빚 관찰: 첫 세 시즌 결산 때 부채가 한도의 몇 %인가 (0 · 50 미만 · 80 미만 · 80 이상)
      if (s.season <= 3) {
        const r = s.finance.debt / Math.max(1, loanLimit(s));
        trackOnce(`debt-s${s.season}-${s.finance.debt <= 0 ? 0 : r < 0.5 ? 50 : r < 0.8 ? 80 : 100}`);
      }
    }
    if (s.phase !== p.phase && s.phase === 'over') {
      trackOnce(`moved-${Math.min(s.season, 12)}`);
      trackOnce('moved'); // 초기 화면의 연고 이전 합계용
    }
    if (s.campaign.stage > p.campaign.stage && s.season >= p.season) trackOnce(`stage-${s.campaign.stage}`);
  });
}

// ── 초기 화면의 "단장 n명" ──
// GoatCounter 의 공개 집계(사이트 설정에서 visitor counter 를 켜야 한다)에서 새 게임 수를 읽는다.
// 서버가 없어 "지금 접속 중"은 셀 수 없다. 공개 집계는 GoatCounter 앞단 캐시에 몇 시간씩 남는데(age 4시간+),
// 아무 쿼리나 붙여서는 못 피하고 start 날짜만 캐시 키에 들어간다 → 기록이 생기기 전의 날짜를 분마다 바꿔 넣는다 (합계는 같다).
const COUNT_KEY = 'kbl-gm-count4';
const COUNT_MIN = 5; // 이보다 적으면 보여 주지 않는다
export interface GmCount { total: number; seasons: number; champ: number; moved: number }
// 2026-10-15 이전의 몫: season-done · title 이벤트가 생기기 전에 센 값 (season-1~12 합 51 · 우승 엔딩을 본 구단 3 — 우승 횟수의 하한)
const SEASON_BASE = 51;
const TITLE_BASE = 3;

/** 분마다 바뀌는 시작 날짜: 2016-01-01 부터 (분 번호 mod 3000)일 — 전부 기록이 생기기 전(2026-10)이라 합계는 같다 */
function freshStart(): string {
  const m = Math.floor(Date.now() / 60000) % 3000;
  return new Date(Date.UTC(2016, 0, 1) + m * 86400000).toISOString().slice(0, 10);
}

/** 한 집계 읽기: 실패하면 한 번 더. 끝내 못 읽으면 null (기록이 아직 없는 404 는 0) */
async function readCount(path: string): Promise<number | null> {
  for (let i = 0; i < 2; i++) {
    try {
      const r = await fetch(`https://${STATS_CODE}.goatcounter.com/counter/${encodeURIComponent(path)}.json?start=${freshStart()}`);
      if (r.status === 404) return 0;
      if (!r.ok) continue; // 설정이 꺼져 있으면 403, 몰리면 5xx
      const j = (await r.json()) as { count?: string };
      return Number(String(j.count ?? '0').replace(/[^0-9]/g, '')) || 0;
    } catch {
      /* 네트워크가 끊겼다 → 한 번 더 */
    }
  }
  return null;
}

const COUNT_TTL = 60_000; // 읽은 값은 1분만 쓴다 (실패한 결과는 남기지 않는다 — 다음에 화면을 열면 다시 읽는다)

/** 새 게임을 시작한 단장 수. 못 읽었거나 너무 적으면 null (아무것도 그리지 않는다) */
export async function gmCount(): Promise<GmCount | null> {
  if (!STATS_CODE || local() || navigator.webdriver) return null;
  try {
    const hit = JSON.parse(sessionStorage.getItem(COUNT_KEY) ?? 'null') as { at: number; v: GmCount } | null;
    if (hit && Date.now() - hit.at < COUNT_TTL) return hit.v;
  } catch {
    /* 캐시 없이 */
  }
  // 우승 = 한국시리즈 우승 시즌, 연고 이전 = 게임오버. 단장 수만 꼭 있어야 하고 나머지는 못 읽으면 빼고 보여 준다
  const [total, seasons, champ, moved] = await Promise.all([readCount('new-game'), readCount('season-done'), readCount('title'), readCount('moved')]);
  if (total === null || total < COUNT_MIN) return null;
  const out: GmCount = { total, seasons: seasons === null ? 0 : SEASON_BASE + seasons, champ: champ === null ? 0 : TITLE_BASE + champ, moved: moved ?? 0 };
  try {
    sessionStorage.setItem(COUNT_KEY, JSON.stringify({ at: Date.now(), v: out }));
  } catch {
    /* 무시 */
  }
  return out;
}
