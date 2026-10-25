import { describe, expect, it, vi } from "vitest";
import { classifyHost, hasOwnerOrigin, hasRequestOrigin } from "../hosts";

describe("approved hosts", () => {
  it("uses configured production origins and rejects deceptive suffixes", async () => {
    vi.stubEnv("APP_ORIGIN", "https://app.example.test");
    vi.stubEnv("MARKETING_ORIGIN", "https://example.test");
    vi.resetModules();
    try {
      const {
        classifyHost: classify,
        hasOwnerOrigin: ownerOrigin,
        hasRequestOrigin: requestOrigin,
      } = await import("../hosts");
      expect(classify(new Headers({ host: "EXAMPLE.TEST" }))).toBe("marketing");
      expect(
        classify(
          new Headers({
            host: "app.example.test",
            "x-forwarded-host": "app.example.test",
          }),
        ),
      ).toBe("owner");
      expect(classify(new Headers({ host: "juniper.example.test" }))).toBe(
        "shop",
      );
      expect(
        classify(new Headers({ host: "app.example.test.attacker.test" })),
      ).toBeNull();
      expect(
        classify(new Headers({ host: "app.example.test:3100" })),
      ).toBeNull();
      expect(
        ownerOrigin(new Headers({ origin: "https://app.example.test" })),
      ).toBe(true);
      expect(
        ownerOrigin(new Headers({ origin: "http://app.example.test" })),
      ).toBe(false);
      expect(
        requestOrigin(
          new Headers({
            host: "juniper.example.test",
            origin: "https://juniper.example.test",
          }),
        ),
      ).toBe(true);
      expect(
        requestOrigin(
          new Headers({
            host: "juniper.example.test",
            origin: "http://juniper.example.test",
          }),
        ),
      ).toBe(false);
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });

  it("recognizes only exact local marketing and owner hosts", () => {
    expect(classifyHost(new Headers({ host: "localhost:3100" }))).toBe(
      "marketing",
    );
    expect(classifyHost(new Headers({ host: "app.localhost:3100" }))).toBe(
      "owner",
    );
    expect(classifyHost(new Headers({ host: "juniper.localhost:3100" }))).toBe(
      "shop",
    );
  });

  it("rejects deceptive, malformed, wrong-port, and conflicting forwarded hosts", () => {
    const invalidHosts: Record<string, string>[] = [
      { host: "app.localhost.evil.test:3100" },
      { host: "foo.bar.localhost:3100" },
      { host: "app.localhost:3000" },
      { host: "app.localhost:3100", "x-forwarded-host": "localhost:3100" },
      { host: "app.localhost:3100, evil.test" },
    ];
    for (const headers of invalidHosts) {
      expect(classifyHost(new Headers(headers))).toBeNull();
    }
  });

  it("requires the exact owner origin for writes", () => {
    expect(
      hasOwnerOrigin(new Headers({ origin: "http://app.localhost:3100" })),
    ).toBe(true);
    expect(
      hasOwnerOrigin(new Headers({ origin: "http://localhost:3100" })),
    ).toBe(false);
    expect(hasOwnerOrigin(new Headers())).toBe(false);
  });

  it("matches request origins to the configured local HTTP scheme", () => {
    expect(
      hasRequestOrigin(
        new Headers({
          host: "juniper.localhost:3100",
          origin: "http://juniper.localhost:3100",
        }),
      ),
    ).toBe(true);
    expect(
      hasRequestOrigin(
        new Headers({
          host: "juniper.localhost:3100",
          origin: "https://juniper.localhost:3100",
        }),
      ),
    ).toBe(false);
  });
});
