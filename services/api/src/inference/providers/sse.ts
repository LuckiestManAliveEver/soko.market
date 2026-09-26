/**
 * Minimal Server-Sent Events reader shared by the OpenAI-compatible and Anthropic adapters.
 * Yields one `{ event, data }` per SSE message; the caller JSON-parses `data`.
 */
export interface SseMessage {
  event: string | null;
  data: string;
}

export async function* readSse(body: ReadableStream<Uint8Array>): AsyncIterable<SseMessage> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary = findBoundary(buffer);
      while (boundary !== null) {
        const raw = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.index + boundary.length);
        const message = parseMessage(raw);
        if (message !== null) yield message;
        boundary = findBoundary(buffer);
      }
    }
    buffer += decoder.decode();
    const trailing = parseMessage(buffer);
    if (trailing !== null) yield trailing;
  } finally {
    reader.releaseLock();
  }
}

function findBoundary(buffer: string): { index: number; length: number } | null {
  const match = /\r?\n\r?\n/u.exec(buffer);
  return match === null ? null : { index: match.index, length: match[0].length };
}

function parseMessage(raw: string): SseMessage | null {
  let event: string | null = null;
  const data: string[] = [];
  for (const line of raw.split(/\r?\n/u)) {
    if (line === "" || line.startsWith(":")) continue;
    const separator = line.indexOf(":");
    const field = separator === -1 ? line : line.slice(0, separator);
    const value = separator === -1 ? "" : line.slice(separator + 1).replace(/^ /u, "");
    if (field === "event") event = value;
    if (field === "data") data.push(value);
  }
  return data.length === 0 ? null : { event, data: data.join("\n") };
}
