import type { ParticleBurst } from "./types.js";

/** A fixed number of streams; skipping any length of hitch is arithmetic. */
export function createSchedule(rate: number, duration: number, delay: number, loop: boolean, bursts: readonly ParticleBurst[]) {
    const perCycle = Math.floor(duration * rate / 1000);
    const streams = [
        ...(rate > 0 && perCycle > 0 ? [{ rate: true, offset: 0, count: 1, cursor: 0 }] : []),
        ...bursts.filter(b => b.timeMs <= duration).map(b => ({ rate: false, offset: b.timeMs, count: b.count, cursor: 0 })),
    ];
    function countAt(s: typeof streams[number], time: number): number {
        const t = time - delay;
        if (t < 0) return 0;
        if (!s.rate) return t < s.offset ? 0 : loop ? Math.floor((t - s.offset) / duration) + 1 : 1;
        if (!loop) return Math.min(perCycle, Math.floor(t * rate / 1000));
        const cycle = Math.floor(t / duration), local = t - cycle * duration;
        return cycle * perCycle + Math.min(perCycle, Math.floor(local * rate / 1000));
    }
    function timeAt(s: typeof streams[number]): number {
        if (!s.rate) return delay + s.offset + (loop ? s.cursor * duration : 0);
        return delay + (loop ? Math.floor(s.cursor / perCycle) * duration : 0) + (s.cursor % perCycle + 1) * 1000 / rate;
    }
    return {
        reset() { for (const s of streams) s.cursor = 0; },
        advance(end: number, maxLife: number, budget: number, birth: (count: number, time: number) => void, skip: (count: number) => void) {
            for (const s of streams) {
                const dead = countAt(s, end - maxLife), n = Math.max(0, dead - s.cursor);
                s.cursor += n; if (n) skip(n * s.count);
            }
            while (budget > 0) {
                let selected: typeof streams[number] | undefined, next = Infinity;
                for (const s of streams) if (s.cursor < countAt(s, end)) {
                    const time = timeAt(s);
                    // Bursts precede rate emission at the same timestamp, preserving the original API.
                    if (time < next || (time === next && !s.rate && selected?.rate)) { selected = s; next = time; }
                }
                if (!selected) break;
                const attempts = Math.min(budget, selected.count);
                birth(attempts, next); if (attempts < selected.count) skip(selected.count - attempts);
                selected.cursor++; budget -= attempts;
            }
            for (const s of streams) { const n = Math.max(0, countAt(s, end) - s.cursor); s.cursor += n; if (n) skip(n * s.count); }
        },
    };
}
