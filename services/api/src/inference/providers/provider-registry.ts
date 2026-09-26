import { createAnthropicProvider } from "./anthropic-provider.js";
import type { InferenceProvider } from "./contract.js";
import { createLocalInferenceProvider } from "./local-provider.js";
import {
  createOpenAiCompatibleProvider,
  createOpenAiProvider,
  createZaiProvider,
  type ProviderAdapterDeps
} from "./openai-compatible-provider.js";
import type {
  InferenceProviderConfig,
  InferenceProviderType,
  InferenceProviderView
} from "./provider-config.js";
import type { ProviderConfigRepository } from "./repositories.js";

type ProviderFactory = (
  config: InferenceProviderConfig,
  deps: ProviderAdapterDeps
) => InferenceProvider;

/**
 * The single place a provider *type* maps to an adapter implementation. Adding a vendor means one
 * adapter file plus one entry here; adding another OpenAI-compatible host means only a
 * configuration row (type "openai-compatible") - no code at all.
 */
const providerFactories: Record<InferenceProviderType, ProviderFactory> = {
  openai: createOpenAiProvider,
  anthropic: createAnthropicProvider,
  zai: createZaiProvider,
  "openai-compatible": createOpenAiCompatibleProvider,
  local: (config) => createLocalInferenceProvider(config)
};

export interface RegisteredProvider {
  config: InferenceProviderConfig;
  provider: InferenceProvider;
}

/**
 * Configured provider instances. Merge order: built-in defaults < database rows
 * (inference_providers) < environment. The environment wins for base URLs and managed credential
 * references because it is the deployment's own statement of where its infrastructure lives.
 */
export class InferenceProviderRegistry {
  private entries = new Map<string, RegisteredProvider>();

  constructor(
    private readonly deps: {
      environmentProviders: readonly InferenceProviderConfig[];
      repository: ProviderConfigRepository;
      adapterDeps: ProviderAdapterDeps;
      /** Tests only: replaces the adapter for an id while keeping its configuration. */
      providerOverrides?: ReadonlyMap<string, InferenceProvider>;
    }
  ) {
    this.install(deps.environmentProviders);
  }

  /** Reloads database rows. Safe to call periodically; failures keep the last good set. */
  async refresh(): Promise<void> {
    const databaseRows = await this.deps.repository.list();
    this.install(mergeProviderConfigs(this.deps.environmentProviders, databaseRows));
  }

  get(providerId: string): RegisteredProvider | undefined {
    return this.entries.get(providerId);
  }

  list(): RegisteredProvider[] {
    return [...this.entries.values()];
  }

  views(): InferenceProviderView[] {
    return this.list().map(({ config }) => ({
      id: config.id,
      displayName: config.displayName,
      type: config.type,
      executionTarget: config.executionTarget,
      enabled: config.enabled,
      managedCredentialConfigured: config.credentialRef !== null,
      byokAllowed: config.byokAllowed,
      allowCredentialEndpoint: config.allowCredentialEndpoint,
      billingProduct: config.billingProduct
    }));
  }

  private install(configs: readonly InferenceProviderConfig[]): void {
    const next = new Map<string, RegisteredProvider>();
    for (const config of configs) {
      const override = this.deps.providerOverrides?.get(config.id);
      next.set(config.id, {
        config,
        provider: override ?? providerFactories[config.type](config, this.deps.adapterDeps)
      });
    }
    this.entries = next;
  }
}

export function mergeProviderConfigs(
  environmentProviders: readonly InferenceProviderConfig[],
  databaseRows: readonly InferenceProviderConfig[]
): InferenceProviderConfig[] {
  const merged = new Map<string, InferenceProviderConfig>();
  for (const config of environmentProviders) merged.set(config.id, config);
  for (const row of databaseRows) {
    const existing = merged.get(row.id);
    if (existing === undefined) {
      merged.set(row.id, row);
      continue;
    }
    merged.set(row.id, {
      ...existing,
      ...row,
      // Environment-owned facts stay authoritative for environment-configured providers.
      ...(existing.source === "environment"
        ? { baseUrl: existing.baseUrl, credentialRef: existing.credentialRef ?? row.credentialRef }
        : {}),
      type: existing.type,
      source: existing.source === "environment" ? "environment" : "database"
    });
  }
  return [...merged.values()];
}
