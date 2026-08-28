import { randomUUID } from "node:crypto";
import { open, rename, unlink } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

export const M3_OBSERVATION_IDS = [
  "OP-01", "OP-02", "OP-03", "OP-04", "OP-05", "OP-06", "OP-07",
] as const;

export type M3ObservationId = (typeof M3_OBSERVATION_IDS)[number];

export interface M3EvidenceMetadata {
  readonly testId: string;
  readonly project: string;
  readonly title: string;
  readonly reproductionCommand: string;
  readonly seedDecimal: number;
  readonly seedHex: string;
  readonly injectorAlgorithm: string;
  readonly baseRttMs: number;
  readonly jitterMinMs: number;
  readonly jitterMaxMs: number;
  readonly dropRate: number;
  readonly environment: unknown;
  readonly fixture: unknown;
}

export interface M3EvidenceAttachment {
  readonly name: "evidence.json";
  readonly contentType: "application/json";
  readonly body: Buffer;
}

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

const REQUIRED_CLEANUP = ["clientA", "clientB", "server", "harness"] as const;
const MAX_DEPTH = 32;
const MAX_ARRAY_LENGTH = 8_192;
const MAX_OBJECT_KEYS = 512;
const MAX_STRING_LENGTH = 16_384;
const MAX_TOTAL_VALUES = 100_000;
const URL_OCCURRENCE = /\b(?:wss?|https?):\/\/[^\s"'<>]+/giu;
const FORBIDDEN_KEY = /^(?:sockets?|websockets?|raw[_-]?payload|stack|credentials?|token|password|zod(?:issue|error)?|rapier(?:handle)?|handle|socket[_-]?handle)$/iu;

function isLoopback(hostname: string): boolean {
  return ["localhost", "127.0.0.1", "[::1]", "::1"].includes(hostname.toLowerCase());
}

export function sanitizeLoopbackUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new TypeError("invalid loopback URL");
  }
  if (!["ws:", "wss:", "http:", "https:"].includes(parsed.protocol) || !isLoopback(parsed.hostname)) {
    throw new TypeError("URL must use ws, wss, http, or https on loopback");
  }
  return `${parsed.protocol}//127.0.0.1:<port>${parsed.pathname || "/"}`;
}

function sanitizeString(value: string): string {
  if (value.length > MAX_STRING_LENGTH) throw new RangeError("string exceeds evidence bounds");
  return value.replace(URL_OCCURRENCE, (match) => {
    let candidate = match;
    let suffix = "";
    while (/[),.;!?]$/u.test(candidate)) {
      suffix = candidate.at(-1)! + suffix;
      candidate = candidate.slice(0, -1);
    }
    return sanitizeLoopbackUrl(candidate) + suffix;
  });
}

export function detachM3Evidence(value: unknown): JsonValue {
  const active = new Set<object>();
  let totalValues = 0;

  const visit = (current: unknown, depth: number): JsonValue => {
    totalValues += 1;
    if (totalValues > MAX_TOTAL_VALUES) throw new RangeError("evidence exceeds total value bound");
    if (depth > MAX_DEPTH) throw new RangeError("evidence exceeds maximum depth");
    if (current === null || typeof current === "boolean") return current;
    if (typeof current === "string") return sanitizeString(current);
    if (typeof current === "number") {
      if (!Number.isFinite(current)) throw new TypeError("evidence numbers must be finite");
      return current;
    }
    if (typeof current !== "object") throw new TypeError(`unsupported evidence value: ${typeof current}`);
    if (active.has(current)) throw new TypeError("cyclic evidence is not supported");
    const prototype = Object.getPrototypeOf(current);
    if (!Array.isArray(current) && prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("class and vendor objects are not supported");
    }

    active.add(current);
    try {
      if (Array.isArray(current)) {
        if (current.length > MAX_ARRAY_LENGTH) throw new RangeError("array exceeds evidence bounds");
        const descriptors = Object.getOwnPropertyDescriptors(current);
        const result: JsonValue[] = [];
        for (let index = 0; index < current.length; index += 1) {
          const descriptor = descriptors[String(index)];
          if (descriptor === undefined || !("value" in descriptor)) {
            throw new TypeError("sparse arrays and accessors are not supported");
          }
          result.push(visit(descriptor.value, depth + 1));
        }
        return result;
      }

      const descriptors = Object.getOwnPropertyDescriptors(current);
      const keys = Object.keys(descriptors);
      if (keys.length > MAX_OBJECT_KEYS) throw new RangeError("object exceeds evidence bounds");
      const result: Record<string, JsonValue> = {};
      for (const key of keys) {
        if (FORBIDDEN_KEY.test(key)) throw new TypeError(`forbidden evidence key: ${key}`);
        const descriptor = descriptors[key]!;
        if (!("value" in descriptor)) throw new TypeError("evidence accessors are not supported");
        result[key] = visit(descriptor.value, depth + 1);
      }
      return result;
    } finally {
      active.delete(current);
    }
  };

  return visit(value, 0);
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) throw new TypeError(`${name} must be non-empty`);
  return value;
}

function requiredFinite(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError(`${name} must be finite`);
  return value;
}

function firstMessageLine(error: unknown): string {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "Unknown failure";
  return sanitizeString(message.split(/\r?\n/u, 1)[0]!);
}

export class M3EvidenceCollector {
  readonly #metadata: M3EvidenceMetadata;
  readonly #observations: Array<{ readonly id: M3ObservationId; readonly value: JsonValue }> = [];
  readonly #cleanup: Array<{ readonly name: string; readonly value: JsonValue }> = [];
  readonly #cleanupNames = new Set<string>();
  #schedule: JsonValue = [];
  #firstFailedInvariant: string | null = null;
  #finalized = false;

  constructor(metadata: M3EvidenceMetadata) {
    for (const name of ["testId", "project", "title", "reproductionCommand", "seedHex", "injectorAlgorithm"] as const) {
      requiredString(metadata[name], name);
    }
    for (const name of ["seedDecimal", "baseRttMs", "jitterMinMs", "jitterMaxMs", "dropRate"] as const) {
      requiredFinite(metadata[name], name);
    }
    const detached = detachM3Evidence(metadata) as unknown as M3EvidenceMetadata;
    this.#metadata = detached;
  }

  recordObservation(id: M3ObservationId, value: unknown): void {
    this.#assertMutable();
    const expected = M3_OBSERVATION_IDS[this.#observations.length];
    if (id !== expected) throw new Error(`expected observation ${expected ?? "none"}, received ${id}`);
    this.#observations.push(Object.freeze({ id, value: detachM3Evidence(value) }));
  }

  recordFailure(error: unknown): void {
    this.#assertMutable();
    if (this.#firstFailedInvariant === null) this.#firstFailedInvariant = firstMessageLine(error);
  }

  recordCleanup(name: string, value: unknown): void {
    this.#assertMutable();
    if (!(REQUIRED_CLEANUP as readonly string[]).includes(name)) throw new TypeError(`unknown cleanup record: ${name}`);
    if (this.#cleanupNames.has(name)) throw new Error(`cleanup already recorded: ${name}`);
    this.#cleanupNames.add(name);
    this.#cleanup.push(Object.freeze({ name, value: detachM3Evidence(value) }));
  }

  setSchedule(schedule: unknown): void {
    this.#assertMutable();
    this.#schedule = detachM3Evidence(schedule);
  }

  manifest(): Readonly<Record<string, JsonValue>> {
    const passed = this.#firstFailedInvariant === null;
    if (passed && this.#observations.length !== M3_OBSERVATION_IDS.length) {
      throw new Error("passing evidence requires exactly seven observations");
    }
    if (passed && !REQUIRED_CLEANUP.every((name) => this.#cleanupNames.has(name))) {
      throw new Error("passing evidence requires clientA, clientB, server, and harness cleanup");
    }
    return Object.freeze({
      schemaVersion: 1,
      ...(this.#metadata as unknown as Record<string, JsonValue>),
      status: passed ? "passed" : "failed",
      firstFailedInvariant: this.#firstFailedInvariant,
      schedule: this.#schedule,
      observations: this.#observations as unknown as JsonValue,
      cleanup: this.#cleanup as unknown as JsonValue,
    });
  }

  async write(path: string): Promise<M3EvidenceAttachment> {
    this.#assertMutable();
    requiredString(path, "evidence path");
    const body = Buffer.from(`${JSON.stringify(this.manifest(), null, 2)}\n`, "utf8");
    const temporaryPath = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
    let file: Awaited<ReturnType<typeof open>> | undefined;
    try {
      file = await open(temporaryPath, "wx", 0o600);
      await file.writeFile(body);
      await file.sync();
      await file.close();
      file = undefined;
      await rename(temporaryPath, path);
      this.#finalized = true;
      return Object.freeze({ name: "evidence.json", contentType: "application/json", body: Buffer.from(body) });
    } catch (error) {
      if (file !== undefined) await file.close().catch(() => undefined);
      await unlink(temporaryPath).catch(() => undefined);
      throw error;
    }
  }

  #assertMutable(): void {
    if (this.#finalized) throw new Error("evidence collector is finalized");
  }
}
