"use client";

import { useEffect } from "react";
import { maybeSyncRelationships } from "@/lib/relationships/actions";

// Once per browser tab, asks the server to refresh this member's
// relationship history. The server does nothing unless the member turned it
// on in Settings and the last sync is a few hours old. Never blocks or
// reloads the page.
export default function RelationshipAutoSync() {
  useEffect(() => {
    const key = "vq-relationship-sync";
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "1");
    } catch {
      // Storage unavailable: still try once for this page load.
    }
    void maybeSyncRelationships().catch(() => undefined);
  }, []);
  return null;
}
