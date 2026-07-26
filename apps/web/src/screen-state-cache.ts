import type { ShellView } from "./app-shell";

export interface PreservedScreenState {
  scrollX: number;
  scrollY: number;
  updatedAt: number;
}

export interface ScreenStateCache {
  read(view: ShellView): PreservedScreenState | null;
  write(view: ShellView, state: Omit<PreservedScreenState, "updatedAt">): void;
  clear(): void;
  size(): number;
}

export function createScreenStateCache(limit: number): ScreenStateCache {
  const entries = new Map<ShellView, PreservedScreenState>();
  const boundedLimit = Math.max(1, Math.min(8, limit));

  return {
    read(view) {
      const state = entries.get(view) ?? null;
      if (state !== null) {
        entries.delete(view);
        entries.set(view, state);
      }
      return state;
    },
    write(view, state) {
      entries.delete(view);
      entries.set(view, { ...state, updatedAt: Date.now() });
      while (entries.size > boundedLimit) {
        const oldest = entries.keys().next().value as ShellView | undefined;
        if (oldest === undefined) break;
        entries.delete(oldest);
      }
    },
    clear() {
      entries.clear();
    },
    size() {
      return entries.size;
    }
  };
}

export function restoreScreenScroll(cache: ScreenStateCache, view: ShellView): void {
  const state = cache.read(view);
  if (state === null) return;
  requestAnimationFrame(() => window.scrollTo({ left: state.scrollX, top: state.scrollY }));
}
