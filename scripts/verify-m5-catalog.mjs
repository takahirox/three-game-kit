import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.join(root, relativePath), "utf8"));
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertObject(value, label) {
  assert.ok(isObject(value), `${label} must be an object`);
}

function assertNonemptyString(value, label) {
  assert.ok(typeof value === "string" && value.trim().length > 0, `${label} must be a nonempty string`);
}

function assertNonemptyStringArray(value, label) {
  assert.ok(Array.isArray(value) && value.length > 0, `${label} must be a nonempty array`);
  for (const item of value) assertNonemptyString(item, `${label} item`);
}

function assertExplicitStringArray(value, label) {
  assert.ok(Array.isArray(value), `${label} must be an array`);
  for (const item of value) assertNonemptyString(item, `${label} item`);
}

async function sourceFilesBelow(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await sourceFilesBelow(entryPath)));
    else if (entry.isFile() && entry.name.endsWith(".ts")) files.push(entryPath);
  }
  return files;
}

const expectedCatalogIds = [
  "animation",
  "asset-manager",
  "audio",
  "character-controller",
  "collision",
  "game-flow",
  "health-damage",
  "interaction",
  "movement-input",
  "spawn-prefab",
  "third-person-camera",
  "three-rendering",
  "trigger-area",
  "ui-hud",
  "vfx",
];
const clientFeatures = new Map([
  ["animation", { factory: "createAnimationFeature", subpath: "animation", source: "packages/client/src/animation.ts", example: "examples/standard-features/main.ts" }],
  ["asset-manager", { factory: "createAssetManagerFeature", subpath: "asset-manager", source: "packages/client/src/asset-manager.ts", example: "examples/standard-features/main.ts" }],
  ["audio", { factory: "createAudioFeature", subpath: "audio", source: "packages/client/src/audio.ts", example: "examples/standard-features/main.ts" }],
  ["character-controller", { factory: "createCharacterControllerFeature", subpath: "character-controller", source: "packages/client/src/character-controller.ts", example: "examples/standard-features/main.ts", publicImports: ["@three-game-kit/client/character-controller", "@three-game-kit/client/collision"] }],
  ["collision", { factory: "createCollisionFeature", subpath: "collision", source: "packages/client/src/collision.ts" }],
  ["game-flow", { factory: "createGameFlowClientFeature", featureId: "game-flow.client", subpath: "gameplay", source: "packages/client/src/gameplay.ts", example: "examples/common-gameplay/main.ts" }],
  ["health-damage", { factory: "createHealthClientFeature", featureId: "health-damage.client", subpath: "gameplay", source: "packages/client/src/gameplay.ts", example: "examples/common-gameplay/main.ts" }],
  ["movement-input", { factory: "createInputFeature", subpath: "input", source: "packages/client/src/input.ts" }],
  ["spawn-prefab", { factory: "createSpawnPrefabClientFeature", featureId: "spawn-prefab.client", subpath: "gameplay", source: "packages/client/src/gameplay.ts", example: "examples/common-gameplay/main.ts" }],
  ["third-person-camera", { factory: "createCameraFeature", subpath: "camera", source: "packages/client/src/camera.ts" }],
  ["three-rendering", { factory: "createRenderingFeature", subpath: "rendering", source: "packages/client/src/rendering.ts" }],
  ["trigger-area", { factory: "createTriggerAreaClientFeature", featureId: "trigger-area.client", subpath: "gameplay", source: "packages/client/src/gameplay.ts", example: "examples/common-gameplay/main.ts" }],
  ["ui-hud", { factory: "createHudFeature", subpath: "gameplay", source: "packages/client/src/gameplay.ts", example: "examples/common-gameplay/main.ts" }],
  ["vfx", { factory: "createVfxFeature", subpath: "vfx", source: "packages/client/src/vfx.ts", example: "showcases/core-run/src/game.ts" }],
]);
const entryKeys = [
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
];

const catalog = await readJson("docs/features/foundation-catalog.json");
assert.deepEqual(Object.keys(catalog), ["schemaVersion", "features"], "foundation catalog keys changed");
assert.equal(catalog.schemaVersion, 1, "foundation catalog schemaVersion must be 1");
assert.ok(Array.isArray(catalog.features), "foundation catalog features must be an array");
assert.equal(catalog.features.length, 15, "foundation catalog must contain exactly fifteen entries");
assert.deepEqual(catalog.features.map(({ catalogId }) => catalogId), expectedCatalogIds, "catalog IDs must be sorted and exact");
assert.equal(new Set(catalog.features.map(({ catalogId }) => catalogId)).size, 15, "catalog IDs must be unique");
for (const feature of catalog.features) {
  assert.deepEqual(Object.keys(feature), entryKeys, `${feature.catalogId} top-level keys changed`);
}

const m4Catalog = await readJson("docs/features/catalog.json");
assert.equal(m4Catalog.schemaVersion, 1, "M4 catalog schemaVersion must be 1");
assert.ok(Array.isArray(m4Catalog.features) && m4Catalog.features.length === 1, "M4 catalog must have one entry");
assert.equal(m4Catalog.features[0].catalogId, "interaction", "M4 catalog entry must be Interaction");
const interaction = catalog.features.find(({ catalogId }) => catalogId === "interaction");
assert.deepEqual(interaction, m4Catalog.features[0], "foundation Interaction must equal the sole M4 entry");

const packageDirectories = ["client", "core", "protocol", "server", "shared"];
const publicSpecifiers = [];
const manifests = new Map();
for (const directory of packageDirectories) {
  const manifest = await readJson(`packages/${directory}/package.json`);
  manifests.set(manifest.name, manifest);
  assertObject(manifest.exports, `${manifest.name} exports`);
  for (const [exportKey, target] of Object.entries(manifest.exports)) {
    assert.ok(exportKey === "." || exportKey.startsWith("./"), `${manifest.name} export key is invalid`);
    assertObject(target, `${manifest.name} ${exportKey} export`);
    const suffix = exportKey === "." ? "" : `/${exportKey.slice(2)}`;
    publicSpecifiers.push(`${manifest.name}${suffix}`);
  }
}
publicSpecifiers.sort();
assert.equal(publicSpecifiers.length, 24, "package manifests must expose exactly 24 public specifiers");
assert.equal(new Set(publicSpecifiers).size, 24, "public package specifiers must be unique");
const publicSpecifierSet = new Set(publicSpecifiers);

const clientManifest = manifests.get("@three-game-kit/client");
const localBrowserSource = await readFile(path.join(root, "examples/local-browser/main.ts"), "utf8");
for (const [featureId, mapping] of clientFeatures) {
  const exportKey = `./${mapping.subpath}`;
  assert.deepEqual(
    clientManifest.exports[exportKey],
    { types: `./dist/${mapping.subpath}.d.ts`, import: `./dist/${mapping.subpath}.js` },
    `${featureId} package export mapping changed`,
  );
  const source = await readFile(path.join(root, mapping.source), "utf8");
  assert.match(source, new RegExp(`export function ${mapping.factory}\\b`, "u"), `${mapping.factory} must be public`);
  const runtimeFeatureId = mapping.featureId ?? featureId;
  assert.match(source, new RegExp(`["']${runtimeFeatureId.replace(".", "\\.")}["']`, "u"), `${mapping.factory} Feature ID changed`);
  const feature = catalog.features.find(({ catalogId }) => catalogId === featureId);
  assert.equal(feature.clientFeatureId, runtimeFeatureId, `${featureId} clientFeatureId changed`);
  if (!["game-flow", "health-damage", "spawn-prefab", "trigger-area", "ui-hud"].includes(featureId)) {
    assert.deepEqual(feature.publicImports, { "@three-game-kit/client": mapping.publicImports ?? [`@three-game-kit/client/${mapping.subpath}`] });
  }
  const exampleSource = mapping.example === undefined
    ? localBrowserSource
    : await readFile(path.join(root, mapping.example), "utf8");
  assert.match(exampleSource, new RegExp(`from ["']@three-game-kit/client/${mapping.subpath}["']`, "u"), `${featureId} example must import ${mapping.subpath}`);
  assert.match(exampleSource, new RegExp(`\\b${mapping.factory}\\s*\\(`, "u"), `${featureId} example must use ${mapping.factory}`);
}

const commonGameplayMappings = [
  ["game-flow", "createGameFlowRuntime", "createGameFlowServerFeature", "game-flow.server"],
  ["health-damage", "createHealthRuntime", "createHealthServerFeature", "health-damage.server"],
  ["spawn-prefab", "createSpawnPrefabRuntime", "createSpawnPrefabServerFeature", "spawn-prefab.server"],
  ["trigger-area", "createTriggerAreaRuntime", "createTriggerAreaServerFeature", "trigger-area.server"],
  ["ui-hud", "createHudStateStore", null, "not-applicable"],
];
const sharedGameplaySource = await readFile(path.join(root, "packages/shared/src/gameplay.ts"), "utf8");
const serverGameplaySource = await readFile(path.join(root, "packages/server/src/gameplay.ts"), "utf8");
const serverGameplayTest = await readFile(path.join(root, "packages/server/test/gameplay.test.mjs"), "utf8");
for (const [catalogId, sharedFactory, serverFactory, serverFeatureId] of commonGameplayMappings) {
  const feature = catalog.features.find((entry) => entry.catalogId === catalogId);
  assert.match(sharedGameplaySource, new RegExp(`export function ${sharedFactory}\\b`, "u"), `${sharedFactory} must be public`);
  assert.equal(feature.serverFeatureId, serverFeatureId, `${catalogId} serverFeatureId changed`);
  assert.ok(feature.publicImports["@three-game-kit/shared"].includes("@three-game-kit/shared/gameplay"), `${catalogId} must list Shared gameplay`);
  if (serverFactory !== null) {
    assert.match(serverGameplaySource, new RegExp(`export function ${serverFactory}\\b`, "u"), `${serverFactory} must be public`);
    assert.match(serverGameplaySource, new RegExp(`["']${serverFeatureId.replace(".", "\\.")}["']`, "u"), `${serverFactory} Feature ID changed`);
    assert.match(serverGameplayTest, new RegExp(`\\b${serverFactory}\\s*\\(`, "u"), `${serverFactory} must have an external-style server test`);
    assert.ok(feature.publicImports["@three-game-kit/server"].includes("@three-game-kit/server/gameplay"), `${catalogId} must list Server gameplay`);
  }
}

for (const feature of catalog.features) {
  assertNonemptyString(feature.purpose, `${feature.catalogId} purpose`);
  assertNonemptyString(feature.ownership, `${feature.catalogId} ownership`);
  assertNonemptyStringArray(feature.runtimes, `${feature.catalogId} runtimes`);
  assertObject(feature.configuration, `${feature.catalogId} configuration`);
  assert.ok(Object.keys(feature.configuration).length > 0, `${feature.catalogId} configuration must be nonempty`);
  assertObject(feature.lifecycle, `${feature.catalogId} lifecycle`);
  assert.ok(Object.keys(feature.lifecycle).length > 0, `${feature.catalogId} lifecycle must be nonempty`);
  assertNonemptyStringArray(feature.limitations, `${feature.catalogId} limitations`);
  assert.equal(feature.compatibilityRange, "^0.1.0", `${feature.catalogId} compatibilityRange changed`);

  assertObject(feature.phases, `${feature.catalogId} phases`);
  assert.deepEqual(Object.keys(feature.phases), ["server", "clientSimulation", "clientPresentation"], `${feature.catalogId} phase keys changed`);
  assertExplicitStringArray(feature.phases.server, `${feature.catalogId} server phases`);
  assertExplicitStringArray(feature.phases.clientSimulation, `${feature.catalogId} client simulation phases`);
  assertExplicitStringArray(feature.phases.clientPresentation, `${feature.catalogId} client presentation phases`);

  assertObject(feature.authority, `${feature.catalogId} authority`);
  assert.deepEqual(Object.keys(feature.authority), ["owner", "intent", "validation", "rejectionReasons"], `${feature.catalogId} authority keys changed`);
  assertNonemptyString(feature.authority.owner, `${feature.catalogId} authority owner`);
  assertNonemptyString(feature.authority.intent, `${feature.catalogId} authority intent`);
  assertNonemptyStringArray(feature.authority.validation, `${feature.catalogId} authority validation`);
  assertNonemptyStringArray(feature.authority.rejectionReasons, `${feature.catalogId} rejection reasons`);

  assertObject(feature.publicImports, `${feature.catalogId} publicImports`);
  assert.ok(Object.keys(feature.publicImports).length > 0, `${feature.catalogId} publicImports must be nonempty`);
  for (const [packageName, imports] of Object.entries(feature.publicImports)) {
    assertNonemptyStringArray(imports, `${feature.catalogId} ${packageName} publicImports`);
    for (const specifier of imports) {
      assert.ok(publicSpecifierSet.has(specifier), `${feature.catalogId} references non-public import ${specifier}`);
    }
  }

  assertNonemptyStringArray(feature.examplePaths, `${feature.catalogId} examplePaths`);
  for (const examplePath of feature.examplePaths) {
    const resolved = path.resolve(root, examplePath);
    const relative = path.relative(root, resolved);
    assert.ok(relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative), `${examplePath} escapes the repository`);
    assert.ok((await stat(resolved)).isFile(), `${examplePath} must be an existing file`);
  }

  const expectedCommand = ["game-flow", "health-damage", "spawn-prefab", "trigger-area", "ui-hud"].includes(feature.catalogId)
    ? "pnpm verify:common-gameplay"
    : feature.catalogId === "interaction"
    ? "pnpm test:m4-packed-consumer"
    : ["animation", "asset-manager", "audio", "character-controller"].includes(feature.catalogId)
      ? "pnpm verify:standard-features"
      : "pnpm verify:m2";
  assert.equal(feature.verificationCommand, expectedCommand, `${feature.catalogId} verificationCommand changed`);

  if (!["interaction", "game-flow", "health-damage", "spawn-prefab", "trigger-area"].includes(feature.catalogId)) {
    assert.deepEqual(feature.runtimes, ["client"], `${feature.catalogId} must be client-only`);
    assert.equal(feature.serverFeatureId, "not-applicable", `${feature.catalogId} serverFeatureId must be explicit`);
    assert.deepEqual(feature.requires.server, [], `${feature.catalogId} server requirements must be empty`);
    assert.deepEqual(feature.phases.server, [], `${feature.catalogId} server phases must be empty`);
    assert.equal(feature.authority.owner, "not-applicable", `${feature.catalogId} authority owner must be not-applicable`);
    assert.deepEqual(feature.authority.validation, ["not-applicable"], `${feature.catalogId} validation must be not-applicable`);
    assert.deepEqual(feature.authority.rejectionReasons, ["not-applicable"], `${feature.catalogId} must not invent protocol rejection codes`);
  }
}

assert.equal(interaction.ownership, "consumer-owned", "Interaction must remain consumer-owned");
const interactionSourcePath = "examples/external-interaction-consumer/src/interaction-feature.ts";
assert.ok(interaction.examplePaths.includes(interactionSourcePath), "Interaction must list its consumer-owned factory source");
const interactionSource = await readFile(path.join(root, interactionSourcePath), "utf8");
for (const factory of ["createExternalServerInteractionFeature", "createExternalClientInteractionFeature"]) {
  assert.match(interactionSource, new RegExp(`export function ${factory}\\b`, "u"), `${factory} must remain in the consumer example`);
}
const packageSources = [];
for (const directory of packageDirectories) packageSources.push(...(await sourceFilesBelow(path.join(root, "packages", directory, "src"))));
for (const sourcePath of packageSources) {
  const source = await readFile(sourcePath, "utf8");
  assert.doesNotMatch(source, /createExternal(?:Server|Client)InteractionFeature/u, `${path.relative(root, sourcePath)} must not own Interaction factories`);
}

const listedFeatureIds = catalog.features.flatMap((feature) =>
  [feature.serverFeatureId, feature.clientFeatureId].filter((id) => id !== "not-applicable"),
);
assert.deepEqual(
  [...listedFeatureIds].sort(),
  ["animation", "asset-manager", "audio", "character-controller", "collision", "external.interaction.client", "external.interaction.server", "game-flow.client", "game-flow.server", "health-damage.client", "health-damage.server", "movement-input", "spawn-prefab.client", "spawn-prefab.server", "third-person-camera", "three-rendering", "trigger-area.client", "trigger-area.server", "ui-hud", "vfx"],
  "all public Feature IDs must be covered exactly once",
);
assert.equal(new Set(listedFeatureIds).size, listedFeatureIds.length, "public Feature IDs must not be duplicated");
assert.match(interactionSource, /const SERVER_FEATURE_ID\s*=\s*["']external\.interaction\.server["']/u);
assert.match(interactionSource, /const CLIENT_FEATURE_ID\s*=\s*["']external\.interaction\.client["']/u);

process.stdout.write(`${JSON.stringify({
  ok: true,
  schemaVersion: catalog.schemaVersion,
  features: catalog.features.length,
  publicSpecifiers: publicSpecifiers.length,
  publicFeatureIds: listedFeatureIds.length,
  examples: catalog.features.reduce((count, feature) => count + feature.examplePaths.length, 0),
})}\n`);
