import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.join(root, relativePath), "utf8"));
}

function assertExactKeys(value, expected, label) {
  assert.ok(value !== null && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  assert.deepEqual(Object.keys(value), expected, `${label} keys changed`);
}

async function typescriptFilesBelow(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await typescriptFilesBelow(entryPath)));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      files.push(entryPath);
    }
  }
  return files;
}

const catalog = await readJson("docs/features/catalog.json");
assertExactKeys(catalog, ["schemaVersion", "features"], "catalog");
assert.equal(catalog.schemaVersion, 1, "catalog schemaVersion must be 1");
assert.ok(Array.isArray(catalog.features), "catalog features must be an array");
assert.equal(catalog.features.length, 1, "catalog must contain exactly one feature");

const feature = catalog.features[0];
assertExactKeys(
  feature,
  [
    "catalogId",
    "serverFeatureId",
    "clientFeatureId",
    "purpose",
    "ownership",
    "runtimes",
    "requires",
    "conflicts",
    "configuration",
    "phases",
    "authority",
    "lifecycle",
    "limitations",
    "compatibilityRange",
    "publicImports",
    "examplePaths",
    "verificationCommand",
  ],
  "catalog feature",
);
assert.equal(feature.catalogId, "interaction");
assert.equal(feature.serverFeatureId, "external.interaction.server");
assert.equal(feature.clientFeatureId, "external.interaction.client");
assert.equal(feature.ownership, "consumer-owned");
assert.deepEqual(feature.runtimes, ["server", "client"]);
assert.deepEqual(feature.requires, {
  server: ["host.server-authority"],
  client: ["host.client-session"],
});
assert.deepEqual(feature.conflicts, ["external.interaction.alternative"]);
assertExactKeys(
  feature.configuration,
  ["targetEntityId", "position", "range", "initialActive", "forceSetupFailure"],
  "feature configuration",
);
assertExactKeys(feature.phases, ["server", "clientSimulation", "clientPresentation"], "feature phases");
assert.deepEqual(feature.phases.server, ["validate-bind", "gameplay", "snapshot-build"]);
assert.equal(feature.compatibilityRange, "^0.1.0");
assert.equal(feature.verificationCommand, "pnpm test:m4-packed-consumer");
assert.ok(
  Array.isArray(feature.authority?.validation) &&
    feature.authority.validation.length > 0 &&
    feature.authority.validation.every((item) => typeof item === "string" && item.trim().length > 0),
  "authority validation must contain nonempty strings",
);
assert.ok(
  Array.isArray(feature.limitations) &&
    feature.limitations.length > 0 &&
    feature.limitations.every((item) => typeof item === "string" && item.trim().length > 0),
  "limitations must contain nonempty strings",
);

const packageDirectories = ["core", "shared", "protocol", "client", "server"];
const expectedPublicSpecifiers = [
  "@three-game-kit/client",
  "@three-game-kit/client/assets",
  "@three-game-kit/client/camera",
  "@three-game-kit/client/collision",
  "@three-game-kit/client/input",
  "@three-game-kit/client/networking",
  "@three-game-kit/client/rendering",
  "@three-game-kit/client/replication",
  "@three-game-kit/client/vfx",
  "@three-game-kit/core",
  "@three-game-kit/protocol",
  "@three-game-kit/server",
  "@three-game-kit/server/authoritative",
  "@three-game-kit/server/collision",
  "@three-game-kit/server/networking",
  "@three-game-kit/shared",
  "@three-game-kit/shared/movement",
];
const publicSpecifiers = [];
for (const directory of packageDirectories) {
  const manifest = await readJson(`packages/${directory}/package.json`);
  assert.ok(manifest.exports !== null && typeof manifest.exports === "object", `${manifest.name} exports must be an object`);
  for (const exportName of Object.keys(manifest.exports)) {
    assert.ok(exportName === "." || exportName.startsWith("./"), `${manifest.name} has an invalid export key`);
    publicSpecifiers.push(exportName === "." ? manifest.name : `${manifest.name}/${exportName.slice(2)}`);
  }
}
publicSpecifiers.sort();
assert.deepEqual(publicSpecifiers, expectedPublicSpecifiers, "public kit specifiers changed");
assert.equal(new Set(publicSpecifiers).size, 17, "public kit specifiers must be unique");

assertExactKeys(
  feature.publicImports,
  [
    "@three-game-kit/core",
    "@three-game-kit/protocol",
    "@three-game-kit/shared",
    "@three-game-kit/client",
    "@three-game-kit/server",
  ],
  "feature publicImports",
);
const publicSpecifierSet = new Set(publicSpecifiers);
for (const [packageName, imports] of Object.entries(feature.publicImports)) {
  assert.ok(Array.isArray(imports) && imports.length > 0, `${packageName} publicImports must be nonempty`);
  for (const specifier of imports) {
    assert.equal(typeof specifier, "string", `${packageName} public import must be a string`);
    assert.ok(publicSpecifierSet.has(specifier), `catalog references non-public import ${specifier}`);
  }
}

assert.ok(Array.isArray(feature.examplePaths) && feature.examplePaths.length > 0, "examplePaths must be nonempty");
for (const examplePath of feature.examplePaths) {
  assert.equal(typeof examplePath, "string", "examplePath must be a string");
  const resolved = path.resolve(root, examplePath);
  const relative = path.relative(root, resolved);
  assert.ok(relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative), `${examplePath} escapes the repository root`);
  assert.ok((await stat(resolved)).isFile(), `${examplePath} must be a file`);
}

const consumer = await readJson("examples/external-interaction-consumer/package.json");
const dependencySections = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];
const kitDependencies = [];
for (const section of dependencySections) {
  const dependencies = consumer[section] ?? {};
  assert.ok(dependencies !== null && typeof dependencies === "object" && !Array.isArray(dependencies), `${section} must be an object`);
  for (const [name, value] of Object.entries(dependencies)) {
    assert.equal(typeof value, "string", `${name} dependency value must be a string`);
    if (name.startsWith("@three-game-kit/")) kitDependencies.push([name, value, section]);
  }
}
assert.deepEqual(
  kitDependencies.map(([name]) => name).sort(),
  [
    "@three-game-kit/client",
    "@three-game-kit/core",
    "@three-game-kit/protocol",
    "@three-game-kit/server",
    "@three-game-kit/shared",
  ],
  "consumer must have exactly five kit dependencies",
);
for (const [name, value, section] of kitDependencies) {
  assert.equal(section, "dependencies", `${name} must be a runtime dependency`);
  assert.equal(value, "^0.1.0", `${name} must use the packed compatibility range`);
  assert.doesNotMatch(value, /^(?:workspace|link|file):/u, `${name} must not use a local dependency protocol`);
}

const workspace = await readFile(path.join(root, "pnpm-workspace.yaml"), "utf8");
assert.doesNotMatch(
  workspace,
  /(?:^|\n)\s*-\s*(?:\.\/)?examples\/external-interaction-consumer\/?\s*(?:\n|$)/u,
  "the external consumer fixture must be excluded from the pnpm workspace",
);

const forbiddenCorePatterns = [
  ["ClientInteractIntent", /\bClientInteractIntent\b/u],
  ["AuthoritativeInteractionAdapter", /\bAuthoritativeInteractionAdapter\b/u],
  ["createExternalServerInteractionFeature", /\bcreateExternalServerInteractionFeature\b/u],
  ["external.interaction", /external\.interaction/u],
];
const coreFiles = await typescriptFilesBelow(path.join(root, "packages/core/src"));
assert.ok(coreFiles.length > 0, "packages/core/src must contain TypeScript sources");
for (const file of coreFiles) {
  const source = await readFile(file, "utf8");
  for (const [symbol, pattern] of forbiddenCorePatterns) {
    assert.doesNotMatch(source, pattern, `${path.relative(root, file)} contains forbidden ${symbol} implementation`);
  }
}

process.stdout.write(`${JSON.stringify({
  ok: true,
  schemaVersion: catalog.schemaVersion,
  features: catalog.features.length,
  publicSpecifiers: publicSpecifiers.length,
  examples: feature.examplePaths.length,
  consumerKitDependencies: kitDependencies.length,
  coreFiles: coreFiles.length,
})}\n`);
