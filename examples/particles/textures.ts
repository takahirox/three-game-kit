import * as THREE from "three";

export type TextureName = "glow" | "star" | "streak" | "smoke" | "petal" | "bolt" | "ripple" | "glyph";

/** Small procedural assets shared by every preset. No downloads or image dependencies. */
export function createTextures(): Record<TextureName, THREE.DataTexture> {
    const names: TextureName[] = ["glow", "star", "streak", "smoke", "petal", "bolt", "ripple", "glyph"];
    return Object.fromEntries(names.map(name => {
        const side = name === "glyph" ? 128 : 64;
        const pixels = new Uint8Array(side * side * 4);
        for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) {
            const atlas = name === "ripple" || name === "glyph";
            const cells = name === "glyph" ? 4 : 2;
            const cellSize = atlas ? side / cells : side;
            const frame = Math.floor(x / cellSize) + Math.floor(y / cellSize) * cells;
            const u = ((x % cellSize) + 0.5) / cellSize * 2 - 1;
            const v = ((y % cellSize) + 0.5) / cellSize * 2 - 1;
            const r = Math.hypot(u, v);
            let alpha = 0;
            switch (name) {
                case "glow": alpha = Math.exp(-r * r * 5) * Math.max(0, 1 - r); break;
                case "star": alpha = Math.exp(-r * r * 14) + 0.55 * Math.exp(-Math.abs(u * v) * 65 - r * 3); break;
                case "streak": alpha = Math.exp(-u * u * 180 - v * v * 3) * Math.max(0, 1 - Math.abs(v)); break;
                case "smoke": {
                    const noise = 0.7 + 0.15 * Math.sin(u * 15 + Math.sin(v * 13)) + 0.15 * Math.cos(v * 19 - u * 8);
                    alpha = Math.max(0, 1 - r) ** 1.5 * noise; break;
                }
                case "petal": alpha = Math.max(0, Math.min(1, (1 - Math.hypot(u * 1.5, v * 1.05)) * 5)); break;
                case "bolt": {
                    const center = Math.sin(v * 13) * 0.16 + Math.sin(v * 27) * 0.07;
                    alpha = Math.exp(-Math.abs(u - center) * 65) * Math.max(0, 1 - Math.abs(v)); break;
                }
                case "ripple": alpha = Math.max(0, 1 - Math.abs(r - (0.25 + frame * 0.18)) * 25); break;
                case "glyph": {
                    const gx = Math.floor((u + 1) * 3), gy = Math.floor((v + 1) * 4);
                    const bit = ((frame * 13 + gy * 7 + gx * 3) ^ (frame >> (gx % 3))) % 5;
                    const ink = gx > 0 && gx < 5 && gy > 0 && gy < 7 && (bit < 2 || gx === 1);
                    alpha = ink ? 0.9 : 0; break;
                }
            }
            const i = (y * side + x) * 4;
            pixels[i] = 255; pixels[i + 1] = 255; pixels[i + 2] = 255;
            pixels[i + 3] = Math.round(Math.min(1, alpha) * 255);
        }
        const texture = new THREE.DataTexture(pixels, side, side);
        texture.magFilter = THREE.LinearFilter; texture.minFilter = THREE.LinearFilter;
        texture.needsUpdate = true;
        return [name, texture];
    })) as Record<TextureName, THREE.DataTexture>;
}
