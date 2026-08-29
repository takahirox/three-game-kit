import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixture = path.join(root, "examples", "external-interaction-consumer");
const packageDirectories = ["core", "protocol", "shared", "client", "server"];
const packageNames = packageDirectories.map((name) => `@three-game-kit/${name}`);
const temporaryPrefix = path.join(os.tmpdir(), "three-game-kit-m4-packed-");
const importPattern = /(?:\bfrom\s*|\bimport\s*\(|\bimport\s*)["']([^"']+)["']/gu;
let temporaryDirectory;

assert.equal(process.versions.node.split(".")[0], "24", "verification requires Node 24");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? root,
    encoding: "utf8",
    env: options.env ?? process.env,
    maxBuffer: 16 * 1024 * 1024,
    shell: false,
  });
  assert.equal(result.error, undefined, `${command} could not start: ${result.error?.message}`);
  assert.equal(
    result.signal,
    null,
    `${command} ${args.join(" ")} terminated by ${result.signal}`,
  );
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
  return { stdout: result.stdout, stderr: result.stderr };
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

async function filesBelow(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await filesBelow(entryPath)));
    } else if (entry.isFile()) {
      files.push(entryPath);
    } else {
      assert.fail(`fixture contains unsupported filesystem entry: ${entryPath}`);
    }
  }
  return files;
}

function packageNameFromSpecifier(specifier) {
  if (!specifier.startsWith("@three-game-kit/")) return undefined;
  return specifier.split("/").slice(0, 2).join("/");
}

function exportKeyFor(packageName, specifier) {
  return specifier === packageName ? "." : `.${specifier.slice(packageName.length)}`;
}

function assertNoWorkspaceReferences(value, location = "package.json") {
  if (typeof value === "string") {
    assert.doesNotMatch(value, /^(?:workspace:|link:)/u, `${location} contains ${value}`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoWorkspaceReferences(item, `${location}[${index}]`));
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      assertNoWorkspaceReferences(item, `${location}.${key}`);
    }
  }
}

function matchesDeclaredFile(file, patterns) {
  return patterns.some((pattern) => {
    if (pattern === "README.md") return file === "README.md";
    assert.match(
      pattern,
      /^dist\/\*\*\/\*\.(?:js|js\.map|d\.ts|d\.ts\.map)$/u,
      `unsupported package files pattern: ${pattern}`,
    );
    const extension = pattern.slice("dist/**/*".length);
    return file.startsWith("dist/") && file.endsWith(extension);
  });
}

function tarEntries(tarball) {
  const { stdout } = run("tar", ["-tf", tarball]);
  const entries = stdout
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((entry) => entry.replace(/^\.\//u, "").replace(/\/$/u, ""));
  assert.ok(entries.length > 0, `${tarball} is empty`);
  assert.equal(new Set(entries).size, entries.length, `${tarball} contains duplicate entries`);
  return entries.sort();
}

function inspectTarball(tarball, manifest) {
  const entries = tarEntries(tarball);
  const files = entries.filter((entry) => entry !== "package");
  assert.ok(files.includes("package/package.json"), `${tarball} lacks package/package.json`);
  for (const entry of files) {
    assert.ok(entry.startsWith("package/"), `${tarball} contains an entry outside package/: ${entry}`);
    const relative = entry.slice("package/".length);
    const segments = relative.split("/");
    assert.ok(
      !segments.some((segment) => ["src", "test", ".fleet"].includes(segment)),
      `${tarball} contains forbidden entry ${entry}`,
    );
    assert.ok(
      !["pnpm-workspace.yaml", "package-lock.json", "pnpm-lock.yaml", "yarn.lock"].includes(
        path.posix.basename(relative),
      ),
      `${tarball} contains workspace manifest ${entry}`,
    );
    assert.ok(
      relative === "package.json" || matchesDeclaredFile(relative, manifest.files ?? []),
      `${tarball} contains undeclared file ${entry}`,
    );
  }
  return files.length;
}

async function scanFixtureImports(packageManifests) {
  const fixtureRoot = await realpath(fixture);
  const sourceFiles = (await filesBelow(fixture)).filter((file) =>
    /\.(?:[cm]?[jt]s|tsx)$/u.test(file),
  );
  let imports = 0;
  for (const sourceFile of sourceFiles) {
    const source = await readFile(sourceFile, "utf8");
    for (const match of source.matchAll(importPattern)) {
      const specifier = match[1];
      assert.ok(specifier, `empty import in ${sourceFile}`);
      imports += 1;
      if (specifier.startsWith(".")) {
        const resolved = path.resolve(path.dirname(sourceFile), specifier);
        assert.ok(
          resolved === fixtureRoot || resolved.startsWith(`${fixtureRoot}${path.sep}`),
          `${sourceFile} imports outside the fixture: ${specifier}`,
        );
        continue;
      }
      const packageName = packageNameFromSpecifier(specifier);
      if (packageName === undefined) continue;
      assert.doesNotMatch(
        specifier,
        /(?:^|\/)(?:src|dist)(?:\/|$)/u,
        `${sourceFile} imports forbidden path ${specifier}`,
      );
      const manifest = packageManifests.get(packageName);
      assert.ok(manifest, `${sourceFile} imports unknown kit package ${packageName}`);
      assert.ok(
        Object.hasOwn(manifest.exports ?? {}, exportKeyFor(packageName, specifier)),
        `${sourceFile} imports undeclared kit export ${specifier}`,
      );
    }
  }
  return { files: sourceFiles.length, imports };
}

function packArtifact(stdout, destination) {
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

async function assertInstalledPackages(consumer) {
  for (const packageName of packageNames) {
    const manifestPath = path.join(consumer, "node_modules", ...packageName.split("/"), "package.json");
    const manifest = await readJson(manifestPath);
    assert.equal(manifest.name, packageName, `${manifestPath} has the wrong package name`);
    assert.equal(manifest.version, "0.1.0", `${manifestPath} has the wrong version`);
    assertNoWorkspaceReferences(manifest, manifestPath);
  }
}

function assertResolvableExports(consumer, packageManifests) {
  const specifiers = [...packageManifests.values()]
    .flatMap((manifest) =>
      Object.keys(manifest.exports ?? {}).map((key) =>
        key === "." ? manifest.name : `${manifest.name}${key.slice(1)}`,
      ),
    )
    .sort();
  const program = [
    "const [specifiers, nodeModulesUrl] = [JSON.parse(process.argv[1]), process.argv[2]];",
    "for (const specifier of specifiers) {",
    "  const resolved = import.meta.resolve(specifier);",
    "  if (!resolved.startsWith(nodeModulesUrl)) {",
    "    throw new Error(`${specifier} resolved outside consumer node_modules: ${resolved}`);",
    "  }",
    "  await import(specifier);",
    "}",
  ].join("\n");
  const nodeModulesUrl = pathToFileURL(`${path.join(consumer, "node_modules")}${path.sep}`).href;
  run(
    process.execPath,
    ["--input-type=module", "--eval", program, JSON.stringify(specifiers), nodeModulesUrl],
    { cwd: consumer },
  );
  return specifiers;
}

try {
  run("pnpm", ["run", "build"]);

  const createdTemporaryDirectory = await mkdtemp(temporaryPrefix);
  const validatedTemporaryDirectory = await realpath(createdTemporaryDirectory);
  assert.equal(
    path.dirname(validatedTemporaryDirectory),
    await realpath(os.tmpdir()),
    "mkdtemp directory has an unexpected parent",
  );
  assert.ok(
    path.basename(validatedTemporaryDirectory).startsWith(path.basename(temporaryPrefix)),
    "mkdtemp directory has an unexpected name",
  );
  temporaryDirectory = validatedTemporaryDirectory;

  const packageManifests = new Map();
  const tarballs = new Map();
  const packedFileCounts = {};
  for (const directory of packageDirectories) {
    const packageDirectory = path.join(root, "packages", directory);
    const manifest = await readJson(path.join(packageDirectory, "package.json"));
    const expectedName = `@three-game-kit/${directory}`;
    assert.equal(manifest.name, expectedName);
    assert.equal(manifest.version, "0.1.0");
    packageManifests.set(expectedName, manifest);

    const before = new Set(await readdir(validatedTemporaryDirectory));
    const { stdout } = run("pnpm", ["pack", "--json", "--pack-destination", validatedTemporaryDirectory], {
      cwd: packageDirectory,
    });
    const artifact = packArtifact(stdout, validatedTemporaryDirectory);
    const added = (await readdir(validatedTemporaryDirectory)).filter((entry) => !before.has(entry));
    assert.deepEqual(added, [path.basename(artifact)], `${expectedName} produced unexpected artifacts`);
    assert.ok(!tarballs.has(path.basename(artifact)), `duplicate pack artifact ${artifact}`);
    tarballs.set(path.basename(artifact), artifact);
    packedFileCounts[expectedName] = inspectTarball(artifact, manifest);
  }

  const allArtifacts = (await readdir(validatedTemporaryDirectory)).filter((entry) => entry.endsWith(".tgz"));
  assert.deepEqual(allArtifacts.sort(), [...tarballs.keys()].sort(), "missing or extra pack artifacts");
  assert.equal(allArtifacts.length, packageNames.length, "wrong number of pack artifacts");

  const importEvidence = await scanFixtureImports(packageManifests);
  const consumer = path.join(validatedTemporaryDirectory, "consumer");
  await cp(fixture, consumer, { recursive: true, errorOnExist: true, force: false });
  await cp(path.join(root, "pnpm-lock.yaml"), path.join(consumer, "pnpm-lock.yaml"), {
    errorOnExist: true,
    force: false,
  });

  const consumerManifestPath = path.join(consumer, "package.json");
  const consumerManifest = await readJson(consumerManifestPath);
  assert.deepEqual(Object.keys(consumerManifest.dependencies).sort(), [...packageNames].sort());
  assert.ok(!Object.hasOwn(consumerManifest, "pnpm"), "fixture manifest must not define pnpm");
  consumerManifest.pnpm = { overrides: {} };
  for (const packageName of packageNames) {
    const artifact = [...tarballs.values()].find((candidate) => {
      const stem = packageName.replace(/^@/u, "").replace("/", "-");
      return path.basename(candidate).startsWith(`${stem}-0.1.0`);
    });
    assert.ok(artifact, `missing tarball for ${packageName}`);
    const tarballUri = `file:${artifact}`;
    consumerManifest.dependencies[packageName] = tarballUri;
    consumerManifest.pnpm.overrides[packageName] = tarballUri;
  }
  await writeFile(consumerManifestPath, `${JSON.stringify(consumerManifest, null, 2)}\n`, "utf8");

  const storePath = run("pnpm", ["store", "path"], { cwd: root }).stdout.trim();
  assert.ok(path.isAbsolute(storePath), `pnpm returned a non-absolute store path: ${storePath}`);
  run(
    "pnpm",
    [
      "install",
      "--no-frozen-lockfile",
      "--prefer-offline",
      "--ignore-scripts",
      "--ignore-workspace",
      "--config.link-workspace-packages=false",
      "--config.shared-workspace-lockfile=false",
      "--store-dir",
      storePath,
    ],
    { cwd: consumer },
  );

  await assertInstalledPackages(consumer);
  const resolvedSpecifiers = assertResolvableExports(consumer, packageManifests);
  run("pnpm", ["exec", "tsc", "-p", "tsconfig.json"], { cwd: consumer });
  run(process.execPath, ["--test", "test/m4.test.mjs"], { cwd: consumer });

  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      installMode: "prefer-offline-third-party;kit-file-tarballs",
      packages: packageNames.length,
      tarballs: tarballs.size,
      packedFiles: packedFileCounts,
      resolvedExports: resolvedSpecifiers.length,
      fixtureFilesScanned: importEvidence.files,
      fixtureImportsScanned: importEvidence.imports,
      consumerTests: "passed",
    })}\n`,
  );
} finally {
  if (temporaryDirectory !== undefined) {
    const resolved = path.resolve(temporaryDirectory);
    assert.equal(
      resolved,
      temporaryDirectory,
      "refusing to clean a non-canonical temporary path",
    );
    assert.equal(path.dirname(resolved), await realpath(os.tmpdir()), "refusing to clean outside tmpdir");
    assert.ok(
      path.basename(resolved).startsWith(path.basename(temporaryPrefix)),
      "refusing to clean an unexpected temporary path",
    );
    await rm(temporaryDirectory, { recursive: true, force: false });
  }
}
