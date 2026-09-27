import type { CommentItem } from "@/lib/comments/format";
import { createClient } from "@/lib/supabase/server";

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

const COLUMNS =
  "id,parent_id,author_email,body,created_at,edited_at,deleted_at," +
  "mentions:record_comment_mentions(member_email)," +
  "tasks:tasks!tasks_source_comment_id_fkey(id,title,status,assignee_email,archived_at)";

type Row = {
  id: string;
  parent_id: string | null;
  author_email: string;
  body: string;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
  mentions: { member_email: string }[] | null;
  tasks: { id: string; title: string; status: "open" | "done"; assignee_email: string | null; archived_at: string | null }[] | null;
};

// Comments of one company (deal_id null) or one deal, read under the
// member's RLS. null when migration 0019 is not applied yet.
export async function loadComments(
  supabase: SupabaseClient,
  companyId: string,
  dealId: string | null
): Promise<CommentItem[] | null> {
  let query = supabase.from("record_comments").select(COLUMNS).eq("company_id", companyId);
  query = dealId ? query.eq("deal_id", dealId) : query.is("deal_id", null);
  const { data, error } = (await query.order("created_at", { ascending: true }).limit(500)) as unknown as {
    data: Row[] | null;
    error: { code?: string } | null;
  };
  if (error) return null;
  return (data ?? []).map((row) => ({
    id: row.id,
    parentId: row.parent_id,
    authorEmail: row.author_email,
    body: row.body,
    createdAt: row.created_at,
    editedAt: row.edited_at,
    deletedAt: row.deleted_at,
    mentions: (row.mentions ?? []).map((m) => m.member_email),
    tasks: (row.tasks ?? [])
      .filter((task) => !task.archived_at)
      .map((task) => ({ id: task.id, title: task.title, status: task.status, assigneeEmail: task.assignee_email })),
  }));
}
