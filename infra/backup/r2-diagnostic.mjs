import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import { deleteObject, getObject, headObject, putObject, readR2Configuration } from "./r2-s3.mjs";

const configuration = readR2Configuration();
const key = `diagnostics/${randomUUID()}.txt`;
const bytes = Buffer.from("soko-r2-diagnostic");
let uploaded = false;
try {
  await putObject(configuration, key, bytes, "text/plain");
  uploaded = true;
  const metadata = await headObject(configuration, key);
  const downloaded = await getObject(configuration, key);
  if (metadata.sizeBytes !== bytes.byteLength || !downloaded.equals(bytes)) {
    throw new Error("R2 diagnostic object verification failed.");
  }
  console.info(JSON.stringify({ event: "diagnostic.r2.ok", sizeBytes: bytes.byteLength }));
} finally {
  if (uploaded) await deleteObject(configuration, key);
}
