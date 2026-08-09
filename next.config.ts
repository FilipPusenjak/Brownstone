import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typedRoutes: true,
  // Next 16 writes AGENTS.md and CLAUDE.md into the repo root on first run.
  // This project documents itself in README.md and ARCHITECTURE.md.
  agentRules: false,
  experimental: {
    // Server Actions carry file metadata and form payloads, not files
    // themselves — uploads go straight to object storage over a presigned PUT.
    serverActions: { bodySizeLimit: "1mb" },
  },
};

export default nextConfig;
