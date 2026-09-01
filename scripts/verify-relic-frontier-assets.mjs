import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const showcase = path.join(root, "showcases", "relic-frontier");
const binaryExtensions = new Set([".glb", ".gltf", ".bin", ".png", ".jpg", ".jpeg", ".webp", ".ktx", ".ktx2", ".hdr", ".mp3", ".ogg", ".wav", ".m4a", ".woff", ".woff2", ".ttf"]);

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
const assets = allFiles.filter((file) => binaryExtensions.has(path.extname(file).toLowerCase()));
const provenance = await readFile(path.join(showcase, "ASSETS.md"), "utf8");
assert.match(provenance, /no third-party binary assets/i);
assert.equal(assets.length, 0, `New binary assets require provenance and intake measurements:\n${assets.map((file) => path.relative(root, file)).join("\n")}`);
console.log(JSON.stringify({ ok: true, thirdPartyAssets: 0, authoredAssetBytes: 0, scannedFiles: allFiles.length }));
