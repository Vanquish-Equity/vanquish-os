"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { dealHref } from "@/lib/deals/scope";
import { deleteTaskAction, setTaskStatusAction, updateTaskAction } from "@/lib/tasks/actions";

export type TaskItem = {
  id: string;
  title: string;
  owner: string | null;
  dueAt: string | null;
  status: "open" | "done";
  priorityName: string | null;
  priorityId: string | null;
  companyId: string | null;
  companyName: string | null;
  dealId?: string | null;
  dealName: string | null;
};

function isOverdue(dueAt: string | null, status: string) {
  if (!dueAt || status === "done") return false;
  return new Date(dueAt) < new Date(new Date().toDateString());
}

export default function TaskRow({ task, priorities }: { task: TaskItem; priorities: { id: string; name: string }[] }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState(task.status);
  const [archived, setArchived] = useState(false);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(task.title);
  const [owner, setOwner] = useState(task.owner ?? "");
  const [dueAt, setDueAt] = useState(task.dueAt ?? "");
  const [priorityId, setPriorityId] = useState(task.priorityId ?? "");
  const done = status === "done";
  const overdue = isOverdue(task.dueAt, status);

  async function toggleDone() {
    const previousStatus = status;
    const nextStatus = done ? "open" : "done";
    setPending(true);
    setError(null);
    setStatus(nextStatus);
    const result = await setTaskStatusAction({
      taskId: task.id,
      status: nextStatus,
      companyId: task.companyId,
    });
    setPending(false);

    if (!result.ok) {
      setStatus(previousStatus);
      setError(result.message);
      return;
    }
    router.refresh();
  }

  async function handleDelete() {
    setPending(true);
    setError(null);
    setArchived(true);
    const result = await deleteTaskAction({
      taskId: task.id,
      companyId: task.companyId,
    });
    setPending(false);

    if (!result.ok) {
      setArchived(false);
      setError(result.message);
      return;
    }
    router.refresh();
  }

  async function saveEdits(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const result = await updateTaskAction({ taskId: task.id, title, owner, dueAt: dueAt || null, priorityId: priorityId || null });
    setPending(false);
    if (!result.ok) { setError(result.message); return; }
    setEditing(false);
    router.refresh();
  }

  if (archived) return null;

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
        {editing ? (
          <form onSubmit={(event) => void saveEdits(event)} className="flex flex-wrap items-end gap-2 text-[11px]">
            <label className="flex min-w-[180px] flex-1 flex-col gap-1">Task
              <input required value={title} onChange={(event) => setTitle(event.target.value)} className="rounded-md border border-neutral-200 px-2 py-1.5 text-[12px]" />
            </label>
            <label className="flex flex-col gap-1">Owner
              <input value={owner} onChange={(event) => setOwner(event.target.value)} className="w-28 rounded-md border border-neutral-200 px-2 py-1.5 text-[12px]" />
            </label>
            <label className="flex flex-col gap-1">Due
              <input type="date" value={dueAt} onChange={(event) => setDueAt(event.target.value)} className="rounded-md border border-neutral-200 px-2 py-1.5 text-[12px]" />
            </label>
            <label className="flex flex-col gap-1">Priority
              <select value={priorityId} onChange={(event) => setPriorityId(event.target.value)} className="rounded-md border border-neutral-200 px-2 py-1.5 text-[12px]">
                <option value="">None</option>
                {priorities.map((priority) => <option key={priority.id} value={priority.id}>{priority.name}</option>)}
              </select>
            </label>
            <button type="submit" disabled={pending} className="rounded-md bg-ink px-2 py-1.5 font-semibold text-white disabled:opacity-50">Save</button>
            <button type="button" disabled={pending} onClick={() => setEditing(false)} className="px-1 py-1.5 text-neutral-500">Cancel</button>
            {error && <span role="alert" className="text-red-600">{error}</span>}
          </form>
        ) : <>
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
          {task.dealName && task.dealId && task.companyId ? (
            <Link href={dealHref(task.companyId, task.dealId)} className="hover:text-cyan-700">
              · {task.dealName}
            </Link>
          ) : task.dealName && <span>· {task.dealName}</span>}
          {task.dueAt && (
            <span className={overdue ? "font-semibold text-red-600" : undefined}>
              Due {new Date(task.dueAt).toLocaleDateString()}
            </span>
          )}
          {error && <span className="text-red-600">{error}</span>}
        </div>
        </>}
      </div>

      {task.priorityName === "High" && !done && (
        <span className="flex-shrink-0 rounded-full border border-cyan-200 bg-cyan-50 px-2 py-0.5 text-[10.5px] font-semibold text-cyan-800">
          High
        </span>
      )}

      {!editing && <button type="button" disabled={pending} onClick={() => setEditing(true)}
        className="flex-shrink-0 text-[11px] font-semibold text-neutral-400 transition hover:text-cyan-700 disabled:opacity-50">Edit</button>}
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
