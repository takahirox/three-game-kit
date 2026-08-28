import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageRoot = path.join(root, "packages");

const packageContract = {
  core: {
    name: "@three-game-kit/core",
    exports: ["."],
    dependencies: [],
  },
  shared: {
    name: "@three-game-kit/shared",
    exports: [".", "./movement"],
    dependencies: ["@three-game-kit/core"],
  },
  protocol: {
    name: "@three-game-kit/protocol",
    exports: ["."],
    dependencies: [],
  },
  client: {
    name: "@three-game-kit/client",
    exports: [
      ".",
      "./rendering",
      "./input",
      "./camera",
      "./collision",
      "./assets",
      "./networking",
    ],
    dependencies: [
      "@dimforge/rapier3d",
      "@three-game-kit/core",
      "@three-game-kit/protocol",
      "@three-game-kit/shared",
      "three",
    ],
  },
  server: {
    name: "@three-game-kit/server",
    exports: ["."],
    dependencies: [
      "@three-game-kit/core",
      "@three-game-kit/protocol",
      "@three-game-kit/shared",
    ],
  },
};

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

async function filesBelow(directory, predicate) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await filesBelow(entryPath, predicate)));
    } else if (predicate(entryPath)) {
      files.push(entryPath);
    }
  }
  return files;
}

function expectedTarget(specifier) {
  const stem = specifier === "." ? "index" : specifier.slice(2);
  return {
    types: `./dist/${stem}.d.ts`,
    import: `./dist/${stem}.js`,
  };
}

const rootManifest = await readJson(path.join(root, "package.json"));
assert.equal(
  process.versions.node.split(".")[0],
  "24",
  "verification requires Node 24",
);
assert.equal(rootManifest.private, true);
assert.equal(rootManifest.type, "module");
assert.equal(rootManifest.packageManager, "pnpm@11.24.0");
assert.equal(rootManifest.engines.node, "24.x");
assert.equal(rootManifest.engines.pnpm, "11.24.0");
assert.equal(rootManifest.devDependencies.typescript, "6.0.3");
assert.equal(rootManifest.devDependencies["@playwright/test"], "1.62.1");
assert.equal(rootManifest.devDependencies.vite, "8.2.2");
for (const script of ["build", "typecheck", "test", "verify"]) {
  assert.equal(
    typeof rootManifest.scripts[script],
    "string",
    `missing root ${script} script`,
  );
}

const workspaceLines = (
  await readFile(path.join(root, "pnpm-workspace.yaml"), "utf8")
)
  .split(/\r?\n/u)
  .filter((line) => line.length > 0);
assert.deepEqual(workspaceLines, [
  "packages:",
  "  - packages/core",
  "  - packages/shared",
  "  - packages/protocol",
  "  - packages/client",
  "  - packages/server",
]);

const packageDirectories = (await readdir(packageRoot, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();
assert.deepEqual(packageDirectories, Object.keys(packageContract).sort());

const allPublicSpecifiers = new Set(
  Object.values(packageContract).flatMap(({ name, exports }) =>
    exports.map((specifier) =>
      specifier === "." ? name : `${name}${specifier.slice(1)}`,
    ),
  ),
);

const environmentNeutralPackages = new Set(["core", "shared", "protocol", "server"]);
const forbiddenEnvironmentTypes = /\b(?:Window|Document|Navigator|HTMLElement|KeyboardEvent|WebXR)\b/u;
const forbiddenEnvironmentGlobals = /\b(?:window|document|navigator|requestAnimationFrame|cancelAnimationFrame)\s*(?:\.|\(|\[)/u;

function assertSourceBoundaries(source, sourceFile, directory, contract) {
  const directoryPath = path.join(packageRoot, directory);
  if (environmentNeutralPackages.has(directory)) {
    assert.doesNotMatch(
      source,
      forbiddenEnvironmentTypes,
      `${sourceFile} leaks a browser-only type`,
    );
    assert.doesNotMatch(
      source,
      forbiddenEnvironmentGlobals,
      `${sourceFile} reads a browser-only global`,
    );
  }

  const importPattern = /(?:from\s+|import\s*)["']([^"']+)["']/gu;
  for (const match of source.matchAll(importPattern)) {
    const specifier = match[1];
    if (specifier.startsWith(".")) {
      const resolved = path.resolve(path.dirname(sourceFile), specifier);
      assert.ok(
        resolved.startsWith(`${directoryPath}${path.sep}`),
        `${sourceFile} crosses its package root`,
      );
    } else {
      const workspaceDependency = [...Object.values(packageContract)].find(
        ({ name }) =>
          specifier === name || specifier.startsWith(`${name}/`),
      )?.name;
      if (workspaceDependency !== undefined) {
        assert.ok(
          allPublicSpecifiers.has(specifier),
          `${sourceFile} imports non-public ${specifier}`,
        );
        assert.ok(
          contract.dependencies.includes(workspaceDependency),
          `${sourceFile} imports an undeclared workspace dependency`,
        );
      } else {
        assert.ok(
          contract.dependencies.some(
            (dependency) =>
              specifier === dependency || specifier.startsWith(`${dependency}/`),
          ),
          `${sourceFile} imports an undeclared external dependency`,
        );
      }
    }
  }
}

function assertDeclarationBoundaries(text, declarationFile, directory, contract) {
  assertSourceBoundaries(text, declarationFile, directory, contract);
  assert.doesNotMatch(
    text,
    /["'](?:three|@dimforge\/rapier3d)(?:[\/"'])/u,
    `${declarationFile} leaks a vendor declaration`,
  );
  assert.doesNotMatch(
    text,
    /\b(?:bitECS|bitecs|Window|Document|Navigator|HTMLElement|KeyboardEvent|WebXR|WebSocket|Buffer)\b/u,
  );
  assert.doesNotMatch(text, /(?:src|internal)\//u);
}

const negativeBoundaryFixtures = [
  {
    category: "browser global",
    directory: "server",
    text: "window.location.href;",
  },
  {
    category: "DOM type",
    directory: "server",
    text: "declare const root: HTMLElement;",
  },
  {
    category: "three package import",
    directory: "client",
    declaration: true,
    text: 'export type { Scene } from "three";',
  },
  {
    category: "rapier package import",
    directory: "client",
    declaration: true,
    text: 'export type { World } from "@dimforge/rapier3d";',
  },
  {
    category: "server importing client",
    directory: "server",
    text: 'import "@three-game-kit/client";',
  },
  {
    category: "deep public package import",
    directory: "server",
    text: 'import "@three-game-kit/shared/movement/internal";',
  },
  {
    category: "declaration DOM type",
    directory: "server",
    declaration: true,
    text: "export interface LeakedElement { root: HTMLElement }",
  },
  {
    category: "declaration three package import",
    directory: "client",
    declaration: true,
    text: 'export type { Scene } from "three";',
  },
  {
    category: "declaration rapier package import",
    directory: "client",
    declaration: true,
    text: 'export type { RigidBody } from "@dimforge/rapier3d-compat";',
  },
  {
    category: "declaration server importing client",
    directory: "server",
    declaration: true,
    text: 'export type { ClientRuntime } from "@three-game-kit/client";',
  },
  {
    category: "declaration deep public package import",
    directory: "server",
    declaration: true,
    text: 'export type { Hidden } from "@three-game-kit/shared/movement/internal";',
  },
  {
    category: "internal src declaration path",
    directory: "server",
    declaration: true,
    text: 'export * from "../src/internal.js";',
  },
];

for (const fixture of negativeBoundaryFixtures) {
  assert.throws(
    () => {
      if (fixture.declaration) {
        assertDeclarationBoundaries(
          fixture.text,
          path.join(
            packageRoot,
            fixture.directory,
            "dist",
            "boundary-fixture.d.ts",
          ),
          fixture.directory,
          packageContract[fixture.directory],
        );
      } else {
        const sourceFile = path.join(
          packageRoot,
          fixture.directory,
          "src",
          "boundary-fixture.ts",
        );
        assertSourceBoundaries(
          fixture.text,
          sourceFile,
          fixture.directory,
          packageContract[fixture.directory],
        );
      }
    },
    assert.AssertionError,
    `${fixture.category} fixture must be rejected`,
  );
}

assert.doesNotThrow(
  () =>
    assertSourceBoundaries(
      'import { MovementIntent } from "@three-game-kit/shared/movement";',
      path.join(packageRoot, "server", "src", "boundary-fixture.ts"),
      "server",
      packageContract.server,
    ),
  "public package subpath fixture must remain accepted",
);

for (const [directory, contract] of Object.entries(packageContract)) {
  const directoryPath = path.join(packageRoot, directory);
  const manifest = await readJson(path.join(directoryPath, "package.json"));
  assert.equal(manifest.name, contract.name);
  assert.equal(manifest.version, "0.1.0");
  assert.equal(manifest.type, "module");
  assert.equal(manifest.engines.node, "24.x");
  assert.deepEqual(Object.keys(manifest.exports), contract.exports);
  for (const specifier of contract.exports) {
    assert.equal(specifier.includes("*"), false);
    assert.deepEqual(manifest.exports[specifier], expectedTarget(specifier));
    assert.equal("require" in manifest.exports[specifier], false);
  }

  const actualDependencies = Object.keys(manifest.dependencies ?? {}).sort();
  assert.deepEqual(actualDependencies, [...contract.dependencies].sort());
  for (const dependency of actualDependencies) {
    const expectedVersion =
      dependency === "three"
        ? "0.185.1"
        : dependency === "@dimforge/rapier3d"
          ? "0.20.0"
          : "workspace:^";
    assert.equal(manifest.dependencies[dependency], expectedVersion);
  }

  const sourceRoot = path.join(directoryPath, "src");
  const sourceFiles = await filesBelow(sourceRoot, (file) =>
    file.endsWith(".ts"),
  );
  for (const sourceFile of sourceFiles) {
    const source = await readFile(sourceFile, "utf8");
    assertSourceBoundaries(source, sourceFile, directory, contract);
  }

  const declarationRoot = path.join(directoryPath, "dist");
  assert.equal((await stat(declarationRoot)).isDirectory(), true);
  const declarations = await filesBelow(declarationRoot, (file) =>
    file.endsWith(".d.ts"),
  );
  assert.ok(declarations.length >= contract.exports.length);
  for (const declaration of declarations) {
    const text = await readFile(declaration, "utf8");
    assertDeclarationBoundaries(text, declaration, directory, contract);
  }
}

const coreDeclarationFiles = await filesBelow(
  path.join(packageRoot, "core", "dist"),
  (file) => file.endsWith(".d.ts"),
);
const coreDeclaration = (
  await Promise.all(
    coreDeclarationFiles.sort().map((file) => readFile(file, "utf8")),
  )
).join("\n");
for (const symbol of [
  "EntityId",
  "ComponentType",
  "ResourceType",
  "World",
  "defineComponent",
  "defineResource",
  "createWorld",
  "createServerSchedule",
  "SERVER_SIMULATION_PHASES",
  "SIMULATION_DT_SECONDS",
  "ServerSchedule",
  "RuntimeErrorRecord",
  "RuntimeErrorRecordInput",
  "TelemetryStore",
  "ServerTelemetrySnapshot",
  "createTelemetryStore",
  "createRuntimeErrorRecord",
  "LIVE_RESOURCE_KINDS",
  "REJECTED_COMMAND_REASONS",
  "createBoundedMailbox",
  "createRuntimeLiveFence",
  "BoundedMailbox",
]) {
  assert.match(coreDeclaration, new RegExp(`\\b${symbol}\\b`, "u"));
}

console.log(
  "workspace, exports, dependency boundaries, and declarations verified",
);
