import { expect, test } from "@playwright/test";
import type {} from "../showcases/metaverse/src/main.js";

test("Lantern Court composes deterministic avatar locomotion, camera and interaction", async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto("/showcases/metaverse/index.html?test=1");
  await expect
    .poll(() => page.evaluate(() => window.__METAVERSE__?.ready))
    .toBe(true);
  const boot = await page.evaluate(() => ({
    state: window.__METAVERSE__.snapshot(),
    runtime: window.__METAVERSE__.inspectRuntime(),
    renderer: window.__METAVERSE__.inspectRenderer(),
    assets: window.__METAVERSE__.inspectAssets(),
  }));
  expect(boot.state?.phase).toBe("title");
  expect(boot.renderer?.skinnedMeshes).toBe(1);
  expect(boot.renderer!.meshes).toBeGreaterThan(60);
  expect(boot.assets.cachedIds).toEqual(["visitor", "court"]);
  expect(boot.runtime?.installedFeatureIds).toEqual(
    expect.arrayContaining([
      "character-controller",
      "animation",
      "third-person-camera",
      "asset-manager",
      "movement-input",
      "ui-hud",
      "three-rendering",
      "metaverse.rules",
    ]),
  );
  await page.screenshot({ path: testInfo.outputPath("court-welcome.png") });
  await page.getByRole("button", { name: "Enter the court" }).click();
  await page.evaluate(() => window.__METAVERSE__.advance(0.2));
  expect(
    await page.evaluate(() => window.__METAVERSE__.snapshot()?.avatar.grounded),
  ).toBe(true);
  const idle = await page.evaluate(
    () => window.__METAVERSE__.inspectRenderer()?.headQuaternion,
  );
  await page.evaluate(() => window.__METAVERSE__.advance(0.4));
  expect(
    await page.evaluate(
      () => window.__METAVERSE__.inspectRenderer()?.headQuaternion,
    ),
  ).not.toEqual(idle);
  expect(
    await page.evaluate(
      () => window.__METAVERSE__.inspectAnimation()?.activeState,
    ),
  ).toBe("idle");
  // Out-of-range semantic interaction must not mutate the world.
  await page.evaluate(() => {
    const g = window.__METAVERSE__;
    g.press("interact");
    g.advance(1 / 60);
  });
  expect(
    await page.evaluate(() => window.__METAVERSE__.snapshot()?.interaction),
  ).toMatchObject({ active: false, toggles: 0, rejected: 1 });
  // Walk to the lantern: 2.4 m/s for 2.5 seconds, stop before its solid base.
  const walked = await page.evaluate(() => {
    const g = window.__METAVERSE__;
    g.setMove(0, -1);
    g.advance(2.5);
    return { s: g.snapshot(), a: g.inspectAnimation(), r: g.inspectRenderer() };
  });
  expect(walked.s!.avatar.position.z).toBeCloseTo(-1, 3);
  expect(walked.s!.avatar.facing).toBeCloseTo(Math.PI, 5);
  expect(walked.s!.avatar.locomotion).toBe("walk");
  expect(walked.a?.activeState).toBe("walk");
  expect(walked.s!.interaction.nearby).toBe(true);
  const leg = walked.r?.legQuaternion;
  await page.evaluate(() => window.__METAVERSE__.advance(0.1));
  expect(
    await page.evaluate(
      () => window.__METAVERSE__.inspectRenderer()?.legQuaternion,
    ),
  ).not.toEqual(leg);
  await page.evaluate(() => {
    const g = window.__METAVERSE__;
    g.setMove(0, 0);
    g.press("interact");
    g.advance(0.2);
  });
  expect(
    await page.evaluate(() => window.__METAVERSE__.snapshot()?.interaction),
  ).toMatchObject({ active: true, toggles: 1 });
  expect(
    await page.evaluate(
      () => window.__METAVERSE__.inspectRenderer()?.lanternIntensity,
    ),
  ).toBeGreaterThan(0);
  expect(
    await page.evaluate(
      () => window.__METAVERSE__.inspectAnimation()?.activeState,
    ),
  ).toBe("idle");
  await page.screenshot({ path: testInfo.outputPath("court-lantern.png") });
  await page.evaluate(() => {
    const g = window.__METAVERSE__;
    g.press("interact");
    g.advance(1 / 60);
  });
  expect(
    await page.evaluate(() => window.__METAVERSE__.snapshot()?.interaction),
  ).toMatchObject({ active: false, toggles: 2 });
  // Run speed, camera-relative movement, and grounded jump/landing.
  await page.evaluate(() => {
    const g = window.__METAVERSE__;
    g.reset();
    g.setMove(1, 0, true);
    g.advance(1);
  });
  const run = await page.evaluate(() => ({
    s: window.__METAVERSE__.snapshot(),
    a: window.__METAVERSE__.inspectAnimation(),
  }));
  expect(run.s!.avatar.position.x).toBeCloseTo(4.8, 2);
  expect(run.s!.avatar.locomotion).toBe("run");
  expect(run.a?.activeState).toBe("run");
  // The garden tree behind this position shortens the orbit rather than hiding the visitor.
  expect(
    await page.evaluate(() => {
      const camera = window.__METAVERSE__.inspectRenderer()!.camera;
      return Math.hypot(
        ...camera.position.map((value, index) => value - camera.target[index]!),
      );
    }),
  ).toBeLessThan(6);
  await page.evaluate(() => {
    const g = window.__METAVERSE__;
    g.setMove(0, 0);
    g.press("jump");
    g.advance(0.2);
  });
  expect(
    await page.evaluate(
      () => window.__METAVERSE__.snapshot()?.avatar.position.y,
    ),
  ).toBeGreaterThan(1.5);
  expect(
    await page.evaluate(() => window.__METAVERSE__.snapshot()?.avatar.grounded),
  ).toBe(false);
  await page.evaluate(() => window.__METAVERSE__.advance(1));
  expect(
    await page.evaluate(() => window.__METAVERSE__.snapshot()?.avatar.grounded),
  ).toBe(true);
  expect(
    await page.evaluate(() =>
      Math.abs(window.__METAVERSE__.snapshot()!.avatar.position.y - 0.91),
    ),
  ).toBeLessThan(0.02);
  await page.evaluate(() => {
    const g = window.__METAVERSE__;
    g.reset();
    g.setLook(Math.PI / 2);
    g.setMove(0, -1);
    g.advance(1);
  });
  expect(
    await page.evaluate(
      () => window.__METAVERSE__.snapshot()?.avatar.position.x,
    ),
  ).toBeCloseTo(2.4, 2);
  const camera = await page.evaluate(
    () => window.__METAVERSE__.inspectRenderer()?.camera,
  );
  expect(camera!.position[0]).toBeLessThan(camera!.target[0]!);
  expect(camera!.position[1]).toBeGreaterThan(camera!.target[1]!);
  // Pillar and world-boundary collisions prevent traversing authored structures or escaping.
  await page.evaluate(() => {
    const g = window.__METAVERSE__;
    g.reset();
    g.setMove(1, 0, true);
    g.advance(4);
  });
  expect(
    await page.evaluate(
      () => window.__METAVERSE__.snapshot()?.avatar.position.x,
    ),
  ).toBeLessThan(15.4);
  await page.evaluate(() => {
    const g = window.__METAVERSE__;
    g.reset();
    g.setMove(-1, 0, true);
    g.advance(1.35);
    g.setMove(0, -1, true);
    g.advance(2.3);
  });
  expect(
    await page.evaluate(
      () => window.__METAVERSE__.snapshot()?.avatar.position.z,
    ),
  ).toBeGreaterThan(-4.3);
  // Reset also resets animation time; repeated semantic replay produces the same state.
  const replay = async () =>
    page.evaluate(() => {
      const g = window.__METAVERSE__;
      g.reset();
      g.setMove(0.6, -0.8, true);
      g.advance(0.5);
      g.setMove(0, 0);
      g.advance(0.3);
      return { s: g.snapshot(), a: g.inspectAnimation() };
    });
  expect(await replay()).toEqual(await replay());
  await page.evaluate(() => {
    const g = window.__METAVERSE__;
    g.reset();
    g.advance(0.2);
  });
  await page.keyboard.down("KeyW");
  await page.keyboard.down("ShiftLeft");
  await page.evaluate(() => window.__METAVERSE__.advance(0.5));
  await page.keyboard.up("KeyW");
  await page.keyboard.up("ShiftLeft");
  expect(
    await page.evaluate(
      () => window.__METAVERSE__.snapshot()?.avatar.position.z,
    ),
  ).toBeCloseTo(2.6, 2);
  // Physical diagonals preserve run speed and satisfy the public input contract.
  await page.evaluate(() => window.__METAVERSE__.reset());
  await page.keyboard.down("KeyW");
  await page.keyboard.down("KeyD");
  await page.keyboard.down("ShiftLeft");
  await page.evaluate(() => window.__METAVERSE__.advance(0.5));
  await page.keyboard.up("KeyW");
  await page.keyboard.up("KeyD");
  await page.keyboard.up("ShiftLeft");
  expect(
    await page.evaluate(() => {
      const position = window.__METAVERSE__.snapshot()!.avatar.position;
      return Math.hypot(position.x, position.z - 5);
    }),
  ).toBeCloseTo(2.4, 2);
  // Focus loss clears held controls.
  await page.keyboard.down("KeyW");
  await page.evaluate(() => {
    window.dispatchEvent(new Event("blur"));
    window.__METAVERSE__.advance(0.2);
  });
  await page.keyboard.up("KeyW");
  expect(
    await page.evaluate(
      () => window.__METAVERSE__.snapshot()?.avatar.locomotion,
    ),
  ).toBe("idle");
  expect(await page.evaluate(() => window.__METAVERSE__.errors())).toEqual([]);
  await page.mouse.move(700, 400);
  await page.mouse.down();
  expect(
    await page.evaluate(
      () => window.__METAVERSE__.inspectLeaks().pointerCaptured,
    ),
  ).toBe(true);
  await page.evaluate(async () => {
    await Promise.all([
      window.__METAVERSE__.dispose(),
      window.__METAVERSE__.dispose(),
    ]);
  });
  const leaks = await page.evaluate(() => window.__METAVERSE__.inspectLeaks());
  expect(leaks).toMatchObject({
    hostDisposed: true,
    hostListeners: 0,
    rafActive: false,
    heldKeys: 0,
    pointerCaptured: false,
    game: {
      controllerDisposed: true,
      animationDisposed: true,
      proximityDisposed: true,
      assetsDisposed: true,
      hudDisposed: true,
      lifecycle: "stopped",
      renderer: {
        disposed: true,
        meshes: 0,
        ownedGeometries: 0,
        ownedMaterials: 0,
      },
    },
  });
  expect(await page.evaluate(() => window.__METAVERSE__.errors())).toEqual([]);
  expect(errors).toEqual([]);
});

test("forward and right movement follow the rendered camera at rotated yaw", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/showcases/metaverse/index.html?test=1");
  await expect
    .poll(() => page.evaluate(() => window.__METAVERSE__?.ready))
    .toBe(true);

  for (const yaw of [Math.PI / 4, -Math.PI / 4, Math.PI / 2, -Math.PI / 2]) {
    for (const direction of ["forward", "right"] as const) {
      const result = await page.evaluate(({ yaw, direction }) => {
        const g = window.__METAVERSE__;
        g.reset();
        g.setLook(yaw);
        g.advance(0.2);
        const camera = g.inspectRenderer()!.camera;
        const forwardX = camera.target[0]! - camera.position[0]!;
        const forwardZ = camera.target[2]! - camera.position[2]!;
        const length = Math.hypot(forwardX, forwardZ);
        // Project the rendered camera's forward and right directions onto the ground.
        const axis =
          direction === "forward"
            ? { x: forwardX / length, z: forwardZ / length }
            : { x: -forwardZ / length, z: forwardX / length };
        const before = g.snapshot()!.avatar.position;
        g.setMove(
          direction === "right" ? 1 : 0,
          direction === "forward" ? -1 : 0,
        );
        g.advance(0.5);
        const after = g.snapshot()!.avatar;
        return {
          axis,
          displacement: {
            x: after.position.x - before.x,
            z: after.position.z - before.z,
          },
          facing: after.facing,
        };
      }, { yaw, direction });
      const context = `${direction} at yaw ${yaw}`;
      expect(result.displacement.x, context).toBeCloseTo(result.axis.x * 1.2, 3);
      expect(result.displacement.z, context).toBeCloseTo(result.axis.z * 1.2, 3);
      expect(Math.sin(result.facing), context).toBeCloseTo(result.axis.x, 5);
      expect(Math.cos(result.facing), context).toBeCloseTo(result.axis.z, 5);
    }
  }

  expect(await page.evaluate(() => window.__METAVERSE__.errors())).toEqual([]);
  await page.evaluate(() => window.__METAVERSE__.dispose());
  expect(errors).toEqual([]);
});

test("normal host supports camera drag, restart and clean leave", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/showcases/metaverse/index.html");
  await expect
    .poll(() => page.evaluate(() => window.__METAVERSE__?.ready))
    .toBe(true);
  await page.getByRole("button", { name: "Enter the court" }).click();
  await page.keyboard.down("KeyW");
  await expect
    .poll(() =>
      page.evaluate(() => window.__METAVERSE__.snapshot()?.avatar.position.z),
    )
    .toBeLessThan(4.8);
  await page.keyboard.up("KeyW");
  await page.mouse.move(700, 400);
  await page.mouse.down();
  await page.mouse.move(800, 400, { steps: 4 });
  await page.mouse.up();
  await expect
    .poll(() =>
      page.evaluate(() => window.__METAVERSE__.snapshot()?.camera.yaw),
    )
    .not.toBe(0);
  await page.getByRole("button", { name: "Restart", exact: true }).click();
  expect(
    await page.evaluate(
      () => window.__METAVERSE__.snapshot()?.interaction.active,
    ),
  ).toBe(false);
  await page.getByRole("button", { name: "Leave", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() => window.__METAVERSE__.inspectLeaks().game?.lifecycle),
    )
    .toBe("stopped");
  expect(
    await page.evaluate(() => window.__METAVERSE__.inspectLeaks()),
  ).toMatchObject({ hostListeners: 0, rafActive: false });
  expect(errors).toEqual([]);
});

test("failed asset intake reports the error and releases host ownership", async ({
  page,
}) => {
  await page.route("**/assets/visitor.glb", (route) =>
    route.fulfill({ status: 404, body: "Missing model" }),
  );
  await page.goto("/showcases/metaverse/index.html?test=1");
  await expect
    .poll(() =>
      page.evaluate(() => window.__METAVERSE__?.inspectLeaks().hostDisposed),
    )
    .toBe(true);
  await expect(page.locator("#status")).toContainText(
    "Unable to enter the court",
  );
  const state = await page.evaluate(() => ({
    ready: window.__METAVERSE__.ready,
    errors: window.__METAVERSE__.errors(),
    assets: window.__METAVERSE__.inspectAssets(),
    leaks: window.__METAVERSE__.inspectLeaks(),
  }));
  expect(state.ready).toBe(false);
  expect(state.errors).toHaveLength(1);
  expect(state.assets).toMatchObject({
    disposed: true,
    cachedIds: [],
    inFlightIds: [],
  });
  expect(state.leaks).toMatchObject({ hostListeners: 0, rafActive: false });
});

test("dispose during pending model load fences late completion", async ({
  page,
}) => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/assets/*.glb", async (route) => {
    await pending;
    await route.continue();
  });
  await page.goto("/showcases/metaverse/index.html?test=1");
  await expect
    .poll(() =>
      page.evaluate(
        () => window.__METAVERSE__?.inspectAssets().inFlightIds.length,
      ),
    )
    .toBe(2);
  await page.evaluate(() => window.__METAVERSE__.dispose());
  release();
  await expect
    .poll(() =>
      page.evaluate(
        () => window.__METAVERSE__.inspectAssets().inFlightIds.length,
      ),
    )
    .toBe(0);
  expect(
    await page.evaluate(() => window.__METAVERSE__.inspectAssets()),
  ).toMatchObject({ disposed: true, cachedIds: [] });
  expect(
    await page.evaluate(() => window.__METAVERSE__.inspectLeaks()),
  ).toMatchObject({
    hostDisposed: true,
    hostListeners: 0,
    rafActive: false,
    game: null,
  });
  expect(await page.evaluate(() => window.__METAVERSE__.errors())).toEqual([]);
});
