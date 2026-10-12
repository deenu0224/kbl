// 구장 렌더러 단독 미리보기: http://localhost:5173/src/stadium/preview.html
import { StrictMode, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';
import type { FacilityKind, StadiumFx, StadiumScene, Weather } from '../game/types';
import StadiumCanvas, { HOTSPOTS, STADIUM_H, STADIUM_W } from './StadiumCanvas';

const TEAMS: { id: string; c: string; c2: string }[] = [
  { id: 'JEJ', c: '#f08a1c', c2: '#1f6b3a' },
  { id: 'SEL', c: '#c2185b', c2: '#1b2233' },
  { id: 'HAN', c: '#1a3a8f', c2: '#ffffff' },
  { id: 'BUS', c: '#0e7fb8', c2: '#f26a1b' },
  { id: 'DGU', c: '#1e56c4', c2: '#ffd23f' },
  { id: 'GWJ', c: '#d32f2f', c2: '#111111' },
  { id: 'ICN', c: '#b71c1c', c2: '#f5c518' },
  { id: 'DJN', c: '#f57c00', c2: '#212121' },
];

const FX: { label: string; fx: StadiumFx }[] = [
  { label: '없음', fx: { kind: 'none' } },
  { label: '홈런(홈·환호)', fx: { kind: 'hr', byHome: true, cheer: true } },
  { label: '홈런(원정)', fx: { kind: 'hr', byHome: false, cheer: false } },
  { label: '득점(환호)', fx: { kind: 'score', cheer: true } },
  { label: '득점', fx: { kind: 'score', cheer: false } },
  { label: '끝내기', fx: { kind: 'walkoff' } },
  { label: '승리', fx: { kind: 'win' } },
  { label: '부상', fx: { kind: 'injury' } },
  { label: '공사: 관중석', fx: { kind: 'build', target: 'seats' } },
  { label: '공사: 매점', fx: { kind: 'build', target: 'food' } },
  { label: '공사: 훈련장', fx: { kind: 'build', target: 'training' } },
];

function Row(props: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-16 shrink-0 text-hi">{props.label}</span>
      {props.children}
    </div>
  );
}

function Btn(props: { on?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" className={`px-btn ${props.on ? 'gold' : ''}`} onClick={props.onClick}>
      {props.children}
    </button>
  );
}

function Preview() {
  const [fac, setFac] = useState({ seats: 0, food: 0, training: 0 });
  const [fill, setFill] = useState(0.5);
  const [weather, setWeather] = useState<Weather>('sunny');
  const [night, setNight] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [homeBatting, setHomeBatting] = useState(true);
  const [banners, setBanners] = useState(0);
  const [home, setHome] = useState(0);
  const [away, setAway] = useState(1);
  const [fx, setFx] = useState<StadiumFx>({ kind: 'none' });
  const [fxKey, setFxKey] = useState(0);
  const [spots, setSpots] = useState(false);

  const scene: StadiumScene = {
    facilities: fac,
    homeColor: TEAMS[home].c,
    homeColor2: TEAMS[home].c2,
    awayColor: TEAMS[away].c,
    fill,
    weather,
    night,
    playing,
    homeBatting,
    fx,
    fxKey,
    banners,
  };

  const setLv = (k: FacilityKind, v: number, withFx: boolean) => {
    setFac((f) => ({ ...f, [k]: v }));
    if (withFx) {
      setFx({ kind: 'build', target: k });
      setFxKey((n) => n + 1);
    }
  };

  const kinds: [FacilityKind, string][] = [
    ['seats', '관중석'],
    ['food', '매점'],
    ['training', '훈련장'],
  ];

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-3 p-4 lg:flex-row">
      <div className="min-w-0 flex-1">
        <div className="relative w-full" style={{ aspectRatio: `${STADIUM_W} / ${STADIUM_H}` }}>
          <StadiumCanvas scene={scene} className="pixel absolute inset-0 block h-full w-full" />
          {spots &&
            (Object.keys(HOTSPOTS) as (keyof typeof HOTSPOTS)[]).map((k) => {
              const r = HOTSPOTS[k];
              return (
                <div
                  key={k}
                  className="pointer-events-none absolute text-hi"
                  style={{
                    left: `${(r.x / STADIUM_W) * 100}%`,
                    top: `${(r.y / STADIUM_H) * 100}%`,
                    width: `${(r.w / STADIUM_W) * 100}%`,
                    height: `${(r.h / STADIUM_H) * 100}%`,
                    outline: '2px dashed #ffd84a',
                  }}
                >
                  {k}
                </div>
              );
            })}
        </div>
      </div>
      <div className="px-panel flex w-full shrink-0 flex-col gap-3 p-3 lg:w-[380px]">
        {kinds.map(([k, label]) => (
          <Row key={k} label={label}>
            {[0, 1, 2, 3, 4].map((v) => (
              <Btn key={v} on={fac[k] === v} onClick={() => setLv(k, v, v > fac[k])}>
                Lv{v + 1}
              </Btn>
            ))}
          </Row>
        ))}
        <Row label="전체">
          {[0, 1, 2, 3, 4].map((v) => (
            <Btn key={v} onClick={() => setFac({ seats: v, food: v, training: v })}>
              Lv{v + 1}
            </Btn>
          ))}
        </Row>
        <Row label="관중">
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={fill}
            onChange={(e) => setFill(Number(e.target.value))}
            className="flex-1"
          />
          <span className="w-10 text-right">{Math.round(fill * 100)}%</span>
          {[0.3, 0.9].map((v) => (
            <Btn key={v} onClick={() => setFill(v)}>
              {v * 100}%
            </Btn>
          ))}
        </Row>
        <Row label="날씨">
          {(['sunny', 'cloudy', 'rain'] as Weather[]).map((w) => (
            <Btn key={w} on={weather === w} onClick={() => setWeather(w)}>
              {w === 'sunny' ? '맑음' : w === 'cloudy' ? '흐림' : '비'}
            </Btn>
          ))}
          <Btn on={night} onClick={() => setNight((v) => !v)}>
            야간
          </Btn>
        </Row>
        <Row label="경기">
          <Btn on={playing} onClick={() => setPlaying((v) => !v)}>
            {playing ? '재생 중' : '연습'}
          </Btn>
          <Btn on={homeBatting} onClick={() => setHomeBatting((v) => !v)}>
            {homeBatting ? '홈 공격' : '원정 공격'}
          </Btn>
        </Row>
        <Row label="fx">
          {FX.map((it) => (
            <Btn
              key={it.label}
              onClick={() => {
                setFx(it.fx);
                setFxKey((n) => n + 1);
              }}
            >
              {it.label}
            </Btn>
          ))}
        </Row>
        <Row label="배너">
          {[0, 1, 2, 3].map((v) => (
            <Btn key={v} on={banners === v} onClick={() => setBanners(v)}>
              {v}
            </Btn>
          ))}
          <Btn on={spots} onClick={() => setSpots((v) => !v)}>
            핫스팟 표시
          </Btn>
        </Row>
        <Row label="홈">
          {TEAMS.map((t, i) => (
            <Btn key={t.id} on={home === i} onClick={() => setHome(i)}>
              <span style={{ color: home === i ? undefined : t.c }}>■</span> {t.id}
            </Btn>
          ))}
        </Row>
        <Row label="원정">
          {TEAMS.map((t, i) => (
            <Btn key={t.id} on={away === i} onClick={() => setAway(i)}>
              <span style={{ color: away === i ? undefined : t.c }}>■</span> {t.id}
            </Btn>
          ))}
        </Row>
        <div className="opacity-70">
          fxKey {fxKey} · {STADIUM_W}×{STADIUM_H}
        </div>
      </div>
    </div>
  );
}

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <Preview />
    </StrictMode>,
  );
}
