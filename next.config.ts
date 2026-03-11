import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      { source: "/analyze", destination: "/parser", permanent: true },
    ];
  },
};

export default nextConfig;
