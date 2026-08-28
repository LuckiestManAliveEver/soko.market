import { describe, expect, it } from "vitest";
import { buildApi } from "../services/api/src/app";
import { createCp2Store } from "../services/api/src/cp2/store";

function uniquePhone(seed: number): string {
  return `2547012${String(seed).padStart(5, "0")}`;
}

function jsonHeaders(cookie?: string) {
  return { "content-type": "application/json", ...(cookie === undefined ? {} : { cookie }) };
}

function sessionCookie(header: string | string[] | undefined): string {
  const value = Array.isArray(header) ? header[0] : header;
  if (value === undefined) throw new Error("Expected a session cookie.");
  return value.split(";")[0] ?? value;
}

async function createOwnerBusiness(
  app: ReturnType<typeof buildApi>,
  seed: number,
  name: string
): Promise<{ businessId: string; sokoId: string; cookie: string }> {
  const signup = await app.inject({
    method: "POST",
    url: "/auth/pin/signup",
    headers: jsonHeaders(),
    payload: JSON.stringify({ method: "phone", contact: uniquePhone(seed), pin: "1234" })
  });
  expect(signup.statusCode).toBe(200);
  const cookie = sessionCookie(signup.headers["set-cookie"]);
  const business = await app.inject({
    method: "POST",
    url: "/businesses",
    headers: jsonHeaders(cookie),
    payload: JSON.stringify({ name, language: "en" })
  });
  expect(business.statusCode).toBe(200);
  const body = business.json<{ business: { id: string; sokoId: string } }>();
  return { businessId: body.business.id, sokoId: body.business.sokoId, cookie };
}

describe("GET /s/:slug - the universal fallback link", () => {
  it("redirects an active sokoId to the real storefront URL", async () => {
    const store = createCp2Store();
    const app = buildApi({ cp2: { store, webPublicUrl: "https://soko.market" } });
    const owner = await createOwnerBusiness(app, 1, "Universal Link Shop");

    const response = await app.inject({ method: "GET", url: `/s/${owner.sokoId}` });
    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe(
      `https://soko.market/agent/${encodeURIComponent(owner.sokoId)}`
    );
    await app.close();
  });

  it("returns 410 with a redirectTo for a retired, in-cooldown sokoId", async () => {
    const store = createCp2Store();
    const app = buildApi({ cp2: { store, webPublicUrl: "https://soko.market" } });
    const owner = await createOwnerBusiness(app, 2, "Renamed Universal Shop");
    const oldSokoId = owner.sokoId;

    const rename = await app.inject({
      method: "PUT",
      url: `/businesses/${owner.businessId}/soko-id`,
      headers: jsonHeaders(owner.cookie),
      payload: JSON.stringify({ handle: "new-universal-handle" })
    });
    expect(rename.statusCode).toBe(200);

    const response = await app.inject({ method: "GET", url: `/s/${oldSokoId}` });
    expect(response.statusCode).toBe(410);
    expect(response.json<{ redirectTo: string }>().redirectTo).toBe(
      "https://soko.market/agent/soko.new-universal-handle"
    );
    await app.close();
  });

  it("returns 404 for a sokoId that never existed", async () => {
    const store = createCp2Store();
    const app = buildApi({ cp2: { store } });
    const response = await app.inject({ method: "GET", url: "/s/soko.never-existed-anywhere" });
    expect(response.statusCode).toBe(404);
    await app.close();
  });
});

describe("PUT /businesses/:businessId/soko-id - the rename endpoint", () => {
  it("renames the storefront id and returns the new links", async () => {
    const store = createCp2Store();
    const app = buildApi({
      cp2: { store, webPublicUrl: "https://soko.market", telegramBotUsername: "SokoBot" }
    });
    const owner = await createOwnerBusiness(app, 3, "Rename Endpoint Shop");

    const response = await app.inject({
      method: "PUT",
      url: `/businesses/${owner.businessId}/soko-id`,
      headers: jsonHeaders(owner.cookie),
      payload: JSON.stringify({ handle: "brand-new-handle" })
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      business: { sokoId: "soko.brand-new-handle" },
      links: {
        web: "https://brand-new-handle.soko.market",
        telegram: "https://t.me/SokoBot?start=soko.brand-new-handle",
        universal: "https://soko.market/s/soko.brand-new-handle"
      }
    });
    await app.close();
  });

  it("rejects a rename to an already-claimed handle", async () => {
    const store = createCp2Store();
    const app = buildApi({ cp2: { store } });
    const first = await createOwnerBusiness(app, 4, "Taken Handle Shop");
    const second = await createOwnerBusiness(app, 5, "Wants Taken Handle Shop");
    const takenHandle = first.sokoId.replace(/^soko\./u, "");

    const response = await app.inject({
      method: "PUT",
      url: `/businesses/${second.businessId}/soko-id`,
      headers: jsonHeaders(second.cookie),
      payload: JSON.stringify({ handle: takenHandle })
    });
    expect(response.statusCode).toBe(409);
    expect(response.json<{ code: string }>().code).toBe("soko_id_taken");
    await app.close();
  });

  it("requires authorization - a stranger cannot rename someone else's storefront id", async () => {
    const store = createCp2Store();
    const app = buildApi({ cp2: { store } });
    const owner = await createOwnerBusiness(app, 6, "Protected Shop");
    const stranger = await createOwnerBusiness(app, 7, "Stranger Shop");

    const response = await app.inject({
      method: "PUT",
      url: `/businesses/${owner.businessId}/soko-id`,
      headers: jsonHeaders(stranger.cookie),
      payload: JSON.stringify({ handle: "hijacked-handle" })
    });
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    await app.close();
  });
});
