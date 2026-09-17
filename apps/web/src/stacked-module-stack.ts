// Tracks which StackedModule instances are open and which one owns keyboard input (Tab/Escape),
// for the case where more than one ends up open at once - e.g. the Workspace dialog stays open
// across a viewport resize that also turns the compact-viewport conversation inbox into its own
// StackedModule (ChatSurface.tsx's isCompactViewport branch). "Topmost" is decided by real focus,
// not just mount order: a module that mounts while the user's focus is already inside a different
// open module (as happens on that resize - Messages appears silently, the user is still looking at
// Workspace) must not steal focus or Tab/Escape ownership away from where the user actually is. It
// only becomes topmost once something inside it is genuinely focused (see promoteStackedModule).
interface OpenStackedModuleEntry {
  moduleId: string;
  getPanel: () => HTMLElement | null;
}

const openModules: OpenStackedModuleEntry[] = [];
let topmostModuleId: string | null = null;

// styles.css gives every .stacked-module-backdrop the same base z-index (40), so with two open at
// once the one that happens to be later in DOM/mount order paints on top regardless of which one
// actually owns keyboard focus - e.g. the conversation inbox silently appearing on a resize would
// visually cover the Workspace dialog the user is still using, blocking clicks into it. Each
// promotion (see promoteStackedModule) hands out a new, strictly higher value so the module that's
// actually topmost for focus is also the one painted on top; nothing needs to lower anyone else's.
let nextPromotedZIndex = 41;

export function registerStackedModule(moduleId: string, getPanel: () => HTMLElement | null): void {
  openModules.push({ moduleId, getPanel });
}

export function unregisterStackedModule(moduleId: string): void {
  const index = openModules.findIndex((entry) => entry.moduleId === moduleId);
  if (index !== -1) openModules.splice(index, 1);
  if (topmostModuleId === moduleId) {
    topmostModuleId = openModules.at(-1)?.moduleId ?? null;
  }
}

export function promoteStackedModule(moduleId: string): number {
  topmostModuleId = moduleId;
  return nextPromotedZIndex++;
}

// Promotes and paints the given backdrop on top in one call - the two call sites in
// StackedModule.tsx (initial mount, and a later genuine focus) both need this exact pairing.
export function promoteStackedModuleAndBackdrop(
  moduleId: string,
  backdrop: HTMLElement | null
): void {
  const zIndex = promoteStackedModule(moduleId);
  if (backdrop !== null) backdrop.style.zIndex = String(zIndex);
}

export function isTopmostStackedModule(moduleId: string): boolean {
  return topmostModuleId === moduleId;
}

// Whether some other currently-open module's panel already contains the given element - the
// signal a newly-mounted module uses to decide whether it's safe to steal initial focus.
export function isFocusInsideAnotherStackedModule(
  moduleId: string,
  element: Element | null
): boolean {
  if (element === null) return false;
  return openModules.some(
    (entry) => entry.moduleId !== moduleId && entry.getPanel()?.contains(element) === true
  );
}
