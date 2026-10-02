import { mkdir, writeFile } from "node:fs/promises";
import { buildAssets } from "./lib/metaverse-assets.mjs";
const target = new URL("../showcases/metaverse/assets/", import.meta.url);
await mkdir(target, { recursive: true });
for (const [name, bytes] of Object.entries(await buildAssets())) {
  await writeFile(new URL(name, target), bytes);
  console.log(`${name}: ${bytes.length} bytes`);
}
