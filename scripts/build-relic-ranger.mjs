// Regenerates the repository-authored Relic Ranger rig used by the Relic Frontier showcase.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RIG_FILE, buildRelicRangerGlb, parseGlbJson } from "./lib/relic-ranger-rig.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const target = path.join(root, "showcases", "relic-frontier", "assets", RIG_FILE);
const built = await buildRelicRangerGlb();
await mkdir(path.dirname(target), { recursive: true });
await writeFile(target, built.bytes);
const { json } = parseGlbJson(built.bytes);
console.log(JSON.stringify({
  file: path.relative(root, target),
  bytes: built.bytes.byteLength,
  nodes: json.nodes?.length ?? 0,
  meshes: json.meshes?.length ?? 0,
  materials: json.materials?.length ?? 0,
  textures: json.textures?.length ?? 0,
  images: json.images?.length ?? 0,
  skins: json.skins?.length ?? 0,
  joints: json.skins?.[0]?.joints?.length ?? 0,
  animations: json.animations?.map(({ name, channels, samplers }) => ({ name, channels: channels.length, samplers: samplers.length })) ?? [],
  vertices: built.vertices,
  triangles: built.triangles,
  generator: json.asset?.generator,
}, null, 2));
