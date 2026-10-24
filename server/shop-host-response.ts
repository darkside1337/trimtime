import { NextResponse, type NextRequest } from "next/server";

const body = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Shop not found · TrimTime</title><body><main><h1>This shop page isn’t available</h1><p>Check the address and try again.</p></main></body></html>`;

export function shopNotFound(request: NextRequest) {
  return new NextResponse(request.method === "HEAD" ? null : body, {
    status: 404,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

export function shopUnavailable() {
  return new NextResponse("Shop page is temporarily unavailable.", {
    status: 503,
    headers: { "cache-control": "no-store" },
  });
}
