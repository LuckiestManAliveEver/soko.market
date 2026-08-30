import type {
  AgentDefinition,
  AgentRuntimeAdapterDescriptor,
  AiModelSummary
} from "@soko/shared-types";
import type {
  RuntimeRegistryResourceDetails,
  RuntimeRegistryResourceRef,
  RuntimeRegistrySearchItem,
  RuntimeRegistrySearchQuery
} from "@soko/shared-types";
import { RuntimeRegistryResourceNotFoundError, type RuntimeRegistryAdapter } from "./types.js";

/**
 * Constructor-injected dependencies, following the AgentRuntimeDomainDeps DI pattern used in
 * services/api/src/cp2/domains/agent-runtime/domain-deps.ts: the adapter never reaches into
 * Cp2Store internals directly, it only receives the read functions it needs. A deployment wires
 * this to `store.listModelCatalog`, `store.listAgentCatalog`, `store.listAgentRuntimeAdapters`
 * (all already public methods on services/api/src/cp2/store.ts's Cp2Store).
 */
export interface SokoCatalogRegistryAdapterDeps {
  listModels: () => AiModelSummary[];
  listAgents: () => AgentDefinition[];
  listHarnesses: () => AgentRuntimeAdapterDescriptor[];
}

/**
 * Wraps Soko's own already-registered catalog (cp2_model_catalog / cp2_agent_catalog / the
 * AgentRuntimeAdapterRegistry) behind the RuntimeRegistryAdapter interface. Every item here is
 * already trusted and already imported -- there is no import lifecycle for the `soko` provider,
 * `imported` is always true and `compatibility.status` is always "compatible".
 */
export function createSokoCatalogRegistryAdapter(
  deps: SokoCatalogRegistryAdapterDeps
): RuntimeRegistryAdapter {
  return {
    id: "soko",
    displayName: "Soko catalog",

    async search(query: RuntimeRegistrySearchQuery): Promise<RuntimeRegistrySearchItem[]> {
      const kinds = new Set(query.kinds ?? ["model", "agent", "harness"]);
      const needle = query.query.trim().toLowerCase();
      const items: RuntimeRegistrySearchItem[] = [];

      if (kinds.has("model")) {
        for (const model of deps.listModels()) {
          if (!matches(needle, [model.id, model.label, model.description, ...model.capabilities])) {
            continue;
          }
          items.push(modelToItem(model));
        }
      }
      if (kinds.has("agent")) {
        for (const agent of deps.listAgents()) {
          if (!matches(needle, [agent.id, agent.displayName, agent.description, agent.role])) {
            continue;
          }
          items.push(agentToItem(agent));
        }
      }
      if (kinds.has("harness")) {
        for (const harness of deps.listHarnesses()) {
          if (!matches(needle, [harness.id, harness.displayName, harness.description])) continue;
          items.push(harnessToItem(harness));
        }
      }
      return items;
    },

    async inspect(ref: RuntimeRegistryResourceRef): Promise<RuntimeRegistryResourceDetails> {
      if (ref.kind === "model") {
        const model = deps.listModels().find((candidate) => candidate.id === ref.externalId);
        if (model === undefined) throw new RuntimeRegistryResourceNotFoundError(ref);
        return {
          ...modelToItem(model),
          readmeExcerpt: model.description,
          files: [],
          providerMetadata: { ...model }
        };
      }
      if (ref.kind === "agent") {
        const agent = deps.listAgents().find((candidate) => candidate.id === ref.externalId);
        if (agent === undefined) throw new RuntimeRegistryResourceNotFoundError(ref);
        return {
          ...agentToItem(agent),
          readmeExcerpt: agent.description,
          files: [],
          providerMetadata: { ...agent }
        };
      }
      const harness = deps.listHarnesses().find((candidate) => candidate.id === ref.externalId);
      if (harness === undefined) throw new RuntimeRegistryResourceNotFoundError(ref);
      return {
        ...harnessToItem(harness),
        readmeExcerpt: harness.description,
        files: [],
        providerMetadata: { ...harness }
      };
    }
  };
}

function matches(needle: string, haystack: Array<string | null | undefined>): boolean {
  if (needle.length === 0) return true;
  return haystack.some((value) => (value ?? "").toLowerCase().includes(needle));
}

function modelToItem(model: AiModelSummary): RuntimeRegistrySearchItem {
  return {
    provider: "soko",
    kind: "model",
    externalId: model.id,
    name: model.id,
    displayName: model.label,
    description: model.description,
    owner: null,
    repositoryId: null,
    revision: null,
    stars: null,
    downloads: null,
    updatedAt: null,
    license: model.license,
    verified: true,
    imported: true,
    compatibility: { status: "compatible" }
  };
}

function agentToItem(agent: AgentDefinition): RuntimeRegistrySearchItem {
  return {
    provider: "soko",
    kind: "agent",
    externalId: agent.id,
    name: agent.id,
    displayName: agent.displayName,
    description: agent.description,
    owner: null,
    repositoryId: null,
    revision: null,
    stars: null,
    downloads: null,
    updatedAt: null,
    license: null,
    verified: true,
    imported: true,
    compatibility: { status: "compatible" }
  };
}

function harnessToItem(harness: AgentRuntimeAdapterDescriptor): RuntimeRegistrySearchItem {
  return {
    provider: "soko",
    kind: "harness",
    externalId: harness.id,
    name: harness.id,
    displayName: harness.displayName,
    description: harness.description,
    owner: null,
    repositoryId: null,
    revision: null,
    stars: null,
    downloads: null,
    updatedAt: null,
    license: null,
    verified: true,
    imported: true,
    compatibility: { status: "compatible" }
  };
}
