// 사건 카드 선택지 상세(EventDetail)의 행을 만드는 공용 계산.
// 카드의 make(표시)와 resolve(적용)가 같은 함수를 써서 표시와 실제가 어긋나지 않게 한다.
import type { Core, EventDetail, Player } from './types';
import { clamp } from './rng';
import { fmtInt, fmtMoney } from './format';
import { userTeam } from './economy';

export type Row = EventDetail['rows'][number];
type Tone = Row['tone'];

const tone = (d: number, goodUp = true): Tone => (d === 0 ? 'info' : d > 0 === goodUp ? 'good' : 'bad');
const pct = (m: number) => `${m >= 1 ? '+' : '−'}${Math.abs(Math.round((m - 1) * 100))}%`;
const sgn = (v: number) => (v > 0 ? `+${v}` : v < 0 ? `−${-v}` : '±0');

/** 팬 만족도에 d 를 더한 값 (0~100, 소수 1자리) */
export const satAfter = (core: Pick<Core, 'fanSat'>, d: number): number => clamp(Math.round((core.fanSat + d) * 10) / 10, 0, 100);
/** 팬 수에 d 를 더한 값 (하한 1000) */
export const fansAfter = (core: Pick<Core, 'fans'>, d: number): number => Math.max(1000, Math.round(core.fans + d));
export const trustAfter = (core: Core, d: number): number => clamp(core.campaign.trust + d, 0, 100);
export const payroll = (core: Core): number => userTeam(core).roster.reduce((a, p) => a + p.salary, 0);

export const rowCash = (core: Core, d: number): Row => ({ label: '현금', before: fmtMoney(core.finance.cash), after: fmtMoney(core.finance.cash + d), tone: tone(d) });
export const rowSat = (core: Core, d: number): Row => ({ label: '팬 만족도', before: `${core.fanSat}`, after: `${satAfter(core, d)}`, tone: tone(d) });
export const rowFans = (core: Core, d: number): Row => ({ label: '팬', before: fmtInt(core.fans), after: fmtInt(fansAfter(core, d)), tone: tone(d) });
export const rowTrust = (core: Core, d: number): Row => ({ label: '도민 지지', before: `${core.campaign.trust}`, after: `${trustAfter(core, d)}`, tone: tone(d) });
export const rowPayroll = (core: Core, d: number): Row => ({ label: '연봉 총액', before: fmtMoney(payroll(core)), after: fmtMoney(payroll(core) + d), tone: tone(d, false) });
/** 배율 효과 (관중 수요·입장 수입·굿즈 매출) */
export const rowMult = (label: string, m: number): Row => ({ label, before: '기준', after: m >= 1 && Number.isInteger(m) && m > 1.5 ? `×${m}` : pct(m), tone: tone(m - 1) });
/** 더해지는 수치 (집중력·드래프트 품질 등) */
export const rowAdd = (label: string, d: number, goodUp = true): Row => ({ label, before: '±0', after: sgn(d), tone: tone(d, goodUp) });
/** 자리의 오버롤 전 → 후 */
export const rowOvr = (label: string, a: number, b: number): Row => ({ label, before: `${a}`, after: `${b} (${sgn(b - a)})`, tone: tone(b - a) });
export const rowInfo = (label: string, after: string, before?: string, t: Tone = 'info'): Row => ({ label, ...(before !== undefined ? { before } : {}), after, tone: t });
/** 변화 없음 한 줄 */
export const rowNone = (label = '변화'): Row => ({ label, after: '없음', tone: 'info' });

export const who = (p: Player): string => `${p.name} ${p.ovr}`;
