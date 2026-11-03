import ActivityTab from "@/components/tasks/ActivityTab";
import ReviewTab from "@/components/tasks/ReviewTab";
import TaskListTab from "@/components/tasks/TaskListTab";
import TasksTabs from "@/components/tasks/TasksTabs";
import { requireMember } from "@/lib/auth/access";
import { TASKS_PANEL_ID, TASKS_TEXT, resolveTasksView, tasksTabId, tasksTabsFor } from "@/lib/tasks/tabs";

export const dynamic = "force-dynamic";

type Raw = string | string[] | undefined;

// Tasks: Mine (default), All, To review (the former Review) and Activity (the
// former Action center). Only the active tab's component runs, so only its
// data is fetched. The tab is resolved on the server against the member's
// permissions: a tab they may not see is neither listed nor rendered, and a
// direct `?tab=` for it (or an unknown one) shows the default tab. The old
// `?view=mine|unassigned` links still work (see resolveTasksView).
export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: Raw; view?: Raw; filter?: Raw; status?: Raw }>;
}) {
  const [access, query] = await Promise.all([requireMember(), searchParams]);
  const tabs = tasksTabsFor(access.permissions);
  const { tab: active, filter } = resolveTasksView(query, access.permissions);
  const status = Array.isArray(query.status) ? query.status[0] : query.status;

  // The tab bodies are async components that fetch their own data. They are
  // called here, not rendered as elements, so their queries start with the
  // page (beside the layout's) instead of after the layout has finished.
  const body =
    active === "review"
      ? await ReviewTab({ email: access.email })
      : active === "activity"
        ? await ActivityTab({ access })
        : await TaskListTab({ email: access.email, scope: active, filter, status });

  return (
    <div className="flex min-w-0 flex-col gap-4 px-4 py-6 sm:px-7">
      <header className="flex flex-col gap-3">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-[23px] font-semibold tracking-tight text-ink">
            {TASKS_TEXT.title}
          </h1>
          <p className="mt-1 text-[13px] text-neutral-500">{TASKS_TEXT.purpose}</p>
        </div>
        <TasksTabs tabs={tabs} active={active} />
      </header>

      <div id={TASKS_PANEL_ID} role="tabpanel" aria-labelledby={tasksTabId(active)} className="min-w-0">
        {body}
      </div>
    </div>
  );
}
