import { createClient } from "@/lib/supabase/server";
import NewTaskModal from "@/components/NewTaskModal";
import TaskRow, { type TaskItem } from "@/components/TaskRow";
import { startDevPageTimer } from "@/lib/performance";
import { getPriorityOptions } from "@/lib/taxonomies";
import { dealLabel } from "@/lib/deals/display";

export const dynamic = "force-dynamic";

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

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const supabase = await createClient();
  const endTimer = startDevPageTimer("page:data:tasks");

  const [{ data: tasks }, { data: companies }, { data: deals }, priorities] =
    await Promise.all([
      supabase
        .from("tasks")
        .select(
          "id,title,owner,due_at,status,company_id,deal_id,priority_id,company:companies(id,name),deal:deals(name,round,first_seen_at,created_at),priority:priorities(name)"
        )
        .is("archived_at", null)
        .order("due_at", { ascending: true, nullsFirst: false }) as unknown as Promise<{
        data: TaskRowData[] | null;
      }>,
      supabase
        .from("companies")
        .select("id,name")
        .is("deleted_at", null)
        .order("name") as unknown as Promise<{ data: Option[] }>,
      supabase.from("deals").select("id,name,round,first_seen_at,created_at,company_id,company:companies(name)")
        .is("archived_at", null).order("name") as unknown as Promise<{ data: DealOption[] }>,
      getPriorityOptions() as Promise<Option[]>,
    ]);
  endTimer();

  const allTasks: TaskItem[] = (tasks ?? []).map((t) => ({
    id: t.id,
    title: t.title,
    owner: t.owner,
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

  const openTasks = allTasks
    .filter((t) => t.status === "open")
    .sort((a, b) => {
      // Overdue/soonest due first, tasks with no due date last.
      if (!a.dueAt && !b.dueAt) return 0;
      if (!a.dueAt) return 1;
      if (!b.dueAt) return -1;
      return new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime();
    });
  const doneTasks = allTasks.filter((t) => t.status === "done");

  return (
    <div className="flex flex-col gap-4 px-7 py-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-[23px] font-semibold tracking-tight text-ink">
            Tasks
          </h1>
          <p className="mt-1 text-[13px] text-neutral-500">
            Follow-ups and next actions, linked to a company when relevant.
          </p>
        </div>
        <NewTaskModal companies={companies ?? []} deals={dealOptions} priorities={priorities} />
      </header>

      {status !== "done" && (
        <div className="vq-card-static rounded-[14px] bg-white">
          <div className="border-b border-neutral-100 px-4 py-2.5 text-[10.5px] font-semibold uppercase tracking-wide text-neutral-400">
            Open ({openTasks.length})
          </div>
          {openTasks.length === 0 ? (
            <div className="px-4 py-8 text-center text-[12.5px] text-neutral-400">
              No open tasks.
            </div>
          ) : (
            openTasks.map((task) => <TaskRow key={task.id} task={task} priorities={priorities} />)
          )}
        </div>
      )}

      {status !== "open" && doneTasks.length > 0 && (
        <div className="vq-card-static rounded-[14px] bg-white">
          <div className="border-b border-neutral-100 px-4 py-2.5 text-[10.5px] font-semibold uppercase tracking-wide text-neutral-400">
            Done ({doneTasks.length})
          </div>
          {doneTasks.map((task) => (
            <TaskRow key={task.id} task={task} priorities={priorities} />
          ))}
        </div>
      )}
    </div>
  );
}
