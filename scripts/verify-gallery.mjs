import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { galleryCovers } from "./lib/gallery-covers.mjs";

const root = new URL("../", import.meta.url);
const html = await readFile(new URL("index.html", root), "utf8");
const cards = [...html.matchAll(/<a\b([^>]*\bdata-cover="([^"]+)"[^>]*)>/g)];
const required = ["craftlands", "relic-frontier", "chroma-strike", "gravetide", "afterglow", "deepfield", "core-run", "particle-atlas"];
assert.deepEqual(cards.map(card => card[2]).sort(), required.sort(), "Each required showcase needs exactly one card");
assert.deepEqual(galleryCovers.map(cover => cover.id).sort(), required, "Each required showcase needs a capture recipe");
let totalBytes = 0;
for (const { id, path } of galleryCovers) {
  const card = cards.find(card => card[2] === id);
  assert.equal(card[1].match(/\bhref="([^"]+)"/)?.[1], `./${path}`, `${id}: use a relative playable link`);
  assert((await stat(new URL(path, root))).isFile(), `${id}: playable entry must exist`);
  for (const width of [640, 1280]) {
    const asset = `./gallery/covers/${id}-${width}.webp`;
    assert(html.includes(asset), `${id}: missing ${width}px image reference`);
    const data = await readFile(new URL(asset, root));
    assert.equal(data.toString("ascii", 0, 4), "RIFF", `${asset}: WebP container`);
    assert.equal(data.toString("ascii", 8, 12), "WEBP", `${asset}: WebP format`);
    assert(data.length <= (width === 640 ? 80 : 256) * 1024, `${asset}: exceeds image size budget`);
    totalBytes += data.length;
  }
}
assert(totalBytes <= 1024 * 1024, "Responsive cover inventory must stay below 1 MiB");
assert(!/<script\b/i.test(html), "The landing page must not need runtime JavaScript");
assert(!/\b(?:src|srcset)="(?:https?:)?\/\//i.test(html), "Gallery media must stay local");
console.log(`Gallery verified: ${cards.length} playable links, 16 WebP covers, ${(totalBytes / 1024).toFixed(1)} KiB total.`);
