"use client";

import dynamic from "next/dynamic";

// The assistant button pulls in the animation library (about 180 KB of
// JavaScript). It sits at the corner of the screen and nothing depends on it
// during the first paint, so it loads after the page instead of before it.
const VanquishAI = dynamic(() => import("@/components/VanquishAI"), { ssr: false });

export default function VanquishAILazy() {
  return <VanquishAI />;
}
