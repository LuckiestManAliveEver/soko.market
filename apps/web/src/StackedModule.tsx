import { useEffect, useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { shouldCloseStackedModuleFromSwipe } from "./stacked-module-behavior";

export { shouldCloseStackedModuleFromSwipe } from "./stacked-module-behavior";

export interface StackedModuleProps {
  children: ReactNode;
  className?: string;
  moduleId: string;
  open: boolean;
  title: string;
  onClose: () => void;
}

export function StackedModule({
  children,
  className = "",
  moduleId,
  open,
  title,
  onClose
}: StackedModuleProps) {
  const panelRef = useRef<HTMLElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const swipeStartYRef = useRef<number | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const appRoot = document.getElementById("root");
    const rootWasInert = appRoot?.hasAttribute("inert") ?? false;
    const previousAriaHidden = appRoot?.getAttribute("aria-hidden") ?? null;
    appRoot?.setAttribute("inert", "");
    appRoot?.setAttribute("aria-hidden", "true");
    returnFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frameId = window.requestAnimationFrame(() => panelRef.current?.focus());

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || panelRef.current === null) return;
      const focusable = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      );
      if (focusable.length === 0) {
        event.preventDefault();
        panelRef.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const activeElement = document.activeElement;
      if (
        event.shiftKey &&
        (activeElement === first ||
          activeElement === panelRef.current ||
          !panelRef.current.contains(activeElement))
      ) {
        event.preventDefault();
        last?.focus();
      } else if (
        !event.shiftKey &&
        (activeElement === last ||
          activeElement === panelRef.current ||
          !panelRef.current.contains(activeElement))
      ) {
        event.preventDefault();
        first?.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frameId);
      document.removeEventListener("keydown", handleKeyDown);
      if (!rootWasInert) appRoot?.removeAttribute("inert");
      if (previousAriaHidden === null) appRoot?.removeAttribute("aria-hidden");
      else appRoot?.setAttribute("aria-hidden", previousAriaHidden);
      returnFocusRef.current?.focus();
    };
  }, [open]);

  if (!open) return null;

  function startSwipe(event: ReactPointerEvent<HTMLDivElement>) {
    if (!event.isPrimary) return;
    if (
      event.target instanceof Element &&
      event.target.closest("button, a[href], input, select, textarea") !== null
    ) {
      return;
    }
    swipeStartYRef.current = event.clientY;
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function finishSwipe(event: ReactPointerEvent<HTMLDivElement>) {
    const startY = swipeStartYRef.current;
    swipeStartYRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (startY !== null && shouldCloseStackedModuleFromSwipe(startY, event.clientY)) {
      onClose();
    }
  }

  return createPortal(
    <div
      className="stacked-module-backdrop"
      data-module-id={moduleId}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className={`stacked-module ${className}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${moduleId}-title`}
        tabIndex={-1}
        ref={panelRef}
      >
        <div
          className="stacked-module-heading"
          onPointerDown={startSwipe}
          onPointerUp={finishSwipe}
          onPointerCancel={() => {
            swipeStartYRef.current = null;
          }}
        >
          <span className="stacked-module-drag-handle" aria-hidden="true" />
          <h2 id={`${moduleId}-title`}>{title}</h2>
          <button type="button" onClick={onClose} aria-label={`Close ${title}`}>
            ×
          </button>
        </div>
        <div className="stacked-module-content">{children}</div>
      </section>
    </div>,
    document.body
  );
}
