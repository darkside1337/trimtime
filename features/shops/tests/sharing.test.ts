import { afterEach, describe, expect, it, vi } from "vitest";
import { createShopQrSvg, getCanonicalShopUrl } from "../sharing";

afterEach(() => vi.unstubAllEnvs());

describe("shop sharing", () => {
  it("uses the configured marketing origin and preserves its scheme and port", () => {
    vi.stubEnv("MARKETING_ORIGIN", "https://example.test:8443/base");
    expect(getCanonicalShopUrl("juniper")).toBe(
      "https://juniper.example.test:8443/",
    );
    vi.stubEnv("MARKETING_ORIGIN", "http://localhost:3100");
    expect(getCanonicalShopUrl("juniper")).toBe(
      "http://juniper.localhost:3100/",
    );
  });

  it("rejects reserved labels and generates SVG for the canonical destination", async () => {
    expect(() => getCanonicalShopUrl("app")).toThrow("Invalid shop subdomain.");
    const svg = await createShopQrSvg("juniper");
    expect(svg).toContain("<svg");
    expect(svg).toContain("<path");
  });
});
