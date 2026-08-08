import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typedRoutes: true,
  experimental: {
    // Server Actions carry file metadata and form payloads, not files
    // themselves — uploads go straight to object storage over a presigned PUT.
    serverActions: { bodySizeLimit: "1mb" },
  },
};

export default nextConfig;
