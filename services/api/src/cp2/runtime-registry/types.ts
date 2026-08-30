import type {
  RuntimeRegistryContext,
  RuntimeRegistryProviderId,
  RuntimeRegistryResourceDetails,
  RuntimeRegistryResourceRef,
  RuntimeRegistrySearchItem,
  RuntimeRegistrySearchQuery
} from "@soko/shared-types";

/**
 * One normalized, read-only view onto a runtime-asset source (Soko's own catalog, GitHub, Hugging
 * Face). `search` must stay metadata-only -- it must never download a model artifact or repository
 * source file merely to produce a result list. `inspect` may read a little more (a README excerpt, a
 * root file listing, a small manifest file) but must never fetch anything as executable code; see
 * runtime-registry/harness-manifest.ts for the hard boundary that governs harness inspection
 * specifically.
 */
export interface RuntimeRegistryAdapter {
  readonly id: RuntimeRegistryProviderId;
  readonly displayName: string;
  search(
    query: RuntimeRegistrySearchQuery,
    context: RuntimeRegistryContext
  ): Promise<RuntimeRegistrySearchItem[]>;
  inspect(
    ref: RuntimeRegistryResourceRef,
    context: RuntimeRegistryContext
  ): Promise<RuntimeRegistryResourceDetails>;
}

export class RuntimeRegistryResourceNotFoundError extends Error {
  constructor(ref: RuntimeRegistryResourceRef) {
    super(
      `Runtime registry resource ${ref.provider}:${ref.kind}:${ref.externalId} was not found.`
    );
    this.name = "RuntimeRegistryResourceNotFoundError";
  }
}
