import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const showcase = path.join(root, "showcases", "gravetide");
const binaryExtensions = new Set([".glb", ".gltf", ".bin", ".png", ".jpg", ".jpeg", ".webp", ".ktx", ".ktx2", ".hdr", ".mp3", ".ogg", ".wav", ".m4a", ".woff", ".woff2", ".ttf"]);

async function walk(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...(await walk(absolute)));
    else result.push(absolute);
  }
  return result;
}

const allFiles = await walk(showcase);
const assets = allFiles.filter((file) => binaryExtensions.has(path.extname(file).toLowerCase())).map((file) => path.relative(root, file)).sort();
assert.deepEqual(assets, [], `Gravetide is an asset-free showcase; new binary assets require provenance and intake measurements:\n${assets.join("\n")}`);
const provenance = await readFile(path.join(showcase, "ASSETS.md"), "utf8");
assert.match(provenance, /no third-party binary assets/i);
assert.match(provenance, /no binary assets/i);
assert.match(provenance, /64\s*[x×]\s*64/i, "ASSETS.md must record the runtime ground texture dimensions");
const styles = await readFile(path.join(showcase, "styles.css"), "utf8");
assert.doesNotMatch(styles, /url\(|@import|@font-face/, "Gravetide styles must not reference external resources");
const html = await readFile(path.join(showcase, "index.html"), "utf8");
assert.doesNotMatch(html, /https?:\/\//, "Gravetide index.html must not load remote resources");
console.log(JSON.stringify({ ok: true, thirdPartyAssets: 0, authoredAssets: 0, authoredAssetBytes: 0, runtimeTextureBytes: 64 * 64 * 4, scannedFiles: allFiles.length }));
