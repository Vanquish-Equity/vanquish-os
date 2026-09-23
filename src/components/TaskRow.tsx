"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { deleteTaskAction, setTaskStatusAction } from "@/lib/tasks/actions";

export type TaskItem = {
  id: string;
  title: string;
  owner: string | null;
  dueAt: string | null;
  status: "open" | "done";
  priorityName: string | null;
  companyId: string | null;
  companyName: string | null;
};

function isOverdue(dueAt: string | null, status: string) {
  if (!dueAt || status === "done") return false;
  return new Date(dueAt) < new Date(new Date().toDateString());
}

export default function TaskRow({ task }: { task: TaskItem }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const done = task.status === "done";
  const overdue = isOverdue(task.dueAt, task.status);

  async function toggleDone() {
    setPending(true);
    setError(null);
    const result = await setTaskStatusAction({
      taskId: task.id,
      status: done ? "open" : "done",
      companyId: task.companyId,
    });
    setPending(false);

    if (!result.ok) {
      setError(result.message);
      return;
    }
    router.refresh();
  }

  async function handleDelete() {
    setPending(true);
    setError(null);
    const result = await deleteTaskAction({
      taskId: task.id,
      companyId: task.companyId,
    });
    setPending(false);

    if (!result.ok) {
      setError(result.message);
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex items-center gap-3 border-b border-neutral-50 px-4 py-3 last:border-0">
      <button
        type="button"
        onClick={() => void toggleDone()}
        disabled={pending}
        aria-label={done ? "Mark as open" : "Mark as done"}
        className={`flex h-[18px] w-[18px] flex-shrink-0 items-center justify-center rounded-full border transition ${
          done
            ? "border-cyan-400 bg-cyan-400 text-white"
            : "border-neutral-300 hover:border-cyan-400"
        }`}
      >
        {done && (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path
              d="M1.5 5L4 7.5L8.5 2"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </button>

      <div className="min-w-0 flex-1">
        <div
          className={`text-[12.5px] font-medium ${
            done ? "text-neutral-400 line-through" : "text-ink"
          }`}
        >
          {task.title}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-neutral-500">
          {task.companyName && task.companyId && (
            <Link
              href={`/companies/${task.companyId}`}
              className="hover:text-cyan-700"
            >
              {task.companyName}
            </Link>
          )}
          {task.owner && <span>{task.owner}</span>}
          {task.dueAt && (
            <span className={overdue ? "font-semibold text-red-600" : undefined}>
              Due {new Date(task.dueAt).toLocaleDateString()}
            </span>
          )}
          {error && <span className="text-red-600">{error}</span>}
        </div>
      </div>

      {task.priorityName === "High" && !done && (
        <span className="flex-shrink-0 rounded-full border border-cyan-200 bg-cyan-50 px-2 py-0.5 text-[10.5px] font-semibold text-cyan-800">
          High
        </span>
      )}

      <button
        type="button"
        onClick={() => void handleDelete()}
        disabled={pending}
        className="flex-shrink-0 text-[11px] font-semibold text-neutral-300 transition hover:text-red-600 disabled:opacity-50"
      >
        Archive
      </button>
    </div>
  );
}
