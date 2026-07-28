import { createHash, createHmac, randomUUID, type BinaryLike } from "node:crypto";

export const uploadClasses = [
  "product-images",
  "catalogue-media",
  "receipt-images",
  "context-documents",
  "user-uploads",
  "model-artifacts",
  "generated-exports"
] as const;

export type UploadClass = (typeof uploadClasses)[number];

export interface StoredObjectInput {
  key: string;
  bytes: Buffer;
  contentType: string;
  checksum: string;
}

export interface ObjectStorage {
  putObject(input: StoredObjectInput): Promise<void>;
  headObject(key: string): Promise<{ sizeBytes: number; checksum: string | null }>;
  deleteObject(key: string): Promise<void>;
  createSignedGetUrl(key: string, expiresInSeconds?: number): Promise<string>;
}

export interface R2Configuration {
  endpoint: URL;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  region: string;
}

const maximumUploadBytes = 10 * 1024 * 1024;
const allowedTypes: Record<UploadClass, ReadonlySet<string>> = {
  "product-images": new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]),
  "catalogue-media": new Set([
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
    "application/pdf",
    "text/csv",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  ]),
  "receipt-images": new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]),
  "context-documents": new Set([
    "application/pdf",
    "text/plain",
    "text/csv",
    "text/html",
    "application/json",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  ]),
  "user-uploads": new Set([
    "application/octet-stream",
    "application/pdf",
    "text/plain",
    "text/csv",
    "text/html",
    "application/json",
    "image/jpeg",
    "image/png",
    "image/webp",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  ]),
  "model-artifacts": new Set(["application/octet-stream", "application/gzip", "application/zip"]),
  "generated-exports": new Set([
    "application/json",
    "application/pdf",
    "text/csv",
    "application/zip"
  ])
};

export function createObjectStorageFromEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
  fetcher: typeof fetch = fetch
): ObjectStorage | undefined {
  const configured = [
    "R2_ENDPOINT",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
    "R2_BUCKET_NAME"
  ].some((name) => (environment[name]?.trim() ?? "") !== "");
  if (!configured) return undefined;
  return createR2ObjectStorage(readR2Configuration(environment), fetcher);
}

export function createR2ObjectStorage(
  configuration: R2Configuration,
  fetcher: typeof fetch = fetch
): ObjectStorage {
  return {
    async putObject(input) {
      const response = await signedR2Request(configuration, fetcher, {
        method: "PUT",
        key: input.key,
        bytes: input.bytes,
        headers: {
          "content-type": input.contentType,
          "x-amz-meta-sha256": input.checksum
        }
      });
      await assertSuccessful(response, "upload");
    },
    async headObject(key) {
      const response = await signedR2Request(configuration, fetcher, {
        method: "HEAD",
        key
      });
      await assertSuccessful(response, "read metadata for");
      const sizeBytes = Number(response.headers.get("content-length"));
      if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0) {
        throw new Error("Object storage returned invalid object metadata.");
      }
      return {
        sizeBytes,
        checksum: response.headers.get("x-amz-meta-sha256")
      };
    },
    async deleteObject(key) {
      const response = await signedR2Request(configuration, fetcher, {
        method: "DELETE",
        key
      });
      await assertSuccessful(response, "delete");
    },
    async createSignedGetUrl(key, expiresInSeconds = 900) {
      if (
        !Number.isInteger(expiresInSeconds) ||
        expiresInSeconds < 1 ||
        expiresInSeconds > 604_800
      ) {
        throw new Error("Presigned URL expiry must be between 1 and 604800 seconds.");
      }
      return createPresignedR2GetUrl(configuration, key, expiresInSeconds);
    }
  };
}

export function buildObjectKey(input: {
  uploadClass: UploadClass;
  tenantId: string;
  fileName: string;
  now?: Date;
  id?: string;
}): string {
  const tenant = sanitizeSegment(input.tenantId, "tenant");
  const fileName = sanitizeFileName(input.fileName);
  const now = input.now ?? new Date();
  const year = String(now.getUTCFullYear()).padStart(4, "0");
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const id = sanitizeSegment(input.id ?? randomUUID(), "object id");
  return `uploads/${input.uploadClass}/${tenant}/${year}/${month}/${id}-${fileName}`;
}

export function validateUpload(input: {
  uploadClass: UploadClass;
  contentType: string;
  bytes: Buffer;
}): void {
  if (input.bytes.byteLength === 0) throw new Error("Uploaded file must not be empty.");
  if (input.bytes.byteLength > maximumUploadBytes) {
    throw new Error("Uploaded file must be 10 MB or smaller.");
  }
  const contentType = input.contentType.toLowerCase().split(";", 1)[0]?.trim() ?? "";
  if (!allowedTypes[input.uploadClass].has(contentType)) {
    throw new Error(`Content type ${contentType || "(missing)"} is not allowed for this upload.`);
  }
  assertMagicBytes(contentType, input.bytes);
}

function readR2Configuration(environment: NodeJS.ProcessEnv): R2Configuration {
  const endpointValue = requiredEnvironment(environment, "R2_ENDPOINT");
  const endpoint = new URL(endpointValue);
  if (endpoint.protocol !== "https:") throw new Error("R2_ENDPOINT must use HTTPS.");
  if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw new Error("R2_ENDPOINT must not contain credentials, a query, or a fragment.");
  }
  endpoint.pathname = endpoint.pathname.replace(/\/+$/u, "");
  const bucket = requiredEnvironment(environment, "R2_BUCKET_NAME");
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/u.test(bucket)) {
    throw new Error("R2_BUCKET_NAME is invalid.");
  }
  return {
    endpoint,
    accessKeyId: requiredEnvironment(environment, "R2_ACCESS_KEY_ID"),
    secretAccessKey: requiredEnvironment(environment, "R2_SECRET_ACCESS_KEY"),
    bucket,
    region: environment.R2_REGION?.trim() || "auto"
  };
}

async function signedR2Request(
  configuration: R2Configuration,
  fetcher: typeof fetch,
  input: {
    method: "PUT" | "HEAD" | "DELETE";
    key: string;
    bytes?: Buffer;
    headers?: Record<string, string>;
  }
): Promise<Response> {
  const url = objectUrl(configuration, input.key);
  const timestamp = new Date();
  const amzDate = toAmzDate(timestamp);
  const date = amzDate.slice(0, 8);
  const payloadHash = sha256(input.bytes ?? Buffer.alloc(0));
  const headers = new Headers(input.headers);
  headers.set("host", url.host);
  headers.set("x-amz-content-sha256", payloadHash);
  headers.set("x-amz-date", amzDate);
  const canonicalHeaders = [...headers.entries()]
    .map(([name, value]) => [name.toLowerCase(), normalizeHeaderValue(value)] as const)
    .sort(([left], [right]) => left.localeCompare(right));
  const signedHeaders = canonicalHeaders.map(([name]) => name).join(";");
  const canonicalRequest = [
    input.method,
    url.pathname,
    "",
    canonicalHeaders.map(([name, value]) => `${name}:${value}\n`).join(""),
    signedHeaders,
    payloadHash
  ].join("\n");
  const scope = `${date}/${configuration.region}/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    sha256(Buffer.from(canonicalRequest))
  ].join("\n");
  const signature = createHmac("sha256", signingKey(configuration, date))
    .update(stringToSign)
    .digest("hex");
  headers.set(
    "authorization",
    `AWS4-HMAC-SHA256 Credential=${configuration.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
  );
  return fetcher(url, {
    method: input.method,
    headers,
    ...(input.bytes === undefined ? {} : { body: input.bytes as unknown as BodyInit }),
    signal: AbortSignal.timeout(30_000)
  });
}

function createPresignedR2GetUrl(
  configuration: R2Configuration,
  key: string,
  expiresInSeconds: number,
  now = new Date()
): string {
  const url = objectUrl(configuration, key);
  const amzDate = toAmzDate(now);
  const date = amzDate.slice(0, 8);
  const scope = `${date}/${configuration.region}/s3/aws4_request`;
  const query = new URLSearchParams({
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${configuration.accessKeyId}/${scope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(expiresInSeconds),
    "X-Amz-SignedHeaders": "host"
  });
  const canonicalQuery = [...query.entries()]
    .map(([name, value]) => `${awsEncode(name)}=${awsEncode(value)}`)
    .sort()
    .join("&");
  const canonicalRequest = [
    "GET",
    url.pathname,
    canonicalQuery,
    `host:${url.host}\n`,
    "host",
    "UNSIGNED-PAYLOAD"
  ].join("\n");
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    sha256(Buffer.from(canonicalRequest))
  ].join("\n");
  const signature = createHmac("sha256", signingKey(configuration, date))
    .update(stringToSign)
    .digest("hex");
  url.search = `${canonicalQuery}&X-Amz-Signature=${signature}`;
  return url.toString();
}

function objectUrl(configuration: R2Configuration, key: string): URL {
  if (!/^[A-Za-z0-9][A-Za-z0-9/_.:-]{0,511}$/u.test(key) || key.includes("..")) {
    throw new Error("Object key is invalid.");
  }
  const url = new URL(configuration.endpoint);
  url.pathname = `${url.pathname}/${awsEncode(configuration.bucket)}/${key
    .split("/")
    .map(awsEncode)
    .join("/")}`.replace(/\/{2,}/gu, "/");
  return url;
}

function signingKey(configuration: R2Configuration, date: string): Buffer {
  const dateKey = hmac(`AWS4${configuration.secretAccessKey}`, date);
  const regionKey = hmac(dateKey, configuration.region);
  const serviceKey = hmac(regionKey, "s3");
  return hmac(serviceKey, "aws4_request");
}

function hmac(key: BinaryLike, value: string): Buffer {
  return createHmac("sha256", key).update(value).digest();
}

function sha256(value: BinaryLike): string {
  return createHash("sha256").update(value).digest("hex");
}

function toAmzDate(value: Date): string {
  return value.toISOString().replace(/[:-]|\.\d{3}/gu, "");
}

function awsEncode(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/gu,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

function normalizeHeaderValue(value: string): string {
  return value.trim().replace(/\s+/gu, " ");
}

function sanitizeFileName(value: string): string {
  const baseName = value.replaceAll("\\", "/").split("/").pop()?.normalize("NFKC") ?? "";
  const sanitized = baseName
    .replace(/[^A-Za-z0-9._-]+/gu, "-")
    .replace(/\.{2,}/gu, ".")
    .replace(/^[._-]+|[._-]+$/gu, "")
    .slice(0, 120);
  return sanitized || "upload.bin";
}

function sanitizeSegment(value: string, label: string): string {
  const normalized = value
    .trim()
    .replace(/[^A-Za-z0-9_-]+/gu, "-")
    .slice(0, 100);
  if (normalized === "") throw new Error(`${label} is required.`);
  return normalized;
}

function assertMagicBytes(contentType: string, bytes: Buffer): void {
  const matches =
    contentType === "image/jpeg"
      ? bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))
      : contentType === "image/png"
        ? bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))
        : contentType === "image/gif"
          ? ["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString("ascii"))
          : contentType === "image/webp"
            ? bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
              bytes.subarray(8, 12).toString("ascii") === "WEBP"
            : contentType === "application/pdf"
              ? bytes.subarray(0, 5).toString("ascii") === "%PDF-"
              : contentType.includes("openxmlformats") || contentType === "application/zip"
                ? bytes.subarray(0, 2).toString("ascii") === "PK"
                : !["text/plain", "text/csv", "text/html", "application/json"].includes(
                    contentType
                  ) || !bytes.includes(0);
  if (!matches)
    throw new Error(`Uploaded bytes do not match declared content type ${contentType}.`);
}

function requiredEnvironment(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name]?.trim() ?? "";
  if (value === "") throw new Error(`${name} is required when R2 object storage is configured.`);
  return value;
}

async function assertSuccessful(response: Response, operation: string): Promise<void> {
  if (response.ok) return;
  throw new Error(`Object storage could not ${operation} the object (HTTP ${response.status}).`);
}
