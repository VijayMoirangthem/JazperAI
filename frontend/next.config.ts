import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

const nextConfig: NextConfig = {
  headers: async () => [
    {
      // HTML — always revalidate
      source: "/((?!_next/static|_next/image|favicon.ico).*)",
      headers: [{ key: "Cache-Control", value: "no-cache, must-revalidate" }],
    },
    {
      // Static JS/CSS chunks:
      // - Dev: no-store so Turbopack recompiles are always picked up fresh
      // - Prod: immutable — Next.js content-hashes every filename so it's safe
      source: "/_next/static/:path*",
      headers: [
        {
          key: "Cache-Control",
          value: isDev
            ? "no-store"
            : "public, max-age=31536000, immutable",
        },
      ],
    },
  ],
};

export default nextConfig;
