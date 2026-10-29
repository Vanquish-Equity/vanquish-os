import type { ReactNode } from "react";

// The server page resolves the request-scoped, lock-free flag before rendering.
// Paused/missing flags omit client widgets and their load actions entirely.
export default function CustomFieldsGate({
  enabled,
  children,
}: {
  enabled: boolean;
  children: ReactNode;
}) {
  return enabled ? children : null;
}
