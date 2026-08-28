import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  detachM3Evidence,
  M3EvidenceCollector,
  M3_OBSERVATION_IDS,
  sanitizeLoopbackUrl,
  type M3EvidenceMetadata,
  type M3ObservationId,
} from "./m3-evidence.ts";

function metadata(overrides: Partial<M3EvidenceMetadata> = {}): M3EvidenceMetadata {
  return {
    testId: "m3-two-client",
    project: "chromium",
    title: "two clients converge",
    reproductionCommand: "pnpm test:m3",
    seedDecimal: 1_592_586_247,
    seedHex: "0x5eed0007",
    injectorAlgorithm: "xorshift32-v1",
    baseRttMs: 100,
    jitterMinMs: 0,
    jitterMaxMs: 20,
    dropRate: 0,
    environment: { browser: { name: "chromium" } },
    fixture: { players: ["clientA", "clientB"] },
    ...overrides,
  };
}

function recordAllObservations(collector: M3EvidenceCollector): void {
  for (const id of M3_OBSERVATION_IDS) collector.recordObservation(id, { observed: id });
}

function recordAllCleanup(collector: M3EvidenceCollector): void {
  for (const name of ["clientA", "clientB", "server", "harness"] as const) {
    collector.recordCleanup(name, { closed: true });
  }
}

function passingCollector(): M3EvidenceCollector {
  const collector = new M3EvidenceCollector(metadata());
  recordAllObservations(collector);
  recordAllCleanup(collector);
  return collector;
}

test("emits schema version 1 and detached required metadata at the top level", () => {
  const environment = { browser: { name: "chromium" } };
  const fixture = { players: ["clientA", "clientB"] };
  const input = metadata({ environment, fixture });
  const collector = new M3EvidenceCollector(input);

  environment.browser.name = "mutated";
  fixture.players.push("intruder");
  recordAllObservations(collector);
  recordAllCleanup(collector);

  const manifest = collector.manifest();
  assert.equal(manifest.schemaVersion, 1);
  assert.equal("metadata" in manifest, false);
  for (const key of [
    "testId", "project", "title", "reproductionCommand", "seedDecimal", "seedHex",
    "injectorAlgorithm", "baseRttMs", "jitterMinMs", "jitterMaxMs", "dropRate",
    "environment", "fixture",
  ]) assert.equal(key in manifest, true, `missing top-level metadata ${key}`);
  assert.deepEqual(manifest.environment, { browser: { name: "chromium" } });
  assert.deepEqual(manifest.fixture, { players: ["clientA", "clientB"] });
});

test("sanitizes every supported loopback scheme to a literal port placeholder", () => {
  for (const scheme of ["ws", "wss", "http", "https"]) {
    assert.equal(
      sanitizeLoopbackUrl(`${scheme}://user:secret@localhost:49152/path?q=secret#fragment`),
      `${scheme}://127.0.0.1:<port>/path`,
    );
  }
  assert.equal(sanitizeLoopbackUrl("http://[::1]:8080"), "http://127.0.0.1:<port>/");
  assert.equal(sanitizeLoopbackUrl("http://127.0.0.1:3000/a"), "http://127.0.0.1:<port>/a");
});

test("removes embedded credentials and rejects unsupported or non-loopback URLs", () => {
  const sanitized = sanitizeLoopbackUrl("https://alice:hunter2@localhost:8443/private?token=x#secret");
  assert.equal(sanitized.includes("alice"), false);
  assert.equal(sanitized.includes("hunter2"), false);
  assert.equal(sanitized.includes("8443"), false);
  assert.equal(sanitized.includes("token"), false);
  assert.equal(sanitized.includes("secret"), false);
  assert.throws(() => sanitizeLoopbackUrl("ftp://localhost:21/file"), /loopback/);
  assert.throws(() => sanitizeLoopbackUrl("https://user:pass@example.com:443/path"), /loopback/);
  assert.throws(() => detachM3Evidence("request https://example.com:443/path?q=x"), /loopback/);
});

test("requires observations in the exact OP-01 through OP-07 order and detaches values", () => {
  const collector = new M3EvidenceCollector(metadata());
  const value = { nested: { count: 1 } };
  assert.throws(
    () => collector.recordObservation("OP-02" as M3ObservationId, value),
    /expected observation OP-01/,
  );
  collector.recordObservation("OP-01", value);
  value.nested.count = 2;
  assert.throws(
    () => collector.recordObservation("OP-01", {}),
    /expected observation OP-02/,
  );
  for (const id of M3_OBSERVATION_IDS.slice(1)) collector.recordObservation(id, { id });
  recordAllCleanup(collector);
  const observations = collector.manifest().observations as Array<{ id: string; value: unknown }>;
  assert.deepEqual(observations.map(({ id }) => id), [...M3_OBSERVATION_IDS]);
  assert.deepEqual(observations[0]!.value, { nested: { count: 1 } });
  assert.throws(
    () => collector.recordObservation("OP-01", {}),
    /expected observation none/,
  );
});

test("rejects passing evidence with fewer than seven observations", () => {
  for (let count = 0; count < M3_OBSERVATION_IDS.length; count += 1) {
    const collector = new M3EvidenceCollector(metadata());
    for (const id of M3_OBSERVATION_IDS.slice(0, count)) collector.recordObservation(id, {});
    recordAllCleanup(collector);
    assert.throws(() => collector.manifest(), /exactly seven observations/);
  }
});

test("rejects passing evidence missing each required cleanup record", () => {
  const names = ["clientA", "clientB", "server", "harness"] as const;
  for (const missing of names) {
    const collector = new M3EvidenceCollector(metadata());
    recordAllObservations(collector);
    for (const name of names) if (name !== missing) collector.recordCleanup(name, true);
    assert.throws(() => collector.manifest(), /clientA, clientB, server, and harness cleanup/);
  }
});

test("failed evidence permits zero or OP-01/OP-02 partial observations", () => {
  for (const count of [0, 1, 2]) {
    const collector = new M3EvidenceCollector(metadata());
    for (const id of M3_OBSERVATION_IDS.slice(0, count)) collector.recordObservation(id, {});
    collector.recordFailure(new Error("first invariant\nsecond line\nstack-like detail"));
    collector.recordFailure(new Error("later invariant"));
    const manifest = collector.manifest();
    assert.equal(manifest.status, "failed");
    assert.equal(manifest.firstFailedInvariant, "first invariant");
    assert.equal(JSON.stringify(manifest).includes("second line"), false);
    assert.equal(JSON.stringify(manifest).includes("stack-like detail"), false);
    assert.equal(JSON.stringify(manifest).includes("later invariant"), false);
  }
});

test("cleanup values are detached and cleanup names are unique and fixed", () => {
  const collector = new M3EvidenceCollector(metadata());
  const value = { closed: true, detail: { count: 1 } };
  collector.recordCleanup("clientA", value);
  value.closed = false;
  value.detail.count = 2;
  assert.throws(() => collector.recordCleanup("clientA", {}), /already recorded/);
  assert.throws(() => collector.recordCleanup("database", {}), /unknown cleanup record/);
  collector.recordFailure("expected failure");
  assert.deepEqual(collector.manifest().cleanup, [
    { name: "clientA", value: { closed: true, detail: { count: 1 } } },
  ]);
});

test("setSchedule detaches its value and accepts a 576-phase trace", () => {
  const collector = passingCollector();
  const schedule = Array.from({ length: 576 }, (_, phase) => ({ phase, dueTimeMs: phase * 10 }));
  collector.setSchedule(schedule);
  schedule[0]!.dueTimeMs = -1;
  schedule.push({ phase: 576, dueTimeMs: 5760 });
  const recorded = collector.manifest().schedule as typeof schedule;
  assert.equal(recorded.length, 576);
  assert.deepEqual(recorded[0], { phase: 0, dueTimeMs: 0 });
});

test("rejects forbidden camel, snake, and hyphen key spellings", () => {
  for (const key of [
    "socket", "sockets", "webSocket", "webSockets",
    "rawPayload", "raw_payload", "raw-payload",
    "stack", "credential", "credentials", "token", "password",
    "zod", "zodIssue", "zodError",
    "rapier", "rapierHandle", "handle",
    "socketHandle", "socket_handle", "socket-handle",
  ]) {
    assert.throws(() => detachM3Evidence({ [key]: "secret" }), /forbidden evidence key/);
  }
});

test("accepts finite numeric M3 telemetry gauge keys", () => {
  const gauges = {
    socketCount: 1,
    socketsCount: 2,
    listenerCount: 3,
    physicsHandles: 4,
    physicsHandleCount: 5,
    retainedReferences: 6,
  };

  assert.deepEqual(detachM3Evidence(gauges), gauges);
});

test("rejects accessors, vendor objects, unsupported values, cycles, and nonfinite numbers", () => {
  const accessor = Object.defineProperty({}, "value", { enumerable: true, get: () => 1 });
  const arrayAccessor = [1];
  Object.defineProperty(arrayAccessor, "0", { enumerable: true, get: () => 1 });
  assert.throws(() => detachM3Evidence(accessor), /accessors/);
  assert.throws(() => detachM3Evidence(arrayAccessor), /accessors/);
  assert.throws(() => detachM3Evidence(new Date()), /vendor objects/);
  for (const value of [undefined, 1n, Symbol("x"), (): void => undefined]) {
    assert.throws(() => detachM3Evidence(value), /unsupported evidence value/);
  }
  const cyclic: { self?: unknown } = {};
  cyclic.self = cyclic;
  assert.throws(() => detachM3Evidence(cyclic), /cyclic/);
  for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    assert.throws(() => detachM3Evidence(value), /finite/);
  }
});

test("rejects sparse and overbound evidence structures", () => {
  const sparse = new Array(2);
  sparse[1] = "present";
  assert.throws(() => detachM3Evidence(sparse), /sparse arrays/);
  assert.throws(() => detachM3Evidence(new Array(8_193).fill(null)), /array exceeds/);
  assert.throws(
    () => detachM3Evidence(Object.fromEntries(Array.from({ length: 513 }, (_, index) => [`k${index}`, null]))),
    /object exceeds/,
  );
  assert.throws(() => detachM3Evidence("x".repeat(16_385)), /string exceeds/);

  let deep: unknown = null;
  for (let index = 0; index < 34; index += 1) deep = [deep];
  assert.throws(() => detachM3Evidence(deep), /maximum depth/);

  const tooManyValues = Array.from(
    { length: 13 },
    () => new Array(8_000).fill(null),
  );
  assert.throws(() => detachM3Evidence(tooManyValues), /total value bound/);
});

test("atomic write returns the exact persisted bytes with restrictive mode", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "m3-evidence-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "evidence.json");
  const collector = passingCollector();
  collector.setSchedule([{ phase: 1 }]);

  const attachment = await collector.write(path);
  const persisted = await readFile(path);
  assert.equal(attachment.name, "evidence.json");
  assert.equal(attachment.contentType, "application/json");
  assert.equal(Buffer.compare(attachment.body, persisted), 0);
  assert.equal(attachment.body.at(-1), 0x0a);
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  assert.deepEqual(await readdir(directory), ["evidence.json"]);
  await assert.rejects(() => collector.write(path), /finalized/);
});

test("atomic write removes its temporary file when rename fails", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "m3-evidence-rename-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const destination = join(directory, "evidence.json");
  await mkdir(destination);
  const collector = passingCollector();

  await assert.rejects(() => collector.write(destination));
  assert.deepEqual(await readdir(directory), ["evidence.json"]);
  assert.deepEqual(await readdir(destination), []);
});
