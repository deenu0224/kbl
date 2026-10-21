// 구장 렌더러 단독 미리보기: http://localhost:5173/src/stadium/preview.html
import { StrictMode, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';
import type { FacilityKind, StadiumFx, StadiumScene, Weather } from '../game/types';
import { TEAM_DEFS, USER_ID } from '../game/generate';
import StadiumCanvas, { HOTSPOTS, STADIUM_H, STADIUM_W } from './StadiumCanvas';

const TEAMS: { id: string; c: string; c2: string }[] = [...TEAM_DEFS].sort((a, b) => +(b.id === USER_ID) - +(a.id === USER_ID)).map((d) => ({ id: d.id, c: d.color, c2: d.color2 }));

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
  { label: '우승(홈)', fx: { kind: 'champion', away: false, c1: '', c2: '' } },
  { label: '우승(원정)', fx: { kind: 'champion', away: true, c1: '', c2: '' } },
  { label: '우승(움직임 줄임)', fx: { kind: 'champion', away: false, c1: '', c2: '', calm: true } },
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

// 쿼리로 초기 상태 지정(스크린샷 자동화용): ?lv=4&fill=0.9&weather=rain&cheer=3&queue=0.6&retired=2&old=1&banners=1&phone=1&night=1&fx=3
const Q = new URLSearchParams(window.location.search);
function qNum(k: string): number | undefined {
  const v = Q.get(k);
  if (v === null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

const PHONE_W = 390;

function Preview() {
  const lv0 = qNum('lv') ?? 0;
  const [fac, setFac] = useState({
    seats: qNum('seats') ?? lv0,
    food: qNum('food') ?? lv0,
    training: qNum('training') ?? lv0,
  });
  const [fill, setFill] = useState(qNum('fill') ?? 0.5);
  const [weather, setWeather] = useState<Weather>(
    Q.get('weather') === 'rain' ? 'rain' : Q.get('weather') === 'cloudy' ? 'cloudy' : 'sunny',
  );
  const [night, setNight] = useState(Q.get('night') === '1');
  const [playing, setPlaying] = useState(false);
  const [homeBatting, setHomeBatting] = useState(true);
  const [banners, setBanners] = useState(qNum('banners') ?? 0);
  const [wall, setWall] = useState(qNum('wall') ?? 0);
  // v3 필드: undefined = 필드 없음(기존 화면)
  const [oldBanner, setOldBanner] = useState<boolean | undefined>(Q.has('old') ? Q.get('old') === '1' : undefined);
  const [gateQueue, setGateQueue] = useState<number | undefined>(qNum('queue'));
  const [cheerLv, setCheerLv] = useState<number | undefined>(qNum('cheer'));
  const [retiredNums, setRetiredNums] = useState<number | undefined>(qNum('retired'));
  const [dome, setDome] = useState<0 | 1 | 2 | 3 | undefined>(qNum('dome') as 0 | 1 | 2 | 3 | undefined);
  const [phone, setPhone] = useState(Q.get('phone') === '1');
  const [home, setHome] = useState(0);
  const [away, setAway] = useState(1);
  const [fx, setFx] = useState<StadiumFx>(FX[qNum('fx') ?? 0]?.fx ?? { kind: 'none' });
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
    // 우승 fx 의 팀 색은 "우리 팀"(홈이면 홈, 원정 우승이면 원정 팀) 색으로 채운다
    fx: fx.kind === 'champion' ? { ...fx, c1: TEAMS[fx.away ? away : home].c, c2: TEAMS[fx.away ? away : home].c2 } : fx,
    fxKey,
    banners,
    titleWall: [3, 5].slice(2 - Math.min(2, wall)),
    autumn: Q.get('autumn') === '1',
    awayFans: fx.kind === 'champion' && fx.away ? 0.2 : undefined,
    oldBanner,
    gateQueue,
    cheerLv,
    retiredNums,
    dome,
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
        <div
          id="stage"
          className="relative w-full"
          style={{ aspectRatio: `${STADIUM_W} / ${STADIUM_H}`, maxWidth: phone ? PHONE_W : undefined }}
        >
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
        <Row label="펜스 우승">
          {[0, 1, 2].map((v) => (
            <Btn key={v} on={wall === v} onClick={() => setWall(v)}>
              {v}
            </Btn>
          ))}
        </Row>
        <Row label="옛 깃발">
          <Btn on={oldBanner === undefined} onClick={() => setOldBanner(undefined)}>
            없음
          </Btn>
          <Btn on={oldBanner === true} onClick={() => setOldBanner(true)}>
            바랜 깃발
          </Btn>
        </Row>
        <Row label="대기 줄">
          <Btn on={gateQueue === undefined} onClick={() => setGateQueue(undefined)}>
            없음
          </Btn>
          {[0, 0.25, 0.5, 1].map((v) => (
            <Btn key={v} on={gateQueue === v} onClick={() => setGateQueue(v)}>
              {v * 100}%
            </Btn>
          ))}
        </Row>
        <Row label="응원">
          <Btn on={cheerLv === undefined} onClick={() => setCheerLv(undefined)}>
            없음
          </Btn>
          {[0, 1, 2, 3].map((v) => (
            <Btn key={v} on={cheerLv === v} onClick={() => setCheerLv(v)}>
              {v}
            </Btn>
          ))}
        </Row>
        <Row label="돔구장">
          {([undefined, 1, 2, 3] as const).map((v) => (
            <Btn key={v ?? 'x'} on={dome === v} onClick={() => setDome(v)}>
              {v === undefined ? '없음' : ['', '설계', '착공', '완공'][v]}
            </Btn>
          ))}
        </Row>
        <Row label="영구결번">
          <Btn on={retiredNums === undefined} onClick={() => setRetiredNums(undefined)}>
            없음
          </Btn>
          {[0, 1, 2, 3, 4].map((v) => (
            <Btn key={v} on={retiredNums === v} onClick={() => setRetiredNums(v)}>
              {v}
            </Btn>
          ))}
        </Row>
        <Row label="비">
          <Btn
            on={weather === 'rain' && fac.seats < 2}
            onClick={() => {
              setWeather('rain');
              setFac((f) => ({ ...f, seats: 0 }));
            }}
          >
            비 + 지붕 없음
          </Btn>
          <Btn
            on={weather === 'rain' && fac.seats >= 2}
            onClick={() => {
              setWeather('rain');
              setFac((f) => ({ ...f, seats: 3 }));
            }}
          >
            비 + 지붕
          </Btn>
        </Row>
        <Row label="화면">
          <Btn on={phone} onClick={() => setPhone((v) => !v)}>
            폰 크기로 보기({PHONE_W}px 폭)
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
