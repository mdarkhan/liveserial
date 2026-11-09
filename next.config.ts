import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Every page here shows live, per-user data, so we use the classic dynamic
  // rendering model instead of Cache Components / partial prerendering.
  cacheComponents: false,
  poweredByHeader: false,
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
