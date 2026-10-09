"use client";

import { useEffect } from "react";
import { maybeScanMailbox } from "@/lib/scouting/actions";

// Company scouting retains its browser/manual scan. Relationship history is
// processed by the durable external worker, never by this component.
export default function RelationshipAutoSync() {
  useEffect(() => {
    const key = "vq-company-scouting";
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "1");
    } catch {
      // Storage unavailable: still try once for this page load.
    }
    void maybeScanMailbox().catch(() => undefined);
  }, []);
  return null;
}
