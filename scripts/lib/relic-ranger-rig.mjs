// Repository-authored animated humanoid rig for Relic Frontier.
//
// The rig is generated deterministically from this file: a 17-bone humanoid skeleton,
// one rigid-segment skinned mesh with vertex colours, and eleven authored animation clips.
// `pnpm exec node scripts/build-relic-ranger.mjs` writes the GLB; the asset intake gate
// regenerates it in memory and byte-compares it against the committed file.
import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

export const RIG_VERSION = "relic-ranger-rig v1";
export const RIG_FILE = "relic-ranger.glb";

const BONES = [
  ["Hips", null, [0, 0.96, 0]],
  ["Spine", "Hips", [0, 0.16, 0]],
  ["Chest", "Spine", [0, 0.22, 0]],
  ["Neck", "Chest", [0, 0.24, 0]],
  ["Head", "Neck", [0, 0.1, 0]],
  ["UpperArmL", "Chest", [0.3, 0.18, 0]],
  ["ForeArmL", "UpperArmL", [0, -0.3, 0]],
  ["HandL", "ForeArmL", [0, -0.28, 0]],
  ["UpperArmR", "Chest", [-0.3, 0.18, 0]],
  ["ForeArmR", "UpperArmR", [0, -0.3, 0]],
  ["HandR", "ForeArmR", [0, -0.28, 0]],
  ["ThighL", "Hips", [0.14, -0.06, 0]],
  ["ShinL", "ThighL", [0, -0.44, 0]],
  ["FootL", "ShinL", [0, -0.44, 0]],
  ["ThighR", "Hips", [-0.14, -0.06, 0]],
  ["ShinR", "ThighR", [0, -0.44, 0]],
  ["FootR", "ShinR", [0, -0.44, 0]],
];
export const BONE_NAMES = BONES.map(([name]) => name);

const COLORS = {
  suit: 0xe9e2cf,
  armor: 0x213d3d,
  visor: 0x6fffe1,
  blade: 0xd8fff6,
  boot: 0x172b2c,
  scarf: 0xff6b63,
};

// [bone, size xyz, world centre xyz, colour]
const SEGMENTS = [
  ["Hips", [0.36, 0.2, 0.22], [0, 0.94, 0], COLORS.armor],
  ["Spine", [0.32, 0.2, 0.2], [0, 1.23, 0], COLORS.suit],
  ["Spine", [0.3, 0.3, 0.14], [0, 1.28, -0.19], COLORS.armor],
  ["Chest", [0.44, 0.26, 0.26], [0, 1.47, 0], COLORS.suit],
  ["Chest", [0.5, 0.08, 0.28], [0, 1.6, 0], COLORS.scarf],
  ["Neck", [0.12, 0.12, 0.12], [0, 1.62, 0], COLORS.suit],
  ["Head", [0.3, 0.3, 0.3], [0, 1.84, 0], COLORS.armor],
  ["Head", [0.22, 0.06, 0.04], [0, 1.85, 0.16], COLORS.visor],
  ["UpperArmL", [0.16, 0.3, 0.16], [0.3, 1.37, 0], COLORS.suit],
  ["ForeArmL", [0.14, 0.28, 0.14], [0.3, 1.08, 0], COLORS.suit],
  ["HandL", [0.12, 0.12, 0.12], [0.3, 0.88, 0], COLORS.armor],
  ["UpperArmR", [0.16, 0.3, 0.16], [-0.3, 1.37, 0], COLORS.suit],
  ["ForeArmR", [0.14, 0.28, 0.14], [-0.3, 1.08, 0], COLORS.suit],
  ["HandR", [0.12, 0.12, 0.12], [-0.3, 0.88, 0], COLORS.armor],
  ["HandR", [0.05, 0.05, 0.9], [-0.3, 0.88, 0.5], COLORS.blade],
  ["HandR", [0.2, 0.05, 0.05], [-0.3, 0.88, 0.07], COLORS.armor],
  ["ThighL", [0.18, 0.42, 0.2], [0.14, 0.69, 0], COLORS.suit],
  ["ShinL", [0.15, 0.42, 0.16], [0.14, 0.25, 0], COLORS.boot],
  ["FootL", [0.16, 0.1, 0.3], [0.14, 0.05, 0.06], COLORS.boot],
  ["ThighR", [0.18, 0.42, 0.2], [-0.14, 0.69, 0], COLORS.suit],
  ["ShinR", [0.15, 0.42, 0.16], [-0.14, 0.25, 0], COLORS.boot],
  ["FootR", [0.16, 0.1, 0.3], [-0.14, 0.05, 0.06], COLORS.boot],
];

const SAMPLE_RATE = 30;

function smooth(t) {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
}

function between(p, start, end) {
  return smooth((p - start) / (end - start));
}

function pulse(p, start, peak, end) {
  return p < start ? 0 : p < peak ? smooth((p - start) / (peak - start)) : p < end ? 1 - smooth((p - peak) / (end - peak)) : 0;
}

// Every pose function returns { boneName: [x, y, z] euler radians, hips: [x, y, z] position offset }.
function idlePose(p) {
  const breath = Math.sin(p * Math.PI * 2);
  return {
    Chest: [0.04 * breath, 0, 0],
    Head: [0.03 * breath, 0.05 * Math.sin(p * Math.PI * 2 + 1), 0],
    UpperArmL: [0.05, 0, 0.14 + 0.03 * breath],
    UpperArmR: [0.05, 0, -0.14 - 0.03 * breath],
    ForeArmL: [-0.2, 0, 0],
    ForeArmR: [-0.2, 0, 0],
    hips: [0, 0.012 * breath, 0],
  };
}

function locomotionPose(p, legAmplitude, armAmplitude, lean, bob) {
  const swing = Math.sin(p * Math.PI * 2);
  const counter = Math.sin(p * Math.PI * 2 + Math.PI);
  const kneeL = Math.max(0, Math.sin(p * Math.PI * 2 + Math.PI * 0.5));
  const kneeR = Math.max(0, Math.sin(p * Math.PI * 2 + Math.PI * 1.5));
  return {
    Spine: [lean, 0, 0],
    Chest: [lean * 0.4, 0.08 * swing, 0],
    Head: [-lean * 0.6, 0, 0],
    ThighL: [-legAmplitude * swing, 0, 0],
    ThighR: [-legAmplitude * counter, 0, 0],
    ShinL: [legAmplitude * 1.3 * kneeL, 0, 0],
    ShinR: [legAmplitude * 1.3 * kneeR, 0, 0],
    UpperArmL: [-armAmplitude * counter, 0, 0.16],
    UpperArmR: [-armAmplitude * swing, 0, -0.16],
    ForeArmL: [-0.35 - armAmplitude * 0.5, 0, 0],
    ForeArmR: [-0.35 - armAmplitude * 0.5, 0, 0],
    hips: [0, -bob * Math.abs(Math.sin(p * Math.PI * 2)), 0],
  };
}

function walkPose(p) { return locomotionPose(p, 0.5, 0.35, 0.05, 0.03); }
function runPose(p) { return locomotionPose(p, 0.95, 0.85, 0.24, 0.05); }

function lightAttackPose(p, mirror) {
  const windup = pulse(p, 0, 0.3, 0.42);
  const swing = between(p, 0.3, 0.48);
  const recover = between(p, 0.6, 1);
  const twist = (windup * 0.55 - swing * 1.0) * (1 - recover) * (mirror ? -1 : 1);
  const armRaise = (-1.7 * windup - 0.5 * swing) * (1 - recover);
  const armSide = (mirror ? 1.1 : -0.9) * swing * (1 - recover);
  return {
    Spine: [0.1 * swing * (1 - recover), twist * 0.5, 0],
    Chest: [0.1 * swing, twist, 0],
    UpperArmR: [armRaise, armSide * 0.3, armSide],
    ForeArmR: [-0.9 * windup * (1 - swing), 0, 0],
    UpperArmL: [0.3 * windup - 0.2 * swing, 0, 0.35 * windup],
    ThighL: [-0.25 * swing * (1 - recover), 0, 0],
    ThighR: [0.2 * swing * (1 - recover), 0, 0],
    hips: [0, -0.04 * swing * (1 - recover), 0],
  };
}

function heavyAttackPose(p) {
  const raise = pulse(p, 0, 0.42, 0.56);
  const slam = between(p, 0.44, 0.56);
  const recover = between(p, 0.72, 1);
  const armX = (-2.7 * raise + 1.1 * slam) * (1 - recover);
  return {
    Spine: [(-0.25 * raise + 0.55 * slam) * (1 - recover), 0, 0],
    Chest: [(-0.2 * raise + 0.25 * slam) * (1 - recover), 0, 0],
    Head: [(0.2 * raise - 0.3 * slam) * (1 - recover), 0, 0],
    UpperArmR: [armX, 0, -0.25 * raise],
    UpperArmL: [armX, 0, 0.25 * raise],
    ForeArmR: [-0.6 * raise * (1 - slam), 0, 0],
    ForeArmL: [-0.6 * raise * (1 - slam), 0, 0],
    ThighL: [-0.4 * slam * (1 - recover), 0, 0],
    ShinL: [0.6 * slam * (1 - recover), 0, 0],
    ThighR: [0.3 * slam * (1 - recover), 0, 0],
    hips: [0, (-0.06 * raise - 0.2 * slam) * (1 - recover), 0],
  };
}

function dodgePose(p) {
  const tuck = pulse(p, 0.05, 0.3, 0.9);
  const roll = between(p, 0.12, 0.82) * Math.PI * 2;
  const drop = pulse(p, 0.1, 0.4, 0.9);
  return {
    Hips: [roll, 0, 0],
    Spine: [0.5 * tuck, 0, 0],
    Chest: [0.5 * tuck, 0, 0],
    Head: [0.4 * tuck, 0, 0],
    ThighL: [-1.5 * tuck, 0, 0],
    ThighR: [-1.5 * tuck, 0, 0],
    ShinL: [1.8 * tuck, 0, 0],
    ShinR: [1.8 * tuck, 0, 0],
    UpperArmL: [-1.4 * tuck, 0, 0.4 * tuck],
    UpperArmR: [-1.4 * tuck, 0, -0.4 * tuck],
    ForeArmL: [-1.2 * tuck, 0, 0],
    ForeArmR: [-1.2 * tuck, 0, 0],
    hips: [0, -0.42 * drop, 0],
  };
}

function hitReactPose(p) {
  const jolt = pulse(p, 0, 0.25, 1);
  return {
    Spine: [-0.3 * jolt, 0, 0],
    Chest: [-0.25 * jolt, 0.15 * jolt, 0],
    Head: [-0.35 * jolt, 0, 0],
    UpperArmL: [-0.5 * jolt, 0, 0.5 * jolt],
    UpperArmR: [-0.5 * jolt, 0, -0.5 * jolt],
    ForeArmL: [-0.8 * jolt, 0, 0],
    ForeArmR: [-0.8 * jolt, 0, 0],
    ThighR: [-0.3 * jolt, 0, 0],
    hips: [0, -0.03 * jolt, -0.06 * jolt],
  };
}

function staggerPose(p) {
  const reel = pulse(p, 0, 0.3, 1);
  const stumble = Math.sin(p * Math.PI * 4) * pulse(p, 0.2, 0.5, 1);
  return {
    Spine: [-0.6 * reel, 0.25 * stumble, 0],
    Chest: [-0.3 * reel, 0, 0.2 * stumble],
    Head: [-0.5 * reel, 0.3 * stumble, 0],
    UpperArmL: [-1.0 * reel, 0, 0.9 * reel],
    UpperArmR: [-1.0 * reel, 0, -0.9 * reel],
    ForeArmL: [-0.5 * reel, 0, 0],
    ForeArmR: [-0.5 * reel, 0, 0],
    ThighL: [-0.5 * reel, 0, 0.15 * reel],
    ThighR: [0.4 * reel, 0, -0.15 * reel],
    ShinL: [0.7 * reel, 0, 0],
    ShinR: [0.5 * reel, 0, 0],
    hips: [0, -0.14 * reel, -0.1 * reel],
  };
}

function deathPose(p) {
  const fall = between(p, 0.05, 0.62);
  const settle = between(p, 0.5, 0.95);
  return {
    Hips: [-1.45 * fall, 0, 0],
    Spine: [-0.25 * fall, 0, 0],
    Chest: [-0.15 * fall + 0.1 * settle, 0, 0],
    Head: [-0.4 * fall + 0.5 * settle, 0.3 * settle, 0],
    UpperArmL: [-1.0 * fall, 0, 1.3 * settle],
    UpperArmR: [-1.0 * fall, 0, -1.3 * settle],
    ForeArmL: [-0.6 * fall * (1 - settle), 0, 0],
    ForeArmR: [-0.6 * fall * (1 - settle), 0, 0],
    ThighL: [-0.35 * settle, 0, 0.2 * settle],
    ThighR: [-0.2 * settle, 0, -0.2 * settle],
    ShinL: [0.5 * settle, 0, 0],
    ShinR: [0.3 * settle, 0, 0],
    hips: [0, -0.62 * fall, -0.3 * fall],
  };
}

function castPose(p) {
  const raise = pulse(p, 0, 0.35, 0.75);
  const release = pulse(p, 0.42, 0.52, 0.8);
  return {
    Spine: [-0.12 * raise + 0.2 * release, 0, 0],
    Chest: [-0.1 * raise + 0.15 * release, 0, 0],
    Head: [0.15 * raise, 0, 0],
    UpperArmL: [-1.5 * raise - 0.2 * release, 0, 0.35 * raise],
    UpperArmR: [-1.5 * raise - 0.2 * release, 0, -0.35 * raise],
    ForeArmL: [-0.4 * raise * (1 - release), 0, 0],
    ForeArmR: [-0.4 * raise * (1 - release), 0, 0],
    ThighL: [-0.15 * release, 0, 0],
    hips: [0, -0.03 * raise, -0.05 * raise + 0.08 * release],
  };
}

export const CLIPS = [
  ["idle", 2.0, idlePose],
  ["walk", 1.0, walkPose],
  ["run", 0.6, runPose],
  ["attack-light", 0.45, (p) => lightAttackPose(p, false)],
  ["attack-light-2", 0.45, (p) => lightAttackPose(p, true)],
  ["attack-heavy", 0.85, heavyAttackPose],
  ["dodge-roll", 0.55, dodgePose],
  ["hit-react", 0.3, hitReactPose],
  ["stagger", 0.65, staggerPose],
  ["death", 1.2, deathPose],
  ["cast", 0.8, castPose],
];
export const CLIP_NAMES = CLIPS.map(([name]) => name);

function buildClip(name, duration, poseAt) {
  const sampleCount = Math.max(2, Math.round(duration * SAMPLE_RATE) + 1);
  const times = Array.from({ length: sampleCount }, (_, index) => (index / (sampleCount - 1)) * duration);
  const rotations = new Map(BONE_NAMES.map((bone) => [bone, []]));
  const hipsPositions = [];
  const hipsRest = BONES[0][2];
  const euler = new THREE.Euler();
  const quaternion = new THREE.Quaternion();
  for (const time of times) {
    const pose = poseAt(duration === 0 ? 0 : time / duration);
    for (const bone of BONE_NAMES) {
      const [x, y, z] = pose[bone] ?? [0, 0, 0];
      euler.set(x, y, z, "XYZ");
      quaternion.setFromEuler(euler);
      rotations.get(bone).push(quaternion.x, quaternion.y, quaternion.z, quaternion.w);
    }
    const [hx, hy, hz] = pose.hips ?? [0, 0, 0];
    hipsPositions.push(hipsRest[0] + hx, hipsRest[1] + hy, hipsRest[2] + hz);
  }
  const tracks = [];
  for (const bone of BONE_NAMES) {
    const values = rotations.get(bone);
    const constant = values.every((value, index) => Math.abs(value - values[index % 4]) < 1e-9);
    if (constant && Math.abs(values[0]) < 1e-9 && Math.abs(values[1]) < 1e-9 && Math.abs(values[2]) < 1e-9) continue;
    tracks.push(new THREE.QuaternionKeyframeTrack(`${bone}.quaternion`, times, values));
  }
  tracks.push(new THREE.VectorKeyframeTrack("Hips.position", times, hipsPositions));
  return new THREE.AnimationClip(name, duration, tracks);
}

export function buildRelicRangerScene() {
  const bones = new Map();
  for (const [name, parent, [x, y, z]] of BONES) {
    const bone = new THREE.Bone();
    bone.name = name;
    bone.position.set(x, y, z);
    bones.set(name, bone);
    if (parent !== null) bones.get(parent).add(bone);
  }
  const boneList = BONE_NAMES.map((name) => bones.get(name));
  const geometries = [];
  const color = new THREE.Color();
  for (const [bone, [sx, sy, sz], [cx, cy, cz], hex] of SEGMENTS) {
    const geometry = new THREE.BoxGeometry(sx, sy, sz);
    geometry.translate(cx, cy, cz);
    const count = geometry.attributes.position.count;
    const boneIndex = BONE_NAMES.indexOf(bone);
    const skinIndex = new Uint16Array(count * 4);
    const skinWeight = new Float32Array(count * 4);
    const colors = new Float32Array(count * 3);
    color.setHex(hex);
    for (let index = 0; index < count; index += 1) {
      skinIndex[index * 4] = boneIndex;
      skinWeight[index * 4] = 1;
      colors[index * 3] = color.r;
      colors[index * 3 + 1] = color.g;
      colors[index * 3 + 2] = color.b;
    }
    geometry.setAttribute("skinIndex", new THREE.BufferAttribute(skinIndex, 4));
    geometry.setAttribute("skinWeight", new THREE.BufferAttribute(skinWeight, 4));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geometries.push(geometry);
  }
  const merged = mergeGeometries(geometries, false);
  merged.name = "RelicRangerBody";
  const material = new THREE.MeshStandardMaterial({ name: "RelicRangerSuit", vertexColors: true, roughness: 0.72, metalness: 0.08 });
  const mesh = new THREE.SkinnedMesh(merged, material);
  mesh.name = "RelicRanger";
  mesh.add(boneList[0]);
  mesh.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(boneList));
  const root = new THREE.Group();
  root.name = "RelicRangerRig";
  root.userData = { generator: RIG_VERSION, provenance: "repository-original, generated by scripts/lib/relic-ranger-rig.mjs", license: "repository license" };
  root.add(mesh);
  const clips = CLIPS.map(([name, duration, pose]) => buildClip(name, duration, pose));
  return { root, mesh, bones: boneList, clips };
}

export async function buildRelicRangerGlb() {
  if (typeof globalThis.FileReader === "undefined") {
    globalThis.FileReader = class {
      readAsArrayBuffer(blob) { blob.arrayBuffer().then((buffer) => { this.result = buffer; this.onloadend?.(); }); }
      readAsDataURL(blob) { blob.arrayBuffer().then((buffer) => { this.result = `data:application/octet-stream;base64,${Buffer.from(buffer).toString("base64")}`; this.onloadend?.(); }); }
    };
  }
  const { root, clips, mesh } = buildRelicRangerScene();
  const exporter = new GLTFExporter();
  const glb = await new Promise((resolve, reject) => exporter.parse(root, resolve, reject, { binary: true, animations: clips, trs: true }));
  const triangles = mesh.geometry.index === null ? mesh.geometry.attributes.position.count / 3 : mesh.geometry.index.count / 3;
  return { bytes: new Uint8Array(glb), triangles, vertices: mesh.geometry.attributes.position.count, bones: BONE_NAMES.length, clips: CLIP_NAMES.length };
}

export function parseGlbJson(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67) throw new Error("Not a GLB file");
  const version = view.getUint32(4, true);
  const jsonLength = view.getUint32(12, true);
  const jsonType = view.getUint32(16, true);
  if (jsonType !== 0x4e4f534a) throw new Error("First GLB chunk must be JSON");
  const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength)));
  return { version, json };
}
