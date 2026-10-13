// 글 생성기 점검: 봇 플레이 기록 40개(봇 4종 · 1~12시즌에서 끊음)에 올라갈 글을 만들어 X 제한(280)을 넘는 것이 없는지 본다.
// 유형(우승 · 연고 이전 · 진행 중)별 전문과 "깨달은 것" 문장이 나온 횟수도 찍는다.
// 실행: npm run share:texts [개수]  (외부로는 아무것도 보내지 않는다)
import { shareFromCore, type Lesson, type ShareKind } from '../../src/share/shareData';
import { shareText, storyOf, xWeight, X_LIMIT } from '../../src/share/story';
import { BOTS, simulate } from './bench';

const N = Number(process.argv[2]) || 40;
const NOTE = '가'.repeat(60); // 가장 긴 소감
interface Row {
  who: string;
  type: string; // 결과 줄의 유형
  text: string;
  w: number;
  wNote: number;
  lines: number;
  lesson: string | null;
  can: Lesson[];
}
const rows: Row[] = [];
for (let i = 0; i < N; i++) {
  const bot = BOTS[i % BOTS.length];
  const seasons = 1 + ((i * 5) % 12);
  let done = null as ShareKind | null;
  const core = simulate(bot, 100 + i, seasons, (c) => {
    if (c.phase === 'over') done = 'relocated';
  });
  const h = core.campaign.history;
  const kind: ShareKind = done ?? (h[h.length - 1].post === 'champion' ? 'champion' : 'season');
  const d = shareFromCore(core, kind);
  const text = shareText(d);
  const s = storyOf(d);
  const type = kind === 'relocated' ? '연고 이전' : kind === 'champion' ? '우승' : d.rec.champAt ? '우승 뒤 진행 중' : d.rec.firstPostAt ? (d.rec.last.post !== 'none' ? '가을야구' : '가을야구 뒤') : `진행 중 ${d.rec.last.rank}위`;
  rows.push({
    who: `${type} · ${bot.name} · 시드 ${100 + i} · ${h.length}시즌 · ${d.code} · 상위 ${d.pct.pct}%`,
    type,
    text,
    w: xWeight(text),
    wNote: xWeight(shareText(d, NOTE)),
    lines: text.split('\n').length,
    lesson: s.lesson,
    can: d.lessons ?? [],
  });
}
const over = rows.filter((r) => r.w > X_LIMIT || r.wNote > X_LIMIT);
// 유형마다 하나씩, 모자라면 앞에서부터 채워 8개
const shown: Row[] = [];
for (const r of rows) if (!shown.some((x) => x.type === r.type)) shown.push(r);
for (const r of rows) if (shown.length < 8 && !shown.includes(r)) shown.push(r);
for (const r of shown.slice(0, 8)) console.log(`── ${r.who} (길이 ${r.w} · ${r.lines}줄)\n${r.text}\n`);
const count = <T,>(xs: T[]) => [...xs.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map<T, number>())].map(([k, v]) => `${k} ${v}`).join(' · ');
console.log(`글 ${rows.length}개 · ${Math.min(...rows.map((r) => r.lines))}~${Math.max(...rows.map((r) => r.lines))}줄 · 최대 길이 ${Math.max(...rows.map((r) => r.w))} (소감 60자일 때 ${Math.max(...rows.map((r) => r.wNote))}) / ${X_LIMIT} · 초과 ${over.length}건`);
console.log(`유형: ${count(rows.map((r) => r.type))}`);
console.log(`깨달은 것(글에 나옴): ${count(rows.map((r) => r.lesson ?? '(없음)'))}`);
console.log(`깨달은 것(해당 구단 수): ${count(rows.flatMap((r) => r.can))}`);
console.log(`소감 60자일 때 줄어든 글: ${rows.filter((r) => r.wNote - r.w < 120).length}개`);
if (over.length) process.exit(1);
