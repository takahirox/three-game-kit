import {
  PROTOCOL_VERSION,
  decodeServerMessage,
  encodeClientMessage,
  type ClientMessage,
  type ServerMessage,
} from "@three-game-kit/protocol";

const RECORD_CAPACITY = 256;

export type NativeClientTransportState =
  | "idle"
  | "connecting"
  | "ready"
  | "joining"
  | "joined"
  | "disconnecting"
  | "closed"
  | "shutting-down"
  | "shutdown";

export type Operation =
  | "connect"
  | "join"
  | "command"
  | "receive"
  | "disconnect"
  | "shutdown";

export type ErrorCode =
  | "invalid-state"
  | "connect-failed"
  | "extensions-negotiated"
  | "binary-frame"
  | "message-too-large"
  | "invalid-utf8"
  | "invalid-json"
  | "not-json-object"
  | "unsupported-version"
  | "unknown-kind"
  | "wrong-direction"
  | "schema-invalid"
  | "phase-invalid"
  | "send-failed"
  | "peer-error"
  | "shutdown-failed";

export interface OutboundMessage {
  readonly direction: "c2s";
  readonly routeOrdinal: number;
  readonly messageOrdinal: number;
  readonly operation: "join" | "command";
  readonly text: string;
}

export interface Options {
  readonly url: string;
  readonly receive: (message: ServerMessage) => void;
  readonly routeOrdinal?: number;
  readonly outboundGate?: (
    metadata: OutboundMessage,
  ) => void | Promise<void>;
}

export interface Binding {
  readonly connectionId: string;
  readonly playerId: string;
  readonly ownedEntityId: string;
  readonly serverTick: number;
}

export interface StateRecord {
  readonly sequence: number;
  readonly runtime: "client";
  readonly scope: "transport";
  readonly previousState: NativeClientTransportState;
  readonly nextState: NativeClientTransportState;
  readonly operation: Operation;
  readonly connectionId: string | null;
}

export interface ErrorRecord {
  readonly sequence: number;
  readonly runtime: "client";
  readonly operation: Operation;
  readonly state: NativeClientTransportState;
  readonly code: ErrorCode;
  readonly expected: true;
  readonly connectionId: string | null;
}

export interface ErrorCounts {
  readonly "invalid-state": number;
  readonly "connect-failed": number;
  readonly "extensions-negotiated": number;
  readonly "binary-frame": number;
  readonly "message-too-large": number;
  readonly "invalid-utf8": number;
  readonly "invalid-json": number;
  readonly "not-json-object": number;
  readonly "unsupported-version": number;
  readonly "unknown-kind": number;
  readonly "wrong-direction": number;
  readonly "schema-invalid": number;
  readonly "phase-invalid": number;
  readonly "send-failed": number;
  readonly "peer-error": number;
  readonly "shutdown-failed": number;
}

export interface LiveResourceCounts {
  readonly nativeReferences: number;
  readonly callbacks: number;
  readonly bindings: number;
  readonly queuedItems: number;
  readonly timers: number;
  readonly retainedReferences: number;
}

export interface Inspection {
  readonly state: NativeClientTransportState;
  readonly binding: Binding | null;
  readonly transitionCount: number;
  readonly evictedTransitionCount: number;
  readonly transitions: readonly StateRecord[];
  readonly errorCount: number;
  readonly evictedErrorCount: number;
  readonly errors: readonly ErrorRecord[];
  readonly errorCounts: ErrorCounts;
  readonly liveResourceCounts: LiveResourceCounts;
}

export interface Failure {
  readonly code: ErrorCode;
  readonly operation: Operation;
  readonly state: NativeClientTransportState;
}

export type Outcome<Value = undefined> =
  | Readonly<{ readonly ok: true; readonly value: Value }>
  | Readonly<{ readonly ok: false; readonly failure: Failure }>;

export interface NativeClientTransport {
  readonly state: NativeClientTransportState;
  readonly binding: Binding | null;
  connect(): Outcome;
  join(): Outcome;
  command(message: ClientMessage): Outcome;
  disconnect(): Outcome;
  inspect(): Inspection;
  shutdown(): Promise<Outcome>;
}

type MutableErrorCounts = {
  -readonly [Code in ErrorCode]: number;
};

function createErrorCounts(): MutableErrorCounts {
  return {
    "invalid-state": 0,
    "connect-failed": 0,
    "extensions-negotiated": 0,
    "binary-frame": 0,
    "message-too-large": 0,
    "invalid-utf8": 0,
    "invalid-json": 0,
    "not-json-object": 0,
    "unsupported-version": 0,
    "unknown-kind": 0,
    "wrong-direction": 0,
    "schema-invalid": 0,
    "phase-invalid": 0,
    "send-failed": 0,
    "peer-error": 0,
    "shutdown-failed": 0,
  };
}

function succeeded<Value>(value: Value): Outcome<Value> {
  return Object.freeze({ ok: true, value });
}

function failed(
  code: ErrorCode,
  operation: Operation,
  state: NativeClientTransportState,
): Outcome<never> {
  return Object.freeze({
    ok: false,
    failure: Object.freeze({ code, operation, state }),
  });
}

function copyBinding(binding: Binding | null): Binding | null {
  if (binding === null) return null;
  return Object.freeze({
    connectionId: binding.connectionId,
    playerId: binding.playerId,
    ownedEntityId: binding.ownedEntityId,
    serverTick: binding.serverTick,
  });
}

function validateOptions(options: Options): void {
  if (
    typeof options !== "object" ||
    options === null ||
    Array.isArray(options) ||
    typeof options.url !== "string" ||
    options.url.length === 0
  ) {
    throw new TypeError("Native Client transport requires a non-empty URL");
  }
  if (typeof options.receive !== "function") {
    throw new TypeError("Native Client transport requires a receive callback");
  }
  if (options.outboundGate !== undefined) {
    if (typeof options.outboundGate !== "function") {
      throw new TypeError("Native Client transport requires an outbound gate function");
    }
    if (
      !Number.isSafeInteger(options.routeOrdinal) ||
      (options.routeOrdinal ?? 0) <= 0
    ) {
      throw new TypeError("Native Client transport requires a positive route ordinal when an outbound gate is supplied");
    }
  }
}

export function createNativeClientTransport(
  options: Options,
): NativeClientTransport {
  validateOptions(options);
  const url = options.url;
  let receive: ((message: ServerMessage) => void) | null = options.receive;
  const outboundGate = options.outboundGate ?? null;
  const routeOrdinal = options.routeOrdinal ?? 0;
  let messageOrdinal = 0;
  let queuedItems = 0;
  let state: NativeClientTransportState = "idle";
  let binding: Binding | null = null;
  let live = false;
  let generation = 0;
  let native: globalThis.WebSocket | null = null;
  let openCallback: (() => void) | null = null;
  let messageCallback:
    | ((entry: globalThis.MessageEvent<unknown>) => void)
    | null = null;
  let closeCallback: (() => void) | null = null;
  let errorCallback: (() => void) | null = null;
  let transitionCount = 0;
  let evictedTransitionCount = 0;
  let errorCount = 0;
  let evictedErrorCount = 0;
  let shutdownPromise: Promise<Outcome> | null = null;
  let settleShutdown: ((outcome: Outcome) => void) | null = null;
  const transitions: StateRecord[] = [];
  const errors: ErrorRecord[] = [];
  const errorCounts = createErrorCounts();

  const currentConnectionId = (): string | null =>
    binding === null ? null : binding.connectionId;

  function appendBounded<Value>(
    records: Value[],
    value: Value,
    markEvicted: () => void,
  ): void {
    if (records.length === RECORD_CAPACITY) {
      records.shift();
      markEvicted();
    }
    records.push(value);
  }

  function transition(
    nextState: NativeClientTransportState,
    operation: Operation,
  ): void {
    if (state === nextState) return;
    const previousState = state;
    state = nextState;
    if (transitionCount < Number.MAX_SAFE_INTEGER) transitionCount += 1;
    const record = Object.freeze({
      sequence: transitionCount,
      runtime: "client" as const,
      scope: "transport" as const,
      previousState,
      nextState,
      operation,
      connectionId: currentConnectionId(),
    });
    appendBounded(transitions, record, () => {
      if (evictedTransitionCount < Number.MAX_SAFE_INTEGER) {
        evictedTransitionCount += 1;
      }
    });
  }

  function recordError(code: ErrorCode, operation: Operation): void {
    if (errorCounts[code] < Number.MAX_SAFE_INTEGER) errorCounts[code] += 1;
    if (errorCount < Number.MAX_SAFE_INTEGER) errorCount += 1;
    const record = Object.freeze({
      sequence: errorCount,
      runtime: "client" as const,
      operation,
      state,
      code,
      expected: true as const,
      connectionId: currentConnectionId(),
    });
    appendBounded(errors, record, () => {
      if (evictedErrorCount < Number.MAX_SAFE_INTEGER) evictedErrorCount += 1;
    });
  }

  function invalidState(operation: Operation): Outcome<never> {
    const rejectedState = state;
    recordError("invalid-state", operation);
    return failed("invalid-state", operation, rejectedState);
  }

  function isCurrent(
    expectedGeneration: number,
    expectedNative: globalThis.WebSocket,
  ): boolean {
    return (
      live &&
      generation === expectedGeneration &&
      native === expectedNative &&
      state !== "disconnecting" &&
      state !== "closed" &&
      state !== "shutting-down" &&
      state !== "shutdown"
    );
  }

  function clearAdmissionCallbacks(): void {
    const owned = native;
    if (owned !== null) {
      if (openCallback !== null) owned.onopen = null;
      if (messageCallback !== null) owned.onmessage = null;
    }
    openCallback = null;
    messageCallback = null;
  }

  function clearTerminalCallbacks(): void {
    const owned = native;
    if (owned !== null) {
      if (closeCallback !== null) owned.onclose = null;
      if (errorCallback !== null) owned.onerror = null;
    }
    closeCallback = null;
    errorCallback = null;
  }

  function finishClosed(operation: Operation): void {
    if (state !== "disconnecting") return;
    clearTerminalCallbacks();
    native = null;
    transition("closed", operation);
  }

  function finishShutdown(success: boolean): void {
    if (state !== "shutting-down") return;
    clearTerminalCallbacks();
    native = null;
    transition("shutdown", "shutdown");
    const settle = settleShutdown;
    settleShutdown = null;
    if (settle !== null) {
      settle(
        success
          ? succeeded(undefined)
          : failed("shutdown-failed", "shutdown", "shutting-down"),
      );
    }
  }

  function startDisconnect(
    operation: Operation,
    reportCloseFailure: boolean,
  ): boolean {
    if (
      state === "disconnecting" ||
      state === "closed" ||
      state === "shutting-down" ||
      state === "shutdown"
    ) {
      return true;
    }

    transition("disconnecting", operation);
    live = false;
    generation += 1;
    binding = null;
    receive = null;
    clearAdmissionCallbacks();

    const owned = native;
    if (owned === null || owned.readyState === 3) {
      finishClosed(operation);
      return true;
    }
    if (owned.readyState === 2) return true;
    try {
      owned.close();
      return true;
    } catch {
      if (reportCloseFailure) recordError("peer-error", operation);
      finishClosed(operation);
      return false;
    }
  }

  function fatal(code: ErrorCode, operation: Operation): Outcome<never> {
    const failedState = state;
    recordError(code, operation);
    startDisconnect(operation, false);
    return failed(code, operation, failedState);
  }

  function installCallbacks(
    owned: globalThis.WebSocket,
    expectedGeneration: number,
  ): void {
    openCallback = () => {
      if (!isCurrent(expectedGeneration, owned) || state !== "connecting") {
        return;
      }
      if (owned.extensions !== "") {
        fatal("extensions-negotiated", "connect");
        return;
      }
      if (!isCurrent(expectedGeneration, owned)) return;
      transition("ready", "connect");
    };

    messageCallback = (entry) => {
      if (!isCurrent(expectedGeneration, owned)) return;
      if (typeof entry.data !== "string") {
        fatal("binary-frame", "receive");
        return;
      }
      if (!isCurrent(expectedGeneration, owned)) return;

      const decoded = decodeServerMessage({
        kind: "text",
        bytes: new TextEncoder().encode(entry.data),
      });
      if (!decoded.ok) {
        fatal(decoded.failure.reason, "receive");
        return;
      }
      if (!isCurrent(expectedGeneration, owned)) return;

      const message = decoded.value;
      if (state === "joining" && message.kind === "joined") {
        binding = Object.freeze({
          connectionId: message.connectionId,
          playerId: message.playerId,
          ownedEntityId: message.ownedEntityId,
          serverTick: message.serverTick,
        });
        transition("joined", "receive");
      } else if (
        state !== "joined" ||
        (message.kind !== "snapshot" && message.kind !== "rejected")
      ) {
        fatal("phase-invalid", "receive");
        return;
      }

      if (!isCurrent(expectedGeneration, owned)) return;
      const callback = receive;
      if (callback === null) return;
      if (!isCurrent(expectedGeneration, owned)) return;
      callback(message);
    };

    closeCallback = () => {
      if (native !== owned) return;
      if (state === "shutting-down") {
        finishShutdown(true);
        return;
      }
      if (state === "disconnecting") {
        finishClosed("disconnect");
        return;
      }
      if (
        state === "connecting" ||
        state === "ready" ||
        state === "joining" ||
        state === "joined"
      ) {
        recordError("peer-error", "disconnect");
        startDisconnect("disconnect", false);
      }
    };

    errorCallback = () => {
      if (!isCurrent(expectedGeneration, owned)) return;
      fatal("peer-error", "receive");
    };

    owned.onopen = openCallback;
    owned.onmessage = messageCallback;
    owned.onclose = closeCallback;
    owned.onerror = errorCallback;
  }

  function send(
    message: ClientMessage,
    operation: "join" | "command",
    permittedState: "joining" | "joined",
  ): Outcome {
    const expectedGeneration = generation;
    const owned = native;
    const encoded = encodeClientMessage(message);
    if (!encoded.ok) return fatal("send-failed", operation);
    if (
      owned === null ||
      state !== permittedState ||
      !isCurrent(expectedGeneration, owned) ||
      owned.readyState !== 1
    ) {
      return fatal("send-failed", operation);
    }
    if (!isCurrent(expectedGeneration, owned)) {
      return fatal("send-failed", operation);
    }

    const sendIfCurrent = (): Outcome => {
      if (
        !isCurrent(expectedGeneration, owned) ||
        state !== permittedState ||
        owned.readyState !== 1
      ) {
        return succeeded(undefined);
      }
      try {
        owned.send(encoded.value.text);
      } catch {
        return fatal("send-failed", operation);
      }
      return succeeded(undefined);
    };

    if (outboundGate === null) {
      return sendIfCurrent();
    }

    messageOrdinal += 1;
    const metadata: OutboundMessage = Object.freeze({
      direction: "c2s",
      routeOrdinal,
      messageOrdinal,
      operation,
      text: encoded.value.text,
    });

    let pending: void | Promise<void>;
    try {
      pending = outboundGate(metadata);
    } catch {
      return fatal("send-failed", operation);
    }
    if (pending === undefined) return sendIfCurrent();

    queuedItems += 1;
    Promise.resolve(pending).then(
      () => {
        queuedItems -= 1;
        sendIfCurrent();
      },
      () => {
        queuedItems -= 1;
        if (
          isCurrent(expectedGeneration, owned) &&
          state === permittedState &&
          owned.readyState === 1
        ) {
          fatal("send-failed", operation);
        }
      },
    );
    return succeeded(undefined);
  }

  const transport: NativeClientTransport = Object.freeze({
    get state(): NativeClientTransportState {
      return state;
    },

    get binding(): Binding | null {
      return copyBinding(binding);
    },

    connect(): Outcome {
      if (state !== "idle") return invalidState("connect");
      transition("connecting", "connect");
      generation += 1;
      const expectedGeneration = generation;
      live = true;

      let created: globalThis.WebSocket;
      try {
        created = new globalThis.WebSocket(url);
      } catch {
        return fatal("connect-failed", "connect");
      }
      native = created;
      try {
        installCallbacks(created, expectedGeneration);
      } catch {
        return fatal("connect-failed", "connect");
      }
      return succeeded(undefined);
    },

    join(): Outcome {
      if (state !== "ready") return invalidState("join");
      const message: ClientMessage = {
        protocolVersion: PROTOCOL_VERSION,
        kind: "join",
      };
      transition("joining", "join");
      return send(message, "join", "joining");
    },

    command(message: ClientMessage): Outcome {
      if (state !== "joined" || message.kind !== "command") {
        return invalidState("command");
      }
      const outcome = send(message, "command", "joined");
      return outcome;
    },

    disconnect(): Outcome {
      if (
        state !== "connecting" &&
        state !== "ready" &&
        state !== "joining" &&
        state !== "joined"
      ) {
        return invalidState("disconnect");
      }
      const failedState = state;
      if (!startDisconnect("disconnect", true)) {
        return failed("peer-error", "disconnect", failedState);
      }
      return succeeded(undefined);
    },

    inspect(): Inspection {
      let callbackCount = 0;
      if (openCallback !== null) callbackCount += 1;
      if (messageCallback !== null) callbackCount += 1;
      if (closeCallback !== null) callbackCount += 1;
      if (errorCallback !== null) callbackCount += 1;
      const nativeCount = native === null ? 0 : 1;
      const receiveCount = receive === null ? 0 : 1;
      return Object.freeze({
        state,
        binding: copyBinding(binding),
        transitionCount,
        evictedTransitionCount,
        transitions: Object.freeze(transitions.slice()),
        errorCount,
        evictedErrorCount,
        errors: Object.freeze(errors.slice()),
        errorCounts: Object.freeze({ ...errorCounts }),
        liveResourceCounts: Object.freeze({
          nativeReferences: nativeCount,
          callbacks: callbackCount,
          bindings: binding === null ? 0 : 1,
          queuedItems,
          timers: 0,
          retainedReferences: nativeCount + receiveCount,
        }),
      });
    },

    shutdown(): Promise<Outcome> {
      if (shutdownPromise !== null) return shutdownPromise;
      shutdownPromise = new Promise<Outcome>((resolve) => {
        settleShutdown = resolve;
      });

      transition("shutting-down", "shutdown");
      live = false;
      generation += 1;
      binding = null;
      clearAdmissionCallbacks();
      receive = null;

      const owned = native;
      if (owned === null || owned.readyState === 3) {
        finishShutdown(true);
        return shutdownPromise;
      }
      if (owned.readyState === 2) return shutdownPromise;
      try {
        owned.close();
      } catch {
        recordError("shutdown-failed", "shutdown");
        finishShutdown(false);
      }
      return shutdownPromise;
    },
  });

  return transport;
}
