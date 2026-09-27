"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
} from "react";
import LocalTime from "@/components/LocalTime";
import { useUnreadCounts } from "@/components/UnreadCounts";
import {
  addMembersAction,
  leaveGroupAction,
  markConversationReadAction,
  sendMessageAction,
} from "@/lib/chat/actions";
import {
  activeMentionQuery,
  keptMentions,
  mentionSegments,
  mentionToken,
  type DirectoryEntry,
} from "@/lib/chat/format";
import type { ChatMessage, MessageRow } from "@/lib/chat/queries";
import { useLiveSignal } from "@/lib/realtime/useLiveSignal";
import { createClient } from "@/lib/supabase/client";

const MESSAGE_COLUMNS = "id,author_email,body,created_at,mentions:chat_message_mentions(member_email)";

function toMessage(row: MessageRow): ChatMessage {
  return {
    id: row.id,
    authorEmail: row.author_email,
    body: row.body,
    createdAt: row.created_at,
    mentions: (row.mentions ?? []).map((m) => m.member_email),
  };
}

type Participant = { email: string; name: string; active: boolean; left: boolean };

export default function ConversationView({
  conversationId,
  kind,
  title,
  me,
  participants,
  directory,
  initialMessages,
  sendBlockedReason,
}: {
  conversationId: string;
  kind: "direct" | "group";
  title: string;
  me: string;
  participants: Participant[];
  directory: DirectoryEntry[];
  initialMessages: ChatMessage[];
  sendBlockedReason: string | null;
}) {
  const router = useRouter();
  const unread = useUnreadCounts();
  const dir = useMemo(() => new Map(directory.map((d) => [d.email, d])), [directory]);
  const name = (email: string) => (email === me ? "You" : dir.get(email)?.name ?? email);
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [text, setText] = useState("");
  const [selected, setSelected] = useState<{ email: string; name: string }[]>([]);
  const [picker, setPicker] = useState<{ query: string; start: number } | null>(null);
  const [pickerIndex, setPickerIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [showMembers, setShowMembers] = useState(false);
  const [adding, setAdding] = useState("");
  const listRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const lastSeen = useRef<string | null>(initialMessages.at(-1)?.createdAt ?? null);

  const activeOthers = participants.filter((p) => !p.left && p.active && p.email !== me);
  const candidates = picker
    ? activeOthers.filter((p) => p.name.toLowerCase().startsWith(picker.query.toLowerCase())).slice(0, 6)
    : [];

  // Read state: mark read on open and whenever new messages arrive while the
  // conversation is on screen.
  const markRead = useCallback(() => {
    if (document.visibilityState !== "visible") return;
    void markConversationReadAction(conversationId).then(() => unread.refresh());
    // unread.refresh is stable per provider render; ignore it as a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  useEffect(() => {
    markRead();
  }, [markRead]);

  const fetchNew = useCallback(async () => {
    const supabase = createClient();
    let query = supabase.from("chat_messages").select(MESSAGE_COLUMNS).eq("conversation_id", conversationId);
    if (lastSeen.current) query = query.gt("created_at", lastSeen.current);
    const { data } = (await query.order("created_at", { ascending: true }).limit(200)) as unknown as {
      data: MessageRow[] | null;
    };
    if (!data || data.length === 0) return;
    const incoming = data.map(toMessage);
    lastSeen.current = incoming.at(-1)!.createdAt;
    setMessages((current) => {
      const known = new Set(current.map((m) => m.id));
      return [...current, ...incoming.filter((m) => !known.has(m.id))];
    });
    if (incoming.some((m) => m.authorEmail !== me)) markRead();
  }, [conversationId, me, markRead]);

  const live = useLiveSignal({
    key: `chat:${conversationId}`,
    table: "chat_messages",
    filter: `conversation_id=eq.${conversationId}`,
    onSignal: () => void fetchNew(),
  });

  // Keep the newest message in view.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages.length]);

  function updateText(value: string, caret: number) {
    setText(value);
    const query = activeMentionQuery(value, caret);
    setPicker(query);
    setPickerIndex(0);
  }

  function chooseMention(person: Participant) {
    if (!picker) return;
    const token = `${mentionToken(person.name)} `;
    const next = text.slice(0, picker.start) + token + text.slice(picker.start + picker.query.length + 1);
    setText(next);
    setSelected((current) => [...current, { email: person.email, name: person.name }]);
    setPicker(null);
    window.requestAnimationFrame(() => {
      const caret = picker.start + token.length;
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(caret, caret);
    });
  }

  function send() {
    const body = text.trim();
    if (!body || isPending) return;
    setError(null);
    const mentions = keptMentions(body, selected);
    startTransition(async () => {
      const result = await sendMessageAction(conversationId, body, mentions);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setText("");
      setSelected([]);
      setMessages((current) => (current.some((m) => m.id === result.message.id) ? current : [...current, result.message]));
      if (!lastSeen.current || result.message.createdAt > lastSeen.current) lastSeen.current = result.message.createdAt;
      router.refresh();
    });
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (picker && candidates.length > 0) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setPickerIndex((i) => (i + 1) % candidates.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setPickerIndex((i) => (i - 1 + candidates.length) % candidates.length);
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        chooseMention(candidates[pickerIndex]);
        return;
      }
      if (event.key === "Escape") {
        setPicker(null);
        return;
      }
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      send();
    }
  }

  function leave() {
    startTransition(async () => {
      const result = await leaveGroupAction(conversationId);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      router.push("/chat");
      router.refresh();
    });
  }

  function addMember() {
    if (!adding) return;
    startTransition(async () => {
      const result = await addMembersAction(conversationId, [adding]);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setAdding("");
      router.refresh();
    });
  }

  const addable = directory.filter(
    (d) => d.active && !participants.some((p) => p.email === d.email && !p.left)
  );

  // Day separators use the viewer's local date, so they appear after hydration.
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );
  const localDay = (iso: string) => new Date(iso).toDateString();

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-3 border-b border-neutral-100 px-4 py-3 sm:px-5">
        <Link href="/chat" className="rounded-lg p-1 text-[18px] text-neutral-500 hover:text-ink md:hidden" aria-label="Back to conversations">
          ←
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-[family-name:var(--font-display)] text-[17px] font-semibold text-ink">{title}</h1>
          <p className="truncate text-[11.5px] text-neutral-500">
            {kind === "group" ? "Group · " : "Direct message · "}
            {participants
              .filter((p) => !p.left)
              .map((p) => (p.email === me ? "You" : p.name) + (p.active ? "" : " (no longer active)"))
              .join(", ")}
          </p>
        </div>
        <span
          className={`hidden rounded-full px-2 py-0.5 text-[10.5px] font-semibold sm:inline ${
            live === "live" ? "bg-emerald-50 text-emerald-700" : "bg-neutral-100 text-neutral-500"
          }`}
          title={live === "live" ? "Receiving messages in real time" : "Checking for new messages every few seconds"}
        >
          {live === "live" ? "Live" : live === "polling" ? "Auto-refresh" : "Connecting…"}
        </span>
        {kind === "group" && (
          <button
            type="button"
            onClick={() => setShowMembers((v) => !v)}
            aria-expanded={showMembers}
            className="rounded-full border border-neutral-200 px-3 py-1.5 text-[11.5px] font-semibold text-neutral-600 hover:border-cyan-300 hover:text-cyan-800"
          >
            Members
          </button>
        )}
      </header>

      {showMembers && kind === "group" && (
        <div className="border-b border-neutral-100 bg-[#f7f9fa] px-5 py-3 text-[12px]">
          <ul className="flex flex-wrap gap-1.5">
            {participants.map((p) => (
              <li
                key={p.email}
                className={`rounded-full px-2.5 py-1 ring-1 ${p.left || !p.active ? "text-neutral-400 ring-neutral-200" : "bg-white text-ink ring-neutral-200"}`}
              >
                {p.email === me ? "You" : p.name}
                {p.left ? " · left" : !p.active ? " · no longer active" : ""}
              </li>
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <label htmlFor="add-member" className="sr-only">
              Add a member
            </label>
            <select
              id="add-member"
              value={adding}
              onChange={(event) => setAdding(event.target.value)}
              className="rounded-lg border border-neutral-200 bg-white px-2 py-1.5 text-[12px]"
            >
              <option value="">Add a member…</option>
              {addable.map((d) => (
                <option key={d.email} value={d.email}>
                  {d.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={addMember}
              disabled={!adding || isPending}
              className="rounded-full bg-ink px-3 py-1.5 text-[11.5px] font-semibold text-white disabled:opacity-50"
            >
              Add
            </button>
            <button
              type="button"
              onClick={leave}
              disabled={isPending}
              className="ml-auto rounded-full border border-neutral-200 px-3 py-1.5 text-[11.5px] font-semibold text-neutral-600 hover:border-red-200 hover:text-red-700"
            >
              Leave group
            </button>
          </div>
          <p className="mt-2 text-[11px] text-neutral-500">
            Leaving removes your access to this conversation and its history; you can be added back later.
          </p>
        </div>
      )}

      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5" aria-live="polite" aria-label="Messages">
        {messages.length === 0 ? (
          <p className="py-10 text-center text-[12.5px] text-neutral-400">No messages yet. Say hello.</p>
        ) : (
          <ol className="flex flex-col gap-3">
            {messages.map((message, index) => {
              const mine = message.authorEmail === me;
              const author = dir.get(message.authorEmail);
              const showDay =
                mounted && (index === 0 || localDay(messages[index - 1].createdAt) !== localDay(message.createdAt));
              const mentionsMe = message.mentions.includes(me);
              return (
                <li key={message.id} className="flex flex-col" data-message={message.id} data-author={message.authorEmail}>
                  {showDay && (
                    <div className="my-2 text-center text-[10.5px] uppercase tracking-wide text-neutral-400">
                      <LocalTime date={message.createdAt} mode="datetime" />
                    </div>
                  )}
                  <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                    <div
                      className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-[13px] sm:max-w-[70%] ${
                        mine ? "bg-ink text-white" : mentionsMe ? "bg-cyan-50 text-ink ring-1 ring-cyan-200" : "bg-[#f3f5f6] text-ink"
                      }`}
                    >
                      <div className={`mb-0.5 flex items-baseline gap-2 text-[10.5px] ${mine ? "text-neutral-300" : "text-neutral-500"}`}>
                        <span className="font-semibold">
                          {name(message.authorEmail)}
                          {author && !author.active ? " (no longer active)" : ""}
                        </span>
                        <LocalTime date={message.createdAt} mode="smart" />
                      </div>
                      <p className="whitespace-pre-wrap break-words">
                        {mentionSegments(message.body, message.mentions, dir).map((segment, index) =>
                          segment.mention ? (
                            <span
                              key={index}
                              data-mention={segment.mention}
                              className={`rounded px-0.5 font-semibold ${mine ? "bg-white/15 text-cyan-200" : "bg-cyan-100 text-cyan-900"}`}
                            >
                              {segment.text}
                            </span>
                          ) : (
                            <span key={index}>{segment.text}</span>
                          )
                        )}
                      </p>
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>

      <div className="relative border-t border-neutral-100 px-4 py-3 sm:px-5">
        {sendBlockedReason ? (
          <p className="rounded-xl bg-[#f7f9fa] px-3 py-2.5 text-[12px] text-neutral-500">{sendBlockedReason}</p>
        ) : (
          <>
            {picker && candidates.length > 0 && (
              <ul
                role="listbox"
                aria-label="Mention a member"
                className="absolute bottom-full left-4 mb-2 w-64 overflow-hidden rounded-xl border border-neutral-200 bg-white py-1 shadow-lg"
              >
                {candidates.map((person, index) => (
                  <li key={person.email}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={index === pickerIndex}
                      onMouseDown={(event) => {
                        event.preventDefault();
                        chooseMention(person);
                      }}
                      className={`flex w-full items-center gap-2 px-3 py-2 text-left text-[12.5px] ${
                        index === pickerIndex ? "bg-[#f0fafb] text-cyan-900" : "text-ink"
                      }`}
                    >
                      <span className="font-semibold">{person.name}</span>
                      <span className="truncate text-[11px] text-neutral-400">{person.email}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <form
              onSubmit={(event) => {
                event.preventDefault();
                send();
              }}
              className="flex items-end gap-2"
            >
              <label htmlFor="chat-message" className="sr-only">
                Message
              </label>
              <textarea
                id="chat-message"
                ref={inputRef}
                value={text}
                rows={1}
                maxLength={4000}
                onChange={(event) => updateText(event.target.value, event.target.selectionStart ?? event.target.value.length)}
                onKeyDown={onKeyDown}
                onBlur={() => window.setTimeout(() => setPicker(null), 150)}
                placeholder={kind === "group" ? "Message the group…" : "Write a message…"}
                className="max-h-40 min-h-[40px] flex-1 resize-none rounded-xl border border-neutral-200 bg-white px-3 py-2 text-[13px] text-ink outline-none transition focus:border-cyan-300 focus:ring-2 focus:ring-cyan-100"
              />
              <button
                type="submit"
                disabled={isPending || !text.trim()}
                data-sound="add"
                className="rounded-full bg-ink px-4 py-2 text-[12.5px] font-semibold text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isPending ? "Sending…" : "Send"}
              </button>
            </form>
            <p className="mt-1 text-[10.5px] text-neutral-400">Type @ to mention · Enter to send · Shift+Enter for a new line</p>
          </>
        )}
        {error && (
          <p role="alert" className="mt-1 text-[12px] text-red-600">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
