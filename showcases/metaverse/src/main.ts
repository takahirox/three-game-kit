import { createAssetManager } from "@three-game-kit/client/asset-manager";
import { createDomHudAdapter } from "@three-game-kit/client/gameplay";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { createCourtGame, type CourtGame } from "./game.js";
import { createCourtRenderer, type CourtRenderer } from "./renderer.js";
import type { Action } from "./world.js";
import { installCourtControls } from "./touch.js";

const canvas = document.querySelector<HTMLCanvasElement>("#world")!;
const hud = document.querySelector<HTMLElement>("#hud")!;
const status = document.querySelector<HTMLElement>("#status")!;
const testMode = new URLSearchParams(location.search).get("test") === "1";
const failures: Array<{ source: string; message: string }> = [];
const listeners: Array<() => void> = [];
const held = new Set<string>();
let game: CourtGame | undefined,
  renderer: CourtRenderer | undefined,
  disposed = false,
  raf: number | null = null,
  lastTime = 0,
  yaw = 0;
let disposal: Promise<void> | undefined;
const assets = createAssetManager([
  {
    id: "visitor",
    kind: "gltf",
    source: new URL("../assets/visitor.glb", import.meta.url).href,
    groups: ["boot"],
  },
  {
    id: "court",
    kind: "gltf",
    source: new URL("../assets/court.glb", import.meta.url).href,
    groups: ["boot"],
  },
]);
function record(source: string, cause: unknown) {
  if (failures.length === 64) failures.shift();
  failures.push({
    source,
    message: cause instanceof Error ? cause.message : String(cause),
  });
  status.textContent = `Unable to enter the court: ${failures.at(-1)!.message}`;
}
function listen(target: EventTarget, type: string, fn: EventListener) {
  target.addEventListener(type, fn);
  listeners.push(() => target.removeEventListener(type, fn));
}
function resetInput() {
  held.clear();
  controls.reset();
  game?.setMove(0, 0);
}
function keyboardMovement() {
  const x =
    Number(held.has("KeyD") || held.has("ArrowRight")) -
    Number(held.has("KeyA") || held.has("ArrowLeft"));
  const z =
    Number(held.has("KeyS") || held.has("ArrowDown")) -
    Number(held.has("KeyW") || held.has("ArrowUp"));
  // Public semantic movement lies in the unit disc, including keyboard diagonals.
  const scale = x !== 0 && z !== 0 ? Math.sqrt(0.5 - Number.EPSILON) : 1;
  game?.setMove(
    x * scale,
    z * scale,
    held.has("ShiftLeft") || held.has("ShiftRight"),
  );
}
function dispose(): Promise<void> {
  if (disposal) return disposal;
  disposed = true;
  if (raf !== null) cancelAnimationFrame(raf);
  raf = null;
  for (const remove of listeners.splice(0)) remove();
  held.clear();
  controls.dispose();
  disposal = (async () => {
    await game?.dispose();
    // Also cover disposal during pending assets or a failed boot.
    domHud.dispose();
    renderer?.dispose();
    assets.dispose();
    if (failures.length === 0)
      status.textContent = "Court closed · reload to visit again";
  })();
  return disposal;
}
function loop(time: number) {
  if (disposed) return;
  try {
    const dt = lastTime === 0 ? 0 : Math.min((time - lastTime) / 1000, 0.1);
    lastTime = time;
    game?.advance(dt);
  } catch (error) {
    record("frame", error);
    void dispose();
    return;
  }
  raf = requestAnimationFrame(loop);
}
const handle = {
  get ready() {
    return game !== undefined && !disposed;
  },
  get screenshotReady() {
    return (
      game !== undefined && !disposed && (renderer?.inspect().frames ?? 0) > 0
    );
  },
  get mode() {
    return testMode ? "test" : "normal";
  },
  start() {
    game?.start();
  },
  reset() {
    resetInput();
    yaw = 0;
    game?.reset();
  },
  restart() {
    handle.reset();
  },
  setMove(x: number, z: number, run = false) {
    game?.setMove(x, z, run);
  },
  setLook(radians: number) {
    yaw = radians;
    game?.setLook(radians);
  },
  press(action: Action) {
    game?.press(action);
  },
  advance(seconds: number) {
    return game?.advance(seconds) ?? 0;
  },
  snapshot() {
    return game?.snapshot() ?? null;
  },
  inspectAnimation() {
    return game?.inspectAnimation() ?? null;
  },
  inspectRuntime() {
    return game?.inspectRuntime() ?? null;
  },
  inspectAssets() {
    return assets.inspect();
  },
  inspectRenderer() {
    return renderer?.inspect() ?? null;
  },
  errors() {
    return [...failures, ...(game?.errors() ?? [])];
  },
  inspectLeaks() {
    return {
      hostDisposed: disposed,
      hostListeners: listeners.length,
      rafActive: raf !== null,
      heldKeys: held.size,
      pointerCaptured: controls.inspect().lookPointer !== null,
      touch: controls.inspect(),
      game: game?.inspectLeaks() ?? null,
    };
  },
  dispose,
};
declare global {
  interface Window {
    __METAVERSE__: typeof handle;
  }
}
window.__METAVERSE__ = handle;

listen(window, "error", (event) =>
  record("window", (event as ErrorEvent).message),
);
listen(window, "unhandledrejection", (event) =>
  record("promise", (event as PromiseRejectionEvent).reason),
);
listen(window, "pagehide", () => void dispose());
listen(window, "resize", () => renderer?.resize());
listen(window, "blur", resetInput);
listen(document, "visibilitychange", () => {
  if (document.hidden) {
    resetInput();
    lastTime = 0;
  }
});
const keys = new Set([
  "KeyW",
  "KeyA",
  "KeyS",
  "KeyD",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "ShiftLeft",
  "ShiftRight",
  "Space",
  "KeyE",
  "KeyR",
  "Enter",
  "KeyQ",
  "KeyC",
]);
listen(window, "keydown", (raw) => {
  const e = raw as KeyboardEvent;
  if (!keys.has(e.code) || e.target instanceof HTMLInputElement) return;
  // Keep Enter/Space native when a toolbar button has focus.
  if (
    e.target instanceof HTMLButtonElement &&
    (e.code === "Enter" || e.code === "Space")
  )
    return;
  e.preventDefault();
  held.add(e.code);
  keyboardMovement();
  if (e.repeat) return;
  if (e.code === "Enter") game?.start();
  if (e.code === "Space") game?.press("jump");
  if (e.code === "KeyE") game?.press("interact");
  if (e.code === "KeyR") handle.reset();
  if (e.code === "KeyQ" || e.code === "KeyC") {
    yaw += (e.code === "KeyQ" ? -1 : 1) * 0.2;
    game?.setLook(yaw);
  }
});
listen(window, "keyup", (raw) => {
  held.delete((raw as KeyboardEvent).code);
  keyboardMovement();
});
const controls = installCourtControls(hud, canvas, {
  playing: () => game?.snapshot().phase === "playing" && !disposed,
  setMove: (x, z, run) => game?.setMove(x, z, run),
  press: (action) => game?.press(action),
  look: (delta) => {
    yaw += delta;
    game?.setLook(yaw);
  },
});
const domHud = createDomHudAdapter(hud, {
  onAction: (action) => {
    if (action === "start") {
      game?.start();
      canvas.focus();
    }
    if (action === "reset") {
      handle.reset();
      canvas.focus();
    }
    if (action === "interact") game?.press("interact");
    if (action === "dispose") void dispose();
  },
});
async function boot() {
  try {
    const results = await assets.preloadGroup("boot");
    if (disposed) {
      domHud.dispose();
      return;
    }
    const failure = results.find((r) => !r.ok);
    if (failure && !failure.ok) throw new Error(failure.failure.message);
    const visitor = assets.get<GLTF>("visitor")!,
      court = assets.get<GLTF>("court")!;
    renderer = createCourtRenderer(canvas, visitor, court);
    game = await createCourtGame(assets, visitor, renderer, domHud);
    if (disposed) {
      await game.dispose();
      return;
    }
    status.textContent = document.body.classList.contains("touch-controls-enabled")
      ? "Stick to move · Drag the world to look"
      : "WASD · Shift to run · Space to jump · Drag to look";
    if (!testMode) raf = requestAnimationFrame(loop);
  } catch (error) {
    record("boot", error);
    await dispose();
  }
}
void boot();
