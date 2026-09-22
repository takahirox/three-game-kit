/// <reference lib="dom" />
import { createAudioRuntime, createSilentAudioDriver, createWebAudioDriver, type AudioRuntime } from "@three-game-kit/client/audio";
import { createDomHudAdapter, type HudAdapter } from "@three-game-kit/client/gameplay";
import { createBrowserStorageSaveAdapter } from "@three-game-kit/client/genre";
import type { HudState } from "@three-game-kit/shared/gameplay";
import { createInMemorySaveAdapter, type SaveAdapter } from "@three-game-kit/shared/genre";
import { createIconPainter, type IconPainter } from "./client/icons.js";
import { synthesiseSoundBank } from "./client/sounds.js";
import { blockByKey } from "./shared/blocks.js";
import { createCraftlandsRenderer, type CraftlandsRenderer, type CraftlandsRendererInspection } from "./client/renderer.js";
import { createCraftlandsGame, type CraftlandsGame, type CraftlandsLeakInspection, type CraftlandsRuntimeInspection, type CraftlandsSaveInspection, type CraftlandsWorldInspection, type SlotContainer } from "./game.js";
import type { SlotValue } from "./shared/inventory.js";
import { CREATIVE_ITEMS, itemByKey } from "./shared/items.js";
import { TUNING, type Action, type CraftlandsEvent, type CraftlandsSnapshot, type GameMode, type HeldInput, type Scenario } from "./shared/state.js";

type HostMode = "normal" | "test";
interface HostError { readonly source: string; readonly message: string; }

export interface CraftlandsHandle {
  readonly ready: boolean;
  readonly screenshotReady: boolean;
  readonly mode: HostMode;
  readonly status: string;
  start(): void;
  continueWorld(): void;
  dispose(): void;
  setMove(x: number, z: number): void;
  setLook(yaw: number, pitch: number): void;
  look(deltaYaw: number, deltaPitch: number): void;
  setHeld(patch: Partial<HeldInput>): void;
  press(action: Action): void;
  clickSlot(container: SlotContainer, index: number, button?: "left" | "right", shift?: boolean): void;
  command(text: string): void;
  give(key: string, count: number): void;
  setMode(mode: GameMode): void;
  setOption(key: "distance" | "fov" | "sensitivity" | "volume", value: number): void;
  advance(seconds: number): number;
  loadScenario(id: Scenario): void;
  setTimeOfDay(fraction: number): void;
  snapshot(): CraftlandsSnapshot;
  events(): readonly CraftlandsEvent[];
  errors(): readonly HostError[];
  inspectRuntime(): CraftlandsRuntimeInspection | null;
  inspectRenderer(): CraftlandsRendererInspection | null;
  inspectWorld(): CraftlandsWorldInspection | null;
  inspectSave(): CraftlandsSaveInspection | null;
  inspectInventory(): Readonly<Record<string, number>> | null;
  inspectLeaks(): Readonly<{ hostListeners: number; rafActive: boolean; pointerLocked: boolean; hostDisposed: boolean; game: CraftlandsLeakInspection | null }>;
}

declare global { interface Window { __CRAFTLANDS__?: CraftlandsHandle; } }

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (element === null) throw new Error(`Craftlands host: missing ${selector}`);
  return element;
}

const canvas = requireElement<HTMLCanvasElement>("#game-canvas");
const hud = requireElement<HTMLElement>("#hud");
const statusElement = requireElement<HTMLElement>("#status");
const params = new URLSearchParams(location.search);
const mode: HostMode = params.get("test") === "1" ? "test" : "normal";
const seedParam = Number(params.get("seed"));
const distanceParam = Number(params.get("distance"));
const hostErrors: HostError[] = [];
const held = new Set<string>();
const removers: Array<() => void> = [];
const MOVE_KEYS = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);
const GAME_KEYS = new Set([...MOVE_KEYS, "Space", "ShiftLeft", "ShiftRight", "ControlLeft", "ControlRight", "Digit1", "Digit2", "Digit3", "Digit4", "Digit5", "Digit6", "Digit7", "Digit8", "Digit9", "KeyQ", "KeyE", "KeyF", "KeyT", "Slash", "Escape", "Enter", "F1", "F3", "F5"]);
let game: CraftlandsGame | null = null;
let renderer: CraftlandsRenderer | null = null;
let icons: IconPainter | null = null;
let raf: number | null = null;
let disposed = false;
let lastTime = 0;
let lastForwardTap = -1000;
let mouseX = 0;
let mouseY = 0;
/** Intentional pointer-lock exits (inventory, chat) must not read as the user pressing Esc. */
let suppressPauseUntil = 0;

function statusLine(snapshot: CraftlandsSnapshot): string {
  if (snapshot.phase === "title") return "Craftlands · click NEW WORLD, then click the world to capture the mouse";
  if (snapshot.phase === "dead") return "You died";
  const p = snapshot.player.position;
  return `${Math.floor(p.x)}, ${Math.floor(p.y)}, ${Math.floor(p.z)} · ${snapshot.target?.blockName ?? "—"} · ${snapshot.biome} · day ${snapshot.day}`;
}

// --- HUD adapter ----------------------------------------------------------------------

function slotElement(container: SlotContainer, index: number, extraClass = ""): HTMLElement {
  const element = document.createElement("div");
  element.className = `slot ${extraClass}`.trim();
  element.dataset["container"] = container;
  element.dataset["index"] = String(index);
  const count = document.createElement("span");
  element.append(count);
  return element;
}

function paintSlot(element: HTMLElement, value: SlotValue): void {
  let count = element.querySelector("span");
  if (count === null) { count = document.createElement("span"); element.append(count); }
  if (value === null || icons === null) { element.style.backgroundImage = ""; count.textContent = ""; element.querySelector(".durability")?.remove(); element.dataset["key"] = ""; return; }
  const url = icons.icon(value.key);
  const image = `url("${url}")`;
  if (element.style.backgroundImage !== image) element.style.backgroundImage = image;
  count.textContent = value.count > 1 ? String(value.count) : "";
  element.dataset["key"] = value.key;
  const tool = itemByKey(value.key)?.tool ?? null;
  let bar = element.querySelector<HTMLElement>(".durability");
  if (tool !== null && value.damage > 0) {
    if (bar === null) { bar = document.createElement("div"); bar.className = "durability"; bar.append(document.createElement("i")); element.append(bar); }
    const fraction = 1 - value.damage / tool.durability;
    const fill = bar.querySelector<HTMLElement>("i")!;
    fill.style.width = `${Math.round(fraction * 100)}%`;
    fill.style.background = fraction > 0.5 ? "#5f0" : fraction > 0.25 ? "#ff0" : "#f30";
  } else bar?.remove();
}

function createCraftlandsHudAdapter(root: HTMLElement, onAction: (action: string) => void): HudAdapter {
  const dom = createDomHudAdapter(root, { onAction });
  const hearts = requireElement<HTMLElement>("#hearts");
  const hunger = requireElement<HTMLElement>("#hunger");
  const air = requireElement<HTMLElement>("#air");
  const xpFill = requireElement<HTMLElement>("#xp-fill");
  const xpLevel = requireElement<HTMLElement>("#xp-level");
  const hotbar = requireElement<HTMLElement>("#hotbar");
  const itemName = requireElement<HTMLElement>("#item-name");
  const debug = requireElement<HTMLElement>("#debug");
  const chatLog = requireElement<HTMLElement>("#chat-log");
  const chatForm = requireElement<HTMLFormElement>("#chat-form");
  const chatInput = requireElement<HTMLInputElement>("#chat-input");
  const saved = requireElement<HTMLElement>("#saved");
  const continueButton = requireElement<HTMLButtonElement>('[data-hud-action="continue"]');
  const panel = requireElement<HTMLElement>("#panel");
  const panelTitle = requireElement<HTMLElement>("#panel-title");
  const panelTop = requireElement<HTMLElement>("#panel-top");
  const panelInventory = requireElement<HTMLElement>("#panel-inventory");
  const panelHotbar = requireElement<HTMLElement>("#panel-hotbar");
  const cursorItem = requireElement<HTMLElement>("#cursor-item");
  const tooltip = requireElement<HTMLElement>("#tooltip");
  const seedLabel = requireElement<HTMLElement>("#seed-label");
  const heartIcons: HTMLElement[] = [];
  const hungerIcons: HTMLElement[] = [];
  const airIcons: HTMLElement[] = [];
  for (let index = 0; index < 10; index += 1) {
    const heart = document.createElement("i"); hearts.append(heart); heartIcons.push(heart);
    const food = document.createElement("i"); hunger.append(food); hungerIcons.push(food);
    const bubble = document.createElement("i"); air.append(bubble); airIcons.push(bubble);
  }
  const hotbarSlots: HTMLElement[] = [];
  for (let index = 0; index < 9; index += 1) { const slot = slotElement("inventory", index); hotbar.append(slot); hotbarSlots.push(slot); }
  let lastSelectedName = "";
  let nameTimer = 0;
  let builtScreen = "";
  let panelSlots = new Map<string, HTMLElement>();
  let lastChat = "";
  let lastDebug = "";
  let lastSeed = "";

  const buildPanel = (snapshot: CraftlandsSnapshot): void => {
    panelTop.replaceChildren();
    panelInventory.replaceChildren();
    panelHotbar.replaceChildren();
    panelSlots = new Map();
    const register = (element: HTMLElement): HTMLElement => { panelSlots.set(`${element.dataset["container"]}:${element.dataset["index"]}`, element); return element; };
    const grid = (size: 2 | 3): HTMLElement => {
      const element = document.createElement("div");
      element.className = `grid ${size === 2 ? "two" : "three"}`;
      for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) element.append(register(slotElement("craft", y * 3 + x)));
      return element;
    };
    const arrow = (): HTMLElement => { const element = document.createElement("div"); element.className = "arrow"; element.append(document.createElement("i")); return element; };
    const result = (container: SlotContainer): HTMLElement => { const element = document.createElement("div"); element.className = "result"; element.append(register(slotElement(container, 0))); return element; };
    if (snapshot.screen === "inventory" && snapshot.mode === "creative") {
      panelTitle.textContent = "Creative Inventory";
      const palette = document.createElement("div"); palette.className = "grid nine palette";
      CREATIVE_ITEMS.forEach((key, index) => { const slot = slotElement("creative", index); paintSlot(slot, { key, count: 1, damage: 0 }); palette.append(slot); });
      panelTop.append(palette);
    } else if (snapshot.screen === "inventory") {
      panelTitle.textContent = "Crafting";
      const preview = document.createElement("div"); preview.className = "player-preview"; preview.textContent = "SURVIVAL";
      panelTop.append(preview, grid(2), arrow(), result("craft-result"));
    } else if (snapshot.screen === "crafting") {
      panelTitle.textContent = "Crafting";
      panelTop.append(grid(3), arrow(), result("craft-result"));
    } else if (snapshot.screen === "chest") {
      panelTitle.textContent = "Chest";
      const grid = document.createElement("div"); grid.className = "grid nine";
      for (let index = 0; index < 27; index += 1) grid.append(register(slotElement("chest", index)));
      panelTop.append(grid);
    } else if (snapshot.screen === "furnace") {
      panelTitle.textContent = "Furnace";
      const column = document.createElement("div"); column.className = "furnace-column";
      const fire = document.createElement("div"); fire.className = "fire"; fire.append(document.createElement("i"));
      column.append(register(slotElement("furnace-input", 0)), fire, register(slotElement("furnace-fuel", 0)));
      panelTop.append(column, arrow(), result("furnace-output"));
    }
    const main = document.createElement("div"); main.className = "grid nine";
    for (let index = 9; index < 36; index += 1) main.append(register(slotElement("inventory", index)));
    panelInventory.append(main);
    const bar = document.createElement("div"); bar.className = "grid nine";
    for (let index = 0; index < 9; index += 1) bar.append(register(slotElement("inventory", index)));
    panelHotbar.append(bar);
  };

  const paintPanel = (snapshot: CraftlandsSnapshot): void => {
    const key = `${snapshot.screen}:${snapshot.mode}`;
    if (key !== builtScreen) { builtScreen = key; buildPanel(snapshot); }
    snapshot.inventory.forEach((value, index) => { const element = panelSlots.get(`inventory:${index}`); if (element !== undefined) paintSlot(element, value); });
    snapshot.craftGrid.forEach((value, index) => { const element = panelSlots.get(`craft:${index}`); if (element !== undefined) paintSlot(element, value); });
    const resultSlot = panelSlots.get("craft-result:0"); if (resultSlot !== undefined) paintSlot(resultSlot, snapshot.craftResult);
    snapshot.chest?.forEach((value, index) => { const element = panelSlots.get(`chest:${index}`); if (element !== undefined) paintSlot(element, value); });
    if (snapshot.furnace !== null) {
      const input = panelSlots.get("furnace-input:0"); if (input !== undefined) paintSlot(input, snapshot.furnace.input);
      const fuel = panelSlots.get("furnace-fuel:0"); if (fuel !== undefined) paintSlot(fuel, snapshot.furnace.fuel);
      const output = panelSlots.get("furnace-output:0"); if (output !== undefined) paintSlot(output, snapshot.furnace.output);
      const fire = panelTop.querySelector<HTMLElement>(".fire i"); if (fire !== null) fire.style.height = `${Math.round(snapshot.furnace.burnFraction * 16)}px`;
      const arrowFill = panelTop.querySelector<HTMLElement>(".arrow i"); if (arrowFill !== null) arrowFill.style.width = `${Math.round(snapshot.furnace.progressFraction * 30)}px`;
    }
    cursorItem.hidden = snapshot.cursor === null;
    if (snapshot.cursor !== null) { paintSlot(cursorItem, snapshot.cursor); cursorItem.style.left = `${mouseX}px`; cursorItem.style.top = `${mouseY}px`; }
  };

  return Object.freeze({
    get disposed(): boolean { return dom.disposed; },
    render(state: HudState): void {
      try { renderHud(state); }
      catch (cause) { record("hud.render", cause instanceof Error ? `${cause.message} ${cause.stack ?? ""}` : cause); throw cause; }
    },
    inspect() { return dom.inspect(); },
    dispose(): void { dom.dispose(); },
  });

  function renderHud(state: HudState): void {
      dom.render(state);
      if (game === null || icons === null) return;
      const snapshot = game.snapshot();
      const health = Math.round(snapshot.player.health);
      heartIcons.forEach((heart, index) => { heart.style.backgroundImage = `url("${icons!.status(health >= (index + 1) * 2 ? "heart-full" : health >= index * 2 + 1 ? "heart-half" : "heart-empty")}")`; heart.style.visibility = snapshot.mode === "creative" ? "hidden" : "visible"; });
      const food = Math.round(snapshot.player.hunger);
      hungerIcons.forEach((icon, index) => { icon.style.backgroundImage = `url("${icons!.status(food >= (index + 1) * 2 ? "hunger-full" : food >= index * 2 + 1 ? "hunger-half" : "hunger-empty")}")`; icon.style.visibility = snapshot.mode === "creative" ? "hidden" : "visible"; });
      const airVisible = snapshot.mode !== "creative" && (snapshot.player.eyeInWater || snapshot.player.air < TUNING.maximumAir);
      air.hidden = !airVisible;
      if (airVisible) { const bubbles = Math.ceil(snapshot.player.air / TUNING.maximumAir * 10); airIcons.forEach((icon, index) => { icon.style.backgroundImage = index < bubbles ? `url("${icons!.status("bubble")}")` : ""; }); }
      xpFill.style.width = `${Math.round(snapshot.player.xpProgress * 100)}%`;
      xpLevel.hidden = snapshot.player.level <= 0;
      xpLevel.textContent = String(snapshot.player.level);
      hotbarSlots.forEach((slot, index) => { slot.classList.toggle("selected", index === snapshot.selectedSlot); paintSlot(slot, snapshot.hotbar[index] ?? null); });
      const selected = snapshot.hotbar[snapshot.selectedSlot] ?? null;
      const name = selected === null ? "" : itemByKey(selected.key)?.name ?? selected.key;
      if (name !== lastSelectedName) { lastSelectedName = name; itemName.textContent = name; nameTimer = 90; itemName.classList.add("show"); }
      else if (nameTimer > 0) { nameTimer -= 1; if (nameTimer === 0) itemName.classList.remove("show"); }
      root.classList.toggle("is-underwater", snapshot.player.eyeInWater);
      root.classList.toggle("is-hurt", snapshot.player.hurtTicks > 0);
      root.classList.toggle("hud-hidden", snapshot.hudHidden);
      saved.hidden = !(snapshot.lastSaveTick !== null && snapshot.tick - snapshot.lastSaveTick < 90);
      const toast = requireElement<HTMLElement>("#toast");
      const toastVisible = snapshot.toast !== null && snapshot.phase === "playing";
      if (toast.hidden === toastVisible) toast.hidden = !toastVisible;
      if (toastVisible && toast.dataset["title"] !== snapshot.toast!.title) { toast.dataset["title"] = snapshot.toast!.title; toast.querySelector("b")!.textContent = snapshot.toast!.title; (toast.querySelector<HTMLElement>(".slot")!).style.backgroundImage = `url("${icons.icon(snapshot.toast!.item)}")`; }
      const lockHint = requireElement<HTMLElement>("#lock-hint");
      lockHint.hidden = !(mode === "normal" && snapshot.phase === "playing" && snapshot.screen === "none" && !pointerLocked());
      continueButton.hidden = !snapshot.hasSave;
      const seedText = String(snapshot.seed); if (seedText !== lastSeed) { lastSeed = seedText; seedLabel.textContent = seedText; }
      const panelOpen = snapshot.phase === "playing" && (snapshot.screen === "inventory" || snapshot.screen === "crafting" || snapshot.screen === "furnace" || snapshot.screen === "chest");
      panel.hidden = !panelOpen;
      if (panelOpen) paintPanel(snapshot); else { tooltip.hidden = true; cursorItem.hidden = true; }
      const chatOpen = snapshot.phase === "playing" && snapshot.screen === "chat";
      if (chatForm.hidden === chatOpen) { chatForm.hidden = !chatOpen; if (chatOpen) { chatInput.value = chatInput.dataset["prefill"] ?? ""; chatInput.dataset["prefill"] = ""; chatInput.focus(); } }
      const chatText = snapshot.chatLog.join("\n");
      if (chatText !== lastChat) { lastChat = chatText; chatLog.replaceChildren(...snapshot.chatLog.map((line) => { const div = document.createElement("div"); div.textContent = line; return div; })); }
      debug.hidden = !snapshot.debug || snapshot.phase !== "playing";
      if (!debug.hidden) {
        const extras = state.extras;
        const lines = [String(extras["version"]), `${Math.round(1 / Math.max(1 / 240, frameSeconds))} fps · ${snapshot.loadedChunks} chunks · E: ${snapshot.mobs.length + snapshot.items.length}`, "", `XYZ: ${extras["coords"]}`, `Block: ${extras["block"]}`, `Chunk: ${extras["chunk"]}`, `Facing: ${extras["facing"]}`, `Light: ${extras["light"]}`, `Biome: ${extras["biome"]}`, `Day ${snapshot.day} · ${extras["clock"]} · Seed ${snapshot.seed}`, `Mode: ${snapshot.mode}${snapshot.player.flying ? " (flying)" : ""}`, snapshot.target === null ? "" : `Targeted: ${snapshot.target.blockKey} @ ${extras["targetPos"]}`];
        const text = lines.join("\n");
        if (text !== lastDebug) { lastDebug = text; debug.replaceChildren(...lines.map((line) => { const span = document.createElement("span"); span.textContent = line; return span; }).flatMap((span) => [span, document.createTextNode("\n")])); }
      }
  }
}

let frameSeconds = 1 / 60;

function createSaveAdapter(): SaveAdapter {
  if (mode === "test") return createInMemorySaveAdapter();
  try { if (typeof localStorage !== "undefined") return createBrowserStorageSaveAdapter(localStorage, "craftlands:"); } catch { /* private mode */ }
  return createInMemorySaveAdapter();
}

function listen<T extends EventTarget>(target: T, type: string, listener: EventListener, options?: AddEventListenerOptions): void {
  target.addEventListener(type, listener, options);
  removers.push(() => target.removeEventListener(type, listener, options));
}

function record(source: string, cause: unknown): void {
  const message = cause instanceof Error ? cause.message : String(cause);
  if (hostErrors.length >= 64) hostErrors.shift();
  hostErrors.push(Object.freeze({ source, message }));
  statusElement.textContent = `Runtime error: ${message}`;
}

function renderNow(): void {
  if (game === null) return;
  game.present(performance.now());
  statusElement.textContent = statusLine(game.snapshot());
}

function stepTestFrame(): void {
  if (mode === "test") { game?.advance(1 / 60); renderNow(); }
}

function updateMove(): void {
  const x = (held.has("KeyD") || held.has("ArrowRight") ? 1 : 0) - (held.has("KeyA") || held.has("ArrowLeft") ? 1 : 0);
  const z = (held.has("KeyS") || held.has("ArrowDown") ? 1 : 0) - (held.has("KeyW") || held.has("ArrowUp") ? 1 : 0);
  game?.setMove(x, z);
}

function pointerLocked(): boolean {
  return document.pointerLockElement === canvas;
}

/** Pointer lock can be refused (no user gesture, sandboxed frame); that is not a game error. */
function lockPointer(): void {
  try {
    const outcome = canvas.requestPointerLock?.() as unknown;
    if (outcome instanceof Promise) outcome.catch(() => undefined);
  } catch { /* ignored */ }
}

function uiCaptured(): boolean {
  const snapshot = game?.snapshot();
  return snapshot === undefined || snapshot.phase !== "playing" || snapshot.screen !== "none";
}

listen(window, "keydown", ((event: KeyboardEvent) => {
  unlockAudio();
  const snapshot = game?.snapshot();
  if (snapshot?.screen === "chat") {
    if (event.code === "Escape") { event.preventDefault(); game?.press("escape"); stepTestFrame(); if (mode === "normal") lockPointer(); }
    return;
  }
  if (!GAME_KEYS.has(event.code)) return;
  event.preventDefault();
  if (event.repeat) return;
  held.add(event.code);
  if (MOVE_KEYS.has(event.code)) {
    updateMove();
    if (event.code === "KeyW" || event.code === "ArrowUp") { const now = performance.now(); if (now - lastForwardTap < 300) game?.press("sprint-start"); lastForwardTap = now; }
  }
  else if (event.code === "Space") game?.press("jump");
  else if (event.code === "ShiftLeft" || event.code === "ShiftRight") game?.press("sneak-start");
  else if (event.code === "ControlLeft" || event.code === "ControlRight") game?.press("sprint-start");
  else if (event.code.startsWith("Digit")) game?.press(`select-${event.code.slice(5)}` as Action);
  else if (event.code === "KeyQ") game?.press("drop");
  else if (event.code === "KeyE") { const open = snapshot?.screen !== "none"; game?.press("inventory"); if (mode === "normal") { if (!open && pointerLocked()) { suppressPauseUntil = performance.now() + 500; document.exitPointerLock(); } else if (open) lockPointer(); } }
  else if (event.code === "KeyF") game?.press("save");
  else if (event.code === "KeyT" || event.code === "Slash") { if (snapshot?.phase === "playing" && snapshot.screen === "none") { requireElement<HTMLInputElement>("#chat-input").dataset["prefill"] = event.code === "Slash" ? "/" : ""; game?.press("chat"); if (mode === "normal" && pointerLocked()) { suppressPauseUntil = performance.now() + 500; document.exitPointerLock(); } } }
  else if (event.code === "Escape") { const optionsScreen = document.querySelector<HTMLElement>("#options"); if (optionsScreen !== null && !optionsScreen.hidden) { optionsScreen.hidden = true; saveOptions(); } else { const closingScreen = snapshot?.phase === "playing" && snapshot.screen !== "none"; game?.press("escape"); if (closingScreen && mode === "normal") lockPointer(); } }
  else if (event.code === "F1") game?.press("toggle-hud");
  else if (event.code === "F3") game?.press("toggle-debug");
  else if (event.code === "F5") game?.press("toggle-perspective");
  else if (event.code === "Enter") { const phase = snapshot?.phase; if (phase === "title") game?.press("start"); else if (phase === "dead") game?.press("respawn"); else if (phase === "paused") game?.press("continue"); }
  stepTestFrame();
}) as EventListener);
listen(window, "keyup", ((event: KeyboardEvent) => {
  if (!GAME_KEYS.has(event.code)) return;
  held.delete(event.code);
  if (MOVE_KEYS.has(event.code)) { updateMove(); if ((event.code === "KeyW" || event.code === "ArrowUp") && !held.has("ControlLeft") && !held.has("ControlRight")) game?.press("sprint-end"); }
  else if (event.code === "ShiftLeft" || event.code === "ShiftRight") game?.press("sneak-end");
  else if (event.code === "ControlLeft" || event.code === "ControlRight") game?.press("sprint-end");
  stepTestFrame();
}) as EventListener);
listen(window, "blur", (() => { held.clear(); updateMove(); game?.press("sprint-end"); game?.press("sneak-end"); game?.press("attack-end"); game?.press("use-end"); }) as EventListener);
listen(canvas, "click", (() => {
  if (mode === "normal" && game?.snapshot().phase === "playing" && game.snapshot().screen === "none" && !pointerLocked()) lockPointer();
}) as EventListener);
listen(document, "mousemove", ((event: MouseEvent) => {
  mouseX = event.clientX;
  mouseY = event.clientY;
  const cursorItem = document.querySelector<HTMLElement>("#cursor-item");
  if (cursorItem !== null && !cursorItem.hidden) { cursorItem.style.left = `${mouseX}px`; cursorItem.style.top = `${mouseY}px`; }
  const tooltip = document.querySelector<HTMLElement>("#tooltip");
  const slot = (event.target as HTMLElement | null)?.closest<HTMLElement>(".panel .slot") ?? null;
  if (tooltip !== null) {
    const key = slot?.dataset["key"] ?? "";
    const item = key === "" ? undefined : itemByKey(key);
    if (item !== undefined && game?.snapshot().cursor === null) {
      tooltip.hidden = false;
      tooltip.replaceChildren(document.createTextNode(item.name));
      const kind = item.tool !== null ? `${item.tool.type} · ${item.tool.durability - 0} durability` : item.food !== null ? `Food · ${item.food.hunger / 2} hunger` : item.block !== null ? "Block" : "Material";
      const small = document.createElement("small"); small.textContent = kind; tooltip.append(small);
      tooltip.style.left = `${mouseX + 14}px`; tooltip.style.top = `${mouseY - 10}px`;
    } else tooltip.hidden = true;
  }
  if (!pointerLocked() && mode === "normal") return;
  if (uiCaptured()) return;
  const sensitivity = 0.0022 * options.sensitivity / 100;
  game?.look(-event.movementX * sensitivity, -event.movementY * sensitivity);
}) as EventListener);
listen(document, "mousedown", ((event: MouseEvent) => {
  unlockAudio();
  const slot = (event.target as HTMLElement | null)?.closest<HTMLElement>(".slot[data-container]") ?? null;
  if (slot !== null && game?.snapshot().screen !== "none" && game?.snapshot().phase === "playing") {
    event.preventDefault();
    game.clickSlot(slot.dataset["container"] as SlotContainer, Number(slot.dataset["index"]), event.button === 2 ? "right" : "left", event.shiftKey);
    stepTestFrame();
    return;
  }
  if (event.target !== canvas) return;
  if (mode === "normal" && !pointerLocked()) return;
  if (event.button === 0) game?.press("attack-start");
  if (event.button === 2) { event.preventDefault(); game?.press("use-start"); }
  stepTestFrame();
}) as EventListener);
listen(document, "mouseup", ((event: MouseEvent) => {
  if (event.button === 0) game?.press("attack-end");
  if (event.button === 2) game?.press("use-end");
  stepTestFrame();
}) as EventListener);
listen(document, "contextmenu", ((event: Event) => { if ((event.target as HTMLElement | null)?.closest("#hud, #game-canvas") !== null) event.preventDefault(); }) as EventListener);
listen(canvas, "wheel", ((event: WheelEvent) => {
  if (!pointerLocked() && mode === "normal") return;
  event.preventDefault();
  game?.press(event.deltaY > 0 ? "next-slot" : "previous-slot");
  stepTestFrame();
}) as EventListener, { passive: false });
listen(document, "pointerlockchange", (() => { if (!pointerLocked()) { held.clear(); updateMove(); game?.press("attack-end"); game?.press("use-end"); const snapshot = game?.snapshot(); if (mode === "normal" && performance.now() > suppressPauseUntil && snapshot?.phase === "playing" && snapshot.screen === "none") game?.press("escape"); } }) as EventListener);
listen(window, "resize", (() => renderer?.resize()) as EventListener);
listen(window, "error", ((event: ErrorEvent) => record("window.error", event.error ?? event.message)) as EventListener);
listen(window, "unhandledrejection", ((event: PromiseRejectionEvent) => record("unhandledrejection", event.reason)) as EventListener);

// --- Audio: the public Audio Feature runtime driven by rule events -------------------------

let audioContext: AudioContext | null = null;
let audio: AudioRuntime | null = null;
let audioUnlocked = false;
let clipCount = 0;

function createAudio(): AudioRuntime {
  if (mode === "test" || typeof AudioContext === "undefined") return createAudioRuntime(createSilentAudioDriver());
  try {
    audioContext = new AudioContext();
    const runtime = createAudioRuntime(createWebAudioDriver(audioContext));
    const bank = synthesiseSoundBank(audioContext);
    for (const [id, buffer] of bank.buffers) runtime.registerClip(id, buffer);
    clipCount = bank.buffers.size;
    return runtime;
  } catch {
    audioContext = null;
    return createAudioRuntime(createSilentAudioDriver());
  }
}

function unlockAudio(): void {
  if (audio === null || audioUnlocked) return;
  audioUnlocked = true;
  void audio.unlock().then((outcome) => { if (!outcome.ok) audioUnlocked = false; });
}

function pitch(seed: number, spread = 0.12): number {
  const h = Math.sin(seed * 12.9898) * 43758.5453;
  return 1 + ((h - Math.floor(h)) * 2 - 1) * spread;
}

function playSound(id: string, volume = 1, rate = 1, position?: { x: number; y: number; z: number }): void {
  if (audio === null || !audioUnlocked || clipCount === 0) return;
  audio.playEffect(id, { volume: Math.max(0, Math.min(1, volume * soundVolume)), playbackRate: rate, ...(position === undefined ? {} : { position }) });
}

let soundVolume = 1;

function wireSounds(target: CraftlandsGame): void {
  const mobAt = (id: number | undefined) => id === undefined ? undefined : target.snapshot().mobs.find((mob) => mob.id === id)?.position;
  const family = (subject: string | undefined): string => { const known = ["stone", "grass", "gravel", "sand", "wood", "cloth", "glass", "snow"]; if (subject !== undefined && known.includes(subject)) return subject; const block = blockByKey(subject ?? ""); return block !== undefined && block.sound !== "none" ? block.sound : "stone"; };
  target.subscribe((event) => {
    const tick = event.tick;
    switch (event.kind) {
      case "step": playSound(`step.${family(event.subject)}`, 0.5, pitch(tick, 0.1)); break;
      case "landed": playSound(`step.${family(event.subject)}`, 0.9, 0.85); break;
      case "hard-landing": playSound("fall", 1, 1); break;
      case "mining-hit": playSound(`hit.${family(event.subject)}`, 0.5, pitch(tick, 0.08)); break;
      case "block-mined": playSound(`dig.${family(event.subject)}`, 1, pitch(tick, 0.1)); break;
      case "block-placed": playSound(`dig.${family(event.subject)}`, 0.8, pitch(tick, 0.08) * 0.9); break;
      case "player-damaged": playSound("hurt", 1, pitch(tick, 0.06)); break;
      case "player-died": playSound("death", 1, 1); break;
      case "ate": playSound("burp", 0.7, 1); break;
      case "eating": playSound("eat", 1, pitch(tick, 0.05)); break;
      case "item-collected": playSound("pop", 0.7, pitch(tick, 0.2) * 1.1); break;
      case "xp": playSound("orb", 0.5, pitch(tick, 0.25)); break;
      case "level-up": playSound("levelup", 0.8, 1); break;
      case "crafted": playSound("click", 0.6, 1); break;
      case "attack": playSound("punch", 0.9, pitch(tick, 0.1)); break;
      case "mob-hurt": { const kind = event.subject ?? "pig"; playSound(`mob.${kind === "creeper" ? "creeper" : kind}`, 0.9, 0.8, mobAt(event.value)); break; }
      case "mob-killed": playSound(`mob.${event.subject ?? "pig"}`, 0.9, 0.6); break;
      case "mob-say": playSound(`mob.${event.subject ?? "pig"}`, 0.8, pitch(tick, 0.1), mobAt(event.value)); break;
      case "creeper-fuse": playSound("fuse", 1, 1, mobAt(event.value)); break;
      case "explosion": playSound("explode", 1, pitch(tick, 0.1)); break;
      case "splash": playSound("splash", 0.8, pitch(tick, 0.1)); break;
      case "screen-opened": case "screen-closed": playSound("click", 0.3, 1.2); break;
      default: break;
    }
  });
}

function updateListener(snapshot: CraftlandsSnapshot): void {
  if (audioContext === null) return;
  const listener = audioContext.listener;
  const p = snapshot.player.position;
  const fx = -Math.sin(snapshot.player.yaw);
  const fz = -Math.cos(snapshot.player.yaw);
  if ("positionX" in listener && listener.positionX !== undefined) {
    listener.positionX.value = p.x; listener.positionY.value = p.y + snapshot.player.eyeHeight; listener.positionZ.value = p.z;
    listener.forwardX.value = fx; listener.forwardY.value = 0; listener.forwardZ.value = fz;
    listener.upX.value = 0; listener.upY.value = 1; listener.upZ.value = 0;
  }
}

// --- Options (persisted per browser) -------------------------------------------------------

interface Options { distance: number; fov: number; sensitivity: number; volume: number; }
const OPTIONS_KEY = "craftlands:options";
const options: Options = { distance: 6, fov: 70, sensitivity: 100, volume: 100 };

function loadOptions(): void {
  if (mode === "test") return;
  try {
    const raw = localStorage.getItem(OPTIONS_KEY);
    if (raw === null) return;
    const parsed = JSON.parse(raw) as Partial<Record<keyof Options, unknown>>;
    for (const key of ["distance", "fov", "sensitivity", "volume"] as const) { const value = Number(parsed[key]); if (Number.isFinite(value)) options[key] = value; }
  } catch { /* ignored */ }
}

function saveOptions(): void {
  if (mode === "test") return;
  try { localStorage.setItem(OPTIONS_KEY, JSON.stringify(options)); } catch { /* ignored */ }
}

function applyOptions(): void {
  soundVolume = options.volume / 100;
  renderer?.setBaseFov(options.fov);
  if (game !== null && game.inspectWorld().simulationDistance !== options.distance) game.setSimulationDistance(options.distance);
  for (const input of document.querySelectorAll<HTMLInputElement>("input[data-option]")) {
    const key = input.dataset["option"] as keyof Options;
    input.value = String(options[key]);
    const label = document.querySelector<HTMLElement>(`[data-option-value="${key}"]`);
    if (label !== null) label.textContent = String(options[key]);
    const fill = (options[key] - Number(input.min)) / (Number(input.max) - Number(input.min));
    input.parentElement?.style.setProperty("--fill", `${Math.round(fill * 100)}%`);
  }
}

function wireOptions(): void {
  const screen = requireElement<HTMLElement>("#options");
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-options]")) {
    listen(button, "click", (() => { unlockAudio(); playSound("click", 0.6, 1); screen.hidden = button.dataset["options"] !== "open"; if (screen.hidden) saveOptions(); }) as EventListener);
  }
  for (const input of document.querySelectorAll<HTMLInputElement>("input[data-option]")) {
    listen(input, "input", (() => { const key = input.dataset["option"] as keyof Options; options[key] = Number(input.value); applyOptions(); }) as EventListener);
    listen(input, "change", (() => { saveOptions(); playSound("click", 0.4, 1.2); }) as EventListener);
  }
}

function boot(): void {
  renderer = createCraftlandsRenderer(canvas, mode === "test");
  audio = createAudio();
  loadOptions();
  wireOptions();
  icons = createIconPainter(renderer.atlasCanvas);
  requireElement<HTMLElement>(".title-bg").style.backgroundImage = `url("${icons.dirt()}")`;
  const splashes = ["A three-game-kit showcase!", "Punch trees!", "Now with creepers!", "Also try Deepfield!", "0 bytes of assets!", "Flood-fill lighting!", "Craft a pickaxe!", "Beware the night!", "Infinite-ish!", "Diamonds below y=16!"];
  requireElement<HTMLElement>("#splash").textContent = splashes[Math.floor((Date.now() / 60_000) % splashes.length)] ?? splashes[0]!;
  const help = requireElement<HTMLElement>("#help");
  listen(requireElement<HTMLButtonElement>("#btn-help"), "click", (() => { help.hidden = !help.hidden; }) as EventListener);
  listen(requireElement<HTMLButtonElement>("#btn-seed"), "click", (() => { const next = prompt("World seed (number)", String(game?.snapshot().seed ?? "")); if (next !== null && Number.isSafeInteger(Number(next)) && Number(next) > 0) { const url = new URL(location.href); url.searchParams.set("seed", next); location.href = url.toString(); } }) as EventListener);
  const chatForm = requireElement<HTMLFormElement>("#chat-form");
  const chatInput = requireElement<HTMLInputElement>("#chat-input");
  listen(chatForm, "submit", ((event: Event) => { event.preventDefault(); game?.command(chatInput.value); chatInput.value = ""; stepTestFrame(); if (mode === "normal") lockPointer(); }) as EventListener);
  const adapter = createCraftlandsHudAdapter(hud, (action) => {
    unlockAudio();
    playSound("click", 0.6, 1);
    if (action === "start") game?.start();
    if (action === "continue") game?.continueWorld();
    if (action === "respawn") game?.press("respawn");
    if (action === "quit") game?.press("quit");
    if (action === "save") game?.press("save");
    if (action === "mode") { const current = game?.snapshot().mode; game?.setMode(current === "creative" ? "survival" : "creative"); }
    stepTestFrame();
    if (mode === "normal" && (action === "start" || action === "continue" || action === "respawn")) lockPointer();
  });
  game = createCraftlandsGame({ renderer, hudAdapter: adapter, saveAdapter: createSaveAdapter(), testMode: mode === "test", audio, ...(Number.isSafeInteger(seedParam) && seedParam > 0 ? { seed: seedParam } : {}), ...(Number.isSafeInteger(distanceParam) && distanceParam > 0 ? { simulationDistance: distanceParam } : {}) });
  wireSounds(game);
  if (Number.isSafeInteger(distanceParam) && distanceParam > 0) options.distance = distanceParam;
  else if (mode === "test") options.distance = game.inspectWorld().simulationDistance;
  applyOptions();
  if (mode === "test") { queueMicrotask(() => renderNow()); return; }
  lastTime = performance.now();
  const frame = (time: number): void => {
    if (disposed || game === null) return;
    const seconds = Math.min(0.1, Math.max(0, (time - lastTime) / 1_000));
    frameSeconds = frameSeconds * 0.9 + seconds * 0.1;
    lastTime = time;
    game.advance(seconds);
    game.present(time);
    const snapshot = game.snapshot();
    updateListener(snapshot);
    statusElement.textContent = statusLine(snapshot);
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
}

const handle: CraftlandsHandle = Object.freeze({
  get ready() { return !disposed && game?.inspectRuntime().lifecycleState === "running"; },
  get screenshotReady() { return renderer?.screenshotReady ?? false; },
  get mode() { return mode; },
  get status() { return statusElement.textContent ?? ""; },
  start() { game?.start(); stepTestFrame(); },
  continueWorld() { game?.continueWorld(); stepTestFrame(); },
  dispose() {
    if (disposed) return;
    disposed = true;
    if (raf !== null) { cancelAnimationFrame(raf); raf = null; }
    if (pointerLocked()) document.exitPointerLock();
    game?.dispose();
    for (const remove of removers.splice(0)) remove();
    held.clear();
    statusElement.textContent = "Craftlands disposed";
  },
  setMove(x: number, z: number) { game?.setMove(x, z); },
  setLook(yaw: number, pitch: number) { game?.setLook(yaw, pitch); },
  look(deltaYaw: number, deltaPitch: number) { game?.look(deltaYaw, deltaPitch); },
  setHeld(patch: Partial<HeldInput>) { game?.setHeld(patch); },
  press(action: Action) { game?.press(action); },
  clickSlot(container: SlotContainer, index: number, button: "left" | "right" = "left", shift = false) { game?.clickSlot(container, index, button, shift); },
  command(text: string) { game?.command(text); },
  give(key: string, count: number) { game?.give(key, count); },
  setMode(next: GameMode) { game?.setMode(next); },
  setOption(key: keyof Options, value: number) { options[key] = value; applyOptions(); stepTestFrame(); },
  advance(seconds: number) { const steps = game?.advance(seconds) ?? 0; renderNow(); return steps; },
  loadScenario(id: Scenario) { game?.loadScenario(id); game?.advance(1 / 60); renderNow(); },
  setTimeOfDay(fraction: number) { game?.setTimeOfDay(fraction); game?.advance(1 / 60); renderNow(); },
  snapshot() { if (game === null) throw new Error("Craftlands is not booted"); return game.snapshot(); },
  events() { return game?.events() ?? Object.freeze([]); },
  errors() { const runtime = game?.errors().map((error) => Object.freeze({ source: "runtime", message: `${error.code}: ${error.message} [${error.operation} ${error.featureId ?? ""} tick ${error.tick ?? "?"}] ${JSON.stringify(error.context ?? [])}` })) ?? []; const rules = game?.ruleFailures().map((failure) => Object.freeze({ source: `rules@${failure.tick}`, message: failure.message })) ?? []; return Object.freeze([...hostErrors, ...runtime, ...rules]); },
  inspectRuntime() { return game?.inspectRuntime() ?? null; },
  inspectRenderer() { return game?.inspectRenderer() ?? null; },
  inspectWorld() { return game?.inspectWorld() ?? null; },
  inspectSave() { return game?.inspectSave() ?? null; },
  inspectInventory() { return game?.inspectInventory() ?? null; },
  inspectLeaks() { return Object.freeze({ hostListeners: removers.length, rafActive: raf !== null, pointerLocked: pointerLocked(), hostDisposed: disposed, game: game?.inspectLeaks() ?? null }); },
});

window.__CRAFTLANDS__ = handle;
boot();
