// 표시용 포맷터. 금액 단위는 만원.

export function fmtInt(v: number): string {
  const n = Math.round(v);
  const s = Math.abs(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return n < 0 ? `-${s}` : s;
}

/** 12500 -> "1.3억", 800 -> "800만", 음수는 "-" 접두 */
export function fmtMoney(v: number): string {
  const n = Math.round(v);
  const a = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (a >= 10000) {
    const eok = a / 10000;
    if (eok >= 100) return `${sign}${fmtInt(Math.round(eok))}억`;
    const t = (Math.round(eok * 10) / 10).toFixed(1).replace(/\.0$/, '');
    return `${sign}${t}억`;
  }
  return `${sign}${fmtInt(a)}만`;
}

/** 타율 ".312" (타수 0 이면 ".---") */
export function fmtAvg(h: number, ab: number): string {
  if (ab <= 0) return '.---';
  const s = (h / ab).toFixed(3);
  return s.startsWith('0') ? s.slice(1) : s;
}

/** 평균자책 "3.45" (아웃 0 이면 "-.--") */
export function fmtEra(er: number, outs: number): string {
  if (outs <= 0) return '-.--';
  return ((er * 27) / outs).toFixed(2);
}

/** 이닝 "6.1" */
export function fmtIp(outs: number): string {
  return `${Math.floor(outs / 3)}.${outs % 3}`;
}
