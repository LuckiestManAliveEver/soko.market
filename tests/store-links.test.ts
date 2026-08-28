import { describe, expect, it } from "vitest";
import { getStoreLinks } from "../packages/shared-types/src/store-links";

describe("getStoreLinks", () => {
  it("builds the web, telegram, and universal links for a configured bot", () => {
    const links = getStoreLinks("soko.mama-mboga", {
      webOrigin: "https://soko.market",
      telegramBotUsername: "SokoBot"
    });
    expect(links).toEqual({
      web: "https://mama-mboga.soko.market",
      telegram: "https://t.me/SokoBot?start=soko.mama-mboga",
      universal: "https://soko.market/s/soko.mama-mboga"
    });
  });

  it("returns an empty telegram link when no bot username is configured", () => {
    const links = getStoreLinks("soko.duka", {
      webOrigin: "https://soko.market",
      telegramBotUsername: ""
    });
    expect(links.telegram).toBe("");
  });

  it("strips a trailing slash from the configured web origin", () => {
    const links = getStoreLinks("soko.duka", {
      webOrigin: "https://soko.market/",
      telegramBotUsername: ""
    });
    expect(links.universal).toBe("https://soko.market/s/soko.duka");
  });

  it("URL-encodes the sokoId consistently across all three links", () => {
    const links = getStoreLinks("soko.a b", {
      webOrigin: "https://soko.market",
      telegramBotUsername: "SokoBot"
    });
    expect(links.web).toBe("https://a%20b.soko.market");
    expect(links.telegram).toBe("https://t.me/SokoBot?start=soko.a%20b");
    expect(links.universal).toBe("https://soko.market/s/soko.a%20b");
  });

  it("strips the soko. prefix from the web subdomain but keeps it in telegram/universal", () => {
    const links = getStoreLinks("soko.jane", {
      webOrigin: "https://soko.market",
      telegramBotUsername: ""
    });
    expect(links.web).toBe("https://jane.soko.market");
    expect(links.universal).toBe("https://soko.market/s/soko.jane");
  });

  it("has no whatsapp field - deliberately deferred", () => {
    const links = getStoreLinks("soko.duka", {
      webOrigin: "https://soko.market",
      telegramBotUsername: ""
    });
    expect(links).not.toHaveProperty("whatsapp");
  });
});
