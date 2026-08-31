import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const showcaseRoot = path.join(root, "showcases", "core-run");
const allowedPackageImports = new Set([
  "@three-game-kit/client",
  "@three-game-kit/client/camera",
  "@three-game-kit/client/collision",
  "@three-game-kit/client/input",
  "@three-game-kit/client/rendering",
  "@three-game-kit/client/vfx",
  "@three-game-kit/core",
  "@three-game-kit/shared/movement",
]);
const sourceExtensions = new Set([".ts", ".tsx", ".js", ".mjs"]);
const importPattern =
  /(?:from\s*|import\s*(?:\(\s*)?)(["'])([^"']+)\1/g;

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await sourceFiles(absolute)));
    else if (sourceExtensions.has(path.extname(entry.name))) files.push(absolute);
  }
  return files;
}

const violations = [];
for (const file of await sourceFiles(showcaseRoot)) {
  const source = await readFile(file, "utf8");
  for (const match of source.matchAll(importPattern)) {
    const specifier = match[2];
    if (specifier === undefined) continue;
    if (specifier.startsWith("@three-game-kit/")) {
      if (!allowedPackageImports.has(specifier)) {
        violations.push(`${path.relative(root, file)}: undocumented package import ${specifier}`);
      }
      continue;
    }
    if (specifier.includes("packages/") || specifier.includes("/src/")) {
      violations.push(`${path.relative(root, file)}: deep framework import ${specifier}`);
    }
  }
}

assert.deepEqual(
  violations,
  [],
  `Core Run must use documented public package entrypoints:\n${violations.join("\n")}`,
);
console.log("Core Run public-import boundary verified");
