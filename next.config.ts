import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pdf-parse", "pdfjs-dist"],
  // Dev logs print every server action's arguments (contact emails, draft
  // recipients). Keep them out of terminals and shared logs.
  logging: {
    serverFunctions: false,
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "4mb",
    },
  },
};

export default nextConfig;
