import type { NextConfig } from "next";
import { resolveServerOrigins } from "./server/origin-config.mts";

const { marketingOrigin, appOrigin } = resolveServerOrigins(process.env);

const nextConfig: NextConfig = {
  ...(process.env.TRIMTIME_E2E_SERVER === "dev"
    ? {
        distDir: ".next-e2e-dev",
        typescript: { tsconfigPath: ".e2e-dev-config/tsconfig.json" },
      }
    : {}),
  allowedDevOrigins: ["localtest.me", "*.localtest.me"],
  async rewrites() {
    const marketingHostname = new URL(marketingOrigin).hostname.replaceAll(
      ".",
      "\\.",
    );
    const ownerHost = new URL(appOrigin).hostname;
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
