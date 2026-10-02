import { createInputExperienceRuntime } from "@three-game-kit/client/advanced";
import type { Action } from "./world.js";

interface InputTarget {
  playing(): boolean;
  setMove(x: number, z: number, run: boolean): void;
  press(action: Action): void;
  look(deltaYaw: number): void;
}

/** Browser adapter only: all gameplay still uses the desktop semantic input path. */
export function installCourtControls(
  root: HTMLElement,
  canvas: HTMLCanvasElement,
  target: InputTarget,
) {
  const joystick = root.querySelector<HTMLElement>("#move-stick")!;
  const knob = joystick.querySelector<HTMLElement>("i")!;
  const runButton = root.querySelector<HTMLButtonElement>("#touch-run")!;
  const jumpButton = root.querySelector<HTMLButtonElement>("#touch-jump")!;
  const interactButton = root.querySelector<HTMLButtonElement>(
    '[data-hud-action="interact"]',
  )!;
  const input = createInputExperienceRuntime({
    contexts: { gameplay: { jump: ["touch:jump"], interact: ["touch:interact"] } },
    initialContext: "gameplay",
    deadZone: 0.12,
    // Leave floating-point headroom for the public unit-disc movement contract.
    sensitivity: 1 - Number.EPSILON * 4,
  });
  const removers: Array<() => void> = [];
  const captures = new Map<number, HTMLElement>();
  let disposed = false,
    running = false;
  let moveId: number | null = null,
    lookId: number | null = null;
  let origin = { x: 0, y: 0 },
    lastX = 0;
  const radius = 42;
  function listen(element: EventTarget, type: string, fn: EventListener) {
    element.addEventListener(type, fn);
    removers.push(() => element.removeEventListener(type, fn));
  }
  function enableTouch() {
    document.body.classList.add("touch-controls-enabled");
  }
  if (navigator.maxTouchPoints > 0 || matchMedia("(any-pointer: coarse)").matches)
    enableTouch();
  function capture(element: HTMLElement, id: number) {
    element.setPointerCapture(id);
    captures.set(id, element);
  }
  function release(id: number) {
    const element = captures.get(id);
    captures.delete(id);
    if (element?.hasPointerCapture(id)) element.releasePointerCapture(id);
  }
  function publishMovement() {
    const command = input.sample();
    target.setMove(command.x, command.z, running);
  }
  function reset() {
    moveId = lookId = null;
    for (const id of captures.keys()) release(id);
    running = false;
    runButton.setAttribute("aria-pressed", "false");
    knob.style.transform = "translate(-50%, -50%)";
    if (!disposed) {
      input.disconnectDevice("court");
      input.drainActions();
      target.setMove(0, 0, false);
    }
  }
  listen(joystick, "pointerdown", (raw) => {
    const e = raw as PointerEvent;
    if (
      !target.playing() || moveId !== null || e.button !== 0 ||
      !Number.isFinite(e.clientX) || !Number.isFinite(e.clientY)
    ) return;
    e.preventDefault();
    const bounds = joystick.getBoundingClientRect();
    origin = {
      x: bounds.left + bounds.width / 2,
      y: bounds.top + bounds.height / 2,
    };
    moveId = e.pointerId;
    capture(joystick, moveId);
    move(e);
  });
  function move(e: PointerEvent) {
    if (
      e.pointerId !== moveId ||
      !Number.isFinite(e.clientX) || !Number.isFinite(e.clientY)
    ) return;
    const dx = e.clientX - origin.x,
      dy = e.clientY - origin.y;
    const length = Math.hypot(dx, dy);
    if (!Number.isFinite(length)) return;
    const scale = length > radius ? radius / length : 1;
    const x = dx * scale,
      z = dy * scale;
    knob.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${z}px))`;
    input.updateTouch("court", x / radius, z / radius);
    publishMovement();
  }
  listen(joystick, "pointermove", (raw) => move(raw as PointerEvent));
  function stopMove(raw: Event) {
    const id = (raw as PointerEvent).pointerId;
    if (id !== moveId) return;
    moveId = null;
    release(id);
    input.disconnectDevice("court");
    knob.style.transform = "translate(-50%, -50%)";
    publishMovement();
  }
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"])
    listen(joystick, type, stopMove);

  // Canvas-only listeners exclude every HUD, joystick and action-button touch.
  // Client coordinates avoid unreliable movementX and multi-touch pointer jumps.
  listen(canvas, "pointerdown", (raw) => {
    const e = raw as PointerEvent;
    if (e.pointerType === "touch") enableTouch();
    if (
      !target.playing() || lookId !== null || e.button !== 0 ||
      !Number.isFinite(e.clientX)
    ) return;
    e.preventDefault();
    lookId = e.pointerId;
    lastX = e.clientX;
    capture(canvas, lookId);
    canvas.focus();
  });
  listen(canvas, "pointermove", (raw) => {
    const e = raw as PointerEvent;
    if (e.pointerId !== lookId || !Number.isFinite(e.clientX)) return;
    const dx = e.clientX - lastX;
    lastX = e.clientX;
    if (Number.isFinite(dx))
      target.look(-Math.max(-120, Math.min(120, dx)) * 0.006);
  });
  function stopLook(raw: Event) {
    const id = (raw as PointerEvent).pointerId;
    if (id !== lookId) return;
    lookId = null;
    release(id);
  }
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"])
    listen(canvas, type, stopLook);
  function action(name: Action) {
    input.pressPhysical(`touch:${name}`);
    for (const queued of input.drainActions())
      if (queued === "jump" || queued === "interact") target.press(queued);
  }
  // Secondary fingers do not reliably generate clicks while the stick is held.
  // Activate touch actions on press, suppress their follow-up click, and keep
  // native click activation for keyboard/mouse accessibility.
  for (const [button, activate] of [
    [jumpButton, () => action("jump")],
    [interactButton, () => action("interact")],
    [runButton, () => {
      running = !running;
      runButton.setAttribute("aria-pressed", String(running));
      if (moveId !== null) publishMovement();
    }],
  ] as const) {
    let touchActivated = false;
    listen(button, "pointerdown", (raw) => {
      const e = raw as PointerEvent;
      touchActivated = e.pointerType === "touch" && target.playing();
      if (!touchActivated) return;
      e.preventDefault();
      activate();
    });
    listen(button, "click", (raw) => {
      // Some browsers expose compatibility clicks as MouseEvents; detail=0
      // still permits keyboard and programmatic activation after a touch.
      const event = raw as PointerEvent;
      const followUp = event.pointerType === "touch" || (touchActivated && event.detail > 0);
      touchActivated = false;
      if (followUp) {
        raw.stopImmediatePropagation();
        return;
      }
      // The existing DOM HUD handles mouse/keyboard interaction clicks.
      if (button !== interactButton && target.playing()) activate();
    });
  }
  listen(window, "blur", reset);
  listen(window, "resize", reset);
  listen(document, "visibilitychange", () => {
    if (document.hidden) reset();
  });
  return {
    reset,
    inspect: () => ({
      disposed,
      listeners: removers.length,
      movePointer: moveId,
      lookPointer: lookId,
      capturedPointers: captures.size,
      running,
      input: input.inspect(),
    }),
    dispose() {
      if (disposed) return;
      reset();
      disposed = true;
      for (const remove of removers.splice(0)) remove();
      input.dispose();
      document.body.classList.remove("touch-controls-enabled");
    },
  };
}
