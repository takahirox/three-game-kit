import assert from "node:assert/strict";
import test from "node:test";

import {
  createWorld,
  defineComponent,
  defineResource,
} from "@three-game-kit/core";

function assertEntities(actual, expected) {
  assert.equal(actual.length, expected.length);
  for (let index = 0; index < expected.length; index += 1) {
    assert.equal(actual[index], expected[index]);
  }
}

test("component tokens are identity-only and values are stored by reference", () => {
  const PositionA = defineComponent("position");
  const PositionB = defineComponent("position");
  const world = createWorld();
  const entity = world.createEntity();
  const value = { x: 1, y: 2 };

  assert.equal(world.entityCount, 1);
  world.addComponent(entity, PositionA, value);
  assert.equal(world.hasComponent(entity, PositionA), true);
  assert.equal(world.hasComponent(entity, PositionB), false);
  assert.equal(world.getComponent(entity, PositionA), value);
  assert.equal(world.getComponent(entity, PositionB), undefined);
  assert.throws(() => world.addComponent(entity, PositionA, { x: 3 }), /already present/u);

  assert.equal(world.removeComponent(entity, PositionB), false);
  assert.equal(world.removeComponent(entity, PositionA), true);
  assert.equal(world.removeComponent(entity, PositionA), false);
  assert.equal(world.hasComponent(entity, PositionA), false);
  assert.equal(world.getComponent(entity, PositionA), undefined);
});

test("resources are isolated, duplicate-safe, and stored by reference", () => {
  const Settings = defineResource("settings");
  const first = createWorld();
  const second = createWorld();
  const firstValue = { speed: 3 };
  const secondValue = { speed: 7 };

  assert.equal(first.hasResource(Settings), false);
  assert.equal(first.getResource(Settings), undefined);
  assert.equal(first.removeResource(Settings), false);
  first.addResource(Settings, firstValue);
  second.addResource(Settings, secondValue);

  assert.equal(first.getResource(Settings), firstValue);
  assert.equal(second.getResource(Settings), secondValue);
  assert.throws(() => first.addResource(Settings, secondValue), /already present/u);
  assert.equal(first.removeResource(Settings), true);
  assert.equal(first.removeResource(Settings), false);
  assert.equal(first.getResource(Settings), undefined);
  assert.equal(second.getResource(Settings), secondValue);
});

test("entity IDs are opaque, World-local, and isolated across two Worlds", () => {
  const Marker = defineComponent("marker");
  const first = createWorld();
  const second = createWorld();
  const firstEntity = first.createEntity();
  const secondEntity = second.createEntity();

  assert.notEqual(firstEntity, secondEntity);
  first.addComponent(firstEntity, Marker, "first");
  second.addComponent(secondEntity, Marker, "second");
  assert.equal(first.getComponent(firstEntity, Marker), "first");
  assert.equal(second.getComponent(secondEntity, Marker), "second");

  for (const operation of [
    () => first.destroyEntity(secondEntity),
    () => first.addComponent(secondEntity, Marker, "foreign"),
    () => first.removeComponent(secondEntity, Marker),
    () => first.hasComponent(secondEntity, Marker),
    () => first.getComponent(secondEntity, Marker),
  ]) {
    assert.throws(operation, /does not belong/u);
  }

  assert.equal(first.getComponent(firstEntity, Marker), "first");
  assert.equal(second.getComponent(secondEntity, Marker), "second");
});

test("forged entities and forged type tokens are rejected", () => {
  const Marker = defineComponent("marker");
  const Settings = defineResource("settings");
  const world = createWorld();
  const entity = world.createEntity();
  const forgedEntity = Object.freeze(Object.create(null));
  const forgedType = Object.freeze(Object.create(null));

  for (const operation of [
    () => world.destroyEntity(forgedEntity),
    () => world.addComponent(forgedEntity, Marker, true),
    () => world.removeComponent(forgedEntity, Marker),
    () => world.hasComponent(forgedEntity, Marker),
    () => world.getComponent(forgedEntity, Marker),
  ]) {
    assert.throws(operation, /does not belong/u);
  }

  assert.throws(() => world.addComponent(entity, forgedType, true), /Invalid component type/u);
  assert.throws(() => world.queryAll(forgedType), /Invalid component type/u);
  assert.throws(() => world.addResource(forgedType, true), /Invalid resource type/u);
  assert.equal(world.hasResource(Settings), false);
});

test("destroy removes every component, stale operations are harmless, and IDs are never reused", () => {
  const Position = defineComponent("position");
  const Label = defineComponent("label");
  const world = createWorld();
  const first = world.createEntity();
  const position = { x: 1 };
  const label = { text: "first" };

  world.addComponent(first, Position, position);
  world.addComponent(first, Label, label);
  assert.equal(world.destroyEntity(first), true);
  assert.equal(world.entityCount, 0);
  assert.equal(world.hasComponent(first, Position), false);
  assert.equal(world.hasComponent(first, Label), false);
  assert.equal(world.getComponent(first, Position), undefined);
  assert.equal(world.getComponent(first, Label), undefined);
  assert.equal(world.removeComponent(first, Position), false);
  assert.equal(world.destroyEntity(first), false);
  assert.throws(() => world.addComponent(first, Position, position), /destroyed entity/u);

  const second = world.createEntity();
  assert.notEqual(second, first);
  assert.equal(world.entityCount, 1);
  world.addComponent(second, Position, { x: 2 });
  assertEntities(world.queryAll(Position), [second]);
});

test("all-of queries are frozen snapshots in ascending creation order", () => {
  const Position = defineComponent("position");
  const Velocity = defineComponent("velocity");
  const world = createWorld();
  const first = world.createEntity();
  const second = world.createEntity();
  const third = world.createEntity();
  const fourth = world.createEntity();

  world.addComponent(third, Position, { x: 3 });
  world.addComponent(first, Velocity, { x: 1 });
  world.addComponent(fourth, Velocity, { x: 4 });
  world.addComponent(second, Position, { x: 2 });
  world.addComponent(first, Position, { x: 1 });
  world.addComponent(third, Velocity, { x: 3 });

  const positions = world.queryAll(Position);
  const moving = world.queryAll(Position, Velocity);
  assert.equal(Object.isFrozen(positions), true);
  assert.equal(Object.isFrozen(moving), true);
  assertEntities(positions, [first, second, third]);
  assertEntities(moving, [first, third]);
  assertEntities(world.queryAll(Position, Position, Velocity), [first, third]);
  assert.equal(new Set(world.queryAll(Position, Position)).size, 3);
});

test("mutation during iteration preserves the current snapshot and is immediately visible later", () => {
  const Selected = defineComponent("selected");
  const Visible = defineComponent("visible");
  const world = createWorld();
  const first = world.createEntity();
  const second = world.createEntity();
  const third = world.createEntity();
  const initiallyPartial = world.createEntity();

  world.addComponent(first, Selected, true);
  world.addComponent(first, Visible, true);
  world.addComponent(second, Selected, true);
  world.addComponent(second, Visible, true);
  world.addComponent(third, Selected, true);
  world.addComponent(initiallyPartial, Visible, true);

  const snapshot = world.queryAll(Selected, Visible);
  assertEntities(snapshot, [first, second]);
  const visited = [];

  for (const entity of snapshot) {
    visited.push(entity);
    if (entity === first) {
      assert.equal(world.destroyEntity(second), true);
      world.addComponent(third, Visible, true);
      world.addComponent(initiallyPartial, Selected, true);
      const createdDuringIteration = world.createEntity();
      world.addComponent(createdDuringIteration, Selected, true);
      world.addComponent(createdDuringIteration, Visible, true);
    } else {
      assert.equal(world.hasComponent(entity, Selected), false);
      assert.equal(world.getComponent(entity, Visible), undefined);
    }
  }

  assertEntities(visited, [first, second]);
  const later = world.queryAll(Selected, Visible);
  assert.equal(later.length, 4);
  assertEntities(later.slice(0, 3), [first, third, initiallyPartial]);

  const serialObservations = [];
  const earlierSystem = () => world.removeComponent(third, Visible);
  const laterSystem = () => serialObservations.push(world.queryAll(Selected, Visible));
  earlierSystem();
  laterSystem();
  assert.equal(serialObservations.length, 1);
  assert.equal(serialObservations[0].includes(third), false);
});

test("component and resource mutations are synchronously visible", () => {
  const Counter = defineComponent("counter");
  const Clock = defineResource("clock");
  const world = createWorld();
  const entity = world.createEntity();
  const counter = { value: 0 };
  const clock = { tick: 1 };

  world.addComponent(entity, Counter, counter);
  world.addResource(Clock, clock);
  assert.equal(world.getComponent(entity, Counter), counter);
  assert.equal(world.getResource(Clock), clock);
  counter.value = 1;
  clock.tick = 2;
  assert.equal(world.getComponent(entity, Counter).value, 1);
  assert.equal(world.getResource(Clock).tick, 2);
  assert.equal(world.removeComponent(entity, Counter), true);
  assert.equal(world.getComponent(entity, Counter), undefined);
  assert.equal(world.removeResource(Clock), true);
  assert.equal(world.getResource(Clock), undefined);
});

test("cleanup releases every ECS access path without invoking user destructors", () => {
  const Primary = defineComponent("primary");
  const Secondary = defineComponent("secondary");
  const Service = defineResource("service");
  const world = createWorld();
  const first = world.createEntity();
  const destructorCalls = [];
  const primary = { dispose: () => destructorCalls.push("primary") };
  const secondary = { dispose: () => destructorCalls.push("secondary") };
  const service = { dispose: () => destructorCalls.push("service") };

  world.addComponent(first, Primary, primary);
  world.addComponent(first, Secondary, secondary);
  world.addResource(Service, service);
  assert.equal(world.getComponent(first, Primary), primary);
  assert.equal(world.getResource(Service), service);

  assert.equal(world.removeComponent(first, Primary), true);
  assert.equal(world.getComponent(first, Primary), undefined);
  assert.equal(world.destroyEntity(first), true);
  assert.equal(world.getComponent(first, Secondary), undefined);
  assert.equal(world.removeResource(Service), true);
  assert.equal(world.getResource(Service), undefined);
  assert.deepEqual(destructorCalls, []);

  const remaining = world.createEntity();
  world.addComponent(remaining, Secondary, secondary);
  world.addResource(Service, service);
  world.dispose();
  assert.equal(world.entityCount, 0);
  assert.deepEqual(destructorCalls, []);
  world.dispose();
  assert.equal(world.entityCount, 0);
  assert.deepEqual(destructorCalls, []);
});

test("dispose is idempotent and every other post-dispose operation is rejected", () => {
  const Value = defineComponent("value");
  const Shared = defineResource("shared");
  const world = createWorld();
  const entity = world.createEntity();
  world.addComponent(entity, Value, 1);
  world.addResource(Shared, 2);

  world.dispose();
  world.dispose();
  assert.equal(world.entityCount, 0);

  for (const operation of [
    () => world.createEntity(),
    () => world.destroyEntity(entity),
    () => world.addComponent(entity, Value, 3),
    () => world.removeComponent(entity, Value),
    () => world.hasComponent(entity, Value),
    () => world.getComponent(entity, Value),
    () => world.queryAll(Value),
    () => world.addResource(Shared, 3),
    () => world.removeResource(Shared),
    () => world.hasResource(Shared),
    () => world.getResource(Shared),
  ]) {
    assert.throws(operation, /disposed/u);
  }
});
