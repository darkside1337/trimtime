const ownerOrigin = process.env.APP_ORIGIN ?? "http://app.localhost:3100";

export const ownerAuthOptions = {
  appName: "TrimTime",
  baseURL: process.env.BETTER_AUTH_URL ?? ownerOrigin,
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
