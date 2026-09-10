import type { Entity } from "../types.js";
export type ConflictPolicy = "manual" | "server-wins" | "merge" | "last-write-wins";
export type ConflictDecision =
  { resolved: true; entity: Entity | null } | { resolved: false; fields: string[] };
export function resolveConflict(input: {
  policy: ConflictPolicy;
  base: Entity | null;
  local: Entity | null;
  server: Entity | null;
  allowedFields?: string[];
  localServerSequence?: number;
  remoteServerSequence?: number;
}): ConflictDecision {
  if (input.policy === "manual") return { resolved: false, fields: ["manual review"] };
  if (input.policy === "server-wins") return { resolved: true, entity: input.server };
  if (input.policy === "last-write-wins") {
    // Client clocks never authorize a win. This policy needs server-assigned ordering.
    if (input.localServerSequence === undefined || input.remoteServerSequence === undefined)
      return { resolved: false, fields: ["server ordering required"] };
    return {
      resolved: true,
      entity: input.localServerSequence > input.remoteServerSequence ? input.local : input.server
    };
  }
  if (!input.base || !input.local || !input.server)
    return { resolved: false, fields: ["deleted or missing entity"] };
  const merged = { ...input.server };
  const conflicts: string[] = [];
  for (const key of input.allowedFields ?? []) {
    const localChanged = !same(input.local[key], input.base[key]);
    if (!localChanged) continue;
    if (!same(input.server[key], input.base[key]) && !same(input.server[key], input.local[key]))
      conflicts.push(key);
    else merged[key] = input.local[key];
  }
  return conflicts.length
    ? { resolved: false, fields: conflicts }
    : { resolved: true, entity: merged };
}
export function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, canonical(entry)])
    );
  return value;
}
