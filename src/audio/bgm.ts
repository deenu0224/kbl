/** Asset-free, original 16-bar stadium song. All transport timings are seconds. */
export type BgmMood = 'calm' | 'game' | 'night';
type Note = readonly [midi: number, beats: number];
interface Voice { source: AudioScheduledSourceNode; gain: GainNode; start: number }
interface AudioEngine {
  context: AudioContext;
  master: GainNode;
  noise: AudioBuffer;
  voices: Set<Voice>;
}

// Composed for this game: repeated calls and answering leaps, not a quotation.
// A: I–V–vi–IV twice. B: IV–V–iii–vi, IV–V–I–I. Each row is 4/4.
const melody: readonly (readonly Note[])[] = [
  [[64, 0.5], [64, 0.5], [67, 1], [69, 0.5], [67, 1.5]],
  [[62, 1], [67, 0.5], [67, 0.5], [71, 1], [69, 0.5], [67, 0.5]],
  [[64, 0.5], [64, 0.5], [69, 1], [72, 1], [71, 0.5], [69, 0.5]],
  [[69, 1], [67, 0.5], [65, 0.5], [64, 1], [65, 1]],
  [[67, 0.5], [67, 0.5], [64, 1], [72, 0.5], [71, 0.5], [67, 1]],
  [[69, 0.5], [67, 0.5], [62, 1], [67, 1.5], [0, 0.5]],
  [[69, 0.5], [69, 0.5], [72, 1], [71, 0.5], [69, 0.5], [64, 1]],
  [[65, 1], [69, 0.5], [67, 0.5], [65, 1.5], [0, 0.5]],
  [[69, 0.5], [69, 0.5], [72, 1], [74, 0.5], [72, 1.5]],
  [[71, 1], [67, 0.5], [69, 0.5], [74, 1], [71, 1]],
  [[67, 0.5], [67, 0.5], [71, 1], [76, 0.5], [74, 0.5], [71, 1]],
  [[72, 1], [69, 0.5], [64, 0.5], [69, 1.5], [0, 0.5]],
  [[65, 0.5], [65, 0.5], [69, 1], [72, 1], [69, 1]],
  [[71, 0.5], [69, 0.5], [67, 1], [62, 0.5], [67, 1.5]],
  [[64, 0.5], [64, 0.5], [67, 1], [72, 0.5], [67, 0.5], [64, 1]],
  [[62, 0.5], [64, 0.5], [67, 1], [60, 1.5], [0, 0.5]],
];
const chords = [
  [48, 52, 55], [43, 47, 50], [45, 48, 52], [41, 45, 48],
  [48, 52, 55], [43, 47, 50], [45, 48, 52], [41, 45, 48],
  [41, 45, 48], [43, 47, 50], [40, 43, 47], [45, 48, 52],
  [41, 45, 48], [43, 47, 50], [48, 52, 55], [48, 52, 55],
] as const;
const bpm: Record<BgmMood, number> = { calm: 92, game: 104, night: 80 };

function read(key: string): string | null {
  try { return typeof window === 'undefined' ? null : window.localStorage.getItem(key); }
  catch { return null; }
}
function save(key: string, value: string): void {
  try { if (typeof window !== 'undefined') window.localStorage.setItem(key, value); }
  catch { /* Disabled storage must not interrupt the game. */ }
}
const savedVolume = read('kbl-bgm-volume');
const parsedVolume = savedVolume === null || savedVolume.trim() === '' ? NaN : Number(savedVolume);
let volume = Number.isFinite(parsedVolume) ? Math.max(0, Math.min(1, parsedVolume)) : 0.6;
let muted = read('kbl-bgm-muted') === 'true';
let mood: BgmMood = 'calm';
let activeMood: BgmMood = mood;
let engine: AudioEngine | undefined;
let playing = false;
let timer: ReturnType<typeof setInterval> | undefined;
let bar = 0;
let step = 0;
let nextTime = 0;
let duckUntil = 0;
let ramp = { from: 0, to: 0, start: 0, end: 0 };
const hidden = (): boolean => typeof document !== 'undefined' && document.hidden;

function getEngine(): AudioEngine | undefined {
  if (engine && engine.context.state !== 'closed') return engine;
  if (typeof window === 'undefined') return undefined;
  let context: AudioContext | undefined;
  try {
    const browser = window as Window & { webkitAudioContext?: typeof AudioContext };
    const Constructor = window.AudioContext ?? browser.webkitAudioContext;
    if (!Constructor) return undefined;
    context = new Constructor();
    const master = context.createGain();
    const filter = context.createBiquadFilter();
    const compressor = context.createDynamicsCompressor();
    master.gain.value = 0;
    filter.type = 'lowpass';
    filter.frequency.value = 6000;
    filter.Q.value = 0.7;
    compressor.threshold.value = -18;
    compressor.knee.value = 12;
    compressor.ratio.value = 4;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.15;
    master.connect(filter);
    filter.connect(compressor);
    compressor.connect(context.destination);
    const noise = context.createBuffer(1, Math.ceil(context.sampleRate * 0.2), context.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    engine = { context, master, noise, voices: new Set() };
    ramp = { from: 0, to: 0, start: 0, end: 0 };
    duckUntil = 0;
    context.onstatechange = () => {
      if (context?.state === 'running') run();
      else pause(0.01);
    };
    return engine;
  } catch {
    if (context && context.state !== 'closed') void context.close().catch(() => {});
    return undefined;
  }
}

function updateMaster(duration = 0.03): void {
  if (!engine || engine.context.state === 'closed') return;
  const now = engine.context.currentTime;
  const fraction = ramp.end <= ramp.start ? 1 : Math.max(0, Math.min(1, (now - ramp.start) / (ramp.end - ramp.start)));
  const from = ramp.from + (ramp.to - ramp.from) * fraction;
  const to = playing && !muted && !hidden() ? volume * (now < duckUntil ? 0.4 : 1) : 0;
  const gain = engine.master.gain;
  gain.cancelScheduledValues(now);
  gain.setValueAtTime(from, now);
  gain.linearRampToValueAtTime(to, now + duration);
  ramp = { from, to, start: now, end: now + duration };
}

function envelope(audio: AudioEngine, start: number, duration: number, level: number): GainNode {
  const gain = audio.context.createGain();
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(level, start + 0.008);
  gain.gain.setValueAtTime(level, start + duration - 0.01);
  gain.gain.linearRampToValueAtTime(0, start + duration);
  gain.connect(audio.master);
  return gain;
}
function track(audio: AudioEngine, source: AudioScheduledSourceNode, gain: GainNode,
  start: number, duration: number, filter?: BiquadFilterNode): void {
  const voice = { source, gain, start };
  audio.voices.add(voice);
  source.onended = () => {
    source.disconnect(); gain.disconnect(); filter?.disconnect(); audio.voices.delete(voice);
  };
  source.start(start);
  source.stop(start + duration + 0.001);
}
function tone(audio: AudioEngine, midi: number, start: number, duration: number,
  wave: OscillatorType, level: number, kick = false): void {
  const source = audio.context.createOscillator();
  const gain = envelope(audio, start, duration, level);
  source.type = wave;
  source.frequency.setValueAtTime(440 * 2 ** ((midi - 69) / 12), start);
  if (kick) source.frequency.exponentialRampToValueAtTime(42, start + duration - 0.01);
  source.connect(gain);
  track(audio, source, gain, start, duration);
}
function clap(audio: AudioEngine, start: number): void {
  for (let i = 0; i < 3; i += 1) {
    const time = start + i * 0.011;
    const source = audio.context.createBufferSource();
    const filter = audio.context.createBiquadFilter();
    const gain = envelope(audio, time, 0.065 + i * 0.008, activeMood === 'game' ? 0.022 : 0.007);
    source.buffer = audio.noise;
    filter.type = 'bandpass';
    filter.frequency.value = 1250 + i * 370;
    filter.Q.value = 0.8;
    source.connect(filter); filter.connect(gain);
    track(audio, source, gain, time, 0.065 + i * 0.008, filter);
  }
}

function scheduleStep(audio: AudioEngine): void {
  if (step === 0) activeMood = mood;
  const beat = 60 / bpm[activeMood];
  const position = step / 2;
  const chord = chords[bar];
  if (step === 0) {
    for (const note of chord) tone(audio, note + 12, nextTime, beat * 4, 'sine', 0.018);
  }
  let cursor = 0;
  for (const [note, length] of melody[bar]) {
    if (cursor === position && note > 0) {
      const pitch = note - (activeMood === 'night' ? 12 : 0);
      const duration = length * beat * 0.9;
      tone(audio, pitch, nextTime, duration, 'triangle', 0.065);
      tone(audio, pitch + 12, nextTime, duration, 'sine', 0.012);
      if (activeMood === 'game') tone(audio, pitch, nextTime, duration, 'square', 0.016);
    }
    cursor += length;
  }
  if (activeMood !== 'night') {
    if (step === 0 || step === 4) tone(audio, chord[0] - 12, nextTime, beat * 1.7, 'sine', 0.065);
    // Two claps, a breath, then three claps: 짝짝 / 짝짝짝.
    if ([0, 2, 4, 5, 6].includes(step)) clap(audio, nextTime);
    if (activeMood === 'game' && (step === 0 || step === 4)) {
      tone(audio, 43, nextTime, 0.12, 'sine', 0.09, true);
    }
  }
  nextTime += beat / 2;
  step += 1;
  if (step === 8) { step = 0; bar = (bar + 1) % melody.length; }
}
function tick(): void {
  const audio = engine;
  if (!audio || !playing || muted || hidden() || audio.context.state !== 'running') return;
  const now = audio.context.currentTime;
  if (duckUntil > 0 && now >= duckUntil) { duckUntil = 0; updateMaster(0.15); }
  // Never replay a backlog after a stalled main thread.
  if (nextTime < now) {
    if (step !== 0) bar = (bar + 1) % melody.length;
    step = 0; nextTime = now + 0.02;
  }
  try {
    while (nextTime < now + 0.1) scheduleStep(audio);
  } catch { pause(0.01); }
}
function run(): void {
  if (!engine || !playing || muted || hidden() || engine.context.state !== 'running' || timer !== undefined) return;
  nextTime = engine.context.currentTime + 0.02;
  step = 0;
  updateMaster(0.15);
  timer = setInterval(tick, 25);
  tick();
}
function pause(fade: number): void {
  if (timer !== undefined) clearInterval(timer);
  timer = undefined;
  if (step !== 0) bar = (bar + 1) % melody.length;
  step = 0;
  if (!engine) return;
  const now = engine.context.currentTime;
  for (const voice of engine.voices) {
    // Retiring voices get their own fade so a quick restart cannot revive them.
    const gain = voice.gain.gain;
    if (voice.start > now) {
      gain.cancelScheduledValues(now); gain.setValueAtTime(0, now);
    } else if (typeof gain.cancelAndHoldAtTime === 'function') {
      gain.cancelAndHoldAtTime(now);
      gain.linearRampToValueAtTime(0, now + fade);
    } else {
      const value = gain.value;
      gain.cancelScheduledValues(now); gain.setValueAtTime(value, now);
      gain.linearRampToValueAtTime(0, now + fade);
    }
    try { voice.source.stop(now + fade); } catch { /* Already ended. */ }
  }
}
function visibilityChanged(): void {
  if (hidden()) { updateMaster(0.03); pause(0.03); }
  else if (playing && !muted) resume();
}
function resume(): void {
  if (!engine) return;
  try {
    if (engine.context.state === 'running') run();
    else void engine.context.resume().then(run).catch(() => {});
  } catch { /* A later user gesture can retry blocked audio. */ }
}

/** Call directly inside a user gesture to unlock Safari audio. */
export function startBgm(): void {
  if (isBgmRunning()) return;
  const audio = getEngine();
  if (!audio) return;
  if (!playing) {
    playing = true; bar = 0; step = 0;
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', visibilityChanged);
  }
  resume();
  const source = audio.context.createBufferSource();
  const silence = audio.context.createGain();
  silence.gain.value = 0;
  source.buffer = audio.noise;
  source.connect(silence); silence.connect(audio.master);
  source.onended = () => { source.disconnect(); silence.disconnect(); };
  source.start(audio.context.currentTime, 0, 1 / audio.context.sampleRate);
}
/** 실제로 소리가 나갈 수 있는 상태인가 (iOS 는 터치가 끝나는 시점의 입력에서만 풀린다) */
export function isBgmRunning(): boolean {
  return playing && engine?.context.state === 'running' && (timer !== undefined || muted || hidden());
}
export function stopBgm(): void {
  playing = false;
  updateMaster(0.4); pause(0.4);
  if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', visibilityChanged);
}
export function setBgmMood(m: BgmMood): void { mood = m; }
export function getBgmMood(): BgmMood { return mood; }
export function setBgmMuted(m: boolean): void {
  if (muted === m) return;
  muted = m; save('kbl-bgm-muted', String(m));
  updateMaster(0.3);
  if (m) pause(0.3);
  else resume();
}
export function isBgmMuted(): boolean { return muted; }
export function setBgmVolume(v: number): void {
  if (Number.isNaN(v)) return;
  volume = Math.max(0, Math.min(1, v));
  save('kbl-bgm-volume', String(volume)); updateMaster();
}
export function getBgmVolume(): number { return volume; }
export function duckBgm(seconds: number): void {
  if (!engine || !playing || muted || hidden() || !Number.isFinite(seconds) || seconds <= 0) return;
  duckUntil = Math.max(duckUntil, engine.context.currentTime + seconds);
  updateMaster(Math.min(0.03, seconds));
}
