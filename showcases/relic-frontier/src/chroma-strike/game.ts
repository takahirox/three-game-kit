import { createSemanticActionInput } from "@three-game-kit/client/input";
import type { StrikeRenderer } from "./renderer.js";
import {
  COUNTDOWN_TICKS,
  FIRE_COOLDOWN_TICKS,
  MAGAZINE_SIZE,
  RELOAD_TICKS,
  STRIKE_DT,
  TARGET_KILLS,
  createStrikeState,
  snapshotStrike,
  strikeVector,
  type MutableStrikeState,
  type StrikeAction,
  type StrikeEvent,
  type StrikeInput,
  type StrikeScenario,
  type StrikeSnapshot,
} from "./state.js";

export interface StrikeGame {
  start(): void;
  restart(): void;
  setInput(input: Partial<StrikeInput>): void;
  press(action: StrikeAction): void;
  advance(seconds: number): number;
  present(timeMs: number): void;
  loadScenario(scenario: StrikeScenario): void;
  snapshot(): StrikeSnapshot;
  events(): readonly StrikeEvent[];
  errors(): readonly string[];
  dispose(): void;
  inspectLeaks(): Readonly<{ disposed: boolean; queuedActions: number; eventCount: number }>;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function eventVector(value: { x: number; y: number; z: number }) {
  return strikeVector(value.x, value.y, value.z);
}

export function createStrikeGame(renderer: StrikeRenderer): StrikeGame {
  let state = createStrikeState();
  const actions = createSemanticActionInput<StrikeAction>(["fire", "reload"], { capacity: 24 });
  const history: StrikeEvent[] = [];
  const pending: StrikeEvent[] = [];
  const errors: string[] = [];
  let accumulator = 0;
  let disposed = false;

  function emit(event: StrikeEvent): void {
    if (history.length >= 512) history.shift();
    history.push(Object.freeze(event));
    pending.push(Object.freeze(event));
  }

  function phase(next: MutableStrikeState["phase"]): void {
    if (state.phase === next) return;
    const previous = state.phase;
    state.phase = next;
    emit({ kind: "phase-changed", tick: state.tick, subject: `${previous}:${next}` });
  }

  function beginReload(): void {
    if (state.reloadTicks > 0 || state.ammo === MAGAZINE_SIZE || state.reserveAmmo === 0) return;
    state.reloadTicks = RELOAD_TICKS;
    emit({ kind: "reload-started", tick: state.tick });
  }

  function fire(): void {
    if (state.fireCooldownTicks > 0 || state.reloadTicks > 0) return;
    if (state.ammo === 0) { beginReload(); return; }
    state.ammo -= 1;
    state.shots += 1;
    state.fireCooldownTicks = FIRE_COOLDOWN_TICKS;
    const origin = strikeVector(state.player.position.x, 1.62, state.player.position.z);
    const cosPitch = Math.cos(state.player.pitch);
    const direction = strikeVector(Math.sin(state.player.yaw) * cosPitch, Math.sin(state.player.pitch), -Math.cos(state.player.yaw) * cosPitch);
    let selected: MutableStrikeState["enemies"][number] | null = null;
    let selectedDistance = 48;
    for (const enemy of state.enemies) {
      if (!enemy.alive) continue;
      const target = { x: enemy.position.x, y: 1.15, z: enemy.position.z };
      const dx = target.x - origin.x;
      const dy = target.y - origin.y;
      const dz = target.z - origin.z;
      const along = dx * direction.x + dy * direction.y + dz * direction.z;
      if (along <= 0 || along >= selectedDistance) continue;
      const perpendicular = Math.hypot(dx - direction.x * along, dy - direction.y * along, dz - direction.z * along);
      if (perpendicular <= 1.05) { selected = enemy; selectedDistance = along; }
    }
    const end = selected === null
      ? strikeVector(origin.x + direction.x * 44, origin.y + direction.y * 44, origin.z + direction.z * 44)
      : strikeVector(selected.position.x, 1.15, selected.position.z);
    emit({ kind: "shot", tick: state.tick, from: origin, to: end });
    if (selected === null) return;
    selected.health = Math.max(0, selected.health - 40);
    state.hits += 1;
    state.score += 15;
    emit({ kind: "hit", tick: state.tick, subject: selected.id, to: end, value: 40 });
    if (selected.health > 0) return;
    selected.alive = false;
    state.kills += 1;
    state.score += 100;
    emit({ kind: "enemy-defeated", tick: state.tick, subject: selected.id, to: end, value: state.kills });
    if (state.kills >= TARGET_KILLS) {
      state.result = "arena-clear";
      phase("results");
    }
  }

  function updatePlayer(): void {
    const inputLength = Math.hypot(state.input.moveX, state.input.moveY);
    const scale = inputLength > 1 ? 1 / inputLength : 1;
    const forwardX = Math.sin(state.player.yaw);
    const forwardZ = -Math.cos(state.player.yaw);
    const rightX = Math.cos(state.player.yaw);
    const rightZ = Math.sin(state.player.yaw);
    const speed = 6.8 * STRIKE_DT * scale;
    const nextX = state.player.position.x + (rightX * state.input.moveX + forwardX * -state.input.moveY) * speed;
    const nextZ = state.player.position.z + (rightZ * state.input.moveX + forwardZ * -state.input.moveY) * speed;
    state.player.position = strikeVector(clamp(nextX, -18, 18), 0, clamp(nextZ, -18, 18));
  }

  function updateEnemies(): void {
    for (const enemy of state.enemies) {
      if (!enemy.alive) continue;
      const dx = state.player.position.x - enemy.position.x;
      const dz = state.player.position.z - enemy.position.z;
      const distance = Math.hypot(dx, dz);
      if (distance > 5) {
        const step = 0.72 * STRIKE_DT;
        enemy.position = strikeVector(enemy.position.x + dx / distance * step, 0, enemy.position.z + dz / distance * step);
      }
      enemy.shotCooldownTicks -= 1;
      if (enemy.shotCooldownTicks > 0 || distance > 23) continue;
      enemy.shotCooldownTicks = 78 + Number(enemy.id.at(-1) ?? "1") * 7;
      state.player.health = Math.max(0, state.player.health - 7);
      emit({ kind: "player-hit", tick: state.tick, subject: enemy.id, value: 7, to: eventVector(state.player.position) });
      if (state.player.health === 0) {
        state.result = "defeated";
        phase("defeated");
        return;
      }
    }
  }

  function step(): void {
    state.tick += 1;
    if (state.phase === "countdown") {
      state.countdownTicks -= 1;
      if (state.countdownTicks <= 0) phase("running");
      return;
    }
    if (state.phase !== "running") return;
    if (state.fireCooldownTicks > 0) state.fireCooldownTicks -= 1;
    if (state.reloadTicks > 0) {
      state.reloadTicks -= 1;
      if (state.reloadTicks === 0) {
        const loaded = Math.min(MAGAZINE_SIZE - state.ammo, state.reserveAmmo);
        state.ammo += loaded;
        state.reserveAmmo -= loaded;
        emit({ kind: "reload-complete", tick: state.tick, value: loaded });
      }
    }
    for (const action of actions.drain()) {
      if (action === "fire") fire();
      if (action === "reload") beginReload();
    }
    updatePlayer();
    updateEnemies();
    if (state.phase !== "running") return;
    state.remainingTicks -= 1;
    if (state.remainingTicks <= 0) {
      state.result = "time";
      phase("results");
    }
  }

  function resetRunning(): void {
    state = createStrikeState();
    state.phase = "running";
    state.countdownTicks = 0;
  }

  return Object.freeze({
    start(): void {
      if (disposed || state.phase !== "title") return;
      state.countdownTicks = COUNTDOWN_TICKS;
      phase("countdown");
    },
    restart(): void {
      if (disposed) return;
      state = createStrikeState();
      actions.reset();
      history.length = 0;
      pending.length = 0;
      errors.length = 0;
      accumulator = 0;
    },
    setInput(input: Partial<StrikeInput>): void {
      if (disposed || typeof input !== "object" || input === null) return;
      const next = { ...state.input };
      if (Number.isFinite(input.moveX)) next.moveX = clamp(input.moveX as number, -1, 1);
      if (Number.isFinite(input.moveY)) next.moveY = clamp(input.moveY as number, -1, 1);
      if (Number.isFinite(input.yaw)) next.yaw = input.yaw as number;
      if (Number.isFinite(input.pitch)) next.pitch = clamp(input.pitch as number, -0.82, 0.82);
      state.input = Object.freeze(next);
      state.player.yaw = next.yaw;
      state.player.pitch = next.pitch;
    },
    press(action: StrikeAction): void { if (!disposed) actions.press(action); },
    advance(seconds: number): number {
      if (disposed) return 0;
      if (!Number.isFinite(seconds) || seconds < 0) {
        errors.push("advance seconds must be finite and non-negative");
        return 0;
      }
      accumulator += seconds;
      let steps = 0;
      while (accumulator + 1e-10 >= STRIKE_DT && steps < 600) {
        accumulator -= STRIKE_DT;
        step();
        steps += 1;
      }
      if (steps === 600) accumulator = 0;
      return steps;
    },
    present(timeMs: number): void {
      if (disposed) return;
      const events = pending.splice(0, pending.length);
      renderer.prepare(snapshotStrike(state), events);
      renderer.render(Math.max(0, timeMs));
    },
    loadScenario(scenario: StrikeScenario): void {
      if (disposed) return;
      resetRunning();
      if (scenario === "fresh") return;
      state.enemies.forEach((enemy, index) => { enemy.alive = index === 0; enemy.health = 100; });
      state.enemies[0]!.position = strikeVector(0, 0, 3.5);
      state.enemies[0]!.shotCooldownTicks = scenario === "defeat" ? 0 : 999;
      if (scenario === "last-enemy") state.kills = TARGET_KILLS - 1;
      if (scenario === "defeat") state.player.health = 7;
    },
    snapshot(): StrikeSnapshot { return snapshotStrike(state); },
    events(): readonly StrikeEvent[] { return Object.freeze([...history]); },
    errors(): readonly string[] { return Object.freeze([...errors]); },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      actions.dispose();
      pending.length = 0;
      renderer.dispose();
    },
    inspectLeaks() { return Object.freeze({ disposed, queuedActions: 0, eventCount: history.length }); },
  });
}
