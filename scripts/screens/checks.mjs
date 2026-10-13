// 화면마다 page.evaluate 로 돌리는 자동 검사. 브라우저 안에서 실행되므로 바깥 변수를 쓰지 않는다.
// 반환: [{ kind, text(앞 30자), x, y, w, h }]
export function pageChecks({ mobile, allow }) {
  const out = [];
  const W = window.innerWidth;
  const H = window.innerHeight;
  const cut = (s) => (s || '').replace(/\s+/g, ' ').trim().slice(0, 30);
  const allowed = (kind, el, text) => {
    for (const a of allow || []) {
      if (a.kind && a.kind !== kind) continue;
      if (a.testid && el.closest && el.closest(`[data-testid="${a.testid}"]`)) return true;
      if (a.testidPrefix && el.closest && el.closest(`[data-testid^="${a.testidPrefix}"]`)) return true;
      if (a.text && new RegExp(a.text).test(text)) return true;
      if (a.selector && el.closest && el.closest(a.selector)) return true;
    }
    return false;
  };
  const seen = new Set();
  const add = (kind, el, text, r) => {
    const t = cut(text);
    if (allowed(kind, el, t)) return;
    const key = `${kind}|${t}|${Math.round(r.left / 8)}|${Math.round(r.top / 8)}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ kind, text: t, x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) });
  };
  const styleOf = (el) => getComputedStyle(el);
  const shown = (el, r) => {
    if (r.width <= 0 || r.height <= 0) return false;
    const s = styleOf(el);
    if (s.visibility !== 'visible' || s.display === 'none') return false;
    for (let p = el; p && p !== document.documentElement; p = p.parentElement) if (Number(getComputedStyle(p).opacity) < 0.05) return false;
    return true;
  };
  /** 화면 안에 있고, 다른 것(시트·모달)에 가려지지 않았는가 */
  const onTop = (el, r) => {
    const cx = Math.min(W - 1, Math.max(0, r.left + r.width / 2));
    const cy = Math.min(H - 1, Math.max(0, r.top + r.height / 2));
    if (r.right < 0 || r.left > W || r.bottom < 0 || r.top > H) return false;
    const hit = document.elementFromPoint(cx, cy);
    return !!hit && (el === hit || el.contains(hit) || hit.contains(el));
  };
  const ownText = (el) => {
    let s = '';
    for (const n of el.childNodes) if (n.nodeType === 3) s += n.nodeValue;
    return s.replace(/\s+/g, ' ').trim();
  };
  const lineH = (s) => {
    const fs = parseFloat(s.fontSize) || 12;
    const lh = parseFloat(s.lineHeight);
    return Number.isFinite(lh) ? lh : fs * 1.2;
  };
  const textRect = (el) => {
    // 요소가 직접 가진 텍스트 노드들이 차지하는 박스
    let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
    for (const n of el.childNodes) {
      if (n.nodeType !== 3 || !n.nodeValue.trim()) continue;
      const rg = document.createRange();
      rg.selectNodeContents(n);
      for (const q of rg.getClientRects()) {
        if (q.width <= 0 || q.height <= 0) continue;
        l = Math.min(l, q.left); t = Math.min(t, q.top); r = Math.max(r, q.right); b = Math.max(b, q.bottom);
      }
    }
    return r < l ? null : { left: l, top: t, right: r, bottom: b, width: r - l, height: b - t };
  };
  const inHScroll = (el) => {
    for (let p = el.parentElement; p && p !== document.documentElement; p = p.parentElement) {
      const ox = getComputedStyle(p).overflowX;
      if ((ox === 'auto' || ox === 'scroll') && p.scrollWidth > p.clientWidth + 1) return true;
    }
    return false;
  };

  // 가로 넘침
  const se = document.scrollingElement || document.documentElement;
  if (se.scrollWidth > W + 1) out.push({ kind: 'hscroll', text: `scrollWidth ${se.scrollWidth} > ${W}`, x: 0, y: 0, w: se.scrollWidth, h: 0 });

  const all = [...document.body.querySelectorAll('*')].filter((el) => !['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(el.tagName));
  const CLICK = 'button,[role="button"],[role="tab"],a[href],input,select,textarea,summary';
  const CONTROL = 'button,[role="button"],[role="tab"],[class*="px-btn"],nav a,nav button,nav [role]';

  const textEls = [];
  for (const el of all) {
    const text = ownText(el);
    if (!text) continue;
    const r = el.getBoundingClientRect();
    if (!shown(el, r) || !onTop(el, r)) continue;
    const s = styleOf(el);
    const fs = parseFloat(s.fontSize) || 12;
    const lh = lineH(s);
    textEls.push({ el, text, r, fs, lh });
    // 세로로 꺾인 글
    const tr = textRect(el);
    if (text.length >= 4 && s.writingMode.startsWith('horizontal') && r.width < fs * 1.8 && r.height > lh * 2.5) add('vertical', el, text, r);
    else if (text.length >= 4 && tr && tr.width < fs * 1.8 && tr.height > lh * 2.5) add('vertical', el, text, tr);
    // 작은 글자 (모바일)
    if (mobile && fs < 13 && !el.closest('svg')) add('smallfont', el, `${fs.toFixed(1)}px ${text}`, r);
    // 뜻밖의 줄바꿈: 버튼·탭·칩 안의 글이 2줄 이상
    const ctl = el.closest(CONTROL);
    if (ctl && tr && tr.height > lh * 1.6 && s.whiteSpace !== 'pre' && s.whiteSpace !== 'pre-wrap' && s.whiteSpace !== 'pre-line') add('wrap', el, text, tr);
    // 잘림: 글이 overflow hidden/clip 인 조상의 오른쪽 밖으로 나갔다
    if (tr) {
      for (let p = el, d = 0; p && p !== document.body && d < 4; p = p.parentElement, d++) {
        const ps = getComputedStyle(p);
        if (ps.overflowX !== 'hidden' && ps.overflowX !== 'clip') continue;
        const pr = p.getBoundingClientRect();
        if (p.scrollWidth > p.clientWidth + 2 && (tr.right > pr.right + 2 || tr.left < pr.left - 2)) {
          add(ps.textOverflow === 'ellipsis' || s.textOverflow === 'ellipsis' ? 'ellipsis' : 'clip', el, text, tr);
        }
        break;
      }
    }
  }

  // 화면 밖 요소 · 작은 터치 타깃
  for (const el of all) {
    const isClick = el.matches(CLICK);
    if (!isClick) continue;
    const r = el.getBoundingClientRect();
    if (!shown(el, r) || el.disabled) continue;
    const text = el.innerText || el.getAttribute('aria-label') || el.getAttribute('data-testid') || el.tagName;
    if (r.bottom > 0 && r.top < H && (r.left < -4 || r.right > W + 4) && r.right > 0 && r.left < W && !inHScroll(el) && onTop(el, r)) add('offscreen', el, text, r);
    if (mobile && r.height < 36 && onTop(el, r) && el.type !== 'range' && el.type !== 'checkbox') add('touch', el, `${Math.round(r.height)}px ${cut(text)}`, r);
  }

  // 겹침: 같은 부모의 형제 텍스트끼리 20% 이상.
  // 여러 줄로 흐르는 인라인 글은 줄 상자 단위로 비교하고(전체 상자로 비교하면 정상 줄바꿈이 겹침으로 잡힌다),
  // 말줄임으로 잘린 글은 보이는 부분(요소 상자 안)만 본다.
  const lineRects = (el) => {
    const s = getComputedStyle(el);
    const cut = s.overflowX === 'hidden' || s.overflowX === 'clip' ? el.getBoundingClientRect() : null;
    const res = [];
    for (const n of el.childNodes) {
      if (n.nodeType !== 3 || !n.nodeValue.trim()) continue;
      const rg = document.createRange();
      rg.selectNodeContents(n);
      for (const q of rg.getClientRects()) {
        const l = cut ? Math.max(q.left, cut.left) : q.left, r = cut ? Math.min(q.right, cut.right) : q.right;
        if (r - l > 0 && q.height > 0) res.push({ left: l, right: r, top: q.top, bottom: q.bottom });
      }
    }
    return res;
  };
  const byParent = new Map();
  for (const t of textEls) {
    const tr = textRect(t.el);
    if (!tr || !t.el.parentElement) continue;
    if (!byParent.has(t.el.parentElement)) byParent.set(t.el.parentElement, []);
    byParent.get(t.el.parentElement).push({ ...t, tr, lines: lineRects(t.el) });
  }
  for (const list of byParent.values()) {
    if (list.length < 2 || list.length > 40) continue;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        let hit = false;
        for (const a of list[i].lines) {
          for (const b of list[j].lines) {
            const ix = Math.min(a.right, b.right) - Math.max(a.left, b.left);
            const iy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
            if (ix <= 0 || iy <= 0) continue;
            const small = Math.min((a.right - a.left) * (a.bottom - a.top), (b.right - b.left) * (b.bottom - b.top));
            if (small > 0 && (ix * iy) / small >= 0.2) hit = true;
          }
        }
        if (hit) add('overlap', list[i].el, `${cut(list[i].text).slice(0, 13)} ⟷ ${cut(list[j].text).slice(0, 13)}`, list[i].tr);
      }
    }
  }
  return out;
}

/** 클릭 대상 찾기 (브라우저 안에서 실행): testid → 버튼류의 정확한 글 → 포함 → 아무 요소의 정확한 글. 가려지지 않은 것만. */
export function findTarget({ target, nth }) {
  const W = window.innerWidth, H = window.innerHeight;
  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const vis = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility === 'visible' && s.display !== 'none';
  };
  const top = (el) => {
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    if (cx < 0 || cy < 0 || cx > W || cy > H) return false;
    const hit = document.elementFromPoint(cx, cy);
    return !!hit && (el === hit || el.contains(hit) || hit.contains(el));
  };
  const CLICK = 'button,[role="button"],[role="tab"],a,summary,label,[data-testid]';
  // 'css:선택자' 는 그대로 고른다 (목록의 첫 줄처럼 testid 가 없는 것)
  let c = target.startsWith('css:') ? [...document.querySelectorAll(target.slice(4))] : [...document.querySelectorAll(`[data-testid="${CSS.escape(target)}"]`)];
  if (!c.length) c = [...document.querySelectorAll(CLICK)].filter((el) => norm(el.innerText) === target || el.getAttribute('aria-label') === target);
  if (!c.length) c = [...document.querySelectorAll(CLICK)].filter((el) => norm(el.innerText).includes(target) || (el.getAttribute('aria-label') || '').includes(target)).sort((a, b) => norm(a.innerText).length - norm(b.innerText).length);
  if (!c.length) c = [...document.querySelectorAll('body *')].filter((el) => [...el.childNodes].some((n) => n.nodeType === 3 && norm(n.nodeValue) === target));
  c = c.filter(vis);
  if (!c.length) return null;
  // 화면 밖이면 스크롤해 들여온다
  let pick = c.filter(top);
  if (!pick.length) {
    c[Math.min(nth || 0, c.length - 1)].scrollIntoView({ block: 'center', inline: 'center' });
    pick = c.filter(top);
  }
  const el = pick[Math.min(nth || 0, pick.length - 1)];
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/** 탐색용(--dump): 지금 누를 수 있는 것들의 글과 testid */
export function dumpTargets() {
  const W = window.innerWidth, H = window.innerHeight;
  const res = [];
  for (const el of document.querySelectorAll('button,[role="button"],[role="tab"],a,summary,[data-testid]')) {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    if (cx < 0 || cy < 0 || cx > W || cy > H) continue;
    const hit = document.elementFromPoint(cx, cy);
    if (!hit || !(el === hit || el.contains(hit) || hit.contains(el))) continue;
    const t = (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 28);
    res.push(`${el.tagName.toLowerCase()}${el.dataset.testid ? `#${el.dataset.testid}` : ''}${el.getAttribute('aria-label') ? `[${el.getAttribute('aria-label')}]` : ''} "${t}"`);
  }
  return res;
}
