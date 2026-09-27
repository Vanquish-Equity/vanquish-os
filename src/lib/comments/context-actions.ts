"use server";

import { revalidatePath } from "next/cache";
import { getAccess } from "@/lib/auth/access";
import { loadDirectory } from "@/lib/chat/queries";
import { contextScope, safeTargetKey, type ContextScope } from "@/lib/comments/context";
import { createClient } from "@/lib/supabase/server";

export type ContextComment = {
  id: string;
  parent_id: string | null;
  target_key: string | null;
  target_label: string | null;
  author_email: string;
  body: string;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
  resolved_at: string | null;
  mentions: { member_email: string }[];
};

function validScope(pathname: string, requested: ContextScope) {
  const scope = contextScope(pathname);
  return scope && scope.page === requested.page && scope.companyId === requested.companyId && scope.dealId === requested.dealId;
}

export async function loadContextCommentsAction(pathname: string, scope: ContextScope) {
  const access = await getAccess();
  if (access.status !== "member" || !validScope(pathname, scope)) return null;
  const supabase = await createClient();
  let query = supabase.from("record_comments")
    .select("id,parent_id,target_key,target_label,author_email,body,created_at,edited_at,deleted_at,resolved_at,mentions:record_comment_mentions(member_email)");
  query = scope.page ? query.eq("page_key", scope.page) : query.eq("company_id", scope.companyId!);
  query = scope.dealId ? query.eq("deal_id", scope.dealId) : query.is("deal_id", null);
  const [{ data, error }, directory] = await Promise.all([
    query.order("created_at", { ascending: true }).limit(500), loadDirectory(supabase),
  ]);
  if (error) return null; // 0021 is not applied yet in a preview.
  return {
    comments: (data ?? []) as ContextComment[],
    members: [...directory.values()].filter((member) => member.active).map(({ email, name }) => ({ email, name })),
    me: access.email,
  };
}

export async function postContextCommentAction(input: {
  pathname: string; scope: ContextScope; parentId?: string | null;
  target: string; label: string; body: string; mentions: string[];
}) {
  const access = await getAccess();
  if (access.status !== "member" || !validScope(input.pathname, input.scope)) return { ok: false, message: "Access denied." };
  if (!safeTargetKey(input.target) || !input.label.trim() || input.label.length > 140 || !input.body.trim() || input.body.length > 4000)
    return { ok: false, message: "Check the comment and its location." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("comment_post_context", {
    p_page: input.scope.page, p_company: input.scope.companyId, p_deal: input.scope.dealId,
    p_parent: input.parentId ?? null, p_target: input.target, p_label: input.label,
    p_snapshot: null, p_body: input.body, p_mentions: input.mentions,
  });
  if (error) return { ok: false, message: "The comment could not be posted." };
  revalidatePath(input.pathname);
  return { ok: true, commentId: data as string };
}

export async function setContextResolvedAction(pathname: string, scope: ContextScope, commentId: string, resolved: boolean) {
  const access = await getAccess();
  if (access.status !== "member" || !validScope(pathname, scope)) return { ok: false };
  const { error } = await (await createClient()).rpc("comment_set_resolved", { p_comment: commentId, p_resolved: resolved });
  if (error) return { ok: false };
  revalidatePath(pathname);
  return { ok: true };
}

export async function editContextCommentAction(pathname: string, scope: ContextScope, commentId: string, body: string, mentions: string[]) {
  const access = await getAccess();
  if (access.status !== "member" || !validScope(pathname, scope) || !body.trim() || body.length > 4000)
    return { ok: false };
  const { error } = await (await createClient()).rpc("comment_edit", { p_comment: commentId, p_body: body, p_mentions: mentions });
  if (error) return { ok: false };
  revalidatePath(pathname);
  return { ok: true };
}

export async function deleteContextCommentAction(pathname: string, scope: ContextScope, commentId: string) {
  const access = await getAccess();
  if (access.status !== "member" || !validScope(pathname, scope)) return { ok: false };
  const { error } = await (await createClient()).rpc("comment_delete", { p_comment: commentId });
  if (error) return { ok: false };
  revalidatePath(pathname);
  return { ok: true };
}
