const recoveryKeyPrefix = "soko.lazy-module-recovery.v1";

export const agentProfileModuleKeys = {
  surface: "agent-profile",
  modelPanel: "agent-model-panel",
  identitySecurityPanel: "identity-security-panel"
} as const;

export interface LazyModuleRecoveryEnvironment {
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  reload: () => void;
}

function browserRecoveryEnvironment(): LazyModuleRecoveryEnvironment {
  return {
    storage: window.sessionStorage,
    reload: () => window.location.reload()
  };
}

function recoveryKey(moduleKey: string): string {
  return `${recoveryKeyPrefix}.${moduleKey}`;
}

export function isLazyModuleLoadError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.name === "ChunkLoadError" ||
    /(?:failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed|loading chunk [\w-]+ failed)/iu.test(
      error.message
    )
  );
}

export function hasPendingLazyModuleRecovery(
  moduleKey: string,
  environment: LazyModuleRecoveryEnvironment = browserRecoveryEnvironment()
): boolean {
  return environment.storage.getItem(recoveryKey(moduleKey)) !== null;
}

export async function loadLazyModuleWithRecovery<T>(
  moduleKey: string,
  load: () => Promise<T>,
  environment: LazyModuleRecoveryEnvironment = browserRecoveryEnvironment()
): Promise<T> {
  try {
    const module = await load();
    environment.storage.removeItem(recoveryKey(moduleKey));
    return module;
  } catch (error) {
    if (isLazyModuleLoadError(error) && !hasPendingLazyModuleRecovery(moduleKey, environment)) {
      environment.storage.setItem(recoveryKey(moduleKey), "pending");
      environment.reload();
    }
    throw error;
  }
}

export function retryLazyModuleLoad(
  moduleKey: string,
  environment: LazyModuleRecoveryEnvironment = browserRecoveryEnvironment()
): void {
  environment.storage.removeItem(recoveryKey(moduleKey));
  environment.reload();
}
