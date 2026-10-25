import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["localtest.me", "*.localtest.me"],
  async rewrites() {
    const marketingHostname = new URL(
      process.env.MARKETING_ORIGIN ?? "http://localhost:3100",
    ).hostname.replaceAll(".", "\\.");
    const ownerHost = new URL(
      process.env.APP_ORIGIN ?? "http://app.localhost:3100",
    ).hostname;
    return {
      beforeFiles: [
        {
          source: "/",
          has: [
            {
              type: "host",
              value: `^(?!(?:app|www|api|admin)\\.)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.${marketingHostname}(?::\\d+)?$`,
            },
          ],
          destination: "/shop",
        },
        {
          source:
            "/:path((?!owner/|owner$|api/|api$|design-system/|design-system$|_next/|_next$|brand/|brand$|favicon\\.ico$|icon\\.png$|apple-icon\\.png$).*)",
          has: [{ type: "host", value: ownerHost }],
          destination: "/owner/:path*",
        },
      ],
    };
  },
  experimental: {
    agentFeedback: true,
  },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
