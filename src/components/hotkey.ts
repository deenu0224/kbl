// PC 단축키: 엔터·스페이스 = 지금 화면 맨 위에 보이는 주 버튼(data-hotkey)을 누른다.
// 경기 요약 [확인] · [▶ 경기 진행] · 브리핑 닫기 · 건너뛰기 · 결산 다음 등. 글자 입력 중이면 건드리지 않는다.
const typing = (el: Element | null): boolean =>
  !!el && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement || (el as HTMLElement).isContentEditable);

/**
 * 누를 버튼: 우선순위(data-hotkey 값, 없으면 1)가 가장 높은 것. 같으면 다른 창에 가려지지 않은 것, 그다음 DOM 에서 나중 것(위에 뜬 창).
 * 경기 요약 [확인] · 브리핑 닫기처럼 "지금 이걸 닫아야 하는" 버튼은 2 — 옆에 보이는 [▶ 경기 진행](1)보다 먼저.
 * 화면 밖으로 스크롤된 버튼도 대상이다 (작은 창에서 경기 요약이 길면 [확인]이 아래에 있다)
 */
function topHotkey(): HTMLElement | null {
  const open = [...document.querySelectorAll<HTMLElement>('[data-hotkey]')].filter((el) => {
    if ((el as HTMLButtonElement).disabled) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
  });
  const covered = (el: HTMLElement): boolean => {
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    if (y < 0 || y > innerHeight || x < 0 || x > innerWidth) return false; // 화면 밖이면 가려졌는지 알 수 없다 → 가려지지 않은 셈
    const hit = document.elementFromPoint(x, y);
    return !hit || (hit !== el && !el.contains(hit));
  };
  const rank = (el: HTMLElement) => (Number(el.dataset.hotkey) || 1) * 2 + (covered(el) ? 0 : 1); // 값 없는 data-hotkey 는 "true" → 1
  let best: HTMLElement | null = null;
  for (const el of open) if (!best || rank(el) >= rank(best)) best = el;
  return best && !covered(best) ? best : null;
}

export function initHotkeys(): void {
  window.addEventListener(
    'keydown',
    (e) => {
      if ((e.key !== 'Enter' && e.key !== ' ') || e.repeat || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      if (typing(document.activeElement)) return;
      const btn = topHotkey();
      if (!btn) return;
      e.preventDefault(); // 스페이스 스크롤·포커스된 다른 버튼의 클릭을 막는다
      btn.click();
    },
    true,
  );
}
