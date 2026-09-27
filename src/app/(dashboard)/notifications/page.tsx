import Link from "next/link";
import NotificationList from "@/components/NotificationList";
import { requireMember } from "@/lib/auth/access";
import { loadDirectory } from "@/lib/chat/queries";
import { loadNotifications } from "@/lib/notifications/queries";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const { view } = await searchParams;
  const unreadOnly = view !== "all";
  const access = await requireMember();
  const supabase = await createClient();
  const directory = await loadDirectory(supabase);
  const items = await loadNotifications(supabase, access.email, directory, { unreadOnly, limit: 100 });

  const tab = (active: boolean) =>
    `rounded-full px-3 py-1.5 text-[11.5px] font-semibold transition ${
      active ? "bg-ink text-white" : "border border-neutral-200 text-neutral-600 hover:border-cyan-300 hover:text-cyan-800"
    }`;

  return (
    <div className="flex flex-col gap-4 px-4 py-6 sm:px-7">
      <header>
        <h1 className="font-[family-name:var(--font-display)] text-[23px] font-semibold tracking-tight text-ink">Notifications</h1>
        <p className="mt-1 text-[13px] text-neutral-500">
          Direct messages, @mentions, group messages, and tasks or email drafts assigned to you.
        </p>
      </header>
      <nav aria-label="Notification views" className="flex gap-2">
        <Link href="/notifications" className={tab(unreadOnly)} aria-current={unreadOnly ? "page" : undefined}>
          Unread
        </Link>
        <Link href="/notifications?view=all" className={tab(!unreadOnly)} aria-current={!unreadOnly ? "page" : undefined}>
          All
        </Link>
      </nav>
      <section className="vq-card-static rounded-[14px] bg-white py-2">
        {items === null ? (
          <p className="px-4 py-8 text-center text-[12.5px] text-neutral-500">
            Notifications are not available yet: database migration 0018 has not been applied.
          </p>
        ) : items.length === 0 ? (
          <div className="px-4 py-10 text-center text-[12.5px] text-neutral-500">
            <p className="font-semibold text-ink">{unreadOnly ? "You are all caught up." : "No notifications yet."}</p>
            <p className="mt-1">
              You are notified when someone messages you, mentions you, writes in one of your groups, or assigns you a task or an
              email draft.
            </p>
          </div>
        ) : (
          <div className="px-2">
            <NotificationList items={items} showMarkAll />
          </div>
        )}
      </section>
    </div>
  );
}
