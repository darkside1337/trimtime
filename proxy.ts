import { NextResponse, type NextRequest } from "next/server";
import { classifyHost, shopLabelForHost } from "@/server/hosts";
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
    const destination = request.nextUrl.clone();
    destination.pathname = "/shop";
    return NextResponse.rewrite(destination);
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
