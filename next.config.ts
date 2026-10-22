import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // three.js ships untranspiled ESM in a few sub-paths; Next handles it natively,
  // but we keep the transpile hint so drei's deep imports resolve cleanly.
  transpilePackages: ["three"],
  experimental: {
    optimizePackageImports: ["lucide-react", "motion"],
  },
};

export default nextConfig;
