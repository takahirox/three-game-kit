import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { buildAssets, VERSION } from "./lib/metaverse-assets.mjs";
import { parseGlbJson } from "./lib/relic-ranger-rig.mjs";
const root = new URL("../", import.meta.url),
  showcase = new URL("showcases/metaverse/", root);
const expected = await buildAssets();
assert.deepEqual(
  (await readdir(new URL("assets/", showcase))).sort(),
  Object.keys(expected).sort(),
);
const intake = [];
for (const [name, generated] of Object.entries(expected)) {
  const bytes = await readFile(new URL(`assets/${name}`, showcase));
  assert.deepEqual(
    bytes,
    Buffer.from(generated),
    `${name}: regenerate asset after authoring changes`,
  );
  assert(bytes.length < 512 * 1024, `${name}: 512 KiB model budget`);
  const { json, version } = parseGlbJson(bytes);
  assert.equal(version, 2);
  assert.equal(json.asset.version, "2.0");
  assert.equal(
    json.nodes.find((n) => n.extras?.generator)?.extras.generator,
    VERSION,
  );
  assert.equal(json.images?.length ?? 0, 0);
  assert.equal(json.textures?.length ?? 0, 0);
  assert(!json.buffers.some((b) => b.uri));
  if (name === "visitor.glb") {
    assert.equal(json.skins.length, 1);
    assert.equal(json.skins[0].joints.length, 17);
    assert.deepEqual(
      json.animations.map((a) => a.name),
      ["idle", "walk", "run"],
    );
    assert.equal(json.meshes.length, 1);
    assert(
      json.meshes[0].primitives.every(
        (p) =>
          p.attributes.JOINTS_0 !== undefined &&
          p.attributes.WEIGHTS_0 !== undefined,
      ),
    );
  }
  if (name === "court.glb") {
    assert(json.meshes.length > 50);
    for (const marker of [
      "LanternGlow",
      "Carved arcade",
      "Sweeping pavilion roof",
      "Ceramic garden planter",
    ])
      assert(
        json.nodes.some((n) => n.name === marker),
        `${marker}: authored landmark`,
      );
  }
  const vertices = json.meshes.reduce(
    (sum, m) =>
      sum +
      m.primitives.reduce(
        (n, p) => n + json.accessors[p.attributes.POSITION].count,
        0,
      ),
    0,
  );
  const triangles = json.meshes.reduce(
    (sum, m) =>
      sum +
      m.primitives.reduce(
        (n, p) =>
          n + json.accessors[p.indices ?? p.attributes.POSITION].count / 3,
        0,
      ),
    0,
  );
  intake.push({
    name,
    bytes: bytes.length,
    meshes: json.meshes.length,
    materials: json.materials.length,
    vertices,
    triangles,
    joints: json.skins?.[0]?.joints.length ?? 0,
    clips: json.animations?.map((a) => a.name) ?? [],
  });
}
// Keep the showcase on package exports; world state must remain presentation-independent.
for (const filename of await readdir(new URL("src/", showcase))) {
  const source = await readFile(new URL(`src/${filename}`, showcase), "utf8");
  for (const match of source.matchAll(
    /from\s*['"](@three-game-kit\/([^/'"]+)([^'"]*))['"]/g,
  )) {
    const pkg = JSON.parse(
      await readFile(
        new URL(`packages/${match[2]}/package.json`, root),
        "utf8",
      ),
    );
    assert(
      Object.hasOwn(pkg.exports, match[3] ? `.${match[3]}` : "."),
      `Non-public import ${match[1]}`,
    );
  }
  assert(
    !source.includes("packages/") && !source.includes("__internal"),
    "No private imports",
  );
  if (filename === "world.ts")
    assert(
      !/from ['"](?:three|.*client)/.test(source),
      "World data is authority-neutral",
    );
}
const docs = await readFile(new URL("ASSETS.md", showcase), "utf8");
for (const asset of intake) {
  assert(
    docs.includes(asset.name) && docs.includes(String(asset.bytes)),
    `${asset.name}: documented intake size`,
  );
}
console.log(JSON.stringify({ ok: true, intake }, null, 2));
