import { useStore } from './store';

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
const trackOnce = (name: string) => {
  if (once.has(name)) return;
  once.add(name);
  track(name);
};

export function initAnalytics() {
  send(location.pathname, false);
  if (new URLSearchParams(location.search).has('from')) track('from-share'); // 공유 글을 타고 온 방문
  // 진행 지표: 첫 경기 · 시즌 결산 · 장 도달 · 연고 이전. 화면 코드에 흩지 않고 상태 변화로 센다
  let prev = useStore.getState();
  useStore.subscribe((s) => {
    const p = prev;
    prev = s;
    if (s.season < p.season || (s.season === 1 && s.day < p.day)) once.clear(); // 새 게임
    if (s.season === 1 && p.day === 0 && s.day === 1) trackOnce('first-game');
    if (s.phase !== p.phase && s.phase === 'ended') trackOnce(`season-${Math.min(s.season, 12)}`);
    if (s.phase !== p.phase && s.phase === 'over') trackOnce(`moved-${Math.min(s.season, 12)}`);
    if (s.campaign.stage > p.campaign.stage && s.season >= p.season) trackOnce(`stage-${s.campaign.stage}`);
  });
}

// ── 초기 화면의 "단장 n명" ──
// GoatCounter 의 공개 집계(사이트 설정에서 visitor counter 를 켜야 한다)에서 새 게임 수를 읽는다.
// 서버가 없어 "지금 접속 중"은 셀 수 없다. 누적과 오늘 시작한 수만 보여 준다.
const COUNT_KEY = 'kbl-gm-count';
const COUNT_MIN = 30; // 이보다 적으면 보여 주지 않는다 (초라해 보이는 숫자 방지)
export interface GmCount { total: number; today: number }

async function readCount(path: string, start?: string): Promise<number> {
  const r = await fetch(`https://${STATS_CODE}.goatcounter.com/counter/${encodeURIComponent(path)}.json${start ? `?start=${start}` : ''}`);
  if (!r.ok) return 0; // 설정이 꺼져 있으면 403, 아직 기록이 없으면 404
  const j = (await r.json()) as { count?: string };
  return Number(String(j.count ?? '0').replace(/[^0-9]/g, '')) || 0;
}

/** 새 게임을 시작한 단장 수. 못 읽었거나 너무 적으면 null (아무것도 그리지 않는다) */
export async function gmCount(): Promise<GmCount | null> {
  if (!STATS_CODE || local() || navigator.webdriver) return null;
  try {
    const hit = sessionStorage.getItem(COUNT_KEY);
    if (hit) return JSON.parse(hit) as GmCount | null;
  } catch {
    /* 캐시 없이 */
  }
  let out: GmCount | null = null;
  try {
    const d = new Date();
    const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const [total, today] = await Promise.all([readCount('new-game'), readCount('new-game', day)]);
    out = total >= COUNT_MIN ? { total, today } : null;
  } catch {
    out = null;
  }
  try {
    sessionStorage.setItem(COUNT_KEY, JSON.stringify(out));
  } catch {
    /* 무시 */
  }
  return out;
}
