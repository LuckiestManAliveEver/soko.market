const swipeCloseThresholdPx = 72;

export function shouldCloseStackedModuleFromSwipe(startY: number, endY: number): boolean {
  return endY - startY >= swipeCloseThresholdPx;
}

// Pulled out of StackedModule to keep it under the modularity budget
// (scripts/check-boundaries.mjs). Pure so the Tab-wrap boundary logic is testable on its own.
export function nextFocusTargetForTab(
  focusable: HTMLElement[],
  activeElement: Element | null,
  panel: HTMLElement,
  shiftKey: boolean
): HTMLElement | null {
  if (focusable.length === 0) return panel;
  const first = focusable[0]!;
  const last = focusable[focusable.length - 1]!;
  const escaped = activeElement === panel || !panel.contains(activeElement);
  if (shiftKey) return activeElement === first || escaped ? last : null;
  return activeElement === last || escaped ? first : null;
}
