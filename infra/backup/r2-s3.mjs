/* global AbortSignal, Headers */
import { Buffer } from "node:buffer";
import { createHash, createHmac } from "node:crypto";
import { URL } from "node:url";

export function readR2Configuration(environment = process.env) {
  const endpoint = new URL(required(environment, "R2_ENDPOINT"));
  if (endpoint.protocol !== "https:") throw new Error("R2_ENDPOINT must use HTTPS.");
  if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw new Error("R2_ENDPOINT must not contain credentials, a query, or a fragment.");
  }
  endpoint.pathname = endpoint.pathname.replace(/\/+$/u, "");
  return {
    endpoint,
    region: environment.R2_REGION?.trim() || "auto",
    bucket: required(environment, "R2_BUCKET_NAME"),
    accessKeyId: required(environment, "R2_ACCESS_KEY_ID"),
    secretAccessKey: required(environment, "R2_SECRET_ACCESS_KEY")
  };
}

export async function putObject(configuration, key, bytes, contentType) {
  return assertOk(
    await signedRequest(configuration, {
      method: "PUT",
      key,
      bytes,
      headers: { "content-type": contentType }
    }),
    "upload"
  );
}

export async function headObject(configuration, key) {
  const response = await signedRequest(configuration, { method: "HEAD", key });
  await assertOk(response, "verify");
  return {
    sizeBytes: Number(response.headers.get("content-length") ?? "-1")
  };
}

export async function getObject(configuration, key) {
  const response = await signedRequest(configuration, { method: "GET", key });
  await assertOk(response, "download");
  return Buffer.from(await response.arrayBuffer());
}

export async function deleteObject(configuration, key) {
  return assertOk(await signedRequest(configuration, { method: "DELETE", key }), "delete");
}

export async function listObjects(configuration, prefix) {
  const response = await signedRequest(configuration, {
    method: "GET",
    query: { "list-type": "2", prefix }
  });
  await assertOk(response, "list");
  const xml = await response.text();
  const items = [];
  for (const match of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/gu)) {
    const content = match[1] ?? "";
    const key = readXmlValue(content, "Key");
    const lastModified = readXmlValue(content, "LastModified");
    if (key !== null && lastModified !== null) {
      items.push({ key, lastModified: new Date(lastModified) });
    }
  }
  if (/<IsTruncated>true<\/IsTruncated>/u.test(xml)) {
    throw new Error("R2 backup listing was truncated; reduce retention volume before pruning.");
  }
  return items;
}

async function signedRequest(
  configuration,
  { method, key = null, query = {}, bytes, headers = {} }
) {
  const url = requestUrl(configuration, key);
  const amzDate = toAmzDate(new Date());
  const date = amzDate.slice(0, 8);
  const payloadHash = sha256(bytes ?? Buffer.alloc(0));
  const requestHeaders = new Headers(headers);
  requestHeaders.set("host", url.host);
  requestHeaders.set("x-amz-content-sha256", payloadHash);
  requestHeaders.set("x-amz-date", amzDate);
  const canonicalHeaders = [...requestHeaders.entries()]
    .map(([name, value]) => [name.toLowerCase(), value.trim().replace(/\s+/gu, " ")])
    .sort(([left], [right]) => left.localeCompare(right));
  const signedHeaders = canonicalHeaders.map(([name]) => name).join(";");
  const canonicalQuery = Object.entries(query)
    .map(([name, value]) => `${awsEncode(name)}=${awsEncode(value)}`)
    .sort()
    .join("&");
  url.search = canonicalQuery;
  const canonicalRequest = [
    method,
    url.pathname,
    canonicalQuery,
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
  requestHeaders.set(
    "authorization",
    `AWS4-HMAC-SHA256 Credential=${configuration.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
  );
  return fetch(url, {
    method,
    headers: requestHeaders,
    ...(bytes === undefined ? {} : { body: bytes }),
    signal: AbortSignal.timeout(120_000)
  });
}

function requestUrl(configuration, key) {
  const url = new URL(configuration.endpoint);
  const path = key === null ? [configuration.bucket] : [configuration.bucket, ...key.split("/")];
  url.pathname = `${url.pathname}/${path.map(awsEncode).join("/")}`.replace(/\/{2,}/gu, "/");
  return url;
}

function signingKey(configuration, date) {
  const dateKey = hmac(`AWS4${configuration.secretAccessKey}`, date);
  const regionKey = hmac(dateKey, configuration.region);
  const serviceKey = hmac(regionKey, "s3");
  return hmac(serviceKey, "aws4_request");
}

function hmac(key, value) {
  return createHmac("sha256", key).update(value).digest();
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function toAmzDate(value) {
  return value.toISOString().replace(/[:-]|\.\d{3}/gu, "");
}

function awsEncode(value) {
  return encodeURIComponent(value).replace(
    /[!'()*]/gu,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

function readXmlValue(xml, tag) {
  const match = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "u").exec(xml);
  return match === null
    ? null
    : (match[1] ?? "")
        .replaceAll("&amp;", "&")
        .replaceAll("&lt;", "<")
        .replaceAll("&gt;", ">")
        .replaceAll("&quot;", '"')
        .replaceAll("&apos;", "'");
}

function required(environment, name) {
  const value = environment[name]?.trim() ?? "";
  if (value === "") throw new Error(`${name} is required.`);
  return value;
}

async function assertOk(response, operation) {
  if (response.ok) return;
  throw new Error(`R2 could not ${operation} the backup object (HTTP ${response.status}).`);
}
