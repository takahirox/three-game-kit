import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from "node:http";
import type { Buffer } from "node:buffer";
import type { Duplex } from "node:stream";
import {
  MAX_MESSAGE_BYTES,
  decodeClientMessage,
  encodeServerMessage,
  type DecodeFailureReason,
  type ProtocolFrameInput,
  type ServerMessage,
} from "@three-game-kit/protocol";
import WebSocket, { WebSocketServer, type RawData } from "ws";
import type { AuthoritativeConnection, AuthoritativeServer } from "./authoritative.js";

export type AuthoritativeWebSocketServerState =
  | "idle"
  | "listening"
  | "ready"
  | "shutting-down"
  | "shutdown";

export type AuthoritativeWebSocketServerFailureCode =
  | "invalid-state"
  | "bind-failed"
  | "shutdown-failed";

export interface ServerOutboundMessage {
  readonly direction: "s2c";
  readonly connectionOrdinal: number;
  readonly messageOrdinal: number;
  readonly operation: "joined" | "snapshot" | "rejected";
  readonly encoded: string;
}

export interface AuthoritativeWebSocketServerOptions {
  readonly authoritativeServer: AuthoritativeServer;
  readonly host: string;
  readonly port: number;
  readonly path: string;
  readonly outboundGate?: (message: ServerOutboundMessage) => void | Promise<void>;
}

export interface AuthoritativeWebSocketServerListenResult {
  readonly url: string;
  readonly path: string;
}

export interface AuthoritativeWebSocketServerDecodeFailureCounts {
  readonly "binary-frame": number;
  readonly "message-too-large": number;
  readonly "invalid-utf8": number;
  readonly "invalid-json": number;
  readonly "not-json-object": number;
  readonly "unsupported-version": number;
  readonly "unknown-kind": number;
  readonly "wrong-direction": number;
  readonly "schema-invalid": number;
}

export interface AuthoritativeWebSocketServerInspection {
  readonly state: AuthoritativeWebSocketServerState;
  readonly url: string | null;
  readonly connectionCount: number;
  readonly socketCount: number;
  readonly listenerCount: number;
  readonly queuedItemCount: number;
  readonly timerCount: number;
  readonly decodeFailureCounts: AuthoritativeWebSocketServerDecodeFailureCounts;
}

export interface AuthoritativeWebSocketServerFailure {
  readonly code: AuthoritativeWebSocketServerFailureCode;
  readonly operation: "listen" | "shutdown";
  readonly state: AuthoritativeWebSocketServerState;
}

export type AuthoritativeWebSocketServerOutcome<Value = undefined> =
  | Readonly<{ readonly ok: true; readonly value: Value }>
  | Readonly<{ readonly ok: false; readonly failure: AuthoritativeWebSocketServerFailure }>;

export interface AuthoritativeWebSocketServer {
  readonly state: AuthoritativeWebSocketServerState;
  listen(): Promise<AuthoritativeWebSocketServerOutcome<AuthoritativeWebSocketServerListenResult>>;
  inspect(): AuthoritativeWebSocketServerInspection;
  shutdown(): Promise<AuthoritativeWebSocketServerOutcome>;
}

type MessageListener = (data: RawData, isBinary: boolean) => void;
type CloseListener = () => void;
type ErrorListener = (error: Error) => void;
type RequestListener = (request: IncomingMessage, response: ServerResponse) => void;
type UpgradeListener = (request: IncomingMessage, socket: Duplex, head: Buffer) => void;
type ServerErrorListener = (error: Error) => void;
type ListeningListener = () => void;

interface ConnectionRecord {
  readonly ordinal: number;
  nextMessageOrdinal: number;
  live: boolean;
  generation: number;
  socket: WebSocket | null;
  authoritative: AuthoritativeConnection | null;
  message: MessageListener | null;
  close: CloseListener | null;
  error: ErrorListener | null;
}

type MutableDecodeCounts = Record<DecodeFailureReason, number>;

function newDecodeCounts(): MutableDecodeCounts {
  return {
    "binary-frame": 0,
    "message-too-large": 0,
    "invalid-utf8": 0,
    "invalid-json": 0,
    "not-json-object": 0,
    "unsupported-version": 0,
    "unknown-kind": 0,
    "wrong-direction": 0,
    "schema-invalid": 0,
  };
}

function ok<Value>(value: Value): AuthoritativeWebSocketServerOutcome<Value> {
  return Object.freeze({ ok: true, value });
}

function fail<Value = never>(
  code: AuthoritativeWebSocketServerFailureCode,
  operation: "listen" | "shutdown",
  state: AuthoritativeWebSocketServerState,
): AuthoritativeWebSocketServerOutcome<Value> {
  return Object.freeze({
    ok: false,
    failure: Object.freeze({ code, operation, state }),
  });
}

function validate(options: AuthoritativeWebSocketServerOptions): void {
  if (
    typeof options !== "object" ||
    options === null ||
    typeof options.authoritativeServer !== "object" ||
    options.authoritativeServer === null ||
    typeof options.authoritativeServer.acceptConnection !== "function"
  ) {
    throw new TypeError("Authoritative WebSocket Server options require an AuthoritativeServer");
  }
  if (options.outboundGate !== undefined && typeof options.outboundGate !== "function") {
    throw new TypeError("The outbound gate must be a function");
  }
  if (
    typeof options.host !== "string" ||
    options.host.length === 0 ||
    /[\u0000-\u0020/?#]/u.test(options.host)
  ) {
    throw new TypeError("The WebSocket host must be a non-empty host string");
  }
  if (!Number.isSafeInteger(options.port) || options.port < 0 || options.port > 65_535) {
    throw new RangeError("The WebSocket port must be an integer from 0 through 65535");
  }
  if (
    typeof options.path !== "string" ||
    !options.path.startsWith("/") ||
    options.path.includes("?") ||
    options.path.includes("#") ||
    /[\u0000-\u001f\u007f]/u.test(options.path) ||
    new URL(options.path, "http://localhost").pathname !== options.path
  ) {
    throw new TypeError("The WebSocket path must be one canonical absolute pathname");
  }
}

function copyText(data: RawData): Uint8Array {
  if (Array.isArray(data)) {
    const size = data.reduce((total, part) => total + part.byteLength, 0);
    const copy = new Uint8Array(size);
    let offset = 0;
    for (const part of data) {
      copy.set(new Uint8Array(part.buffer, part.byteOffset, part.byteLength), offset);
      offset += part.byteLength;
    }
    return copy;
  }
  if (data instanceof ArrayBuffer) return new Uint8Array(data.slice(0));
  return Uint8Array.from(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
}

function rejectUpgrade(socket: Duplex, status: 404 | 503): void {
  try {
    socket.write(
      "HTTP/1.1 " +
        String(status) +
        (status === 404 ? " Not Found" : " Service Unavailable") +
        "\r\nConnection: close\r\nContent-Length: 0\r\n\r\n",
    );
  } catch {
    // Destruction remains terminal.
  }
  try {
    socket.destroy();
  } catch {
    // The socket was never admitted.
  }
}

function closeWs(server: WebSocketServer): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      server.close((error?: Error) => resolve(error === undefined));
    } catch {
      resolve(false);
    }
  });
}

function closeHttp(server: HttpServer): Promise<boolean> {
  if (!server.listening) return Promise.resolve(true);
  return new Promise((resolve) => {
    try {
      server.close((error?: Error) => resolve(error === undefined));
    } catch {
      resolve(false);
    }
  });
}

export function createAuthoritativeWebSocketServer(
  options: AuthoritativeWebSocketServerOptions,
): AuthoritativeWebSocketServer {
  validate(options);
  const host = options.host;
  const port = options.port;
  const path = options.path;
  const outboundGate = options.outboundGate;
  let authoritativeServer: AuthoritativeServer | null = options.authoritativeServer;
  let state: AuthoritativeWebSocketServerState = "idle";
  let url: string | null = null;
  let transportGeneration = 0;
  let nextOrdinal = 1;
  let http: HttpServer | null = null;
  let wss: WebSocketServer | null = null;
  let requestListener: RequestListener | null = null;
  let upgradeListener: UpgradeListener | null = null;
  let serverErrorListener: ServerErrorListener | null = null;
  let listeningListener: ListeningListener | null = null;
  let binding: Promise<void> | null = null;
  let settleBinding: (() => void) | null = null;
  let shutdownPromise: Promise<AuthoritativeWebSocketServerOutcome> | null = null;
  const records: ConnectionRecord[] = [];
  let queuedItemCount = 0;
  const decodeCounts = newDecodeCounts();

  const countDecode = (reason: DecodeFailureReason): void => {
    if (decodeCounts[reason] < Number.MAX_SAFE_INTEGER) decodeCounts[reason] += 1;
  };

  const current = (record: ConnectionRecord, tg: number, cg: number): boolean =>
    state === "ready" &&
    transportGeneration === tg &&
    record.live &&
    record.generation === cg &&
    record.socket !== null &&
    record.authoritative !== null;

  function closeRecord(record: ConnectionRecord, terminate: boolean): boolean {
    if (!record.live) return true;
    record.live = false;
    record.generation += 1;
    const socket = record.socket;
    const authoritative = record.authoritative;
    const message = record.message;
    const close = record.close;
    const error = record.error;
    record.message = null;
    record.authoritative = null;

    let succeeded = true;
    if (socket !== null && message !== null) {
      socket.off("message", message);
    }
    if (authoritative !== null) {
      try {
        if (!authoritative.disconnect().ok) succeeded = false;
      } catch {
        succeeded = false;
      }
    }
    if (terminate && socket !== null && socket.readyState !== WebSocket.CLOSED) {
      try {
        socket.terminate();
      } catch {
        succeeded = false;
      }
    }
    if (socket !== null) {
      if (close !== null) socket.off("close", close);
      if (error !== null) socket.off("error", error);
    }
    record.socket = null;
    record.close = null;
    record.error = null;
    const index = records.indexOf(record);
    if (index !== -1) records.splice(index, 1);
    return succeeded;
  }

  function sendCaptured(
    record: ConnectionRecord,
    tg: number,
    cg: number,
    socket: WebSocket,
    authoritative: AuthoritativeConnection,
    encoded: string,
  ): void {
    if (
      !current(record, tg, cg) ||
      record.socket !== socket ||
      record.authoritative !== authoritative ||
      socket.readyState !== WebSocket.OPEN
    ) {
      return;
    }
    try {
      socket.send(encoded);
    } catch {
      closeRecord(record, true);
    }
  }

  function rejectCaptured(record: ConnectionRecord, tg: number, cg: number, socket: WebSocket): void {
    if (current(record, tg, cg) && record.socket === socket) closeRecord(record, true);
  }

  function emit(
    record: ConnectionRecord,
    tg: number,
    cg: number,
    message: ServerMessage,
  ): void {
    if (!current(record, tg, cg)) return;
    const encoded = encodeServerMessage(message);
    if (!encoded.ok) {
      closeRecord(record, true);
      return;
    }
    if (!current(record, tg, cg)) return;

    const socket = record.socket;
    const authoritative = record.authoritative;
    if (
      socket === null ||
      authoritative === null ||
      socket.readyState !== WebSocket.OPEN
    ) {
      return;
    }

    const messageOrdinal = record.nextMessageOrdinal;
    record.nextMessageOrdinal += 1;
    if (outboundGate === undefined) {
      sendCaptured(record, tg, cg, socket, authoritative, encoded.value.text);
      return;
    }

    const metadata: ServerOutboundMessage = Object.freeze({
      direction: "s2c",
      connectionOrdinal: record.ordinal,
      messageOrdinal,
      operation: message.kind,
      encoded: encoded.value.text,
    });

    let pending: void | Promise<void>;
    try {
      pending = outboundGate(metadata);
    } catch {
      rejectCaptured(record, tg, cg, socket);
      return;
    }
    if (pending === undefined) {
      sendCaptured(record, tg, cg, socket, authoritative, encoded.value.text);
      return;
    }

    queuedItemCount += 1;
    void Promise.resolve(pending).then(
      () => {
        queuedItemCount -= 1;
        sendCaptured(record, tg, cg, socket, authoritative, encoded.value.text);
      },
      () => {
        queuedItemCount -= 1;
        rejectCaptured(record, tg, cg, socket);
      },
    );
  }

  function install(socket: WebSocket, tg: number): void {
    const server = authoritativeServer;
    if (server === null || state !== "ready" || transportGeneration !== tg) {
      try {
        socket.terminate();
      } catch {
        // The socket never receives authority.
      }
      return;
    }

    const record: ConnectionRecord = {
      ordinal: nextOrdinal,
      nextMessageOrdinal: 1,
      live: true,
      generation: 1,
      socket,
      authoritative: null,
      message: null,
      close: null,
      error: null,
    };
    nextOrdinal += 1;
    records.push(record);
    const cg = record.generation;

    let accepted;
    try {
      accepted = server.acceptConnection({ emit: (message) => emit(record, tg, cg, message) });
    } catch {
      closeRecord(record, true);
      return;
    }
    if (!accepted.ok) {
      closeRecord(record, true);
      return;
    }
    record.authoritative = accepted.value;

    const onMessage: MessageListener = (data, isBinary) => {
      if (!current(record, tg, cg)) return;
      if (isBinary) {
        countDecode("binary-frame");
        closeRecord(record, true);
        return;
      }

      let bytes: Uint8Array;
      try {
        bytes = copyText(data);
      } catch {
        countDecode("invalid-utf8");
        closeRecord(record, true);
        return;
      }
      if (!current(record, tg, cg)) return;

      const frame: ProtocolFrameInput = Object.freeze({ kind: "text", bytes });
      const decoded = decodeClientMessage(frame);
      if (!current(record, tg, cg)) return;
      if (!decoded.ok) {
        countDecode(decoded.failure.reason);
        if (decoded.failure.reason === "invalid-json") {
          authoritativeServer?.recordDecodeIngressRejection("schema-invalid");
        } else if (decoded.failure.reason === "unknown-kind") {
          authoritativeServer?.recordDecodeIngressRejection("unknown-kind");
        }
        return;
      }

      const authoritative = record.authoritative;
      if (authoritative === null || !current(record, tg, cg)) return;
      try {
        authoritative.receive(decoded.value);
      } catch {
        closeRecord(record, true);
      }
    };

    const onClose: CloseListener = () => {
      if (record.live && record.generation === cg) closeRecord(record, false);
    };

    const onError: ErrorListener = (error) => {
      if (!record.live || record.generation !== cg) return;
      const code = (error as { readonly code?: unknown }).code;
      if (code === "WS_ERR_UNSUPPORTED_MESSAGE_LENGTH") {
        countDecode("message-too-large");
      } else if (code === "WS_ERR_INVALID_UTF8") {
        countDecode("invalid-utf8");
      }
      closeRecord(record, true);
    };

    record.message = onMessage;
    record.close = onClose;
    record.error = onError;
    socket.on("message", onMessage);
    socket.on("close", onClose);
    socket.on("error", onError);

    if (!current(record, tg, cg)) {
      closeRecord(record, true);
      return;
    }
    try {
      if (!accepted.value.markReady().ok) closeRecord(record, true);
    } catch {
      closeRecord(record, true);
    }
  }

  const detachUpgrade = (): void => {
    const listener = upgradeListener;
    upgradeListener = null;
    if (http !== null && listener !== null) http.off("upgrade", listener);
  };

  const resolveBinding = (): void => {
    const resolve = settleBinding;
    settleBinding = null;
    if (resolve !== null) resolve();
  };

  function beginShutdown(): Promise<AuthoritativeWebSocketServerOutcome> {
    if (shutdownPromise !== null) return shutdownPromise;
    state = "shutting-down";
    transportGeneration += 1;
    detachUpgrade();

    shutdownPromise = (async () => {
      let succeeded = true;
      try {
        if (binding !== null) await binding;
        for (const record of [...records].sort((left, right) => left.ordinal - right.ordinal)) {
          if (!closeRecord(record, true)) succeeded = false;
        }

        if (wss !== null && !(await closeWs(wss))) succeeded = false;
        if (http !== null && !(await closeHttp(http))) succeeded = false;

        if (http !== null) {
          if (requestListener !== null) http.off("request", requestListener);
          if (serverErrorListener !== null) http.off("error", serverErrorListener);
          if (listeningListener !== null) http.off("listening", listeningListener);
        }
      } catch {
        succeeded = false;
      } finally {
        records.splice(0);
        requestListener = null;
        serverErrorListener = null;
        listeningListener = null;
        binding = null;
        settleBinding = null;
        wss = null;
        http = null;
        authoritativeServer = null;
        url = null;
        state = "shutdown";
      }
      return succeeded ? ok(undefined) : fail("shutdown-failed", "shutdown", "shutting-down");
    })();
    return shutdownPromise;
  }

  function listen(): Promise<
    AuthoritativeWebSocketServerOutcome<AuthoritativeWebSocketServerListenResult>
  > {
    if (state !== "idle") return Promise.resolve(fail("invalid-state", "listen", state));
    state = "listening";
    transportGeneration += 1;
    const tg = transportGeneration;
    binding = new Promise<void>((resolve) => {
      settleBinding = resolve;
    });

    return new Promise((resolveListen) => {
      let server: HttpServer;
      let wsServer: WebSocketServer;
      try {
        server = createServer();
        http = server;
        wsServer = new WebSocketServer({
          noServer: true,
          perMessageDeflate: false,
          maxPayload: MAX_MESSAGE_BYTES,
        });
        wss = wsServer;
      } catch {
        resolveBinding();
        const failure = fail<AuthoritativeWebSocketServerListenResult>(
          "bind-failed",
          "listen",
          "listening",
        );
        void beginShutdown().then(() => resolveListen(failure));
        return;
      }

      const onRequest: RequestListener = (_request, response) => {
        response.statusCode = state === "ready" ? 404 : 503;
        response.setHeader("Connection", "close");
        response.setHeader("Content-Length", "0");
        response.end();
      };

      const onUpgrade: UpgradeListener = (request, socket, head) => {
        if (state !== "ready" || transportGeneration !== tg) {
          rejectUpgrade(socket, 503);
          return;
        }
        if (request.url !== path) {
          rejectUpgrade(socket, 404);
          return;
        }
        try {
          wsServer.handleUpgrade(request, socket, head, (acceptedSocket) => {
            if (state !== "ready" || transportGeneration !== tg) {
              try {
                acceptedSocket.terminate();
              } catch {
                // The shutdown fence already excludes authority.
              }
              return;
            }
            install(acceptedSocket, tg);
          });
        } catch {
          rejectUpgrade(socket, 503);
        }
      };

      let bindFinished = false;
      const failBind = (): void => {
        if (bindFinished) return;
        bindFinished = true;
        resolveBinding();
        if (state !== "listening") {
          resolveListen(fail("invalid-state", "listen", state));
          return;
        }
        const failure = fail<AuthoritativeWebSocketServerListenResult>(
          "bind-failed",
          "listen",
          "listening",
        );
        void beginShutdown().then(() => resolveListen(failure));
      };

      const onError: ServerErrorListener = () => {
        if (state === "listening") failBind();
        else if (state === "ready") void beginShutdown();
      };

      const onListening: ListeningListener = () => {
        if (bindFinished) return;
        bindFinished = true;
        server.off("listening", onListening);
        listeningListener = null;
        resolveBinding();
        if (state !== "listening" || transportGeneration !== tg) {
          resolveListen(fail("invalid-state", "listen", state));
          return;
        }
        const address = server.address();
        if (address === null || typeof address === "string") {
          const failure = fail<AuthoritativeWebSocketServerListenResult>(
            "bind-failed",
            "listen",
            "listening",
          );
          void beginShutdown().then(() => resolveListen(failure));
          return;
        }
        const hostForUrl = host.includes(":") ? "[" + host + "]" : host;
        url = "ws://" + hostForUrl + ":" + String(address.port) + path;
        state = "ready";
        resolveListen(ok(Object.freeze({ url, path })));
      };

      requestListener = onRequest;
      upgradeListener = onUpgrade;
      serverErrorListener = onError;
      listeningListener = onListening;
      server.on("request", onRequest);
      server.on("upgrade", onUpgrade);
      server.on("error", onError);
      server.on("listening", onListening);
      try {
        server.listen({ host, port });
      } catch {
        failBind();
      }
    });
  }

  return Object.freeze({
    get state(): AuthoritativeWebSocketServerState {
      return state;
    },
    listen,
    inspect(): AuthoritativeWebSocketServerInspection {
      let connectionCount = 0;
      let socketCount = 0;
      let listenerCount =
        (requestListener === null ? 0 : 1) +
        (upgradeListener === null ? 0 : 1) +
        (serverErrorListener === null ? 0 : 1) +
        (listeningListener === null ? 0 : 1);
      for (const record of records) {
        if (record.live) connectionCount += 1;
        if (record.socket !== null) socketCount += 1;
        if (record.message !== null) listenerCount += 1;
        if (record.close !== null) listenerCount += 1;
        if (record.error !== null) listenerCount += 1;
      }
      return Object.freeze({
        state,
        url,
        connectionCount,
        socketCount,
        listenerCount,
        queuedItemCount,
        timerCount: 0,
        decodeFailureCounts: Object.freeze({ ...decodeCounts }),
      });
    },
    shutdown: beginShutdown,
  });
}
