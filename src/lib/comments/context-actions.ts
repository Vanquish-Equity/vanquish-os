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
  visible_to: string[] | null;
  value_snapshot: string | null;
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
    .select("id,parent_id,target_key,target_label,author_email,body,created_at,edited_at,deleted_at,resolved_at,visible_to,value_snapshot,mentions:record_comment_mentions(member_email)");
  query = scope.page ? query.eq("page_key", scope.page) : query.eq("company_id", scope.companyId!);
  query = scope.dealId ? query.eq("deal_id", scope.dealId) : query.is("deal_id", null);
  const [{ data, error }, directory] = await Promise.all([
    query.order("created_at", { ascending: true }).limit(500), loadDirectory(supabase),
  ]);
  if (error) return null; // 0021 is not applied yet in a preview.
  const conversations = await supabase.from("chat_conversations").select("id,title,participants:chat_participants(member_email,left_at)").order("last_message_at",{ascending:false}).limit(100);
  return {
    conversations:(conversations.data??[]).map(item=>({id:item.id,name:item.title??item.participants.filter(p=>!p.left_at&&p.member_email!==access.email).map(p=>directory.get(p.member_email)?.name??p.member_email).join(", ")??"Conversation"})),
    comments: (data ?? []) as ContextComment[],
    members: [...directory.values()].filter((member) => member.active).map(({ email, name }) => ({ email, name })),
    me: access.email,
  };
}

export async function postContextCommentAction(input: {
  pathname: string; scope: ContextScope; parentId?: string | null;
  target: string; label: string; body: string; mentions: string[]; snapshot?: string | null; recipients?: string[] | null;
}) {
  const access = await getAccess();
  if (access.status !== "member" || !validScope(input.pathname, input.scope)) return { ok: false, message: "Access denied." };
  if (!safeTargetKey(input.target) || !input.label.trim() || input.label.length > 140 || !input.body.trim() || input.body.length > 4000)
    return { ok: false, message: "Check the comment and its location." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("comment_post_visible", {
    p_page: input.scope.page, p_company: input.scope.companyId, p_deal: input.scope.dealId,
    p_parent: input.parentId ?? null, p_target: input.target, p_label: input.label,
    p_snapshot: input.snapshot?.slice(0,500) ?? null, p_body: input.body, p_mentions: input.mentions, p_recipients: input.recipients ?? null,
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

export async function shareContextCommentAction(commentId:string,conversationId:string) {
  if((await getAccess()).status!=="member")return {ok:false,message:"Access denied."};
  const {error}=await (await createClient()).rpc("share_comment_to_chat",{p_comment:commentId,p_conversation:conversationId});
  if(!error)revalidatePath("/chat","layout");
  return {ok:!error,message:error?"Could not share. Every active chat participant must have access to this discussion.":"Discussion link sent to chat."};
}
