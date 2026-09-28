"use client";

import { useState } from "react";
import DealAssigneeAvatars from "@/components/DealAssigneeAvatars";
import type { DealMember } from "@/lib/deals/assignee-types";

// Quick "Members" picker right on the card face, the way Trello does it:
// click the avatar stack (or the dashed "+" when nobody is assigned yet) and
// check off whoever should own this card, without opening the full card.
// Stops the click/pointerdown from reaching the card's own drag/open
// handlers — same trick LinkedDealCard already uses for "Unlink Deal".
export default function MemberAssignMenu({
  members,
  assigned,
  onToggle,
  label = "Members",
}: {
  members: DealMember[];
  assigned: DealMember[];
  onToggle: (email: string, next: boolean) => Promise<unknown> | void;
  label?: string;
}) {
  const [busyEmail, setBusyEmail] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const shown = query ? members.filter((member) => member.name.toLowerCase().includes(query.toLowerCase())) : members;

  return (
    <details
      className="relative inline-block"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <summary
        aria-label={assigned.length ? `${label}: ${assigned.map((person) => person.name).join(", ")}` : `Add ${label.toLowerCase()}`}
        className="flex w-fit cursor-pointer list-none items-center rounded-full p-0.5 hover:bg-[#eef1f2]"
      >
        {assigned.length ? (
          <DealAssigneeAvatars members={assigned} />
        ) : (
          <span className="flex h-6 w-6 items-center justify-center rounded-full border border-dashed border-neutral-300 text-[13px] leading-none text-neutral-400">+</span>
        )}
      </summary>
      <div className="absolute right-0 top-7 z-30 w-56 rounded-xl border border-neutral-200 bg-white p-2 shadow-lg">
        <p className="px-1.5 pb-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-neutral-400">{label}</p>
        {members.length > 6 && (
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search members…"
            className="mb-1.5 w-full rounded-lg border border-neutral-200 px-2 py-1 text-xs outline-none focus:border-cyan-400"
          />
        )}
        <div className="max-h-48 space-y-0.5 overflow-y-auto">
          {shown.map((member) => {
            const selected = assigned.some((person) => person.email === member.email);
            return (
              <label key={member.email} className="flex cursor-pointer items-center gap-2 rounded-lg px-1.5 py-1.5 text-xs hover:bg-neutral-50">
                <input
                  type="checkbox"
                  checked={selected}
                  disabled={busyEmail !== null}
                  onChange={async (event) => {
                    event.stopPropagation();
                    setBusyEmail(member.email);
                    await onToggle(member.email, !selected);
                    setBusyEmail(null);
                  }}
                  className="h-3.5 w-3.5 accent-cyan-700"
                />
                <span className="truncate">{member.name}</span>
              </label>
            );
          })}
          {!shown.length && <p className="px-1.5 py-1.5 text-xs text-neutral-400">No members found.</p>}
        </div>
      </div>
    </details>
  );
}
