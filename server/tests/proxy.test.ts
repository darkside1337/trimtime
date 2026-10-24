import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { config, proxy } from "../../proxy";

vi.mock("@/features/shops/public-queries", () => ({
  publicShopExists: vi.fn(async () => false),
}));

function request(path: string, host = "app.localhost:3100", method = "GET") {
  return new NextRequest(`http://${host}${path}`, {
    method,
    headers: { host },
  });
}

describe("host routing", () => {
  it.each(["GET", "POST"])(
    "passes owner %s requests to Next routing without losing callback queries",
    async (method) => {
      const ownerRequest = request(
        "/sign-in?error=access_denied",
        undefined,
        method,
      );
      const response = await proxy(ownerRequest);
      expect(response.headers.get("x-middleware-next")).toBe("1");
      expect(ownerRequest.nextUrl.searchParams.get("error")).toBe(
        "access_denied",
      );
    },
  );

  it.each(["/sign-in", "/setup", "/settings"])(
    "rejects marketing %s before dispatching actions",
    async (path) => {
      expect(
        await proxy(request(path, "localhost:3100", "POST")),
      ).toHaveProperty("status", 404);
    },
  );

  it.each(["/owner", "/owner/settings", "/owner/settings.png"])(
    "blocks direct internal destination %s",
    async (path) => {
      for (const host of ["localhost:3100", "app.localhost:3100"]) {
        expect((await proxy(request(path, host))).status).toBe(404);
        expect(
          unstable_doesMiddlewareMatch({
            config,
            url: `http://${host}${path}`,
          }),
        ).toBe(true);
      }
    },
  );

  it("does not confuse a similar path with an internal destination", async () => {
    expect(
      (await proxy(request("/owner-example"))).headers.get("x-middleware-next"),
    ).toBe("1");
  });

  it("rejects shop-host owner paths, writes, and conflicting forwarded hosts", async () => {
    expect(
      (await proxy(request("/settings", "shop.localhost:3100"))).status,
    ).toBe(404);
    expect(
      (await proxy(request("/", "shop.localhost:3100", "POST"))).status,
    ).toBe(404);
    const conflicting = request("/");
    conflicting.headers.set("x-forwarded-host", "localhost:3100");
    expect((await proxy(conflicting)).status).toBe(404);
  });

  it("keeps auth endpoints on the owner host and preserves shared specimens", async () => {
    expect(
      (await proxy(request("/api/auth/get-session"))).headers.get(
        "x-middleware-next",
      ),
    ).toBe("1");
    expect(
      (await proxy(request("/api/auth/get-session", "localhost:3100"))).status,
    ).toBe(404);
    for (const host of ["localhost:3100", "app.localhost:3100"]) {
      expect(
        (await proxy(request("/design-system", host))).headers.get(
          "x-middleware-next",
        ),
      ).toBe("1");
    }
    expect(
      (await proxy(request("/", "localhost:3100"))).headers.get(
        "x-middleware-next",
      ),
    ).toBe("1");
  });

  it.each([
    "/_next/static/chunk.js",
    "/_next/image",
    "/_next/webpack-hmr",
    "/brand/soft-welcome/horizontal-primary.svg",
    "/favicon.ico",
    "/icon.png",
    "/apple-icon.png",
  ])("leaves resource %s outside Proxy", (path) => {
    expect(
      unstable_doesMiddlewareMatch({
        config,
        url: `http://localhost:3100${path}`,
      }),
    ).toBe(false);
  });

  it.each(["/faviconXico", "/icon.png-extra", "/_next-example"])(
    "does not bypass routing for resource lookalike %s",
    (path) => {
      expect(
        unstable_doesMiddlewareMatch({
          config,
          url: `http://localhost:3100${path}`,
        }),
      ).toBe(true);
    },
  );
});
