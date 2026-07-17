import { describe, expect, it, vi } from "vitest";
import { buildApi } from "../services/api/src/app";
import {
  createBinaryUploadPipelineFromEnvironment,
  createHttpBinaryUploadPipeline
} from "../services/api/src/cp2/binary-upload-pipeline";
import { createCp2Store } from "../services/api/src/cp2/store";

describe("binary upload security pipeline", () => {
  it("fails closed in production when malware scanning is not configured", () => {
    expect(() =>
      createBinaryUploadPipelineFromEnvironment({
        NODE_ENV: "production"
      })
    ).toThrow("required for secure binary uploads");
  });

  it("does not allow object storage without malware scanning", () => {
    expect(() =>
      createBinaryUploadPipelineFromEnvironment({
        OBJECT_STORAGE_URL: "https://storage.example.test",
        OBJECT_STORAGE_SECRET: "storage-secret-with-at-least-32-characters"
      })
    ).toThrow("required for secure binary uploads");
  });

  it("scans and stores retained uploads through signed adapters", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ status: "clean" }))
      .mockResolvedValueOnce(Response.json({ storageKey: "imports/business/source.csv" }));
    const pipeline = createHttpBinaryUploadPipeline({
      scanner: {
        url: "https://scanner.example.test/",
        secret: "scanner-secret-with-at-least-32-characters"
      },
      storage: {
        url: "https://storage.example.test/",
        secret: "storage-secret-with-at-least-32-characters"
      },
      fetcher
    });
    const result = await pipeline.process(
      {
        businessId: "business-1",
        fileName: "source.csv",
        contentType: "text/csv",
        bytes: Buffer.from("name,email\\nAmina,amina@example.test")
      },
      { retain: true }
    );

    expect(result.storageKey).toBe("imports/business/source.csv");
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0]?.[1]?.headers).toEqual(
      expect.objectContaining({
        "x-soko-upload-signature": expect.stringMatching(/^sha256=[a-f0-9]{64}$/u)
      })
    );
  });

  it("rejects infected uploads before extraction or storage", async () => {
    const pipeline = createHttpBinaryUploadPipeline({
      scanner: {
        url: "https://scanner.example.test/",
        secret: "scanner-secret-with-at-least-32-characters"
      },
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(Response.json({ status: "infected" }))
    });

    await expect(
      pipeline.process(
        {
          businessId: "business-1",
          fileName: "unsafe.pdf",
          contentType: "application/pdf",
          bytes: Buffer.from("%PDF unsafe")
        },
        { retain: false }
      )
    ).rejects.toMatchObject({ statusCode: 422, code: "malware_detected" });
  });

  it("persists the external storage key in document import provenance", async () => {
    const pipeline = {
      process: vi.fn().mockResolvedValue({
        checksum: "a".repeat(64),
        storageKey: "imports/shop/catalogue.csv"
      })
    };
    const app = buildApi({
      cp2: { store: createCp2Store(), binaryUploadPipeline: pipeline }
    });
    const { cookie, businessId } = await createOwner(app);
    const content = "name,phone,email\\nAmina,+254700000555,amina@example.test";
    const response = await app.inject({
      method: "POST",
      url: `/businesses/${businessId}/imports/supplier-csv`,
      headers: { cookie, "content-type": "application/json" },
      payload: JSON.stringify({
        fileName: "suppliers.csv",
        contentType: "text/csv",
        contentBase64: Buffer.from(content).toString("base64")
      })
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({
      source: { originalStorageKey: "imports/shop/catalogue.csv" }
    });
    expect(pipeline.process).toHaveBeenCalledWith(
      expect.objectContaining({ businessId, fileName: "suppliers.csv" }),
      { retain: true }
    );
    await app.close();
  });
});

async function createOwner(app: ReturnType<typeof buildApi>) {
  const otpResponse = await app.inject({
    method: "POST",
    url: "/auth/otp/request",
    headers: { "content-type": "application/json" },
    payload: JSON.stringify({ channel: "phone", destination: "+254700000554" })
  });
  const otp = otpResponse.json<{ challengeId: string; devOtp: string }>();
  const verified = await app.inject({
    method: "POST",
    url: "/auth/otp/verify",
    headers: { "content-type": "application/json" },
    payload: JSON.stringify({ challengeId: otp.challengeId, code: otp.devOtp })
  });
  const setCookie = verified.headers["set-cookie"];
  const cookie = String(Array.isArray(setCookie) ? setCookie[0] : setCookie).split(";")[0] ?? "";
  const business = await app.inject({
    method: "POST",
    url: "/businesses",
    headers: { cookie, "content-type": "application/json" },
    payload: JSON.stringify({ name: "Pipeline Shop", language: "en" })
  });
  return {
    cookie,
    businessId: business.json<{ business: { id: string } }>().business.id
  };
}
