export const INJECTOR_ALGORITHM = "xorshift32-v1" as const;

export const MessageDirection = {
  ClientToServer: "c2s",
  ServerToClient: "s2c",
} as const;

export type MessageDirection =
  (typeof MessageDirection)[keyof typeof MessageDirection];

export interface InjectorProfile {
  readonly seed: number;
  readonly baseRoundTripDelayMs: number;
  readonly jitterMinMs: number;
  readonly jitterMaxMs: number;
  readonly dropRate: number;
}

export interface ScheduledMessage {
  readonly algorithm: typeof INJECTOR_ALGORITHM;
  readonly connectionOrdinal: number;
  readonly direction: MessageDirection;
  readonly messageOrdinal: number;
  readonly enqueueTimeMs: number;
  readonly scheduledDelayMs: number;
  readonly jitterMs: number;
  readonly dueTimeMs: number;
  readonly dropDraw: number;
  readonly dropped: boolean;
}

type Delivery = {
  readonly schedule: ScheduledMessage;
  readonly callback: () => void;
};

type RouteState = {
  randomState: number;
  nextMessageOrdinal: number;
};

const UINT32_RANGE = 0x1_0000_0000;
const CONNECTION_MIX = 0x9e3779b9;
const ZERO_STATE_REPLACEMENT = 0x6d2b79f5;

const DIRECTION_SALTS: Readonly<Record<MessageDirection, number>> = {
  [MessageDirection.ClientToServer]: 0xa341316c,
  [MessageDirection.ServerToClient]: 0xc8013ea4,
};

function assertFiniteNonNegative(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be finite and non-negative`);
  }
}

function validateProfile(profile: InjectorProfile): void {
  if (!Number.isInteger(profile.seed) || profile.seed <= 0 || profile.seed > 0xffffffff) {
    throw new RangeError("seed must be a nonzero unsigned 32-bit integer");
  }

  assertFiniteNonNegative(
    profile.baseRoundTripDelayMs,
    "baseRoundTripDelayMs",
  );

  if (!Number.isSafeInteger(profile.jitterMinMs) || profile.jitterMinMs < 0) {
    throw new RangeError("jitterMinMs must be a non-negative safe integer");
  }
  if (!Number.isSafeInteger(profile.jitterMaxMs) || profile.jitterMaxMs < 0) {
    throw new RangeError("jitterMaxMs must be a non-negative safe integer");
  }
  if (profile.jitterMaxMs < profile.jitterMinMs) {
    throw new RangeError("jitterMaxMs must be at least jitterMinMs");
  }
  if (!Number.isFinite(profile.dropRate) || profile.dropRate < 0 || profile.dropRate > 1) {
    throw new RangeError("dropRate must be between zero and one");
  }

  const jitterSpan = profile.jitterMaxMs - profile.jitterMinMs + 1;
  if (!Number.isSafeInteger(jitterSpan)) {
    throw new RangeError("inclusive jitter range is too large");
  }
}

function compareDeliveries(left: Delivery, right: Delivery): number {
  const leftSchedule = left.schedule;
  const rightSchedule = right.schedule;

  return (
    leftSchedule.dueTimeMs - rightSchedule.dueTimeMs ||
    leftSchedule.connectionOrdinal - rightSchedule.connectionOrdinal ||
    directionOrder(leftSchedule.direction) -
      directionOrder(rightSchedule.direction) ||
    leftSchedule.messageOrdinal - rightSchedule.messageOrdinal
  );
}

function directionOrder(direction: MessageDirection): number {
  return direction === MessageDirection.ClientToServer ? 0 : 1;
}

export class DeterministicMessageInjector {
  readonly profile: Readonly<InjectorProfile>;

  #nowMs = 0;
  #shutdown = false;
  #routes = new Map<string, RouteState>();
  #pending: Delivery[] = [];
  #schedule: ScheduledMessage[] = [];

  constructor(profile: InjectorProfile) {
    validateProfile(profile);
    this.profile = Object.freeze({ ...profile });
  }

  get nowMs(): number {
    return this.#nowMs;
  }

  get pendingCount(): number {
    return this.#pending.length;
  }

  get nextDueTimeMs(): number | null {
    if (this.#pending.length === 0) {
      return null;
    }

    let next = this.#pending[0];
    for (const candidate of this.#pending.slice(1)) {
      if (compareDeliveries(candidate, next) < 0) next = candidate;
    }
    return next.schedule.dueTimeMs;
  }

  get isShutdown(): boolean {
    return this.#shutdown;
  }

  getSchedule(): readonly ScheduledMessage[] {
    return Object.freeze([...this.#schedule]);
  }

  enqueue(
    connectionOrdinal: number,
    direction: MessageDirection,
    callback: () => void,
  ): ScheduledMessage {
    if (this.#shutdown) {
      throw new Error("deterministic message injector is shut down");
    }
    if (!Number.isSafeInteger(connectionOrdinal) || connectionOrdinal <= 0) {
      throw new RangeError("connectionOrdinal must be a positive safe integer");
    }
    if (!(direction in DIRECTION_SALTS)) {
      throw new TypeError("direction must be c2s or s2c");
    }
    if (typeof callback !== "function") {
      throw new TypeError("callback must be a function");
    }

    const route = this.#route(connectionOrdinal, direction);
    const messageOrdinal = route.nextMessageOrdinal++;
    const jitterDraw = this.#draw(route);
    const dropDrawUint32 = this.#draw(route);
    const jitterSpan =
      this.profile.jitterMaxMs - this.profile.jitterMinMs + 1;
    const jitterMs =
      this.profile.jitterMinMs +
      Math.floor((jitterDraw / UINT32_RANGE) * jitterSpan);
    const scheduledDelayMs =
      this.profile.baseRoundTripDelayMs / 2 + jitterMs;
    const dropDraw = dropDrawUint32 / UINT32_RANGE;
    const schedule = Object.freeze({
      algorithm: INJECTOR_ALGORITHM,
      connectionOrdinal,
      direction,
      messageOrdinal,
      enqueueTimeMs: this.#nowMs,
      scheduledDelayMs,
      jitterMs,
      dueTimeMs: this.#nowMs + scheduledDelayMs,
      dropDraw,
      dropped: dropDraw < this.profile.dropRate,
    });

    this.#schedule.push(schedule);
    if (!schedule.dropped) {
      this.#pending.push({ schedule, callback });
    }

    return schedule;
  }

  advanceTo(targetMs: number): void {
    assertFiniteNonNegative(targetMs, "targetMs");
    if (targetMs < this.#nowMs) {
      throw new RangeError("targetMs cannot move time backwards");
    }

    while (true) {
      let nextIndex = -1;

      for (let index = 0; index < this.#pending.length; index += 1) {
        const candidate = this.#pending[index];
        if (candidate.schedule.dueTimeMs > targetMs) {
          continue;
        }
        if (
          nextIndex === -1 ||
          compareDeliveries(candidate, this.#pending[nextIndex]) < 0
        ) {
          nextIndex = index;
        }
      }

      if (nextIndex === -1) {
        break;
      }

      const [next] = this.#pending.splice(nextIndex, 1);
      this.#nowMs = next.schedule.dueTimeMs;
      next.callback();
    }

    this.#nowMs = targetMs;
  }

  releaseConnection(connectionOrdinal: number): number {
    if (!Number.isSafeInteger(connectionOrdinal) || connectionOrdinal <= 0) {
      throw new RangeError("connectionOrdinal must be a positive safe integer");
    }

    const selected = this.#pending
      .filter(
        (delivery) =>
          delivery.schedule.connectionOrdinal === connectionOrdinal,
      )
      .sort(compareDeliveries);

    let released = 0;
    for (const delivery of selected) {
      const pendingIndex = this.#pending.indexOf(delivery);
      if (pendingIndex === -1) {
        continue;
      }

      this.#pending.splice(pendingIndex, 1);
      this.#nowMs = Math.max(this.#nowMs, delivery.schedule.dueTimeMs);
      released += 1;
      delivery.callback();
    }

    return released;
  }

  shutdown(): void {
    if (this.#shutdown) {
      return;
    }

    this.#shutdown = true;
    this.#pending.length = 0;
    this.#routes.clear();
  }

  #route(
    connectionOrdinal: number,
    direction: MessageDirection,
  ): RouteState {
    const routeKey = `${connectionOrdinal}:${direction}`;
    const existing = this.#routes.get(routeKey);
    if (existing !== undefined) {
      return existing;
    }

    let randomState = (
      this.profile.seed ^
      Math.imul(connectionOrdinal, CONNECTION_MIX) ^
      DIRECTION_SALTS[direction]
    ) >>> 0;
    if (randomState === 0) {
      randomState = ZERO_STATE_REPLACEMENT;
    }

    const route = { randomState, nextMessageOrdinal: 1 };
    this.#routes.set(routeKey, route);
    return route;
  }

  #draw(route: RouteState): number {
    let value = route.randomState;
    value = (value ^ (value << 13)) >>> 0;
    value = (value ^ (value >>> 17)) >>> 0;
    value = (value ^ (value << 5)) >>> 0;
    route.randomState = value;
    return value;
  }
}
