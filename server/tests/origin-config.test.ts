import { describe, expect, it, vi } from "vitest";
import { resolveServerOrigins } from "../origin-config.mts";

describe("server origin configuration", () => {
  it("shares normalized origins between host routing and Better Auth", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("MARKETING_ORIGIN", "http://localhost:4100/");
    vi.stubEnv("APP_ORIGIN", "http://app.localhost:4100/");
    vi.stubEnv("BETTER_AUTH_URL", "http://app.localhost:4100/");
    vi.resetModules();
    try {
      const [{ classifyHost: classify }, { ownerAuthOptions }] =
        await Promise.all([import("../hosts"), import("../auth-options")]);
      expect(classify(new Headers({ host: "app.localhost:4100" }))).toBe(
        "owner",
      );
      expect(ownerAuthOptions.baseURL).toBe("http://app.localhost:4100");
      expect(ownerAuthOptions.trustedOrigins).toEqual([
        "http://app.localhost:4100",
      ]);
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });

  it("requires explicit marketing and app origins in production", () => {
    expect(() => resolveServerOrigins({ NODE_ENV: "production" })).toThrow(
      /MARKETING_ORIGIN/,
    );
    expect(() =>
      resolveServerOrigins({
        NODE_ENV: "production",
        MARKETING_ORIGIN: "https://trimtime.example",
      }),
    ).toThrow(/APP_ORIGIN/);
  });

  it("normalizes one trailing slash and keeps distinct authorities", () => {
    expect(
      resolveServerOrigins({
        NODE_ENV: "production",
        MARKETING_ORIGIN: "https://TrimTime.example/",
        APP_ORIGIN: "https://app.trimtime.example",
      }),
    ).toEqual({
      marketingOrigin: "https://trimtime.example",
      appOrigin: "https://app.trimtime.example",
      betterAuthUrl: "https://app.trimtime.example",
    });
  });

  it.each([
    ["http://trimtime.example", "production origin must use HTTPS"],
    ["https://user:pass@trimtime.example", "must not include credentials"],
    ["https://trimtime.example/path", "must not include a path"],
    ["https://trimtime.example?x=1", "must not include a query"],
    ["https://trimtime.example?", "must not include a query"],
    ["https://trimtime.example#fragment", "must not include a fragment"],
    ["https://trimtime.example#", "must not include a fragment"],
    ["ftp://trimtime.example", "must use HTTP or HTTPS"],
    ["not an origin", "must be a valid URL"],
    ["https://trimtime.example/../", "must be a canonical bare origin"],
    ["https:trimtime.example", "must be a canonical bare origin"],
    ["https:\\\\trimtime.example", "must be a canonical bare origin"],
  ])("rejects invalid production origin %s", (value, message) => {
    expect(() =>
      resolveServerOrigins({
        NODE_ENV: "production",
        MARKETING_ORIGIN: value,
        APP_ORIGIN: "https://app.trimtime.example",
      }),
    ).toThrow(message);
  });

  it.each(["MARKETING_ORIGIN", "APP_ORIGIN", "BETTER_AUTH_URL"] as const)(
    "validates %s with the same origin rules",
    (name) => {
      const badOrigin =
        name === "MARKETING_ORIGIN"
          ? "https://marketing.trimtime.example/a/.."
          : "https://app.trimtime.example/a/..";
      expect(() =>
        resolveServerOrigins({
          NODE_ENV: "production",
          MARKETING_ORIGIN: "https://trimtime.example",
          APP_ORIGIN: "https://app.trimtime.example",
          [name]: badOrigin,
        }),
      ).toThrow(/canonical bare origin/);
    },
  );

  it("requires distinct marketing and app authorities", () => {
    expect(() =>
      resolveServerOrigins({
        NODE_ENV: "production",
        MARKETING_ORIGIN: "https://trimtime.example",
        APP_ORIGIN: "https://trimtime.example/",
      }),
    ).toThrow(/distinct authorities/);
  });

  it("requires an explicit Better Auth URL to match the app origin", () => {
    expect(() =>
      resolveServerOrigins({
        NODE_ENV: "production",
        MARKETING_ORIGIN: "https://trimtime.example",
        APP_ORIGIN: "https://app.trimtime.example",
        BETTER_AUTH_URL: "https://auth.trimtime.example",
      }),
    ).toThrow(/BETTER_AUTH_URL.*APP_ORIGIN/);
    expect(() =>
      resolveServerOrigins({
        NODE_ENV: "production",
        MARKETING_ORIGIN: "https://trimtime.example",
        APP_ORIGIN: "https://app.trimtime.example",
        BETTER_AUTH_URL: "",
      }),
    ).toThrow(/BETTER_AUTH_URL.*valid URL origin/);
  });

  it("preserves local HTTP origins and custom ports outside production", () => {
    expect(
      resolveServerOrigins({
        NODE_ENV: "test",
        MARKETING_ORIGIN: "http://localhost:4100/",
        APP_ORIGIN: "http://app.localhost:4100",
        BETTER_AUTH_URL: "http://app.localhost:4100/",
      }),
    ).toEqual({
      marketingOrigin: "http://localhost:4100",
      appOrigin: "http://app.localhost:4100",
      betterAuthUrl: "http://app.localhost:4100",
    });
  });

  it("does not allow local HTTP origins to bypass production HTTPS", () => {
    expect(() =>
      resolveServerOrigins({
        NODE_ENV: "production",
        MARKETING_ORIGIN: "http://localhost:3100",
        APP_ORIGIN: "http://app.localhost:3100",
      }),
    ).toThrow(/production origin must use HTTPS/);
  });
});
