import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const showcaseRoot = path.join(root, "showcases", "relic-frontier");
const allowed = new Set([
  "@three-game-kit/client",
  "@three-game-kit/client/advanced",
  "@three-game-kit/client/asset-manager",
  "@three-game-kit/client/audio",
  "@three-game-kit/client/camera",
  "@three-game-kit/client/character-controller",
  "@three-game-kit/client/collision",
  "@three-game-kit/client/gameplay",
  "@three-game-kit/client/genre",
  "@three-game-kit/client/input",
  "@three-game-kit/client/rendering",
  "@three-game-kit/client/vfx",
  "@three-game-kit/core",
  "@three-game-kit/shared/advanced",
  "@three-game-kit/shared/gameplay",
  "@three-game-kit/shared/genre",
]);
const pattern = /(?:from\s*|import\s*(?:\(\s*)?)(["'])([^"']+)\1/g;

async function files(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await files(absolute));
    else if ([".ts", ".tsx", ".js", ".mjs"].includes(path.extname(entry.name))) result.push(absolute);
  }
  return result;
}

const violations = [];
for (const file of await files(showcaseRoot)) {
  const source = await readFile(file, "utf8");
  for (const match of source.matchAll(pattern)) {
    const specifier = match[2];
    if (specifier?.startsWith("@three-game-kit/") && !allowed.has(specifier)) violations.push(`${path.relative(root, file)}: undocumented import ${specifier}`);
    if (specifier?.includes("packages/") || specifier?.includes("/src/")) violations.push(`${path.relative(root, file)}: deep framework import ${specifier}`);
  }
}

assert.deepEqual(violations, [], `Relic Frontier must use documented public entrypoints:\n${violations.join("\n")}`);
console.log(`Relic Frontier public-import boundary verified (${allowed.size} entrypoints)`);
