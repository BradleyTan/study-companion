// All sounds are synthesised with the Web Audio API: no files, nothing to license.
// See docs/design/sounds.md.

export type SoundName = "click" | "pop" | "boop" | "flip" | "chime" | "tear";

let ctx: AudioContext | null = null;
const lastPlayed = new Map<SoundName, number>();
export const RETRIGGER_MS = 60;

function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  ctx ??= new AC();
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

function tone(c: AudioContext, f1: number, f2: number, dur: number, type: OscillatorType, gain: number, delay = 0) {
  const t = c.currentTime + delay;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f1, t);
  o.frequency.exponentialRampToValueAtTime(f2, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(gain, 0.0002), t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(c.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise(c: AudioContext, dur: number, freq: number, gain: number, sweepTo?: number) {
  const b = c.createBuffer(1, Math.floor(c.sampleRate * dur), c.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length) ** 2;
  const s = c.createBufferSource();
  const f = c.createBiquadFilter();
  const g = c.createGain();
  f.type = "bandpass";
  f.frequency.setValueAtTime(freq, c.currentTime);
  if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, c.currentTime + dur);
  g.gain.value = gain;
  s.buffer = b;
  s.connect(f).connect(g).connect(c.destination);
  s.start();
}

/** Returns false when the sound was skipped (muted, too soon, or no audio support). */
export function playSound(name: SoundName, volume: number, now = performance.now()): boolean {
  if (volume <= 0) return false;
  const last = lastPlayed.get(name) ?? -Infinity;
  if (now - last < RETRIGGER_MS) return false;
  const c = audio();
  if (!c) return false;
  lastPlayed.set(name, now);
  // Square waves are much louder than sines at the same gain.
  const sq = volume * 0.12;
  const sine = volume * 0.35;
  switch (name) {
    case "click": tone(c, 1125, 810, 0.05, "square", sq); break;
    case "pop": tone(c, 650, 1300, 0.09, "square", sq); tone(c, 975, 1950, 0.09, "square", sq * 0.6, 0.07); break;
    case "boop": tone(c, 320, 210, 0.18, "sine", sine); break;
    case "flip": noise(c, 0.12, 2750, sine * 1.4); break;
    case "tear": noise(c, 0.14, 4000, sine * 1.2, 900); break;
    case "chime": [880, 1320, 1760].forEach((f, i) => tone(c, f, f * 0.999, 1.4, "sine", sine * 0.7, i * 0.12)); break;
  }
  return true;
}
