import { createAuthoritativeServer } from "@three-game-kit/server/authoritative";
import { createRapierServerCollisionAdapter } from "@three-game-kit/server/collision";
import { createAuthoritativeWebSocketServer } from "@three-game-kit/server/networking";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { DeterministicMessageInjector, MessageDirection } from "../support/deterministic-message-injector.js";
import { M3EvidenceCollector } from "../support/m3-evidence.js";

const injectorProfile = Object.freeze({
  seed: 0x5eed0007,
  baseRoundTripDelayMs: 100,
  jitterMinMs: 0,
  jitterMaxMs: 20,
  dropRate: 0,
});

async function yieldImmediate(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

async function settleWithInjectedTime<T>(injector: DeterministicMessageInjector, promise: Promise<T>): Promise<T> {
  let settled = false;
  void promise.then(
    () => { settled = true; },
    () => { settled = true; },
  );
  for (let turns = 0; !settled && turns < 10_000; turns += 1) {
    const nextDueTimeMs = injector.nextDueTimeMs;
    if (nextDueTimeMs !== null) injector.advanceTo(nextDueTimeMs);
    await yieldImmediate();
  }
  if (!settled) throw new Error("boot_did_not_settle");
  return await promise;
}

type CleanupEvidence = null | boolean | number | string | CleanupEvidence[] | { [key: string]: CleanupEvidence };

function cleanupEvidenceSummary(value: unknown, active = new WeakSet<object>()): CleanupEvidence {
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "bigint") return value.toString();
  if (value === undefined) return null;
  if (typeof value !== "object") return `[unsupported ${typeof value}]`;
  if (value instanceof Error) return { error: value.message };
  if (active.has(value)) return "[circular]";

  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
    return "[unsupported object]";
  }

  active.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((item) => cleanupEvidenceSummary(item, active));
    }

    const summary: { [key: string]: CleanupEvidence } = {};
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
      if (!("value" in descriptor) || descriptor.value === undefined) continue;
      summary[key] = cleanupEvidenceSummary(descriptor.value, active);
    }
    return summary;
  } finally {
    active.delete(value);
  }
}

test("M3 canonical two-client authoritative loopback", async ({ browser, baseURL }, testInfo) => {
  const injector = new DeterministicMessageInjector(injectorProfile);
  const evidence = new M3EvidenceCollector({
    testId: "m3.two-client.canonical.v1",
    project: testInfo.project.name,
    title: "M3 canonical two-client authoritative loopback",
    reproductionCommand: "pnpm exec playwright test tests/acceptance/two-client.spec.ts --project=m3-bundled-chromium --workers=1 --retries=0 --grep \"M3 canonical two-client authoritative loopback\"",
    seedDecimal: 0x5eed0007,
    seedHex: "0x5eed0007",
    injectorAlgorithm: "xorshift32-v1",
    baseRttMs: 100,
    jitterMinMs: 0,
    jitterMaxMs: 20,
    dropRate: 0,
    environment: {
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      playwrightVersion: "1.62.1",
      wsVersion: "8.21.3",
      chromiumRevision: "1234",
      chromiumVersion: "151.0.7922.34",
      loopbackUrl: "ws://127.0.0.1:1/three-game-kit",
      compression: false,
    },
    fixture: {
      boxes: [
        { id: "floor", center: { x: 0, y: -0.5, z: 0 }, halfExtents: { x: 20, y: 0.5, z: 20 } },
        { id: "wall", center: { x: 2.5, y: 1, z: 0 }, halfExtents: { x: 0.5, y: 1, z: 2 } },
      ],
      capsule: { radius: 0.5, halfHeight: 0.5, controllerOffset: 0.01 },
      speed: 6,
      initialPositions: { A: { x: 1.45, y: 1.01, z: 0 }, B: { x: 0, y: 1.01, z: -3 } },
      forcedPosition: { x: 0.75, y: 1.01, z: 0 },
    },
  });
  let authority: ReturnType<typeof createAuthoritativeServer> | undefined;
  let networking: ReturnType<typeof createAuthoritativeWebSocketServer> | undefined;
  let contextA: BrowserContext | undefined;
  let contextB: BrowserContext | undefined;
  let pageA: Page | undefined;
  let pageB: Page | undefined;
  let contextAClosed = false;
  let contextBClosed = false;
  let appAStopped = false;
  let appBStopped = false;

  const evidenceCleanupNames = new Set<string>();
  const recordOnce = (name: "clientA" | "clientB" | "server" | "harness", value: unknown): void => {
    if (evidenceCleanupNames.has(name)) return;
    evidence.recordCleanup(name, value);
    evidenceCleanupNames.add(name);
  };

  const drainInjector = async (): Promise<void> => {
    while (injector.nextDueTimeMs !== null) {
      injector.advanceTo(injector.nextDueTimeMs);
      await yieldImmediate();
    }
  };

  const recordObservation = async (
    id: Parameters<M3EvidenceCollector["recordObservation"]>[0],
    extra: Record<string, unknown> = {},
  ): Promise<void> => {
    const inspectPage = async (page: Page | undefined) =>
      page !== undefined && !page.isClosed()
        ? await page.evaluate(() => window.threeGameKitM3.inspect())
        : null;
    evidence.recordObservation(id, {
      injector: {
        nowMs: injector.nowMs,
        pendingCount: injector.pendingCount,
        scheduleCount: injector.getSchedule().length,
      },
      authority: authority?.inspect() ?? null,
      networking: networking?.inspect() ?? null,
      appA: await inspectPage(pageA),
      appB: await inspectPage(pageB),
      ...extra,
    });
  };

  const shutdownPage = async (page: Page, assertions: boolean) => {
    const result = await page.evaluate(async () => {
      const first = window.threeGameKitM3.shutdown();
      const second = window.threeGameKitM3.shutdown();
      const identical = first === second;
      return { identical, first: await first, second: await second };
    });
    if (assertions) {
      expect(result.identical).toBe(true);
      expect(result.first).toEqual(result.second);
      expect(Object.values(result.first.transport.liveResourceCounts).every((count) => count === 0)).toBe(true);
      expect(Object.values(result.first.replication.liveResourceCounts).every((count) => count === 0)).toBe(true);
    }
    return result;
  };

  const cleanup = async (assertions: boolean): Promise<void> => {
    let firstCleanupError: unknown;
    let appAShutdown: unknown = pageA === undefined ? "notCreated" : "unavailable";
    let appBShutdown: unknown = pageB === undefined ? "notCreated" : "unavailable";
    let networkingFirstResult: unknown = networking === undefined ? "notCreated" : "unavailable";
    let networkingSecondResult: unknown = networking === undefined ? "notCreated" : "unavailable";
    let networkingIdentity: boolean | "notCreated" | "unavailable" = networking === undefined ? "notCreated" : "unavailable";
    let networkingFinalInspection: unknown = networking === undefined ? "notCreated" : "unavailable";
    let authorityFirstResult: unknown = authority === undefined ? "notCreated" : "unavailable";
    let authoritySecondResult: unknown = authority === undefined ? "notCreated" : "unavailable";
    let authorityIdentity: boolean | "notCreated" | "unavailable" = authority === undefined ? "notCreated" : "unavailable";
    let authorityFinalInspection: unknown = authority === undefined ? "notCreated" : "unavailable";

    const attempt = async (action: () => void | Promise<void>): Promise<void> => {
      try {
        await action();
      } catch (error) {
        firstCleanupError ??= error;
      }
    };

    await attempt(drainInjector);
    await attempt(async () => {
      if (pageA !== undefined && !appAStopped) {
        appAShutdown = await shutdownPage(pageA, assertions);
        appAStopped = true;
      }
    });
    await attempt(async () => {
      if (pageB !== undefined && !appBStopped) {
        appBShutdown = await shutdownPage(pageB, assertions);
        appBStopped = true;
      }
    });
    await attempt(async () => {
      if (contextA !== undefined && !contextAClosed) {
        await contextA.close();
        contextAClosed = true;
      }
    });
    await attempt(async () => {
      if (contextB !== undefined && !contextBClosed) {
        await contextB.close();
        contextBClosed = true;
      }
    });
    await attempt(async () => {
      if (networking !== undefined) {
        const first = networking.shutdown();
        const second = networking.shutdown();
        networkingIdentity = first === second;
        networkingFirstResult = await first;
        networkingSecondResult = await second;
        networkingFinalInspection = networking.inspect();
        if (assertions) {
          expect(first).toBe(second);
          expect(networkingFirstResult).toEqual({ ok: true, value: undefined });
          expect(networkingFinalInspection).toMatchObject({
            state: "shutdown",
            connectionCount: 0,
            socketCount: 0,
            listenerCount: 0,
            queuedItemCount: 0,
            timerCount: 0,
          });
        }
      }
    });
    await attempt(() => {
      if (authority !== undefined) {
        const first = authority.shutdown();
        const second = authority.shutdown();
        authorityIdentity = first === second;
        authorityFirstResult = first;
        authoritySecondResult = second;
        authorityFinalInspection = authority.inspect();
        if (assertions) {
          expect(first).toBe(second);
          expect(first).toEqual({ ok: true, value: undefined });
          expect(Object.values(authorityFinalInspection.liveResourceCounts).every((count) => count === 0)).toBe(true);
        }
      }
    });
    await attempt(() => {
      injector.shutdown();
      if (assertions) {
        expect(injector.pendingCount).toBe(0);
        expect(injector.isShutdown).toBe(true);
      }
    });
    await attempt(() => recordOnce("clientA", cleanupEvidenceSummary({
      created: pageA !== undefined,
      shutdown: appAShutdown,
      contextClosed: contextAClosed,
    })));
    await attempt(() => recordOnce("clientB", cleanupEvidenceSummary({
      created: pageB !== undefined,
      shutdown: appBShutdown,
      contextClosed: contextBClosed,
    })));
    await attempt(() => recordOnce("server", cleanupEvidenceSummary({
      networking: {
        created: networking !== undefined,
        firstSecondIdentical: networkingIdentity,
        firstResult: networkingFirstResult,
        secondResult: networkingSecondResult,
        finalInspection: networkingFinalInspection,
      },
      authority: {
        created: authority !== undefined,
        firstSecondIdentical: authorityIdentity,
        firstResult: authorityFirstResult,
        secondResult: authoritySecondResult,
        finalInspection: authorityFinalInspection,
      },
    })));
    await attempt(() => recordOnce("harness", cleanupEvidenceSummary({
      pageAClosed: pageA === undefined || pageA.isClosed(),
      pageBClosed: pageB === undefined || pageB.isClosed(),
      contextAClosed,
      contextBClosed,
      injector: { pendingCount: injector.pendingCount, isShutdown: injector.isShutdown },
    })));

    if (firstCleanupError !== undefined) {
      throw firstCleanupError;
    }
  };

  let initialAX = 0;
  let t0 = 0;
  let socketUrl = "";

  let testBodyFailed = false;
  try {
    await test.step("01 boot real isolated topology", async () => {
      expect(baseURL).toBeDefined();
      if (baseURL === undefined) throw new Error("Playwright baseURL is required");

      const collisionAdapter = createRapierServerCollisionAdapter({
        capsuleRadius: 0.5,
        capsuleHalfHeight: 0.5,
        controllerOffset: 0.01,
        boxes: [
          { id: "floor", center: { x: 0, y: -0.5, z: 0 }, halfExtents: { x: 20, y: 0.5, z: 20 } },
          { id: "wall", center: { x: 2.5, y: 1, z: 0 }, halfExtents: { x: 0.5, y: 1, z: 2 } },
        ],
      });
      authority = createAuthoritativeServer({
        spawnPosition: { x: 1.45, y: 1.01, z: 0 },
        spawnPositionsByConnectionOrdinal: [
          { x: 1.45, y: 1.01, z: 0 },
          { x: 0, y: 1.01, z: -3 },
        ],
        movementSpeedMetersPerSecond: 6,
        collisionAdapter,
      });
      networking = createAuthoritativeWebSocketServer({
        authoritativeServer: authority,
        host: "127.0.0.1",
        port: 0,
        path: "/three-game-kit",
        outboundGate(message) {
          return new Promise<void>((resolve) => {
            injector.enqueue(message.connectionOrdinal, MessageDirection.ServerToClient, resolve);
          });
        },
      });

      const listening = await networking.listen();
      expect(listening.ok).toBe(true);
      if (!listening.ok) throw new Error(listening.failure.code);
      socketUrl = listening.value.url;

      const createPage = async (label: "A" | "B", routeOrdinal: number, position: { x: number; y: number; z: number }) => {
        const context = await browser.newContext();
        expect(await context.cookies()).toEqual([]);
        await context.exposeBinding("__threeGameKitM3OutboundGate", (_source, metadata: { routeOrdinal: number }) =>
          new Promise<void>((resolve) => {
            injector.enqueue(metadata.routeOrdinal, MessageDirection.ClientToServer, resolve);
          }),
        );
        const page = await context.newPage();
        await page.goto(
          baseURL + "/examples/m3-browser/index.html?url=" + encodeURIComponent(socketUrl) +
            "&label=" + label + "&injector=playwright&routeOrdinal=" + routeOrdinal +
            "&x=" + position.x + "&y=" + position.y + "&z=" + position.z,
        );
        expect(await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length }))).toEqual({ local: 0, session: 0 });
        return { context, page };
      };

      ({ context: contextA, page: pageA } = await createPage("A", 1, { x: 1.45, y: 1.01, z: 0 }));
      const bootA = pageA.evaluate(() => window.threeGameKitM3.boot());
      await settleWithInjectedTime(injector, bootA);
      await pageA.evaluate(() => localStorage.setItem("isolation-marker", "client-a"));

      ({ context: contextB, page: pageB } = await createPage("B", 2, { x: 0, y: 1.01, z: -3 }));
      expect(await pageB.evaluate(() => localStorage.getItem("isolation-marker"))).toBeNull();
      await pageB.evaluate(() => localStorage.setItem("isolation-marker", "client-b"));
      expect(await pageA.evaluate(() => localStorage.getItem("isolation-marker"))).toBe("client-a");
      const bootB = pageB.evaluate(() => window.threeGameKitM3.boot());
      await settleWithInjectedTime(injector, bootB);

      const initialA = await pageA.evaluate(() => window.threeGameKitM3.inspect());
      const initialB = await pageB.evaluate(() => window.threeGameKitM3.inspect());
      expect(initialA.injector).toEqual({ enabled: true, routeOrdinal: 1 });
      expect(initialB.injector).toEqual({ enabled: true, routeOrdinal: 2 });
      expect(initialA.errors).toEqual([]);
      expect(initialB.errors).toEqual([]);
      expect(initialA.appToken).not.toBe(initialB.appToken);
      expect(initialA.transport.binding?.connectionId).not.toBe(initialB.transport.binding?.connectionId);
      expect(initialA.transport.binding?.playerId).not.toBe(initialB.transport.binding?.playerId);
      expect(initialA.transport.binding?.ownedEntityId).not.toBe(initialB.transport.binding?.ownedEntityId);
      expect(initialA.replication.ownedEntityId).not.toBe(initialB.replication.ownedEntityId);

      const bindingA = initialA.transport.binding;
      const bindingB = initialB.transport.binding;
      expect(bindingA).not.toBeNull();
      expect(bindingB).not.toBeNull();
      if (bindingA === null || bindingB === null) throw new Error("missing_binding");
      const serverInspection = authority.inspect();
      expect(serverInspection.connections).toHaveLength(2);
      expect(serverInspection.avatars.find((avatar) => avatar.playerId === bindingA.playerId)?.position).toEqual({ x: 1.45, y: 1.01, z: 0 });
      expect(serverInspection.avatars.find((avatar) => avatar.playerId === bindingB.playerId)?.position).toEqual({ x: 0, y: 1.01, z: -3 });
      expect(serverInspection.liveResourceCounts.pendingCommands).toBe(0);
      expect(initialA.replication.counters.receivedSnapshotCount).toBe(0);
      expect(initialB.replication.counters.receivedSnapshotCount).toBe(0);

      const firstRouteOneClientMessage = injector.getSchedule().find(
        (scheduled) => scheduled.connectionOrdinal === 1 && scheduled.direction === MessageDirection.ClientToServer,
      );
      expect(firstRouteOneClientMessage).toMatchObject({
        messageOrdinal: 1,
        jitterMs: 7,
        scheduledDelayMs: 57,
      });
      initialAX = initialA.positions.localPresentationPosition.x;
      t0 = injector.nowMs;
      await recordObservation("OP-01");
    });

    await test.step("02 predict owner on next injected frame", async () => {
      if (authority === undefined || pageA === undefined || pageB === undefined) throw new Error("topology_not_booted");
      const beforeServer = authority.inspect();
      const beforeA = await pageA.evaluate(() => window.threeGameKitM3.inspect());
      const beforeB = await pageB.evaluate(() => window.threeGameKitM3.inspect());
      expect(beforeServer.liveResourceCounts.pendingCommands).toBe(0);
      expect(beforeA.replication.counters.receivedSnapshotCount).toBe(0);
      expect(beforeB.replication.counters.receivedSnapshotCount).toBe(0);

      await pageA.evaluate(() => {
        const queued = window.threeGameKitM3.queueMove(1, 0);
        if (!queued.ok) throw new Error(queued.failure.code);
        const stepped = window.threeGameKitM3.stepExact(1);
        if (!stepped.ok) throw new Error(stepped.failure.code);
      });
      expect(injector.nextDueTimeMs).not.toBeNull();
      expect(injector.nextDueTimeMs!).toBeGreaterThan(t0 + 1);
      injector.advanceTo(t0 + 1);
      await pageA.evaluate((nowMs) => window.threeGameKitM3.frame(nowMs), injector.nowMs);

      const predictedA = await pageA.evaluate(() => window.threeGameKitM3.inspect());
      expect(Number.isFinite(predictedA.positions.localPresentationPosition.x)).toBe(true);
      expect(predictedA.positions.localPresentationPosition.x).toBeGreaterThan(initialAX);
      expect(authority.inspect().liveResourceCounts.pendingCommands).toBe(0);
      expect(predictedA.replication.counters.receivedSnapshotCount).toBe(0);
      expect((await pageB.evaluate(() => window.threeGameKitM3.inspect())).replication.counters.receivedSnapshotCount).toBe(0);
      await recordObservation("OP-02", { t0 });
    });

    let aEntityId: string | undefined;

    await test.step("03 step 60 server ticks and present peer snapshots", async () => {
      if (authority === undefined || pageA === undefined || pageB === undefined) throw new Error("topology_not_booted");

      for (let turns = 0; authority.inspect().liveResourceCounts.pendingCommands !== 1 && turns < 1_000; turns += 1) {
        const nextDueTimeMs = injector.nextDueTimeMs;
        if (nextDueTimeMs !== null) injector.advanceTo(nextDueTimeMs);
        await yieldImmediate();
      }
      if (authority.inspect().liveResourceCounts.pendingCommands !== 1) throw new Error("a_command_not_delivered");

      const beforeStepA = await pageA.evaluate(() => window.threeGameKitM3.inspect());
      aEntityId = beforeStepA.replication.ownedEntityId ?? undefined;
      if (aEntityId === undefined) throw new Error("missing_a_entity");
      const pendingAuthority = authority.inspect();
      expect(pendingAuthority.liveResourceCounts.pendingCommands).toBe(1);
      expect(pendingAuthority.connections.find(({ ownedEntityId }) => ownedEntityId === aEntityId)?.pendingCommandCount).toBe(1);

      expect(authority.stepExact(60)).toEqual({ ok: true, value: 60 });
      const steppedAuthority = authority.inspect();
      expect(steppedAuthority.serverTick).toBe(60);

      const phases = [
        "ingress",
        "validate-bind",
        "command-apply",
        "shared-movement",
        "authoritative-collision",
        "gameplay",
        "snapshot-build",
        "telemetry",
      ] as const;
      for (const phase of phases) {
        expect(steppedAuthority.phaseTrace.filter((entry) => entry.phase === phase)).toHaveLength(60);
      }
      for (let tick = 1; tick <= 60; tick += 1) {
        expect(
          steppedAuthority.phaseTrace
            .filter(({ serverTick }) => serverTick === tick)
            .map(({ phase }) => phase),
        ).toEqual(phases);
      }
      expect(
        steppedAuthority.phaseTrace
          .filter(({ serverTick, phase }) => phase === "snapshot-build" && serverTick % 3 === 0)
          .map(({ serverTick }) => serverTick),
      ).toEqual(Array.from({ length: 20 }, (_value, index) => (index + 1) * 3));

      const serverA = steppedAuthority.avatars.find(({ entityId }) => entityId === aEntityId);
      expect(serverA).toBeDefined();
      if (serverA === undefined) throw new Error("missing_server_a");
      expect(serverA.position.x).toBeGreaterThanOrEqual(1.45);
      expect(serverA.position.x).toBeLessThanOrEqual(1.5 + 1e-6);
      expect(steppedAuthority.liveResourceCounts.capsules).toBe(2);

      await drainInjector();
      const deliveredA = await pageA.evaluate(() => window.threeGameKitM3.inspect());
      const deliveredB = await pageB.evaluate(() => window.threeGameKitM3.inspect());
      expect(deliveredA.replication.counters.receivedSnapshotCount).toBe(20);
      expect(deliveredB.replication.counters.receivedSnapshotCount).toBe(20);

      await pageA.evaluate(() => {
        const stepped = window.threeGameKitM3.stepExact(1);
        if (!stepped.ok) throw new Error(stepped.failure.code);
      });
      await pageB.evaluate(() => {
        const stepped = window.threeGameKitM3.stepExact(1);
        if (!stepped.ok) throw new Error(stepped.failure.code);
      });

      const authorityBeforeFrames = authority.inspect();
      await pageA.evaluate((nowMs) => {
        const framed = window.threeGameKitM3.frame(nowMs);
        if (!framed.ok) throw new Error(framed.failure.code);
      }, injector.nowMs);
      await pageB.evaluate((nowMs) => {
        const framed = window.threeGameKitM3.frame(nowMs);
        if (!framed.ok) throw new Error(framed.failure.code);
      }, injector.nowMs);
      expect(authority.inspect()).toEqual(authorityBeforeFrames);

      const presentedA = await pageA.evaluate(() => window.threeGameKitM3.inspect());
      const presentedB = await pageB.evaluate(() => window.threeGameKitM3.inspect());
      expect(presentedA.replication.acknowledgedSequence).toBe(1);
      expect(presentedA.replication.historySequences).toEqual([]);
      const remoteA = presentedB.positions.remoteAvatars.find(({ entityId }) => entityId === aEntityId);
      expect(remoteA).toBeDefined();
      if (remoteA === undefined) throw new Error("missing_remote_a");
      expect(remoteA.provenance).toBe("snapshot");
      for (const position of [
        presentedA.positions.simulationPosition,
        presentedA.positions.localPresentationPosition,
        presentedB.positions.simulationPosition,
        presentedB.positions.localPresentationPosition,
        remoteA.position,
      ]) {
        expect(position).not.toBeNull();
        if (position === null) throw new Error("missing_position");
        expect([position.x, position.y, position.z].every(Number.isFinite)).toBe(true);
      }
      expect(authority.inspect().liveResourceCounts.capsules).toBe(2);
      await recordObservation("OP-03");
    });

    await test.step("04 reconcile forced authority within 500 injected ms", async () => {
      if (authority === undefined || pageA === undefined || pageB === undefined) throw new Error("topology_not_booted");
      const forcedEntityId = aEntityId;
      if (forcedEntityId === undefined) throw new Error("missing_a_entity");
      const forcedPosition = { x: 0.75, y: 1.01, z: 0 };

      expect(authority.scheduleForcedPosition(forcedEntityId, 61, forcedPosition)).toEqual({ ok: true, value: undefined });
      expect(authority.stepExact(3)).toEqual({ ok: true, value: 63 });

      const forcedAuthority = authority.inspect();
      expect(forcedAuthority.serverTick).toBe(63);
      expect(forcedAuthority.avatars.find(({ entityId }) => entityId === forcedEntityId)?.position).toEqual(forcedPosition);
      expect(forcedAuthority.connections.find(({ ownedEntityId }) => ownedEntityId === forcedEntityId)?.position).toEqual(forcedPosition);
      expect(forcedAuthority.liveResourceCounts.capsules).toBe(2);
      expect(forcedAuthority.forcedPositionFixtures).toMatchObject({
        pendingCount: 0,
        scheduledCount: 1,
        consumedCount: 1,
        lastConsumed: { entityId: forcedEntityId, serverTick: 61, position: forcedPosition },
      });

      await drainInjector();
      const deliveredA = await pageA.evaluate(() => window.threeGameKitM3.inspect());
      const deliveredB = await pageB.evaluate(() => window.threeGameKitM3.inspect());
      expect(deliveredA.replication.counters.receivedSnapshotCount).toBe(21);
      expect(deliveredB.replication.counters.receivedSnapshotCount).toBe(21);
      expect(deliveredA.replication.decodedInboxTicks).toContain(63);
      expect(deliveredB.replication.decodedInboxTicks).toContain(63);

      const reconcileBefore = deliveredA.replication.counters.reconcileCount;
      const tr = injector.nowMs;
      await pageA.evaluate(() => {
        const stepped = window.threeGameKitM3.stepExact(1);
        if (!stepped.ok) throw new Error(stepped.failure.code);
      });
      const reconciledA = await pageA.evaluate(() => window.threeGameKitM3.inspect());
      const simulation = reconciledA.positions.simulationPosition;
      expect(simulation).not.toBeNull();
      if (simulation === null) throw new Error("missing_simulation_position");
      expect(Math.abs(simulation.x - forcedPosition.x)).toBeLessThanOrEqual(1e-6);
      expect(Math.abs(simulation.y - forcedPosition.y)).toBeLessThanOrEqual(1e-6);
      expect(Math.abs(simulation.z - forcedPosition.z)).toBeLessThanOrEqual(1e-6);
      expect(reconciledA.replication.historySequences).toEqual([]);
      expect(reconciledA.replication.counters.reconcileCount).toBe(reconcileBefore + 1);

      const authorityBeforeFrames = authority.inspect();
      const presentationErrors: number[] = [];
      for (let offsetMs = 0; offsetMs <= 500; offsetMs += 100) {
        const timestamp = tr + offsetMs;
        injector.advanceTo(timestamp);
        const presented = await pageA.evaluate((nowMs) => {
          const framed = window.threeGameKitM3.frame(nowMs);
          if (!framed.ok) throw new Error(framed.failure.code);
          return window.threeGameKitM3.inspect().positions.localPresentationPosition;
        }, timestamp);
        if (presented === null) throw new Error("missing_presentation_position");
        presentationErrors.push(Math.hypot(
          presented.x - forcedPosition.x,
          presented.y - forcedPosition.y,
          presented.z - forcedPosition.z,
        ));
      }
      expect(presentationErrors.every(Number.isFinite)).toBe(true);
      for (let index = 1; index < presentationErrors.length; index += 1) {
        expect(presentationErrors[index]).toBeLessThanOrEqual(presentationErrors[index - 1] + 1e-9);
      }
      expect(presentationErrors.at(-1)).toBeLessThanOrEqual(0.05);

      const authorityAfterFrames = authority.inspect();
      expect(authorityAfterFrames).toEqual(authorityBeforeFrames);
      expect(authorityAfterFrames.avatars.find(({ entityId }) => entityId === forcedEntityId)?.position).toEqual(forcedPosition);
      expect(authorityAfterFrames.liveResourceCounts.capsules).toBe(2);
      expect(authorityAfterFrames.forcedPositionFixtures.pendingCount).toBe(0);
      expect(authorityAfterFrames.forcedPositionFixtures.consumedCount).toBe(1);
      await recordObservation("OP-04", {
        reconcileBefore,
        reconcileAfter: reconciledA.replication.counters.reconcileCount,
        presentationErrors,
      });
    });
    await test.step("05 reject invalid ingress without authority mutation", async () => {
      if (authority === undefined || networking === undefined || contextA === undefined || pageA === undefined || pageB === undefined) {
        throw new Error("topology_not_booted");
      }

      const rawCases = [
        {
          routeOrdinal: 3,
          payload: "{",
          decodeReason: "invalid-json",
          authorityReason: "schema-invalid",
        },
        {
          routeOrdinal: 4,
          payload: '{"protocolVersion":1,"kind":"unknown-for-v1"}',
          decodeReason: "unknown-kind",
          authorityReason: "unknown-kind",
        },
      ] as const;

      for (const rawCase of rawCases) {
        const beforeNetworking = networking.inspect();
        const beforeAuthority = authority.inspect();
        const beforeA = await pageA.evaluate(() => window.threeGameKitM3.inspect());
        const beforeB = await pageB.evaluate(() => window.threeGameKitM3.inspect());
        const beforeAuthorityState = {
          avatars: beforeAuthority.avatars,
          connections: beforeAuthority.connections
            .filter(({ connectionId }) => connectionId !== null)
            .map((connection) => ({
            connectionId: connection.connectionId,
            playerId: connection.playerId,
            ownedEntityId: connection.ownedEntityId,
            position: connection.position,
          })),
          liveResourceCounts: beforeAuthority.liveResourceCounts,
          sharedMovementCallCount: beforeAuthority.sharedMovementCallCount,
          authoritativeCollisionCallCount: beforeAuthority.authoritativeCollisionCallCount,
        };
        const connectionABefore = beforeAuthority.connections.find(
          ({ connectionId }) => connectionId === beforeA.transport.binding?.connectionId,
        );
        if (connectionABefore === undefined) throw new Error("missing_authority_connection_a");

        const rawPage = await contextA.newPage();
        try {
          const delivery = rawPage.evaluate(async ({ url, payload, routeOrdinal }) => {
            const gate = window.__threeGameKitM3OutboundGate;
            if (typeof gate !== "function") throw new Error("missing_outbound_gate");
            const socket = new WebSocket(url);
            await new Promise<void>((resolve, reject) => {
              socket.addEventListener("open", () => resolve(), { once: true });
              socket.addEventListener("error", () => reject(new Error("raw_socket_open_failed")), { once: true });
            });
            await gate({ routeOrdinal });
            socket.send(payload);
            socket.close();
            await new Promise<void>((resolve) => {
              socket.addEventListener("close", () => resolve(), { once: true });
            });
          }, { url: socketUrl, payload: rawCase.payload, routeOrdinal: rawCase.routeOrdinal });
          await settleWithInjectedTime(injector, delivery);
        } finally {
          await rawPage.close();
        }

        for (let turns = 0; turns < 1_000; turns += 1) {
          const currentNetworking = networking.inspect();
          const currentAuthority = authority.inspect();
          const matchingRecords = currentAuthority.structuredRuntimeErrors.filter(
            ({ code, category, runtime, operation, reasonCode }) =>
              code === "decode-ingress-rejected" &&
              category === "expected" &&
              runtime === "server" &&
              operation === "decode-ingress" &&
              reasonCode === rawCase.authorityReason,
          );
          if (
            currentNetworking.connectionCount === beforeNetworking.connectionCount &&
            currentNetworking.socketCount === beforeNetworking.socketCount &&
            currentAuthority.liveResourceCounts.connections === beforeAuthority.liveResourceCounts.connections &&
            currentNetworking.decodeFailureCounts[rawCase.decodeReason] ===
              beforeNetworking.decodeFailureCounts[rawCase.decodeReason] + 1 &&
            currentAuthority.rejectedCommandCounts[rawCase.authorityReason] ===
              beforeAuthority.rejectedCommandCounts[rawCase.authorityReason] + 1 &&
            matchingRecords.length ===
              beforeAuthority.structuredRuntimeErrors.filter(({ reasonCode }) => reasonCode === rawCase.authorityReason).length + 1
          ) break;
          await yieldImmediate();
        }

        const afterNetworking = networking.inspect();
        const afterAuthority = authority.inspect();
        const afterA = await pageA.evaluate(() => window.threeGameKitM3.inspect());
        const afterB = await pageB.evaluate(() => window.threeGameKitM3.inspect());
        const connectionAAfter = afterAuthority.connections.find(
          ({ connectionId }) => connectionId === afterA.transport.binding?.connectionId,
        );
        if (connectionAAfter === undefined) throw new Error("missing_authority_connection_a");

        expect(afterNetworking.connectionCount).toBe(beforeNetworking.connectionCount);
        expect(afterNetworking.socketCount).toBe(beforeNetworking.socketCount);
        for (const key of Object.keys(beforeNetworking.decodeFailureCounts) as Array<keyof typeof beforeNetworking.decodeFailureCounts>) {
          expect(afterNetworking.decodeFailureCounts[key] - beforeNetworking.decodeFailureCounts[key]).toBe(
            key === rawCase.decodeReason ? 1 : 0,
          );
        }
        for (const key of Object.keys(beforeAuthority.rejectedCommandCounts) as Array<keyof typeof beforeAuthority.rejectedCommandCounts>) {
          expect(afterAuthority.rejectedCommandCounts[key] - beforeAuthority.rejectedCommandCounts[key]).toBe(
            key === rawCase.authorityReason ? 1 : 0,
          );
        }
        expect(afterA.replication.counters.rejectedCount).toBe(beforeA.replication.counters.rejectedCount);
        expect(afterB.replication.counters.rejectedCount).toBe(beforeB.replication.counters.rejectedCount);
        expect(connectionAAfter.rejectedCommandCounts).toEqual(connectionABefore.rejectedCommandCounts);
        expect(connectionAAfter.acceptedSequence).toBe(connectionABefore.acceptedSequence);
        const appendedConnections = afterAuthority.connections.slice(beforeAuthority.connections.length);
        expect(appendedConnections).toHaveLength(1);
        expect(appendedConnections[0]).toMatchObject({
          connectionId: null,
          playerId: null,
          ownedEntityId: null,
          position: null,
          phase: "closed",
          pendingCommandCount: 0,
          scheduledCommandCount: 0,
        });
        expect(Object.values(appendedConnections[0]!.rejectedCommandCounts).every((count) => count === 0)).toBe(true);
        expect({
          avatars: afterAuthority.avatars,
          connections: afterAuthority.connections
            .filter(({ connectionId }) => connectionId !== null)
            .map((connection) => ({
            connectionId: connection.connectionId,
            playerId: connection.playerId,
            ownedEntityId: connection.ownedEntityId,
            position: connection.position,
          })),
          liveResourceCounts: afterAuthority.liveResourceCounts,
          sharedMovementCallCount: afterAuthority.sharedMovementCallCount,
          authoritativeCollisionCallCount: afterAuthority.authoritativeCollisionCallCount,
        }).toEqual(beforeAuthorityState);
        const matchingRecords = afterAuthority.structuredRuntimeErrors.filter(
          ({ code, category, runtime, operation, reasonCode }) =>
            code === "decode-ingress-rejected" && category === "expected" && runtime === "server" &&
            operation === "decode-ingress" && reasonCode === rawCase.authorityReason,
        );
        const matchingBefore = beforeAuthority.structuredRuntimeErrors.filter(
          ({ code, category, runtime, operation, reasonCode }) =>
            code === "decode-ingress-rejected" && category === "expected" && runtime === "server" &&
            operation === "decode-ingress" && reasonCode === rawCase.authorityReason,
        );
        expect(matchingRecords).toHaveLength(matchingBefore.length + 1);
        await yieldImmediate();
        expect(authority.inspect().structuredRuntimeErrors.filter(
          ({ code, category, runtime, operation, reasonCode }) =>
            code === "decode-ingress-rejected" && category === "expected" && runtime === "server" &&
            operation === "decode-ingress" && reasonCode === rawCase.authorityReason,
        )).toHaveLength(matchingRecords.length);
      }

      const decodedCases = [
        { reason: "tick-out-of-window", intendedTickOffset: 4, fixture: null },
        { reason: "ownership-violation", intendedTickOffset: 1, fixture: { kind: "ownership-violation" } },
        { reason: "movement-limit", intendedTickOffset: 1, fixture: { kind: "movement-speed", metersPerSecond: 10.000001 } },
      ] as const;

      for (const decodedCase of decodedCases) {
        const preArmAuthority = authority.inspect();
        const beforeA = await pageA.evaluate(() => window.threeGameKitM3.inspect());
        const beforeB = await pageB.evaluate(() => window.threeGameKitM3.inspect());
        const aEntityId = beforeA.replication.ownedEntityId;
        const connectionIdA = beforeA.transport.binding?.connectionId;
        if (aEntityId === null || connectionIdA === undefined) throw new Error("missing_a_binding");

        if (decodedCase.fixture !== null) {
          expect(authority.armNextValidationFixture(aEntityId, decodedCase.fixture)).toEqual({ ok: true, value: undefined });
        }

        const beforeAuthority = authority.inspect();
        const connectionABefore = beforeAuthority.connections.find(({ connectionId }) => connectionId === connectionIdA);
        if (connectionABefore === undefined) throw new Error("missing_authority_connection_a");
        expect(connectionABefore.acceptedSequence).toBe(1);

        const authorityDigest = (inspection: ReturnType<typeof authority.inspect>) => ({
          avatars: inspection.avatars,
          connections: inspection.connections
            .filter(({ connectionId }) => connectionId !== null)
            .map(({ connectionId, playerId, ownedEntityId, position, pendingCommandCount, scheduledCommandCount }) => ({
              connectionId,
              playerId,
              ownedEntityId,
              position,
              pendingCommandCount,
              scheduledCommandCount,
            })),
          liveResourceCounts: inspection.liveResourceCounts,
        });
        const beforeAuthorityDigest = authorityDigest(beforeAuthority);
        const beforeGlobalCounts = beforeAuthority.rejectedCommandCounts;
        const beforeAConnectionCounts = connectionABefore.rejectedCommandCounts;
        const beforeErrors = beforeAuthority.structuredRuntimeErrors;
        const beforeSharedCalls = beforeAuthority.sharedMovementCallCount;
        const beforeCollisionCalls = beforeAuthority.authoritativeCollisionCallCount;
        const beforeFixtureState = preArmAuthority.validationFixtures;

        if (decodedCase.fixture === null) {
          expect(beforeAuthority.validationFixtures).toEqual(beforeFixtureState);
        } else {
          expect(beforeAuthority.validationFixtures).toMatchObject({
            pendingCount: beforeFixtureState.pendingCount + 1,
            armedCount: beforeFixtureState.armedCount + 1,
            consumedCount: beforeFixtureState.consumedCount,
            lastConsumed: beforeFixtureState.lastConsumed,
          });
        }

        const sequence = 2;
        const capturedTick = authority.inspect().serverTick;
        const sent = await pageA.evaluate(
          ({ sequence, intendedTick }) => window.threeGameKitM3.sendCommand(
            sequence,
            intendedTick,
            { kind: "move", x: 1, z: 0 },
          ),
          { sequence, intendedTick: capturedTick + decodedCase.intendedTickOffset },
        );
        expect(sent).toEqual({ ok: true, value: undefined });

        for (let turns = 0; authority.inspect().liveResourceCounts.pendingCommands !== 1 && turns < 1_000; turns += 1) {
          const nextDueTimeMs = injector.nextDueTimeMs;
          if (nextDueTimeMs !== null) injector.advanceTo(nextDueTimeMs);
          await yieldImmediate();
        }
        expect(authority.inspect().liveResourceCounts.pendingCommands).toBe(1);
        expect(authority.stepExact(1)).toEqual({ ok: true, value: capturedTick + 1 });
        await drainInjector();

        for (let turns = 0; turns < 1_000; turns += 1) {
          const inspectedA = await pageA.evaluate(() => window.threeGameKitM3.inspect());
          if (inspectedA.replication.counters.rejectedCount === beforeA.replication.counters.rejectedCount + 1) break;
          await yieldImmediate();
        }

        const afterAuthority = authority.inspect();
        const afterA = await pageA.evaluate(() => window.threeGameKitM3.inspect());
        const afterB = await pageB.evaluate(() => window.threeGameKitM3.inspect());
        const connectionAAfter = afterAuthority.connections.find(({ connectionId }) => connectionId === connectionIdA);
        if (connectionAAfter === undefined) throw new Error("missing_authority_connection_a");

        for (const key of Object.keys(beforeGlobalCounts) as Array<keyof typeof beforeGlobalCounts>) {
          expect(afterAuthority.rejectedCommandCounts[key] - beforeGlobalCounts[key]).toBe(
            key === decodedCase.reason ? 1 : 0,
          );
        }
        for (const key of Object.keys(beforeAConnectionCounts) as Array<keyof typeof beforeAConnectionCounts>) {
          expect(connectionAAfter.rejectedCommandCounts[key] - beforeAConnectionCounts[key]).toBe(
            key === decodedCase.reason ? 1 : 0,
          );
        }
        const connectionBBefore = beforeAuthority.connections.find(
          ({ connectionId }) => connectionId === beforeB.transport.binding?.connectionId,
        );
        const connectionBAfter = afterAuthority.connections.find(
          ({ connectionId }) => connectionId === afterB.transport.binding?.connectionId,
        );
        expect(connectionBAfter?.rejectedCommandCounts).toEqual(connectionBBefore?.rejectedCommandCounts);

        expect(afterAuthority.structuredRuntimeErrors).toEqual([
          ...beforeErrors,
          {
            schemaVersion: 1,
            sequence: (beforeErrors.at(-1)?.sequence ?? 0) + 1,
            code: "command-rejected",
            category: "expected",
            expected: true,
            runtime: "server",
            operation: "command-validation",
            message: "Decoded queued command was rejected during validation",
            tick: capturedTick + 1,
            reasonCode: decodedCase.reason,
            context: [],
            cause: null,
          },
        ]);
        await yieldImmediate();
        expect(authority.inspect().structuredRuntimeErrors).toEqual(afterAuthority.structuredRuntimeErrors);

        expect(connectionAAfter.acceptedSequence).toBe(1);
        expect(authorityDigest(afterAuthority)).toEqual(beforeAuthorityDigest);
        expect(afterAuthority.sharedMovementCallCount).toBe(beforeSharedCalls);
        expect(afterAuthority.authoritativeCollisionCallCount).toBe(beforeCollisionCalls);
        expect(afterA.replication.counters.rejectedCount).toBe(beforeA.replication.counters.rejectedCount + 1);
        expect(afterB.replication.counters.rejectedCount).toBe(beforeB.replication.counters.rejectedCount);
        expect(afterA.errors).toEqual(beforeA.errors);
        expect(afterB.errors).toEqual(beforeB.errors);

        if (decodedCase.fixture === null) {
          expect(afterAuthority.validationFixtures).toEqual(beforeFixtureState);
        } else {
          expect(afterAuthority.validationFixtures).toEqual({
            pendingCount: beforeFixtureState.pendingCount,
            armedCount: beforeFixtureState.armedCount + 1,
            consumedCount: beforeFixtureState.consumedCount + 1,
            lastConsumed: {
              entityId: aEntityId,
              kind: decodedCase.fixture.kind,
              metersPerSecond: decodedCase.fixture.kind === "movement-speed"
                ? decodedCase.fixture.metersPerSecond
                : null,
            },
          });
        }
      }
      await recordObservation("OP-05");
    });
    await test.step("06 reject base interaction by phase", async () => {
      if (authority === undefined || pageA === undefined || pageB === undefined) throw new Error("topology_not_booted");

      const beforeA = await pageA.evaluate(() => window.threeGameKitM3.inspect());
      const beforeB = await pageB.evaluate(() => window.threeGameKitM3.inspect());
      const bindingA = beforeA.transport.binding;
      const bindingB = beforeB.transport.binding;
      if (bindingA === null || bindingB === null) throw new Error("missing_binding");

      const beforeAuthority = authority.inspect();
      const connectionABefore = beforeAuthority.connections.find(
        ({ connectionId }) => connectionId === bindingA.connectionId,
      );
      const connectionBBefore = beforeAuthority.connections.find(
        ({ connectionId }) => connectionId === bindingB.connectionId,
      );
      if (connectionABefore === undefined || connectionBBefore === undefined) throw new Error("missing_authority_connection");
      expect(connectionABefore.ownedEntityId).toBe(bindingA.ownedEntityId);
      expect(connectionBBefore.ownedEntityId).toBe(bindingB.ownedEntityId);
      expect(connectionABefore.acceptedSequence).toBe(1);
      expect(beforeAuthority.liveResourceCounts.pendingCommands).toBe(0);

      const authorityDigest = (inspection: ReturnType<typeof authority.inspect>) => ({
        avatars: inspection.avatars,
        connections: inspection.connections
          .filter(({ connectionId }) => connectionId !== null)
          .map(({
            connectionId,
            playerId,
            ownedEntityId,
            position,
            pendingCommandCount,
            scheduledCommandCount,
          }) => ({
            connectionId,
            playerId,
            ownedEntityId,
            position,
            pendingCommandCount,
            scheduledCommandCount,
          })),
        liveResourceCounts: inspection.liveResourceCounts,
      });
      const beforeAuthorityDigest = authorityDigest(beforeAuthority);
      const beforeGlobalCounts = beforeAuthority.rejectedCommandCounts;
      const beforeAConnectionCounts = connectionABefore.rejectedCommandCounts;
      const beforeBConnectionCounts = connectionBBefore.rejectedCommandCounts;
      const beforeErrors = beforeAuthority.structuredRuntimeErrors;
      const beforeSharedCalls = beforeAuthority.sharedMovementCallCount;
      const beforeCollisionCalls = beforeAuthority.authoritativeCollisionCallCount;
      const beforeFixtures = beforeAuthority.validationFixtures;
      expect(Object.keys(beforeGlobalCounts)).toHaveLength(13);
      expect(Object.keys(beforeAConnectionCounts)).toHaveLength(13);

      const capturedTick = authority.inspect().serverTick;
      const sent = await pageA.evaluate(
        ({ intendedTick, targetEntityId }) => window.threeGameKitM3.sendCommand(
          2,
          intendedTick,
          { kind: "interact", targetEntityId },
        ),
        { intendedTick: capturedTick + 1, targetEntityId: bindingB.ownedEntityId },
      );
      expect(sent).toEqual({ ok: true, value: undefined });

      for (let turns = 0; authority.inspect().liveResourceCounts.pendingCommands !== 1 && turns < 1_000; turns += 1) {
        const nextDueTimeMs = injector.nextDueTimeMs;
        if (nextDueTimeMs !== null) injector.advanceTo(nextDueTimeMs);
        await yieldImmediate();
      }
      expect(authority.inspect().liveResourceCounts.pendingCommands).toBe(1);
      expect(authority.stepExact(1)).toEqual({ ok: true, value: capturedTick + 1 });
      await drainInjector();

      for (let turns = 0; turns < 1_000; turns += 1) {
        const inspectedA = await pageA.evaluate(() => window.threeGameKitM3.inspect());
        if (inspectedA.replication.counters.rejectedCount === beforeA.replication.counters.rejectedCount + 1) break;
        await yieldImmediate();
      }

      const afterAuthority = authority.inspect();
      const afterA = await pageA.evaluate(() => window.threeGameKitM3.inspect());
      const afterB = await pageB.evaluate(() => window.threeGameKitM3.inspect());
      const connectionAAfter = afterAuthority.connections.find(({ connectionId }) => connectionId === bindingA.connectionId);
      const connectionBAfter = afterAuthority.connections.find(({ connectionId }) => connectionId === bindingB.connectionId);
      if (connectionAAfter === undefined || connectionBAfter === undefined) throw new Error("missing_authority_connection");

      for (const key of Object.keys(beforeGlobalCounts) as Array<keyof typeof beforeGlobalCounts>) {
        expect(afterAuthority.rejectedCommandCounts[key] - beforeGlobalCounts[key]).toBe(key === "phase-invalid" ? 1 : 0);
      }
      for (const key of Object.keys(beforeAConnectionCounts) as Array<keyof typeof beforeAConnectionCounts>) {
        expect(connectionAAfter.rejectedCommandCounts[key] - beforeAConnectionCounts[key]).toBe(key === "phase-invalid" ? 1 : 0);
      }
      expect(connectionBAfter.rejectedCommandCounts).toEqual(beforeBConnectionCounts);
      expect(afterAuthority.structuredRuntimeErrors).toEqual([
        ...beforeErrors,
        {
          schemaVersion: 1,
          sequence: (beforeErrors.at(-1)?.sequence ?? 0) + 1,
          code: "command-rejected",
          category: "expected",
          expected: true,
          runtime: "server",
          operation: "command-validation",
          message: "Decoded queued command was rejected during validation",
          tick: capturedTick + 1,
          reasonCode: "phase-invalid",
          context: [],
          cause: null,
        },
      ]);
      await yieldImmediate();
      expect(authority.inspect().structuredRuntimeErrors).toEqual(afterAuthority.structuredRuntimeErrors);
      expect(connectionAAfter.acceptedSequence).toBe(1);
      expect(authorityDigest(afterAuthority)).toEqual(beforeAuthorityDigest);
      expect(afterAuthority.sharedMovementCallCount).toBe(beforeSharedCalls);
      expect(afterAuthority.authoritativeCollisionCallCount).toBe(beforeCollisionCalls);
      expect(afterAuthority.validationFixtures).toEqual(beforeFixtures);
      expect(afterA.replication.counters.rejectedCount).toBe(beforeA.replication.counters.rejectedCount + 1);
      expect(afterB.replication.counters.rejectedCount).toBe(beforeB.replication.counters.rejectedCount);
      expect(afterA.errors).toEqual(beforeA.errors);
      expect(afterB.errors).toEqual(beforeB.errors);
      await recordObservation("OP-06");
    });
    await test.step("07 fence disconnect and preserve peer", async () => {
      if (authority === undefined || networking === undefined || pageA === undefined || pageB === undefined) {
        throw new Error("topology_not_booted");
      }

      const beforeA = await pageA.evaluate(() => window.threeGameKitM3.inspect());
      const beforeB = await pageB.evaluate(() => window.threeGameKitM3.inspect());
      const bindingA = beforeA.transport.binding;
      const bindingB = beforeB.transport.binding;
      if (bindingA === null || bindingB === null) throw new Error("missing_binding");

      const beforeAuthority = authority.inspect();
      const beforeNetworking = networking.inspect();
      const connectionABefore = beforeAuthority.connections.find(
        ({ connectionId }) => connectionId === bindingA.connectionId,
      );
      const connectionBBefore = beforeAuthority.connections.find(
        ({ connectionId }) => connectionId === bindingB.connectionId,
      );
      const avatarABefore = beforeAuthority.avatars.find(({ entityId }) => entityId === bindingA.ownedEntityId);
      const avatarBBefore = beforeAuthority.avatars.find(({ entityId }) => entityId === bindingB.ownedEntityId);
      if (
        connectionABefore === undefined || connectionBBefore === undefined ||
        avatarABefore === undefined || avatarBBefore === undefined
      ) throw new Error("missing_authority_state");
      expect(connectionABefore.acceptedSequence).toBe(1);
      expect(beforeAuthority.liveResourceCounts.pendingCommands).toBe(0);

      const beforeGlobalCounts = beforeAuthority.rejectedCommandCounts;
      const beforeAConnectionCounts = connectionABefore.rejectedCommandCounts;
      const beforeErrors = beforeAuthority.structuredRuntimeErrors;
      const beforeSharedCalls = beforeAuthority.sharedMovementCallCount;
      const beforeCollisionCalls = beforeAuthority.authoritativeCollisionCallCount;
      const disconnectTick = beforeAuthority.serverTick;
      const sent = await pageA.evaluate(
        ({ intendedTick }) => window.threeGameKitM3.sendCommand(
          2,
          intendedTick,
          { kind: "move", x: 1, z: 0 },
        ),
        { intendedTick: disconnectTick + 1 },
      );
      expect(sent).toEqual({ ok: true, value: undefined });

      for (let turns = 0; authority.inspect().liveResourceCounts.pendingCommands !== 1 && turns < 1_000; turns += 1) {
        const nextDueTimeMs = injector.nextDueTimeMs;
        if (nextDueTimeMs !== null) injector.advanceTo(nextDueTimeMs);
        await yieldImmediate();
      }
      const pendingAuthority = authority.inspect();
      expect(pendingAuthority.serverTick).toBe(disconnectTick);
      expect(pendingAuthority.liveResourceCounts.pendingCommands).toBe(1);
      expect(
        pendingAuthority.connections.find(({ connectionId }) => connectionId === bindingA.connectionId)?.pendingCommandCount,
      ).toBe(1);

      const shutdownA = pageA.evaluate(async () => await window.threeGameKitM3.shutdown());
      const shutdownResultA = await Promise.race([
        shutdownA,
        new Promise<never>((_resolve, reject) => {
          setTimeout(() => reject(new Error("a_disconnect_fence_timeout")), 5_000);
        }),
      ]);
      expect(Object.values(shutdownResultA.transport.liveResourceCounts).every((count) => count === 0)).toBe(true);
      expect(Object.values(shutdownResultA.replication.liveResourceCounts).every((count) => count === 0)).toBe(true);

      for (let turns = 0; turns < 1_000; turns += 1) {
        const inspected = authority.inspect();
        const inspectedNetworking = networking.inspect();
        if (
          inspected.liveResourceCounts.pendingCommands === 0 &&
          inspected.liveResourceCounts.connections === beforeAuthority.liveResourceCounts.connections - 1 &&
          inspectedNetworking.connectionCount === beforeNetworking.connectionCount - 1
        ) break;
        await yieldImmediate();
      }

      const fencedAuthority = authority.inspect();
      const fencedNetworking = networking.inspect();
      const fencedB = await pageB.evaluate(() => window.threeGameKitM3.inspect());
      const closedA = fencedAuthority.connections.find(
        (connection) => connection.connectionId === null &&
          connection.phase === "closed" &&
          connection.rejectedCommandCounts["stale-connection"] ===
            beforeAConnectionCounts["stale-connection"] + 1,
      );
      expect(closedA).toEqual({
        phase: "closed",
        phaseTrace: [...connectionABefore.phaseTrace, "disconnecting", "closed"],
        connectionId: null,
        playerId: null,
        ownedEntityId: null,
        position: null,
        pendingCommandCount: 0,
        scheduledCommandCount: 0,
        acceptedSequence: null,
        acknowledgedSequence: null,
        rejectedCommandCounts: {
          ...beforeAConnectionCounts,
          "stale-connection": beforeAConnectionCounts["stale-connection"] + 1,
        },
      });
      for (const key of Object.keys(beforeGlobalCounts) as Array<keyof typeof beforeGlobalCounts>) {
        expect(fencedAuthority.rejectedCommandCounts[key] - beforeGlobalCounts[key]).toBe(
          key === "stale-connection" ? 1 : 0,
        );
      }
      expect(fencedAuthority.structuredRuntimeErrors).toEqual([
        ...beforeErrors,
        {
          schemaVersion: 1,
          sequence: (beforeErrors.at(-1)?.sequence ?? 0) + 1,
          code: "command-rejected",
          category: "expected",
          expected: true,
          runtime: "server",
          operation: "disconnect-fence",
          message: "Purged command was rejected by the disconnect fence",
          tick: disconnectTick,
          reasonCode: "stale-connection",
          context: [],
          cause: null,
        },
      ]);
      expect(shutdownResultA.replication.counters.rejectedCount).toBe(beforeA.replication.counters.rejectedCount);
      expect(fencedAuthority.sharedMovementCallCount).toBe(beforeSharedCalls);
      expect(fencedAuthority.authoritativeCollisionCallCount).toBe(beforeCollisionCalls);
      expect(fencedAuthority.avatars.some(({ entityId }) => entityId === bindingA.ownedEntityId)).toBe(false);
      expect(fencedAuthority.connections.some(({ connectionId }) => connectionId === bindingA.connectionId)).toBe(false);
      expect(fencedAuthority.liveResourceCounts).toEqual({
        connections: beforeAuthority.liveResourceCounts.connections - 1,
        bindings: beforeAuthority.liveResourceCounts.bindings - 1,
        avatars: beforeAuthority.liveResourceCounts.avatars - 1,
        capsules: beforeAuthority.liveResourceCounts.capsules - 1,
        pendingCommands: 0,
        scheduledCommands: 0,
      });
      expect(fencedNetworking).toMatchObject({
        connectionCount: beforeNetworking.connectionCount - 1,
        socketCount: beforeNetworking.socketCount - 1,
        listenerCount: beforeNetworking.listenerCount - 3,
        queuedItemCount: beforeNetworking.queuedItemCount,
        timerCount: beforeNetworking.timerCount,
      });
      expect(fencedB).toEqual(beforeB);
      expect(fencedAuthority.connections.find(({ connectionId }) => connectionId === bindingB.connectionId)).toEqual(connectionBBefore);
      expect(fencedAuthority.avatars.find(({ entityId }) => entityId === bindingB.ownedEntityId)).toEqual(avatarBBefore);

      expect(authority.stepExact(2)).toEqual({ ok: true, value: disconnectTick + 2 });
      await drainInjector();
      const afterTicks = authority.inspect();
      expect(afterTicks.serverTick).toBe(disconnectTick + 2);
      expect(afterTicks.avatars.some(({ entityId }) => entityId === bindingA.ownedEntityId)).toBe(false);
      expect(afterTicks.connections.some(({ connectionId }) => connectionId === bindingA.connectionId)).toBe(false);
      expect(afterTicks.liveResourceCounts.bindings).toBe(beforeAuthority.liveResourceCounts.bindings - 1);
      expect(afterTicks.liveResourceCounts.avatars).toBe(beforeAuthority.liveResourceCounts.avatars - 1);
      expect(afterTicks.liveResourceCounts.capsules).toBe(beforeAuthority.liveResourceCounts.capsules - 1);
      expect(afterTicks.liveResourceCounts.pendingCommands).toBe(0);
      expect(afterTicks.connections.find(({ connectionId }) => connectionId === bindingB.connectionId)?.phase).toBe("joined");

      expect(afterTicks.serverTick).toBe(69);
      const unsynchronizedB = await pageB.evaluate(() => window.threeGameKitM3.inspect());
      const synchronizationSteps = afterTicks.serverTick - unsynchronizedB.replication.clientTick;
      expect(synchronizationSteps).toBeGreaterThanOrEqual(0);
      await pageB.evaluate((count) => {
        const stepped = window.threeGameKitM3.stepExact(count);
        if (!stepped.ok) throw new Error(stepped.failure.code);
      }, synchronizationSteps);

      const synchronizedB = await pageB.evaluate(() => window.threeGameKitM3.inspect());
      expect(synchronizedB.replication.clientTick).toBe(afterTicks.serverTick);
      expect(synchronizedB.replication.nextSequence).toBe(1);
      const survivalConnectionBefore = afterTicks.connections.find(
        ({ connectionId }) => connectionId === bindingB.connectionId,
      );
      const survivalAvatarBefore = afterTicks.avatars.find(
        ({ entityId }) => entityId === bindingB.ownedEntityId,
      );
      const simulationBefore = synchronizedB.positions.simulationPosition;
      const presentationBefore = synchronizedB.positions.localPresentationPosition;
      if (
        survivalConnectionBefore === undefined || survivalAvatarBefore === undefined ||
        simulationBefore === null || presentationBefore === null
      ) throw new Error("missing_b_survival_state");
      for (const position of [survivalAvatarBefore.position, simulationBefore, presentationBefore]) {
        expect([position.x, position.y, position.z].every(Number.isFinite)).toBe(true);
      }
      const survivalCountersBefore = synchronizedB.replication.counters;
      const survivalErrorsBefore = synchronizedB.errors;
      const survivalGlobalCounts = afterTicks.rejectedCommandCounts;
      const survivalConnectionCounts = survivalConnectionBefore.rejectedCommandCounts;
      const survivalRuntimeErrors = afterTicks.structuredRuntimeErrors;
      const survivalSharedCalls = afterTicks.sharedMovementCallCount;
      const survivalCollisionCalls = afterTicks.authoritativeCollisionCallCount;

      await pageB.evaluate(() => {
        const queued = window.threeGameKitM3.queueMove(1, 0);
        if (!queued.ok) throw new Error(queued.failure.code);
        const stepped = window.threeGameKitM3.stepExact(1);
        if (!stepped.ok) throw new Error(stepped.failure.code);
      });
      const predictionFrameTime = injector.nowMs;
      await pageB.evaluate((nowMs) => {
        const framed = window.threeGameKitM3.frame(nowMs);
        if (!framed.ok) throw new Error(framed.failure.code);
      }, predictionFrameTime);

      const predictedB = await pageB.evaluate(() => window.threeGameKitM3.inspect());
      const predictedPresentation = predictedB.positions.localPresentationPosition;
      if (predictedPresentation === null) throw new Error("missing_b_predicted_presentation");
      expect([predictedPresentation.x, predictedPresentation.y, predictedPresentation.z].every(Number.isFinite)).toBe(true);
      expect(Math.hypot(
        predictedPresentation.x - presentationBefore.x,
        predictedPresentation.y - presentationBefore.y,
        predictedPresentation.z - presentationBefore.z,
      )).toBeGreaterThan(0);
      expect(predictedB.replication.historySequences).toEqual([1]);
      expect(predictedB.replication.counters.sendCount).toBe(survivalCountersBefore.sendCount + 1);
      expect(predictedB.replication.counters.predictCount).toBe(survivalCountersBefore.predictCount + 1);
      expect(predictedB.positions.remoteAvatars.some(({ entityId }) => entityId === bindingA.ownedEntityId)).toBe(false);
      expect(authority.inspect().avatars.some(({ entityId }) => entityId === bindingA.ownedEntityId)).toBe(false);

      for (let turns = 0; authority.inspect().liveResourceCounts.pendingCommands !== 1 && turns < 1_000; turns += 1) {
        const nextDueTimeMs = injector.nextDueTimeMs;
        if (nextDueTimeMs !== null) injector.advanceTo(nextDueTimeMs);
        await yieldImmediate();
      }
      const pendingSurvival = authority.inspect();
      expect(pendingSurvival.liveResourceCounts.pendingCommands).toBe(1);
      expect(
        pendingSurvival.connections.find(({ connectionId }) => connectionId === bindingB.connectionId)?.pendingCommandCount,
      ).toBe(1);
      expect(pendingSurvival.connections.some(({ connectionId }) => connectionId === bindingA.connectionId)).toBe(false);
      expect(pendingSurvival.avatars.some(({ entityId }) => entityId === bindingA.ownedEntityId)).toBe(false);

      expect(authority.stepExact(3)).toEqual({ ok: true, value: 72 });
      const authoritativeSurvival = authority.inspect();
      const survivalConnectionAfter = authoritativeSurvival.connections.find(
        ({ connectionId }) => connectionId === bindingB.connectionId,
      );
      const survivalAvatarAfter = authoritativeSurvival.avatars.find(
        ({ entityId }) => entityId === bindingB.ownedEntityId,
      );
      if (survivalConnectionAfter === undefined || survivalAvatarAfter === undefined) {
        throw new Error("missing_authoritative_b_survival_state");
      }
      expect(survivalConnectionAfter.acceptedSequence).toBe(1);
      expect(survivalConnectionAfter.acknowledgedSequence).toBe(1);
      expect(authoritativeSurvival.sharedMovementCallCount).toBe(survivalSharedCalls + 1);
      expect(authoritativeSurvival.authoritativeCollisionCallCount).toBe(survivalCollisionCalls + 1);
      expect([survivalAvatarAfter.position.x, survivalAvatarAfter.position.y, survivalAvatarAfter.position.z].every(Number.isFinite)).toBe(true);
      expect(Math.hypot(
        survivalAvatarAfter.position.x - survivalAvatarBefore.position.x,
        survivalAvatarAfter.position.y - survivalAvatarBefore.position.y,
        survivalAvatarAfter.position.z - survivalAvatarBefore.position.z,
      )).toBeGreaterThan(0);
      expect(authoritativeSurvival.liveResourceCounts).toEqual({
        connections: 1,
        bindings: 1,
        avatars: 1,
        capsules: 1,
        pendingCommands: 0,
        scheduledCommands: 0,
      });
      expect(authoritativeSurvival.connections.some(({ connectionId }) => connectionId === bindingA.connectionId)).toBe(false);
      expect(authoritativeSurvival.avatars.some(({ entityId }) => entityId === bindingA.ownedEntityId)).toBe(false);

      await drainInjector();
      for (let turns = 0; turns < 1_000; turns += 1) {
        const inspectedB = await pageB.evaluate(() => window.threeGameKitM3.inspect());
        if (inspectedB.replication.decodedInboxTicks.includes(72)) break;
        await yieldImmediate();
      }
      const deliveredSurvivalB = await pageB.evaluate(() => window.threeGameKitM3.inspect());
      expect(deliveredSurvivalB.replication.decodedInboxTicks).toContain(72);
      expect(deliveredSurvivalB.replication.counters.receivedSnapshotCount).toBe(
        survivalCountersBefore.receivedSnapshotCount + 1,
      );
      await pageB.evaluate(() => {
        const stepped = window.threeGameKitM3.stepExact(1);
        if (!stepped.ok) throw new Error(stepped.failure.code);
      });

      const reconciledB = await pageB.evaluate(() => window.threeGameKitM3.inspect());
      const reconciledSimulation = reconciledB.positions.simulationPosition;
      if (reconciledSimulation === null) throw new Error("missing_b_reconciled_simulation");
      expect(reconciledB.replication.acknowledgedSequence).toBe(1);
      expect(reconciledB.replication.historySequences).toEqual([]);
      expect(Math.abs(reconciledSimulation.x - survivalAvatarAfter.position.x)).toBeLessThanOrEqual(1e-6);
      expect(Math.abs(reconciledSimulation.y - survivalAvatarAfter.position.y)).toBeLessThanOrEqual(1e-6);
      expect(Math.abs(reconciledSimulation.z - survivalAvatarAfter.position.z)).toBeLessThanOrEqual(1e-6);

      const presentationErrors: number[] = [];
      const reconciliationFrameTime = injector.nowMs;
      for (let offsetMs = 0; offsetMs <= 500; offsetMs += 100) {
        const timestamp = reconciliationFrameTime + offsetMs;
        injector.advanceTo(timestamp);
        const presentation = await pageB.evaluate((nowMs) => {
          const framed = window.threeGameKitM3.frame(nowMs);
          if (!framed.ok) throw new Error(framed.failure.code);
          return window.threeGameKitM3.inspect().positions.localPresentationPosition;
        }, timestamp);
        if (presentation === null) throw new Error("missing_b_survival_presentation");
        presentationErrors.push(Math.hypot(
          presentation.x - survivalAvatarAfter.position.x,
          presentation.y - survivalAvatarAfter.position.y,
          presentation.z - survivalAvatarAfter.position.z,
        ));
      }
      expect(presentationErrors.every(Number.isFinite)).toBe(true);
      expect(presentationErrors.at(-1)).toBeLessThanOrEqual(0.05);

      const finalAuthority = authority.inspect();
      const finalB = await pageB.evaluate(() => window.threeGameKitM3.inspect());
      expect(finalB.transport.binding).toEqual(bindingB);
      expect(finalB.replication.state).toBe("joined");
      expect(finalB.replication.counters.rejectedCount).toBe(survivalCountersBefore.rejectedCount);
      expect(finalB.errors).toEqual(survivalErrorsBefore);
      expect(finalAuthority.rejectedCommandCounts).toEqual(survivalGlobalCounts);
      expect(finalAuthority.structuredRuntimeErrors).toEqual(survivalRuntimeErrors);
      expect(
        finalAuthority.connections.find(({ connectionId }) => connectionId === bindingB.connectionId)?.rejectedCommandCounts,
      ).toEqual(survivalConnectionCounts);
      expect(finalAuthority.connections.some(({ connectionId }) => connectionId === bindingA.connectionId)).toBe(false);
      expect(finalAuthority.avatars.some(({ entityId }) => entityId === bindingA.ownedEntityId)).toBe(false);
      expect(injector.pendingCount).toBe(0);
      await recordObservation("OP-07", { disconnectTick, removalTick: disconnectTick });
    });
    await test.step("08 shutdown twice with zero resources", async () => { await cleanup(true); });
  } catch (error) {
    testBodyFailed = true;
    evidence.recordFailure(error);
    throw error;
  } finally {
    let cleanupFailed = false;
    let cleanupError: unknown;
    try {
      await cleanup(false);
    } catch (error) {
      cleanupFailed = true;
      cleanupError = error;
      evidence.recordFailure(error);
    }

    evidence.setSchedule(injector.getSchedule());
    const attachment = await evidence.write(testInfo.outputPath("evidence.json"));
    await testInfo.attach("m3-evidence", {
      body: attachment.body,
      contentType: "application/json",
    });

    if (cleanupFailed && !testBodyFailed) throw cleanupError;
  }
});
