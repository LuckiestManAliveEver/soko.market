import type { ChatAttachment } from "./app-shell";
import { isExtractableChatAttachment } from "./chat-message-plumbing";
import { formatAttachmentCategory, formatFileSize } from "./formatters";

export interface ComposerAttachmentWorkbenchProps {
  pendingAttachments: ChatAttachment[];
  onRemoveAttachment: (attachmentId: string) => void;
  onCommitDraft: (draft: string) => void;
}

// Pulled out of ChatComposer to keep it under the modularity budget
// (scripts/check-boundaries.mjs).
export function ComposerAttachmentWorkbench({
  pendingAttachments,
  onRemoveAttachment,
  onCommitDraft
}: ComposerAttachmentWorkbenchProps) {
  if (pendingAttachments.length === 0) {
    return null;
  }

  return (
    <div className="attachment-workbench">
      <div className="attachment-tray" aria-label="Selected attachments">
        {pendingAttachments.map((attachment) => (
          <span className="attachment-chip" key={attachment.id}>
            <span>
              <strong>{attachment.name}</strong>
              <small>
                {formatAttachmentCategory(attachment.category)} · {formatFileSize(attachment.size)}
              </small>
            </span>
            <button
              type="button"
              aria-label={`Remove ${attachment.name}`}
              onClick={() => onRemoveAttachment(attachment.id)}
            >
              x
            </button>
          </span>
        ))}
      </div>
      {pendingAttachments.some(isExtractableChatAttachment) ? (
        <div className="document-instructions" aria-label="Document instructions">
          <span>OCR ready for scans and images</span>
          <button type="button" onClick={() => onCommitDraft("Extract all readable text")}>
            Extract text
          </button>
          <button
            type="button"
            onClick={() => onCommitDraft("Summarize this document in simple bullet points")}
          >
            Summarize
          </button>
          <button
            type="button"
            onClick={() =>
              onCommitDraft("Extract names, dates, totals, and line items into a table")
            }
          >
            Extract fields
          </button>
        </div>
      ) : null}
    </div>
  );
}
