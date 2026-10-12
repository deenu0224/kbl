import { useEffect, useMemo, useState } from 'react';
import type { StadiumScene } from '../game/types';
import StadiumCanvas, { STADIUM_H, STADIUM_W } from '../stadium/StadiumCanvas';
import { useStore, useUserTeam } from '../store';
import * as story from '../game/story';

// 문구는 story.ts 에 ENDING_LINES / ENDING_LINES_DEALT 가 생기면 그것을 쓴다. 아래는 임시 상수.
const TEMP_LINES = ['시즌이 끝난 구장.', `${story.TITLE_YEARS_AGO}시즌을 혼자 걸려 있던 바랜 깃발 옆에`, '두 번째 깃발이 걸렸다.'];
const TEMP_LINES_DEALT = [...TEMP_LINES, '협상 테이블에 앉았던 날을, 섬은 기억한다.'];

function endingLines(dealt: boolean): string[] {
  const data = story as unknown as Record<string, unknown>;
  const pick = (k: string) => (Array.isArray(data[k]) && (data[k] as unknown[]).every((x) => typeof x === 'string') ? (data[k] as string[]) : null);
  return (dealt ? pick('ENDING_LINES_DEALT') : null) ?? pick('ENDING_LINES') ?? (dealt ? TEMP_LINES_DEALT : TEMP_LINES);
}

/** 엔딩: 우승 장면이 아니라, 바랜 깃발 옆에 두 번째 깃발이 걸린 빈 구장. 본 뒤에는 계속 플레이. */
export default function EndingScene({ onDone }: { onDone: () => void }) {
  const facilities = useStore((s) => s.facilities);
  const campaign = useStore((s) => s.campaign);
  const team = useUserTeam();
  const lines = useMemo(() => endingLines(!!campaign.dealt), [campaign.dealt]);
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
      banners: Math.max(1, Math.min(3, campaign.titles ?? 1)),
      oldBanner: true,
      gateQueue: 0,
      cheerLv: 0,
      retiredNums: Math.min(4, campaign.retired?.length ?? 0),
    }),
    [facilities, team.color, team.color2, campaign.titles, campaign.retired?.length],
  );

  return (
    <div className="anim-fade fixed inset-0 z-[70] flex flex-col items-center justify-center gap-3 bg-ink p-3" role="dialog" aria-label="엔딩">
      <div className="relative w-full" style={{ maxWidth: `min(880px, calc((100dvh - 220px) * ${STADIUM_W} / ${STADIUM_H}))`, aspectRatio: `${STADIUM_W} / ${STADIUM_H}`, boxShadow: '0 0 0 2px #0f1420' }}>
        <StadiumCanvas scene={scene} className="pixel absolute inset-0 block h-full w-full" />
      </div>
      <div className="flex min-h-[92px] flex-col items-center gap-1 text-center">
        {lines.slice(0, shown).map((l, i) => (
          <div key={i} className={`anim-fade-slow ${i === lines.length - 1 || i === 2 ? 'font-pixel-lg text-[18px] text-hi' : 'text-[14px] text-white/85'}`} style={{ textShadow: '1px 1px 0 #0f1420' }}>
            {l}
          </div>
        ))}
      </div>
      <button className={`px-btn min-h-11 !px-6 text-[14px] ${shown >= lines.length ? '' : 'opacity-40'}`} onClick={onDone}>
        계속
      </button>
    </div>
  );
}
