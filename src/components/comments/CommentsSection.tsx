"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import LocalTime from "@/components/LocalTime";
import MentionTextarea, { type MentionCandidate } from "@/components/MentionTextarea";
import { useUnreadCounts } from "@/components/UnreadCounts";
import { keptMentions, mentionSegments, type DirectoryEntry } from "@/lib/chat/format";
import {
  createTaskFromCommentAction,
  deleteCommentAction,
  editCommentAction,
  postCommentAction,
  type CommentTaskInput,
} from "@/lib/comments/actions";
import { buildThreads, taskTitleFromComment, visibleCommentCount, type CommentItem } from "@/lib/comments/format";
import { markCommentNotificationsReadAction } from "@/lib/notifications/actions";
import { useLiveSignal } from "@/lib/realtime/useLiveSignal";
import { createClient } from "@/lib/supabase/client";

type Props = {
  companyId: string;
  dealId: string | null;
  recordLabel: string;
  me: string;
  comments: CommentItem[];
  directory: DirectoryEntry[];
  readOnlyReason?: string | null;
};

const button =
  "rounded-full px-2.5 py-1 text-[11px] font-semibold text-neutral-500 transition hover:bg-neutral-100 hover:text-cyan-800 disabled:opacity-50";
const primary =
  "rounded-full bg-ink px-3.5 py-1.5 text-[12px] font-semibold text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50";
const secondary =
  "rounded-full border border-neutral-200 px-3 py-1.5 text-[11.5px] font-semibold text-neutral-600 transition hover:border-cyan-300 hover:text-cyan-800";

// Signature of what is shown, to tell whether a live signal changed anything.
function signatureOf(rows: { id: string; edited_at?: string | null; deleted_at?: string | null }[]) {
  return rows
    .map((row) => `${row.id}:${row.edited_at ?? ""}:${row.deleted_at ?? ""}`)
    .sort()
    .join("|");
}

export default function CommentsSection({ companyId, dealId, recordLabel, me, comments, directory, readOnlyReason }: Props) {
  const router = useRouter();
  const unread = useUnreadCounts();
  const dir = useMemo(() => new Map(directory.map((d) => [d.email, d])), [directory]);
  const candidates: MentionCandidate[] = useMemo(
    () => directory.filter((d) => d.active && d.email !== me).map((d) => ({ email: d.email, name: d.name })),
    [directory, me]
  );
  const threads = useMemo(() => buildThreads(comments), [comments]);
  const count = visibleCommentCount(threads);
  const name = (email: string) => (email === me ? "You" : dir.get(email)?.name ?? email);

  // Other members' comments appear without reloading (Realtime, or polling
  // as fallback). The signal only triggers a cheap check; the page re-reads
  // through RLS when something actually changed.
  const shown = useMemo(
    () => signatureOf(comments.map((c) => ({ id: c.id, edited_at: c.editedAt, deleted_at: c.deletedAt }))),
    [comments]
  );
  const check = useCallback(async () => {
    const supabase = createClient();
    let query = supabase.from("record_comments").select("id,edited_at,deleted_at").eq("company_id", companyId);
    query = dealId ? query.eq("deal_id", dealId) : query.is("deal_id", null);
    const { data } = await query.limit(500);
    if (data && signatureOf(data) !== shown) router.refresh();
  }, [companyId, dealId, shown, router]);
  useLiveSignal({
    key: `comments:${companyId}:${dealId ?? "company"}`,
    table: "record_comments",
    filter: `company_id=eq.${companyId}`,
    onSignal: () => void check(),
    pollMs: 15000,
    safetyMs: 60000,
  });

  // A direct link (#comment-<id>) scrolls to the comment, highlights it and
  // marks the viewer's notifications about it as read.
  const { available: inboxAvailable, refresh: refreshUnread } = unread;
  useEffect(() => {
    let timer: number | undefined;
    function target() {
      const match = window.location.hash.match(/^#comment-([0-9a-f-]{36})$/i);
      if (!match) return;
      const element = document.getElementById(`comment-${match[1]}`);
      if (!element) return;
      element.scrollIntoView({ block: "center" });
      element.dataset.targeted = "true";
      window.clearTimeout(timer);
      timer = window.setTimeout(() => delete element.dataset.targeted, 2600);
      if (inboxAvailable) {
        void markCommentNotificationsReadAction([match[1]]).then((result) => {
          if (result.ok) refreshUnread();
        });
      }
    }
    target();
    window.addEventListener("hashchange", target);
    return () => {
      window.removeEventListener("hashchange", target);
      window.clearTimeout(timer);
    };
  }, [inboxAvailable, refreshUnread]);

  return (
    <div>
      <div className="flex items-center justify-between gap-3 border-b border-neutral-100 px-5 py-4">
        <div>
          <h2 className="text-[14.5px] font-semibold text-ink">Comments</h2>
          <p className="mt-0.5 text-[12px] text-neutral-500">
            Internal notes about {recordLabel}. Visible to members who can open it. {count} comment{count === 1 ? "" : "s"}.
          </p>
        </div>
      </div>

      {threads.length === 0 ? (
        <p className="px-5 py-6 text-center text-[12.5px] text-neutral-400">No comments yet. Start the conversation below.</p>
      ) : (
        <ol className="flex flex-col divide-y divide-neutral-50">
          {threads.map((thread) => (
            <li key={thread.root.id} className="px-5 py-3">
              <Comment
                comment={thread.root}
                name={name}
                me={me}
                dir={dir}
                candidates={candidates}
                companyId={companyId}
                dealId={dealId}
                readOnly={Boolean(readOnlyReason)}
                replyTo={thread.root.id}
              />
              {thread.replies.length > 0 && (
                <ol className="ml-4 mt-2 flex flex-col gap-2 border-l-2 border-neutral-100 pl-4 sm:ml-10">
                  {thread.replies.map((reply) => (
                    <li key={reply.id}>
                      <Comment
                        comment={reply}
                        name={name}
                        me={me}
                        dir={dir}
                        candidates={candidates}
                        companyId={companyId}
                        dealId={dealId}
                        readOnly={Boolean(readOnlyReason)}
                        replyTo={thread.root.id}
                      />
                    </li>
                  ))}
                </ol>
              )}
            </li>
          ))}
        </ol>
      )}

      <div className="border-t border-neutral-100 px-5 py-4">
        {readOnlyReason ? (
          <p className="rounded-xl bg-[#f7f9fa] px-3 py-2.5 text-[12px] text-neutral-500">{readOnlyReason}</p>
        ) : (
          <Composer
            id={`new-comment-${dealId ?? companyId}`}
            companyId={companyId}
            dealId={dealId}
            parentId={null}
            candidates={candidates}
            members={directory.filter((d) => d.active)}
            me={me}
            allowTask
          />
        )}
      </div>
    </div>
  );
}

function Comment({
  comment,
  name,
  me,
  dir,
  candidates,
  companyId,
  dealId,
  readOnly,
  replyTo,
}: {
  comment: CommentItem;
  name: (email: string) => string;
  me: string;
  dir: Map<string, DirectoryEntry>;
  candidates: MentionCandidate[];
  companyId: string;
  dealId: string | null;
  readOnly: boolean;
  replyTo: string;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"view" | "edit" | "reply" | "task">("view");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const mine = comment.authorEmail === me;
  const author = dir.get(comment.authorEmail);

  if (comment.deletedAt) {
    return (
      <article id={`comment-${comment.id}`} className="vq-comment rounded-xl px-2 py-1.5" data-comment={comment.id} data-deleted="true">
        <p className="text-[12px] italic text-neutral-400">
          Comment deleted by {name(comment.authorEmail)} · <LocalTime date={comment.deletedAt} mode="smart" />
        </p>
      </article>
    );
  }

  function remove() {
    setError(null);
    startTransition(async () => {
      const result = await deleteCommentAction({ commentId: comment.id, companyId, dealId });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setConfirmDelete(false);
      router.refresh();
    });
  }

  return (
    <article id={`comment-${comment.id}`} className="vq-comment rounded-xl px-2 py-1.5" data-comment={comment.id}>
      <div className="flex items-start gap-2.5">
        <span
          aria-hidden="true"
          className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-[#f0fafb] text-[11px] font-semibold text-cyan-800"
        >
          {(author?.name ?? comment.authorEmail).charAt(0).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 text-[11px] text-neutral-500">
            <span className="font-semibold text-ink" data-author={comment.authorEmail}>
              {name(comment.authorEmail)}
              {author && !author.active ? " (no longer active)" : ""}
            </span>
            <LocalTime date={comment.createdAt} mode="smart" />
            {comment.editedAt && (
              <span className="italic" title="Edited" data-edited="true">
                (edited <LocalTime date={comment.editedAt} mode="smart" />)
              </span>
            )}
          </div>

          {mode === "edit" ? (
            <Composer
              id={`edit-${comment.id}`}
              companyId={companyId}
              dealId={dealId}
              parentId={null}
              candidates={candidates}
              members={[]}
              me={me}
              editing={comment}
              dir={dir}
              onDone={() => setMode("view")}
            />
          ) : (
            <p className="mt-0.5 whitespace-pre-wrap break-words text-[13px] text-ink">
              {mentionSegments(comment.body, comment.mentions, dir).map((segment, index) =>
                segment.mention ? (
                  <span
                    key={index}
                    data-mention={segment.mention}
                    className={`rounded px-0.5 font-semibold ${segment.mention === me ? "bg-cyan-100 text-cyan-900" : "bg-[#f0fafb] text-cyan-800"}`}
                  >
                    {segment.text}
                  </span>
                ) : (
                  <span key={index}>{segment.text}</span>
                )
              )}
            </p>
          )}

          {comment.tasks.length > 0 && (
            <ul className="mt-1.5 flex flex-wrap gap-1.5">
              {comment.tasks.map((task) => (
                <li key={task.id} className="max-w-full">
                  <Link
                    href={`/tasks#task-${task.id}`}
                    data-comment-task={task.id}
                    className="inline-flex max-w-full items-baseline gap-1.5 rounded-lg border border-neutral-200 bg-white px-2.5 py-1 text-[11px] text-neutral-600 transition hover:border-cyan-300 hover:text-cyan-800"
                  >
                    <span aria-hidden="true">{task.status === "done" ? "✓" : "○"}</span>
                    <span className="min-w-0 break-words font-semibold">
                      Task: {task.title} <span className="font-normal text-neutral-400">· {task.assigneeEmail ? name(task.assigneeEmail) : "Unassigned"}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}

          {mode === "view" && !readOnly && (
            <div className="mt-1 flex flex-wrap items-center gap-0.5">
              <button type="button" className={button} onClick={() => setMode("reply")}>
                Reply
              </button>
              <button type="button" className={button} onClick={() => setMode("task")}>
                Create task
              </button>
              {mine && (
                <button type="button" className={button} onClick={() => setMode("edit")}>
                  Edit
                </button>
              )}
              {mine &&
                (confirmDelete ? (
                  <span className="ml-1 inline-flex items-center gap-1.5 rounded-full bg-red-50 px-2.5 py-1 text-[11px] text-red-700">
                    Delete this comment? Replies stay.
                    <button type="button" className="font-semibold underline" onClick={remove} disabled={isPending}>
                      Delete
                    </button>
                    <button type="button" className="font-semibold" onClick={() => setConfirmDelete(false)}>
                      Cancel
                    </button>
                  </span>
                ) : (
                  <button type="button" className={button} onClick={() => setConfirmDelete(true)}>
                    Delete
                  </button>
                ))}
            </div>
          )}

          {mode === "reply" && (
            <div className="mt-2">
              <Composer
                id={`reply-${comment.id}`}
                companyId={companyId}
                dealId={dealId}
                parentId={replyTo}
                candidates={candidates}
                members={[]}
                me={me}
                onDone={() => setMode("view")}
                autoFocus
              />
            </div>
          )}

          {mode === "task" && (
            <TaskForm
              idPrefix={`task-${comment.id}`}
              initialTitle={taskTitleFromComment(comment.body)}
              members={[...dir.values()].filter((d) => d.active)}
              me={me}
              submitLabel="Create task"
              onCancel={() => setMode("view")}
              onSubmit={(task) =>
                new Promise<string | null>((resolve) => {
                  startTransition(async () => {
                    const result = await createTaskFromCommentAction({ commentId: comment.id, companyId, dealId, task });
                    if (!result.ok) return resolve(result.message);
                    setMode("view");
                    router.refresh();
                    resolve(null);
                  });
                })
              }
            />
          )}

          {error && (
            <p role="alert" className="mt-1 text-[12px] text-red-600">
              {error}
            </p>
          )}
        </div>
      </div>
    </article>
  );
}

function TaskForm({
  idPrefix,
  initialTitle,
  members,
  me,
  submitLabel,
  onSubmit,
  onCancel,
  embedded = false,
  onChange,
}: {
  idPrefix: string;
  initialTitle: string;
  members: DirectoryEntry[];
  me: string;
  submitLabel?: string;
  onSubmit?: (task: CommentTaskInput) => Promise<string | null>;
  onCancel?: () => void;
  embedded?: boolean;
  onChange?: (task: CommentTaskInput) => void;
}) {
  const [title, setTitle] = useState(initialTitle);
  const [assignee, setAssignee] = useState(me);
  const [due, setDue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function change(next: Partial<CommentTaskInput>) {
    const task = { title, assignee: assignee || null, due: due || null, ...next };
    onChange?.(task);
  }

  const field = "rounded-lg border border-neutral-200 bg-white px-2 py-1.5 text-[12px] text-ink";
  return (
    <fieldset
      className={`flex flex-col gap-2 rounded-xl border border-neutral-100 bg-[#f7f9fa] p-3 ${embedded ? "" : "mt-2"}`}
      data-task-form={idPrefix}
    >
      <legend className="sr-only">Task from this comment</legend>
      <div className="flex flex-col gap-1">
        <label htmlFor={`${idPrefix}-title`} className="text-[10.5px] font-semibold uppercase tracking-wide text-neutral-400">
          Task
        </label>
        <input
          id={`${idPrefix}-title`}
          value={title}
          maxLength={200}
          onChange={(event) => {
            setTitle(event.target.value);
            change({ title: event.target.value });
          }}
          className={field}
        />
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <label htmlFor={`${idPrefix}-assignee`} className="text-[10.5px] font-semibold uppercase tracking-wide text-neutral-400">
            Assign to
          </label>
          <select
            id={`${idPrefix}-assignee`}
            value={assignee}
            onChange={(event) => {
              setAssignee(event.target.value);
              change({ assignee: event.target.value || null });
            }}
            className={field}
          >
            <option value="">Unassigned</option>
            {members.map((member) => (
              <option key={member.email} value={member.email}>
                {member.email === me ? `${member.name} (you)` : member.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${idPrefix}-due`} className="text-[10.5px] font-semibold uppercase tracking-wide text-neutral-400">
            Due
          </label>
          <input
            id={`${idPrefix}-due`}
            type="date"
            value={due}
            onChange={(event) => {
              setDue(event.target.value);
              change({ due: event.target.value || null });
            }}
            className={field}
          />
        </div>
        {onSubmit && (
          <div className="ml-auto flex gap-2">
            <button type="button" className={secondary} onClick={onCancel}>
              Cancel
            </button>
            <button
              type="button"
              className={primary}
              disabled={busy || !title.trim()}
              onClick={async () => {
                setBusy(true);
                setError(null);
                const message = await onSubmit({ title, assignee: assignee || null, due: due || null });
                setBusy(false);
                if (message) setError(message);
              }}
            >
              {busy ? "Creating…" : submitLabel}
            </button>
          </div>
        )}
      </div>
      {error && (
        <p role="alert" className="text-[12px] text-red-600">
          {error}
        </p>
      )}
    </fieldset>
  );
}

function Composer({
  id,
  companyId,
  dealId,
  parentId,
  candidates,
  members,
  me,
  allowTask = false,
  editing,
  dir,
  onDone,
  autoFocus = false,
}: {
  id: string;
  companyId: string;
  dealId: string | null;
  parentId: string | null;
  candidates: MentionCandidate[];
  members: DirectoryEntry[];
  me: string;
  allowTask?: boolean;
  editing?: CommentItem;
  dir?: Map<string, DirectoryEntry>;
  onDone?: () => void;
  autoFocus?: boolean;
}) {
  const router = useRouter();
  const [text, setText] = useState(editing?.body ?? "");
  const [selected, setSelected] = useState<MentionCandidate[]>(
    () => editing?.mentions.map((email) => ({ email, name: dir?.get(email)?.name ?? email })) ?? []
  );
  const [withTask, setWithTask] = useState(false);
  const [task, setTask] = useState<CommentTaskInput>({ title: "", assignee: me, due: null });
  const [taskTouched, setTaskTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function submit() {
    const body = text.trim();
    if (!body || isPending) return;
    setError(null);
    const mentions = keptMentions(body, selected);
    startTransition(async () => {
      const result = editing
        ? await editCommentAction({ commentId: editing.id, companyId, dealId, body, mentions })
        : await postCommentAction({
            companyId,
            dealId,
            parentId,
            body,
            mentions,
            task: withTask ? { ...task, title: taskTouched ? task.title : taskTitleFromComment(body) } : null,
          });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setText("");
      setSelected([]);
      setWithTask(false);
      setTaskTouched(false);
      onDone?.();
      router.refresh();
    });
  }

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <MentionTextarea
        id={id}
        label={editing ? "Edit comment" : parentId ? "Reply" : "Comment"}
        value={text}
        onChange={setText}
        onMention={(member) => setSelected((current) => [...current, member])}
        onSubmit={submit}
        candidates={candidates}
        rows={editing || parentId ? 2 : 3}
        autoFocus={autoFocus || Boolean(editing)}
        placeholder={parentId ? "Write a reply…" : "Write a comment… Type @ to mention a member"}
      />
      {allowTask && withTask && (
        <TaskForm
          idPrefix={`${id}-task`}
          initialTitle={taskTitleFromComment(text)}
          members={members}
          me={me}
          embedded
          onChange={(next) => {
            setTaskTouched(true);
            setTask(next);
          }}
        />
      )}
      <div className="flex flex-wrap items-center gap-2">
        {allowTask && (
          <label className="flex cursor-pointer items-center gap-1.5 text-[12px] text-neutral-600">
            <input
              type="checkbox"
              checked={withTask}
              onChange={(event) => setWithTask(event.target.checked)}
              className="accent-cyan-700"
            />
            Also create a task
          </label>
        )}
        <span className="text-[10.5px] text-neutral-400">Ctrl/⌘+Enter to {editing ? "save" : "post"}</span>
        <div className="ml-auto flex gap-2">
          {onDone && (
            <button type="button" className={secondary} onClick={onDone}>
              Cancel
            </button>
          )}
          <button type="submit" className={primary} disabled={isPending || !text.trim()} data-sound="add">
            {isPending ? "Saving…" : editing ? "Save" : parentId ? "Reply" : "Post comment"}
          </button>
        </div>
      </div>
      {error && (
        <p role="alert" className="text-[12px] text-red-600">
          {error}
        </p>
      )}
    </form>
  );
}
