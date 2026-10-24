import "server-only";

const marketingOrigin = process.env.MARKETING_ORIGIN ?? "http://localhost:3100";
const ownerOrigin = process.env.APP_ORIGIN ?? "http://app.localhost:3100";

function originHost(origin: string) {
  return new URL(origin).host.toLowerCase();
}

export function shopLabelForHost(headers: Headers): string | null {
  const host = headers.get("host")?.toLowerCase();
  const forwardedHost = headers.get("x-forwarded-host")?.toLowerCase();
  if (!host || host.includes(",") || (forwardedHost && forwardedHost !== host))
    return null;
  try {
    if (new URL(`http://${host}`).host !== host) return null;
  } catch {
    return null;
  }
  const base = new URL(marketingOrigin);
  const suffix = `.${base.host.toLowerCase()}`;
  if (!host.endsWith(suffix)) return null;
  const label = host.slice(0, -suffix.length);
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) return null;
  if (["app", "www", "api", "admin"].includes(label)) return null;
  return label;
}

export function classifyHost(
  headers: Headers,
): "marketing" | "owner" | "shop" | null {
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
  return shopLabelForHost(headers) ? "shop" : null;
}

export function hasOwnerOrigin(headers: Headers) {
  return headers.get("origin") === ownerOrigin;
}
