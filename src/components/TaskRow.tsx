"use client";
import SelectMenu from "@/components/SelectMenu";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { dealHref } from "@/lib/deals/scope";
import type { Member } from "@/lib/communications/drafts";
import { formatExactDate } from "@/lib/dates";
import { localToday } from "@/lib/home/buckets";
import { useUnreadCounts } from "@/components/UnreadCounts";
import { markTaskNotificationsReadAction } from "@/lib/notifications/actions";
import { deleteTaskAction, setTaskStatusAction, updateTaskAction } from "@/lib/tasks/actions";

export type TaskItem = {
  id: string;
  title: string;
  owner: string | null;
  // Member assignee (0017). undefined when not loaded on this page.
  assigneeEmail?: string | null;
  dueAt: string | null;
  status: "open" | "done";
  priorityName: string | null;
  priorityId: string | null;
  companyId: string | null;
  companyName: string | null;
  dealId?: string | null;
  dealName: string | null;
};

// Due dates are calendar dates: compared with the viewer's local date, and
// only in the browser (the server does not know the viewer's time zone).
function isOverdue(dueAt: string | null, status: string, today: string | null) {
  if (!dueAt || status === "done" || !today) return false;
  return dueAt.slice(0, 10) < today;
}

const noSubscribe = () => () => {};

export default function TaskRow({
  task,
  priorities,
  members,
  currentUserEmail,
}: {
  task: TaskItem;
  priorities: { id: string; name: string }[];
  // Active members; when given, the assignee is shown and editable.
  members?: Member[];
  currentUserEmail?: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState(task.status);
  const [archived, setArchived] = useState(false);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(task.title);
  const [owner, setOwner] = useState(task.owner ?? "");
  const [assignee, setAssignee] = useState(task.assigneeEmail ?? "");
  const canAssign = Boolean(members) && task.assigneeEmail !== undefined;
  const assigneeName = task.assigneeEmail
    ? task.assigneeEmail === currentUserEmail
      ? "You"
      : members?.find((member) => member.email === task.assigneeEmail)?.name ?? task.assigneeEmail
    : null;
  const [dueAt, setDueAt] = useState(task.dueAt ?? "");
  const [priorityId, setPriorityId] = useState(task.priorityId ?? "");
  const rowRef = useRef<HTMLDivElement | null>(null);
  const unread = useUnreadCounts();
  const done = status === "done";

  // Opened from a link to this task (e.g. Home → /tasks#task-<id>): bring it
  // into view and highlight it briefly. Client navigation does not update
  // CSS :target, so this is done here. It also marks the viewer's
  // notifications about this task as read.
  const { available: inboxAvailable, refresh: refreshUnread } = unread;
  useEffect(() => {
    const row = rowRef.current;
    if (!row || window.location.hash !== `#task-${task.id}`) return;
    row.scrollIntoView({ block: "center" });
    row.dataset.targeted = "true";
    if (inboxAvailable) {
      void markTaskNotificationsReadAction(task.id).then((result) => {
        if (result.ok) refreshUnread();
      });
    }
    const timer = window.setTimeout(() => delete row.dataset.targeted, 2000);
    return () => window.clearTimeout(timer);
  }, [task.id, inboxAvailable, refreshUnread]);
  const today = useSyncExternalStore(noSubscribe, () => localToday(), () => null);
  const overdue = isOverdue(task.dueAt, status, today);

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
    const result = await updateTaskAction({
      taskId: task.id,
      title,
      owner,
      assigneeEmail: canAssign ? assignee || null : undefined,
      dueAt: dueAt || null,
      priorityId: priorityId || null,
    });
    setPending(false);
    if (!result.ok) { setError(result.message); return; }
    setEditing(false);
    router.refresh();
  }

  if (archived) return null;

  return (
    <div ref={rowRef} id={`task-${task.id}`} data-comment-anchor={`task:${task.id}`} data-comment-label={task.title} className="vq-task-row flex items-center gap-3 border-b border-neutral-50 px-4 py-3 last:border-0">
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
            {canAssign && (
              <label className="flex flex-col gap-1">Assigned to
                <SelectMenu value={assignee} onChange={setAssignee} options={[
                  {value:"",label:"Unassigned"},
                  ...(task.assigneeEmail&&!members?.some(member=>member.email===task.assigneeEmail)?[{value:task.assigneeEmail,label:`${task.assigneeEmail} (inactive)`,disabled:true}]:[]),
                  ...(members??[]).map(member=>({value:member.email,label:member.email===currentUserEmail?`${member.name} (you)`:member.name})),
                ]}/>
              </label>
            )}
            <label className="flex flex-col gap-1">{canAssign ? "Owner note" : "Owner"}
              <input value={owner} onChange={(event) => setOwner(event.target.value)} className="w-28 rounded-md border border-neutral-200 px-2 py-1.5 text-[12px]" />
            </label>
            <label className="flex flex-col gap-1">Due
              <input type="date" value={dueAt} onChange={(event) => setDueAt(event.target.value)} className="rounded-md border border-neutral-200 px-2 py-1.5 text-[12px]" />
            </label>
            <label className="flex flex-col gap-1">Priority
              <SelectMenu value={priorityId} onChange={setPriorityId} options={[{value:"",label:"None"},...priorities.map(priority=>({value:priority.id,label:priority.name}))]}/>
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
          {canAssign && (
            <span className={assigneeName ? "font-semibold text-neutral-600" : "text-neutral-400"}>
              {assigneeName ? `Assigned: ${assigneeName}` : "Unassigned"}
            </span>
          )}
          {task.owner && <span>{canAssign ? `Note: ${task.owner}` : task.owner}</span>}
          {task.dealName && task.dealId && task.companyId ? (
            <Link href={dealHref(task.companyId, task.dealId)} className="hover:text-cyan-700">
              · {task.dealName}
            </Link>
          ) : task.dealName && <span>· {task.dealName}</span>}
          {task.dueAt && (
            <span className={overdue ? "font-semibold text-red-600" : undefined}>
              Due {formatExactDate(`${task.dueAt.slice(0, 10)}T00:00:00Z`)}
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
