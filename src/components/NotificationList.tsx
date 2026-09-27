"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import LocalTime from "@/components/LocalTime";
import NavIcon, { type IconName } from "@/components/NavIcon";
import { useUnreadCounts } from "@/components/UnreadCounts";
import { markAllNotificationsReadAction, markNotificationReadAction } from "@/lib/notifications/actions";
import type { NotificationKind, NotificationView } from "@/lib/notifications/describe";

const ICONS: Record<NotificationKind, IconName> = {
  chat_direct: "chat",
  chat_mention: "chat",
  chat_group: "chat",
  task_assigned: "tasks",
  draft_assigned: "communications",
  comment_mention: "comment",
  comment_reply: "comment",
};

// Opening a notification marks it read and goes to its destination (the
// destination also marks related notifications read: a conversation marks
// all of its notifications, a draft marks its own).
export default function NotificationList({
  items,
  showMarkAll = false,
  compact = false,
  onOpen,
}: {
  items: NotificationView[];
  showMarkAll?: boolean;
  compact?: boolean;
  // Called after a notification was opened (the bell panel closes itself).
  onOpen?: () => void;
}) {
  const router = useRouter();
  const unread = useUnreadCounts();
  const [isPending, startTransition] = useTransition();

  function open(item: NotificationView) {
    startTransition(async () => {
      if (item.unread) await markNotificationReadAction(item.id);
      unread.refresh();
      onOpen?.();
      router.push(item.href);
      // Client navigation does not fire hashchange; pages that react to
      // #comment-<id> / #task-<id> listen for it.
      if (item.href.includes("#")) window.setTimeout(() => window.dispatchEvent(new HashChangeEvent("hashchange")), 150);
    });
  }

  function markAll() {
    startTransition(async () => {
      await markAllNotificationsReadAction();
      unread.refresh();
      router.refresh();
    });
  }

  const anyUnread = items.some((item) => item.unread);

  return (
    <div>
      {showMarkAll && anyUnread && (
        <div className="mb-2 flex justify-end">
          <button
            type="button"
            onClick={markAll}
            disabled={isPending}
            className="rounded-full border border-neutral-200 px-3 py-1.5 text-[11.5px] font-semibold text-neutral-600 hover:border-cyan-300 hover:text-cyan-800 disabled:opacity-50"
          >
            Mark all as read
          </button>
        </div>
      )}
      <ul className="divide-y divide-neutral-50">
        {items.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              onClick={() => open(item)}
              disabled={isPending}
              data-notification={item.id}
              data-unread={item.unread ? "true" : "false"}
              className={`flex w-full items-start gap-3 text-left transition hover:bg-neutral-50 ${compact ? "py-2.5" : "px-4 py-3"}`}
            >
              <span
                className={`mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg ${
                  item.unread ? "bg-cyan-50 text-cyan-800" : "bg-neutral-100 text-neutral-400"
                }`}
              >
                <NavIcon name={ICONS[item.kind]} className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className={`block text-[12.5px] ${item.unread ? "font-semibold text-ink" : "text-neutral-600"}`}>
                  {item.title}
                  {item.unread && <span className="sr-only"> (unread)</span>}
                </span>
                {item.snippet && <span className="block truncate text-[11.5px] text-neutral-500">{item.snippet}</span>}
              </span>
              <span className="flex flex-shrink-0 flex-col items-end gap-1">
                <LocalTime date={item.at} mode="smart" className="text-[10.5px] text-neutral-400" />
                {item.unread && <span aria-hidden="true" className="h-2 w-2 rounded-full bg-cyan-500" />}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
