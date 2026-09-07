import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const showcase = path.join(root, "showcases", "relic-frontier");
const binaryExtensions = new Set([".glb", ".gltf", ".bin", ".png", ".jpg", ".jpeg", ".webp", ".ktx", ".ktx2", ".hdr", ".mp3", ".ogg", ".wav", ".m4a", ".woff", ".woff2", ".ttf"]);
const authoredGenerator = "Relic Frontier hand-authored voxel glTF v1";
const authoredAssets = new Map([
  [path.join("showcases", "relic-frontier", "chroma-strike", "assets", "chroma-pulse-rifle.gltf"), { nodes: 10, meshes: 9, materials: 4 }],
  [path.join("showcases", "relic-frontier", "chroma-strike", "assets", "chroma-combat-bot.gltf"), { nodes: 13, meshes: 12, materials: 4 }],
]);

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
const unexpected = assets.filter((file) => !authoredAssets.has(file));
assert.deepEqual(unexpected, [], `New binary assets require provenance and intake measurements:\n${unexpected.join("\n")}`);
assert.deepEqual(assets, [...authoredAssets.keys()].sort(), "Exactly the two locked CHROMA STRIKE glTF files must exist");
const provenance = await readFile(path.join(showcase, "ASSETS.md"), "utf8");
assert.match(provenance, /no third-party binary assets/i);
const models = await readFile(path.join(showcase, "chroma-strike", "assets", "MODELS.md"), "utf8");

let authoredAssetBytes = 0;
for (const [relative, expected] of authoredAssets) {
  const raw = await readFile(path.join(root, relative));
  authoredAssetBytes += raw.byteLength;
  const gltf = JSON.parse(raw.toString("utf8"));
  assert.equal(gltf.asset?.version, "2.0", `${relative}: must declare glTF 2.0`);
  assert.equal(gltf.asset?.generator, authoredGenerator, `${relative}: unexpected generator tag`);
  assert.equal(gltf.nodes?.length, expected.nodes, `${relative}: unexpected node count`);
  assert.equal(gltf.meshes?.length, expected.meshes, `${relative}: unexpected mesh count`);
  assert.equal(gltf.materials?.length, expected.materials, `${relative}: unexpected material count`);
  assert.equal(gltf.images, undefined, `${relative}: images are outside the authored asset lock`);
  assert.equal(gltf.buffers?.length, 1, `${relative}: exactly one embedded buffer expected`);
  assert.match(gltf.buffers[0].uri, /^data:application\/octet-stream;base64,/, `${relative}: buffers must be embedded, not external`);
  const decoded = Buffer.from(gltf.buffers[0].uri.slice(gltf.buffers[0].uri.indexOf(",") + 1), "base64");
  assert.equal(decoded.byteLength, gltf.buffers[0].byteLength, `${relative}: embedded buffer bytes must match declared byteLength`);
  assert.ok(models.includes(path.basename(relative)), `${relative}: must be documented in chroma-strike/assets/MODELS.md`);
}
console.log(JSON.stringify({ ok: true, thirdPartyAssets: 0, authoredAssets: authoredAssets.size, authoredAssetBytes, scannedFiles: allFiles.length }));
