import { Component, type ErrorInfo, type ReactNode } from "react";

import { retryLazyModuleLoad } from "./lazy-module-recovery";

export interface LazyModuleErrorBoundaryProps {
  children: ReactNode;
  label: string;
  moduleKey: string;
}

interface LazyModuleErrorBoundaryState {
  failed: boolean;
}

export class LazyModuleErrorBoundary extends Component<
  LazyModuleErrorBoundaryProps,
  LazyModuleErrorBoundaryState
> {
  override state: LazyModuleErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): LazyModuleErrorBoundaryState {
    return { failed: true };
  }

  override componentDidCatch(error: unknown, errorInfo: ErrorInfo): void {
    console.error(`[Soko.market] Unable to render ${this.props.moduleKey}.`, error, errorInfo);
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;

    return (
      <section className="lazy-module-error" role="alert">
        <strong>{this.props.label} could not open.</strong>
        <p>The app may have been updated while this page was open.</p>
        <button type="button" onClick={() => retryLazyModuleLoad(this.props.moduleKey)}>
          Reload and try again
        </button>
      </section>
    );
  }
}
