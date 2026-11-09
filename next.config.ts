import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: ".next-node",
  output: "standalone",
  poweredByHeader: false,
};

export default nextConfig;
