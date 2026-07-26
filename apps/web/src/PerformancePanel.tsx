import { useEffect, useState } from "react";
import {
  isPerformanceDebugEnabled,
  subscribeToPerformanceEvents,
  type SokoPerformanceEvent
} from "./performance";

const eventLimit = 12;

export function PerformancePanel() {
  const [events, setEvents] = useState<SokoPerformanceEvent[]>([]);
  const enabled = isPerformanceDebugEnabled();

  useEffect(() => {
    if (!enabled) return;
    return subscribeToPerformanceEvents((event) => {
      setEvents((current) => [...current.slice(-(eventLimit - 1)), event]);
    });
  }, [enabled]);

  if (!enabled) return null;

  return (
    <aside className="performance-panel" aria-label="Performance diagnostics">
      <strong>Performance</strong>
      <button
        type="button"
        onClick={() => setEvents([])}
        aria-label="Clear performance diagnostics"
      >
        Clear
      </button>
      <ol>
        {events.map((event, index) => (
          <li key={`${event.timestamp}-${event.event}-${index}`}>
            <span>{event.event}</span>
            <code>{compactDetails(event.details)}</code>
          </li>
        ))}
      </ol>
    </aside>
  );
}

function compactDetails(details: Record<string, unknown>): string {
  return Object.entries(details)
    .slice(0, 3)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(" ");
}
