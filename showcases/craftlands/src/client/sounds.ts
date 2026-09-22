/// <reference lib="dom" />
/**
 * Runtime-synthesised sound bank: every clip is generated sample by sample into an AudioBuffer at
 * boot from deterministic noise and simple oscillators, so no audio file is ever downloaded.
 */

export type SoundFamily = "stone" | "grass" | "gravel" | "sand" | "wood" | "cloth" | "glass" | "snow";
export const SOUND_FAMILIES: readonly SoundFamily[] = Object.freeze(["stone", "grass", "gravel", "sand", "wood", "cloth", "glass", "snow"]);

type Sample = (t: number, noise: number, i: number) => number;

interface ClipSpec { readonly id: string; readonly seconds: number; readonly sample: Sample; readonly gain?: number; }

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** One-pole low-pass over white noise; `a` near 0 is muffled, near 1 is bright. */
function noiseSource(a: number, seed: number): (i: number) => number {
  const random = mulberry(seed);
  let y = 0;
  return () => { const x = random() * 2 - 1; y += a * (x - y); return y; };
}

const decay = (t: number, rate: number): number => Math.exp(-t * rate);
const attack = (t: number, seconds: number): number => Math.min(1, t / seconds);
const saw = (phase: number): number => 2 * (phase - Math.floor(phase + 0.5));
const square = (phase: number): number => (phase % 1 < 0.5 ? 1 : -1);

function noiseClip(id: string, seconds: number, a: number, rate: number, gain: number, seed: number, shape: (t: number, n: number) => number = (_t, n) => n): ClipSpec {
  const source = noiseSource(a, seed);
  return { id, seconds, gain, sample: (t) => shape(t, source(0)) * decay(t, rate) };
}

function digFamily(family: SoundFamily, seed: number): ClipSpec[] {
  const base = (prefix: string, seconds: number, gain: number, rateScale: number): ClipSpec => {
    switch (family) {
      case "stone": return noiseClip(`${prefix}.stone`, seconds, 0.16, 26 * rateScale, gain, seed);
      case "grass": return noiseClip(`${prefix}.grass`, seconds * 0.9, 0.34, 34 * rateScale, gain * 0.8, seed + 1);
      case "gravel": return noiseClip(`${prefix}.gravel`, seconds, 0.26, 24 * rateScale, gain, seed + 2, (t, n) => (Math.sin(t * 900) > -0.2 ? n : n * 0.2));
      case "sand": return noiseClip(`${prefix}.sand`, seconds, 0.42, 22 * rateScale, gain * 0.7, seed + 3);
      case "wood": { const source = noiseSource(0.1, seed + 4); return { id: `${prefix}.wood`, seconds, gain, sample: (t) => (Math.sin(t * 2 * Math.PI * 170) * 0.6 * decay(t, 40 * rateScale) + source(0) * 0.8 * decay(t, 30 * rateScale)) }; }
      case "cloth": return noiseClip(`${prefix}.cloth`, seconds * 0.8, 0.08, 30 * rateScale, gain * 0.8, seed + 5);
      case "glass": { const source = noiseSource(0.7, seed + 6); return { id: `${prefix}.glass`, seconds: seconds * 2, gain: gain * 0.7, sample: (t) => source(0) * decay(t, 18 * rateScale) + (Math.sin(t * 2 * Math.PI * 2100) + Math.sin(t * 2 * Math.PI * 3300) * 0.6) * 0.25 * decay(t, 12 * rateScale) }; }
      case "snow": return noiseClip(`${prefix}.snow`, seconds * 0.9, 0.3, 30 * rateScale, gain * 0.7, seed + 7);
    }
  };
  return [base("dig", 0.2, 0.55, 1), base("step", 0.1, 0.22, 1.6), base("hit", 0.11, 0.3, 1.5)];
}

function tone(id: string, seconds: number, gain: number, sample: Sample): ClipSpec {
  return { id, seconds, gain, sample };
}

const CLIPS: readonly ClipSpec[] = [
  ...SOUND_FAMILIES.flatMap((family, index) => digFamily(family, 100 + index * 10)),
  tone("hurt", 0.32, 0.5, (t, n) => (saw(t * (230 - t * 200)) * 0.6 + n * 0.4) * decay(t, 9)),
  tone("death", 0.7, 0.5, (t, n) => (saw(t * (180 - t * 120)) * 0.6 + n * 0.5) * decay(t, 5)),
  tone("fall", 0.3, 0.6, (t, n) => n * decay(t, 14) + Math.sin(t * 2 * Math.PI * 70) * 0.5 * decay(t, 20)),
  tone("pop", 0.14, 0.4, (t) => Math.sin(2 * Math.PI * (500 * t + 1400 * t * t)) * decay(t, 18) * attack(t, 0.005)),
  tone("orb", 0.3, 0.28, (t) => (Math.sin(2 * Math.PI * 1568 * t) + Math.sin(2 * Math.PI * 2349 * t) * 0.5) * decay(t, 14) * attack(t, 0.004)),
  tone("levelup", 0.9, 0.3, (t) => { const notes = [880, 1108, 1318, 1760]; const index = Math.min(3, Math.floor(t / 0.16)); const local = t - index * 0.16; return Math.sin(2 * Math.PI * notes[index]! * t) * decay(local, 8) * (index === 3 ? decay(local, 3) : 1); }),
  tone("eat", 1.5, 0.45, (t, n) => { const local = t % 0.5; return local < 0.18 ? n * decay(local, 22) * attack(local, 0.01) : 0; }),
  tone("burp", 0.35, 0.35, (t, n) => (square(t * (90 + t * 60)) * 0.3 + n * 0.5) * decay(t, 8)),
  tone("click", 0.05, 0.35, (t, n) => n * decay(t, 90)),
  tone("splash", 0.45, 0.4, (t, n) => n * attack(t, 0.03) * decay(t, 9)),
  tone("explode", 1.3, 0.8, (t, n) => n * decay(t, 3) + Math.sin(2 * Math.PI * 55 * t) * 0.6 * decay(t, 7)),
  tone("fuse", 1.5, 0.4, (t, n) => n * attack(t, 0.3) * (0.5 + 0.5 * Math.min(1, t / 1.5))),
  tone("punch", 0.12, 0.45, (t, n) => n * decay(t, 40) + Math.sin(2 * Math.PI * 120 * t) * 0.6 * decay(t, 30)),
  tone("mob.pig", 0.26, 0.35, (t) => { const f = t < 0.12 ? 380 : 260; return (square(t * f + Math.sin(t * 60) * 0.02) * 0.4 + saw(t * f * 1.005) * 0.4) * (t < 0.12 ? decay(t, 6) : decay(t - 0.12, 12)); }),
  tone("mob.cow", 0.7, 0.35, (t) => (saw(t * (135 + Math.sin(t * 20) * 4)) * 0.5 + saw(t * 202) * 0.25) * attack(t, 0.08) * decay(t, 3)),
  tone("mob.sheep", 0.55, 0.32, (t) => saw(t * 270) * (0.7 + 0.3 * Math.sin(t * 2 * Math.PI * 13)) * attack(t, 0.05) * decay(t, 4)),
  tone("mob.chicken", 0.24, 0.3, (t) => { const local = t % 0.12; return Math.sin(2 * Math.PI * (950 - local * 2500) * local) * decay(local, 25); }),
  tone("mob.zombie", 0.8, 0.4, (t, n) => (saw(t * (92 + Math.sin(t * 2 * Math.PI * 5) * 3)) * 0.5 + n * 0.3) * attack(t, 0.1) * decay(t, 3)),
  tone("mob.skeleton", 0.45, 0.3, (t, n) => { const local = t % 0.07; return local < 0.015 ? n * decay(local, 150) : 0; }),
  tone("mob.creeper", 0.3, 0.3, (t, n) => n * decay(t, 10)),
];

export interface SoundBank { readonly ids: readonly string[]; readonly buffers: ReadonlyMap<string, AudioBuffer>; }

/** Renders every clip into an AudioBuffer of the given context. */
export function synthesiseSoundBank(context: AudioContext): SoundBank {
  const sampleRate = context.sampleRate;
  const buffers = new Map<string, AudioBuffer>();
  CLIPS.forEach((clip, index) => {
    const length = Math.max(1, Math.floor(clip.seconds * sampleRate));
    const buffer = context.createBuffer(1, length, sampleRate);
    const data = buffer.getChannelData(0);
    const noise = noiseSource(0.9, 900 + index);
    const gain = clip.gain ?? 0.5;
    for (let i = 0; i < length; i += 1) {
      const t = i / sampleRate;
      const release = Math.min(1, (length - i) / (sampleRate * 0.01));
      data[i] = Math.max(-1, Math.min(1, clip.sample(t, noise(i), i) * gain)) * release;
    }
    buffers.set(clip.id, buffer);
  });
  return Object.freeze({ ids: Object.freeze(CLIPS.map((clip) => clip.id)), buffers });
}
