"use client";

import Checkbox from "@/components/Checkbox";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createGroupAction, startDirectAction } from "@/lib/chat/actions";
import type { DirectoryEntry } from "@/lib/chat/format";

// Only active Vanquish members can be chosen; there are no external contacts.
export default function NewConversation({ members }: { members: DirectoryEntry[] }) {
  const router = useRouter();
  const [mode, setMode] = useState<"direct" | "group">("direct");
  const [title, setTitle] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function openDirect(email: string) {
    setError(null);
    startTransition(async () => {
      const result = await startDirectAction(email);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      router.push(`/chat/${result.id}`);
    });
  }

  function createGroup() {
    setError(null);
    startTransition(async () => {
      const result = await createGroupAction(title, [...picked]);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      router.push(`/chat/${result.id}`);
    });
  }

  function toggle(email: string) {
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(email)) next.delete(email);
      else next.add(email);
      return next;
    });
  }

  const tab = (active: boolean) =>
    `rounded-full px-3 py-1.5 text-[11.5px] font-semibold transition ${
      active ? "bg-ink text-white" : "border border-neutral-200 text-neutral-600 hover:border-cyan-300 hover:text-cyan-800"
    }`;

  return (
    <div className="flex h-full flex-col overflow-y-auto px-4 py-5 sm:px-6">
      <Link href="/chat" className="text-[12px] font-semibold text-neutral-500 hover:text-cyan-700 md:hidden">
        ← Conversations
      </Link>
      <h1 className="mt-1 font-[family-name:var(--font-display)] text-[20px] font-semibold tracking-tight text-ink">
        New conversation
      </h1>
      <p className="mt-1 text-[12.5px] text-neutral-500">Only Vanquish OS members can take part.</p>

      <div className="mt-4 flex gap-2" role="group" aria-label="Conversation type">
        <button type="button" className={tab(mode === "direct")} aria-pressed={mode === "direct"} onClick={() => setMode("direct")}>
          Direct message
        </button>
        <button type="button" className={tab(mode === "group")} aria-pressed={mode === "group"} onClick={() => setMode("group")}>
          Group
        </button>
      </div>

      {members.length === 0 && <p className="mt-6 text-[12.5px] text-neutral-500">There are no other active members yet.</p>}

      {mode === "direct" ? (
        <ul className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {members.map((member) => (
            <li key={member.email}>
              <button
                type="button"
                disabled={isPending}
                onClick={() => openDirect(member.email)}
                className="vq-card flex w-full items-center gap-3 rounded-xl bg-white px-3 py-2.5 text-left disabled:opacity-60"
              >
                <span aria-hidden="true" className="flex h-8 w-8 items-center justify-center rounded-full bg-[#f0fafb] text-[12px] font-semibold text-cyan-800">
                  {member.name.charAt(0).toUpperCase()}
                </span>
                <span className="min-w-0">
                  <span className="block text-[13px] font-semibold text-ink">Message {member.name}</span>
                  <span className="block truncate text-[11px] text-neutral-500">{member.email}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <form
          className="mt-4 flex max-w-[560px] flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            createGroup();
          }}
        >
          <div>
            <label htmlFor="group-title" className="mb-1 block text-[10.5px] font-semibold uppercase tracking-wide text-neutral-400">
              Group name
            </label>
            <input
              id="group-title"
              value={title}
              maxLength={80}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="e.g. Deal team, IC prep"
              className="w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 text-[13px] text-ink outline-none focus:border-cyan-300 focus:ring-2 focus:ring-cyan-100"
            />
          </div>
          <fieldset>
            <legend className="mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-neutral-400">
              Members ({picked.size} selected, at least 2)
            </legend>
            <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {members.map((member) => (
                <li key={member.email}>
                  <label className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-neutral-100 px-3 py-2 text-[12.5px] hover:border-cyan-200">
                    <Checkbox
                      checked={picked.has(member.email)}
                      onChange={() => toggle(member.email)}
                    />
                    <span className="font-semibold text-ink">{member.name}</span>
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
          <button
            type="submit"
            disabled={isPending || !title.trim() || picked.size < 2}
            className="self-start rounded-full bg-ink px-4 py-2 text-[12px] font-semibold text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isPending ? "Creating…" : "Create group"}
          </button>
        </form>
      )}

      {error && (
        <p role="alert" className="mt-3 text-[12px] text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
