import { OfflineError } from "../types.js";
import type { SokoProvider } from "./types.js";
export interface ResolverContext {
  online: boolean;
  offlineModeActive: boolean;
  localAuthorized: boolean;
}
export async function resolveProviderChain(
  op: string,
  providers: SokoProvider[],
  context: ResolverContext
): Promise<SokoProvider[]> {
  const order: SokoProvider["name"][] = context.offlineModeActive ? ["local", "peer"] : ["cloud"];
  const result: SokoProvider[] = [];
  for (const name of order) {
    const provider = providers.find((candidate) => candidate.name === name);
    if (!provider?.supports(op)) continue;
    if (name === "cloud" && !context.online) continue;
    if (name !== "cloud" && !context.localAuthorized) continue;
    if (await provider.isAvailable()) result.push(provider);
  }
  return result;
}
export async function executeProviderCall<T>(
  op: string,
  args: unknown,
  providers: SokoProvider[],
  context: ResolverContext
): Promise<T> {
  const chain = await resolveProviderChain(op, providers, context);
  for (const provider of chain) {
    try {
      return await provider.call<T>(op, args);
    } catch (error) {
      // Only a known pre-dispatch capability failure is safe to fall through. A timeout on a
      // mutation may already have committed, and auth/validation failures are never bypassed.
      if (!(error instanceof OfflineError) || error.code !== "PROVIDER_UNAVAILABLE") throw error;
    }
  }
  throw new OfflineError(
    "OPERATION_UNAVAILABLE",
    "This action is unavailable offline. Go back online from Settings to continue."
  );
}
