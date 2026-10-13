import { useUi } from './layout/uiStore';
import { useMemo, useState } from 'react';
import type { StadiumScene } from '../game/types';
import StadiumCanvas, { STADIUM_H, STADIUM_W } from '../stadium/StadiumCanvas';
import { useCore, useStore, useUserTeam } from '../store';
import { sceneExtras } from '../game/campaign';
import { Chronicle, Retired, StageTrail } from './Campaign';
import { SectionTitle } from './ui';

/** 도민 지지 0: 연고 이전. 구단사와 지나온 장을 보여주고 새 게임으로. */
export default function GameOver() {
  const core = useCore();
  const { campaign, facilities } = core;
  const season = useStore((s) => s.season);
  const newGame = () => useUi.getState().setScreen('title');
  const team = useUserTeam();
  const [arm, setArm] = useState(false);
  const history = campaign.history ?? [];
  const retired = campaign.retired ?? [];

  const scene = useMemo<StadiumScene>(
    () => ({
      facilities,
      homeColor: team.color,
      homeColor2: team.color2,
      awayColor: '#8892b0',
      fill: 0,
      weather: 'cloudy',
      night: true,
      playing: false,
      homeBatting: false,
      fx: { kind: 'none' },
      fxKey: 0,
      ...sceneExtras(core),
      gateQueue: 0,
    }),
    [facilities, team.color, team.color2, core],
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/95 p-4 mob:items-stretch mob:p-0"
      style={{ paddingTop: 'max(env(safe-area-inset-top), 0px)', paddingBottom: 'env(safe-area-inset-bottom)' }}
      role="dialog"
      aria-label="연고 이전"
    >
      <div className="px-panel px-scroll flex max-h-full w-full max-w-[720px] flex-col overflow-y-auto p-4 mob:p-3">
        <div className="text-[11px] text-bad">{season}시즌 · 연고 이전 확정</div>
        <div className="font-pixel-lg text-[26px] leading-tight text-white mob:text-[22px]" style={{ textShadow: '2px 2px 0 #0f1420' }}>
          팀이 섬을 떠났습니다
        </div>
        <div className="mt-1 text-[12px] text-white/65 mob:text-[13px]">
          {team.city} {team.name} — 도민 지지 <span className="text-bad">{Math.round(campaign.verdict?.trustBefore ?? 0)} → 0</span>
        </div>

        <div className="relative mx-auto mt-3 w-full max-w-[420px] opacity-80" style={{ aspectRatio: `${STADIUM_W} / ${STADIUM_H}`, boxShadow: '0 0 0 2px #0f1420' }}>
          <StadiumCanvas scene={scene} className="pixel absolute inset-0 block h-full w-full" />
        </div>

        <SectionTitle>구단사</SectionTitle>
        <Chronicle history={history} rankSize={22} />

        <SectionTitle>지나온 장</SectionTitle>
        <StageTrail stage={campaign.stage} />

        {retired.length > 0 && (
          <>
            <SectionTitle>영구결번</SectionTitle>
            <Retired list={retired} />
          </>
        )}

        <div className="mt-4 flex justify-end mob:sticky mob:-bottom-3 mob:-mx-3 mob:-mb-3 mob:bg-panel mob:p-3">
          <button
            className="px-btn primary min-h-11 !px-6 text-[14px] mob:flex-1"
            onClick={() => {
              if (!arm) return setArm(true);
              newGame();
            }}
          >
            {arm ? '초기 화면으로 나가기' : '초기 화면'}
          </button>
        </div>
      </div>
    </div>
  );
}
