import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  eslint: { ignoreDuringBuilds: true },
  experimental: {
    serverActions: {
      // Enrolling drafts one email per prospect with Claude inside a single
      // request -- roughly five seconds each, so a hundred prospects is over
      // eight minutes. The default body limit is 1MB, which a long list of
      // UUIDs approaches, and the proxy in front now allows 600s.
      bodySizeLimit: "4mb",
    },
  },
};

export default nextConfig;
