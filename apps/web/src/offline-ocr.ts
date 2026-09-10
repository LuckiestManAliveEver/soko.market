import { createWorker, OEM, type Worker } from "tesseract.js";
import {
  cacheArtifactsByUrl,
  type Artifact,
  type ReceiptOcrExtraction
} from "@soko/offline-runtime";

/**
 * On-device receipt OCR (packages/offline-runtime's LocalProvider calls into this as its injected
 * `ocr` callback, the same pattern apps/web already uses to inject agent/model inference). Runs
 * entirely in-browser via tesseract.js/WASM so a receipt can be scanned with no connection at all;
 * everything past text extraction (supplier/sales-agent matching) still happens server-side once
 * the capture syncs, matching what apps/web/src/OfflineRuntimeSettings.tsx discloses.
 */
const cacheName = "soko-ocr-engine-v1";
const enginePath = "/tesseract";
const manifestUrl = `${enginePath}/manifest.json`;
// Tracks the pinned tesseract.js/tesseract.js-core/@tesseract.js-data version in package.json.
const engineVersion = "7.0.0";
const modelVersion = "eng-4.0.0_best_int";

let workerPromise: Promise<Worker> | null = null;

/** Reads the manifest already saved locally by ensureOcrEngineCached - never touches the network,
 * so checking whether offline OCR is ready never counts as the "silent network activity" that
 * explicit offline mode must avoid. */
async function readCachedManifest(): Promise<Artifact[] | null> {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(manifestUrl);
  if (!cached) return null;
  const manifest = (await cached.json()) as { artifacts?: unknown };
  return Array.isArray(manifest.artifacts) ? (manifest.artifacts as Artifact[]) : null;
}

export async function ensureOcrEngineCached(
  progress: (done: number, total: number) => void
): Promise<void> {
  const response = await fetch(manifestUrl, { cache: "no-store" });
  if (!response.ok) throw new Error("The offline receipt scanner manifest is unavailable.");
  const bytes = await response.arrayBuffer();
  const manifest = JSON.parse(new TextDecoder().decode(bytes)) as { artifacts?: unknown };
  if (!Array.isArray(manifest.artifacts) || manifest.artifacts.length === 0)
    throw new Error("Invalid offline receipt scanner manifest.");
  const artifacts = manifest.artifacts as Artifact[];
  const cache = await caches.open(cacheName);
  await cacheArtifactsByUrl(artifacts, cache, progress);
  await cache.put(manifestUrl, new Response(bytes));
}

export async function isOcrEngineCached(): Promise<boolean> {
  try {
    const artifacts = await readCachedManifest();
    if (!artifacts) return false;
    const cache = await caches.open(cacheName);
    for (const artifact of artifacts) if (!(await cache.match(artifact.url))) return false;
    return true;
  } catch {
    return false;
  }
}

async function getOcrWorker(): Promise<Worker> {
  workerPromise ??= createWorker("eng", OEM.LSTM_ONLY, {
    workerPath: new URL(`${enginePath}/worker.min.js`, location.origin).href,
    corePath: new URL(`${enginePath}/`, location.origin).href,
    langPath: new URL(`${enginePath}/lang/`, location.origin).href,
    gzip: true,
    cacheMethod: "none"
  }).catch((error: unknown) => {
    workerPromise = null;
    throw error;
  });
  return workerPromise;
}

export async function runLocalOcr(input: {
  fileName: string;
  contentType: string;
  contentBase64: string;
}): Promise<ReceiptOcrExtraction> {
  if (!(await isOcrEngineCached()))
    throw new Error(
      "The on-device receipt scanner is not installed on this device. Enable it from Settings."
    );
  const worker = await getOcrWorker();
  const { data } = await worker.recognize(
    `data:${input.contentType};base64,${input.contentBase64}`,
    { rotateAuto: true },
    { blocks: true }
  );
  let index = 0;
  const blocks = (data.blocks ?? []).flatMap((block) =>
    block.paragraphs.flatMap((paragraph) =>
      paragraph.lines.map((line) => ({
        id: `line-${index++}`,
        page: 0,
        text: line.text,
        confidence: line.confidence / 100,
        boundingBox: [
          { x: line.bbox.x0, y: line.bbox.y0 },
          { x: line.bbox.x1, y: line.bbox.y0 },
          { x: line.bbox.x1, y: line.bbox.y1 },
          { x: line.bbox.x0, y: line.bbox.y1 }
        ]
      }))
    )
  );
  return {
    engine: "tesseract",
    engineVersion,
    modelVersion,
    profile: "mobile",
    fallbackUsed: false,
    blocks,
    fullText: data.text,
    averageConfidence: data.confidence / 100,
    warnings: []
  };
}
