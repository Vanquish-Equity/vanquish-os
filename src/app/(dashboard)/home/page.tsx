import Link from "next/link";
import HomeGreeting from "@/components/home/HomeGreeting";
import MyTasksCard from "@/components/home/MyTasksCard";
import NavIcon, { type IconName } from "@/components/NavIcon";
import RelativeTime from "@/components/RelativeTime";
import { requireMember } from "@/lib/auth/access";
import { can } from "@/lib/auth/permissions";
import { loadHomeData } from "@/lib/home/data";
import { startDevPageTimer } from "@/lib/performance";
import { createClient } from "@/lib/supabase/server";
import { greetingName, introCard } from "@/lib/ui/entrance";

export const dynamic = "force-dynamic";

// Home answers "what do I need to attend to today?". Overview stays the
// view of how Vanquish is doing.
export default async function HomePage() {
  const access = await requireMember();
  const canDocuments = can(access, "documents");
  const canPortfolio = can(access, "portfolio");
  const supabase = await createClient();
  const endTimer = startDevPageTimer("page:data:home");
  const data = await loadHomeData(supabase, { email: access.email, canDocuments, canPortfolio });
  endTimer();

  const name = greetingName(access.displayName, access.providerName);

  const quickActions: { href: string; label: string; detail: string; icon: IconName }[] = [
    { href: "/tasks?new=1", label: "New task", detail: "Assign a follow-up", icon: "tasks" },
    { href: "/communications/new", label: "New email draft", detail: "Prepare a message to potential LPs", icon: "communications" },
    { href: "/pipeline", label: "Pipeline", detail: "Deals by stage", icon: "pipeline" },
    { href: "/companies", label: "Companies", detail: "Search and open companies", icon: "companies" },
    { href: "/people?view=lps", label: "Potential LPs", detail: "Contacts and CSV import", icon: "people" },
    { href: "/review", label: "Review queue", detail: "Decide open review items", icon: "review" },
    { href: "/overview", label: "Overview", detail: "How Vanquish is doing", icon: "overview" },
    ...(canPortfolio
      ? [{ href: "/portfolio", label: "Portfolio", detail: "Vehicles and positions", icon: "portfolio" as IconName }]
      : []),
  ];

  const card = "vq-card-static vq-intro-card rounded-[14px] bg-white p-5";

  return (
    <div className="flex flex-col gap-4 px-4 py-6 sm:px-7">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <HomeGreeting name={name} />
          <p className="mt-1 text-[13px] text-neutral-500">What needs your attention today.</p>
        </div>
        <Link
          href="/overview"
          className="rounded-full border border-neutral-200 px-3.5 py-2 text-[12px] font-semibold text-neutral-600 transition hover:border-cyan-300 hover:text-cyan-800"
        >
          How Vanquish is doing →
        </Link>
      </header>

      <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-2 xl:grid-cols-[1.2fr_1fr]">
        <section aria-labelledby="home-tasks" className={card} style={introCard(0)}>
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

        <section aria-labelledby="home-attention" className={card} style={introCard(1)}>
          <h2 id="home-attention" className="mb-3 text-[14.5px] font-semibold text-ink">
            Needs attention
          </h2>
          {data.attention.length === 0 ? (
            <p className="text-[12.5px] text-neutral-500">Nothing needs your attention right now.</p>
          ) : (
            <ul className="divide-y divide-neutral-50">
              {data.attention.map((item) => (
                <li key={item.key}>
                  <Link href={item.href} className="group flex items-start gap-3 py-2.5">
                    <span
                      aria-hidden="true"
                      className={`mt-1.5 h-2 w-2 flex-shrink-0 rounded-full ${item.tone === "warn" ? "bg-amber-500" : "bg-cyan-500"}`}
                    />
                    <span className="min-w-0">
                      <span className="block truncate text-[12.5px] font-medium text-ink group-hover:text-cyan-700">
                        {item.title}
                      </span>
                      <span className="block text-[11.5px] text-neutral-500">{item.detail}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {data.staleMore > 0 && (
            <Link href="/overview" className="mt-2 inline-block text-[11.5px] font-semibold text-cyan-700 hover:underline">
              {data.staleMore} more deals without recent activity in Overview
            </Link>
          )}
        </section>

        <section aria-labelledby="home-notices" className={card} style={introCard(2)}>
          <h2 id="home-notices" className="mb-3 text-[14.5px] font-semibold text-ink">
            Notices for you
          </h2>
          {data.notices.length === 0 ? (
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

        <section aria-labelledby="home-actions" className={card} style={introCard(3)}>
          <h2 id="home-actions" className="mb-3 text-[14.5px] font-semibold text-ink">
            Quick actions
          </h2>
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {quickActions.map((action) => (
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
