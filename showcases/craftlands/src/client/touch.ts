/// <reference lib="dom" />
/**
 * Touch controls in the spirit of Minecraft's pocket edition: a floating joystick on the left half
 * (push to the rim to sprint), drag on the right half to look, tap to place / use, long-press to
 * mine / attack (or eat when holding food), plus jump, sneak, inventory and pause buttons.
 * The host stays framework-neutral: this module only calls the game handle's public input methods.
 */
import type { Action, CraftlandsSnapshot, HeldInput } from "../shared/state.js";
import { itemByKey } from "../shared/items.js";

export interface TouchTarget {
  snapshot(): CraftlandsSnapshot | null;
  press(action: Action): void;
  setMove(x: number, z: number): void;
  setHeld(patch: Partial<HeldInput>): void;
  look(deltaYaw: number, deltaPitch: number): void;
  sensitivity(): number;
  onGesture(): void;
}

export interface TouchControls { readonly active: boolean; dispose(): void; inspect(): Readonly<{ moveTouch: boolean; lookTouch: boolean; holding: string | null; sneaking: boolean }>; }

const JOYSTICK_RADIUS = 56;
const HOLD_MS = 280;
const TAP_SLOP = 14;

export function detectTouchDevice(): boolean {
  if (typeof window === "undefined") return false;
  const coarse = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
  return coarse || navigator.maxTouchPoints > 0;
}

export function installTouchControls(root: HTMLElement, canvas: HTMLCanvasElement, target: TouchTarget): TouchControls {
  const joystick = root.querySelector<HTMLElement>("#joystick");
  const knob = root.querySelector<HTMLElement>("#joystick i");
  const buttons = [...root.querySelectorAll<HTMLElement>("[data-touch]")];
  const removers: Array<() => void> = [];
  const listen = <T extends EventTarget>(element: T, type: string, handler: EventListener, options?: AddEventListenerOptions): void => {
    element.addEventListener(type, handler, options);
    removers.push(() => element.removeEventListener(type, handler, options));
  };

  let moveId: number | null = null;
  let moveOrigin = { x: 0, y: 0 };
  let sprintArmedAt = 0;
  let sprinting = false;
  let lookId: number | null = null;
  let lookLast = { x: 0, y: 0 };
  let lookStart = { x: 0, y: 0, time: 0 };
  let lookMoved = 0;
  let holdTimer: ReturnType<typeof setTimeout> | null = null;
  let holding: "attack" | "use" | null = null;
  let sneaking = false;

  const playing = (): boolean => { const s = target.snapshot(); return s !== null && s.phase === "playing" && s.screen === "none"; };

  const stopMove = (): void => {
    moveId = null;
    target.setMove(0, 0);
    if (sprinting) { sprinting = false; target.press("sprint-end"); }
    if (joystick !== null) joystick.hidden = true;
  };

  const stopLook = (): void => {
    if (holdTimer !== null) { clearTimeout(holdTimer); holdTimer = null; }
    if (holding === "attack") target.setHeld({ attack: false });
    if (holding === "use") target.setHeld({ use: false });
    holding = null;
    lookId = null;
  };

  const beginHold = (): void => {
    holdTimer = null;
    if (lookId === null || !playing()) return;
    const held = target.snapshot()?.heldItem ?? null;
    const food = held !== null && itemByKey(held.key)?.food !== null && itemByKey(held.key) !== undefined;
    holding = food ? "use" : "attack";
    target.setHeld(food ? { use: true } : { attack: true });
  };

  const tap = (): void => {
    if (!playing()) return;
    target.setHeld({ use: true });
    setTimeout(() => target.setHeld({ use: false }), 50);
  };

  listen(canvas, "touchstart", ((event: TouchEvent) => {
    target.onGesture();
    if (!playing()) return;
    event.preventDefault();
    for (const touch of Array.from(event.changedTouches)) {
      const leftHalf = touch.clientX < innerWidth * 0.45;
      if (leftHalf && moveId === null) {
        moveId = touch.identifier;
        moveOrigin = { x: touch.clientX, y: touch.clientY };
        sprintArmedAt = 0;
        if (joystick !== null) { joystick.hidden = false; joystick.style.left = `${moveOrigin.x}px`; joystick.style.top = `${moveOrigin.y}px`; }
        if (knob !== null) knob.style.transform = "translate(-50%, -50%)";
      } else if (lookId === null) {
        lookId = touch.identifier;
        lookLast = { x: touch.clientX, y: touch.clientY };
        lookStart = { x: touch.clientX, y: touch.clientY, time: performance.now() };
        lookMoved = 0;
        holdTimer = setTimeout(beginHold, HOLD_MS);
      }
    }
  }) as EventListener, { passive: false });

  listen(canvas, "touchmove", ((event: TouchEvent) => {
    if (moveId === null && lookId === null) return;
    event.preventDefault();
    for (const touch of Array.from(event.changedTouches)) {
      if (touch.identifier === moveId) {
        let dx = touch.clientX - moveOrigin.x;
        let dy = touch.clientY - moveOrigin.y;
        const length = Math.hypot(dx, dy);
        const magnitude = Math.min(1, length / JOYSTICK_RADIUS);
        if (length > JOYSTICK_RADIUS) { dx *= JOYSTICK_RADIUS / length; dy *= JOYSTICK_RADIUS / length; }
        if (knob !== null) knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
        const nx = length === 0 ? 0 : (dx / JOYSTICK_RADIUS);
        const nz = length === 0 ? 0 : (dy / JOYSTICK_RADIUS);
        target.setMove(nx, nz);
        // Pushing the stick to the rim for a moment sprints, like the pocket edition.
        const now = performance.now();
        if (magnitude >= 0.97 && nz < -0.3) { if (sprintArmedAt === 0) sprintArmedAt = now; else if (!sprinting && now - sprintArmedAt > 250) { sprinting = true; target.press("sprint-start"); } }
        else { sprintArmedAt = 0; if (sprinting && magnitude < 0.75) { sprinting = false; target.press("sprint-end"); } }
      } else if (touch.identifier === lookId) {
        const dx = touch.clientX - lookLast.x;
        const dy = touch.clientY - lookLast.y;
        lookLast = { x: touch.clientX, y: touch.clientY };
        lookMoved += Math.hypot(dx, dy);
        if (holdTimer !== null && lookMoved > TAP_SLOP) { clearTimeout(holdTimer); holdTimer = null; }
        const k = 0.0055 * target.sensitivity();
        target.look(-dx * k, -dy * k);
      }
    }
  }) as EventListener, { passive: false });

  const endTouch = (event: TouchEvent): void => {
    if (moveId === null && lookId === null) return;
    event.preventDefault();
    for (const touch of Array.from(event.changedTouches)) {
      if (touch.identifier === moveId) stopMove();
      else if (touch.identifier === lookId) {
        const quick = performance.now() - lookStart.time < HOLD_MS && lookMoved <= TAP_SLOP && holding === null;
        stopLook();
        if (quick) tap();
      }
    }
  };
  listen(canvas, "touchend", endTouch as EventListener, { passive: false });
  listen(canvas, "touchcancel", endTouch as EventListener, { passive: false });

  for (const button of buttons) {
    const action = button.dataset["touch"] ?? "";
    listen(button, "touchstart", ((event: TouchEvent) => {
      event.preventDefault();
      event.stopPropagation();
      target.onGesture();
      button.classList.add("pressed");
      switch (action) {
        case "jump": target.setHeld({ jump: true }); break;
        case "sneak": sneaking = !sneaking; target.setHeld({ sneak: sneaking }); button.classList.toggle("active", sneaking); break;
        case "inventory": target.press("inventory"); break;
        case "pause": target.press("escape"); break;
        case "drop": target.press("drop"); break;
        case "perspective": target.press("toggle-perspective"); break;
        default: break;
      }
    }) as EventListener, { passive: false });
    const release = ((event: TouchEvent) => {
      event.preventDefault();
      event.stopPropagation();
      button.classList.remove("pressed");
      if (action === "jump") target.setHeld({ jump: false });
    }) as EventListener;
    listen(button, "touchend", release, { passive: false });
    listen(button, "touchcancel", release, { passive: false });
  }

  return Object.freeze({
    get active(): boolean { return true; },
    inspect() { return Object.freeze({ moveTouch: moveId !== null, lookTouch: lookId !== null, holding, sneaking }); },
    dispose(): void {
      stopMove();
      stopLook();
      for (const remove of removers.splice(0)) remove();
    },
  });
}
