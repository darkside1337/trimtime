import { NextResponse, type NextRequest } from "next/server";
import {
  classifyHost,
  hasRequestOrigin,
  shopLabelForHost,
} from "@/server/hosts";
import { shopNotFound, shopUnavailable } from "@/server/shop-host-response";

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (pathname === "/owner" || pathname.startsWith("/owner/")) {
    return new NextResponse(null, { status: 404 });
  }

  const surface = classifyHost(request.headers);
  if (!surface) return new NextResponse(null, { status: 404 });

  if (pathname.startsWith("/api/")) {
    return surface === "owner"
      ? NextResponse.next()
      : new NextResponse(null, { status: 404 });
  }

  if (surface === "shop") {
    const label = shopLabelForHost(request.headers);
    if (
      /^\/manage\/[^/]+\/?$/.test(pathname) &&
      (request.method === "GET" || request.method === "HEAD")
    ) {
      const response = NextResponse.next();
      response.headers.set("Cache-Control", "private, no-store");
      response.headers.set("Referrer-Policy", "no-referrer");
      response.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
      return response;
    }
    if (
      pathname === "/" &&
      request.method === "POST" &&
      request.headers.has("next-action") &&
      hasRequestOrigin(request.headers)
    ) {
      return NextResponse.next();
    }
    if (
      !label ||
      pathname !== "/" ||
      (request.method !== "GET" && request.method !== "HEAD")
    )
      return shopNotFound(request);
    try {
      const { publicShopExists } =
        await import("@/features/shops/public-queries");
      if (!(await publicShopExists(label))) return shopNotFound(request);
    } catch {
      return shopUnavailable();
    }
    return NextResponse.next();
  }

  if (pathname === "/design-system" || pathname.startsWith("/design-system/")) {
    return NextResponse.next();
  }

  if (surface === "marketing") {
    return pathname === "/"
      ? NextResponse.next()
      : new NextResponse(null, { status: 404 });
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/|brand/|favicon\\.ico$|icon\\.png$|apple-icon\\.png$).*)",
  ],
};
