"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import type { HomeTask } from "@/lib/home/data";
import { bucketTasks, localToday } from "@/lib/home/buckets";

function formatDue(isoDate: string) {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function TaskLine({ task, tone }: { task: HomeTask; tone: "overdue" | "today" | "upcoming" }) {
  return (
    <li className="flex items-start justify-between gap-3 py-2">
      <div className="min-w-0">
        <Link href={`/tasks?view=mine#task-${task.id}`} className="block truncate text-[12.5px] font-medium text-ink hover:text-cyan-700">
          {task.title}
        </Link>
        {task.context &&
          (task.contextHref ? (
            <Link href={task.contextHref} className="block truncate text-[11.5px] text-neutral-500 hover:text-cyan-700">
              {task.context}
            </Link>
          ) : (
            <span className="block truncate text-[11.5px] text-neutral-500">{task.context}</span>
          ))}
      </div>
      {task.dueAt && (
        <span
          className={`flex-shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${
            tone === "overdue"
              ? "bg-red-50 text-red-700"
              : tone === "today"
                ? "bg-cyan-50 text-cyan-800"
                : "bg-neutral-100 text-neutral-600"
          }`}
        >
          {tone === "today" ? "Today" : formatDue(task.dueAt)}
        </span>
      )}
    </li>
  );
}

function Group({
  label,
  tasks,
  tone,
  empty,
}: {
  label: string;
  tasks: HomeTask[];
  tone: "overdue" | "today" | "upcoming";
  empty: string;
}) {
  return (
    <div>
      <div className="flex items-center justify-between text-[10.5px] font-semibold uppercase tracking-wide text-neutral-400">
        <span>{label}</span>
        <span className={tone === "overdue" && tasks.length > 0 ? "text-red-600" : undefined}>{tasks.length}</span>
      </div>
      {tasks.length === 0 ? (
        <p className="py-2 text-[12px] text-neutral-400">{empty}</p>
      ) : (
        <ul className="divide-y divide-neutral-50">
          {tasks.slice(0, 5).map((task) => (
            <TaskLine key={task.id} task={task} tone={tone} />
          ))}
          {tasks.length > 5 && (
            <li className="py-2 text-[11.5px]">
              <Link href="/tasks?view=mine" className="font-semibold text-cyan-700 hover:underline">
                +{tasks.length - 5} more
              </Link>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

const noop = () => () => {};

export default function MyTasksCard({
  available,
  tasks,
  unassignedOpen,
}: {
  available: boolean;
  tasks: HomeTask[];
  unassignedOpen: number;
}) {
  const today = useSyncExternalStore(noop, localToday, () => null);

  if (!available) {
    return (
      <p className="text-[12.5px] text-neutral-500">
        My tasks appear here once tasks can be assigned to members (database migration 0017). Until then, see{" "}
        <Link href="/tasks" className="font-semibold text-cyan-700 hover:underline">
          Tasks
        </Link>
        .
      </p>
    );
  }

  if (tasks.length === 0) {
    return (
      <div className="text-[12.5px] text-neutral-500">
        <p className="font-semibold text-ink">No open tasks assigned to you.</p>
        <p className="mt-1">
          Tasks count as yours only when they are assigned to you in Tasks.
          {unassignedOpen > 0 && (
            <>
              {" "}
              <Link href="/tasks?view=unassigned" className="font-semibold text-cyan-700 hover:underline">
                {unassignedOpen} open task{unassignedOpen === 1 ? " has" : "s have"} no assignee
              </Link>
              .
            </>
          )}
        </p>
      </div>
    );
  }

  if (today === null) {
    return <div className="h-40" aria-busy="true" />;
  }

  const groups = bucketTasks(tasks, today);
  return (
    <div className="flex flex-col gap-4">
      <Group label="Overdue" tasks={groups.overdue} tone="overdue" empty="Nothing overdue." />
      <Group label="Today" tasks={groups.today} tone="today" empty="Nothing due today." />
      <Group label="Next 7 days" tasks={groups.upcoming} tone="upcoming" empty="Nothing due this week." />
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-neutral-100 pt-3 text-[11.5px]">
        <Link href="/tasks?view=mine" className="font-semibold text-cyan-700 hover:underline">
          All my tasks ({tasks.length})
        </Link>
        {groups.later.length > 0 && (
          <span className="text-neutral-500">
            {groups.later.length} later or without a due date
          </span>
        )}
      </div>
    </div>
  );
}
