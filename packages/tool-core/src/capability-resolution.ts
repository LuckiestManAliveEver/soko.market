export type CapabilityExecutionMode =
  | "internal"
  | "native_agent"
  | "mcp"
  | "api"
  | "installed_integration"
  | "computer_use"
  | "unsupported";

export interface CapabilityAvailability {
  internal?: boolean;
  nativeAgent?: boolean;
  mcp?: boolean;
  api?: boolean;
  installedIntegration?: boolean;
  authorizedSurface?: boolean;
}

export interface CapabilityResolution {
  executionMode: CapabilityExecutionMode;
  reason: string;
  considered: CapabilityExecutionMode[];
}

const preferredRoutes: Array<{
  mode: Exclude<CapabilityExecutionMode, "computer_use" | "unsupported">;
  key: Exclude<keyof CapabilityAvailability, "authorizedSurface">;
}> = [
  { mode: "internal", key: "internal" },
  { mode: "native_agent", key: "nativeAgent" },
  { mode: "mcp", key: "mcp" },
  { mode: "api", key: "api" },
  { mode: "installed_integration", key: "installedIntegration" }
];

/** Resolves the most deterministic authorized route. Computer use is selected only when every
 * programmatic route is unavailable and an authorized UI surface exists. */
export function resolveCapabilityRoute(availability: CapabilityAvailability): CapabilityResolution {
  const considered: CapabilityExecutionMode[] = [];
  for (const route of preferredRoutes) {
    considered.push(route.mode);
    if (availability[route.key] === true) {
      return {
        executionMode: route.mode,
        reason: `${route.mode} capability is available and preferred over UI automation.`,
        considered
      };
    }
  }
  considered.push("computer_use");
  if (availability.authorizedSurface === true) {
    return {
      executionMode: "computer_use",
      reason: "No equivalent programmatic capability is available; using an authorized UI surface.",
      considered
    };
  }
  considered.push("unsupported");
  return {
    executionMode: "unsupported",
    reason: "No internal, programmatic, installed, or authorized UI capability is available.",
    considered
  };
}
