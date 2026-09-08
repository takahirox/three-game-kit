import type { ParticleBurst, ParticleCurve } from "./types.js";
import { integral } from "./validation.js";

/** @internal */
export function createSchedule(rate: number, duration: number, delay: number, loop: boolean, bursts: readonly ParticleBurst[], rateCurve?: ParticleCurve, seed = 1) {
    const emittedAt = (t: number) => rateCurve ? integral(rateCurve, Math.min(1, t / duration)) * duration * rate / 1000 : t * rate / 1000;
    const perCycle = Math.floor(emittedAt(duration) + 1e-9);
    function rateTime(index: number): number {
        if (!rateCurve) return index * 1000 / rate;
        let lo = 0, hi = duration;
        for (let n = 0; n < 48; n++) { const mid = (lo + hi) / 2; if (emittedAt(mid) < index) lo = mid; else hi = mid; }
        return hi;
    }
    // A bounded deterministic random table enables exact arithmetic skipping, even
    // across days of missed updates. The table repeats every 256 burst occurrences.
    const streams = [
        ...(perCycle > 0 ? [{ rate: true, offset: 0, interval: 0, repeats: perCycle, cursor: 0, counts: [1], prefix: [0, 1] }] : []),
        ...bursts.filter(b => b.timeMs <= duration).map((b, index) => {
            const interval = b.intervalMs ?? 1, repeats = Math.min(b.cycles ?? 1, Math.floor((duration - b.timeMs) / interval) + 1);
            const limits = typeof b.count === "number" ? [b.count, b.count] : b.count;
            let state = (seed ^ Math.imul(index + 1, 0x9e3779b1)) >>> 0;
            const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
            const counts = Array.from({ length: limits[0] === limits[1] && (b.probability ?? 1) === 1 ? 1 : 256 }, () => {
                const accept = random() < (b.probability ?? 1);
                const count = limits[0]! + Math.floor(random() * (limits[1]! - limits[0]! + 1));
                return accept ? count : 0;
            });
            const prefix = [0]; for (const count of counts) prefix.push(prefix[prefix.length - 1]! + count);
            return { rate: false, offset: b.timeMs, interval, repeats, cursor: 0, counts, prefix };
        }),
    ];
    type Stream = typeof streams[number];
    function countAt(s: Stream, time: number): number {
        const t = time - delay;
        if (t < 0) return 0;
        const cycles = loop ? Math.floor(t / duration) : 0, local = loop ? t - cycles * duration : Math.min(t, duration);
        const count = s.rate ? Math.floor(emittedAt(local) + 1e-9) : local < s.offset ? 0 : Math.floor((local - s.offset) / s.interval) + 1;
        return cycles * s.repeats + Math.min(s.repeats, count);
    }
    function timeAt(s: Stream): number {
        const cycle = Math.floor(s.cursor / s.repeats), index = s.cursor % s.repeats;
        return delay + (loop ? cycle * duration : 0) + (s.rate ? rateTime(index + 1) : s.offset + index * s.interval);
    }
    function sum(s: Stream, n: number): number { const len = s.counts.length; return Math.floor(n / len) * s.prefix[len]! + s.prefix[n % len]!; }
    function skipTo(s: Stream, to: number, skip: (count: number) => void) {
        if (to <= s.cursor) return;
        const count = sum(s, to) - sum(s, s.cursor); s.cursor = to; if (count) skip(count);
    }
    return {
        exhausted() { return streams.every(s => s.counts.every(n => n === 0) || (!loop && s.cursor >= s.repeats)); },
        reset() { for (const s of streams) s.cursor = 0; },
        advance(end: number, maxLife: number, budget: number, birth: (count: number, time: number) => void, skip: (count: number) => void) {
            for (const s of streams) skipTo(s, countAt(s, end - maxLife), skip);
            while (budget > 0) {
                let selected: Stream | undefined, next = Infinity;
                for (const s of streams) if (s.cursor < countAt(s, end)) {
                    const time = timeAt(s);
                    if (time < next || (time === next && !s.rate && selected?.rate)) { selected = s; next = time; }
                }
                if (!selected) break;
                const count = selected.counts[selected.cursor % selected.counts.length]!;
                const attempts = Math.min(budget, count);
                if (attempts) birth(attempts, next); if (attempts < count) skip(count - attempts);
                selected.cursor++; budget -= Math.max(1, attempts);
            }
            for (const s of streams) skipTo(s, countAt(s, end), skip);
        },
    };
}
