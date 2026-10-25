import { serverOrigins } from "./config";

const ownerOrigin = serverOrigins.appOrigin;

export const ownerAuthOptions = {
  appName: "TrimTime",
  baseURL: serverOrigins.betterAuthUrl,
  secret:
    process.env.BETTER_AUTH_SECRET ??
    (process.env.NEXT_PHASE === "phase-production-build"
      ? "build-only-placeholder-secret-that-is-never-used"
      : undefined),
  trustedOrigins: [ownerOrigin],
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    },
  },
  session: {
    cookieCache: {
      enabled: false,
    },
  },
};
