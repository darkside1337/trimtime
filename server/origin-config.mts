type Environment = Record<string, string | undefined>;

type ServerOrigins = {
  marketingOrigin: string;
  appOrigin: string;
  betterAuthUrl: string;
};

function canonicalOrigin(name: string, value: string, production: boolean) {
  let url: URL;
  try {
    if (!value || value.trim() !== value) throw new Error();
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid URL origin.`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw new Error(`${name} must use HTTP or HTTPS.`);
  if (!/^https?:\/\//i.test(value) || value.includes("\\"))
    throw new Error(`${name} must be a canonical bare origin.`);
  if (production && url.protocol !== "https:")
    throw new Error(`${name} production origin must use HTTPS.`);
  if (url.username || url.password)
    throw new Error(`${name} must not include credentials.`);
  if (url.pathname !== "/") throw new Error(`${name} must not include a path.`);
  if (value.includes("?")) throw new Error(`${name} must not include a query.`);
  if (value.includes("#"))
    throw new Error(`${name} must not include a fragment.`);
  const normalized = value.toLowerCase();
  if (
    normalized !== url.origin.toLowerCase() &&
    normalized !== `${url.origin}/`.toLowerCase()
  )
    throw new Error(`${name} must be a canonical bare origin.`);
  return url.origin;
}

export function resolveServerOrigins(env: Environment): ServerOrigins {
  const production = env.NODE_ENV === "production";
  const marketing = env.MARKETING_ORIGIN;
  const app = env.APP_ORIGIN;
  if (production && !marketing)
    throw new Error("MARKETING_ORIGIN is required in production.");
  if (production && !app)
    throw new Error("APP_ORIGIN is required in production.");
  const marketingOrigin = canonicalOrigin(
    "MARKETING_ORIGIN",
    marketing ?? "http://localhost:3100",
    production,
  );
  const appOrigin = canonicalOrigin(
    "APP_ORIGIN",
    app ?? "http://app.localhost:3100",
    production,
  );
  if (new URL(marketingOrigin).host === new URL(appOrigin).host)
    throw new Error(
      "MARKETING_ORIGIN and APP_ORIGIN must use distinct authorities.",
    );
  const betterAuthUrl =
    env.BETTER_AUTH_URL !== undefined
      ? canonicalOrigin("BETTER_AUTH_URL", env.BETTER_AUTH_URL, production)
      : appOrigin;
  if (betterAuthUrl !== appOrigin)
    throw new Error("BETTER_AUTH_URL must match APP_ORIGIN.");
  return { marketingOrigin, appOrigin, betterAuthUrl };
}
