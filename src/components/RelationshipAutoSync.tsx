"use client";

import { useEffect } from "react";
import { maybeSyncRelationships } from "@/lib/relationships/actions";
import { maybeScanMailbox } from "@/lib/scouting/actions";

// Once per browser tab, asks the server to refresh this member's
// relationship history and email scouting. The server does nothing unless
// the member turned each on (scouting: the Admin-granted permission) and the
// last run is a few hours old. Never blocks or
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
    // One after the other, so two Gmail jobs never run at the same time.
    void maybeSyncRelationships()
      .catch(() => undefined)
      .then(() => maybeScanMailbox())
      .catch(() => undefined);
  }, []);
  return null;
}
