import { useEffect, useRef } from 'react';
import type { FacilityKind, StadiumScene } from '../game/types';
import { buildNightTint, drawFrame } from './dynamicLayer';
import { HOTSPOTS as GEO_HOTSPOTS, STADIUM_H as GH, STADIUM_W as GW } from './geometry';
import { buildStatic, staticKey, type StaticLayers } from './staticLayer';
import { SHOT_FXT } from './shotMode';

export const STADIUM_W = GW;
export const STADIUM_H = GH;

/** 시설 핫스팟(오버레이 배치용, 캔버스 픽셀 좌표). scoreboard 는 LED 패널 안쪽. */
export const HOTSPOTS: Record<FacilityKind | 'scoreboard', { x: number; y: number; w: number; h: number }> =
  GEO_HOTSPOTS;

const FRAME_MS = 70; // 약 14fps

export default function StadiumCanvas(props: { scene: StadiumScene; className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sceneRef = useRef<StadiumScene>(props.scene);
  sceneRef.current = props.scene;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;

    let raf = 0;
    let alive = true;
    let last = -1e9;
    let layers: StaticLayers | null = null;
    let night: HTMLCanvasElement | null = null;
    let fxKey: number | null = null;
    let fxStart = 0;

    const tick = (now: number) => {
      raf = 0;
      if (!alive || document.hidden) return; // 탭이 가려지면 루프를 쉰다
      raf = requestAnimationFrame(tick);
      if (now - last < FRAME_MS) return;
      render(now);
    };
    const render = (now: number) => {
      last = now;
      const scene = sceneRef.current;
      const key = staticKey(scene.facilities, scene.homeColor, scene.homeColor2);
      if (!layers || layers.key !== key) {
        layers = buildStatic(scene.facilities, scene.homeColor, scene.homeColor2);
      }
      if (scene.night && !night) night = buildNightTint();
      if (fxKey !== scene.fxKey) {
        // 첫 프레임에 이미 걸려 있던 fx 는 지난 것으로 보고 재생하지 않는다(build 연출 제외)
        const stale = fxKey === null && scene.fx.kind !== 'build' && !scene.playing;
        fxKey = scene.fxKey;
        fxStart = stale ? now - 60000 : now;
      }
      const fxT = SHOT_FXT !== null && scene.fx.kind === 'champion' ? SHOT_FXT : (now - fxStart) / 1000;
      drawFrame({ ctx, scene, layers, t: now / 1000, fxT, night });
    };
    const onVisibility = () => {
      if (!document.hidden && alive && raf === 0) raf = requestAnimationFrame(tick);
    };
    document.addEventListener('visibilitychange', onVisibility);
    if (!document.hidden) raf = requestAnimationFrame(tick);
    else render(performance.now()); // 가려진 채 열려도 첫 장면은 그려 둔다

    return () => {
      alive = false;
      document.removeEventListener('visibilitychange', onVisibility);
      cancelAnimationFrame(raf);
      layers = null;
      night = null;
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      width={STADIUM_W}
      height={STADIUM_H}
      className={props.className ?? 'pixel block h-auto w-full'}
      style={{ imageRendering: 'pixelated' }}
    />
  );
}
