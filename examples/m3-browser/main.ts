import { createRapierCollisionAdapter } from "@three-game-kit/client/collision";
import {
  createNativeClientTransport,
  type Options as ClientNetworkingOptions,
  type OutboundMessage,
} from "@three-game-kit/client/networking";
import { createClientReplicationEngine } from "@three-game-kit/client/replication";
import type {
  ClientAction,
  ClientMessage,
} from "@three-game-kit/protocol";

const query = new URLSearchParams(window.location.search);
const url = query.get("url") ?? "ws://127.0.0.1:8080";
const label = query.get("label") ?? "m3-browser";

function coordinate(name: "x" | "y" | "z", fallback: number): number {
  const value = query.get(name);
  if (value === null) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const initialPosition = Object.freeze({
  x: coordinate("x", 0),
  y: coordinate("y", 1),
  z: coordinate("z", 0),
});
const appToken = window.crypto.randomUUID();
const errors: string[] = [];

function capture(error: unknown): void {
  if (errors.length < 32) {
    let message: string;
    try {
      message = String(error instanceof Error ? error.message : error);
    } catch {
      message = "unprintable_error";
    }
    errors.push(message.replace(/[\u0009-\u000d\u0085]/g, "").slice(0, 512));
  }
}

const onError = (event: ErrorEvent): void => {
  capture(event.error ?? event.message);
};
const onUnhandledRejection = (event: PromiseRejectionEvent): void => {
  capture(event.reason);
};

window.addEventListener("error", onError);
window.addEventListener("unhandledrejection", onUnhandledRejection);

const collisionAdapter = createRapierCollisionAdapter({ capsuleRadius: 0.5, capsuleHalfHeight: 0.5, controllerOffset: 0.01, boxes: [{ id: "floor", center: { x: 0, y: -0.5, z: 0 }, halfExtents: { x: 20, y: 0.5, z: 20 } }, { id: "wall", center: { x: 2.5, y: 1, z: 0 }, halfExtents: { x: 0.5, y: 1, z: 2 } }] });

const injectorEnabled = query.get("injector") === "playwright";
let routeOrdinal: number | undefined;
let outboundGate: ((metadata: OutboundMessage) => Promise<void>) | undefined;

if (injectorEnabled) {
  const routeOrdinalValue = query.get("routeOrdinal");
  const parsedRouteOrdinal = Number(routeOrdinalValue);
  if (
    routeOrdinalValue === null ||
    !Number.isSafeInteger(parsedRouteOrdinal) ||
    parsedRouteOrdinal <= 0
  ) {
    throw new Error("invalid_playwright_route_ordinal");
  }
  const binding = window.__threeGameKitM3OutboundGate;
  if (typeof binding !== "function") {
    throw new Error("missing_playwright_outbound_gate");
  }
  routeOrdinal = parsedRouteOrdinal;
  outboundGate = async (metadata) => {
    try {
      await binding(metadata);
    } catch (error) {
      capture(error);
      throw error;
    }
  };
}

let replication!: ReturnType<typeof createClientReplicationEngine>;

const transportOptions: Pick<
  ClientNetworkingOptions,
  "url" | "receive"
> = {
  url,
  receive(message) { const r = replication.receive(message); if (!r.ok) capture(r.failure.code); },
};
const transport =
  injectorEnabled && routeOrdinal !== undefined && outboundGate !== undefined
    ? createNativeClientTransport({
        ...transportOptions,
        routeOrdinal,
        outboundGate,
      })
    : createNativeClientTransport(transportOptions);

replication = createClientReplicationEngine({ movementSpeedMetersPerSecond: 6, initialPosition, collisionAdapter, emit(message) { const r = message.kind === "join" ? transport.join() : transport.command(message); if (!r.ok) throw new Error(r.failure.code); } });

function detachedFrozen<T>(value: T): T {
  const copy = structuredClone(value);

  function freeze(item: unknown): void {
    if (item === null || typeof item !== "object" || Object.isFrozen(item)) {
      return;
    }
    for (const nested of Object.values(item as Record<string, unknown>)) {
      freeze(nested);
    }
    Object.freeze(item);
  }

  freeze(copy);
  return copy;
}

export async function waitFor(predicate: () => boolean): Promise<void> {
  for(let i=0;i<500;i++){if(predicate())return; await new Promise<void>(resolve=>window.setTimeout(resolve,10));} throw new Error("timeout");
}

function inspect() {
  const transportInspection = transport.inspect();
  const replicationInspection = replication.inspect();
  const positions = {
    simulationPosition: replicationInspection.simulationPosition,
    localPresentationPosition: replicationInspection.localPresentationPosition,
    remoteAvatars: replicationInspection.remoteAvatars,
  };

  return Object.freeze({
    transport: detachedFrozen(transportInspection),
    replication: detachedFrozen(replicationInspection),
    errors: detachedFrozen(errors),
    label,
    appToken,
    positions: detachedFrozen(positions),
    injector: detachedFrozen({
      enabled: injectorEnabled,
      routeOrdinal: routeOrdinal ?? null,
    }),
  });
}

function requireOk(outcome: { ok: boolean; failure?: { code: string } }): void {
  if (!outcome.ok) {
    throw new Error(outcome.failure?.code ?? "operation_failed");
  }
}

function requireNoLiveResources(name: string, inspection: unknown): void {
  const counts = (inspection as {
    liveResourceCounts?: Readonly<Record<string, number>>;
  }).liveResourceCounts;
  if (
    counts === undefined ||
    Object.values(counts).some((count) => count !== 0)
  ) {
    throw new Error(`${name}_live_resources`);
  }
}

let bootPromise: Promise<ReturnType<typeof inspect>> | undefined;
let shutdownPromise: Promise<ReturnType<typeof inspect>> | undefined;

function boot() {
  bootPromise ??= (async () => {
    const connected = transport.connect();
    requireOk(connected);
    await waitFor(()=>transport.state==="ready");
    const joined = replication.beginJoin();
    requireOk(joined);
    await waitFor(()=>transport.state==="joined"&&replication.state==="joined");
    return inspect();
  })();
  return bootPromise;
}

export const app = Object.freeze({
  boot,

  queueMove(x: number, z: number) {
    return replication.queueMove(x, z);
  },

  sendCommand(
    sequence: number,
    intendedTick: number,
    action: ClientAction,
  ) {
    const detachedAction: ClientAction =
      action.kind === "move"
        ? { kind: "move", x: action.x, z: action.z }
        : {
            kind: "interact",
            targetEntityId: action.targetEntityId,
          };
    Object.freeze(detachedAction);

    const message: ClientMessage = {
      protocolVersion: 1,
      kind: "command",
      sequence,
      intendedTick,
      action: detachedAction,
    };
    Object.freeze(message);
    return transport.command(message);
  },

  stepExact(count: number) {
    return replication.stepExact(count);
  },

  frame(nowMs: number) {
    return replication.frame(nowMs);
  },

  inspect,

  disconnect() {
    const transportOutcome = transport.disconnect();
    const replicationOutcome = replication.disconnect();
    requireOk(transportOutcome);
    requireOk(replicationOutcome);
    return inspect();
  },

  shutdown() {
    shutdownPromise ??= (async () => {
      const transportOutcome = await transport.shutdown();
      requireOk(transportOutcome);
      const replicationOutcome = replication.shutdown();
      requireOk(replicationOutcome);
      requireNoLiveResources("transport", transport.inspect());
      requireNoLiveResources("replication", replication.inspect());
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
      return inspect();
    })();
    return shutdownPromise;
  },
});

declare global {
  interface Window {
    readonly threeGameKitM3: typeof app;
    readonly __threeGameKitM3OutboundGate?: (
      metadata: OutboundMessage,
    ) => Promise<void>;
  }
}

Object.defineProperty(window, "threeGameKitM3", {
  value: app,
  writable: false,
  configurable: false,
});
