import type { LocalDatabase } from "../db/client.js";
import type { RuntimeBinding, RuntimePin, Scope } from "../types.js";
export function validateBinding(binding: RuntimeBinding): void {
  for (const value of [
    binding.agentId,
    binding.agentVersion,
    binding.modelId,
    binding.modelVersion,
    binding.harnessVersion
  ]) {
    if (typeof value !== "string" || !value.trim())
      throw new Error("Runtime versions must be immutable and explicit.");
  }
  if (!binding.artifacts.length)
    throw new Error("This runtime has no downloadable local artifacts.");
  for (const artifact of binding.artifacts) {
    if (
      !/^[a-f0-9]{64}$/i.test(artifact.sha256) ||
      !Number.isSafeInteger(artifact.bytes) ||
      artifact.bytes <= 0 ||
      new URL(artifact.url).protocol !== "https:"
    )
      throw new Error("Invalid runtime artifact manifest.");
  }
}
export async function pinCurrentRuntime(
  db: LocalDatabase,
  scope: Scope,
  resolve: () => Promise<RuntimeBinding>
): Promise<RuntimePin> {
  const existing = await getActivePin(db, scope);
  if (existing) return existing;
  const binding = await resolve();
  validateBinding(binding);
  return db.transaction(scope, (state) => {
    state.pin ??= {
      ...structuredClone(binding),
      ...scope,
      pinnedAt: new Date().toISOString(),
      explicitSwap: false,
      active: true
    };
    return state.pin;
  });
}
export async function getActivePin(db: LocalDatabase, scope: Scope): Promise<RuntimePin | null> {
  const pin = (await db.read(scope)).pin;
  return pin?.active ? pin : null;
}
export async function swapPinnedRuntime(
  db: LocalDatabase,
  scope: Scope,
  binding: RuntimeBinding,
  install: (binding: RuntimeBinding) => Promise<void>
): Promise<RuntimePin> {
  validateBinding(binding);
  await install(binding);
  return db.transaction(scope, (state) => {
    state.pin = {
      ...structuredClone(binding),
      ...scope,
      pinnedAt: new Date().toISOString(),
      explicitSwap: true,
      active: true
    };
    return state.pin;
  });
}
