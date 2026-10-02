// Authority-neutral authored layout, positions are metres. No DOM or Three.js objects.
export const DT = 1 / 60;
export const FOOT_OFFSET = 0.91; // Capsule half height .58 + radius .32 + collision skin .01.
export const SPAWN = Object.freeze({ x: 0, y: FOOT_OFFSET, z: 5 });
export const LANTERN = Object.freeze({
  entityId: "court_lantern",
  position: Object.freeze({ x: 0, y: FOOT_OFFSET, z: -3 }),
  range: 2.5,
});
const box = (
  id: string,
  x: number,
  y: number,
  z: number,
  hx: number,
  hy: number,
  hz: number,
) =>
  Object.freeze({
    id,
    center: Object.freeze({ x, y, z }),
    halfExtents: Object.freeze({ x: hx, y: hy, z: hz }),
  });
export const COLLISION_SCENE = Object.freeze({
  capsuleRadius: 0.32,
  capsuleHalfHeight: 0.58,
  controllerOffset: 0.01,
  boxes: Object.freeze([
    box("ground", 0, -0.5, 0, 16, 0.5, 16),
    box("north", 0, 1, -16, 16, 1, 0.3),
    box("south", 0, 1, 16, 16, 1, 0.3),
    box("west", -16, 1, 0, 0.3, 1, 16),
    box("east", 16, 1, 0, 0.3, 1, 16),
    box("lantern", 0, 1.6, -3, 0.35, 1.6, 0.35),
    ...[-8, 8].flatMap((x) =>
      [-8, -5].flatMap((z) =>
        [-1.5, 1.5].map((dx) =>
          box(`pillar_${x}_${z}_${dx}`, x + dx, 1.5, z + 0.19, 0.25, 1.5, 0.3),
        ),
      ),
    ),
    ...[-8, 8].map((x) =>
      box(`pavilion_bench_${x}`, x, 0.65, -7, 1.2, 0.65, 0.4),
    ),
    ...[-5, 5].map((x) => box(`bench_${x}`, x, 0.65, 1, 1.15, 0.65, 0.4)),
    ...[
      [-12, -10],
      [12, -10],
      [-12, 4],
      [12, 4],
      [-6, 9],
      [6, 9],
    ].map(([x, z]) => box(`tree_${x}_${z}`, x!, 1.5, z!, 0.62, 1.5, 0.62)),
  ]),
});
export type Locomotion = "idle" | "walk" | "run";
export type Action = "jump" | "interact";
