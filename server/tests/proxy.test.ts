import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { getRewrittenUrl, unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { config, proxy } from "../../proxy";

function request(path: string, host = "app.localhost:3100", method = "GET") {
  return new NextRequest(`http://${host}${path}`, { method, headers: { host } });
}

describe("host routing", () => {
  it.each(["GET", "POST"])("rewrites owner %s requests without losing callback queries", (method) => {
    const response = proxy(request("/sign-in?error=access_denied", undefined, method));
    expect(getRewrittenUrl(response)).toBe("http://app.localhost:3100/owner/sign-in?error=access_denied");
    expect(getRewrittenUrl(proxy(request("/")))).toBe("http://app.localhost:3100/owner");
  });

  it.each(["/sign-in", "/setup", "/settings"])("rejects marketing %s before dispatching actions", (path) => {
    expect(proxy(request(path, "localhost:3100", "POST")).status).toBe(404);
  });

  it.each(["/owner", "/owner/settings", "/owner/settings.png"])("blocks direct internal destination %s", (path) => {
    for (const host of ["localhost:3100", "app.localhost:3100"]) {
      expect(proxy(request(path, host)).status).toBe(404);
      expect(unstable_doesMiddlewareMatch({ config, url: `http://${host}${path}` })).toBe(true);
    }
  });

  it("does not confuse a similar path with an internal destination", () => {
    expect(getRewrittenUrl(proxy(request("/owner-example")))).toBe("http://app.localhost:3100/owner/owner-example");
  });

  it("rejects unsupported hosts and conflicting forwarded hosts", () => {
    expect(proxy(request("/", "shop.localhost:3100")).status).toBe(404);
    const conflicting = request("/");
    conflicting.headers.set("x-forwarded-host", "localhost:3100");
    expect(proxy(conflicting).status).toBe(404);
  });

  it("keeps auth endpoints on the owner host and preserves shared specimens", () => {
    expect(proxy(request("/api/auth/get-session")).headers.get("x-middleware-next")).toBe("1");
    expect(proxy(request("/api/auth/get-session", "localhost:3100")).status).toBe(404);
    for (const host of ["localhost:3100", "app.localhost:3100"]) {
      expect(proxy(request("/design-system", host)).headers.get("x-middleware-next")).toBe("1");
    }
    expect(proxy(request("/", "localhost:3100")).headers.get("x-middleware-next")).toBe("1");
  });

  it.each(["/_next/static/chunk.js", "/_next/image", "/_next/webpack-hmr", "/brand/soft-welcome/horizontal-primary.svg", "/favicon.ico", "/icon.png", "/apple-icon.png"])("leaves resource %s outside Proxy", (path) => {
    expect(unstable_doesMiddlewareMatch({ config, url: `http://localhost:3100${path}` })).toBe(false);
  });

  it.each(["/faviconXico", "/icon.png-extra", "/_next-example"])("does not bypass routing for resource lookalike %s", (path) => {
    expect(unstable_doesMiddlewareMatch({ config, url: `http://localhost:3100${path}` })).toBe(true);
  });
});
