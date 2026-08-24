import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ConversationAttachmentCard } from "../apps/web/src/ConversationAttachmentCard";

describe("conversation attachment Business Cards", () => {
  it.each(["image/png", "image/jpeg", "image/webp", "image/gif"])(
    "renders %s inline with an accessible download",
    (type) => {
      const html = renderToStaticMarkup(
        <ConversationAttachmentCard
          attachment={{
            id: "attachment-image",
            name: "catalogue image.png",
            type,
            size: 482_000,
            category: "image",
            kind: "image",
            previewable: true,
            previewUrl: "/preview/image",
            downloadUrl: "/download/image"
          }}
        />
      );
      expect(html).toContain('<img class="conversation-attachment-image"');
      expect(html).toContain('alt="catalogue image.png"');
      expect(html).toContain('href="/download/image"');
      expect(html).toContain('aria-label="Download catalogue image.png"');
    }
  );

  it("renders PDF and text preview actions", () => {
    for (const attachment of [
      { name: "report.pdf", type: "application/pdf", kind: "pdf" as const },
      { name: "README.md", type: "text/markdown", kind: "text" as const }
    ]) {
      const html = renderToStaticMarkup(
        <ConversationAttachmentCard
          attachment={{
            id: attachment.name,
            name: attachment.name,
            type: attachment.type,
            size: 12_000,
            category: "document",
            kind: attachment.kind,
            previewable: true,
            previewUrl: `/preview/${attachment.name}`,
            downloadUrl: `/download/${attachment.name}`
          }}
        />
      );
      expect(html).toContain(`aria-label="Preview ${attachment.name}"`);
      expect(html).toContain(`aria-label="Download ${attachment.name}"`);
    }
  });

  it.each([
    ["inventory.xlsx", "document"],
    ["documents.zip", "archive"],
    ["model.bin", "file"]
  ] as const)("renders %s as a download-only card", (name, kind) => {
    const html = renderToStaticMarkup(
      <ConversationAttachmentCard
        attachment={{
          id: name,
          name,
          type: "application/octet-stream",
          size: 1_700_000,
          category: "document",
          kind,
          previewable: false,
          downloadUrl: `/download/${name}`
        }}
      />
    );
    expect(html).not.toContain("Preview");
    expect(html).toContain(`aria-label="Download ${name}"`);
  });
});
