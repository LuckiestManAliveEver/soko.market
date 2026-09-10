import type { Artifact } from "../types.js";
export async function cacheVerifiedArtifacts(
  artifacts: Artifact[],
  cache: Cache,
  progress: (done: number, total: number) => void,
  fetcher: typeof fetch = fetch
): Promise<void> {
  const total = artifacts.reduce((sum, artifact) => sum + artifact.bytes, 0);
  let done = 0;
  for (const artifact of artifacts) {
    const key = `https://offline.soko.invalid/artifacts/${artifact.sha256}`;
    const cached = await cache.match(key);
    if (cached && (await verified(await cached.arrayBuffer(), artifact))) {
      done += artifact.bytes;
      progress(done, total);
      continue;
    }
    const response = await fetcher(artifact.url, { credentials: "omit" });
    if (!response.ok || !response.body)
      throw new Error("The pinned artifact could not be downloaded.");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let count = 0;
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        count += next.value.byteLength;
        if (count > artifact.bytes) throw new Error("Artifact exceeds its declared size.");
        chunks.push(next.value);
        progress(done + count, total);
      }
    } catch (error) {
      await reader.cancel();
      throw error;
    }
    const buffer = new Uint8Array(count);
    let offset = 0;
    for (const chunk of chunks) {
      buffer.set(chunk, offset);
      offset += chunk.length;
    }
    if (!(await verified(buffer.buffer, artifact)))
      throw new Error("Pinned artifact integrity verification failed.");
    await cache.put(key, new Response(buffer));
    done += count;
    progress(done, total);
  }
}
async function verified(buffer: ArrayBuffer, artifact: Artifact): Promise<boolean> {
  if (buffer.byteLength !== artifact.bytes) return false;
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return (
    [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("") ===
    artifact.sha256.toLowerCase()
  );
}
