declare const entityIdBrand: unique symbol;
declare const componentTypeBrand: unique symbol;
declare const resourceTypeBrand: unique symbol;

/** An opaque identity that is meaningful only to the World that created it. */
export type EntityId = Readonly<{
  readonly [entityIdBrand]: "EntityId";
}>;

/** A typed component identity created by defineComponent. */
export interface ComponentType<T> {
  readonly [componentTypeBrand]: T;
}

/** A typed World-scoped resource identity created by defineResource. */
export interface ResourceType<T> {
  readonly [resourceTypeBrand]: T;
}

/** The complete Milestone 1 ECS access boundary. */
export interface World {
  readonly entityCount: number;

  createEntity(): EntityId;
  destroyEntity(entity: EntityId): boolean;

  addComponent<T>(entity: EntityId, type: ComponentType<T>, value: T): void;
  removeComponent<T>(entity: EntityId, type: ComponentType<T>): boolean;
  hasComponent<T>(entity: EntityId, type: ComponentType<T>): boolean;
  getComponent<T>(entity: EntityId, type: ComponentType<T>): T | undefined;

  queryAll(
    type: ComponentType<unknown>,
    ...types: readonly ComponentType<unknown>[]
  ): readonly EntityId[];

  addResource<T>(type: ResourceType<T>, value: T): void;
  removeResource<T>(type: ResourceType<T>): boolean;
  hasResource<T>(type: ResourceType<T>): boolean;
  getResource<T>(type: ResourceType<T>): T | undefined;

  dispose(): void;
}

const componentTypeNames = new WeakMap<object, string>();
const resourceTypeNames = new WeakMap<object, string>();

function createTypeToken(name: string, names: WeakMap<object, string>): object {
  if (typeof name !== "string") {
    throw new TypeError("ECS type names must be strings");
  }

  const token: object = Object.freeze(Object.create(null));
  names.set(token, name);
  return token;
}

/** Defines an identity token. Its name is diagnostic and does not register a schema. */
export function defineComponent<T>(name: string): ComponentType<T> {
  return createTypeToken(name, componentTypeNames) as ComponentType<T>;
}

/** Defines a World-scoped resource identity token. */
export function defineResource<T>(name: string): ResourceType<T> {
  return createTypeToken(name, resourceTypeNames) as ResourceType<T>;
}

interface EntityState {
  readonly creationOrder: number;
  readonly components: Map<object, unknown>;
}

function isObject(value: unknown): value is object {
  return (typeof value === "object" && value !== null) || typeof value === "function";
}

function requireDefinedType(
  value: unknown,
  names: WeakMap<object, string>,
  kind: "component" | "resource",
): object {
  if (!isObject(value) || !names.has(value)) {
    throw new TypeError(`Invalid ${kind} type; use define${kind === "component" ? "Component" : "Resource"}`);
  }
  return value;
}

function diagnosticName(key: object, names: WeakMap<object, string>): string {
  return names.get(key) ?? "<unknown>";
}

class EcsWorld implements World {
  private disposed = false;
  private nextCreationOrder = 1;
  private knownEntities = new WeakSet<object>();
  private readonly entities = new Map<object, EntityState>();
  private readonly resources = new Map<object, unknown>();

  get entityCount(): number {
    return this.entities.size;
  }

  createEntity(): EntityId {
    this.requireActive();
    if (!Number.isSafeInteger(this.nextCreationOrder)) {
      throw new Error("Entity identity space exhausted");
    }

    const entity = Object.freeze(Object.create(null)) as EntityId;
    this.knownEntities.add(entity);
    this.entities.set(entity, {
      creationOrder: this.nextCreationOrder,
      components: new Map<object, unknown>(),
    });
    this.nextCreationOrder += 1;
    return entity;
  }

  destroyEntity(entity: EntityId): boolean {
    this.requireActive();
    const key = this.requireKnownEntity(entity);
    const state = this.entities.get(key);
    if (state === undefined) {
      return false;
    }

    state.components.clear();
    this.entities.delete(key);
    return true;
  }

  addComponent<T>(entity: EntityId, type: ComponentType<T>, value: T): void {
    this.requireActive();
    const component = requireDefinedType(type, componentTypeNames, "component");
    const state = this.entities.get(this.requireKnownEntity(entity));
    if (state === undefined) {
      throw new Error("Cannot add a component to a destroyed entity");
    }
    if (state.components.has(component)) {
      throw new Error(`Component already present: ${diagnosticName(component, componentTypeNames)}`);
    }
    state.components.set(component, value);
  }

  removeComponent<T>(entity: EntityId, type: ComponentType<T>): boolean {
    this.requireActive();
    const component = requireDefinedType(type, componentTypeNames, "component");
    const state = this.entities.get(this.requireKnownEntity(entity));
    return state?.components.delete(component) ?? false;
  }

  hasComponent<T>(entity: EntityId, type: ComponentType<T>): boolean {
    this.requireActive();
    const component = requireDefinedType(type, componentTypeNames, "component");
    const state = this.entities.get(this.requireKnownEntity(entity));
    return state?.components.has(component) ?? false;
  }

  getComponent<T>(entity: EntityId, type: ComponentType<T>): T | undefined {
    this.requireActive();
    const component = requireDefinedType(type, componentTypeNames, "component");
    const state = this.entities.get(this.requireKnownEntity(entity));
    return state?.components.get(component) as T | undefined;
  }

  queryAll(
    type: ComponentType<unknown>,
    ...types: readonly ComponentType<unknown>[]
  ): readonly EntityId[] {
    this.requireActive();
    const required = [type, ...types].map((item) =>
      requireDefinedType(item, componentTypeNames, "component"),
    );
    const matches: Array<{ entity: EntityId; creationOrder: number }> = [];

    for (const [entity, state] of this.entities) {
      if (required.every((component) => state.components.has(component))) {
        matches.push({ entity: entity as EntityId, creationOrder: state.creationOrder });
      }
    }

    matches.sort((left, right) => left.creationOrder - right.creationOrder);
    return Object.freeze(matches.map(({ entity }) => entity));
  }

  addResource<T>(type: ResourceType<T>, value: T): void {
    this.requireActive();
    const resource = requireDefinedType(type, resourceTypeNames, "resource");
    if (this.resources.has(resource)) {
      throw new Error(`Resource already present: ${diagnosticName(resource, resourceTypeNames)}`);
    }
    this.resources.set(resource, value);
  }

  removeResource<T>(type: ResourceType<T>): boolean {
    this.requireActive();
    const resource = requireDefinedType(type, resourceTypeNames, "resource");
    return this.resources.delete(resource);
  }

  hasResource<T>(type: ResourceType<T>): boolean {
    this.requireActive();
    const resource = requireDefinedType(type, resourceTypeNames, "resource");
    return this.resources.has(resource);
  }

  getResource<T>(type: ResourceType<T>): T | undefined {
    this.requireActive();
    const resource = requireDefinedType(type, resourceTypeNames, "resource");
    return this.resources.get(resource) as T | undefined;
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }

    for (const state of this.entities.values()) {
      state.components.clear();
    }
    this.entities.clear();
    this.resources.clear();
    this.knownEntities = new WeakSet<object>();
    this.disposed = true;
  }

  private requireActive(): void {
    if (this.disposed) {
      throw new Error("World has been disposed");
    }
  }

  private requireKnownEntity(entity: EntityId): object {
    if (!isObject(entity) || !this.knownEntities.has(entity)) {
      throw new TypeError("Entity does not belong to this World");
    }
    return entity;
  }
}

/** Creates a fresh, isolated ECS World. */
export function createWorld(): World {
  return new EcsWorld();
}
export * from "./telemetry.js";
export * from "./runtime-scheduling.js";
export * from "./mailbox.js";
export * from "./feature-lifecycle.js";
