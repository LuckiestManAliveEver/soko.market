/**
 * Incremental companion to parseRuntimeModelOutput for streaming. Models answer with one JSON
 * object ({"type":"response","message":"..."}); streaming that raw text to a person would show
 * JSON syntax and, for {"type":"tool",...}, an unapproved tool proposal. This extractor emits only
 * the characters of the `message` string of a response/clarification as they arrive, and nothing
 * at all for tool proposals. Plain-text output (a model that ignored the JSON contract, which
 * normalizeModelText later wraps as a response) streams as-is.
 *
 * The streamed text is a preview only: the persisted reply always comes from the full output
 * after parseRuntimeModelOutput and the server's validation.
 */
export interface RuntimeReplyTextStream {
  /** Feeds raw model text; returns newly visible reply text (possibly ""). */
  push(chunk: string): string;
  /** True once the output is known to be a tool proposal - callers should hide any preview. */
  readonly isToolProposal: boolean;
}

export function createRuntimeReplyTextStream(): RuntimeReplyTextStream {
  let mode: "undecided" | "plain" | "json" = "undecided";
  let raw = "";
  let scanIndex = 0;
  let inMessage = false;
  let messageDone = false;
  let escape: string | null = null;
  let toolProposal = false;

  function scanForMessageStart(): void {
    if (toolProposal) return;
    if (/"type"\s*:\s*"tool"/u.test(raw)) {
      toolProposal = true;
      return;
    }
    const match = /"message"\s*:\s*"/u.exec(raw.slice(scanIndex));
    if (match === null) {
      // Keep a small tail in case the key is split across chunks.
      scanIndex = Math.max(scanIndex, raw.length - 16);
      return;
    }
    scanIndex += match.index + match[0].length;
    inMessage = true;
  }

  function decodeMessage(): string {
    let out = "";
    while (scanIndex < raw.length && !messageDone) {
      const character = raw[scanIndex] as string;
      if (escape !== null) {
        escape += character;
        if (escape.startsWith("\\u")) {
          if (escape.length < 6) {
            scanIndex += 1;
            continue;
          }
          const code = Number.parseInt(escape.slice(2), 16);
          out += Number.isNaN(code) ? "" : String.fromCharCode(code);
        } else {
          out +=
            ({ n: "\n", t: "\t", r: "\r", b: "\b", f: "\f" } as Record<string, string>)[
              character
            ] ?? character;
        }
        escape = null;
        scanIndex += 1;
        continue;
      }
      if (character === "\\") {
        escape = "\\";
        scanIndex += 1;
        continue;
      }
      if (character === '"') {
        messageDone = true;
        scanIndex += 1;
        break;
      }
      out += character;
      scanIndex += 1;
    }
    return out;
  }

  return {
    get isToolProposal() {
      return toolProposal;
    },
    push(chunk) {
      if (chunk === "") return "";
      raw += chunk;
      if (mode === "undecided") {
        const trimmed = raw.trimStart();
        if (trimmed === "") return "";
        // Some models wrap JSON in a markdown fence; treat a fence as JSON too.
        mode = trimmed.startsWith("{") || trimmed.startsWith("`") ? "json" : "plain";
        if (mode === "plain") return raw.trimStart();
      }
      if (mode === "plain") return chunk;
      if (messageDone) return "";
      if (!inMessage) {
        scanForMessageStart();
        if (!inMessage) return "";
      }
      if (toolProposal) return "";
      return decodeMessage();
    }
  };
}
