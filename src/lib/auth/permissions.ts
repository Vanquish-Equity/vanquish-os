// Area permissions. They mirror member_permissions.permission in the
// database, where RLS enforces them; the app uses them to hide and block
// the same areas. Nothing is granted by default.

export const AREA_PERMISSIONS = ["portfolio", "documents", "admin"] as const;
export type AreaPermission = (typeof AREA_PERMISSIONS)[number];

export type AccessState =
  | { status: "anonymous" }
  | { status: "unauthorized"; email: string | null }
  | {
      status: "member";
      email: string;
      permissions: ReadonlySet<AreaPermission>;
      // Name managed by Vanquish in app_members (preferred for greetings).
      displayName?: string | null;
      // Name from the sign-in provider (Google), when there is one.
      providerName?: string | null;
    };

export function toPermissionSet(values: Array<string | null | undefined>) {
  return new Set(
    values.filter((value): value is AreaPermission =>
      (AREA_PERMISSIONS as readonly string[]).includes(value ?? "")
    )
  );
}

export function can(access: AccessState, permission: AreaPermission) {
  return access.status === "member" && access.permissions.has(permission);
}

export type NavIcon =
  | "home"
  | "chat"
  | "bell"
  | "overview"
  | "pipeline"
  | "boards"
  | "board_item"
  | "lp"
  | "companies"
  | "people"
  | "communications"
  | "calendar"
  | "tasks"
  | "review"
  | "settings"
  | "portfolio";

export type NavItem = {
  href: string;
  label: string;
  icon: NavIcon;
  requires?: AreaPermission;
  // Unread indicator shown next to the item.
  badge?: "chat" | "notifications";
};

export const WORKSPACE_NAV: NavItem[] = [
  { href: "/home", label: "Home", icon: "home" },
  { href: "/notifications", label: "Notifications", icon: "bell", badge: "notifications" },
  { href: "/chat", label: "Chat", icon: "chat", badge: "chat" },
  { href: "/overview", label: "Overview", icon: "overview" },
  { href: "/pipeline", label: "Pipeline", icon: "pipeline" },
  { href: "/boards", label: "Boards", icon: "boards" },
  { href: "/lp-board", label: "LP follow-up", icon: "lp" },
  { href: "/companies", label: "Companies", icon: "companies" },
  { href: "/people", label: "People", icon: "people" },
  { href: "/communications", label: "Communications", icon: "communications" },
  { href: "/calendar", label: "Calendar", icon: "calendar" },
  { href: "/tasks", label: "Tasks", icon: "tasks" },
  { href: "/review", label: "Review", icon: "review" },
  { href: "/portfolio", label: "Portfolio", icon: "portfolio", requires: "portfolio" },
];

export function visibleNav(items: NavItem[], permissions: ReadonlySet<AreaPermission>) {
  return items.filter((item) => !item.requires || permissions.has(item.requires));
}

