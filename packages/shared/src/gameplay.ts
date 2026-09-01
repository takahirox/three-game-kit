export interface GameplayVector3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

function stableId(value: string, label: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 128 || value.trim() !== value) {
    throw new TypeError(`${label} must be a trimmed non-empty string of at most 128 characters`);
  }
  return value;
}

function finite(value: number, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
  return value;
}

function positive(value: number, label: string): number {
  if (finite(value, label) <= 0) throw new TypeError(`${label} must be positive`);
  return value;
}

function nonNegativeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${label} must be a non-negative safe integer`);
  return value;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function vector(value: GameplayVector3, label: string): GameplayVector3 {
  if (typeof value !== "object" || value === null || Array.isArray(value) || Reflect.ownKeys(value).sort().join("|") !== "x|y|z") {
    throw new TypeError(`${label} must contain exactly x, y, and z`);
  }
  return Object.freeze({ x: finite(value.x, `${label}.x`), y: finite(value.y, `${label}.y`), z: finite(value.z, `${label}.z`) });
}

function ids(values: readonly string[] | undefined, label: string): readonly string[] {
  if (values === undefined) return Object.freeze([]);
  if (!Array.isArray(values)) throw new TypeError(`${label} must be an array`);
  const copied = values.map((value) => stableId(value, label));
  if (new Set(copied).size !== copied.length) throw new TypeError(`${label} must be unique`);
  return Object.freeze([...copied].sort());
}

// Trigger / Area
export type TriggerAreaDescriptor =
  | Readonly<{ readonly id: string; readonly shape: "box"; readonly center: GameplayVector3; readonly halfExtents: GameplayVector3; readonly layers?: readonly string[] }>
  | Readonly<{ readonly id: string; readonly shape: "sphere"; readonly center: GameplayVector3; readonly radius: number; readonly layers?: readonly string[] }>;

export interface TriggerActor {
  readonly id: string;
  readonly position: GameplayVector3;
  readonly layers?: readonly string[];
}

export interface TriggerAreaEvent {
  readonly kind: "enter" | "stay" | "exit";
  readonly areaId: string;
  readonly actorId: string;
  readonly tick: number;
}

export interface TriggerAreaInspection {
  readonly disposed: boolean;
  readonly areaIds: readonly string[];
  readonly activePairs: readonly Readonly<{ readonly areaId: string; readonly actorId: string }>[];
  readonly evaluationCount: number;
}

export interface TriggerAreaRuntime {
  readonly disposed: boolean;
  step(tick: number, actors: readonly TriggerActor[]): readonly TriggerAreaEvent[];
  inspect(): TriggerAreaInspection;
  dispose(): void;
}

function area(value: TriggerAreaDescriptor): TriggerAreaDescriptor {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError("Trigger area is invalid");
  const common = { id: stableId(value.id, "Trigger area ID"), center: vector(value.center, "Trigger area center"), layers: ids(value.layers, "Trigger area layers") };
  if (value.shape === "box" && Reflect.ownKeys(value).every((key) => typeof key === "string" && ["id", "shape", "center", "halfExtents", "layers"].includes(key))) {
    const halfExtents = vector(value.halfExtents, "Trigger area halfExtents");
    if (halfExtents.x <= 0 || halfExtents.y <= 0 || halfExtents.z <= 0) throw new TypeError("Trigger box halfExtents must be positive");
    return Object.freeze({ ...common, shape: "box", halfExtents });
  }
  if (value.shape === "sphere" && Reflect.ownKeys(value).every((key) => typeof key === "string" && ["id", "shape", "center", "radius", "layers"].includes(key))) {
    return Object.freeze({ ...common, shape: "sphere", radius: positive(value.radius, "Trigger sphere radius") });
  }
  throw new TypeError("Trigger area shape or fields are invalid");
}

function actor(value: TriggerActor): TriggerActor {
  if (typeof value !== "object" || value === null || Array.isArray(value) || !Reflect.ownKeys(value).every((key) => typeof key === "string" && ["id", "position", "layers"].includes(key))) {
    throw new TypeError("Trigger actor is invalid");
  }
  return Object.freeze({ id: stableId(value.id, "Trigger actor ID"), position: vector(value.position, "Trigger actor position"), layers: ids(value.layers, "Trigger actor layers") });
}

function overlaps(trigger: TriggerAreaDescriptor, target: TriggerActor): boolean {
  const areaLayers = trigger.layers ?? [];
  const actorLayers = target.layers ?? [];
  if (areaLayers.length > 0 && !areaLayers.some((layer) => actorLayers.includes(layer))) return false;
  const dx = target.position.x - trigger.center.x;
  const dy = target.position.y - trigger.center.y;
  const dz = target.position.z - trigger.center.z;
  return trigger.shape === "sphere"
    ? dx * dx + dy * dy + dz * dz <= trigger.radius * trigger.radius
    : Math.abs(dx) <= trigger.halfExtents.x && Math.abs(dy) <= trigger.halfExtents.y && Math.abs(dz) <= trigger.halfExtents.z;
}

export function createTriggerAreaRuntime(rawAreas: readonly TriggerAreaDescriptor[]): TriggerAreaRuntime {
  if (!Array.isArray(rawAreas)) throw new TypeError("Trigger areas must be an array");
  const areas = rawAreas.map(area).sort((left, right) => compareText(left.id, right.id));
  if (new Set(areas.map(({ id }) => id)).size !== areas.length) throw new TypeError("Trigger area IDs must be unique");
  let active = new Map<string, Readonly<{ areaId: string; actorId: string }>>();
  let evaluationCount = 0;
  let disposed = false;
  return Object.freeze({
    get disposed(): boolean { return disposed; },
    step(tick: number, rawActors: readonly TriggerActor[]): readonly TriggerAreaEvent[] {
      if (disposed) throw new Error("Trigger Area runtime has been disposed");
      nonNegativeInteger(tick, "Trigger tick");
      if (!Array.isArray(rawActors)) throw new TypeError("Trigger actors must be an array");
      const actors = rawActors.map(actor).sort((left, right) => compareText(left.id, right.id));
      if (new Set(actors.map(({ id }) => id)).size !== actors.length) throw new TypeError("Trigger actor IDs must be unique");
      const next = new Map<string, Readonly<{ areaId: string; actorId: string }>>();
      const events: TriggerAreaEvent[] = [];
      for (const trigger of areas) for (const target of actors) {
        if (!overlaps(trigger, target)) continue;
        const key = `${trigger.id}\u0000${target.id}`;
        next.set(key, Object.freeze({ areaId: trigger.id, actorId: target.id }));
        events.push(Object.freeze({ kind: active.has(key) ? "stay" : "enter", areaId: trigger.id, actorId: target.id, tick }));
      }
      for (const [key, pair] of active) if (!next.has(key)) events.push(Object.freeze({ kind: "exit", areaId: pair.areaId, actorId: pair.actorId, tick }));
      events.sort((left, right) => compareText(left.areaId, right.areaId) || compareText(left.actorId, right.actorId) || compareText(left.kind, right.kind));
      active = next;
      evaluationCount += 1;
      return Object.freeze(events);
    },
    inspect(): TriggerAreaInspection {
      return Object.freeze({ disposed, areaIds: Object.freeze(areas.map(({ id }) => id)), activePairs: Object.freeze([...active.values()]), evaluationCount });
    },
    dispose(): void { if (!disposed) { disposed = true; active.clear(); } },
  });
}

// Health / Damage
export interface HealthState {
  readonly id: string;
  readonly current: number;
  readonly maximum: number;
  readonly dead: boolean;
  readonly invulnerableUntilTick: number;
}

export interface HealthEvent {
  readonly kind: "damaged" | "healed" | "died";
  readonly entityId: string;
  readonly sourceId: string | null;
  readonly requestedAmount: number;
  readonly appliedAmount: number;
  readonly before: number;
  readonly after: number;
  readonly tick: number;
}

export interface HealthInspection {
  readonly disposed: boolean;
  readonly entities: readonly HealthState[];
  readonly pendingRequestCount: number;
  readonly ignoredRequestCount: number;
}

export interface HealthRuntime {
  readonly disposed: boolean;
  register(id: string, maximum: number, current?: number): HealthState;
  requestDamage(entityId: string, amount: number, options?: Readonly<{ readonly sourceId?: string; readonly invulnerabilityTicks?: number }>): void;
  requestHealing(entityId: string, amount: number, sourceId?: string): void;
  reset(entityId: string, current?: number): HealthState;
  step(tick: number): readonly HealthEvent[];
  get(entityId: string): HealthState | undefined;
  inspect(): HealthInspection;
  dispose(): void;
}

type HealthRequest = Readonly<{ readonly kind: "damage" | "healing"; readonly entityId: string; readonly amount: number; readonly sourceId: string | null; readonly invulnerabilityTicks: number }>;

function healthSnapshot(id: string, state: { current: number; maximum: number; dead: boolean; invulnerableUntilTick: number }): HealthState {
  return Object.freeze({ id, current: state.current, maximum: state.maximum, dead: state.dead, invulnerableUntilTick: state.invulnerableUntilTick });
}

export function createHealthRuntime(): HealthRuntime {
  const entities = new Map<string, { current: number; maximum: number; dead: boolean; invulnerableUntilTick: number }>();
  const requests: HealthRequest[] = [];
  let ignoredRequestCount = 0;
  let disposed = false;
  function requireActive(): void { if (disposed) throw new Error("Health runtime has been disposed"); }
  function requireEntity(rawId: string) {
    const id = stableId(rawId, "Health entity ID");
    const state = entities.get(id);
    if (state === undefined) throw new RangeError(`Unknown health entity: ${id}`);
    return { id, state };
  }
  const runtime: HealthRuntime = Object.freeze({
    get disposed(): boolean { return disposed; },
    register(rawId: string, rawMaximum: number, rawCurrent?: number): HealthState {
      requireActive();
      const id = stableId(rawId, "Health entity ID");
      if (entities.has(id)) throw new TypeError(`Duplicate health entity: ${id}`);
      const maximum = positive(rawMaximum, "Maximum health");
      const current = rawCurrent === undefined ? maximum : finite(rawCurrent, "Current health");
      if (current < 0 || current > maximum) throw new TypeError("Current health must be within [0, maximum]");
      const state = { current, maximum, dead: current === 0, invulnerableUntilTick: 0 };
      entities.set(id, state);
      return healthSnapshot(id, state);
    },
    requestDamage(
      rawId: string,
      rawAmount: number,
      options: Readonly<{
        readonly sourceId?: string;
        readonly invulnerabilityTicks?: number;
      }> = {},
    ): void {
      requireActive();
      const { id } = requireEntity(rawId);
      if (typeof options !== "object" || options === null || Array.isArray(options) || !Reflect.ownKeys(options).every((key) => key === "sourceId" || key === "invulnerabilityTicks")) throw new TypeError("Damage options are invalid");
      requests.push(Object.freeze({ kind: "damage", entityId: id, amount: positive(rawAmount, "Damage amount"), sourceId: options.sourceId === undefined ? null : stableId(options.sourceId, "Damage source ID"), invulnerabilityTicks: nonNegativeInteger(options.invulnerabilityTicks ?? 0, "Invulnerability ticks") }));
    },
    requestHealing(
      rawId: string,
      rawAmount: number,
      rawSourceId?: string,
    ): void {
      requireActive();
      const { id } = requireEntity(rawId);
      requests.push(Object.freeze({ kind: "healing", entityId: id, amount: positive(rawAmount, "Healing amount"), sourceId: rawSourceId === undefined ? null : stableId(rawSourceId, "Healing source ID"), invulnerabilityTicks: 0 }));
    },
    reset(rawId: string, rawCurrent?: number): HealthState {
      requireActive();
      const { id, state } = requireEntity(rawId);
      const current = rawCurrent === undefined ? state.maximum : finite(rawCurrent, "Reset health");
      if (current < 0 || current > state.maximum) throw new TypeError("Reset health must be within [0, maximum]");
      state.current = current; state.dead = current === 0; state.invulnerableUntilTick = 0;
      return healthSnapshot(id, state);
    },
    step(tick: number): readonly HealthEvent[] {
      requireActive(); nonNegativeInteger(tick, "Health tick");
      const pending = requests.splice(0);
      const events: HealthEvent[] = [];
      for (const request of pending) {
        const state = entities.get(request.entityId);
        if (state === undefined) { ignoredRequestCount += 1; continue; }
        if (request.kind === "damage" && (state.dead || tick < state.invulnerableUntilTick)) { ignoredRequestCount += 1; continue; }
        if (request.kind === "healing" && state.dead) { ignoredRequestCount += 1; continue; }
        const before = state.current;
        const after = request.kind === "damage" ? Math.max(0, before - request.amount) : Math.min(state.maximum, before + request.amount);
        const appliedAmount = Math.abs(after - before);
        if (appliedAmount === 0) { ignoredRequestCount += 1; continue; }
        state.current = after;
        if (request.kind === "damage" && request.invulnerabilityTicks > 0) state.invulnerableUntilTick = tick + request.invulnerabilityTicks + 1;
        events.push(Object.freeze({ kind: request.kind === "damage" ? "damaged" : "healed", entityId: request.entityId, sourceId: request.sourceId, requestedAmount: request.amount, appliedAmount, before, after, tick }));
        if (after === 0 && !state.dead) {
          state.dead = true;
          events.push(Object.freeze({ kind: "died", entityId: request.entityId, sourceId: request.sourceId, requestedAmount: request.amount, appliedAmount, before, after, tick }));
        }
      }
      return Object.freeze(events);
    },
    get(rawId: string): HealthState | undefined { const id = stableId(rawId, "Health entity ID"); const state = entities.get(id); return state === undefined ? undefined : healthSnapshot(id, state); },
    inspect(): HealthInspection { return Object.freeze({ disposed, entities: Object.freeze([...entities].sort(([a], [b]) => compareText(a, b)).map(([id, state]) => healthSnapshot(id, state))), pendingRequestCount: requests.length, ignoredRequestCount }); },
    dispose(): void { if (!disposed) { disposed = true; requests.length = 0; entities.clear(); } },
  });
  return runtime;
}

// Spawn / Prefab
export type PrefabValue = null | boolean | number | string | readonly PrefabValue[] | Readonly<{ readonly [key: string]: PrefabValue }>;
export interface PrefabDefinition { readonly id: string; readonly components?: Readonly<Record<string, PrefabValue>>; readonly resources?: Readonly<Record<string, PrefabValue>>; readonly pooling?: boolean; }
export interface PrefabInstance { readonly id: string; readonly prefabId: string; readonly components: Readonly<Record<string, PrefabValue>>; readonly resources: Readonly<Record<string, PrefabValue>>; readonly reused: boolean; }
export interface PrefabAdapter { create(instance: PrefabInstance): unknown; reuse(handle: unknown, instance: PrefabInstance): void; release(handle: unknown, mode: "pool" | "destroy"): void; }
export interface SpawnPrefabInspection { readonly disposed: boolean; readonly definitionIds: readonly string[]; readonly activeInstances: readonly PrefabInstance[]; readonly pooledCounts: Readonly<Record<string, number>>; readonly nextOrdinal: number; }
export interface SpawnPrefabRuntime { readonly disposed: boolean; spawn(prefabId: string, instanceId?: string): PrefabInstance; despawn(instanceId: string): boolean; inspect(): SpawnPrefabInspection; dispose(): void; }

function prefabValue(value: unknown, depth = 0): PrefabValue {
  if (depth > 16) throw new TypeError("Prefab value nesting exceeds 16");
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") return finite(value, "Prefab number");
  if (Array.isArray(value)) return Object.freeze(value.map((item) => prefabValue(item, depth + 1)));
  if (typeof value === "object" && value !== null) {
    const prototype = Object.getPrototypeOf(value);
    if ((prototype !== Object.prototype && prototype !== null) || Reflect.ownKeys(value).some((key) => typeof key !== "string")) {
      throw new TypeError("Prefab objects must be plain string-keyed records");
    }
    const result: Record<string, PrefabValue> = {};
    for (const [key, item] of Object.entries(value)) result[stableId(key, "Prefab field")] = prefabValue(item, depth + 1);
    return Object.freeze(result);
  }
  throw new TypeError("Prefab values must be finite JSON-like data");
}

function prefabRecord(value: Readonly<Record<string, PrefabValue>> | undefined): Readonly<Record<string, PrefabValue>> {
  return (prefabValue(value ?? {}) as Readonly<Record<string, PrefabValue>>);
}

export function createSpawnPrefabRuntime(rawDefinitions: readonly PrefabDefinition[], adapter: PrefabAdapter): SpawnPrefabRuntime {
  if (!Array.isArray(rawDefinitions) || typeof adapter !== "object" || adapter === null || typeof adapter.create !== "function" || typeof adapter.reuse !== "function" || typeof adapter.release !== "function") throw new TypeError("Spawn Prefab options are invalid");
  const definitions = new Map<string, Readonly<{ id: string; components: Readonly<Record<string, PrefabValue>>; resources: Readonly<Record<string, PrefabValue>>; pooling: boolean }>>();
  for (const raw of rawDefinitions) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw) || !Reflect.ownKeys(raw).every((key) => typeof key === "string" && ["id", "components", "resources", "pooling"].includes(key)) || (raw.pooling !== undefined && typeof raw.pooling !== "boolean")) throw new TypeError("Prefab definition is invalid");
    const id = stableId(raw.id, "Prefab ID");
    if (definitions.has(id)) throw new TypeError(`Duplicate prefab ID: ${id}`);
    definitions.set(id, Object.freeze({ id, components: prefabRecord(raw.components), resources: prefabRecord(raw.resources), pooling: raw.pooling ?? false }));
  }
  const active = new Map<string, { instance: PrefabInstance; handle: unknown }>();
  const pooled = new Map<string, unknown[]>();
  let nextOrdinal = 1;
  let disposed = false;
  function createInstance(definition: { id: string; components: Readonly<Record<string, PrefabValue>>; resources: Readonly<Record<string, PrefabValue>> }, instanceId: string, reused: boolean): PrefabInstance {
    return Object.freeze({ id: instanceId, prefabId: definition.id, components: prefabRecord(definition.components), resources: prefabRecord(definition.resources), reused });
  }
  return Object.freeze({
    get disposed(): boolean { return disposed; },
    spawn(rawPrefabId: string, rawInstanceId?: string): PrefabInstance {
      if (disposed) throw new Error("Spawn Prefab runtime has been disposed");
      const prefabId = stableId(rawPrefabId, "Prefab ID");
      const definition = definitions.get(prefabId); if (definition === undefined) throw new RangeError(`Unknown prefab: ${prefabId}`);
      if (!Number.isSafeInteger(nextOrdinal)) throw new Error("Prefab identity space exhausted");
      const instanceId = rawInstanceId === undefined ? `${prefabId}:${nextOrdinal}` : stableId(rawInstanceId, "Prefab instance ID");
      if (active.has(instanceId)) throw new TypeError(`Duplicate prefab instance ID: ${instanceId}`);
      if (rawInstanceId === undefined) nextOrdinal += 1;
      const pool = pooled.get(prefabId) ?? [];
      const reused = pool.length > 0;
      const instance = createInstance(definition, instanceId, reused);
      const handle = reused ? pool.pop() : adapter.create(instance);
      if (reused) {
        try {
          adapter.reuse(handle, instance);
        } catch (error) {
          pool.push(handle);
          throw error;
        }
      }
      pooled.set(prefabId, pool);
      active.set(instanceId, { instance, handle });
      return instance;
    },
    despawn(rawInstanceId: string): boolean {
      if (disposed) throw new Error("Spawn Prefab runtime has been disposed");
      const instanceId = stableId(rawInstanceId, "Prefab instance ID");
      const record = active.get(instanceId); if (record === undefined) return false;
      const definition = definitions.get(record.instance.prefabId);
      const pool = pooled.get(record.instance.prefabId) ?? [];
      if (definition?.pooling === true) { adapter.release(record.handle, "pool"); pool.push(record.handle); pooled.set(record.instance.prefabId, pool); }
      else adapter.release(record.handle, "destroy");
      active.delete(instanceId);
      return true;
    },
    inspect(): SpawnPrefabInspection {
      return Object.freeze({ disposed, definitionIds: Object.freeze([...definitions.keys()]), activeInstances: Object.freeze([...active.values()].map(({ instance }) => instance)), pooledCounts: Object.freeze(Object.fromEntries([...pooled].map(([id, handles]) => [id, handles.length]))), nextOrdinal });
    },
    dispose(): void {
      if (disposed) return; disposed = true; let firstError: unknown;
      for (const { handle } of active.values()) try { adapter.release(handle, "destroy"); } catch (error) { firstError ??= error; }
      for (const handles of pooled.values()) for (const handle of handles) try { adapter.release(handle, "destroy"); } catch (error) { firstError ??= error; }
      active.clear(); pooled.clear(); if (firstError !== undefined) throw firstError;
    },
  });
}

// Game State / Flow
export interface GameFlowStateDefinition { readonly id: string; readonly allowedTo: readonly string[]; }
export interface GameFlowTransition { readonly sequence: number; readonly from: string; readonly to: string; readonly reason: string | null; readonly tick: number | null; readonly accepted: boolean; readonly failureCode: "same-state" | "transition-not-allowed" | "hook-failed" | null; }
export type GameFlowOutcome = Readonly<{ readonly ok: true; readonly value: GameFlowTransition }> | Readonly<{ readonly ok: false; readonly failure: GameFlowTransition }>;
export interface GameFlowInspection { readonly disposed: boolean; readonly state: string; readonly sequence: number; readonly transitions: readonly GameFlowTransition[]; }
export interface GameFlowRuntime { readonly disposed: boolean; readonly state: string; transition(to: string, options?: Readonly<{ readonly reason?: string; readonly tick?: number }>): GameFlowOutcome; inspect(): GameFlowInspection; dispose(): void; }

export function createGameFlowRuntime(options: { readonly states: readonly GameFlowStateDefinition[]; readonly initialState: string; readonly onEnter?: (state: string, from: string | null) => void; readonly onExit?: (state: string, to: string | null) => void; readonly traceCapacity?: number }): GameFlowRuntime {
  if (typeof options !== "object" || options === null || Array.isArray(options) || !Array.isArray(options.states) || (options.onEnter !== undefined && typeof options.onEnter !== "function") || (options.onExit !== undefined && typeof options.onExit !== "function")) throw new TypeError("Game Flow options are invalid");
  const definitions = new Map<string, readonly string[]>();
  for (const raw of options.states) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw) || Reflect.ownKeys(raw).sort().join("|") !== "allowedTo|id") throw new TypeError("Game Flow state is invalid");
    const id = stableId(raw.id, "Game Flow state ID"); if (definitions.has(id)) throw new TypeError(`Duplicate Game Flow state: ${id}`);
    definitions.set(id, ids(raw.allowedTo, "Game Flow transition target"));
  }
  for (const [id, targets] of definitions) for (const target of targets) if (!definitions.has(target)) throw new TypeError(`Game Flow state ${id} references unknown target ${target}`);
  let state = stableId(options.initialState, "Initial Game Flow state"); if (!definitions.has(state)) throw new TypeError(`Unknown initial Game Flow state: ${state}`);
  const capacity = options.traceCapacity ?? 256; if (!Number.isSafeInteger(capacity) || capacity <= 0 || capacity > 4096) throw new TypeError("Game Flow trace capacity must be in [1, 4096]");
  const transitions: GameFlowTransition[] = []; let sequence = 0; let disposed = false;
  options.onEnter?.(state, null);
  function record(from: string, to: string, reason: string | null, tick: number | null, accepted: boolean, failureCode: GameFlowTransition["failureCode"]): GameFlowTransition {
    sequence += 1; const value = Object.freeze({ sequence, from, to, reason, tick, accepted, failureCode }); transitions.push(value); if (transitions.length > capacity) transitions.shift(); return value;
  }
  return Object.freeze({
    get disposed(): boolean { return disposed; }, get state(): string { return state; },
    transition(
      rawTo: string,
      rawOptions: Readonly<{ readonly reason?: string; readonly tick?: number }> = {},
    ): GameFlowOutcome {
      if (disposed) throw new Error("Game Flow runtime has been disposed");
      const to = stableId(rawTo, "Game Flow target state"); if (!definitions.has(to)) throw new RangeError(`Unknown Game Flow state: ${to}`);
      if (typeof rawOptions !== "object" || rawOptions === null || Array.isArray(rawOptions) || !Reflect.ownKeys(rawOptions).every((key) => key === "reason" || key === "tick")) throw new TypeError("Game Flow transition options are invalid");
      const reason = rawOptions.reason === undefined ? null : stableId(rawOptions.reason, "Game Flow reason");
      const tick = rawOptions.tick === undefined ? null : nonNegativeInteger(rawOptions.tick, "Game Flow tick");
      const from = state;
      if (to === from) { const failure = record(from, to, reason, tick, false, "same-state"); return Object.freeze({ ok: false, failure }); }
      if (!(definitions.get(from)?.includes(to) ?? false)) { const failure = record(from, to, reason, tick, false, "transition-not-allowed"); return Object.freeze({ ok: false, failure }); }
      let exited = false;
      try {
        options.onExit?.(from, to);
        exited = true;
        options.onEnter?.(to, from);
      } catch {
        if (exited) {
          try { options.onExit?.(to, from); } catch {}
          try { options.onEnter?.(from, to); } catch {}
        }
        const failure = record(from, to, reason, tick, false, "hook-failed");
        return Object.freeze({ ok: false, failure });
      }
      state = to; return Object.freeze({ ok: true, value: record(from, to, reason, tick, true, null) });
    },
    inspect(): GameFlowInspection { return Object.freeze({ disposed, state, sequence, transitions: Object.freeze([...transitions]) }); },
    dispose(): void {
      if (!disposed) {
        disposed = true;
        try { options.onExit?.(state, null); } finally { transitions.length = 0; }
      }
    },
  });
}

// UI / HUD state boundary
export type HudExtraValue = null | boolean | number | string;
export interface HudState { readonly revision: number; readonly screen: string; readonly score: number; readonly timerSeconds: number; readonly health: number; readonly maximumHealth: number; readonly paused: boolean; readonly extras: Readonly<Record<string, HudExtraValue>>; }
export type HudStatePatch = Partial<Omit<HudState, "revision">>;
export interface HudStateStore { readonly disposed: boolean; update(patch: HudStatePatch): HudState; snapshot(): HudState; subscribe(listener: (state: HudState) => void): () => void; dispose(): void; }

function hudState(value: Omit<HudState, "revision">, revision: number): HudState {
  const screen = stableId(value.screen, "HUD screen"); const score = finite(value.score, "HUD score"); const timerSeconds = finite(value.timerSeconds, "HUD timer"); const health = finite(value.health, "HUD health"); const maximumHealth = positive(value.maximumHealth, "HUD maximum health");
  if (timerSeconds < 0 || health < 0 || health > maximumHealth || typeof value.paused !== "boolean" || typeof value.extras !== "object" || value.extras === null || Array.isArray(value.extras)) throw new TypeError("HUD state values are invalid");
  const extras: Record<string, HudExtraValue> = {};
  for (const [key, item] of Object.entries(value.extras)) { stableId(key, "HUD extra key"); if (!(item === null || typeof item === "boolean" || typeof item === "string" || (typeof item === "number" && Number.isFinite(item)))) throw new TypeError("HUD extra values must be primitive and finite"); extras[key] = item; }
  return Object.freeze({ revision, screen, score, timerSeconds, health, maximumHealth, paused: value.paused, extras: Object.freeze(extras) });
}

export function createHudStateStore(initial: Partial<Omit<HudState, "revision">> = {}): HudStateStore {
  if (typeof initial !== "object" || initial === null || Array.isArray(initial) || !Reflect.ownKeys(initial).every((key) => typeof key === "string" && ["screen", "score", "timerSeconds", "health", "maximumHealth", "paused", "extras"].includes(key))) throw new TypeError("HUD initial state is invalid");
  let state = hudState({ screen: initial.screen ?? "boot", score: initial.score ?? 0, timerSeconds: initial.timerSeconds ?? 0, health: initial.health ?? 1, maximumHealth: initial.maximumHealth ?? 1, paused: initial.paused ?? false, extras: initial.extras ?? {} }, 0);
  const listeners = new Set<(state: HudState) => void>(); let disposed = false;
  return Object.freeze({
    get disposed(): boolean { return disposed; },
    update(patch: HudStatePatch): HudState {
      if (disposed) throw new Error("HUD state store has been disposed");
      if (typeof patch !== "object" || patch === null || Array.isArray(patch) || !Reflect.ownKeys(patch).every((key) => typeof key === "string" && ["screen", "score", "timerSeconds", "health", "maximumHealth", "paused", "extras"].includes(key))) throw new TypeError("HUD state patch is invalid");
      state = hudState({ screen: patch.screen ?? state.screen, score: patch.score ?? state.score, timerSeconds: patch.timerSeconds ?? state.timerSeconds, health: patch.health ?? state.health, maximumHealth: patch.maximumHealth ?? state.maximumHealth, paused: patch.paused ?? state.paused, extras: patch.extras ?? state.extras }, state.revision + 1);
      for (const listener of [...listeners]) try { listener(state); } catch {}
      return state;
    },
    snapshot(): HudState { return state; },
    subscribe(listener: (state: HudState) => void): () => void {
      if (disposed) throw new Error("HUD state store has been disposed");
      if (typeof listener !== "function") throw new TypeError("HUD listener is invalid");
      listeners.add(listener);
      try { listener(state); } catch (error) { listeners.delete(listener); throw error; }
      let active = true;
      return () => { if (active) { active = false; listeners.delete(listener); } };
    },
    dispose(): void { if (!disposed) { disposed = true; listeners.clear(); } },
  });
}
