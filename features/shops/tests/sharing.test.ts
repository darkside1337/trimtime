import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("shop sharing", () => {
  it("uses the configured marketing origin and preserves its scheme and port", async () => {
    vi.stubEnv("MARKETING_ORIGIN", "https://example.test:8443/");
    vi.resetModules();
    const { getCanonicalShopUrl } = await import("../sharing");
    expect(getCanonicalShopUrl("juniper")).toBe(
      "https://juniper.example.test:8443/",
    );
    vi.stubEnv("MARKETING_ORIGIN", "http://localhost:3100");
    vi.resetModules();
    const { getCanonicalShopUrl: localShopUrl } = await import("../sharing");
    expect(localShopUrl("juniper")).toBe("http://juniper.localhost:3100/");
  });

  it("rejects reserved labels and generates SVG for the canonical destination", async () => {
    const { getCanonicalShopUrl, createShopQrSvg } = await import("../sharing");
    expect(() => getCanonicalShopUrl("app")).toThrow("Invalid shop subdomain.");
    const svg = await createShopQrSvg("juniper");
    expect(svg).toContain("<svg");
    expect(svg).toContain("<path");
  });
});
