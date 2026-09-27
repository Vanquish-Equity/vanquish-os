// Pure helpers for comments on Companies and Deals.

export type CommentTask = {
  id: string;
  title: string;
  status: "open" | "done";
  assigneeEmail: string | null;
};

export type CommentItem = {
  id: string;
  parentId: string | null;
  authorEmail: string;
  body: string;
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
  mentions: string[];
  tasks: CommentTask[];
};

export type CommentThread = { root: CommentItem; replies: CommentItem[] };

// Threads oldest first, replies oldest first under their root. A deleted
// comment stays as a placeholder while it has replies (so other people's
// replies keep their context); a deleted comment with nothing under it is
// left out.
export function buildThreads(comments: CommentItem[]): CommentThread[] {
  const byTime = [...comments].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const replies = new Map<string, CommentItem[]>();
  for (const comment of byTime) {
    if (!comment.parentId) continue;
    replies.set(comment.parentId, [...(replies.get(comment.parentId) ?? []), comment]);
  }
  return byTime
    .filter((comment) => !comment.parentId)
    .map((root) => ({ root, replies: replies.get(root.id) ?? [] }))
    .filter((thread) => !thread.root.deletedAt || thread.replies.some((reply) => !reply.deletedAt))
    .map((thread) => ({
      root: thread.root,
      // A deleted reply is only kept when a later reply may depend on it.
      replies: thread.replies.filter(
        (reply, index) => !reply.deletedAt || thread.replies.slice(index + 1).some((later) => !later.deletedAt)
      ),
    }));
}

export function visibleCommentCount(threads: CommentThread[]) {
  return threads.reduce(
    (total, thread) =>
      total + (thread.root.deletedAt ? 0 : 1) + thread.replies.filter((reply) => !reply.deletedAt).length,
    0
  );
}

// Direct link to one comment on its Company or Deal page.
export function commentHref(companyId: string, dealId: string | null, commentId: string) {
  const page = dealId ? `/companies/${companyId}/deals/${dealId}` : `/companies/${companyId}`;
  return `${page}#comment-${commentId}`;
}

// Title for a new task, from the comment text.
export function taskTitleFromComment(body: string, max = 120) {
  const flat = body.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}
