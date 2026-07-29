export type CapabilityProfile = "constrained" | "standard" | "high_capacity";

export interface CapabilitySettings {
  profile: CapabilityProfile;
  preservedScreenLimit: number;
  messageWindowSize: number;
  allowNonessentialMotion: boolean;
  allowIdlePrefetch: boolean;
  maxConcurrentHeavyWorkers: number;
}

interface NavigatorCapabilities {
  connection?: {
    effectiveType?: string;
    saveData?: boolean;
  };
  deviceMemory?: number;
  hardwareConcurrency?: number;
}

export function detectCapabilitySettings(): CapabilitySettings {
  const device = navigator as Navigator & NavigatorCapabilities;
  const memory = device.deviceMemory;
  const cores = device.hardwareConcurrency;
  const saveData = device.connection?.saveData === true;
  const slowConnection = ["slow-2g", "2g"].includes(device.connection?.effectiveType ?? "");
  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
  const constrained =
    saveData ||
    slowConnection ||
    (memory !== undefined && memory <= 2) ||
    (cores !== undefined && cores <= 2);
  const highCapacity =
    !constrained && memory !== undefined && memory >= 8 && cores !== undefined && cores >= 8;

  if (constrained) {
    return {
      profile: "constrained",
      preservedScreenLimit: 2,
      messageWindowSize: 40,
      allowNonessentialMotion: false,
      allowIdlePrefetch: false,
      maxConcurrentHeavyWorkers: 1
    };
  }
  if (highCapacity) {
    return {
      profile: "high_capacity",
      preservedScreenLimit: 6,
      messageWindowSize: 120,
      allowNonessentialMotion: !reducedMotion,
      allowIdlePrefetch: true,
      maxConcurrentHeavyWorkers: 2
    };
  }
  return {
    profile: "standard",
    preservedScreenLimit: 4,
    messageWindowSize: 80,
    allowNonessentialMotion: !reducedMotion,
    allowIdlePrefetch: !saveData,
    maxConcurrentHeavyWorkers: 1
  };
}

export function shouldPrefetch(): boolean {
  if (!navigator.onLine) return false;
  const device = navigator as Navigator & NavigatorCapabilities;
  return (
    device.connection?.saveData !== true &&
    !["slow-2g", "2g"].includes(device.connection?.effectiveType ?? "")
  );
}
