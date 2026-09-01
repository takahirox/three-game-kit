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
    exports: [".", "./movement", "./gameplay"],
    dependencies: ["@three-game-kit/core"],
  },
  protocol: {
    name: "@three-game-kit/protocol",
    exports: ["."],
    dependencies: ["zod"],
  },
  client: {
    name: "@three-game-kit/client",
    exports: [
      ".",
      "./rendering",
      "./input",
      "./camera",
      "./vfx",
      "./collision",
      "./assets",
      "./asset-manager",
      "./audio",
      "./animation",
      "./character-controller",
      "./gameplay",
      "./networking",
      "./replication",
    ],
    dependencies: [
      "@dimforge/rapier3d-compat",
      "@three-game-kit/core",
      "@three-game-kit/protocol",
      "@three-game-kit/shared",
      "three",
    ],
  },
  server: {
    name: "@three-game-kit/server",
    exports: [".", "./collision", "./authoritative", "./gameplay", "./networking"],
    dependencies: [
      "@dimforge/rapier3d-compat",
      "@three-game-kit/core",
      "@three-game-kit/protocol",
      "@three-game-kit/shared",
      "ws",
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
for (const script of [
  "build",
  "typecheck",
  "test",
  "test:node",
  "verify",
  "typecheck:m2-browser",
  "test:m2-browser",
  "verify:m2",
  "typecheck:m3-browser",
  "test:m3-browser",
  "verify:m3",
  "test:m4-catalog",
  "test:m4-packed-consumer",
  "verify:m4",
  "typecheck:common-gameplay",
  "test:common-gameplay",
  "verify:common-gameplay",
]) {
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
const serverInternalNodeImports = new Set(["node:buffer", "node:http", "node:stream"]);

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
    if (specifier.startsWith("node:")) {
      assert.equal(
        directory,
        "server",
        `${sourceFile} imports a Node builtin outside Server`,
      );
      assert.ok(
        serverInternalNodeImports.has(specifier),
        `${sourceFile} imports an undeclared Node builtin`,
      );
      continue;
    }
    if (specifier === "zod" || specifier.startsWith("zod/")) {
      assert.equal(
        directory,
        "protocol",
        `${sourceFile} imports zod outside Protocol`,
      );
    }
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
    /["'](?:three|@dimforge\/rapier3d(?:-compat)?)(?:[\/"'])/u,
    `${declarationFile} leaks a vendor declaration`,
  );
  if (directory === "protocol") {
    assert.doesNotMatch(
      text,
      /\bZod(?:Issue|Error)[A-Za-z0-9_]*\b/u,
      `${declarationFile} leaks Zod issue/error internals`,
    );
  }
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
    category: "non-Protocol zod import",
    directory: "client",
    text: 'import { z } from "zod";',
  },
  {
    category: "Protocol declaration Zod issue internals",
    directory: "protocol",
    declaration: true,
    text: 'import type { ZodIssue } from "zod"; export type LeakedIssue = ZodIssue;',
  },
  {
    category: "Protocol declaration Zod error internals",
    directory: "protocol",
    declaration: true,
    text: 'import type { ZodError } from "zod"; export type LeakedError = ZodError;',
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

assert.doesNotThrow(
  () =>
    assertDeclarationBoundaries(
      'import type { ZodType } from "zod"; export declare const PublicSchema: ZodType<string>;',
      path.join(
        packageRoot,
        "protocol",
        "dist",
        "boundary-fixture.d.ts",
      ),
      "protocol",
      packageContract.protocol,
    ),
  "Protocol schema declaration fixture must remain accepted",
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
      dependency === "zod"
        ? "^4.4.3"
        : dependency === "three"
          ? "0.185.1"
          : dependency === "@dimforge/rapier3d" ||
              dependency === "@dimforge/rapier3d-compat"
            ? "0.20.0"
            : dependency === "ws"
              ? "8.21.3"
              : "workspace:^";
    assert.equal(manifest.dependencies[dependency], expectedVersion);
  }
  if (directory === "server") {
    assert.deepEqual(manifest.devDependencies, {
      "@types/node": "24.13.3",
      "@types/ws": "8.18.1",
    });
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

const clientReplicationDeclarationFile = path.join(
  packageRoot,
  "client",
  "dist",
  "replication.d.ts",
);
const clientReplicationDeclaration = await readFile(
  clientReplicationDeclarationFile,
  "utf8",
);
const clientReplicationDeclarationLeakChecks = [
  {
    label: "a transport or vendor module",
    pattern:
      /["'](?:(?:node:)?(?:buffer|http|https|net|stream|tls)|ws|three|@dimforge\/rapier3d(?:-compat)?)(?:\/[^"']*)?["']/u,
  },
  {
    label: "a browser or transport implementation type",
    pattern:
      /\b(?:WebSocket|MessageEvent|Event|EventTarget|EventListener|CloseEvent|ErrorEvent|Socket|Duplex|HTTP[A-Za-z0-9_$]*|Http[A-Za-z0-9_$]*|ServerResponse|ClientRequest|IncomingMessage|RawData|Buffer|[A-Za-z_$][\w$]*(?:Event|Socket|Listener)[\w$]*)\b/u,
  },
  {
    label: "a Rapier or Three implementation type",
    pattern:
      /\b(?:RAPIER|THREE|Rapier[A-Za-z0-9_$]*|Three[A-Za-z0-9_$]*|[A-Za-z_$][\w$]*(?:World|Controller|Collider|Handle|WASM|WebAssembly|Scene|Object3D|Vector[234]|Matrix[34]|Quaternion|Euler|Camera|Renderer|Material|Geometry|Texture|Mesh|Raycaster)[\w$]*)\b/u,
  },
];
for (const { label, pattern } of clientReplicationDeclarationLeakChecks) {
  assert.doesNotMatch(
    clientReplicationDeclaration,
    pattern,
    `${clientReplicationDeclarationFile} exposes ${label}`,
  );
}
const clientReplicationDeclarationImports = [
  ...clientReplicationDeclaration.matchAll(
    /(?:from\s+|import\s*(?:\(\s*)?)["']([^"']+)["']/gu,
  ),
].map((match) => match[1]);
for (const specifier of clientReplicationDeclarationImports) {
  assert.ok(
    specifier === "./collision.js" ||
      specifier === "@three-game-kit/protocol" ||
      specifier === "@three-game-kit/shared",
    `${clientReplicationDeclarationFile} exposes non-kit type import ${specifier}`,
  );
}

const serverAuthoritativeDeclarationFile = path.join(
  packageRoot,
  "server",
  "dist",
  "authoritative.d.ts",
);
const serverAuthoritativeDeclaration = await readFile(
  serverAuthoritativeDeclarationFile,
  "utf8",
);
const authoritativeDeclarationLeakChecks = [
  {
    label: "a crypto implementation",
    pattern:
      /\b(?:Crypto|CryptoKey|SubtleCrypto|getRandomValues|randomBytes|randomUUID)\b|["'](?:node:)?crypto(?:\/[^"']*)?["']/u,
  },
  {
    label: "a deterministic ID generator",
    pattern:
      /\b(?:AuthoritativeServerTestOptions|createAuthoritativeServerForTesting|idByteGenerator)\b/u,
  },
  {
    label: "a socket, HTTP, WebSocket, or Buffer type",
    pattern:
      /\b(?:WebSocket|Socket|IncomingMessage|ServerResponse|ClientRequest|RequestListener|Buffer)\b|["'](?:node:)?(?:buffer|http|https|net|tls|ws)(?:\/[^"']*)?["']/u,
  },
  {
    label: "a Rapier type or value",
    pattern:
      /\b(?:RAPIER|[A-Za-z_$][\w$]*(?:World|Controller|Collider|Handle|WASM|WebAssembly)[\w$]*)\b|["']@dimforge\/rapier3d(?:-compat)?(?:\/[^"']*)?["']/iu,
  },
  {
    label: "a Client package type",
    pattern:
      /["']@three-game-kit\/client(?:\/[^"']*)?["']|\b(?:ClientRuntime|ClientFeatureRuntime|ClientCollisionAdapter)\b/u,
  },
];
for (const { label, pattern } of authoritativeDeclarationLeakChecks) {
  assert.doesNotMatch(
    serverAuthoritativeDeclaration,
    pattern,
    serverAuthoritativeDeclarationFile + " exposes " + label,
  );
}

const serverNetworkingDeclarationFile = path.join(
  packageRoot,
  "server",
  "dist",
  "networking.d.ts",
);
const serverNetworkingDeclaration = await readFile(
  serverNetworkingDeclarationFile,
  "utf8",
);
assert.doesNotMatch(
  serverNetworkingDeclaration,
  /["'](?:node:(?:http|buffer|stream)|ws)(?:\/[^"']*)?["']/u,
  `${serverNetworkingDeclarationFile} exposes a Node or ws module`,
);
assert.doesNotMatch(
  serverNetworkingDeclaration,
  /\b(?:WebSocket|WebSocketServer|Socket|Duplex|HTTP[A-Za-z0-9_$]*|HttpServer|ServerResponse|ClientRequest|IncomingMessage|RawData|Buffer|[A-Za-z_$][\w$]*Listener)\b/u,
  `${serverNetworkingDeclarationFile} exposes a transport implementation type`,
);
const networkingDeclarationImports = [
  ...serverNetworkingDeclaration.matchAll(
    /(?:from\s+|import\s*)["']([^"']+)["']/gu,
  ),
].map((match) => match[1]);
for (const specifier of networkingDeclarationImports) {
  assert.ok(
    specifier === "./authoritative.js" ||
      specifier === "@three-game-kit/protocol",
    `${serverNetworkingDeclarationFile} exposes non-kit type import ${specifier}`,
  );
}

const serverCollisionDeclarationFile = path.join(
  packageRoot,
  "server",
  "dist",
  "collision.d.ts",
);
const serverCollisionDeclaration = await readFile(
  serverCollisionDeclarationFile,
  "utf8",
);
assert.doesNotMatch(
  serverCollisionDeclaration,
  /["']@dimforge\/rapier3d(?:-compat)?(?:\/[^"']*)?["']/u,
  `${serverCollisionDeclarationFile} exposes the Rapier module`,
);
assert.doesNotMatch(
  serverCollisionDeclaration,
  /\b(?:RAPIER|[A-Za-z_$][\w$]*(?:World|Controller|Collider|Handle|WASM|WebAssembly)[\w$]*)\b/iu,
  `${serverCollisionDeclarationFile} exposes a Rapier type or value`,
);

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
