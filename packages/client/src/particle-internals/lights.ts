import * as THREE from "three";
import type { ParticleEmitterOptions } from "./types.js";
import type { createSpace } from "./space.js";
import { distribution, integer, number, record } from "./validation.js";

/** Fixed light pool; zero-intensity unused slots keep Three.js light shader counts stable. @internal */
export function createLights(parent: THREE.Object3D, options: ParticleEmitterOptions, space: ReturnType<typeof createSpace>) {
    const input = options.lights;
    if (input === undefined) return undefined;
    record(input, ["maxLights", "ratio", "intensity", "range", "intensityOverLife", "rangeOverLife", "sizeAffectsRange", "alphaAffectsIntensity"], "lights");
    const count = integer(input.maxLights ?? 4, 1, 32, "maxLights"), ratio = number(input.ratio ?? 1, 0, 1, "light ratio");
    const intensity = number(input.intensity ?? 1, 0, 1e6, "light intensity"), range = number(input.range ?? 2, 0.000001, 1e6, "light range");
    const flat = [{ time: 0, value: 1 }, { time: 1, value: 1 }];
    const intensityCurve = distribution(input.intensityOverLife ?? flat, 0, 1e6, "light intensity curve"), rangeCurve = distribution(input.rangeOverLife ?? flat, 0, 1e6, "light range curve");
    for (const flag of [input.sizeAffectsRange, input.alphaAffectsIntensity]) if (flag !== undefined && typeof flag !== "boolean") throw new TypeError("light multipliers must be boolean");
    const bySize = input.sizeAffectsRange ?? false, byAlpha = input.alphaAffectsIntensity ?? true;
    const pool: THREE.PointLight[] = [];
    function attach() { if (pool.length) return; for (let i = 0; i < count; i++) { const light = new THREE.PointLight(0xffffff, 0, range); light.name = "three-game-kit-particle-light"; light.matrixWorldAutoUpdate = false; parent.add(light); pool.push(light); } }
    const ids = new Float64Array(count).fill(Infinity), point = new THREE.Vector3();
    let used = 0;
    return {
        count, get activeCount() { return used; },
        begin() { attach(); used = 0; ids.fill(Infinity); for (const light of pool) light.intensity = 0; space.update(); },
        particle(id: number, age: number, random: number, position: THREE.Vector3, color: THREE.Color, alpha: number, size: number) {
            // An independent seeded selection does not perturb emission/shape random streams.
            if (random >= ratio) return;
            let slot = 0; for (let k = 1; k < count; k++) if (ids[k]! > ids[slot]!) slot = k;
            if (id >= ids[slot]!) return;
            if (ids[slot] === Infinity) used++;
            ids[slot] = id; const light = pool[slot]!;
            light.color.copy(color); light.intensity = Math.min(1e12, intensity * intensityCurve.sample(age, random) * (byAlpha ? alpha : 1));
            light.distance = Math.max(1e-6, Math.min(1e12, range * rangeCurve.sample(age, random) * (bySize ? size : 1)));
            point.copy(position).applyMatrix4(space.matrix); light.matrixWorld.makeTranslation(point.x, point.y, point.z);
        },
        dispose() { for (const light of pool) { light.removeFromParent(); light.dispose(); } },
    };
}
