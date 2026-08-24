import { useState } from "react";

import type { ChatAttachment } from "./app-shell";
import { formatAttachmentCategory, formatFileSize } from "./formatters";

export function ConversationAttachmentCard({ attachment }: { attachment: ChatAttachment }) {
  const [imageFailed, setImageFailed] = useState(false);
  const previewUrl = attachment.previewUrl ?? attachment.dataUrl;
  const downloadUrl = attachment.downloadUrl ?? attachment.dataUrl;
  const inlineImage = attachment.category === "image" && previewUrl !== undefined && !imageFailed;
  const typeLabel = attachment.kind?.toUpperCase() ?? formatAttachmentCategory(attachment.category);

  return (
    <article className="conversation-attachment-card" title={attachment.name}>
      {inlineImage ? (
        <img
          className="conversation-attachment-image"
          src={previewUrl}
          alt={attachment.caption?.trim() || attachment.name}
          loading="lazy"
          decoding="async"
          onError={() => setImageFailed(true)}
        />
      ) : (
        <div className="conversation-attachment-file-icon" aria-hidden="true">
          {attachment.kind === "pdf" ? "PDF" : "FILE"}
        </div>
      )}
      <div className="conversation-attachment-details">
        <strong>{attachment.name}</strong>
        {attachment.caption ? <span>{attachment.caption}</span> : null}
        <small>
          {typeLabel} · {formatFileSize(attachment.size)}
        </small>
      </div>
      <div className="conversation-attachment-actions">
        {!inlineImage && attachment.previewable && previewUrl ? (
          <a
            href={previewUrl}
            target="_blank"
            rel="noreferrer"
            aria-label={`Preview ${attachment.name}`}
          >
            Preview
          </a>
        ) : null}
        {downloadUrl ? (
          <a
            href={downloadUrl}
            {...(attachment.dataUrl ? { download: attachment.name } : {})}
            aria-label={`Download ${attachment.name}`}
          >
            Download
          </a>
        ) : null}
      </div>
      {attachment.category === "image" && imageFailed ? (
        <small role="status">Image preview unavailable. Download the original file instead.</small>
      ) : null}
    </article>
  );
}
