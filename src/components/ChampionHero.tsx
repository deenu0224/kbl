import { useEffect, useMemo, useRef, useState } from 'react';
import type { Core, Team } from '../game/types';
import { TITLE_YEARS_AGO } from '../game/story';
import { seriesMvp } from '../game/postseason';
import { seasonAwards } from '../game/season';
import { fmtAvg, fmtEra, fmtInt } from '../game/format';
import { pennant } from '../stadium/dynamicLayer';
import { reducedMotion } from '../stadium/shotMode';
import PixelFace from './PixelFace';
import { ShareButton } from './ShareSheet';

/** 우승 문구: 첫 우승은 "N년 만의 우승"(공유 글과 같은 숫자), 연속이면 "N연패", 아니면 "통산 N번째 우승" */
export function titleHeadline(core: Pick<Core, 'season' | 'campaign'>): { big: string; sub: string } {
  const h = core.campaign.history ?? [];
  const seasons = h.filter((r) => r.post === 'champion').map((r) => r.season);
  if (!seasons.includes(core.season)) seasons.push(core.season);
  const n = seasons.length;
  if (n <= 1) return { big: `${TITLE_YEARS_AGO + core.season - 1}년 만의 우승`, sub: '바랜 우승기 옆에 새 우승기를 겁니다' };
  let streak = 1;
  while (seasons.includes(core.season - streak)) streak++;
  if (streak >= 2) return { big: `${streak}연패`, sub: `통산 ${n}번째 우승` };
  const prev = seasons.filter((s) => s < core.season).pop() ?? core.season;
  return { big: `통산 ${n}번째 우승`, sub: `${core.season - prev}년 만에 다시 정상` };
}

/** 큰 우승기: 구장의 우승 깃발 그림을 그대로 키운다 */
function BigPennant({ color }: { color: string }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const cv = ref.current;
    const ctx = cv?.getContext('2d');
    if (!cv || !ctx) return;
    let wave = 0;
    const draw = () => {
      ctx.clearRect(0, 0, cv.width, cv.height);
      ctx.fillStyle = '#5b6886';
      ctx.fillRect(3, 1, 1, 27); // 깃대
      pennant(ctx, 4, 4, color, wave);
    };
    draw();
    if (reducedMotion()) return;
    const id = window.setInterval(() => {
      wave ^= 1;
      draw();
    }, 420);
    return () => window.clearInterval(id);
  }, [color]);
  return <canvas ref={ref} width={20} height={28} className="pixel block h-[112px] w-[80px] shrink-0 mob:h-[84px] mob:w-[60px]" style={{ imageRendering: 'pixelated' }} aria-hidden />;
}

/** 0 → target 으로 한 번 올라가는 숫자 (움직임 줄이기면 바로 최종값) */
function useCountUp(target: number, ms = 1300, delay = 300): number {
  const [v, setV] = useState(() => (reducedMotion() ? target : 0));
  useEffect(() => {
    if (reducedMotion()) return setV(target);
    let raf = 0;
    const t0 = performance.now() + delay;
    const tick = (now: number) => {
      const p = Math.max(0, Math.min(1, (now - t0) / ms));
      setV(Math.round(target * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms, delay]);
  return v;
}

function Num({ label, value, unit, color = '#ffd84a' }: { label: string; value: string; unit?: string; color?: string }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col items-center bg-ink/60 px-1 py-1.5">
      <div className="text-[11px] text-white/60">{label}</div>
      <div className="font-pixel-lg whitespace-nowrap text-[20px] leading-tight mob:text-[18px]" style={{ color }}>
        {value}
        {unit && <span className="font-pixel text-[12px] text-white/70">{unit}</span>}
      </div>
    </div>
  );
}

/** 우승 시즌 결산의 맨 위: 큰 우승기 · N년 만의 우승 · 한국시리즈 MVP · 시즌 숫자 · 공유 */
export default function ChampionHero({ core, team, rank }: { core: Core; team: Team; rank: number }) {
  const head = useMemo(() => titleHeadline(core), [core]);
  const ks = core.post?.series.find((s) => s.round === 'KS');
  const opp = ks ? core.teams.find((t) => t.id === (ks.hiId === core.userId ? ks.loId : ks.hiId)) : undefined;
  const myW = ks ? (ks.hiId === core.userId ? ks.hiW : ks.loW) : 0;
  const oppW = ks ? (ks.hiId === core.userId ? ks.loW : ks.hiW) : 0;
  // 시리즈 MVP: 한국시리즈 누적 기록. 옛 세이브처럼 기록이 없으면 정규시즌 팀 MVP 로 대신한다
  const mvp = useMemo(() => {
    const m = seriesMvp(core.post?.ksBox);
    if (m) return { ...m, label: '한국시리즈 MVP' };
    const a = seasonAwards(core);
    const p = a.mvpBat ?? a.mvpPit;
    if (!p) return null;
    const text = p.kind === 'B' ? `타율 ${fmtAvg(p.bat.h, p.bat.ab)} · ${p.bat.hr}홈런 · ${p.bat.rbi}타점` : `ERA ${fmtEra(p.pit.er, p.pit.outs)} · ${p.pit.w}승`;
    return { pid: p.id, name: p.name, kind: p.kind, text, label: '우승 시즌 팀 MVP' };
  }, [core]);
  const att = core.attHistory.reduce((a, b) => a + b, 0);
  const w = useCountUp(team.rec.w);
  const l = useCountUp(team.rec.l);
  const people = useCountUp(att, 1600);

  return (
    <div className="relative overflow-hidden px-3 py-3" data-testid="champion-hero" style={{ background: `linear-gradient(180deg, ${team.color}55, #141a29 85%)`, boxShadow: `0 0 0 2px #0f1420, inset 0 0 0 2px ${team.color}` }}>
      <div className="text-[11px] text-sky">
        {core.season}시즌 결산 · 한국시리즈 우승
      </div>
      <div className="mt-1 flex items-center gap-3">
        <BigPennant color={team.color} />
        <div className="min-w-0 flex-1">
          <div className="font-pixel-lg truncate text-[18px] leading-tight mob:text-[16px]" style={{ color: '#fff', textShadow: `2px 2px 0 ${team.color}` }}>
            {team.city} {team.name}
          </div>
          <div className="anim-pop font-pixel-lg text-[34px] leading-none text-hi mob:text-[28px]" style={{ textShadow: '3px 3px 0 #0f1420' }} data-testid="champion-big">
            {head.big}
          </div>
          <div className="mt-1 text-[13px] text-white/85">{head.sub}</div>
          {ks && opp && (
            <div className="mt-0.5 text-[12px] text-white/60 mob:text-[13px]">
              한국시리즈 {opp.name} 상대 {myW}승 {oppW}패
            </div>
          )}
        </div>
      </div>

      <div className="mt-3 grid grid-cols-[1.4fr_1fr] gap-2 por:grid-cols-1">
        {mvp ? (
          <div className="flex items-center gap-2 bg-ink/60 p-2" data-testid="champion-mvp" style={{ boxShadow: `inset 3px 0 0 ${team.color}` }}>
            <PixelFace id={mvp.pid} color={team.color} color2={team.color2} size={48} />
            <div className="min-w-0 flex-1">
              <div className="text-[11px] text-hi">{mvp.label}</div>
              <div className="font-pixel-lg truncate text-[16px] leading-tight">{mvp.name}</div>
              <div className="text-[12px] text-white/80 mob:text-[13px]">{mvp.text}</div>
            </div>
          </div>
        ) : (
          <div />
        )}
        <div className="flex gap-1">
          <Num label="정규시즌" value={`${w}-${l}`} />
          <Num label="순위" value={`${rank}`} unit="위" color="#fff" />
          <Num label="홈 관중" value={people >= 100000 ? (people / 10000).toFixed(1) : fmtInt(people)} unit={people >= 100000 ? '만' : '명'} color="#6ee07a" />
        </div>
      </div>

      <div className="mt-3 flex justify-center">
        <ShareButton kind="champion" label="우승 소식 공유" className="gold !min-h-12 !px-8 text-[15px]" />
      </div>
    </div>
  );
}
