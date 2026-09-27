"use client";

import { useEffect } from "react";
import { useUnreadCounts } from "@/components/UnreadCounts";
import { markDraftNotificationsReadAction } from "@/lib/notifications/actions";

// Opening an email draft marks the viewer's notifications about it as read,
// whether they arrived from the inbox, Home or Communications.
export default function MarkNotificationsRead({ draftId }: { draftId: string }) {
  const { available, refresh } = useUnreadCounts();
  useEffect(() => {
    if (!available) return;
    void markDraftNotificationsReadAction(draftId).then((result) => {
      if (result.ok) refresh();
    });
  }, [available, draftId, refresh]);
  return null;
}
