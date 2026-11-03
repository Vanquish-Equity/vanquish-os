import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pdf-parse", "pdfjs-dist"],
  // Dev logs print every server action's arguments (contact emails, draft
  // recipients). Keep them out of terminals and shared logs.
  logging: {
    serverFunctions: false,
  },
  // Overview and Reporting became tabs of Home. Temporary (307) redirects so
  // bookmarks, notification links and saved landing pages keep working and the
  // move can be reversed. Query values of the request are passed through by
  // Next.js and the browser keeps a #fragment. `/api/reporting/*` is not
  // matched: exports stay where they are.
  async redirects() {
    return [
      { source: "/overview", destination: "/home?tab=dashboard", permanent: false },
      { source: "/reporting", destination: "/home?tab=reports", permanent: false },
      // Action center and Review became tabs of Tasks (same rules: temporary,
      // query and #fragment preserved). Neither old route had sub-routes.
      { source: "/inbox", destination: "/tasks?tab=activity", permanent: false },
      { source: "/review", destination: "/tasks?tab=review", permanent: false },
    ];
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
