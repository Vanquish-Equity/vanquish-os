import Link from "next/link";
import HomeGreeting from "@/components/home/HomeGreeting";
import HomeInboxLinks from "@/components/home/HomeInboxLinks";
import MyTasksCard from "@/components/home/MyTasksCard";
import NeedsAttentionPanel from "@/components/home/NeedsAttentionPanel";
import NavIcon, { type IconName } from "@/components/NavIcon";
import NotificationList from "@/components/NotificationList";
import RefreshOnUnreadChange from "@/components/RefreshOnUnreadChange";
import RelativeTime from "@/components/RelativeTime";
import { can, type AccessState } from "@/lib/auth/permissions";
import { loadDirectory } from "@/lib/chat/queries";
import { loadHomeData } from "@/lib/home/data";
import { loadNotifications } from "@/lib/notifications/queries";
import { startDevPageTimer } from "@/lib/performance";
import { createClient } from "@/lib/supabase/server";
import { greetingName, introCard } from "@/lib/ui/entrance";
import { REVIEW_HREF } from "@/lib/tasks/tabs";

type Member = Extract<AccessState, { status: "member" }>;

// Home > Today: "what do I need to attend to today?". Runs only when this tab
// is the active one. Creating things (New task, New email draft, New message)
// is left to the top bar's "+ New", which offers the same flows.
export default async function TodayTab({ access }: { access: Member }) {
  const canDocuments = can(access, "documents");
  const canPortfolio = can(access, "portfolio");
  const supabase = await createClient();
  const endTimer = startDevPageTimer("page:data:home");
  const [data, directory] = await Promise.all([
    loadHomeData(supabase, { email: access.email, canDocuments, canPortfolio }),
    loadDirectory(supabase),
  ]);
  // With migration 0018 the notices come from the notifications inbox; the
  // notices derived from tasks and drafts are only the fallback without it,
  // so an event never shows twice.
  const notifications = await loadNotifications(supabase, access.email, directory, { limit: 6 });
  endTimer();

  const name = greetingName(access.displayName, access.providerName);

  const shortcuts: { href: string; label: string; detail: string; icon: IconName }[] = [
    { href: "/pipeline", label: "Pipeline", detail: "Deals by stage", icon: "pipeline" },
    { href: "/companies", label: "Companies", detail: "Search and open companies", icon: "companies" },
    { href: "/people?view=lps", label: "Potential LPs", detail: "Contacts and CSV import", icon: "people" },
    { href: REVIEW_HREF, label: "Review queue", detail: "Decide open review items", icon: "review" },
    ...(canPortfolio
      ? [{ href: "/portfolio", label: "Portfolio", detail: "Vehicles and positions", icon: "portfolio" as IconName }]
      : []),
  ];

  const card = "vq-card-static vq-intro-card rounded-[14px] bg-white p-5";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <HomeGreeting name={name} />
        <HomeInboxLinks />
      </div>

      <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-2 xl:grid-cols-[1.2fr_1fr]">
        <section aria-labelledby="home-tasks" data-comment-anchor="home-tasks" data-comment-label="My tasks" className={card} style={introCard(0)}>
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 id="home-tasks" className="text-[14.5px] font-semibold text-ink">
              My tasks
            </h2>
            <Link href="/tasks?new=1" className="text-[11.5px] font-semibold text-cyan-700 hover:underline">
              New task
            </Link>
          </div>
          <MyTasksCard
            available={data.tasks.available}
            tasks={data.tasks.items}
            unassignedOpen={data.tasks.unassignedOpen}
          />
        </section>

        <NeedsAttentionPanel
          items={data.attention}
          staleDeals={data.staleDeals}
          importedDeals={data.importedDeals}
          introIndex={1}
        />

        <section aria-labelledby="home-notices" data-comment-anchor="home-notices" data-comment-label="Notices for you" className={card} style={introCard(2)}>
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 id="home-notices" className="text-[14.5px] font-semibold text-ink">
              Notices for you
            </h2>
            {notifications !== null && (
              <Link href="/notifications" className="text-[11.5px] font-semibold text-cyan-700 hover:underline">
                All notifications
              </Link>
            )}
          </div>
          {notifications !== null ? (
            <>
              <RefreshOnUnreadChange />
              {notifications.length === 0 ? (
                <div className="text-[12.5px] text-neutral-500">
                  <p className="font-semibold text-ink">No notifications yet.</p>
                  <p className="mt-1">
                    Direct messages, @mentions, group messages, and tasks or email drafts assigned to you appear here.
                    Only events from Vanquish OS appear; email accounts are not connected.
                  </p>
                </div>
              ) : (
                <NotificationList items={notifications} compact />
              )}
            </>
          ) : data.notices.length === 0 ? (
            <div className="text-[12.5px] text-neutral-500">
              <p className="font-semibold text-ink">No new notices.</p>
              <p className="mt-1">
                You will see here when someone assigns you a task or prepares an email draft for you (last 14 days). Only
                events from Vanquish OS appear; email accounts are not connected.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-neutral-50">
              {data.notices.map((notice) => (
                <li key={notice.key}>
                  <Link href={notice.href} className="group flex items-start justify-between gap-3 py-2.5">
                    <span className="text-[12.5px] text-ink group-hover:text-cyan-700">{notice.text}</span>
                    <RelativeTime date={notice.at} className="flex-shrink-0 text-[11px] text-neutral-400" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="home-actions" data-comment-anchor="home-actions" data-comment-label="Shortcuts" className={card} style={introCard(3)}>
          <h2 id="home-actions" className="mb-3 text-[14.5px] font-semibold text-ink">
            Shortcuts
          </h2>
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {shortcuts.map((action) => (
              <li key={action.href}>
                <Link
                  href={action.href}
                  className="flex items-center gap-3 rounded-xl bg-[#f7f9fa] px-3 py-2.5 transition hover:ring-1 hover:ring-cyan-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400"
                >
                  <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-white text-cyan-800 ring-1 ring-neutral-100">
                    <NavIcon name={action.icon} className="h-4 w-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[12.5px] font-semibold text-ink">{action.label}</span>
                    <span className="block truncate text-[11px] text-neutral-500">{action.detail}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
