export interface PlatformShareData {
  text: string;
  title?: string;
  url?: string;
}

export interface PlatformShareEnvironment {
  share?: (data: PlatformShareData) => Promise<void>;
  writeClipboard?: (text: string) => Promise<void>;
}

export interface PlatformShareResult {
  channel: "platform_share_sheet";
  status: "share_completed" | "share_cancelled" | "copied_to_clipboard" | "share_unavailable";
  errorCode: string | null;
  usedShareSheet: boolean;
}

function isShareCancellation(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

async function writeBrowserClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText !== undefined) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textArea = document.createElement("textarea");
  textArea.value = text;
  textArea.setAttribute("readonly", "true");
  textArea.style.position = "fixed";
  textArea.style.opacity = "0";
  document.body.appendChild(textArea);
  textArea.select();
  const copied = document.execCommand("copy");
  document.body.removeChild(textArea);
  if (!copied) throw new Error("Clipboard copy was rejected.");
}

export function browserPlatformShareEnvironment(): PlatformShareEnvironment {
  return {
    ...(navigator.share === undefined ? {} : { share: navigator.share.bind(navigator) }),
    writeClipboard: writeBrowserClipboard
  };
}

export function formatExternalShareText(data: PlatformShareData): string {
  const text = data.text.trim();
  const url = data.url?.trim() ?? "";
  return [text, url].filter((value) => value.length > 0).join("\n");
}

/**
 * Hands a message to an operating-system share target. The resolved result means only that the
 * handoff completed; delivery and read receipts remain owned by the selected external platform.
 */
export async function shareMessageExternally(
  data: PlatformShareData,
  environment: PlatformShareEnvironment = browserPlatformShareEnvironment()
): Promise<PlatformShareResult> {
  const text = formatExternalShareText(data);
  if (text.length === 0) {
    return {
      channel: "platform_share_sheet",
      status: "share_unavailable",
      errorCode: "empty_share_message",
      usedShareSheet: false
    };
  }

  if (environment.share !== undefined) {
    try {
      await environment.share({
        text: data.text.trim(),
        ...(data.title?.trim() ? { title: data.title.trim() } : {}),
        ...(data.url?.trim() ? { url: data.url.trim() } : {})
      });
      return {
        channel: "platform_share_sheet",
        status: "share_completed",
        errorCode: null,
        usedShareSheet: true
      };
    } catch (error) {
      if (isShareCancellation(error)) {
        return {
          channel: "platform_share_sheet",
          status: "share_cancelled",
          errorCode: null,
          usedShareSheet: true
        };
      }
      return {
        channel: "platform_share_sheet",
        status: "share_unavailable",
        errorCode: "share_sheet_failed",
        usedShareSheet: true
      };
    }
  }

  if (environment.writeClipboard !== undefined) {
    try {
      await environment.writeClipboard(text);
      return {
        channel: "platform_share_sheet",
        status: "copied_to_clipboard",
        errorCode: null,
        usedShareSheet: false
      };
    } catch {
      // Fall through to the capability-safe unavailable state.
    }
  }

  return {
    channel: "platform_share_sheet",
    status: "share_unavailable",
    errorCode: "external_share_unavailable",
    usedShareSheet: false
  };
}
