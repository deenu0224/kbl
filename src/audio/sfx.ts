/** Asset-free, lazily initialized stadium chiptunes. All timings are seconds. */
import { CEREMONY_MS, CHAMP_POPS } from '../stadium/ceremony';
export type SfxName =
  | 'click' | 'tab' | 'error' | 'coin' | 'buy' | 'build'
  | 'playball' | 'hit' | 'homerun' | 'cheer' | 'groan'
  | 'win' | 'lose' | 'walkoff' | 'injury' | 'event'
  | 'achievement' | 'champion' | 'crown' | 'crownShort';

type Wave = 'square' | 'triangle';
type Note = readonly [frequency: number, duration: number, wave: Wave];
type Sequence = readonly Note[];
interface AudioEngine {
  context: AudioContext;
  master: GainNode;
  compressor: DynamicsCompressorNode;
  noise: AudioBuffer;
}

function read(key: string): string | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function save(key: string, value: string): void {
  try {
    if (typeof window !== 'undefined') window.localStorage.setItem(key, value);
  } catch {
    // Private browsing and disabled storage must not break the game.
  }
}

const savedVolume = read('kbl-volume');
const parsedVolume = savedVolume === null || savedVolume.trim() === ''
  ? NaN : Number(savedVolume);
let volume = Number.isFinite(parsedVolume) ? Math.max(0, Math.min(1, parsedVolume)) : 0.5;
let muted = read('kbl-muted') === 'true';
let engine: AudioEngine | undefined;
const lastPlayed = new Map<SfxName, number>();
const C = 523.25, D = 587.33, E = 659.25, F = 698.46;
const G = 783.99, A = 880, B = 987.77, HIGH_C = 1046.5;

const melodies = {
  click: [[G, 0.035, 'square']],
  tab: [[C, 0.045, 'triangle'], [G, 0.065, 'square']],
  error: [[110, 0.09, 'square'], [82.41, 0.14, 'square']],
  coin: [[B, 0.075, 'square'], [E * 2, 0.18, 'square']],
  buy: [[G, 0.045, 'square'], [HIGH_C, 0.045, 'square'],
    [E * 2, 0.075, 'square'], [G * 2, 0.22, 'triangle']],
  build: [[C, 0.09, 'square'], [E, 0.09, 'square'],
    [G, 0.09, 'square'], [HIGH_C, 0.24, 'triangle']],
  playball: [[C, 0.13, 'square'], [E, 0.13, 'square'],
    [G, 0.13, 'square'], [HIGH_C, 0.36, 'square']],
  hit: [[180, 0.065, 'triangle']],
  homerun: [[C, 0.12, 'square'], [E, 0.12, 'square'],
    [G, 0.12, 'square'], [HIGH_C, 0.18, 'square'],
    [E * 2, 0.18, 'triangle'], [G * 2, 0.4, 'square']],
  cheer: [],
  groan: [[E / 2, 0.22, 'triangle'], [C / 2, 0.34, 'square']],
  win: [[C, 0.15, 'square'], [E, 0.15, 'square'], [G, 0.15, 'square'],
    [HIGH_C, 0.25, 'square'], [G, 0.15, 'triangle'], [HIGH_C, 0.65, 'square']],
  lose: [[G / 2, 0.25, 'triangle'], [F / 2, 0.25, 'triangle'],
    [D / 2, 0.25, 'triangle'], [C / 2, 0.45, 'triangle']],
  walkoff: [[HIGH_C, 0.15, 'square'], [G, 0.15, 'square'],
    [HIGH_C, 0.15, 'square'], [E * 2, 0.55, 'square']],
  injury: [[440, 0.16, 'square'], [622.25, 0.16, 'square'],
    [440, 0.16, 'square'], [622.25, 0.16, 'square'],
    [440, 0.16, 'square'], [622.25, 0.16, 'square']],
  event: [[C, 0.15, 'triangle'], [622.25, 0.15, 'triangle'],
    [739.99, 0.15, 'triangle'], [B, 0.4, 'triangle']],
  achievement: [[C, 0.075, 'triangle'], [E, 0.075, 'square'],
    [G, 0.075, 'triangle'], [HIGH_C, 0.075, 'square'],
    [E * 2, 0.075, 'triangle'], [G * 2, 0.075, 'square'],
    [HIGH_C * 2, 0.45, 'triangle']],
  champion: [[C, 0.18, 'square'], [E, 0.18, 'square'], [G, 0.18, 'square'],
    [HIGH_C, 0.36, 'square'], [G, 0.18, 'square'], [HIGH_C, 0.36, 'square'],
    [E * 2, 0.36, 'square'], [D * 2, 0.18, 'triangle'],
    [HIGH_C, 0.18, 'square'], [B, 0.18, 'triangle'], [A, 0.18, 'triangle'],
    [G, 0.18, 'square'], [HIGH_C, 0.8, 'square']],
  // 우승 확정 순간의 팡파르 (약 3.5초): 셋잇단 부름 → 도약 → 길게 맺음
  crown: [[G, 0.12, 'square'], [G, 0.12, 'square'], [G, 0.12, 'square'],
    [HIGH_C, 0.5, 'square'], [E * 2, 0.25, 'square'], [D * 2, 0.12, 'square'],
    [E * 2, 0.12, 'square'], [G * 2, 0.6, 'square'], [A * 2, 0.2, 'triangle'],
    [G * 2, 0.2, 'square'], [E * 2, 0.2, 'square'], [HIGH_C * 2, 1, 'square']],
  crownShort: [],
} as const satisfies Record<SfxName, Sequence>;

/** 폭죽 한 발: 올라가는 휘파람 + 터지는 소리 (at = 터지는 시각) */
function firework(audio: AudioEngine, at: number): void {
  const up = audio.context.createOscillator();
  const gain = envelope(audio, at - 0.28, 0.26, 0.05, 0.2);
  up.type = 'triangle';
  up.frequency.setValueAtTime(900, at - 0.28);
  up.frequency.exponentialRampToValueAtTime(2400, at - 0.03);
  up.connect(gain);
  up.onended = () => { up.disconnect(); gain.disconnect(); };
  up.start(at - 0.28);
  up.stop(at - 0.02);
  noiseBurst(audio, at, 0.5, 1800, 0.3);
  tone(audio, 70, 0.22, 'triangle', at, 0.25);
}

function getEngine(): AudioEngine | undefined {
  if (engine && engine.context.state !== 'closed') return engine;
  if (typeof window === 'undefined') return undefined;
  let context: AudioContext | undefined;
  try {
    const browser = window as Window & {
      webkitAudioContext?: typeof AudioContext;
    };
    const Constructor = window.AudioContext ?? browser.webkitAudioContext;
    if (!Constructor) return undefined;
    context = new Constructor();
    const master = context.createGain();
    const compressor = context.createDynamicsCompressor();
    master.gain.value = muted ? 0 : volume;
    compressor.threshold.value = -18;
    compressor.knee.value = 12;
    compressor.ratio.value = 6;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.15;
    master.connect(compressor);
    compressor.connect(context.destination);
    // One reusable white-noise buffer per context, shared by all percussion.
    const noise = context.createBuffer(1, context.sampleRate, context.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    engine = { context, master, compressor, noise };
    lastPlayed.clear();
    return engine;
  } catch {
    if (context && context.state !== 'closed') void context.close().catch(() => {});
    return undefined;
  }
}

function updateMaster(): void {
  if (!engine || engine.context.state === 'closed') return;
  try {
    const now = engine.context.currentTime;
    engine.master.gain.cancelScheduledValues(now);
    engine.master.gain.setTargetAtTime(muted ? 0 : volume, now, 0.008);
  } catch {
    // A browser may tear down audio while the page is being suspended.
  }
}

export function setMuted(m: boolean): void {
  muted = m;
  save('kbl-muted', String(m));
  updateMaster();
}

export function isMuted(): boolean { return muted; }

export function setVolume(v: number): void {
  if (Number.isNaN(v)) return;
  volume = Math.max(0, Math.min(1, v));
  save('kbl-volume', String(volume));
  updateMaster();
}

export function getVolume(): number { return volume; }

/** Call directly from a pointer/key gesture, including when currently muted. */
export function unlock(): void {
  const audio = getEngine();
  if (!audio) return;
  try {
    if (audio.context.state !== 'running') void audio.context.resume().catch(() => {});
    // Starting a silent source in the gesture also unlocks older iOS Safari.
    const source = audio.context.createBufferSource();
    const silence = audio.context.createGain();
    silence.gain.value = 0;
    source.buffer = audio.noise;
    source.connect(silence);
    silence.connect(audio.master);
    source.onended = () => { source.disconnect(); silence.disconnect(); };
    source.start(audio.context.currentTime, 0, 1 / audio.context.sampleRate);
  } catch {
    // Unsupported or blocked audio is intentionally silent.
  }
}

function envelope(audio: AudioEngine, start: number, duration: number,
  level: number, attack = 0.004): GainNode {
  const gain = audio.context.createGain();
  const peak = start + Math.min(attack, duration * 0.45);
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(level, peak);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  gain.gain.setValueAtTime(0, start + duration + 0.005);
  gain.connect(audio.master);
  return gain;
}

function tone(audio: AudioEngine, frequency: number, duration: number,
  wave: Wave, start: number, level = 0.18): void {
  const oscillator = audio.context.createOscillator();
  const gain = envelope(audio, start, duration, level);
  oscillator.type = wave;
  oscillator.frequency.setValueAtTime(frequency, start);
  oscillator.connect(gain);
  oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
  oscillator.start(start);
  oscillator.stop(start + duration + 0.006);
}

function sequence(audio: AudioEngine, notes: Sequence, start: number,
  level = 0.18, transpose = 1): number {
  let cursor = start;
  for (const [frequency, duration, wave] of notes) {
    if (frequency > 0) tone(audio, frequency * transpose, duration * 0.92, wave, cursor, level);
    cursor += duration;
  }
  return cursor;
}

function noiseBurst(audio: AudioEngine, start: number, duration: number,
  frequency: number, level = 0.22, swell = false): void {
  const source = audio.context.createBufferSource();
  const filter = audio.context.createBiquadFilter();
  const gain = envelope(audio, start, duration, level, swell ? duration * 0.4 : 0.002);
  source.buffer = audio.noise;
  source.loop = true;
  filter.type = swell ? 'bandpass' : 'lowpass';
  filter.Q.value = swell ? 0.65 : 0.7;
  filter.frequency.setValueAtTime(frequency, start);
  filter.frequency.exponentialRampToValueAtTime(swell ? frequency * 1.7 : 450, start + duration);
  source.connect(filter);
  filter.connect(gain);
  source.onended = () => { source.disconnect(); filter.disconnect(); gain.disconnect(); };
  source.start(start);
  source.stop(start + duration + 0.006);
}

function bat(audio: AudioEngine, start: number): void {
  noiseBurst(audio, start, 0.055, 6500, 0.28);
  sequence(audio, melodies.hit, start, 0.24);
}

function schedule(audio: AudioEngine, name: SfxName): void {
  const start = audio.context.currentTime + 0.008;
  switch (name) {
    case 'hit': bat(audio, start); break;
    case 'cheer': noiseBurst(audio, start, 1.1, 950, 0.25, true); break;
    case 'build':
      noiseBurst(audio, start, 0.065, 2300);
      tone(audio, 130, 0.07, 'triangle', start, 0.22);
      noiseBurst(audio, start + 0.12, 0.065, 2300);
      sequence(audio, melodies.build, start + 0.19);
      break;
    case 'buy':
      noiseBurst(audio, start, 0.035, 4800, 0.15);
      sequence(audio, melodies.buy, start + 0.025);
      break;
    case 'homerun':
    case 'walkoff': {
      bat(audio, start);
      const end = sequence(audio, melodies.homerun, start + 0.08);
      if (name === 'walkoff') {
        sequence(audio, melodies.walkoff, end);
        noiseBurst(audio, end, 1, 900, 0.15, true);
      }
      break;
    }
    case 'playball':
      sequence(audio, melodies.playball, start);
      sequence(audio, melodies.playball, start, 0.15, 0.5);
      break;
    case 'event':
      sequence(audio, melodies.event, start);
      tone(audio, C / 2, 0.85, 'triangle', start, 0.15);
      tone(audio, 369.99, 0.7, 'triangle', start + 0.15, 0.15);
      break;
    case 'crown':
    case 'crownShort': {
      // 팡파르 + 관중 함성 + 그림과 같은 박자의 폭죽 (짧은 세리머니에서는 그 안에 터지는 것만)
      const end = name === 'crown' ? CEREMONY_MS.normal : CEREMONY_MS.fast;
      sequence(audio, melodies.crown, start, 0.17);
      sequence(audio, melodies.crown, start, 0.12, 0.5);
      noiseBurst(audio, start, 3.2, 900, 0.18, true);
      for (const t of CHAMP_POPS) if (t * 1000 < end - 300) firework(audio, start + t);
      break;
    }
    case 'champion':
      sequence(audio, melodies.champion, start);
      sequence(audio, melodies.champion, start, 0.15, 0.5);
      noiseBurst(audio, start + 2.5, 1, 1000, 0.15, true);
      break;
    default: sequence(audio, melodies[name], start);
  }
}

export function play(name: SfxName): void {
  if (muted || volume === 0) return;
  const audio = getEngine();
  if (!audio) return;
  const now = typeof performance === 'undefined' ? Date.now() : performance.now();
  const previous = lastPlayed.get(name);
  if (previous !== undefined && now - previous < 50) return;
  lastPlayed.set(name, now);
  // 우승 팡파르는 그 순간에만 의미가 있다: 오디오가 잠겨 있으면(iOS) 나중에 풀릴 때 뒤늦게 울리지 않게 생략
  if ((name === 'crown' || name === 'crownShort') && audio.context.state !== 'running') return;
  const perform = (): void => {
    if (muted || volume === 0 || audio.context.state !== 'running') return;
    try { schedule(audio, name); } catch { /* Audio failure must not interrupt UI. */ }
  };
  try {
    if (audio.context.state === 'running') perform();
    else void audio.context.resume().then(perform).catch(() => {});
  } catch {
    // Some WebKit versions throw synchronously when resume is blocked.
  }
}
