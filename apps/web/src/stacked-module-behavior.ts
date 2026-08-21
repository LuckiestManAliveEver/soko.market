const swipeCloseThresholdPx = 72;

export function shouldCloseStackedModuleFromSwipe(startY: number, endY: number): boolean {
  return endY - startY >= swipeCloseThresholdPx;
}
