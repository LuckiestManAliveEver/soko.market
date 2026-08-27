import type { ReactNode } from "react";

export interface SettingsGroupProps {
  title: string;
  description?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}

/** Native `<details>`/`<summary>` - the same collapsible primitive already used ad hoc elsewhere
 *  in this app (AgentModelPanel's "Advanced routing", CatalogueNestedCard's "Advanced details") -
 *  reused here as a shared component instead of a fourth one-off copy. */
export function SettingsGroup({ title, description, defaultOpen = false, children }: SettingsGroupProps) {
  return (
    <details className="settings-group" open={defaultOpen}>
      <summary className="settings-group-summary">
        <span className="settings-group-title">{title}</span>
        {description === undefined ? null : (
          <span className="settings-group-description">{description}</span>
        )}
      </summary>
      <div className="settings-group-body">{children}</div>
    </details>
  );
}
