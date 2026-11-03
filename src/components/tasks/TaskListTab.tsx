import Link from "next/link";
import NewTaskModal from "@/components/NewTaskModal";
import TaskRow, { type TaskItem } from "@/components/TaskRow";
import { loadAssignableMembers } from "@/lib/communications/queries";
import { dealLabel } from "@/lib/deals/display";
import { startDevPageTimer } from "@/lib/performance";
import { createClient } from "@/lib/supabase/server";
import { selectTasksWithAssignee } from "@/lib/tasks/queries";
import { tasksTabHref, type TasksFilter } from "@/lib/tasks/tabs";
import { getPriorityOptions } from "@/lib/taxonomies";

type Option = { id: string; name: string };
type DealOption = {
  id: string;
  name: string;
  round: string | null;
  first_seen_at: string | null;
  created_at: string;
  company_id: string;
  company: { name: string } | null;
};

type TaskRowData = {
  id: string;
  title: string;
  owner: string | null;
  assignee_email?: string | null;
  due_at: string | null;
  status: "open" | "done";
  priority_id: string | null;
  company_id: string | null;
  deal_id: string | null;
  deal: {
    name: string;
    round: string | null;
    first_seen_at: string | null;
    created_at: string;
  } | null;
  company: { id: string; name: string } | null;
  priority: { name: string } | null;
};

const TASK_COLUMNS =
  "id,title,owner,due_at,status,company_id,deal_id,priority_id,company:companies(id,name),deal:deals(name,round,first_seen_at,created_at),priority:priorities(name)";

export const TASK_LIST_TEXT = {
  noAssignment: "Assigning tasks to team members isn’t available yet. Until then, tasks show without an assignee.",
  noOpen: "No open tasks.",
  noMine: "Nothing is assigned to you.",
  chipEveryone: "Everyone",
  chipUnassigned: "Unassigned",
  filterLabel: "Task filter",
} as const;

const chipClass = (active: boolean) =>
  `rounded-full px-3 py-1.5 text-[11.5px] font-semibold transition ${
    active
      ? "bg-ink text-white"
      : "border border-neutral-200 text-neutral-600 hover:border-cyan-300 hover:text-cyan-800"
  }`;

// Tasks > Mine and Tasks > All. One query for the list (narrowed in the
// database to the member's tasks for Mine, or to the unassigned ones for the
// All filter) beside the options of the New task dialog. Runs only when one of
// these two tabs is active.
export default async function TaskListTab({
  email,
  scope,
  filter,
  status,
}: {
  email: string;
  scope: "mine" | "all";
  filter: TasksFilter;
  // Old `?status=open|done` links keep narrowing the list.
  status?: string;
}) {
  const supabase = await createClient();
  const endTimer = startDevPageTimer("page:data:tasks");

  const [taskResult, { data: companies }, { data: deals }, priorities, members] = await Promise.all([
    selectTasksWithAssignee<TaskRowData>(TASK_COLUMNS, (columns) => {
      let query = supabase.from("tasks").select(columns).is("archived_at", null);
      // The assignee column only exists with migration 0017; without it the
      // retry (columns without assignee) lists every task, as before.
      if (columns.includes("assignee_email")) {
        if (scope === "mine") query = query.eq("assignee_email", email);
        else if (filter === "unassigned") query = query.is("assignee_email", null);
      }
      return query.order("due_at", { ascending: true, nullsFirst: false }) as unknown as PromiseLike<{
        data: TaskRowData[] | null;
        error: { code?: string } | null;
      }>;
    }),
    supabase.from("companies").select("id,name").is("deleted_at", null).order("name") as unknown as Promise<{
      data: Option[];
    }>,
    supabase
      .from("deals")
      .select("id,name,round,first_seen_at,created_at,company_id,company:companies(name)")
      .is("archived_at", null)
      .order("name") as unknown as Promise<{ data: DealOption[] }>,
    getPriorityOptions() as Promise<Option[]>,
    loadAssignableMembers(supabase),
  ]);
  // Until migration 0017 is applied tasks show without assignment.
  const { data: tasks, assignmentAvailable } = taskResult;
  endTimer();

  const items: TaskItem[] = (tasks ?? []).map((t) => ({
    id: t.id,
    title: t.title,
    owner: t.owner,
    assigneeEmail: assignmentAvailable ? t.assignee_email ?? null : undefined,
    dueAt: t.due_at,
    status: t.status,
    priorityName: t.priority?.name ?? null,
    priorityId: t.priority_id,
    companyId: t.company_id,
    companyName: t.company?.name ?? null,
    dealId: t.deal_id,
    dealName: t.deal
      ? dealLabel({
          name: t.deal.name,
          round: t.deal.round,
          companyName: t.company?.name,
          firstSeenAt: t.deal.first_seen_at,
          createdAt: t.deal.created_at,
        })
      : null,
  }));

  const dealOptions = (deals ?? []).map((deal) => ({
    id: deal.id,
    company_id: deal.company_id,
    name: dealLabel({
      name: deal.name,
      round: deal.round,
      companyName: deal.company?.name,
      firstSeenAt: deal.first_seen_at,
      createdAt: deal.created_at,
    }),
  }));

  const rowMembers = assignmentAvailable ? members : undefined;
  const openTasks = items
    .filter((t) => t.status === "open")
    .sort((a, b) => {
      // Overdue/soonest due first, tasks with no due date last.
      if (!a.dueAt && !b.dueAt) return 0;
      if (!a.dueAt) return 1;
      if (!b.dueAt) return -1;
      return new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime();
    });
  const doneTasks = items.filter((t) => t.status === "done");
  // Without migration 0017 nobody can be filtered by assignee, so the list is
  // the whole team's and the Unassigned chip is not offered.
  const filtering = scope === "all" && assignmentAvailable;
  const unassignedOpen = filter === "unassigned" ? openTasks.length : openTasks.filter((t) => !t.assigneeEmail).length;

  const row = (task: TaskItem) => (
    <TaskRow key={task.id} task={task} priorities={priorities} members={rowMembers} currentUserEmail={email} />
  );

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {filtering ? (
          <nav aria-label={TASK_LIST_TEXT.filterLabel} className="flex flex-wrap items-center gap-2">
            <Link
              href={tasksTabHref("all")}
              prefetch={false}
              className={chipClass(filter === null)}
              aria-current={filter === null ? "page" : undefined}
            >
              {TASK_LIST_TEXT.chipEveryone}
            </Link>
            <Link
              href={tasksTabHref("all", "unassigned")}
              prefetch={false}
              className={chipClass(filter === "unassigned")}
              aria-current={filter === "unassigned" ? "page" : undefined}
            >
              {TASK_LIST_TEXT.chipUnassigned} ({unassignedOpen})
            </Link>
          </nav>
        ) : (
          <span />
        )}
        <NewTaskModal
          companies={companies ?? []}
          deals={dealOptions}
          priorities={priorities}
          members={rowMembers}
          currentUserEmail={email}
          openOnNewParam
        />
      </div>

      {!assignmentAvailable && (
        <p className="rounded-[14px] border border-neutral-200 bg-[#f7f9fa] px-4 py-3 text-[12.5px] text-neutral-600">
          {TASK_LIST_TEXT.noAssignment}
        </p>
      )}

      {status !== "done" && (
        <div className="vq-card-static rounded-[14px] bg-white">
          <div className="border-b border-neutral-100 px-4 py-2.5 text-[10.5px] font-semibold uppercase tracking-wide text-neutral-400">
            Open ({openTasks.length})
          </div>
          {openTasks.length === 0 ? (
            <div className="px-4 py-8 text-center text-[12.5px] text-neutral-400">
              {scope === "mine" && assignmentAvailable ? TASK_LIST_TEXT.noMine : TASK_LIST_TEXT.noOpen}
            </div>
          ) : (
            openTasks.map(row)
          )}
        </div>
      )}

      {status !== "open" && doneTasks.length > 0 && (
        <div className="vq-card-static rounded-[14px] bg-white">
          <div className="border-b border-neutral-100 px-4 py-2.5 text-[10.5px] font-semibold uppercase tracking-wide text-neutral-400">
            Done ({doneTasks.length})
          </div>
          {doneTasks.map(row)}
        </div>
      )}
    </div>
  );
}
