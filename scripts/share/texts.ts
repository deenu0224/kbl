// 글 생성기 점검: 봇 플레이 기록 30개(봇 4종 · 1~9시즌에서 끊음)에 올라갈 글을 만들어 X 제한(280)을 넘는 것이 없는지 본다.
// 실행: npm run share:texts  (외부로는 아무것도 보내지 않는다)
import { shareFromCore, type ShareKind } from '../../src/share/shareData';
import { shareText, xWeight, X_LIMIT } from '../../src/share/story';
import { BOTS, simulate } from './bench';

const N = Number(process.argv[2]) || 30;
const NOTE = '가'.repeat(60); // 가장 긴 소감
const rows: { who: string; text: string; w: number; wNote: number; lines: number }[] = [];
for (let i = 0; i < N; i++) {
  const bot = BOTS[i % BOTS.length];
  const seasons = 1 + ((i * 5) % 9);
  let done: ShareKind | null = null;
  const core = simulate(bot, 100 + i, seasons, (c) => {
    if (c.phase === 'over') done = 'relocated';
  });
  const kind: ShareKind = done ?? (core.campaign.history[core.campaign.history.length - 1].post === 'champion' ? 'champion' : 'season');
  const d = shareFromCore(core, kind);
  const text = shareText(d);
  rows.push({ who: `${bot.name} · 시드 ${100 + i} · ${core.campaign.history.length}시즌 · ${d.code} · 상위 ${d.pct.pct}%`, text, w: xWeight(text), wNote: xWeight(shareText(d, NOTE)), lines: text.split('\n').length - 1 });
}
const over = rows.filter((r) => r.w > X_LIMIT || r.wNote > X_LIMIT);
const pickN = [0, 1, 2, 6, 13].map((i) => rows[i % rows.length]);
for (const r of pickN) console.log(`── ${r.who} (길이 ${r.w})\n${r.text}\n`);
console.log(`글 ${rows.length}개 · 이야기 문장 ${Math.min(...rows.map((r) => r.lines))}~${Math.max(...rows.map((r) => r.lines))}개 · 최대 길이 ${Math.max(...rows.map((r) => r.w))} (소감 60자일 때 ${Math.max(...rows.map((r) => r.wNote))}) / ${X_LIMIT} · 초과 ${over.length}건`);
console.log(`유형: ${[...new Set(rows.map((r) => r.who.split(' · ')[3]))].join(' ')}`);
if (over.length) process.exit(1);
