// Area permissions. They mirror member_permissions.permission in the
// database, where RLS enforces them; the app uses them to hide and block
// the same areas. Nothing is granted by default.

export const AREA_PERMISSIONS = ["portfolio", "documents"] as const;
export type AreaPermission = (typeof AREA_PERMISSIONS)[number];

export type AccessState =
  | { status: "anonymous" }
  | { status: "unauthorized"; email: string | null }
  | { status: "member"; email: string; permissions: ReadonlySet<AreaPermission> };

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

export type NavItem = { href: string; label: string; requires?: AreaPermission };

export const WORKSPACE_NAV: NavItem[] = [
  { href: "/overview", label: "Overview" },
  { href: "/pipeline", label: "Pipeline" },
  { href: "/companies", label: "Companies" },
  { href: "/people", label: "People" },
  { href: "/tasks", label: "Tasks" },
  { href: "/review", label: "Review" },
  { href: "/portfolio", label: "Portfolio", requires: "portfolio" },
];

export function visibleNav(items: NavItem[], permissions: ReadonlySet<AreaPermission>) {
  return items.filter((item) => !item.requires || permissions.has(item.requires));
}
