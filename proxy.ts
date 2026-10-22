import { NextResponse, type NextRequest } from "next/server";
import { classifyHost } from "@/server/hosts";

export function proxy(request: NextRequest) {
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

  if (pathname === "/design-system" || pathname.startsWith("/design-system/")) {
    return NextResponse.next();
  }

  if (surface === "marketing") {
    return pathname === "/" ? NextResponse.next() : new NextResponse(null, { status: 404 });
  }

  const destination = request.nextUrl.clone();
  destination.pathname = `/owner${pathname === "/" ? "" : pathname}`;
  return NextResponse.rewrite(destination);
}

export const config = {
  matcher: ["/((?!_next/|brand/|favicon\\.ico$|icon\\.png$|apple-icon\\.png$).*)"],
};
