import type { PerfKind } from "./collector";

// Labels are built from fixed vocabularies and validated identifiers. Query
// strings, row values, ids and addresses are never read, so they cannot be
// recorded by mistake.
const IDENT = /^[a-z][a-z0-9_.-]{0,62}$/i;
const UUID_LIKE = /[0-9a-f]{8}-[0-9a-f]{4}/i;

export function safeIdent(value: string | undefined | null) {
  if (!value || !IDENT.test(value) || UUID_LIKE.test(value) || /\d{6,}/.test(value)) return "?";
  return value;
}

export type PerfLabel = { kind: PerfKind; label: string };

const REST_METHOD: Record<string, string> = {
  GET: "select",
  HEAD: "count",
  POST: "insert",
  PATCH: "update",
  PUT: "update",
  DELETE: "delete",
};
const AUTH_SEGMENTS = new Set(["token", "user", "session", "logout", "signup", "verify", "reauthenticate", "factors", "admin"]);
const STORAGE_OPS = new Set(["sign", "public", "authenticated", "upload", "list", "info", "move", "copy"]);

function pathOf(input: unknown): string[] | null {
  try {
    const raw =
      typeof input === "string" ? input : input instanceof URL ? input.href : (input as { url?: string })?.url;
    if (!raw) return null;
    // Only the pathname is ever read; the query string is dropped here.
    return new URL(raw).pathname.split("/").filter(Boolean);
  } catch {
    return null;
  }
}

export function methodOf(input: unknown, init?: { method?: string } | null) {
  const method = init?.method ?? (input as { method?: string } | null)?.method ?? "GET";
  return String(method).toUpperCase();
}

/** Label for a request that goes to Supabase: table / function / bucket names only. */
export function supabaseLabel(input: unknown, method: string): PerfLabel {
  const seg = pathOf(input);
  if (!seg) return { kind: "other", label: "supabase other" };
  if (seg[0] === "rest" && seg[1] === "v1") {
    if (seg[2] === "rpc") return { kind: "rpc", label: `rpc ${safeIdent(seg[3])}` };
    return { kind: "db", label: `db ${REST_METHOD[method] ?? "other"} ${safeIdent(seg[2])}` };
  }
  if (seg[0] === "auth" && seg[1] === "v1") {
    const name = seg[2] === ".well-known" ? "jwks" : AUTH_SEGMENTS.has(seg[2] ?? "") ? seg[2] : "other";
    return { kind: "auth", label: `auth ${name}` };
  }
  if (seg[0] === "storage" && seg[1] === "v1") {
    const rest = seg.slice(3);
    const isOp = STORAGE_OPS.has(rest[0] ?? "");
    const op = isOp ? rest[0] : method.toLowerCase();
    const bucket = isOp ? rest[1] : rest[0];
    return { kind: "storage", label: `storage ${op} ${safeIdent(bucket)}` };
  }
  if (seg[0] === "functions" && seg[1] === "v1") return { kind: "rpc", label: `function ${safeIdent(seg[2])}` };
  return { kind: "other", label: "supabase other" };
}

const GOOGLE_WORDS = new Set([
  "messages", "threads", "labels", "history", "drafts", "profile", "watch", "stop", "attachments",
  "calendars", "events", "calendarList", "files", "about", "changes", "permissions", "settings",
  "modify", "batchModify", "send", "trash", "untrash", "import", "insert", "move", "copy", "export",
  "freeBusy", "colors",
]);

/** Generic Google endpoint name such as "gmail.threads.list". Ids are dropped. */
export function googleLabel(service: string, path: string, method: string): PerfLabel {
  const parts = path.split("?")[0].split("/").filter(Boolean);
  const words: string[] = [];
  let hasId = false;
  for (const part of parts) {
    if (GOOGLE_WORDS.has(part)) words.push(part);
    else hasId = true;
  }
  const verb =
    method === "GET" ? (hasId ? "get" : "list") : method === "POST" ? (hasId ? "post" : "create") : method.toLowerCase();
  const svc = ["gmail", "calendar", "drive"].includes(service) ? service : "google";
  return { kind: "google", label: [svc, ...words, verb].join(".") };
}
