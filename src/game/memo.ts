// 시즌 한정 메모. Campaign 에 전용 필드가 없어 `campaign.eventsSeen` 에 "~key=value" 문자열로 얹어 둔다
// (시즌이 바뀌면 eventsSeen 과 함께 비워진다). 실제 카드 id 목록은 seenCards() 로 읽는다.
import type { Core } from './types';

const MARK = '~';

function find(core: Core, key: string): number {
  const head = `${MARK}${key}=`;
  return core.campaign.eventsSeen.findIndex((s) => s.startsWith(head));
}

export function memoGet(core: Core, key: string): string | undefined {
  const i = find(core, key);
  return i < 0 ? undefined : core.campaign.eventsSeen[i].slice(key.length + 2);
}

export function memoSet(core: Core, key: string, val: string | number): void {
  const entry = `${MARK}${key}=${val}`;
  const i = find(core, key);
  if (i < 0) core.campaign.eventsSeen.push(entry);
  else core.campaign.eventsSeen[i] = entry;
}

export function memoNum(core: Core, key: string, dflt = 0): number {
  const v = memoGet(core, key);
  if (v === undefined) return dflt;
  const n = Number(v);
  return Number.isFinite(n) ? n : dflt;
}

export function memoAdd(core: Core, key: string, d = 1): number {
  const v = memoNum(core, key) + d;
  memoSet(core, key, v);
  return v;
}

/** 이번 시즌에 나온 이벤트 카드 id (메모 제외) */
export function seenCards(core: Core): string[] {
  return core.campaign.eventsSeen.filter((s) => !s.startsWith(MARK));
}
