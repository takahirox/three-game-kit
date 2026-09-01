import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];
const checkedLinks = [];

function fail(message) {
  failures.push(message);
}

function requireMatch(text, pattern, label) {
  if (!pattern.test(text)) fail(`missing ${label}`);
}

function requireAll(text, values, label) {
  for (const value of values) {
    if (!text.includes(value)) fail(`${label}: ${value}`);
  }
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === ".git" || entry.name === "node_modules") continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path));
    else files.push(path);
  }
  return files;
}

function repositoryPath(path) {
  return relative(root, path).split(sep).join("/");
}

function markdownTargets(text) {
  const targets = [];
  const inline = /!?\[[^\]]*\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/g;
  const reference = /^\s*\[[^\]]+\]:\s*(?:<([^>]+)>|(\S+))/gm;
  for (const pattern of [inline, reference]) {
    for (const match of text.matchAll(pattern)) targets.push(match[1] ?? match[2]);
  }
  return targets;
}

async function validateLink(source, rawTarget) {
  if (/^(?:https?:|mailto:)/i.test(rawTarget) || rawTarget.startsWith("#")) return;
  let target = rawTarget.split("#", 1)[0].split("?", 1)[0];
  if (!target) return;
  try {
    target = decodeURIComponent(target);
  } catch {
    fail(`${repositoryPath(source)} has an invalid encoded link: ${rawTarget}`);
    return;
  }
  if (isAbsolute(target)) {
    fail(`${repositoryPath(source)} has an absolute link: ${rawTarget}`);
    return;
  }
  const resolved = resolve(dirname(source), target);
  const rel = relative(root, resolved);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    fail(`${repositoryPath(source)} link escapes the repository: ${rawTarget}`);
    return;
  }
  checkedLinks.push(`${repositoryPath(source)}:${rawTarget}`);
  if (!await exists(resolved)) fail(`${repositoryPath(source)} has a broken link: ${rawTarget}`);
}

if (Number(process.versions.node.split(".")[0]) !== 24) {
  fail(`Node 24 is required, received ${process.versions.node}`);
}

const allFiles = (await walk(root)).sort();
const markdownFiles = allFiles.filter((path) =>
  repositoryPath(path) === "README.md" ||
  repositoryPath(path).endsWith("/README.md") ||
  /^docs\/.+\.md$/.test(repositoryPath(path))
);
const documents = new Map();
for (const path of markdownFiles) documents.set(repositoryPath(path), await readFile(path, "utf8"));

for (const [name, text] of documents) {
  if (/\/Users\//.test(text)) fail(`${name} leaks an absolute /Users/ path`);
  if (/ERR_PNPM/.test(text)) fail(`${name} contains ERR_PNPM text`);
  for (const target of markdownTargets(text)) await validateLink(resolve(root, name), target);
}

const requiredFiles = [
  "docs/m5-verification.md",
  "docs/release-checklist.md",
  "docs/features/foundation-catalog.json",
  "docs/features/client-features.md",
  "docs/features/standard-features.md",
  "docs/features/common-gameplay.md",
  "docs/features/genre-expansion.md",
  "docs/features/advanced-features.md",
  "docs/authoring/client-only-feature.md",
  "docs/authoring/server-only-feature.md",
  "docs/authoring/cross-runtime-interaction.md",
  "docs/architecture/cross-runtime-narrative.md",
  "docs/supported-environments.md",
  "docs/known-limitations.md",
  "docs/ai-workflow.md",
  "docs/architecture/package-map.md",
  "docs/architecture/runtime-scheduling.md",
  "docs/architecture/feature-lifecycle.md",
  "docs/architecture/errors-and-telemetry.md",
  "docs/protocol/mvp.md",
  "docs/features/interaction.md"
];
for (const name of requiredFiles) {
  if (!await exists(resolve(root, name))) fail(`missing required documentation: ${name}`);
}

const readme = documents.get("README.md") ?? "";
for (const name of requiredFiles) {
  const target = `./${name}`;
  if (!markdownTargets(readme).some((link) => link.split("#", 1)[0] === target)) {
    fail(`README.md does not link to ${name}`);
  }
}

const statusFiles = [
  "README.md",
  "docs/milestones.md",
  "docs/supported-environments.md",
  "docs/architecture/package-map.md"
];
const stalePatterns = [
  /Milestone 5 is next/i,
  /through Milestone 2/i,
  /(?:Client|Protocol).{0,60}(?:future work|future milestone|not yet implemented|planned|forthcoming)/i,
  /(?:future work|future milestone|not yet implemented|planned|forthcoming).{0,60}(?:Client|Protocol)/i
];
for (const name of statusFiles) {
  const text = documents.get(name) ?? "";
  for (const pattern of stalePatterns) {
    if (pattern.test(text)) fail(`${name} contains stale milestone status: ${pattern.source}`);
  }
}

const limitations = documents.get("docs/known-limitations.md") ?? "";
const limitationSections = [
  "Environment and browser",
  "Physics, avatar, assets, and animation",
  "WebSocket, protocol, trust, and connection lifecycle",
  "Authority and network presentation",
  "Scheduling and composition",
  "Interaction",
  "Telemetry and performance",
  "Packaging, publication, and license",
  "Deployment and operations",
  "Explicitly deferred presentation capabilities"
];
for (const heading of limitationSections) {
  requireMatch(limitations, new RegExp(`^## ${heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m"), `known-limitations section: ${heading}`);
}
const negativeBoundaries = [
  [/(?:no|not|unsupported|deferred|outside)[^.\n]{0,100}(?:WebXR|\bXR\b)|(?:WebXR|\bXR\b)[^.\n]{0,100}(?:no|not|unsupported|deferred|outside)/i, "negative XR claim"],
  [/(?:no|not|unsupported|absent)[^.\n]{0,100}reconnect|reconnect[^.\n]{0,100}(?:no|not|unsupported|absent)/i, "negative reconnect claim"],
  [/(?:no|not|unsupported|absent)[^.\n]{0,100}(?:production )?auth|(?:production )?auth[^.\n]{0,100}(?:no|not|unsupported|absent)/i, "negative authentication claim"],
  [/(?:no|not|unsupported|absent)[^.\n]{0,100}lockstep|lockstep[^.\n]{0,100}(?:no|not|unsupported|absent)/i, "negative lockstep claim"],
  [/(?:no|not|unsupported|absent|does not)[^.\n]{0,100}(?:packet )?loss|(?:packet )?loss[^.\n]{0,100}(?:no|not|unsupported|absent|does not)/i, "negative loss claim"],
  [/(?:not published|no registry publication|does not claim publication|publication was not performed)/i, "negative publication claim"],
  [/(?:not a production deployment platform|operations remain consumer responsibilities|consumer responsibilities)/i, "negative operations claim"]
];
for (const [pattern, label] of negativeBoundaries) requireMatch(limitations, pattern, label);

const deferredCapability = /\b(WebXR|\bXR\b|reconnect|resume|production authentication|lockstep|packet loss|registry publication|hosted deployment|production operations)\b/i;
const positiveClaim = /\b(?:supports?|provides?|implements?|includes?|ships?|offers?|guarantees?)\b/i;
const negativeClaim = /\b(?:no|not|never|unsupported|exclusion|excluded|absent|deferred|outside|doesn't|does not|without|consumer responsibilit)/i;
for (const [name, text] of documents) {
  for (const markdownBlock of text.split(/\n\s*\n/)) {
    const block = markdownBlock.replace(/\s*\n\s*/g, " ");
    if (deferredCapability.test(block) && positiveClaim.test(block) && !negativeClaim.test(block)) {
      fail(`${name} makes a positive deferred-capability claim: ${block.trim()}`);
    }
  }
}

const packageMap = documents.get("docs/architecture/package-map.md") ?? "";
const publicSpecifiers = [
  "@three-game-kit/core",
  "@three-game-kit/shared",
  "@three-game-kit/shared/gameplay",
  "@three-game-kit/shared/movement",
  "@three-game-kit/shared/genre",
  "@three-game-kit/shared/advanced",
  "@three-game-kit/protocol",
  "@three-game-kit/client",
  "@three-game-kit/client/rendering",
  "@three-game-kit/client/input",
  "@three-game-kit/client/camera",
  "@three-game-kit/client/vfx",
  "@three-game-kit/client/collision",
  "@three-game-kit/client/assets",
  "@three-game-kit/client/asset-manager",
  "@three-game-kit/client/audio",
  "@three-game-kit/client/animation",
  "@three-game-kit/client/character-controller",
  "@three-game-kit/client/gameplay",
  "@three-game-kit/client/genre",
  "@three-game-kit/client/advanced",
  "@three-game-kit/client/networking",
  "@three-game-kit/client/replication",
  "@three-game-kit/server",
  "@three-game-kit/server/collision",
  "@three-game-kit/server/authoritative",
  "@three-game-kit/server/gameplay",
  "@three-game-kit/server/genre",
  "@three-game-kit/server/advanced",
  "@three-game-kit/server/networking"
];
requireAll(packageMap, publicSpecifiers, "package map missing public specifier");
for (const packageName of ["client", "core", "protocol", "server", "shared"]) {
  if (!await exists(resolve(root, `packages/${packageName}/README.md`))) fail(`missing packages/${packageName}/README.md`);
}

const featureDocs = `${documents.get("docs/features/client-features.md") ?? ""}\n${documents.get("docs/features/standard-features.md") ?? ""}\n${documents.get("docs/features/common-gameplay.md") ?? ""}\n${documents.get("docs/features/genre-expansion.md") ?? ""}\n${documents.get("docs/features/advanced-features.md") ?? ""}\n${documents.get("docs/features/interaction.md") ?? ""}`;
requireAll(featureDocs, ["createInputFeature", "createCameraFeature", "createRenderingFeature", "createVfxFeature", "createCollisionFeature", "createAudioFeature", "createCharacterControllerFeature", "createAnimationFeature", "createAssetManagerFeature", "createHudFeature", "createTriggerAreaClientFeature", "createHealthServerFeature", "createSpawnPrefabClientFeature", "createGameFlowServerFeature", "createGeneralPhysicsRuntime", "createProjectileRuntime", "createInventoryRuntime", "createAbilityRuntime", "createSimpleAiRuntime", "createSaveLoadRuntime", "createDialogueRuntime", "createVehicleRuntime", "createPostProcessingRuntime", "createCameraEffectsRuntime", "createInputExperienceRuntime", "createDebugDevToolsRuntime", "Interaction"], "missing documented Feature");

const narrative = documents.get("docs/architecture/cross-runtime-narrative.md") ?? "";
const narrativeTerms = [
  "input", "intent", "prediction", "binding", "validation", "authority", "snapshot",
  "reconciliation", "peer", "presentation", "disconnect", "cleanup", "tests"
];
for (const term of narrativeTerms) requireMatch(narrative, new RegExp(`\\b${term}\\w*\\b`, "i"), `cross-runtime narrative term: ${term}`);
requireMatch(narrative, /^## .*non-networked single-player/im, "non-networked single-player section");
requireMatch(narrative, /non-networked single-player option/i, "explicit non-networked single-player statement");

const packageJson = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
const verifyM5 = packageJson.scripts?.["verify:m5"] ?? "";
requireAll(verifyM5, [
  "typecheck:m2-browser",
  "test:m2-browser",
  "verify:m4",
  "test:m5-catalog",
  "test:m5-release",
  "typecheck:common-gameplay",
  "test:common-gameplay"
  ,"typecheck:genre-expansion"
  ,"test:genre-expansion"
  ,"typecheck:advanced-features"
  ,"test:advanced-features"
], "verify:m5 missing required gate");

const ci = await readFile(resolve(root, ".github/workflows/ci.yml"), "utf8");
const m5Verification = documents.get("docs/m5-verification.md") ?? "";
for (const command of [
  "corepack enable",
  "corepack prepare pnpm@11.24.0 --activate",
  "pnpm install --frozen-lockfile",
  "pnpm exec playwright install --with-deps chromium",
  "pnpm verify:m5"
]) {
  if (!ci.includes(command)) fail(`ci.yml missing command: ${command}`);
  if (!m5Verification.includes(command)) fail(`m5-verification missing CI command: ${command}`);
}
requireMatch(ci, /uses:\s*actions\/upload-artifact@v4/, "CI artifact upload action");
requireMatch(ci, /if:\s*always\(\)/, "unconditional-on-result CI artifact step");
requireMatch(ci, /name:\s*m5-verification-evidence/, "CI artifact name");
requireMatch(ci, /path:\s*test-results/, "CI artifact path");
requireMatch(ci, /if-no-files-found:\s*error/, "CI missing-artifact failure policy");

const releaseChecklist = documents.get("docs/release-checklist.md") ?? "";
const evidenceFields = [
  ["Candidate commit", "to be recorded after the candidate run", /[0-9a-f]{7,40}/i],
  ["GitHub Actions CI run URL", "to be recorded after the candidate run", /https:\/\/[^\s*)]+/i],
  ["Archived CI artifact/evidence URL", "to be recorded after the candidate run", /https:\/\/[^\s*)]+/i]
];
for (const [field, placeholder, concrete] of evidenceFields) {
  const line = releaseChecklist.split("\n").find((candidate) => candidate.includes(`${field}:`));
  if (!line) fail(`release checklist missing evidence field: ${field}`);
  else {
    const value = line.slice(line.indexOf(`${field}:`) + field.length + 1).replace(/[*_`]/g, "").trim();
    if (value !== placeholder && !concrete.test(value)) fail(`invalid release evidence value for ${field}`);
  }
}

if (failures.length) {
  for (const message of failures.sort()) console.error(message);
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({
    markdownFiles: markdownFiles.length,
    links: checkedLinks.length,
    requiredDocuments: requiredFiles.length,
    publicSpecifiers: publicSpecifiers.length,
    features: 27,
    failures: 0
  }));
}
