"use client";

import { useCallback, useContext, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import PersonContextMenu from "@/components/PersonContextMenu";
import { EditContactDialog } from "@/components/PersonContactActions";
import { PeopleGroupsContext, PersonRowContext, type PeopleGroupOption } from "@/components/person-row-context";

// Controls inside a row keep their own behavior: a click on one of them never
// opens the profile.
const INTERACTIVE = 'a,button,input,select,textarea,label,summary,[role="button"],[role="menuitem"],[role="menuitemcheckbox"],[contenteditable="true"]';

// Provides the group list once for the whole table instead of once per row.
export function PeopleGroupsProvider({ groups, children }: { groups: PeopleGroupOption[]; children: ReactNode }) {
  return <PeopleGroupsContext.Provider value={groups}>{children}</PeopleGroupsContext.Provider>;
}

// anchor: the Classify button (pressing it again closes the menu); returnTo: where focus goes back.
type MenuState = { x: number; y: number; anchor: HTMLElement | null; returnTo: HTMLElement | null };

// One People table row. The cells stay server-rendered (children); this
// wrapper adds what needs the browser: a click opens the profile (when it is
// reachable), and a right-click, the ContextMenu key, Shift+F10 or the
// Classify button opens the classification menu.
export default function PersonRow({
  personId,
  name,
  email,
  isPotentialLp,
  profileHref,
  memberGroupIds,
  children,
}: {
  personId: string;
  name: string;
  email: string | null;
  isPotentialLp: boolean;
  profileHref: string | null;
  memberGroupIds: string[];
  children: ReactNode;
}) {
  const router = useRouter();
  const groups = useContext(PeopleGroupsContext);
  const rowRef = useRef<HTMLTableRowElement | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [editing, setEditing] = useState(false);
  // A press that closes the menu must not also open the profile.
  const suppressClick = useRef(false);
  const menuStateRef = useRef<MenuState | null>(null);
  useEffect(() => {
    menuStateRef.current = menu;
  }, [menu]);

  const closeMenu = useCallback((options?: { restoreFocus?: boolean }) => {
    const current = menuStateRef.current;
    setMenu(null);
    if (current && options?.restoreFocus !== false) {
      const target = current.returnTo?.isConnected ? current.returnTo : rowRef.current;
      window.setTimeout(() => target?.focus(), 0);
    }
  }, []);

  const openMenuFrom = useCallback(
    (anchor: HTMLElement) => {
      if (menuStateRef.current) {
        closeMenu();
        return;
      }
      const rect = anchor.getBoundingClientRect();
      setMenu({ x: rect.left, y: rect.bottom + 4, anchor, returnTo: anchor });
    },
    [closeMenu],
  );

  const api = useMemo(
    () => ({ openMenuFrom, openEdit: () => setEditing(true), menuOpen: menu !== null }),
    [openMenuFrom, menu],
  );

  function onContextMenu(event: MouseEvent<HTMLTableRowElement>) {
    const target = event.target as Element;
    if (!event.currentTarget.contains(target) || target.closest("input,textarea,select,[contenteditable='true']")) return;
    event.preventDefault();
    setMenu({ x: event.clientX, y: event.clientY, anchor: null, returnTo: rowRef.current });
  }

  function onClick(event: MouseEvent<HTMLTableRowElement>) {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    if (!profileHref || event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const target = event.target as Element;
    if (!event.currentTarget.contains(target)) return;
    const control = target.closest(INTERACTIVE);
    if (control && event.currentTarget.contains(control)) return;
    if (window.getSelection()?.toString()) return;
    router.push(profileHref);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTableRowElement>) {
    const target = event.target as HTMLElement;
    if (!event.currentTarget.contains(target)) return;
    if (event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey)) {
      event.preventDefault();
      const rect = target.getBoundingClientRect();
      const onRow = target === event.currentTarget;
      setMenu({ x: rect.left + (onRow ? 16 : 0), y: onRow ? rect.bottom - 4 : rect.bottom + 4, anchor: null, returnTo: target });
      return;
    }
    if (event.key === "Enter" && target === event.currentTarget && profileHref) {
      event.preventDefault();
      router.push(profileHref);
    }
  }

  return (
    <>
      <tr
        ref={rowRef}
        tabIndex={0}
        aria-haspopup="menu"
        aria-expanded={menu !== null}
        onMouseDown={() => {
          suppressClick.current = menuStateRef.current !== null;
        }}
        onClick={onClick}
        onContextMenu={onContextMenu}
        onKeyDown={onKeyDown}
        className={`border-b border-neutral-50 outline-none last:border-0 focus-visible:bg-neutral-50 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-cyan-400 ${
          profileHref ? "cursor-pointer hover:bg-neutral-50" : ""
        }`}
      >
        <PersonRowContext.Provider value={api}>{children}</PersonRowContext.Provider>
      </tr>
      {menu && (
        <PersonContextMenu
          personId={personId}
          name={name}
          isPotentialLp={isPotentialLp}
          groups={groups}
          memberGroupIds={memberGroupIds}
          profileHref={profileHref}
          position={{ x: menu.x, y: menu.y }}
          anchor={menu.anchor}
          onClose={closeMenu}
          onEdit={() => {
            setMenu(null);
            setEditing(true);
          }}
          onOpenProfile={() => {
            setMenu(null);
            if (profileHref) router.push(profileHref);
          }}
        />
      )}
      {editing && (
        <EditContactDialog
          personId={personId}
          name={name}
          email={email}
          isPotentialLp={isPotentialLp}
          onClose={() => {
            setEditing(false);
            window.setTimeout(() => rowRef.current?.focus(), 0);
          }}
        />
      )}
    </>
  );
}
