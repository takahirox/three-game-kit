import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, realpath, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageDirectories = ["core", "protocol", "shared", "client", "server"];
const descriptions = {
  core: "Core game primitives and runtime utilities for Three Game Kit.",
  protocol: "Validated network protocol schemas and message types for Three Game Kit.",
  shared: "Shared game logic and movement utilities for Three Game Kit.",
  client:
    "Browser client runtime, rendering, input, camera, collision, assets, networking, and replication for Three Game Kit.",
  server:
    "Authoritative multiplayer server, collision, and networking utilities for Three Game Kit.",
};
const repository = {
  type: "git",
  url: "git+https://github.com/takahirox/three-game-kit.git",
};
const temporaryPrefix = path.join(os.tmpdir(), "three-game-kit-m5-release-");
const dependencySections = [
  "dependencies",
  "optionalDependencies",
  "peerDependencies",
  "devDependencies",
];
const forbiddenSegments = new Set([
  "src",
  "test",
  "tests",
  "fixture",
  "fixtures",
  "node_modules",
]);
let temporaryDirectory;

assert.equal(process.versions.node.split(".")[0], "24", "verification requires Node 24");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? root,
    encoding: "utf8",
    env: process.env,
    maxBuffer: 16 * 1024 * 1024,
    shell: false,
  });
  assert.equal(result.error, undefined, `${command} could not start: ${result.error?.message}`);
  assert.equal(result.signal, null, `${command} ${args.join(" ")} terminated by ${result.signal}`);
  assert.equal(
    result.status,
    0,
    [
      `${command} ${args.join(" ")} failed with status ${result.status}`,
      result.stdout.trim(),
      result.stderr.trim(),
    ]
      .filter(Boolean)
      .join("\n"),
  );
  return result.stdout;
}

function parsePackArtifact(stdout, destination) {
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch (error) {
    assert.fail(`pnpm pack did not return JSON: ${error.message}\n${stdout}`);
  }
  const records = Array.isArray(parsed) ? parsed : [parsed];
  assert.equal(records.length, 1, "pnpm pack returned an unexpected artifact count");
  const filename = records[0]?.filename ?? records[0]?.path;
  assert.equal(typeof filename, "string", "pnpm pack JSON lacks an artifact filename");
  const artifact = path.resolve(destination, filename);
  assert.equal(path.dirname(artifact), destination, `pack artifact escaped destination: ${artifact}`);
  assert.match(path.basename(artifact), /\.tgz$/u, `unexpected pack artifact: ${artifact}`);
  return artifact;
}

function archiveEntries(tarball) {
  const entries = run("tar", ["-tf", tarball])
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((raw) => ({
      directory: raw.endsWith("/"),
      name: raw.replace(/^\.\//u, "").replace(/\/$/u, ""),
    }));
  assert.ok(entries.length > 0, `${tarball} is empty`);
  assert.equal(
    new Set(entries.map(({ name }) => name)).size,
    entries.length,
    `${tarball} contains duplicate entries`,
  );
  return entries;
}

function extractFile(tarball, entries, name) {
  const entry = entries.find((candidate) => candidate.name === name);
  assert.ok(entry, `${tarball} lacks ${name}`);
  assert.equal(entry.directory, false, `${tarball} contains a directory where a file is required: ${name}`);
  return run("tar", ["-xOf", tarball, name]);
}

function assertNoWorkspaceStrings(value, location = "package.json") {
  if (typeof value === "string") {
    assert.doesNotMatch(value, /workspace:/iu, `${location} contains a workspace string`);
  } else if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoWorkspaceStrings(item, `${location}[${index}]`));
  } else if (value !== null && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      assertNoWorkspaceStrings(item, `${location}.${key}`);
    }
  }
}

function assertDependencies(manifest) {
  for (const section of dependencySections) {
    const dependencies = manifest[section] ?? {};
    assert.equal(typeof dependencies, "object", `${manifest.name}.${section} must be an object`);
    for (const [name, specifier] of Object.entries(dependencies)) {
      assert.equal(typeof specifier, "string", `${manifest.name}.${section}.${name} must be a string`);
      assert.doesNotMatch(
        specifier,
        /^(?:file:|link:|workspace:|portal:|patch:|\.\.?[/\\]|[/\\]|[A-Za-z]:[/\\])/iu,
        `${manifest.name}.${section}.${name} uses a local or absolute dependency specifier`,
      );
      if (name.startsWith("@three-game-kit/")) {
        assert.equal(
          specifier,
          "^0.1.0",
          `${manifest.name}.${section}.${name} was not compatibly rewritten`,
        );
      }
    }
  }
}

function assertExportTarget(target, extension, manifest, archiveFiles) {
  assert.equal(typeof target, "string", `${manifest.name} has a non-string export target`);
  assert.match(
    target,
    new RegExp(`^\\./dist/(?:[^/]+/)*[^/]+\\.${extension.replaceAll(".", "\\.")}$`, "u"),
    `${manifest.name} has an invalid export target: ${target}`,
  );
  assert.doesNotMatch(target, /\\/u, `${manifest.name} export target contains a backslash: ${target}`);
  const segments = target.slice(2).split("/");
  assert.ok(
    segments.every((segment) => segment !== "." && segment !== ".."),
    `${manifest.name} export target contains a dot segment: ${target}`,
  );
  const relative = target.slice(2);
  assert.ok(archiveFiles.has(`package/${relative}`), `${manifest.name} lacks exported file ${relative}`);
  assert.ok(archiveFiles.has(`package/${relative}.map`), `${manifest.name} lacks map for ${relative}`);
}

function inspectTarball(tarball, directory) {
  const entries = archiveEntries(tarball);
  const archiveFiles = new Set(
    entries.filter(({ directory: isDirectory }) => !isDirectory).map(({ name }) => name),
  );
  const manifestEntry = "package/package.json";
  const manifest = JSON.parse(extractFile(tarball, entries, manifestEntry));
  const expectedName = `@three-game-kit/${directory}`;

  assert.equal(manifest.name, expectedName);
  assert.equal(manifest.version, "0.1.0");
  assert.equal(manifest.description, descriptions[directory]);
  assert.equal(manifest.type, "module");
  assert.equal(manifest.sideEffects, false);
  assert.deepEqual(manifest.engines, { node: "24.x" });
  assert.deepEqual(manifest.repository, repository);
  assert.equal(manifest.license, "UNLICENSED");
  for (const field of ["main", "module", "browser", "bin", "bins"]) {
    assert.ok(!Object.hasOwn(manifest, field), `${manifest.name} contains forbidden field ${field}`);
  }
  assertNoWorkspaceStrings(manifest);
  assertDependencies(manifest);

  let exports = 0;
  assert.equal(typeof manifest.exports, "object", `${manifest.name} lacks exports`);
  for (const [key, target] of Object.entries(manifest.exports)) {
    assert.ok(key === "." || /^\.\/[A-Za-z0-9_-]+$/u.test(key), `${manifest.name} has invalid export ${key}`);
    assert.deepEqual(Object.keys(target).sort(), ["import", "types"], `${manifest.name} export ${key} is not public ESM`);
    assertExportTarget(target.import, "js", manifest, archiveFiles);
    assertExportTarget(target.types, "d.ts", manifest, archiveFiles);
    exports += 1;
  }
  assert.ok(exports > 0, `${manifest.name} has no exports`);

  assert.ok(archiveFiles.has("package/README.md"), `${manifest.name} lacks README.md`);
  assert.ok(archiveFiles.has(manifestEntry), `${manifest.name} lacks package.json`);
  for (const entry of entries) {
    assert.ok(entry.name === "package" || entry.name.startsWith("package/"), `entry escaped package/: ${entry.name}`);
    if (entry.name === "package") continue;
    const relative = entry.name.slice("package/".length);
    const segments = relative.split("/");
    const lowerSegments = segments.map((segment) => segment.toLowerCase());
    assert.ok(
      !lowerSegments.some((segment) => forbiddenSegments.has(segment)),
      `${manifest.name} contains forbidden entry ${relative}`,
    );
    assert.ok(
      !lowerSegments.some((segment) => segment.startsWith("tsconfig") || segment.includes("workspace")),
      `${manifest.name} contains forbidden entry ${relative}`,
    );
    assert.ok(
      ["README.md", "package.json", "dist"].includes(segments[0]),
      `${manifest.name} contains unlisted top-level entry ${relative}`,
    );
    if (!entry.directory && segments[0] === "dist") {
      assert.match(
        relative,
        /^dist\/(?:.+\/)*[^/]+\.(?:js|js\.map|d\.ts|d\.ts\.map)$/u,
        `${manifest.name} contains unexpected dist file ${relative}`,
      );
    }
  }
  return { exports, files: archiveFiles.size };
}

try {
  const created = await mkdtemp(temporaryPrefix);
  temporaryDirectory = await realpath(created);
  assert.equal(path.dirname(temporaryDirectory), await realpath(os.tmpdir()), "temporary directory escaped OS tmpdir");
  assert.ok(
    path.basename(temporaryDirectory).startsWith(path.basename(temporaryPrefix)),
    "temporary directory has an unexpected name",
  );

  const tarballs = [];
  for (const directory of packageDirectories) {
    const packageDirectory = path.join(root, "packages", directory);
    const before = new Set(await readdir(temporaryDirectory));
    const stdout = run("pnpm", ["pack", "--json", "--pack-destination", temporaryDirectory], {
      cwd: packageDirectory,
    });
    const artifact = parsePackArtifact(stdout, temporaryDirectory);
    const added = (await readdir(temporaryDirectory)).filter((entry) => !before.has(entry));
    assert.deepEqual(added, [path.basename(artifact)], `${directory} produced unexpected artifacts`);
    tarballs.push({ artifact, directory });
  }

  const artifacts = (await readdir(temporaryDirectory)).filter((entry) => entry.endsWith(".tgz"));
  assert.equal(artifacts.length, 5, "release audit requires exactly five tarballs");
  assert.deepEqual(
    artifacts.sort(),
    tarballs.map(({ artifact }) => path.basename(artifact)).sort(),
    "temporary directory contains missing or extra tarballs",
  );

  let files = 0;
  let exports = 0;
  for (const { artifact, directory } of tarballs) {
    const counts = inspectTarball(artifact, directory);
    files += counts.files;
    exports += counts.exports;
  }
  process.stdout.write(`${JSON.stringify({ packages: 5, tarballs: 5, files, exports })}\n`);
} finally {
  if (temporaryDirectory !== undefined) {
    const resolved = path.resolve(temporaryDirectory);
    assert.equal(resolved, temporaryDirectory, "refusing to clean a non-canonical path");
    assert.equal(path.dirname(resolved), await realpath(os.tmpdir()), "refusing to clean outside OS tmpdir");
    assert.ok(
      path.basename(resolved).startsWith(path.basename(temporaryPrefix)),
      "refusing to clean an unexpected path",
    );
    await rm(resolved, { recursive: true, force: false });
  }
}
