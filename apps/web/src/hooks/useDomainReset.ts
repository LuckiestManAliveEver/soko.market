import { useRef } from "react";

type ResetFn = () => void;

export function useDomainResetRegistry() {
  const registry = useRef(new Map<string, ResetFn>());

  function registerReset(domainKey: string, fn: ResetFn) {
    registry.current.set(domainKey, fn);
  }

  function resetAll() {
    for (const fn of registry.current.values()) fn();
  }

  return { registerReset, resetAll };
}
