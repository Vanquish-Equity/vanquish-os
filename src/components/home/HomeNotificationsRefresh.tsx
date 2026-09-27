"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { useUnreadCounts } from "@/components/UnreadCounts";

// Re-renders Home's notification preview when the unread count changes
// (a new notification arrived, or some were read elsewhere).
export default function HomeNotificationsRefresh() {
  const router = useRouter();
  const { notifications } = useUnreadCounts();
  const previous = useRef(notifications);

  useEffect(() => {
    if (previous.current === notifications) return;
    previous.current = notifications;
    router.refresh();
  }, [notifications, router]);

  return null;
}
