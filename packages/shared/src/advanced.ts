export type AdvancedValue = null | boolean | number | string | readonly AdvancedValue[] | Readonly<{ readonly [key: string]: AdvancedValue }>;

function requireId(value: string, label: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 128 || value.trim() !== value) throw new TypeError(`${label} must be a trimmed non-empty string of at most 128 characters`);
  return value;
}
function requireTick(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${label} must be a non-negative safe integer`);
  return value;
}
function requireFinite(value: number, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
  return value;
}
function requireUnit(value: number, label: string): number {
  const result = requireFinite(value, label);
  if (result < -1 || result > 1) throw new TypeError(`${label} must be between -1 and 1`);
  return result;
}
function requireActive(disposed: boolean, label: string): void {
  if (disposed) throw new Error(`${label} has been disposed`);
}
function compare(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }
function copyValue(value: unknown, depth = 0): AdvancedValue {
  if (depth > 32) throw new TypeError("Advanced value nesting exceeds 32");
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") return requireFinite(value, "Advanced number");
  if (Array.isArray(value)) return Object.freeze(value.map((item) => copyValue(item, depth + 1)));
  if (typeof value === "object" && value !== null && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)) {
    const result: Record<string, AdvancedValue> = {};
    for (const [key, item] of Object.entries(value)) result[requireId(key, "Advanced key")] = copyValue(item, depth + 1);
    return Object.freeze(result);
  }
  throw new TypeError("Advanced values must be JSON-like");
}

// Dialogue
export interface DialogueChoiceDefinition { readonly id: string; readonly targetNodeId: string | null; readonly conditionId?: string; readonly effectId?: string; }
export interface DialogueNodeDefinition { readonly id: string; readonly lineId: string; readonly nextNodeId?: string | null; readonly choices?: readonly DialogueChoiceDefinition[]; }
export interface DialogueDefinition { readonly id: string; readonly startNodeId: string; readonly nodes: readonly DialogueNodeDefinition[]; }
export interface DialogueState { readonly dialogueId: string; readonly nodeId: string | null; readonly lineId: string | null; readonly choiceIds: readonly string[]; readonly complete: boolean; readonly revision: number; }
export type DialogueOutcome = Readonly<{ readonly ok: true; readonly state: DialogueState }> | Readonly<{ readonly ok: false; readonly code: "not-started" | "choice-required" | "unknown-choice" | "condition-rejected" | "already-complete" }>;
export interface DialogueRuntime {
  readonly disposed: boolean;
  start(dialogueId: string): DialogueState;
  advance(): DialogueOutcome;
  choose(choiceId: string): DialogueOutcome;
  snapshot(): DialogueState | null;
  restore(state: DialogueState): DialogueState;
  dispose(): void;
}

export function createDialogueRuntime(definitions: readonly DialogueDefinition[], hooks: Readonly<{ readonly checkCondition?: (conditionId: string, state: DialogueState) => boolean; readonly applyEffect?: (effectId: string, state: DialogueState) => void }> = {}): DialogueRuntime {
  if (!Array.isArray(definitions) || typeof hooks !== "object" || hooks === null || (hooks.checkCondition !== undefined && typeof hooks.checkCondition !== "function") || (hooks.applyEffect !== undefined && typeof hooks.applyEffect !== "function")) throw new TypeError("Dialogue options are invalid");
  const graphs = new Map<string, { start: string; nodes: Map<string, Readonly<{ id: string; lineId: string; next: string | null; choices: readonly Readonly<{ id: string; target: string | null; condition: string | null; effect: string | null }>[] }>> }>();
  for (const definition of definitions) {
    const dialogueId = requireId(definition.id, "Dialogue ID");
    if (graphs.has(dialogueId) || !Array.isArray(definition.nodes) || definition.nodes.length === 0) throw new TypeError(`Invalid or duplicate dialogue: ${dialogueId}`);
    const nodes = new Map<string, Readonly<{ id: string; lineId: string; next: string | null; choices: readonly Readonly<{ id: string; target: string | null; condition: string | null; effect: string | null }>[] }>>();
    for (const node of definition.nodes) {
      const nodeId = requireId(node.id, "Dialogue node ID");
      if (nodes.has(nodeId)) throw new TypeError(`Duplicate dialogue node: ${nodeId}`);
      const seen = new Set<string>();
      const choices = Object.freeze((node.choices ?? []).map((choice: DialogueChoiceDefinition) => {
        const choiceId = requireId(choice.id, "Dialogue choice ID");
        if (seen.has(choiceId)) throw new TypeError(`Duplicate dialogue choice: ${choiceId}`);
        seen.add(choiceId);
        return Object.freeze({ id: choiceId, target: choice.targetNodeId === null ? null : requireId(choice.targetNodeId, "Dialogue choice target"), condition: choice.conditionId === undefined ? null : requireId(choice.conditionId, "Dialogue condition ID"), effect: choice.effectId === undefined ? null : requireId(choice.effectId, "Dialogue effect ID") });
      }));
      nodes.set(nodeId, Object.freeze({ id: nodeId, lineId: requireId(node.lineId, "Dialogue line ID"), next: node.nextNodeId === undefined || node.nextNodeId === null ? null : requireId(node.nextNodeId, "Dialogue next node"), choices }));
    }
    const start = requireId(definition.startNodeId, "Dialogue start node");
    if (!nodes.has(start)) throw new TypeError(`Unknown dialogue start node: ${start}`);
    for (const node of nodes.values()) {
      if (node.next !== null && !nodes.has(node.next)) throw new TypeError(`Unknown dialogue target: ${node.next}`);
      for (const choice of node.choices) if (choice.target !== null && !nodes.has(choice.target)) throw new TypeError(`Unknown dialogue choice target: ${choice.target}`);
    }
    graphs.set(dialogueId, { start, nodes });
  }
  let current: DialogueState | null = null;
  let disposed = false;
  function state(dialogueId: string, nodeId: string | null, revision: number): DialogueState {
    const node = nodeId === null ? undefined : graphs.get(dialogueId)?.nodes.get(nodeId);
    return Object.freeze({ dialogueId, nodeId, lineId: node?.lineId ?? null, choiceIds: Object.freeze(node?.choices.map(({ id }) => id) ?? []), complete: nodeId === null, revision });
  }
  function transition(target: string | null): DialogueOutcome {
    if (current === null) return Object.freeze({ ok: false, code: "not-started" });
    current = state(current.dialogueId, target, current.revision + 1);
    return Object.freeze({ ok: true, state: current });
  }
  return Object.freeze<DialogueRuntime>({
    get disposed() { return disposed; },
    start(rawId) { requireActive(disposed, "Dialogue runtime"); const dialogueId = requireId(rawId, "Dialogue ID"); const graph = graphs.get(dialogueId); if (graph === undefined) throw new RangeError(`Unknown dialogue: ${dialogueId}`); current = state(dialogueId, graph.start, (current?.revision ?? 0) + 1); return current; },
    advance() { requireActive(disposed, "Dialogue runtime"); if (current === null) return Object.freeze({ ok: false, code: "not-started" }); if (current.complete) return Object.freeze({ ok: false, code: "already-complete" }); const node = graphs.get(current.dialogueId)?.nodes.get(current.nodeId!); if (node === undefined) throw new Error("Dialogue state is inconsistent"); if (node.choices.length > 0) return Object.freeze({ ok: false, code: "choice-required" }); return transition(node.next); },
    choose(rawChoiceId) { requireActive(disposed, "Dialogue runtime"); if (current === null) return Object.freeze({ ok: false, code: "not-started" }); if (current.complete) return Object.freeze({ ok: false, code: "already-complete" }); const node = graphs.get(current.dialogueId)?.nodes.get(current.nodeId!); const choice = node?.choices.find(({ id }) => id === requireId(rawChoiceId, "Dialogue choice ID")); if (choice === undefined) return Object.freeze({ ok: false, code: "unknown-choice" }); if (choice.condition !== null && !(hooks.checkCondition?.(choice.condition, current) ?? true)) return Object.freeze({ ok: false, code: "condition-rejected" }); if (choice.effect !== null) hooks.applyEffect?.(choice.effect, current); return transition(choice.target); },
    snapshot() { requireActive(disposed, "Dialogue runtime"); return current; },
    restore(raw) { requireActive(disposed, "Dialogue runtime"); if (typeof raw !== "object" || raw === null) throw new TypeError("Dialogue restore state is invalid"); const dialogueId = requireId(raw.dialogueId, "Dialogue ID"); const graph = graphs.get(dialogueId); const nodeId = raw.nodeId === null ? null : requireId(raw.nodeId, "Dialogue node ID"); if (graph === undefined || (nodeId !== null && !graph.nodes.has(nodeId))) throw new TypeError("Dialogue restore state references unknown data"); current = state(dialogueId, nodeId, requireTick(raw.revision, "Dialogue revision")); return current; },
    dispose() { if (!disposed) { disposed = true; current = null; graphs.clear(); } },
  });
}

// Vehicles
export interface VehicleDefinition { readonly id: string; readonly seats: readonly Readonly<{ readonly id: string; readonly role: "driver" | "passenger" }>[]; readonly acceleration: number; readonly braking: number; readonly steering: number; }
export interface VehicleControl { readonly throttle: number; readonly brake: number; readonly steering: number; }
export interface VehicleState { readonly id: string; readonly speed: number; readonly steering: number; readonly occupants: Readonly<Record<string, string>>; }
export interface VehicleEvent { readonly kind: "entered" | "exited" | "controlled" | "rejected"; readonly vehicleId: string; readonly actorId: string; readonly tick: number; readonly code: "not-driver" | "validation-rejected" | null; readonly state: VehicleState; }
export type VehicleOutcome = Readonly<{ readonly ok: true; readonly state: VehicleState }> | Readonly<{ readonly ok: false; readonly code: "unknown-vehicle" | "unknown-seat" | "seat-occupied" | "actor-already-seated" | "actor-not-seated" }>;
export interface VehicleRuntime { readonly disposed: boolean; enter(vehicleId: string, actorId: string, seatId: string): VehicleOutcome; exit(actorId: string): VehicleOutcome; requestControl(vehicleId: string, actorId: string, control: VehicleControl): void; step(tick: number, dt: number): readonly VehicleEvent[]; snapshot(): readonly VehicleState[]; dispose(): void; }

export function createVehicleRuntime(definitions: readonly VehicleDefinition[], hooks: Readonly<{ readonly validateControl?: (vehicle: VehicleState, actorId: string, control: VehicleControl) => boolean; readonly integrate?: (vehicle: VehicleState, control: VehicleControl, dt: number) => Readonly<{ speed: number; steering: number }> }> = {}): VehicleRuntime {
  if (!Array.isArray(definitions) || typeof hooks !== "object" || hooks === null || (hooks.validateControl !== undefined && typeof hooks.validateControl !== "function") || (hooks.integrate !== undefined && typeof hooks.integrate !== "function")) throw new TypeError("Vehicle options are invalid");
  const vehicles = new Map<string, { definition: Readonly<{ seats: ReadonlyMap<string, "driver" | "passenger">; acceleration: number; braking: number; steering: number }>; speed: number; steering: number; occupants: Map<string, string> }>();
  for (const raw of definitions) {
    const vehicleId = requireId(raw.id, "Vehicle ID"); const seats = new Map<string, "driver" | "passenger">();
    if (vehicles.has(vehicleId) || !Array.isArray(raw.seats) || raw.seats.length === 0) throw new TypeError(`Invalid or duplicate vehicle: ${vehicleId}`);
    for (const seat of raw.seats) { const seatId = requireId(seat.id, "Vehicle seat ID"); if (seats.has(seatId) || !["driver", "passenger"].includes(seat.role)) throw new TypeError(`Invalid or duplicate vehicle seat: ${seatId}`); seats.set(seatId, seat.role); }
    if (![...seats.values()].includes("driver")) throw new TypeError("Vehicle requires a driver seat");
    vehicles.set(vehicleId, { definition: Object.freeze({ seats, acceleration: Math.abs(requireFinite(raw.acceleration, "Vehicle acceleration")), braking: Math.abs(requireFinite(raw.braking, "Vehicle braking")), steering: Math.abs(requireFinite(raw.steering, "Vehicle steering")) }), speed: 0, steering: 0, occupants: new Map() });
  }
  const pending: { vehicleId: string; actorId: string; control: VehicleControl }[] = [];
  let disposed = false;
  function state(vehicleId: string, vehicle: { speed: number; steering: number; occupants: Map<string, string> }): VehicleState { return Object.freeze({ id: vehicleId, speed: vehicle.speed, steering: vehicle.steering, occupants: Object.freeze(Object.fromEntries([...vehicle.occupants].sort(([a], [b]) => compare(a, b)))) }); }
  function locate(actorId: string): [string, string] | undefined { for (const [vehicleId, vehicle] of vehicles) for (const [seatId, occupant] of vehicle.occupants) if (occupant === actorId) return [vehicleId, seatId]; return undefined; }
  return Object.freeze<VehicleRuntime>({
    get disposed() { return disposed; },
    enter(rawVehicleId, rawActorId, rawSeatId) { requireActive(disposed, "Vehicle runtime"); const vehicleId = requireId(rawVehicleId, "Vehicle ID"); const actorId = requireId(rawActorId, "Vehicle actor ID"); const seatId = requireId(rawSeatId, "Vehicle seat ID"); const vehicle = vehicles.get(vehicleId); if (vehicle === undefined) return Object.freeze({ ok: false, code: "unknown-vehicle" }); if (!vehicle.definition.seats.has(seatId)) return Object.freeze({ ok: false, code: "unknown-seat" }); if (vehicle.occupants.has(seatId)) return Object.freeze({ ok: false, code: "seat-occupied" }); if (locate(actorId) !== undefined) return Object.freeze({ ok: false, code: "actor-already-seated" }); vehicle.occupants.set(seatId, actorId); return Object.freeze({ ok: true, state: state(vehicleId, vehicle) }); },
    exit(rawActorId) { requireActive(disposed, "Vehicle runtime"); const actorId = requireId(rawActorId, "Vehicle actor ID"); const found = locate(actorId); if (found === undefined) return Object.freeze({ ok: false, code: "actor-not-seated" }); const vehicle = vehicles.get(found[0])!; vehicle.occupants.delete(found[1]); return Object.freeze({ ok: true, state: state(found[0], vehicle) }); },
    requestControl(rawVehicleId, rawActorId, rawControl) { requireActive(disposed, "Vehicle runtime"); if (typeof rawControl !== "object" || rawControl === null) throw new TypeError("Vehicle control is invalid"); const brake = requireFinite(rawControl.brake, "Vehicle brake"); if (brake < 0 || brake > 1) throw new TypeError("Vehicle brake must be between 0 and 1"); pending.push({ vehicleId: requireId(rawVehicleId, "Vehicle ID"), actorId: requireId(rawActorId, "Vehicle actor ID"), control: Object.freeze({ throttle: requireUnit(rawControl.throttle, "Vehicle throttle"), brake, steering: requireUnit(rawControl.steering, "Vehicle steering") }) }); },
    step(rawTick, rawDt) { requireActive(disposed, "Vehicle runtime"); const stepTick = requireTick(rawTick, "Vehicle tick"); const dt = requireFinite(rawDt, "Vehicle dt"); if (dt <= 0) throw new TypeError("Vehicle dt must be positive"); const events: VehicleEvent[] = []; for (const request of pending.splice(0).sort((a, b) => compare(a.vehicleId, b.vehicleId) || compare(a.actorId, b.actorId))) { const vehicle = vehicles.get(request.vehicleId); if (vehicle === undefined) continue; const before = state(request.vehicleId, vehicle); const driverSeat = [...vehicle.definition.seats].find(([, role]) => role === "driver")?.[0]; let code: VehicleEvent["code"] = vehicle.occupants.get(driverSeat ?? "") === request.actorId ? null : "not-driver"; if (code === null && !(hooks.validateControl?.(before, request.actorId, request.control) ?? true)) code = "validation-rejected"; if (code !== null) { events.push(Object.freeze({ kind: "rejected", vehicleId: request.vehicleId, actorId: request.actorId, tick: stepTick, code, state: before })); continue; } const integrated = hooks.integrate?.(before, request.control, dt); vehicle.speed = integrated === undefined ? Math.max(0, vehicle.speed + request.control.throttle * vehicle.definition.acceleration * dt - request.control.brake * vehicle.definition.braking * dt) : requireFinite(integrated.speed, "Integrated vehicle speed"); vehicle.steering = integrated === undefined ? request.control.steering * vehicle.definition.steering : requireFinite(integrated.steering, "Integrated vehicle steering"); events.push(Object.freeze({ kind: "controlled", vehicleId: request.vehicleId, actorId: request.actorId, tick: stepTick, code: null, state: state(request.vehicleId, vehicle) })); } return Object.freeze(events); },
    snapshot() { requireActive(disposed, "Vehicle runtime"); return Object.freeze([...vehicles].sort(([a], [b]) => compare(a, b)).map(([vehicleId, vehicle]) => state(vehicleId, vehicle))); },
    dispose() { if (!disposed) { disposed = true; pending.length = 0; vehicles.clear(); } },
  });
}

// Structured Debug / DevTools
export interface DebugSnapshot { readonly sequence: number; readonly tick: number; readonly providers: Readonly<Record<string, AdvancedValue>>; }
export interface DebugCommand { readonly kind: string; readonly payload: AdvancedValue; }
export interface DebugDevToolsRuntime { readonly disposed: boolean; registerProvider(id: string, capture: () => unknown): void; unregisterProvider(id: string): boolean; capture(tick: number): DebugSnapshot; exportSnapshot(snapshot: DebugSnapshot): string; inject(command: DebugCommand): boolean; inspect(): Readonly<{ disposed: boolean; providerIds: readonly string[]; commandKinds: readonly string[]; captureCount: number; injectionCount: number }>; dispose(): void; }

export function createDebugDevToolsRuntime(commandHandlers: Readonly<Record<string, (payload: AdvancedValue) => void>> = {}): DebugDevToolsRuntime {
  if (typeof commandHandlers !== "object" || commandHandlers === null || Array.isArray(commandHandlers)) throw new TypeError("Debug command handlers are invalid");
  const handlers = new Map<string, (payload: AdvancedValue) => void>();
  for (const [kind, handler] of Object.entries(commandHandlers)) { if (typeof handler !== "function") throw new TypeError("Debug command handlers must be functions"); handlers.set(requireId(kind, "Debug command kind"), handler); }
  const providers = new Map<string, () => unknown>(); let sequence = 0; let injectionCount = 0; let disposed = false;
  return Object.freeze<DebugDevToolsRuntime>({
    get disposed() { return disposed; },
    registerProvider(rawId, capture) { requireActive(disposed, "Debug DevTools runtime"); const providerId = requireId(rawId, "Debug provider ID"); if (providers.has(providerId) || typeof capture !== "function") throw new TypeError(`Invalid or duplicate debug provider: ${providerId}`); providers.set(providerId, capture); },
    unregisterProvider(rawId) { requireActive(disposed, "Debug DevTools runtime"); return providers.delete(requireId(rawId, "Debug provider ID")); },
    capture(rawTick) { requireActive(disposed, "Debug DevTools runtime"); const entries: [string, AdvancedValue][] = []; for (const [providerId, capture] of [...providers].sort(([a], [b]) => compare(a, b))) entries.push([providerId, copyValue(capture())]); sequence += 1; return Object.freeze({ sequence, tick: requireTick(rawTick, "Debug tick"), providers: Object.freeze(Object.fromEntries(entries)) }); },
    exportSnapshot(snapshot) { requireActive(disposed, "Debug DevTools runtime"); return JSON.stringify(copyValue(snapshot)); },
    inject(rawCommand) { requireActive(disposed, "Debug DevTools runtime"); if (typeof rawCommand !== "object" || rawCommand === null) throw new TypeError("Debug command is invalid"); const handler = handlers.get(requireId(rawCommand.kind, "Debug command kind")); if (handler === undefined) return false; handler(copyValue(rawCommand.payload)); injectionCount += 1; return true; },
    inspect() { return Object.freeze({ disposed, providerIds: Object.freeze([...providers.keys()].sort(compare)), commandKinds: Object.freeze([...handlers.keys()].sort(compare)), captureCount: sequence, injectionCount }); },
    dispose() { if (!disposed) { disposed = true; providers.clear(); handlers.clear(); } },
  });
}
