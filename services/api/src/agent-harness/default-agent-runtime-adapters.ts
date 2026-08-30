import { AgentRuntimeAdapterRegistry } from "./agent-runtime-adapter.js";
import { createPiAgentRuntimeAdapter } from "./pi-agent-runtime-adapter.js";
import { createSokoAgentRuntimeAdapter } from "./soko-agent-runtime-adapter.js";

export function createDefaultAgentRuntimeAdapterRegistry(): AgentRuntimeAdapterRegistry {
  return new AgentRuntimeAdapterRegistry()
    .register(createSokoAgentRuntimeAdapter())
    .register(createPiAgentRuntimeAdapter());
}
