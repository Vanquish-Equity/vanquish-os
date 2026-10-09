import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pdf-parse", "pdfjs-dist"],
  // Dev logs print every server action's arguments (contact emails, draft
  // recipients). Keep them out of terminals and shared logs.
  logging: {
    serverFunctions: false,
  },
  experimental: {
    // Only links opted in to a full prefetch (the sidebar's read-mostly pages,
    // on hover) use `static`; everything else stays uncached (`dynamic: 0`).
    staleTimes: { dynamic: 0, static: 30 },
    serverActions: {
      bodySizeLimit: "4mb",
    },
  },
};

export default nextConfig;
