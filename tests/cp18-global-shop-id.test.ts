import { describe, expect, it } from "vitest";
import { buildApi } from "../services/api/src/app";
import { createCp2Store } from "../services/api/src/cp2/store";

interface OtpRequestResponse {
  challengeId: string;
  devOtp?: string;
}

interface CreateBusinessResponse {
  business: {
    id: string;
    name: string;
    language: string;
    sokoId: string;
  };
}

interface ProductResponse {
  id: string;
  name: string;
  unit: string;
}

interface PublicStorefrontResponse {
  agentId: string;
  sokoId: string;
  businessName: string;
  products: Array<{
    id: string;
    name: string;
    unit: string;
    available: boolean;
  }>;
}

describe("CP18 Global Shop ID", () => {
  it("creates stable globally formatted shop IDs and resolves storefronts by Soko ID", async () => {
    const store = createCp2Store();
    const app = buildApi({ cp2: { store } });

    const first = await createOwnerBusiness(app, "254700000018", "BigFish soko");
    const second = await createOwnerBusiness(app, "255700000018", "Dar Fish soko");

    expect(first.business.sokoId).toMatch(/^\+254-A\d{8}$/);
    expect(second.business.sokoId).toMatch(/^\+255-A\d{8}$/);
    expect(first.business.sokoId).not.toBe(second.business.sokoId);

    const stockedProduct = await postJson<ProductResponse>(
      app,
      `/businesses/${first.business.id}/products`,
      {
        name: "Tilapia pack",
        sku: "PRIVATE-FISH-001",
        unit: "box",
        quantity: 5
      },
      first.sessionCookie
    );
    await postJson<ProductResponse>(
      app,
      `/businesses/${first.business.id}/products`,
      {
        name: "Hidden empty item",
        sku: "PRIVATE-FISH-002",
        unit: "box",
        quantity: 0
      },
      first.sessionCookie
    );

    const storefront = await app.inject({
      method: "GET",
      url: `/public/storefronts/${encodeURIComponent(first.business.sokoId)}`
    });
    const rawStorefront = await app.inject({
      method: "GET",
      url: `/public/storefronts/${first.business.sokoId}`
    });

    expect(storefront.statusCode).toBe(200);
    expect(rawStorefront.statusCode).toBe(200);
    expect(storefront.json<PublicStorefrontResponse>()).toEqual({
      agentId: first.business.sokoId,
      sokoId: first.business.sokoId,
      businessName: "BigFish soko",
      products: [
        {
          id: stockedProduct.id,
          name: "Tilapia pack",
          unit: "box",
          available: true
        }
      ]
    });
    expect(rawStorefront.json<PublicStorefrontResponse>().sokoId).toBe(first.business.sokoId);
    expect(storefront.json().products[0]).not.toHaveProperty("sku");
    expect(store.snapshot().auditEvents.map((event) => event.type)).toEqual(
      expect.arrayContaining(["business.global_shop_id_created"])
    );

    await app.close();
  });
});

async function createOwnerBusiness(
  app: ReturnType<typeof buildApi>,
  destination: string,
  businessName: string
): Promise<CreateBusinessResponse & { sessionCookie: string }> {
  const otpResponse = await postJson<OtpRequestResponse>(app, "/auth/otp/request", {
    channel: "phone",
    destination
  });
  const verifyResponse = await app.inject({
    method: "POST",
    url: "/auth/otp/verify",
    headers: jsonHeaders(),
    payload: JSON.stringify({
      challengeId: otpResponse.challengeId,
      code: otpResponse.devOtp
    })
  });
  const sessionCookie = extractSessionCookie(verifyResponse.headers["set-cookie"]);
  const business = await postJson<CreateBusinessResponse>(
    app,
    "/businesses",
    {
      name: businessName,
      language: "en"
    },
    sessionCookie
  );

  return {
    ...business,
    sessionCookie
  };
}

async function postJson<TResponse>(
  app: ReturnType<typeof buildApi>,
  url: string,
  payload: unknown,
  cookie?: string
): Promise<TResponse> {
  const response = await app.inject({
    method: "POST",
    url,
    headers: {
      ...jsonHeaders(),
      ...(cookie === undefined ? {} : { cookie })
    },
    payload: JSON.stringify(payload)
  });

  expect(response.statusCode).toBeGreaterThanOrEqual(200);
  expect(response.statusCode).toBeLessThan(300);
  return response.json<TResponse>();
}

function jsonHeaders() {
  return {
    "content-type": "application/json"
  };
}

function extractSessionCookie(header: string | string[] | undefined): string {
  const raw = Array.isArray(header) ? header[0] : header;

  if (raw === undefined) {
    throw new Error("Missing session cookie");
  }

  return raw.split(";")[0] ?? raw;
}
