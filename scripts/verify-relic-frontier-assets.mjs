import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BONE_NAMES, CLIP_NAMES, RIG_FILE, RIG_VERSION, buildRelicRangerGlb, parseGlbJson } from "./lib/relic-ranger-rig.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const showcase = path.join(root, "showcases", "relic-frontier");
const binaryExtensions = new Set([".glb", ".gltf", ".bin", ".png", ".jpg", ".jpeg", ".webp", ".ktx", ".ktx2", ".hdr", ".mp3", ".ogg", ".wav", ".m4a", ".woff", ".woff2", ".ttf"]);
const authoredGenerator = "Relic Frontier hand-authored voxel glTF v1";
const authoredAssets = new Map([
  [path.join("showcases", "relic-frontier", "chroma-strike", "assets", "chroma-pulse-rifle.gltf"), { nodes: 10, meshes: 9, materials: 4 }],
  [path.join("showcases", "relic-frontier", "chroma-strike", "assets", "chroma-combat-bot.gltf"), { nodes: 13, meshes: 12, materials: 4 }],
]);
const rigRelativePath = path.join("showcases", "relic-frontier", "assets", RIG_FILE);
const rigLock = Object.freeze({ bytes: 150876, nodes: 19, meshes: 1, materials: 1, skins: 1, joints: BONE_NAMES.length, animations: CLIP_NAMES.length, triangles: 264, maximumBytes: 512 * 1024 });

async function walk(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await walk(absolute));
    else result.push(absolute);
  }
  return result;
}

const allFiles = await walk(showcase);
const assets = allFiles.filter((file) => binaryExtensions.has(path.extname(file).toLowerCase())).map((file) => path.relative(root, file)).sort();
const expected = [...authoredAssets.keys(), rigRelativePath].sort();
const unexpected = assets.filter((file) => !expected.includes(file));
assert.deepEqual(unexpected, [], `New binary assets require provenance and intake measurements:\n${unexpected.join("\n")}`);
assert.deepEqual(assets, expected, "Exactly the locked CHROMA STRIKE glTF files and the Relic Ranger rig must exist");
const provenance = await readFile(path.join(showcase, "ASSETS.md"), "utf8");
assert.match(provenance, /no third-party binary assets/i);
assert.ok(provenance.includes(RIG_FILE), `ASSETS.md must document ${RIG_FILE}`);
assert.ok(provenance.includes(String(rigLock.bytes)), `ASSETS.md must record the locked ${RIG_FILE} size (${rigLock.bytes} bytes)`);
const models = await readFile(path.join(showcase, "chroma-strike", "assets", "MODELS.md"), "utf8");

let authoredAssetBytes = 0;
for (const [relative, expectedCounts] of authoredAssets) {
  const raw = await readFile(path.join(root, relative));
  authoredAssetBytes += raw.byteLength;
  const gltf = JSON.parse(raw.toString("utf8"));
  assert.equal(gltf.asset?.version, "2.0", `${relative}: must declare glTF 2.0`);
  assert.equal(gltf.asset?.generator, authoredGenerator, `${relative}: unexpected generator tag`);
  assert.equal(gltf.nodes?.length, expectedCounts.nodes, `${relative}: unexpected node count`);
  assert.equal(gltf.meshes?.length, expectedCounts.meshes, `${relative}: unexpected mesh count`);
  assert.equal(gltf.materials?.length, expectedCounts.materials, `${relative}: unexpected material count`);
  assert.equal(gltf.images, undefined, `${relative}: images are outside the authored asset lock`);
  assert.equal(gltf.buffers?.length, 1, `${relative}: exactly one embedded buffer expected`);
  assert.match(gltf.buffers[0].uri, /^data:application\/octet-stream;base64,/, `${relative}: buffers must be embedded, not external`);
  const decoded = Buffer.from(gltf.buffers[0].uri.slice(gltf.buffers[0].uri.indexOf(",") + 1), "base64");
  assert.equal(decoded.byteLength, gltf.buffers[0].byteLength, `${relative}: embedded buffer bytes must match declared byteLength`);
  assert.ok(models.includes(path.basename(relative)), `${relative}: must be documented in chroma-strike/assets/MODELS.md`);
}

// The animated rig is regenerated from source and must match the committed bytes exactly.
const committedRig = new Uint8Array(await readFile(path.join(root, rigRelativePath)));
authoredAssetBytes += committedRig.byteLength;
assert.equal(committedRig.byteLength, rigLock.bytes, `${rigRelativePath}: locked size changed; rerun node scripts/build-relic-ranger.mjs and update ASSETS.md`);
assert.ok(committedRig.byteLength <= rigLock.maximumBytes, `${rigRelativePath}: exceeds the ${rigLock.maximumBytes}-byte rig budget`);
const rebuilt = await buildRelicRangerGlb();
assert.equal(rebuilt.bytes.byteLength, committedRig.byteLength, `${rigRelativePath}: regenerated rig size differs from the committed file`);
assert.ok(Buffer.from(rebuilt.bytes).equals(Buffer.from(committedRig)), `${rigRelativePath}: committed bytes drifted from scripts/lib/relic-ranger-rig.mjs output`);
const { version, json } = parseGlbJson(committedRig);
assert.equal(version, 2, `${rigRelativePath}: must be a GLB container version 2`);
assert.equal(json.asset?.version, "2.0", `${rigRelativePath}: must declare glTF 2.0`);
assert.equal(json.nodes?.length, rigLock.nodes, `${rigRelativePath}: unexpected node count`);
assert.equal(json.meshes?.length, rigLock.meshes, `${rigRelativePath}: unexpected mesh count`);
assert.equal(json.materials?.length, rigLock.materials, `${rigRelativePath}: unexpected material count`);
assert.equal(json.images, undefined, `${rigRelativePath}: images are outside the rig lock`);
assert.equal(json.textures, undefined, `${rigRelativePath}: textures are outside the rig lock`);
assert.equal(json.skins?.length, rigLock.skins, `${rigRelativePath}: exactly one skin expected`);
assert.equal(json.skins[0].joints.length, rigLock.joints, `${rigRelativePath}: unexpected joint count`);
assert.deepEqual(json.nodes.filter((node) => node.name && BONE_NAMES.includes(node.name)).map((node) => node.name), BONE_NAMES, `${rigRelativePath}: bone names drifted`);
assert.deepEqual(json.animations?.map(({ name }) => name), CLIP_NAMES, `${rigRelativePath}: animation clip names drifted`);
assert.equal(rebuilt.triangles, rigLock.triangles, `${rigRelativePath}: unexpected triangle count`);
const rigRoot = json.nodes.find((node) => node.name === "RelicRangerRig");
assert.equal(rigRoot?.extras?.generator, RIG_VERSION, `${rigRelativePath}: rig root must carry the repository generator tag`);
assert.equal(json.buffers?.length, 1, `${rigRelativePath}: exactly one binary buffer expected`);
assert.equal(json.buffers[0].uri, undefined, `${rigRelativePath}: the GLB buffer must be embedded in the binary chunk`);

console.log(JSON.stringify({ ok: true, thirdPartyAssets: 0, authoredAssets: authoredAssets.size + 1, authoredAssetBytes, rig: { file: rigRelativePath, bytes: committedRig.byteLength, joints: rigLock.joints, clips: rigLock.animations, triangles: rigLock.triangles }, scannedFiles: allFiles.length }));
