/** Slot-precise item containers with stacking, splitting and tool damage. Authority-neutral. */
import { itemByKey } from "./items.js";

export interface Stack { readonly key: string; readonly count: number; readonly damage: number; }
export type SlotValue = Stack | null;

export function stack(key: string, count: number, damage = 0): Stack {
  return Object.freeze({ key, count, damage });
}

export function maxStack(key: string): number {
  return itemByKey(key)?.maxStack ?? 64;
}

export function sameItem(a: SlotValue, b: SlotValue): boolean {
  return a !== null && b !== null && a.key === b.key && a.damage === b.damage;
}

export class Container {
  readonly slots: SlotValue[];

  constructor(readonly size: number) {
    this.slots = new Array<SlotValue>(size).fill(null);
  }

  get(index: number): SlotValue {
    return this.slots[index] ?? null;
  }

  set(index: number, value: SlotValue): void {
    if (index < 0 || index >= this.size) return;
    this.slots[index] = value !== null && value.count <= 0 ? null : value;
  }

  clear(): void {
    this.slots.fill(null);
  }

  count(key: string): number {
    let total = 0;
    for (const slot of this.slots) if (slot !== null && slot.key === key) total += slot.count;
    return total;
  }

  isEmpty(): boolean {
    return this.slots.every((slot) => slot === null);
  }

  /** Adds items, filling matching stacks first (scanning `preferred` indices first), then empty slots. Returns the leftover count. */
  add(key: string, count: number, preferred: readonly number[] = [], damage = 0): number {
    const limit = maxStack(key);
    let remaining = count;
    const order = [...preferred, ...this.slots.map((_, index) => index).filter((index) => !preferred.includes(index))];
    if (limit > 1) for (const index of order) {
      const slot = this.slots[index] ?? null;
      if (remaining <= 0) break;
      if (slot === null || slot.key !== key || slot.damage !== damage || slot.count >= limit) continue;
      const moved = Math.min(limit - slot.count, remaining);
      this.slots[index] = stack(key, slot.count + moved, damage);
      remaining -= moved;
    }
    for (const index of order) {
      if (remaining <= 0) break;
      if ((this.slots[index] ?? null) !== null) continue;
      const moved = Math.min(limit, remaining);
      this.slots[index] = stack(key, moved, damage);
      remaining -= moved;
    }
    return remaining;
  }

  /** Removes up to `count` of an item anywhere in the container; returns the number removed. */
  remove(key: string, count: number): number {
    let remaining = count;
    for (let index = this.size - 1; index >= 0 && remaining > 0; index -= 1) {
      const slot = this.slots[index] ?? null;
      if (slot === null || slot.key !== key) continue;
      const moved = Math.min(slot.count, remaining);
      this.slots[index] = moved === slot.count ? null : stack(slot.key, slot.count - moved, slot.damage);
      remaining -= moved;
    }
    return count - remaining;
  }

  /** Consumes items from a specific slot. */
  take(index: number, count: number): number {
    const slot = this.get(index);
    if (slot === null) return 0;
    const moved = Math.min(slot.count, count);
    this.set(index, moved === slot.count ? null : stack(slot.key, slot.count - moved, slot.damage));
    return moved;
  }

  snapshot(): readonly SlotValue[] {
    return Object.freeze(this.slots.map((slot) => slot));
  }

  serialize(): (readonly [number, string, number, number])[] {
    const result: (readonly [number, string, number, number])[] = [];
    this.slots.forEach((slot, index) => { if (slot !== null) result.push([index, slot.key, slot.count, slot.damage]); });
    return result;
  }

  restore(entries: unknown): void {
    this.clear();
    if (!Array.isArray(entries)) return;
    for (const entry of entries) {
      if (!Array.isArray(entry) || typeof entry[0] !== "number" || typeof entry[1] !== "string" || typeof entry[2] !== "number") continue;
      if (itemByKey(entry[1]) === undefined || entry[0] < 0 || entry[0] >= this.size || entry[2] <= 0) continue;
      this.slots[entry[0]] = stack(entry[1], Math.min(maxStack(entry[1]), Math.floor(entry[2])), typeof entry[3] === "number" ? Math.max(0, Math.floor(entry[3])) : 0);
    }
  }
}

/**
 * Minecraft-style click semantics between a cursor stack and a container slot.
 * Left: pick up all / put down all / merge / swap. Right: pick up half / put down one.
 */
export function clickSlot(container: Container, index: number, cursor: SlotValue, button: "left" | "right", acceptsInput = true): SlotValue {
  const slot = container.get(index);
  if (cursor === null) {
    if (slot === null) return null;
    if (button === "left") { container.set(index, null); return slot; }
    const half = Math.ceil(slot.count / 2);
    container.set(index, slot.count - half <= 0 ? null : stack(slot.key, slot.count - half, slot.damage));
    return stack(slot.key, half, slot.damage);
  }
  if (!acceptsInput) return cursor;
  const limit = maxStack(cursor.key);
  if (slot === null) {
    const moved = button === "left" ? cursor.count : 1;
    container.set(index, stack(cursor.key, moved, cursor.damage));
    return cursor.count - moved <= 0 ? null : stack(cursor.key, cursor.count - moved, cursor.damage);
  }
  if (sameItem(slot, cursor)) {
    const moved = Math.min(limit - slot.count, button === "left" ? cursor.count : 1);
    if (moved <= 0) return cursor;
    container.set(index, stack(slot.key, slot.count + moved, slot.damage));
    return cursor.count - moved <= 0 ? null : stack(cursor.key, cursor.count - moved, cursor.damage);
  }
  if (button === "left") { container.set(index, cursor); return slot; }
  return cursor;
}

/** Moves a whole stack into another container (shift-click). Returns what could not be moved. */
export function transferStack(from: Container, index: number, to: Container, preferred: readonly number[] = []): SlotValue {
  const slot = from.get(index);
  if (slot === null) return null;
  const leftover = to.add(slot.key, slot.count, preferred, slot.damage);
  from.set(index, leftover <= 0 ? null : stack(slot.key, leftover, slot.damage));
  return leftover <= 0 ? null : stack(slot.key, leftover, slot.damage);
}

/** Applies one point of wear to a tool stack; returns null when it breaks. */
export function wearTool(slot: SlotValue): SlotValue {
  if (slot === null) return null;
  const item = itemByKey(slot.key);
  if (item?.tool === null || item === undefined) return slot;
  const damage = slot.damage + 1;
  return damage >= item.tool.durability ? null : stack(slot.key, slot.count, damage);
}
