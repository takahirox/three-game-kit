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
    function random(index: number, occurrence: number, salt: number) {
        let n = seed ^ Math.imul(index + 1, 0x9e3779b1) ^ Math.imul(occurrence >>> 0, 0x85ebca6b) ^ Math.imul(Math.floor(occurrence / 4294967296), 0xc2b2ae35) ^ salt;
        n = Math.imul(n ^ (n >>> 16), 0x7feb352d); n = Math.imul(n ^ (n >>> 15), 0x846ca68b);
        return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
    }
    const streams = [
        ...(perCycle > 0 ? [{ rate: true, offset: 0, interval: 0, repeats: perCycle, cursor: 0, constant: 1 as number | undefined, count: (_n: number) => 1 }] : []),
        ...bursts.filter(b => b.timeMs <= duration).map((b, index) => {
            const interval = b.intervalMs ?? 1, repeats = Math.min(b.cycles ?? 1, Math.floor((duration - b.timeMs) / interval) + 1);
            const limits = typeof b.count === "number" ? [b.count, b.count] : b.count, probability = b.probability ?? 1;
            const constant = probability === 0 ? 0 : probability === 1 && limits[0] === limits[1] ? limits[0] : undefined;
            return { rate: false, offset: b.timeMs, interval, repeats, cursor: 0, constant,
                count: (n: number) => constant ?? (random(index, n, 0) < probability ? limits[0]! + Math.floor(random(index, n, 0x27d4eb2d) * (limits[1]! - limits[0]! + 1)) : 0) };
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
    function skipTo(s: Stream, to: number, skip: (count: number, bursts?: number) => void) {
        if (to <= s.cursor) return;
        // Unknown random occurrences are reported separately, never estimated as particles.
        if (s.constant !== undefined) skip((to - s.cursor) * s.constant);
        else skip(0, to - s.cursor);
        s.cursor = to;
    }
    return {
        exhausted() { return streams.every(s => s.constant === 0 || (!loop && s.cursor >= s.repeats)); },
        reset() { for (const s of streams) s.cursor = 0; },
        advance(end: number, maxLife: number, budget: number, birth: (count: number, time: number) => void, skip: (count: number, bursts?: number) => void) {
            for (const s of streams) skipTo(s, countAt(s, end - maxLife), skip);
            while (budget > 0) {
                let selected: Stream | undefined, next = Infinity;
                for (const s of streams) if (s.cursor < countAt(s, end)) {
                    const time = timeAt(s);
                    if (time < next || (time === next && !s.rate && selected?.rate)) { selected = s; next = time; }
                }
                if (!selected) break;
                const count = selected.count(selected.cursor);
                const attempts = Math.min(budget, count);
                if (attempts) birth(attempts, next); if (attempts < count) skip(count - attempts);
                selected.cursor++; budget -= Math.max(1, attempts);
            }
            for (const s of streams) skipTo(s, countAt(s, end), skip);
        },
    };
}
