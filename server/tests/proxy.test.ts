import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { classifyHost } from "@/server/hosts";
import nextConfig from "../../next.config";
import { config, proxy } from "../../proxy";

const publicShopExists = vi.hoisted(() => vi.fn(async () => false));
vi.mock("../../features/shops/public-queries", () => ({ publicShopExists }));

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

  it("continues a validated shop root to the same-origin rewrite", async () => {
    publicShopExists.mockResolvedValueOnce(true);
    const shopRequest = new NextRequest("http://localhost:3100/", {
      headers: {
        host: "coldtrims.localhost:3100",
        "x-forwarded-host": "coldtrims.localhost:3100",
      },
    });
    expect(classifyHost(shopRequest.headers)).toBe("shop");

    const response = await proxy(shopRequest);

    expect(response.headers.get("x-middleware-next")).toBe("1");

    const rewrites = await nextConfig.rewrites?.();
    expect(Array.isArray(rewrites)).toBe(false);
    if (!Array.isArray(rewrites)) {
      const shopRewrite = rewrites?.beforeFiles?.find(
        (rewrite) => rewrite.destination === "/shop",
      );
      const hostPattern = new RegExp(shopRewrite?.has?.[0].value ?? "$");
      expect(shopRewrite?.source).toBe("/");
      expect(hostPattern.test("coldtrims.localhost:3100")).toBe(true);
      expect(hostPattern.test("app.localhost:3100")).toBe(false);
    }

    const action = new NextRequest("http://localhost:3100/", {
      method: "POST",
      headers: {
        host: "coldtrims.localhost:3100",
        "x-forwarded-host": "coldtrims.localhost:3100",
        origin: "https://coldtrims.localhost:3100",
        "next-action": "action-id",
      },
    });
    expect((await proxy(action)).headers.get("x-middleware-next")).toBe("1");
  });

  it("rejects shop-host owner paths, writes, and conflicting forwarded hosts", async () => {
    expect(
      (await proxy(request("/settings", "shop.localhost:3100"))).status,
    ).toBe(404);
    expect((await proxy(request("/shop", "shop.localhost:3100"))).status).toBe(
      404,
    );
    expect(
      (await proxy(request("/", "shop.localhost:3100", "POST"))).status,
    ).toBe(404);
    const conflicting = request("/");
    conflicting.headers.set("x-forwarded-host", "localhost:3100");
    expect((await proxy(conflicting)).status).toBe(404);
  });

  it("allows only shop-root Server Actions and private read-only manage paths", async () => {
    const action = request("/", "shop.localhost:3100", "POST");
    action.headers.set("next-action", "action-id");
    action.headers.set("origin", "http://shop.localhost:3100");
    expect((await proxy(action)).headers.get("x-middleware-next")).toBe("1");

    const forged = request("/", "shop.localhost:3100", "POST");
    forged.headers.set("next-action", "action-id");
    forged.headers.set("origin", "http://other.localhost:3100");
    expect((await proxy(forged)).status).toBe(404);
    expect(
      (await proxy(request("/unrelated", "shop.localhost:3100", "POST")))
        .status,
    ).toBe(404);

    for (const method of ["GET", "HEAD"]) {
      const response = await proxy(
        request("/manage/not-a-valid-token", "shop.localhost:3100", method),
      );
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(response.headers.get("referrer-policy")).toBe("no-referrer");
      expect(response.headers.get("x-robots-tag")).toContain("noindex");
    }
    expect(
      (
        await proxy(
          request("/manage/token/cancel", "shop.localhost:3100", "POST"),
        )
      ).status,
    ).toBe(404);
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
