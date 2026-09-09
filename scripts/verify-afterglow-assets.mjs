import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const showcase = path.join(root, "showcases", "afterglow");
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
assert.deepEqual(assets, [], `Afterglow is an asset-free showcase; new binary assets require provenance and intake measurements:\n${assets.join("\n")}`);
const provenance = await readFile(path.join(showcase, "ASSETS.md"), "utf8");
assert.match(provenance, /no third-party binary assets/i);
assert.match(provenance, /no binary assets/i);
const styles = await readFile(path.join(showcase, "styles.css"), "utf8");
assert.doesNotMatch(styles, /url\(|@import|@font-face/, "Afterglow styles must not reference external resources");
const html = await readFile(path.join(showcase, "index.html"), "utf8");
assert.doesNotMatch(html, /https?:\/\//, "Afterglow index.html must not load remote resources");
console.log(JSON.stringify({ ok: true, thirdPartyAssets: 0, authoredAssets: 0, authoredAssetBytes: 0, scannedFiles: allFiles.length }));
