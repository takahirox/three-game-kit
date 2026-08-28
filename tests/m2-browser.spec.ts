import { expect, test } from "@playwright/test";

interface M2Report {
  ready: boolean;
  assertions: Record<string, boolean>;
  evidence: {
    composedExports: string[];
    programmedCommands: string[];
    keyboardMapping: boolean;
    simulation: {
      firstTick: number;
      finalTick: number;
      tickBeforeFrames: number;
      tickAfterFrames: number;
      semanticCommandCount: number;
      desiredTranslationCount: number;
      collisionResultCount: number;
    };
    presentation: {
      requested: number;
      delivered: number;
      cancelled: number;
      outstandingBeforeShutdown: number;
      outstandingAfterShutdown: number;
      cameraTransformCount: number;
      renderCount: number;
    };
    floor: {
      horizontalDistanceMeters: number;
      verticalErrorMeters: number;
      grounded: boolean;
    };
    obstacle: {
      errorMeters: number;
      toleranceMeters: number;
      toleranceDocumentation: string;
      collided: boolean;
      collisionCount: number;
    };
    transforms: {
      finite: boolean;
    };
    assets: {
      successful: boolean;
      failed: boolean;
      successfulClipCount: number | null;
      failureCode: string | null;
      attachedToRenderer: boolean;
    };
    resize: {
      width: number;
      height: number;
      pixelRatio: number;
    };
    rollback: {
      state: string;
      reason: string | null;
      disposedOrder: string[];
      failureCodes: string[];
      counts: {
        firstSetup: number;
        firstDispose: number;
        firstRelease: number;
        secondSetup: number;
        secondDispose: number;
      };
      liveResourceTotal: number;
    };
    shutdown: {
      calls: number;
      samePromise: boolean;
      sameResult: boolean;
      clean: boolean;
      disposedOrder: string[];
    };
  };
  telemetry: {
    frameDurationSeconds: number | null;
    entityCount: number;
    installedFeatureIds: string[];
    simulationTick: number;
    presentationFrameCount: number;
    errors: unknown[];
  };
  cleanup: {
    keyboardListeners: { added: number; removed: number; active: number };
    resizeListeners: { added: number; removed: number };
    liveResources: Record<string, number>;
    liveResourceTotal: number;
    rendererDisposed: boolean;
    collisionDisposed: boolean;
    loaderDisposed: boolean;
    avatarDisposed: boolean;
  };
}

test("M2 local browser slice composes, runs, reports, and cleans up", async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto("/examples/local-browser/index.html");
  await page.waitForFunction(
    () => Reflect.get(window, "__THREE_GAME_KIT_M2__") !== undefined,
  );
  const report = await page.evaluate<M2Report>(() =>
    Reflect.get(window, "__THREE_GAME_KIT_M2__"),
  );

  expect(pageErrors).toEqual([]);
  expect(report.ready).toBe(true);
  for (const [criterion, passed] of Object.entries(report.assertions)) {
    expect(passed, criterion).toBe(true);
  }

  expect(report.evidence.composedExports).toEqual([
    "@three-game-kit/core",
    "@three-game-kit/shared",
    "@three-game-kit/client",
    "@three-game-kit/client/input",
    "@three-game-kit/client/collision",
    "@three-game-kit/client/camera",
    "@three-game-kit/client/rendering",
    "@three-game-kit/client/assets",
  ]);
  expect(report.evidence.programmedCommands).toEqual([
    "move(1,0)",
    "move(0,-1)",
    "reset",
  ]);
  expect(report.evidence.keyboardMapping).toBe(true);
  expect(report.evidence.simulation).toEqual({
    firstTick: 60,
    finalTick: 120,
    tickBeforeFrames: 120,
    tickAfterFrames: 120,
    semanticCommandCount: 120,
    desiredTranslationCount: 120,
    collisionResultCount: 120,
  });
  expect(report.evidence.presentation).toMatchObject({
    requested: 76,
    delivered: 75,
    cancelled: 1,
    outstandingBeforeShutdown: 1,
    outstandingAfterShutdown: 0,
    cameraTransformCount: 75,
    renderCount: 75,
  });
  expect(report.evidence.transforms.finite).toBe(true);
  expect(report.evidence.floor.grounded).toBe(true);
  expect(report.evidence.floor.horizontalDistanceMeters).toBeGreaterThanOrEqual(
    2.5,
  );
  expect(report.evidence.floor.verticalErrorMeters).toBeLessThanOrEqual(0.02);
  expect(report.evidence.obstacle.toleranceMeters).toBe(0.02);
  expect(report.evidence.obstacle.toleranceDocumentation).toContain("0.02 meters");
  expect(report.evidence.obstacle.errorMeters).toBeLessThanOrEqual(0.02);
  expect(report.evidence.obstacle.collided).toBe(true);
  expect(report.evidence.obstacle.collisionCount).toBeGreaterThan(0);
  expect(report.evidence.assets).toEqual({
    successful: true,
    failed: true,
    successfulClipCount: 0,
    failureCode: "load-failed",
    attachedToRenderer: true,
  });
  expect(report.evidence.resize).toEqual({
    width: 800,
    height: 450,
    pixelRatio: 1.25,
  });
  expect(report.evidence.rollback).toMatchObject({
    state: "stopped",
    reason: "setup-failed",
    disposedOrder: ["rollback-first"],
    failureCodes: ["setup-failed"],
    counts: {
      firstSetup: 1,
      firstDispose: 1,
      firstRelease: 1,
      secondSetup: 1,
      secondDispose: 0,
    },
    liveResourceTotal: 0,
  });
  expect(report.evidence.shutdown).toMatchObject({
    calls: 2,
    samePromise: true,
    sameResult: true,
    clean: true,
  });
  expect(report.telemetry.simulationTick).toBe(120);
  expect(report.telemetry.presentationFrameCount).toBe(75);
  expect(report.telemetry.frameDurationSeconds).toBeGreaterThan(0);
  expect(report.telemetry.entityCount).toBe(1);
  expect(report.telemetry.installedFeatureIds).toEqual([
    "movement-input",
    "collision",
    "third-person-camera",
    "three-rendering",
    "m2-entity",
  ]);
  expect(report.telemetry.errors).toEqual([]);
  expect(report.cleanup.keyboardListeners).toEqual({ added: 2, removed: 2, active: 0 });
  expect(report.cleanup.resizeListeners).toEqual({ added: 1, removed: 1 });
  expect(report.cleanup.liveResourceTotal).toBe(0);
  expect(Object.values(report.cleanup.liveResources).every((count) => count === 0)).toBe(true);
  expect(report.cleanup.rendererDisposed).toBe(true);
  expect(report.cleanup.collisionDisposed).toBe(true);
  expect(report.cleanup.loaderDisposed).toBe(true);
  expect(report.cleanup.avatarDisposed).toBe(true);
});
