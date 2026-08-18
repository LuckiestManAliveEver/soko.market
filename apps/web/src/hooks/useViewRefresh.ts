import { useRef } from "react";

type RefreshFn = (businessId: string) => Promise<void>;

interface RefreshRegistration {
  views: readonly string[];
  fn: RefreshFn;
}

export function useViewRefreshRegistry() {
  // Keyed by domain, not appended as a list - registerRefresh is called on every render (so each
  // domain hook's `fn` always closes over its latest deps), and a plain array push would grow
  // unboundedly across renders instead of replacing the previous registration.
  const registry = useRef(new Map<string, RefreshRegistration>());

  function registerRefresh(domainKey: string, views: readonly string[], fn: RefreshFn) {
    registry.current.set(domainKey, { views, fn });
  }

  function refreshersFor(view: string): RefreshFn[] {
    const matches: RefreshFn[] = [];
    for (const registration of registry.current.values()) {
      if (registration.views.includes(view)) matches.push(registration.fn);
    }
    return matches;
  }

  return { registerRefresh, refreshersFor };
}
