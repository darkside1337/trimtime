import "server-only";

const marketingOrigin = process.env.MARKETING_ORIGIN ?? "http://localhost:3100";
const ownerOrigin = process.env.APP_ORIGIN ?? "http://app.localhost:3100";

function originHost(origin: string) {
  return new URL(origin).host.toLowerCase();
}

export function classifyHost(headers: Headers): "marketing" | "owner" | null {
  const host = headers.get("host")?.toLowerCase();
  const forwardedHost = headers.get("x-forwarded-host")?.toLowerCase();
  if (!host || host.includes(",") || (forwardedHost && forwardedHost !== host))
    return null;
  try {
    if (new URL(`http://${host}`).host !== host) return null;
  } catch {
    return null;
  }
  if (host === originHost(marketingOrigin)) return "marketing";
  if (host === originHost(ownerOrigin)) return "owner";
  return null;
}

export function hasOwnerOrigin(headers: Headers) {
  return headers.get("origin") === ownerOrigin;
}
