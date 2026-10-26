import { isIP } from "node:net";

export type EmailConfig =
  | { mode: "mailpit"; origin: string }
  | { mode: "unavailable"; reason: "disabled" | "hosted" | "invalid_config" };

type Origin = { url: URL; local: boolean } | undefined;

function parseOrigin(value: string | undefined): Origin {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      (value !== url.origin && value !== `${url.origin}/`) ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    ) {
      return undefined;
    }
    const hostname = url.hostname.toLowerCase();
    return {
      url,
      local:
        hostname === "localhost" ||
        hostname.endsWith(".localhost") ||
        hostname === "localtest.me" ||
        hostname.endsWith(".localtest.me"),
    };
  } catch {
    return undefined;
  }
}

function isLoopback(hostname: string): boolean {
  const host = hostname.startsWith("[") ? hostname.slice(1, -1) : hostname;
  return (
    host === "localhost" ||
    (isIP(host) === 4 && host.startsWith("127.")) ||
    host === "::1"
  );
}

export function resolveEmailConfig(
  env: Record<string, string | undefined>,
): EmailConfig {
  if (env.EMAIL_MODE !== "mailpit") {
    return { mode: "unavailable", reason: "disabled" };
  }
  if (env.VERCEL) return { mode: "unavailable", reason: "hosted" };

  const appOrigin = parseOrigin(env.APP_ORIGIN);
  const marketingOrigin = parseOrigin(env.MARKETING_ORIGIN);
  if (!appOrigin || !marketingOrigin) {
    return { mode: "unavailable", reason: "invalid_config" };
  }
  if (!appOrigin.local || !marketingOrigin.local) {
    return { mode: "unavailable", reason: "hosted" };
  }
  const mailpit = parseOrigin(env.MAILPIT_ORIGIN);
  if (
    !mailpit ||
    mailpit.url.protocol !== "http:" ||
    !isLoopback(mailpit.url.hostname)
  ) {
    return { mode: "unavailable", reason: "invalid_config" };
  }
  return { mode: "mailpit", origin: mailpit.url.origin };
}
