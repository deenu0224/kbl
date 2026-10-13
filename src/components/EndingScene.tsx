import { useEffect, useMemo, useState } from 'react';
import type { StadiumScene } from '../game/types';
import StadiumCanvas, { STADIUM_H, STADIUM_W } from '../stadium/StadiumCanvas';
import { useCore, useUserTeam } from '../store';
import { sceneExtras } from '../game/campaign';
import { SCANDAL_NEWS, endingText } from '../game/story';
import { ShareButton } from './ShareSheet';

/** 엔딩: 우승 장면이 아니라, 바랜 깃발 옆에 두 번째 깃발이 걸린 빈 구장. 본 뒤에는 계속 플레이. */
export default function EndingScene({ onDone }: { onDone: () => void }) {
  const core = useCore();
  const { facilities, campaign } = core;
  const team = useUserTeam();
  // 제목 + 본문을 문장 단위로 한 줄씩 띄운다
  const lines = useMemo(() => {
    const e = endingText(campaign);
    return [e.title, ...e.text.split(/(?<=\.)\s+/).filter(Boolean), ...(campaign.history.some((h) => h.tainted) ? [`${SCANDAL_NEWS.tainted}.`] : [])];
  }, [campaign]);
  const [shown, setShown] = useState(0);

  useEffect(() => {
    if (shown >= lines.length) return;
    const id = window.setTimeout(() => setShown((n) => n + 1), shown === 0 ? 900 : 1700);
    return () => window.clearTimeout(id);
  }, [shown, lines.length]);

  const scene = useMemo<StadiumScene>(
    () => ({
      facilities,
      homeColor: team.color,
      homeColor2: team.color2,
      awayColor: '#8892b0',
      fill: 0,
      weather: 'sunny',
      night: false,
      playing: false,
      homeBatting: false,
      fx: { kind: 'none' },
      fxKey: 0,
      // 시즌이 끝난 빈 구장: 깃발·영구결번·응원 문화는 로직이 정한 그대로
      ...sceneExtras(core),
      gateQueue: 0,
    }),
    [facilities, team.color, team.color2, core],
  );

  return (
    <div className="anim-fade fixed inset-0 z-[70] flex flex-col items-center justify-center gap-3 bg-ink p-3" role="dialog" aria-label="엔딩">
      <div className="relative w-full" style={{ maxWidth: `min(880px, calc((100dvh - 220px) * ${STADIUM_W} / ${STADIUM_H}))`, aspectRatio: `${STADIUM_W} / ${STADIUM_H}`, boxShadow: '0 0 0 2px #0f1420' }}>
        <StadiumCanvas scene={scene} className="pixel absolute inset-0 block h-full w-full" />
      </div>
      <div className="flex min-h-[92px] flex-col items-center gap-1 px-2 text-center">
        {lines.slice(0, shown).map((l, i) => (
          <div key={i} className={`anim-fade-slow ${i === 0 ? 'font-pixel-lg text-[20px] text-hi' : 'text-[14px] text-white/85'}`} style={{ textShadow: '1px 1px 0 #0f1420' }}>
            {l}
          </div>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <ShareButton kind="champion" />
        <button className={`px-btn primary min-h-11 !px-8 text-[15px] ${shown >= lines.length ? '' : 'opacity-40'}`} onClick={onDone}>
          계속
        </button>
      </div>
    </div>
  );
}
