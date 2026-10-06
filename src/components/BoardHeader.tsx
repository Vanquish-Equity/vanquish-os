"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import SelectMenu from "@/components/SelectMenu";
import type { DealMember } from "@/lib/deals/assignee-types";
import { archiveBoardAction, setBoardSharingAction } from "@/lib/boards/actions";

export type ShareScope = "team" | "private" | "selected";

const SCOPES: { value: ShareScope; label: string; hint: string }[] = [
  { value: "team", label: "Everyone on the team", hint: "Every active member can see and edit it." },
  { value: "selected", label: "Specific people", hint: "You and the members you pick." },
  { value: "private", label: "Only me", hint: "Hidden from everyone else." },
];

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

// A steady color per person, so the same member always looks the same.
const AVATAR_COLORS = ["#0e7490", "#4f46e5", "#7c3aed", "#be185d", "#c2410c", "#15803d", "#0369a1", "#a16207"];
function colorFor(email: string) {
  let hash = 0;
  for (const char of email) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

function Avatar({ member, ring = true }: { member: DealMember; ring?: boolean }) {
  return (
    <span
      title={member.name}
      style={member.avatarUrl ? undefined : { backgroundColor: colorFor(member.email) }}
      className={`relative flex h-7 w-7 flex-shrink-0 items-center justify-center overflow-hidden rounded-full text-[10px] font-semibold tracking-tight text-white ${ring ? "ring-2 ring-[#f4f6f7]" : ""}`}
    >
      {member.avatarUrl ? (
        <Image src={member.avatarUrl} alt="" width={28} height={28} unoptimized className="h-7 w-7 object-cover" />
      ) : (
        initials(member.name)
      )}
    </span>
  );
}

function ShareIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
      <circle cx="8" cy="7" r="3" />
      <path d="M2.5 16.5c.6-2.8 2.8-4.3 5.5-4.3 1.2 0 2.3.3 3.2.9M15.5 11v6M12.5 14h6" />
    </svg>
  );
}

export default function BoardHeader({
  boardId,
  name,
  subtitle,
  canManage,
  scope,
  sharedWith,
  ownerEmail,
  access,
  directory,
  actions,
  onError,
}: {
  boardId: string;
  name: string;
  subtitle: string;
  canManage: boolean;
  scope: ShareScope;
  sharedWith: string[];
  ownerEmail: string | null;
  access: DealMember[];
  directory: DealMember[];
  actions?: ReactNode;
  onError: (message: string) => void;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(name);
  const [editing, setEditing] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [draftScope, setDraftScope] = useState<ShareScope>(scope);
  const [draftMembers, setDraftMembers] = useState<string[]>(sharedWith);
  const [busy, setBusy] = useState(false);
  const shareRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!shareOpen && !menuOpen) return;
    const outside = (event: PointerEvent) => {
      if (shareOpen && !shareRef.current?.contains(event.target as Node)) setShareOpen(false);
      if (menuOpen && !menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setShareOpen(false);
        setMenuOpen(false);
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [shareOpen, menuOpen]);

  async function save(nextName: string, nextScope: ShareScope, nextMembers: string[]) {
    setBusy(true);
    const result = await setBoardSharingAction(boardId, nextName, nextScope, nextMembers);
    setBusy(false);
    if (!result.ok) {
      onError(result.message);
      return false;
    }
    onError("");
    router.refresh();
    return true;
  }

  async function commitTitle() {
    setEditing(false);
    const next = title.trim();
    if (!next || next === name) {
      setTitle(name);
      return;
    }
    if (!(await save(next, scope, sharedWith))) setTitle(name);
  }

  const shown = access.slice(0, 5);
  const extra = access.length - shown.length;
  const byEmail = new Map([...directory, ...access].map((member) => [member.email, member]));
  const owner = ownerEmail ? byEmail.get(ownerEmail) ?? { email: ownerEmail, name: ownerEmail.split("@")[0], avatarUrl: null } : null;
  // Who would have access with the choices in the panel (before Save).
  const draftAccess: DealMember[] =
    draftScope === "team"
      ? [...(owner ? [owner] : []), ...directory.filter((member) => member.email !== ownerEmail)]
      : [
          ...(owner ? [owner] : []),
          ...(draftScope === "selected"
            ? draftMembers.map((email) => byEmail.get(email) ?? { email, name: email.split("@")[0], avatarUrl: null })
            : []),
        ];
  const addable = draftScope === "team" ? [] : directory.filter((member) => member.email !== ownerEmail && !draftAccess.some((person) => person.email === member.email));
  const changed =
    draftScope !== scope ||
    (draftScope === "selected" && [...draftMembers].sort().join() !== [...sharedWith].sort().join());

  function openShare() {
    setDraftScope(scope);
    setDraftMembers(sharedWith);
    setShareOpen(true);
  }

  // Removing someone from a team-wide board turns it into "specific people":
  // everyone else keeps access.
  function removePerson(email: string) {
    if (draftScope === "team") {
      setDraftScope("selected");
      setDraftMembers(directory.map((member) => member.email).filter((value) => value !== ownerEmail && value !== email));
      return;
    }
    const next = draftMembers.filter((value) => value !== email);
    setDraftMembers(next);
    if (next.length === 0) setDraftScope("private");
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0 flex-1">
        {editing ? (
          <input
            autoFocus
            aria-label="Board name"
            value={title}
            maxLength={80}
            onChange={(event) => setTitle(event.target.value)}
            onBlur={() => void commitTitle()}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
              if (event.key === "Escape") {
                setTitle(name);
                setEditing(false);
              }
            }}
            className="w-[min(420px,80vw)] rounded-lg border border-cyan-400 bg-white px-2 py-0.5 text-[22px] font-semibold text-ink outline-none"
          />
        ) : canManage ? (
          <button
            type="button"
            onClick={() => setEditing(true)}
            title="Rename board"
            className="-mx-2 max-w-full truncate rounded-lg px-2 py-0.5 text-left text-[22px] font-semibold text-ink transition hover:bg-neutral-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400"
          >
            <h1 className="truncate">{title}</h1>
          </button>
        ) : (
          <h1 className="truncate text-[22px] font-semibold text-ink">{title}</h1>
        )}
        <p className="mt-0.5 text-xs text-neutral-500">{subtitle}</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div ref={shareRef} className="relative flex items-center gap-2">
          {access.length > 0 && (
            <button
              type="button"
              onClick={() => (shareOpen ? setShareOpen(false) : openShare())}
              aria-haspopup="dialog"
              aria-expanded={shareOpen}
              aria-label={`${access.length} ${access.length === 1 ? "person has" : "people have"} access. Show members`}
              className="flex items-center rounded-full p-0.5 transition hover:bg-neutral-200/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400"
            >
              <span className="flex -space-x-1">
                {shown.map((member) => (
                  <Avatar key={member.email} member={member} />
                ))}
              </span>
              {extra > 0 && <span className="ml-1.5 mr-1 text-[11.5px] font-semibold text-neutral-500">+{extra}</span>}
            </button>
          )}

          {canManage && (
            <button
              type="button"
              aria-haspopup="dialog"
              aria-expanded={shareOpen}
              onClick={() => (shareOpen ? setShareOpen(false) : openShare())}
              className="flex items-center gap-1.5 rounded-lg bg-ink px-3 py-2 text-xs font-semibold text-white transition hover:bg-[#1b2427]"
            >
              <ShareIcon /> Share
            </button>
          )}

          {shareOpen && (
            <div role="dialog" aria-label="Board members and sharing" className="absolute right-0 top-full z-40 mt-2 w-[min(360px,92vw)] rounded-xl border border-neutral-200 bg-white p-3 shadow-xl">
              <div className="mb-2 text-[13px] font-semibold text-ink">{canManage ? "Share board" : "Board members"}</div>

              {canManage && (
                <div className="flex flex-col gap-1" role="radiogroup" aria-label="Who can open this board">
                  {SCOPES.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      role="radio"
                      aria-checked={draftScope === option.value}
                      onClick={() => setDraftScope(option.value)}
                      className={`flex items-start gap-2.5 rounded-lg px-2.5 py-1.5 text-left transition ${draftScope === option.value ? "bg-[#f0fafb]" : "hover:bg-neutral-50"}`}
                    >
                      <span aria-hidden="true" className={`mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border ${draftScope === option.value ? "border-cyan-700" : "border-neutral-300"}`}>
                        {draftScope === option.value && <span className="h-2 w-2 rounded-full bg-cyan-700" />}
                      </span>
                      <span>
                        <span className="block text-[12.5px] font-semibold text-ink">{option.label}</span>
                        <span className="block text-[11px] text-neutral-500">{option.hint}</span>
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {canManage && addable.length > 0 && (
                <div className="mt-3 text-[11px] font-semibold text-ink">
                  Add people
                  <SelectMenu
                    value=""
                    placeholder="Choose a member…"
                    options={addable.map((member) => ({ value: member.email, label: `${member.name} · ${member.email}` }))}
                    onChange={(email) => {
                      if (!email) return;
                      setDraftScope("selected");
                      setDraftMembers((current) => [...new Set([...current, email])]);
                    }}
                    rootClassName="mt-1"
                  />
                </div>
              )}

              <div className="mt-3 text-[11px] font-semibold text-neutral-500">People with access ({draftAccess.length})</div>
              <ul className="mt-1 max-h-64 overflow-y-auto">
                {draftAccess.map((member) => {
                  const owner = member.email === ownerEmail;
                  return (
                    <li key={member.email} className="flex items-center gap-2.5 rounded-md px-1.5 py-1.5 hover:bg-neutral-50">
                      <Avatar member={member} ring={false} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12.5px] font-medium text-ink">{member.name}</span>
                        <span className="block truncate text-[10.5px] text-neutral-400">{member.email}</span>
                      </span>
                      {owner ? (
                        <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10.5px] font-semibold text-neutral-500">Owner</span>
                      ) : (
                        canManage && (
                          <button
                            type="button"
                            onClick={() => removePerson(member.email)}
                            className="rounded-md px-2 py-1 text-[11px] font-semibold text-neutral-500 transition hover:bg-red-50 hover:text-red-700"
                          >
                            Remove
                          </button>
                        )
                      )}
                    </li>
                  );
                })}
              </ul>

              {canManage && (
                <div className="mt-3 flex items-center justify-end gap-2 border-t border-neutral-100 pt-3">
                  <button type="button" onClick={() => setShareOpen(false)} className="rounded-lg px-3 py-1.5 text-[12px] font-semibold text-neutral-600 hover:bg-neutral-100">
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={busy || !changed || (draftScope === "selected" && draftMembers.length === 0)}
                    onClick={async () => {
                      if (await save(title.trim() || name, draftScope, draftScope === "selected" ? draftMembers : [])) setShareOpen(false);
                    }}
                    className="rounded-lg bg-ink px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-40"
                  >
                    {busy ? "Saving…" : "Save"}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {actions}

        {canManage && (
          <div ref={menuRef} className="relative">
            <button
              type="button"
              aria-label="More board actions"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((open) => !open)}
              className="rounded-lg px-2 py-2 text-neutral-500 transition hover:bg-neutral-100 hover:text-ink"
            >
              <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor">
                <circle cx="4" cy="10" r="1.6" />
                <circle cx="10" cy="10" r="1.6" />
                <circle cx="16" cy="10" r="1.6" />
              </svg>
            </button>
            {menuOpen && (
              <div role="menu" className="absolute right-0 top-full z-40 mt-2 w-44 rounded-xl border border-neutral-200 bg-white p-1 shadow-lg">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    setEditing(true);
                  }}
                  className="block w-full rounded-lg px-3 py-2 text-left text-xs text-ink hover:bg-neutral-50"
                >
                  Rename board
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={async () => {
                    setMenuOpen(false);
                    if (!window.confirm(`Archive “${title}”? Its lists and cards remain stored.`)) return;
                    const result = await archiveBoardAction(boardId);
                    if (!result.ok) onError(result.message);
                    else {
                      router.push("/boards");
                      router.refresh();
                    }
                  }}
                  className="block w-full rounded-lg px-3 py-2 text-left text-xs text-red-700 hover:bg-red-50"
                >
                  Archive board
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
