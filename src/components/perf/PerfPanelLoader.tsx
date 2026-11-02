"use client";

import dynamic from "next/dynamic";
import { useEffect } from "react";

// The panel code is its own chunk, fetched only when the server rendered this
// component (flag on + ?perf=1 + admin).
const PerfPanel = dynamic(() => import("./PerfPanel"), { ssr: false });

export default function PerfPanelLoader() {
  useEffect(() => {
    // Approximate end of hydration for this part of the page.
    try {
      performance.mark("vq-perf-hydrated");
    } catch {
      /* marks unavailable */
    }
  }, []);
  return <PerfPanel />;
}
