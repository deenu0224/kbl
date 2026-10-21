import { useSyncExternalStore } from 'react';

// 글자(화면) 크기. 글자만 키우면 칸이 터지므로 화면 전체를 같은 비율로 키운다.
// - 마우스 화면(데스크톱): <html> 에 zoom. 큰 모니터에서는 창 크기에 맞춰 알아서 커진다.
// - 터치 화면(폰): viewport 폭을 줄여 브라우저가 키우게 한다 (zoom 은 터치 좌표가 브라우저마다 다르다).
export type UiSize = 's' | 'm' | 'l' | 'xl';
export const UI_SIZES: [UiSize, string][] = [
  ['s', '작게'],
  ['m', '보통'],
  ['l', '크게'],
  ['xl', '최대'],
];
const MULT: Record<UiSize, number> = { s: 0.88, m: 1, l: 1.14, xl: 1.3 };
const KEY = 'kbl-ui-size';
// 데스크톱 3단 레이아웃이 편한 최소 크기, 모바일 레이아웃이 버티는 최소 폭
const DESK_W = 1180;
const DESK_H = 640;
const MOB_W = 345;

let size: UiSize = 'm';
let zoom = 1;
const subs = new Set<() => void>();

const touchOnly = () => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches;

function apply() {
  const root = document.documentElement;
  const m = MULT[size];
  let z = 1;
  if (touchOnly()) {
    // 폰: 짧은 변 기준으로 viewport 폭을 정한다
    const w = Math.min(screen.width, screen.height);
    const land = matchMedia('(orientation: landscape)').matches;
    const k = Math.min(m, w / MOB_W);
    const meta = document.querySelector('meta[name="viewport"]');
    const vw = Math.round((land ? Math.max(screen.width, screen.height) : w) / k);
    meta?.setAttribute('content', k === 1 ? 'width=device-width, initial-scale=1.0, viewport-fit=cover' : `width=${vw}, viewport-fit=cover`);
  } else {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const desk = w >= 1100 && h >= 600;
    // 큰 창에서는 1280×800 기준으로 알아서 키운다
    const auto = desk ? Math.min(1.8, Math.max(1, Math.min(w / 1280, h / 800))) : 1;
    const cap = desk ? Math.max(1, Math.min(w / DESK_W, h / DESK_H)) : Math.max(1, w / MOB_W);
    z = Math.round(Math.min(auto * m, Math.max(cap, Math.min(1, m))) * 100) / 100;
  }
  root.style.zoom = z === 1 ? '' : String(z);
  root.style.setProperty('--z', String(z));
  if (z !== zoom) {
    zoom = z;
    subs.forEach((f) => f());
  }
}

export function initUiScale() {
  try {
    const v = localStorage.getItem(KEY) as UiSize | null;
    if (v && v in MULT) size = v;
  } catch {
    /* 기본값 */
  }
  apply();
  window.addEventListener('resize', apply);
}

export const getUiSize = () => size;
export function setUiSize(v: UiSize) {
  size = v;
  try {
    localStorage.setItem(KEY, v);
  } catch {
    /* 이번 세션만 */
  }
  apply();
  subs.forEach((f) => f());
}
/** 지금 <html> 에 걸린 zoom (폰은 항상 1). 포인터 좌표를 CSS px 로 옮길 때 나눈다 */
export const uiZoom = () => zoom;

const sub = (f: () => void) => {
  subs.add(f);
  return () => subs.delete(f);
};
export const useUiSize = () => useSyncExternalStore(sub, getUiSize, getUiSize);
export const useUiZoom = () => useSyncExternalStore(sub, uiZoom, () => 1);
