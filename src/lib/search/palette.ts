import { visibleNav, WORKSPACE_NAV, type AreaPermission, type NavIcon } from "@/lib/auth/permissions";

// Index behind the "Go to ..." rows of the search palette (⌘K) and the actions
// of the "+ New" menu. Both are plain data over routes that already exist.

export type PaletteCommand = { href: string; label: string; icon: NavIcon };

// Destinations the member can see in the sidebar, in sidebar order. It is built
// on the server with the same permission filter the sidebar uses and only the
// result reaches the browser, so an area without permission is never listed,
// not even by name. `chatAvailable` mirrors the sidebar, which hides the
// unread-badge items (Notifications, Chat) until their migration exists.
export function navCommands(
  permissions: ReadonlySet<AreaPermission>,
  { chatAvailable = true }: { chatAvailable?: boolean } = {},
): PaletteCommand[] {
  return visibleNav(WORKSPACE_NAV, permissions)
    .filter((item) => chatAvailable || !item.badge)
    .map(({ href, label, icon }) => ({ href, label, icon }));
}

const normalize = (value: string) => value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

// Every word typed must appear in the label or in the route's words
// ("inbox" finds Action center, which lives at /inbox). An empty query lists
// every destination.
export function matchCommands(commands: PaletteCommand[], query: string): PaletteCommand[] {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return commands;
  return commands.filter((command) => {
    const haystack = normalize(`${command.label} ${command.href.replace(/[/-]/g, " ")}`);
    return words.every((word) => haystack.includes(word));
  });
}

export type NewAction = { id: string; label: string; href: string; needsChat?: boolean };

// Creation flows that already work from a route. `?new=1` opens the existing
// modal of that page (Tasks already did; Pipeline and People gained it).
// None is gated by an area permission today, as their pages are open to every
// member. Not included: New company (it only exists inside the New deal
// dialog) and Gmail compose (a dialog with no URL entry).
export const NEW_ACTIONS: NewAction[] = [
  { id: "deal", label: "New deal", href: "/pipeline?new=1" },
  { id: "person", label: "New person", href: "/people?new=1" },
  { id: "task", label: "New task", href: "/tasks?new=1" },
  { id: "draft", label: "New email draft", href: "/communications/new" },
  { id: "message", label: "New message", href: "/chat/new", needsChat: true },
];

export function newActions({ chatAvailable = true }: { chatAvailable?: boolean } = {}) {
  return NEW_ACTIONS.filter((action) => chatAvailable || !action.needsChat);
}
