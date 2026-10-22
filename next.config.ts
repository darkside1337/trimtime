import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["localtest.me", "*.localtest.me"],
  async rewrites() {
    const ownerHost = new URL(
      process.env.APP_ORIGIN ?? "http://app.localhost:3100",
    ).hostname;
    return {
      beforeFiles: [
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
