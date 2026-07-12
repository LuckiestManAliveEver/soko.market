import type { SyncRealtimeEvent } from "@soko/shared-types";

export interface AccountRealtimeOptions {
  accountId: string;
  createSocket?: (endpoint: string) => AccountRealtimeSocket;
  endpoint: string;
  onChangesAvailable: () => void | Promise<void>;
  reconnectDelayMs?: number;
}

export interface AccountRealtimeSocket {
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  addEventListener(type: "close", listener: () => void): void;
  close(code?: number, reason?: string): void;
}

export function subscribeToAccountRealtime(options: AccountRealtimeOptions): () => void {
  let stopped = false;
  let socket: AccountRealtimeSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  const reconnectDelayMs = Math.max(250, options.reconnectDelayMs ?? 2_000);

  function connect() {
    if (stopped) {
      return;
    }

    socket = options.createSocket?.(options.endpoint) ?? new WebSocket(options.endpoint);
    socket.addEventListener("message", (message) => {
      const event = parseRealtimeEvent(message.data);
      if (event === null || event.accountId !== options.accountId) {
        return;
      }
      if (event.type === "realtime.ready" || event.type === "sync.changes_available") {
        void options.onChangesAvailable();
      }
    });
    socket.addEventListener("close", () => {
      socket = null;
      if (!stopped) {
        reconnectTimer = setTimeout(connect, reconnectDelayMs);
      }
    });
  }

  connect();

  return () => {
    stopped = true;
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer);
    }
    socket?.close(1000, "Session ended");
    socket = null;
  };
}

function parseRealtimeEvent(value: unknown): SyncRealtimeEvent | null {
  if (typeof value !== "string") {
    return null;
  }
  try {
    const event = JSON.parse(value) as Partial<SyncRealtimeEvent>;
    if (
      event.protocolVersion !== 1 ||
      typeof event.accountId !== "string" ||
      (event.type !== "realtime.ready" && event.type !== "sync.changes_available")
    ) {
      return null;
    }
    return event as SyncRealtimeEvent;
  } catch {
    return null;
  }
}
