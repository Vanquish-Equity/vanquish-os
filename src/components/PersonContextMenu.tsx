"use client";

import { useEffect, useLayoutEffect, useRef, useState, useTransition, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { setPotentialLpAction } from "@/lib/people/actions";
import { createPeopleGroup, setPersonGroupMembership } from "@/lib/people-groups/actions";
import type { PeopleGroupOption } from "./person-row-context";

// Every user-facing string of the People row menu, in one place.
export const PERSON_MENU_TEXT = {
  menuLabel: (name: string) => `Classify ${name}`,
  classifyButton: "Classify",
  classifyButtonLabel: (name: string) => `Classify ${name}`,
  potentialLp: "Potential LP",
  groupsHeading: "Groups",
  noGroups: "No groups yet.",
  newGroup: "New group…",
  newGroupLabel: "Group name",
  newGroupSubmit: "Create and add",
  newGroupCancel: "Cancel",
  openProfile: "Open profile",
  openInNewTab: "Open in new tab",
  createFailed: "Could not create group.",
  groupCreatedNotAdded: "Group created, but the person was not added. Pick it from the list.",
  editContact: "Edit contact",
  saving: "Saving…",
  groupNameRequired: "Enter a group name.",
} as const;

const itemClass =
  "flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12.5px] text-ink outline-none transition hover:bg-neutral-50 focus-visible:bg-neutral-50 focus-visible:ring-2 focus-visible:ring-cyan-200 aria-disabled:cursor-wait aria-disabled:opacity-50";

function Tick({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`relative inline-flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-[5px] border transition ${
        checked ? "border-cyan-700 bg-cyan-700" : "border-neutral-300 bg-white"
      }`}
    >
      <svg viewBox="0 0 12 12" fill="none" className={`h-full w-full scale-75 text-white ${checked ? "opacity-100" : "opacity-0"}`}>
        <path d="M2.5 6.2L4.8 8.5L9.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

type ActionResult = { ok: true } | { ok: false; message: string };

export default function PersonContextMenu({
  personId,
  name,
  isPotentialLp,
  groups,
  memberGroupIds,
  profileHref,
  position,
  anchor,
  onClose,
  onEdit,
  onOpenProfile,
  onOpenInNewTab,
}: {
  personId: string;
  name: string;
  isPotentialLp: boolean;
  groups: PeopleGroupOption[];
  memberGroupIds: string[];
  profileHref: string | null;
  position: { x: number; y: number };
  // The element that opened the menu (the Classify button), if any: pressing it
  // again is a toggle handled by its own click, not an "outside" click.
  anchor: HTMLElement | null;
  onClose: (options?: { restoreFocus?: boolean }) => void;
  onEdit: () => void;
  onOpenProfile: () => void;
  onOpenInNewTab: () => void;
}) {
  const router = useRouter();
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const members = new Set(memberGroupIds);

  // Keep the menu inside the viewport; it grows when the form or an error shows.
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const margin = 8;
    const { width, height } = el.getBoundingClientRect();
    el.style.left = `${Math.max(margin, Math.min(position.x, window.innerWidth - width - margin))}px`;
    el.style.top = `${Math.max(margin, Math.min(position.y, window.innerHeight - height - margin))}px`;
  }, [position.x, position.y, creating, error, isPending, groups.length]);

  // Focus moves into the menu when it opens.
  useEffect(() => {
    menuRef.current?.querySelector<HTMLElement>("[data-menu-item]")?.focus();
  }, []);

  useEffect(() => {
    const el = menuRef.current;
    function outside(event: Event) {
      const target = event.target as Node | null;
      if (!target || el?.contains(target) || anchor?.contains(target)) return;
      onClose({ restoreFocus: false });
    }
    function scrolled(event: Event) {
      if (event.target instanceof Node && el?.contains(event.target)) return;
      onClose({ restoreFocus: false });
    }
    const close = () => onClose({ restoreFocus: false });
    // Escape closes the menu even when focus has moved out of it.
    function escape(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    }
    document.addEventListener("keydown", escape);
    document.addEventListener("mousedown", outside);
    window.addEventListener("scroll", scrolled, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("keydown", escape);
      document.removeEventListener("mousedown", outside);
      window.removeEventListener("scroll", scrolled, true);
      window.removeEventListener("resize", close);
    };
  }, [anchor, onClose]);

  // keepOpen: group toggles leave the menu up so several groups can be set in a row.
  function run(task: () => Promise<ActionResult>, options?: { keepOpen?: boolean }) {
    if (isPending) return;
    setError(null);
    startTransition(async () => {
      const result = await task();
      if (!result.ok) {
        setError(result.message);
        return;
      }
      router.refresh();
      if (!options?.keepOpen) onClose();
    });
  }

  function createGroup(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = newName.trim();
    if (!trimmed) {
      setError(PERSON_MENU_TEXT.groupNameRequired);
      return;
    }
    if (isPending) return;
    setError(null);
    startTransition(async () => {
      const created = await createPeopleGroup(trimmed);
      if (!created.ok) {
        setError(created.message);
        return;
      }
      if (!created.id) {
        setError(PERSON_MENU_TEXT.createFailed);
        router.refresh();
        return;
      }
      const added = await setPersonGroupMembership(personId, created.id, true);
      // The group exists either way, so refresh to list it.
      router.refresh();
      if (!added.ok) {
        // Retrying the same name would fail ("already exists"): reset the form
        // and point to the list instead.
        setNewName("");
        setCreating(false);
        setError(PERSON_MENU_TEXT.groupCreatedNotAdded);
        return;
      }
      onClose();
    });
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Tab" && !(event.target as HTMLElement).closest("form")) {
      onClose();
      return;
    }
    if ((event.target as HTMLElement).tagName === "INPUT") return;
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>("[data-menu-item]") ?? []);
    if (!items.length) return;
    const index = items.indexOf(document.activeElement as HTMLElement);
    let next: number | null = null;
    if (event.key === "ArrowDown") next = (index + 1) % items.length;
    else if (event.key === "ArrowUp") next = (index - 1 + items.length) % items.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = items.length - 1;
    if (next === null) return;
    event.preventDefault();
    items[next].focus();
  }

  const t = PERSON_MENU_TEXT;
  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label={t.menuLabel(name)}
      aria-busy={isPending}
      onKeyDown={onKeyDown}
      onContextMenu={(event) => event.preventDefault()}
      style={{ left: position.x, top: position.y }}
      className="vq-card-static fixed z-[55] max-h-[70vh] w-64 max-w-[calc(100vw-16px)] overflow-y-auto rounded-xl border border-neutral-200 bg-white p-1 text-left shadow-lg"
    >
      <button
        type="button"
        role="menuitemcheckbox"
        aria-checked={isPotentialLp}
        aria-disabled={isPending}
        data-menu-item
        className={itemClass}
        onClick={() => run(() => setPotentialLpAction({ personId, value: !isPotentialLp }))}
      >
        <Tick checked={isPotentialLp} />
        <span className="truncate">{t.potentialLp}</span>
      </button>

      <div role="separator" className="my-1 border-t border-neutral-100" />
      <p className="px-2.5 pb-0.5 pt-1 text-[10.5px] font-semibold uppercase tracking-wide text-neutral-400">{t.groupsHeading}</p>
      {groups.length === 0 && <p className="px-2.5 py-1.5 text-[11.5px] text-neutral-400">{t.noGroups}</p>}
      {groups.map((group) => {
        const checked = members.has(group.id);
        return (
          <button
            key={group.id}
            type="button"
            role="menuitemcheckbox"
            aria-checked={checked}
            aria-disabled={isPending}
            data-menu-item
            className={itemClass}
            onClick={() => run(() => setPersonGroupMembership(personId, group.id, !checked), { keepOpen: true })}
          >
            <Tick checked={checked} />
            <span className="truncate">{group.name}</span>
          </button>
        );
      })}

      <div role="separator" className="my-1 border-t border-neutral-100" />
      {creating ? (
        <form role="none" onSubmit={createGroup} className="flex flex-col gap-1.5 px-2 py-1.5">
          <label htmlFor={`new-group-${personId}`} className="text-[10.5px] font-semibold uppercase tracking-wide text-neutral-400">
            {t.newGroupLabel}
          </label>
          <input
            id={`new-group-${personId}`}
            autoFocus
            value={newName}
            maxLength={80}
            disabled={isPending}
            onChange={(event) => setNewName(event.target.value)}
            className="w-full rounded-xl border border-neutral-200 bg-white px-3 py-1.5 text-[12.5px] text-ink outline-none transition focus:border-cyan-300 focus:ring-2 focus:ring-cyan-100"
          />
          <div className="flex justify-end gap-1.5">
            <button
              type="button"
              disabled={isPending}
              onClick={() => {
                setCreating(false);
                setError(null);
              }}
              className="rounded-full border border-neutral-200 px-2.5 py-1 text-[11px] font-semibold text-neutral-600 transition hover:border-cyan-300 hover:text-cyan-800"
            >
              {t.newGroupCancel}
            </button>
            <button
              type="submit"
              disabled={isPending || !newName.trim()}
              className="rounded-full bg-ink px-2.5 py-1 text-[11px] font-semibold text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t.newGroupSubmit}
            </button>
          </div>
        </form>
      ) : (
        <button
          type="button"
          role="menuitem"
          aria-disabled={isPending}
          data-menu-item
          className={itemClass}
          onClick={() => {
            if (!isPending) setCreating(true);
          }}
        >
          <span aria-hidden="true" className="inline-flex h-4 w-4 flex-shrink-0 items-center justify-center text-[13px] font-semibold text-cyan-700">
            +
          </span>
          <span>{t.newGroup}</span>
        </button>
      )}

      {profileHref && (
        <>
          <div role="separator" className="my-1 border-t border-neutral-100" />
          <button type="button" role="menuitem" data-menu-item className={itemClass} onClick={onOpenProfile}>
            <span className="w-4 flex-shrink-0" aria-hidden="true" />
            <span>{t.openProfile}</span>
          </button>
          <button type="button" role="menuitem" data-menu-item className={itemClass} onClick={onOpenInNewTab}>
            <span className="w-4 flex-shrink-0" aria-hidden="true" />
            <span>{t.openInNewTab}</span>
          </button>
        </>
      )}
      {!profileHref && <div role="separator" className="my-1 border-t border-neutral-100" />}
      <button type="button" role="menuitem" data-menu-item className={itemClass} onClick={onEdit}>
        <span className="w-4 flex-shrink-0" aria-hidden="true" />
        <span>{t.editContact}</span>
      </button>

      {isPending && (
        <p role="status" className="px-2.5 py-1 text-[11px] text-neutral-500">
          {t.saving}
        </p>
      )}
      {error && (
        <p role="alert" className="px-2.5 py-1 text-[11px] text-red-600">
          {error}
        </p>
      )}
    </div>,
    document.body,
  );
}
