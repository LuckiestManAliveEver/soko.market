export interface ConversationAttachmentBlob {
  storageKey: string;
  bytes: Buffer;
  checksum: string;
  mimeType: string;
}

export interface ConversationAttachmentBlobStore {
  put(blob: ConversationAttachmentBlob): Promise<void>;
  get(storageKey: string): Promise<Buffer | null>;
  delete(storageKey: string): Promise<void>;
}

/**
 * Process-local implementation used by the explicit memory store and tests. Production Postgres
 * stores inject the bytea-backed implementation from postgres-store.ts instead.
 */
export function createMemoryConversationAttachmentBlobStore(): ConversationAttachmentBlobStore {
  const blobs = new Map<string, Buffer>();
  return {
    async put(blob) {
      blobs.set(blob.storageKey, Buffer.from(blob.bytes));
    },
    async get(storageKey) {
      const bytes = blobs.get(storageKey);
      return bytes === undefined ? null : Buffer.from(bytes);
    },
    async delete(storageKey) {
      blobs.delete(storageKey);
    }
  };
}
