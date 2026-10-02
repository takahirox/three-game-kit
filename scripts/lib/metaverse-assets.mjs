// Original Lantern Court asset authoring. No downloaded assets or textures.
import * as T from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { buildRelicRangerScene } from "./relic-ranger-rig.mjs";
export const VERSION = "lantern-court v1";

// Elliptical contour surfaces, authored per body segment rather than box characters.
function contour(rings, sides = 12) {
  const positions = [],
    indices = [];
  for (const [y, rx, rz, z = 0] of rings)
    for (let i = 0; i < sides; i++) {
      const a = (i / sides) * Math.PI * 2;
      positions.push(Math.cos(a) * rx, y, Math.sin(a) * rz + z);
    }
  for (let j = 0; j < rings.length - 1; j++)
    for (let i = 0; i < sides; i++) {
      const a = j * sides + i,
        b = j * sides + ((i + 1) % sides);
      indices.push(a, a + sides, b, b, a + sides, b + sides);
    }
  const g = new T.BufferGeometry();
  g.setAttribute("position", new T.Float32BufferAttribute(positions, 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}

export function visitorScene() {
  // Reuse the repository's proven skeleton and idle/walk/run keyframes; replace all artwork.
  const rig = buildRelicRangerScene();
  const parts = [];
  function part(bone, x, rings, color) {
    const g = contour(rings);
    g.translate(x, 0, 0);
    const count = g.attributes.position.count;
    const joints = new Uint16Array(count * 4),
      weights = new Float32Array(count * 4),
      colors = new Float32Array(count * 3);
    const c = new T.Color(color),
      index = rig.bones.findIndex((b) => b.name === bone);
    for (let i = 0; i < count; i++) {
      joints[i * 4] = index;
      weights[i * 4] = 1;
      colors.set([c.r, c.g, c.b], i * 3);
    }
    g.setAttribute("skinIndex", new T.BufferAttribute(joints, 4));
    g.setAttribute("skinWeight", new T.BufferAttribute(weights, 4));
    g.setAttribute("color", new T.BufferAttribute(colors, 3));
    parts.push(g);
  }
  part(
    "Hips",
    0,
    [
      [0.86, 0, 0],
      [0.87, 0.19, 0.12],
      [1.05, 0.19, 0.13],
      [1.06, 0, 0],
    ],
    0xbd7561,
  );
  part(
    "Spine",
    0,
    [
      [1.03, 0, 0],
      [1.04, 0.2, 0.14],
      [1.25, 0.18, 0.13],
      [1.33, 0.22, 0.13],
      [1.34, 0, 0],
    ],
    0x284d57,
  );
  part(
    "Chest",
    0,
    [
      [1.3, 0, 0],
      [1.31, 0.21, 0.13],
      [1.51, 0.25, 0.14],
      [1.6, 0.17, 0.12],
      [1.61, 0, 0],
    ],
    0x284d57,
  );
  part(
    "Neck",
    0,
    [
      [1.56, 0, 0],
      [1.57, 0.08, 0.08],
      [1.7, 0.08, 0.08],
      [1.71, 0, 0],
    ],
    0xe0aa83,
  );
  part(
    "Head",
    0,
    [
      [1.68, 0, 0],
      [1.71, 0.1, 0.1],
      [1.81, 0.145, 0.14],
      [1.91, 0.14, 0.13],
      [1.96, 0.08, 0.08],
      [1.97, 0, 0],
    ],
    0xe0aa83,
  );
  part(
    "Head",
    0,
    [
      [1.88, 0, 0],
      [1.9, 0.15, 0.14, -0.015],
      [1.99, 0.12, 0.115, -0.02],
      [2.02, 0, 0],
    ],
    0x302e38,
  );
  part(
    "Chest",
    0,
    [
      [1.55, 0, 0],
      [1.56, 0.19, 0.15],
      [1.62, 0.18, 0.14],
      [1.63, 0, 0],
    ],
    0xecc66c,
  );
  // A small ochre scarf tail on the front of the jacket.
  part(
    "Chest",
    -0.06,
    [
      [1.27, 0, 0, 0.15],
      [1.29, 0.04, 0.02, 0.15],
      [1.58, 0.045, 0.02, 0.15],
      [1.59, 0, 0, 0.15],
    ],
    0xecc66c,
  );
  for (const [side, x] of [
    ["L", 0.3],
    ["R", -0.3],
  ]) {
    part(
      "UpperArm" + side,
      x,
      [
        [1.2, 0, 0],
        [1.21, 0.075, 0.075],
        [1.43, 0.085, 0.085],
        [1.55, 0.07, 0.07],
        [1.56, 0, 0],
      ],
      0x284d57,
    );
    part(
      "ForeArm" + side,
      x,
      [
        [0.93, 0, 0],
        [0.94, 0.065, 0.065],
        [1.2, 0.073, 0.073],
        [1.21, 0, 0],
      ],
      0x356774,
    );
    part(
      "Hand" + side,
      x,
      [
        [0.82, 0, 0],
        [0.85, 0.06, 0.055],
        [0.95, 0.055, 0.05],
        [0.96, 0, 0],
      ],
      0xe0aa83,
    );
    const legX = x > 0 ? 0.14 : -0.14;
    part(
      "Thigh" + side,
      legX,
      [
        [0.46, 0, 0],
        [0.47, 0.075, 0.09],
        [0.84, 0.095, 0.11],
        [0.88, 0.09, 0.09],
        [0.89, 0, 0],
      ],
      0xbd7561,
    );
    part(
      "Shin" + side,
      legX,
      [
        [0.1, 0, 0],
        [0.11, 0.063, 0.073],
        [0.47, 0.075, 0.085],
        [0.48, 0, 0],
      ],
      0xb06a59,
    );
    part(
      "Foot" + side,
      legX,
      [
        [0, 0, 0, 0.045],
        [0.015, 0.08, 0.15, 0.045],
        [0.08, 0.08, 0.15, 0.045],
        [0.13, 0.06, 0.09, 0.01],
        [0.14, 0, 0],
      ],
      0x303943,
    );
  }
  // Eyes are geometry in the same skin, no image dependency.
  for (const x of [-0.055, 0.055])
    part(
      "Head",
      x,
      [
        [1.835, 0, 0, 0.132],
        [1.84, 0.015, 0.012, 0.132],
        [1.865, 0.015, 0.012, 0.132],
        [1.87, 0, 0, 0.132],
      ],
      0x302e38,
    );
  rig.mesh.geometry.dispose();
  rig.mesh.geometry = mergeGeometries(parts, false);
  rig.mesh.name = "CourtVisitor";
  rig.mesh.material.name = "VisitorPalette";
  rig.root.name = "CourtVisitorRig";
  rig.root.userData = {
    generator: VERSION,
    provenance:
      "Repository original; skeleton and locomotion adapted from Relic Ranger",
    license: "repository license",
  };
  return {
    root: rig.root,
    clips: rig.clips.filter((c) => ["idle", "walk", "run"].includes(c.name)),
  };
}

export function courtScene() {
  const root = new T.Group();
  root.name = "LanternCourt";
  root.userData = {
    generator: VERSION,
    provenance: "repository original",
    license: "repository license",
  };
  const mat = (name, color) =>
    new T.MeshStandardMaterial({ name, color, roughness: 0.85 });
  const stone = mat("Warm limestone", 0xe2c9a2),
    wood = mat("Cedar", 0x8b5846),
    roof = mat("Patinated copper", 0x427e7d),
    leaf = mat("Garden green", 0x54795d),
    pot = mat("Terracotta", 0xb87353);
  function mesh(g, m, x, y, z, name = "") {
    const o = new T.Mesh(g, m);
    o.position.set(x, y, z);
    o.name = name;
    root.add(o);
    return o;
  }
  function box(w, h, d, m, x, y, z) {
    return mesh(new T.BoxGeometry(w, h, d), m, x, y, z);
  }
  function arch(x, z) {
    const s = new T.Shape();
    s.moveTo(-1.65, 0);
    s.lineTo(-1.65, 2.3);
    s.absarc(0, 2.3, 1.65, Math.PI, 0, true);
    s.lineTo(1.65, 0);
    s.lineTo(1.34, 0);
    s.lineTo(1.34, 2.3);
    s.absarc(0, 2.3, 1.34, 0, Math.PI, false);
    s.lineTo(-1.34, 0);
    s.closePath();
    mesh(
      new T.ExtrudeGeometry(s, {
        depth: 0.38,
        bevelEnabled: false,
        curveSegments: 16,
      }),
      stone,
      x,
      0,
      z,
      "Carved arcade",
    );
  }
  // Two open arcaded pavilions frame the square. Roof uses an authored sweeping profile.
  for (const x of [-8, 8]) {
    for (const z of [-8, -5]) arch(x, z);
    for (const z of [-8, -5])
      for (const dx of [-1.5, 1.5])
        box(0.55, 0.18, 0.75, stone, x + dx, 0.1, z + 0.18);
    const s = new T.Shape();
    s.moveTo(-2.15, 0);
    s.quadraticCurveTo(-1.4, 0.12, 0, 1.05);
    s.quadraticCurveTo(1.4, 0.12, 2.15, 0);
    s.lineTo(2.15, -0.16);
    s.quadraticCurveTo(1.4, -0.04, 0, 0.87);
    s.quadraticCurveTo(-1.4, -0.04, -2.15, -0.16);
    s.closePath();
    mesh(
      new T.ExtrudeGeometry(s, {
        depth: 4.1,
        bevelEnabled: false,
        curveSegments: 12,
      }),
      roof,
      x,
      3.85,
      -8.45,
      "Sweeping pavilion roof",
    );
    box(2.4, 0.13, 0.65, wood, x, 0.6, -7);
    box(2.4, 0.45, 0.13, wood, x, 0.95, -7.3);
    for (const dx of [-0.9, 0.9]) box(0.12, 0.6, 0.5, wood, x + dx, 0.3, -7);
  }
  // Benches, lathed ceramic planters, stylised branching garden trees.
  for (const x of [-5, 5]) {
    box(2.3, 0.14, 0.6, wood, x, 0.55, 1);
    box(2.3, 0.5, 0.12, wood, x, 0.9, 1.3);
    for (const dx of [-0.8, 0.8]) box(0.15, 0.5, 0.5, stone, x + dx, 0.25, 1);
  }
  for (const [x, z] of [
    [-12, -10],
    [12, -10],
    [-12, 4],
    [12, 4],
    [-6, 9],
    [6, 9],
  ]) {
    const points = [
      [0, 0],
      [0.45, 0],
      [0.58, 0.6],
      [0.61, 0.66],
      [0.48, 0.67],
      [0.39, 0.1],
      [0, 0.1],
    ].map(([a, b]) => new T.Vector2(a, b));
    mesh(
      new T.LatheGeometry(points, 16),
      pot,
      x,
      0,
      z,
      "Ceramic garden planter",
    );
    mesh(
      new T.CylinderGeometry(0.12, 0.2, 2.4, 8),
      wood,
      x,
      1.65,
      z,
      "Tree trunk",
    );
    for (const [dx, dy, dz, r] of [
      [0, 3.4, 0, 1.3],
      [-0.7, 2.8, 0.2, 0.9],
      [0.75, 3, 0.1, 0.85],
    ]) {
      const g = new T.IcosahedronGeometry(r, 1);
      g.scale(1, 0.85, 1);
      mesh(g, leaf, x + dx, dy, z + dz, "Faceted canopy");
    }
  }
  // Lantern is named for presentation attachment; its toggle state lives in the rules.
  mesh(
    new T.CylinderGeometry(0.25, 0.36, 0.24, 12),
    stone,
    0,
    0.12,
    -3,
    "Lantern plinth",
  );
  mesh(
    new T.CylinderGeometry(0.065, 0.09, 2.5, 8),
    wood,
    0,
    1.45,
    -3,
    "Lantern stem",
  );
  const glow = new T.MeshStandardMaterial({
    name: "Lantern glass",
    color: 0xffdf9a,
    emissive: 0xffbb55,
    emissiveIntensity: 0.05,
    roughness: 0.3,
  });
  mesh(
    new T.LatheGeometry(
      [
        new T.Vector2(0, -0.4),
        new T.Vector2(0.26, -0.27),
        new T.Vector2(0.3, 0.2),
        new T.Vector2(0.15, 0.4),
        new T.Vector2(0, 0.43),
      ],
      12,
    ),
    glow,
    0,
    2.9,
    -3,
    "LanternGlow",
  );
  mesh(new T.ConeGeometry(0.42, 0.3, 8), roof, 0, 3.45, -3, "Lantern cap");
  return root;
}

export async function buildAssets() {
  if (typeof globalThis.FileReader === "undefined")
    globalThis.FileReader = class {
      readAsArrayBuffer(blob) {
        blob.arrayBuffer().then((b) => {
          this.result = b;
          this.onloadend?.();
        });
      }
    };
  const visitor = visitorScene();
  const exportGlb = (root, animations = []) =>
    new Promise((resolve, reject) =>
      new GLTFExporter().parse(
        root,
        (b) => resolve(new Uint8Array(b)),
        reject,
        { binary: true, trs: true, animations },
      ),
    );
  return {
    "visitor.glb": await exportGlb(visitor.root, visitor.clips),
    "court.glb": await exportGlb(courtScene()),
  };
}
