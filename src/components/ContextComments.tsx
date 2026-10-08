"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import SelectMenu from "@/components/SelectMenu";
import Checkbox from "@/components/Checkbox";
import MentionTextarea, { type MentionCandidate } from "@/components/MentionTextarea";
import { useUnreadCounts } from "@/components/UnreadCounts";
import { keptMentions } from "@/lib/chat/format";
import {
  deleteContextCommentAction, editContextCommentAction, loadContextCommentsAction,
  postContextCommentAction, setContextResolvedAction, shareContextCommentAction, type ContextComment,
} from "@/lib/comments/context-actions";
import { contextHref, contextScope, safeTargetKey } from "@/lib/comments/context";
import { markCommentNotificationsReadAction } from "@/lib/notifications/actions";
import { useLiveSignal } from "@/lib/realtime/useLiveSignal";

type Anchor = { key: string; label: string; snapshot?: string | null };
type Menu = { x: number; y: number; anchor: Anchor; href: string };
type Pin = { anchor: Anchor; x: number; y: number; count: number };

const button = "rounded-full border border-neutral-200 bg-white px-3 py-1.5 text-[12px] font-semibold text-neutral-600 transition hover:border-cyan-300 hover:text-cyan-800 disabled:opacity-50";
const primary = "rounded-full bg-ink px-4 py-1.5 text-[12px] font-semibold text-white disabled:opacity-50";

// Deliberately semantic: a section's stable id, or the page itself. Never
// store raw screen coordinates as a comment's identity.
function anchorAt(element: Element): Anchor {
  const target = element.closest<HTMLElement>("[data-comment-anchor],section[id],article[id]");
  const key = target?.dataset.commentAnchor ?? target?.id;
  if (key && safeTargetKey(key) && key !== "comments" && key !== "documents" && key !== "investments") {
    const label = target?.dataset.commentLabel ?? target?.querySelector("h1,h2,h3")?.textContent?.trim() ?? key;
    return { key, label: label.slice(0, 140) || key, snapshot: target?.dataset.commentValue?.slice(0,500) ?? null };
  }
  return { key: "page", label: "This page" };
}

function anchorElement(key: string) {
  if (key === "page") return document.querySelector("main");
  return document.querySelector(`[data-comment-anchor="${CSS.escape(key)}"]`) ?? document.getElementById(key);
}

export default function ContextComments() {
  const pathname = usePathname();
  const router = useRouter();
  const scope = useMemo(() => contextScope(pathname), [pathname]);
  const unread = useUnreadCounts();
  const refreshUnread = unread.refresh;
  const [comments, setComments] = useState<ContextComment[]>([]);
  const [members, setMembers] = useState<MentionCandidate[]>([]);
  const [conversations,setConversations] = useState<{id:string;name:string}[]>([]);
  const [sharing,setSharing] = useState<string|null>(null);
  const [conversation,setConversation] = useState("");
  const [me, setMe] = useState("");
  const [available, setAvailable] = useState(false);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [active, setActive] = useState<Anchor | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [replying, setReplying] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [selected, setSelected] = useState<MentionCandidate[]>([]);
  const [isPrivate, setIsPrivate] = useState(false);
  const [recipients, setRecipients] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pins, setPins] = useState<Pin[]>([]);
  const [hash, setHash] = useState("");
  const panelRef = useRef<HTMLElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const openedHash = useRef("");

  const reload = useCallback(async () => {
    if (!scope) return;
    const data = await loadContextCommentsAction(pathname, scope);
    setAvailable(Boolean(data));
    setComments((data?.comments ?? []).filter((comment) => comment.target_key));
    setMembers(data?.members ?? []);
    setConversations(data?.conversations ?? []);
    setMe(data?.me ?? "");
  }, [pathname, scope]);

  useEffect(() => {
    if (!scope) return;
    let live = true;
    void loadContextCommentsAction(pathname, scope).then((data) => {
      if (!live) return;
      setAvailable(Boolean(data));
      setComments((data?.comments ?? []).filter((comment) => comment.target_key));
      setMembers(data?.members ?? []);
    setConversations(data?.conversations ?? []);
      setMe(data?.me ?? "");
    });
    return () => { live = false; };
  }, [pathname, scope]);

  useLiveSignal({
    key: `context:${pathname}`, table: "record_comments", enabled: Boolean(scope && available),
    onSignal: () => void reload(), pollMs: 15000, safetyMs: 60000,
  });

  useEffect(() => {
    function changed() { setHash(window.location.hash); }
    changed();
    window.addEventListener("hashchange", changed);
    return () => window.removeEventListener("hashchange", changed);
  }, [pathname]);

  useEffect(() => {
    if (!scope) return;
    function openMenu(event: MouseEvent) {
      const target = event.target as HTMLElement;
      if (!target.closest("main") || target.closest("input,textarea,select,[contenteditable],[data-context-exclude],#investments") ) return;
      if (target.closest("#documents") && !target.closest('[data-comment-anchor^="document:"]')) return;
      if (!available) return;
      event.preventDefault();
      setMenu({ x: event.clientX, y: event.clientY, anchor: anchorAt(target), href: target.closest<HTMLAnchorElement>("a[href]")?.href ?? window.location.href });
      setActive(null);
    }
    document.addEventListener("contextmenu", openMenu);
    return () => document.removeEventListener("contextmenu", openMenu);
  }, [scope, available]);

  useEffect(() => {
    if (!menu && !active) return;
    const focus = menu ? requestAnimationFrame(() => menuRef.current?.querySelector("button")?.focus()) : 0;
    function dismiss(event: PointerEvent) {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      // Suggestions of the @mention picker live in a portal outside the panel.
      if (target instanceof Element && target.closest("[data-mention-picker]")) return;
      setMenu(null);
      setActive(null);
    }
    function escape(event: KeyboardEvent) {
      if (event.key === "Escape") { setMenu(null); setActive(null); }
    }
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape);
    return () => {
      cancelAnimationFrame(focus);
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", escape);
    };
  }, [menu, active]);

  const roots = useMemo(() => comments.filter((c) => !c.parent_id), [comments]);
  useEffect(() => {
    if (!scope || !available) return;
    let frame = 0;
    function position() {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const groups = new Map<string, ContextComment[]>();
        for (const item of roots) {
          if (!item.target_key || (item.deleted_at && !comments.some((c) => c.parent_id === item.id && !c.deleted_at))) continue;
          groups.set(item.target_key, [...(groups.get(item.target_key) ?? []), item]);
        }
        const placed: Pin[] = [];
        for (const [key, items] of groups) {
          const element = anchorElement(key);
          if (!element) continue;
          const rect = element.getBoundingClientRect();
          if (rect.bottom < 48 || rect.top > window.innerHeight || rect.width === 0) continue;
          placed.push({
            anchor: { key, label: items[0].target_label || key }, count: items.length,
            x: Math.min(window.innerWidth - 36, Math.max(8, rect.right - 28)),
            y: Math.min(window.innerHeight - 38, Math.max(54, rect.top + 8)),
          });
        }
        setPins(placed);
      });
    }
    position();
    window.addEventListener("scroll", position, true);
    window.addEventListener("resize", position);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("scroll", position, true); window.removeEventListener("resize", position); };
  }, [scope, available, comments, roots]);

  useEffect(() => {
    const id = hash.match(/^#comment-([0-9a-f-]{36})$/i)?.[1];
    if (!id || !scope) return;
    const item = comments.find((c) => c.id === id);
    if (!item?.target_key || openedHash.current === `${pathname}:${id}`) return;
    openedHash.current = `${pathname}:${id}`;
    const frame = requestAnimationFrame(() => {
      anchorElement(item.target_key!)?.scrollIntoView({ block: "center" });
      setActive({ key: item.target_key!, label: item.target_label || item.target_key! });
      void markCommentNotificationsReadAction([id]).then(() => refreshUnread());
    });
    return () => cancelAnimationFrame(frame);
  }, [comments, pathname, scope, refreshUnread, hash]);

  useEffect(() => {
    if (!active) return;
    const id = hash.match(/^#comment-([0-9a-f-]{36})$/i)?.[1];
    if (!id) return;
    const frame = requestAnimationFrame(() => document.getElementById(`context-${id}`)?.scrollIntoView({ block: "nearest" }));
    return () => cancelAnimationFrame(frame);
  }, [active, hash, comments]);

  if (!scope) return null;

  function open(anchor: Anchor) {
    setActive(anchor); setIsPrivate(false); setRecipients([]); setMenu(null); setText(""); setSelected([]); setEditing(null); setReplying(null); setError("");
  }

  async function submit() {
    if (!scope || !active || !text.trim() || busy) return;
    setBusy(true); setError("");
    const mentions = keptMentions(text, selected);
    if (isPrivate && !replying && !editing && recipients.length === 0) { setBusy(false); setError("Select at least one recipient for a private thread."); return; }
    const result = editing
      ? await editContextCommentAction(pathname, scope, editing, text, mentions)
      : await postContextCommentAction({ pathname, scope, target: active.key, label: active.label, body: text, mentions, parentId: replying, snapshot: active.snapshot, recipients: isPrivate ? recipients : null });
    setBusy(false);
    if (!result.ok) { setError("message" in result ? String(result.message) : "Could not save the comment."); return; }
    setText(""); setIsPrivate(false); setRecipients([]); setSelected([]); setEditing(null); setReplying(null);
    await reload(); refreshUnread(); router.refresh();
  }

  const shown = roots.filter((item) => item.target_key === active?.key);
  return createPortal(
    <>
      <button type="button" className="fixed bottom-5 right-5 z-[76] flex h-11 w-11 items-center justify-center rounded-full bg-ink text-xl text-white shadow-lg sm:hidden"
        aria-label="Page actions" onClick={() => setMenu({ x: window.innerWidth - 204, y: window.innerHeight - 184, anchor: { key: "page", label: "This page" }, href: window.location.href })}>⋯</button>
      {pins.map((pin) => (
        <button key={pin.anchor.key} type="button" data-context-pin={pin.anchor.key}
          aria-label={`${pin.count} comment threads on ${pin.anchor.label}`}
          style={{ left: pin.x, top: pin.y }}
          className="fixed z-[75] flex h-7 min-w-7 items-center justify-center rounded-full border-2 border-white bg-cyan-700 px-1 text-[11px] font-bold text-white shadow-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400"
          onClick={() => open(pin.anchor)}>{pin.count}</button>
      ))}
      {menu && (
        <div ref={menuRef} role="menu" aria-label="Page actions" data-context-menu
          style={{ left: Math.min(menu.x, window.innerWidth - 208), top: Math.min(menu.y, window.innerHeight - 150) }}
          className="fixed z-[100] w-48 rounded-xl border border-neutral-200 bg-white p-1.5 text-[12px] text-ink shadow-xl">
          <button role="menuitem" type="button" className="w-full rounded-lg px-3 py-2 text-left font-semibold hover:bg-cyan-50" onClick={() => open(menu.anchor)}>
            Leave a comment
          </button>
          <button role="menuitem" type="button" className="w-full rounded-lg px-3 py-2 text-left hover:bg-neutral-50" onClick={() => { setMenu(null); router.back(); }}>Back</button>
          <button role="menuitem" type="button" className="w-full rounded-lg px-3 py-2 text-left hover:bg-neutral-50" onClick={() => { setMenu(null); router.push("/tasks?new=1"); }}>New task</button>
          <button role="menuitem" type="button" className="w-full rounded-lg px-3 py-2 text-left hover:bg-neutral-50" onClick={() => { void navigator.clipboard.writeText(menu.href); setMenu(null); }}>Copy link</button>
        </div>
      )}
      {active && (
        <aside ref={panelRef} role="dialog" aria-label={`Comments on ${active.label}`} data-context-panel
          className="fixed inset-x-2 bottom-2 z-[95] flex max-h-[80vh] flex-col rounded-2xl border border-neutral-200 bg-white shadow-2xl sm:inset-x-auto sm:bottom-auto sm:right-5 sm:top-16 sm:w-[410px] sm:max-h-[min(680px,85vh)]">
          <div className="flex items-center justify-between border-b border-neutral-100 px-4 py-3">
            <div className="min-w-0"><strong className="block truncate text-[14px] text-ink">{active.label}</strong><span className="text-[11px] text-neutral-400">Comments on this section</span></div>
            <button type="button" className={button} aria-label="Close comments" onClick={() => setActive(null)}>Close</button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
            {shown.length === 0 && <p className="py-4 text-center text-[12px] text-neutral-400">No comments here yet.</p>}
            {shown.map((root) => (
              <div key={root.id} id={`context-${root.id}`} className={`mb-3 rounded-xl border bg-[#f8fafb] p-3 text-[12px] ${hash === `#comment-${root.id}` ? "border-cyan-300 ring-2 ring-cyan-100" : "border-neutral-100"}`}>
                {root.visible_to && <p className="mb-1 text-[10px] font-semibold text-cyan-800">Private thread · {root.visible_to.length} recipients</p>}
                {root.value_snapshot && <blockquote className="mb-2 border-l-2 border-cyan-200 pl-2 text-[11px] text-neutral-500">{root.value_snapshot}</blockquote>}
                <div className="flex items-center justify-between gap-2"><span className="font-semibold text-ink">{members.find((m) => m.email === root.author_email)?.name ?? root.author_email}</span><span className="text-[10px] text-neutral-400">{new Date(root.created_at).toLocaleDateString()}</span></div>
                <p className="mt-1 whitespace-pre-wrap break-words text-ink">{root.deleted_at ? "Comment deleted by author" : root.body}</p>
                {root.edited_at && !root.deleted_at && <span className="text-[10px] text-neutral-400">(edited)</span>}
                {root.resolved_at && <span className="ml-2 text-[10px] font-semibold text-cyan-800">Resolved</span>}
                <div className="mt-2 flex flex-wrap gap-2">
                  {!root.deleted_at && <button type="button" className="text-cyan-800" onClick={() => { setReplying(root.id); setEditing(null); setText(""); setSelected([]); }}>Reply</button>}
                  {root.author_email === me && !root.deleted_at && <button type="button" className="text-neutral-500" onClick={() => { setEditing(root.id); setReplying(null); setText(root.body); setSelected(root.mentions.map((m) => ({ email: m.member_email, name: members.find((x) => x.email === m.member_email)?.name ?? m.member_email }))); }}>Edit</button>}
                  {root.author_email === me && !root.deleted_at && <button type="button" className="text-neutral-500" onClick={async () => { if (!scope || !window.confirm("Delete this comment?")) return; const result = await deleteContextCommentAction(pathname, scope, root.id); if (result.ok) await reload(); }}>Delete</button>}
                  {!root.deleted_at && <button type="button" className="text-cyan-800" onClick={async () => { if (!scope) return; const result = await setContextResolvedAction(pathname, scope, root.id, !root.resolved_at); if (result.ok) await reload(); }}>{root.resolved_at ? "Reopen" : "Resolve"}</button>}
                  <button type="button" className="text-neutral-500" onClick={() => void navigator.clipboard.writeText(new URL(contextHref(scope, root.id, root.target_key), window.location.origin).href)}>Copy link</button>
                </div>
                {!root.deleted_at && <button type="button" className="mt-2 text-[11px] font-semibold text-cyan-800" onClick={()=>{setSharing(sharing===root.id?null:root.id);setConversation("");}}>Share link to chat</button>}
                {sharing===root.id && <div className="mt-2 space-y-2"><SelectMenu value={conversation} onChange={setConversation} options={conversations.map(item=>({value:item.id,label:item.name||"Conversation"}))} placeholder="Choose conversation"/><p className="text-[10px] text-neutral-500">Sends a link only. All active participants must already have access.</p><button type="button" className={button} disabled={!conversation||busy} onClick={async()=>{setBusy(true);try{const result=await shareContextCommentAction(root.id,conversation);setError(result.message);if(result.ok)setSharing(null);}finally{setBusy(false);}}}>Send link</button></div>}
                {comments.filter((reply) => reply.parent_id === root.id).map((reply) => (
                  <div key={reply.id} id={`context-${reply.id}`} className={`mt-2 border-l-2 pl-3 ${hash === `#comment-${reply.id}` ? "rounded-r-lg border-cyan-600 bg-cyan-50" : "border-cyan-100"}`}>
                    <span className="font-semibold">{members.find((m) => m.email === reply.author_email)?.name ?? reply.author_email}</span>
                    <p className="whitespace-pre-wrap break-words">{reply.deleted_at ? "Comment deleted by author" : reply.body}</p>
                    {reply.author_email === me && !reply.deleted_at && (
                      <span className="flex gap-2">
                        <button type="button" className="text-cyan-800" onClick={() => { setEditing(reply.id); setReplying(null); setText(reply.body); setSelected(reply.mentions.map((m) => ({ email: m.member_email, name: members.find((x) => x.email === m.member_email)?.name ?? m.member_email }))); }}>Edit</button>
                        <button type="button" className="text-neutral-500" onClick={async () => { if (!scope || !window.confirm("Delete this reply?")) return; const result = await deleteContextCommentAction(pathname, scope, reply.id); if (result.ok) await reload(); }}>Delete</button>
                      </span>
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>
          <div className="border-t border-neutral-100 p-3">
            {(editing || replying) && <div className="mb-2 flex justify-between text-[11px] text-cyan-800"><span>{editing ? "Editing comment" : "Replying"}</span><button type="button" onClick={() => { setEditing(null); setReplying(null); setText(""); }}>Cancel</button></div>}
            {!editing && !replying && <div className="mb-3 text-[12px] text-neutral-600"><label className="flex items-center gap-2"><Checkbox checked={isPrivate} onChange={event => { setIsPrivate(event.target.checked); setSelected([]); }} />Private thread</label>{isPrivate && <div className="mt-2 max-h-32 overflow-auto">{members.filter(m=>m.email!==me).map(member=><label key={member.email} className="flex items-center gap-2 py-1"><Checkbox checked={recipients.includes(member.email)} onChange={event=>setRecipients(current=>event.target.checked?[...current,member.email]:current.filter(email=>email!==member.email))}/>{member.name}</label>)}</div>}</div>}
            <MentionTextarea id="context-comment-body" label="Comment" value={text} onChange={setText}
              onMention={(member) => setSelected((current) => [...current, member])}
              onSubmit={() => void submit()} candidates={members.filter((m) => m.email !== me && (replying ? !comments.find(c=>c.id===replying)?.visible_to || comments.find(c=>c.id===replying)?.visible_to?.includes(m.email) : editing ? !comments.find(c=>c.id===editing)?.visible_to || comments.find(c=>c.id===editing)?.visible_to?.includes(m.email) : !isPrivate || recipients.includes(m.email)))} rows={2}
              placeholder="Write a comment… Type @ to mention someone" />
            {error && <p role="alert" className="mt-1 text-[11px] text-red-600">{error}</p>}
            <div className="mt-2 flex justify-end"><button type="button" className={primary} disabled={!text.trim() || busy} onClick={() => void submit()}>{busy ? "Saving…" : editing ? "Save" : replying ? "Reply" : "Post comment"}</button></div>
          </div>
        </aside>
      )}
    </>, document.body
  );
}
