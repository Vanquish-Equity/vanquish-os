import Link from "next/link";
import CompanyFootprint from "@/components/home/CompanyFootprint";
import { loadCompanyFootprint } from "@/lib/home/company-footprint-data";
import HomeGreeting from "@/components/home/HomeGreeting";
import HomeInboxLinks from "@/components/home/HomeInboxLinks";
import MyTasksCard from "@/components/home/MyTasksCard";
import NeedsAttentionPanel from "@/components/home/NeedsAttentionPanel";
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

type Member = Extract<AccessState, { status: "member" }>;

// Home > Today: "what do I need to attend to today?". Runs only when this tab
// is the active one. Creating things (New task, New email draft, New message)
// is left to the top bar's "+ New", which offers the same flows.
export default async function TodayTab({ access }: { access: Member }) {
  const canDocuments = can(access, "documents");
  const canPortfolio = can(access, "portfolio");
  const supabase = await createClient();
  const endTimer = startDevPageTimer("page:data:home");
  const [data, directory, reminderResult, footprint] = await Promise.all([
    loadHomeData(supabase, { email: access.email, canDocuments, canPortfolio }),
    loadDirectory(supabase),
    // Open reminders I created or am included in (RLS decides; at most 10).
    // Runs with the other loads: no extra round trip. An error hides the card.
    supabase.rpc("my_contact_reminders"),
    loadCompanyFootprint(supabase),
  ]);
  const reminders = reminderResult.error ? [] : ((reminderResult.data ?? []) as {
    id: string; title: string; due_on: string; person_id: string; person_name: string;
  }[]);
  const today = new Date().toISOString().slice(0, 10);
  // With migration 0018 the notices come from the notifications inbox; the
  // notices derived from tasks and drafts are only the fallback without it,
  // so an event never shows twice.
  const notifications = await loadNotifications(supabase, access.email, directory, { limit: 6 });
  endTimer();

  const name = greetingName(access.displayName, access.providerName);

  const card = "vq-card-static vq-intro-card rounded-[14px] bg-white p-5";

  return (
    <div className="flex flex-col gap-4">
      <section aria-label="Welcome" className="flex flex-wrap items-end justify-between gap-4 py-2 sm:py-5">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[.2em] text-cyan-800">Your workspace</p>
          <HomeGreeting name={name} />
        </div>
        <HomeInboxLinks />
      </section>
      <CompanyFootprint initial={footprint} />

      <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-2 xl:grid-cols-[1.2fr_1fr]">
        <div className="flex min-w-0 flex-col gap-3.5">
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

          <section aria-labelledby="home-notices" data-comment-anchor="home-notices" data-comment-label="Notices for you" className={card} style={introCard(1)}>
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
        </div>

        {/* On wide screens, only the left stack sets this grid row’s height. */}
        <div className="min-w-0 lg:relative">
          <div className="lg:absolute lg:inset-0">
            <NeedsAttentionPanel
              items={data.attention}
              staleDeals={data.staleDeals}
              importedDeals={data.importedDeals}
              introIndex={2}
            />
          </div>
        </div>

        {reminders.length > 0 && (
          <section aria-labelledby="home-reminders" data-comment-anchor="home-reminders" data-comment-label="My reminders" className={card} style={introCard(3)}>
            <h2 id="home-reminders" className="mb-3 text-[14.5px] font-semibold text-ink">
              My reminders
            </h2>
            <ul className="divide-y divide-neutral-50">
              {reminders.map((reminder) => (
                <li key={reminder.id} className="flex items-start justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <Link href={`/people?contact=${reminder.person_id}`} className="block truncate text-[12.5px] font-medium text-ink hover:text-cyan-700">
                      {reminder.title}
                    </Link>
                    <span className="block truncate text-[11.5px] text-neutral-500">{reminder.person_name}</span>
                  </div>
                  <span className={`flex-shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${reminder.due_on < today ? "bg-red-50 text-red-700" : "bg-neutral-100 text-neutral-600"}`}>
                    {reminder.due_on < today ? `Overdue ${reminder.due_on}` : reminder.due_on}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
