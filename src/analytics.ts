import { useStore } from './store';

// 익명 방문 통계(GoatCounter)와 의견 창구. 둘 다 비어 있으면 아무것도 하지 않는다.
// - 쿠키·고정 번호·별칭·세이브 내용은 보내지 않는다. 보내는 것은 "어떤 일이 일어났다"는 이름뿐이다.
// - 설정에서 끌 수 있다 (kbl-no-stats).
/** GoatCounter 사이트 코드 (https://{코드}.goatcounter.com). 가입 뒤 여기에 적는다 */
export const STATS_CODE: string = 'deenu0224';
/** 의견 보내기 링크 (구글 폼). 비어 있으면 버튼이 뜨지 않는다 */
export const FEEDBACK_URL: string = '';

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
