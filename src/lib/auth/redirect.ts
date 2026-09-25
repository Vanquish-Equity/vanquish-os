// Where to send someone after sign-in. Only same-origin, absolute paths are
// accepted so `next` can never redirect to another site ("//evil.com",
// "https://evil.com", "/\evil.com", encoded variants, control characters).

export const DEFAULT_AFTER_LOGIN = "/overview";

const AUTH_PATHS = ["/login", "/auth/", "/access-denied"];

export function safeNextPath(value: string | null | undefined): string {
  if (!value) return DEFAULT_AFTER_LOGIN;

  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return DEFAULT_AFTER_LOGIN;
  }

  for (const candidate of [value, decoded]) {
    if (!candidate.startsWith("/")) return DEFAULT_AFTER_LOGIN;
    if (candidate.startsWith("//") || candidate.includes("\\")) return DEFAULT_AFTER_LOGIN;
    if (/[\u0000-\u001f\u007f]/.test(candidate)) return DEFAULT_AFTER_LOGIN;
  }

  const base = "http://vanquish.invalid";
  let url: URL;
  try {
    url = new URL(value, base);
  } catch {
    return DEFAULT_AFTER_LOGIN;
  }
  if (url.origin !== base) return DEFAULT_AFTER_LOGIN;

  const path = `${url.pathname}${url.search}${url.hash}`;
  if (AUTH_PATHS.some((prefix) => url.pathname === prefix || url.pathname.startsWith(prefix))) {
    return DEFAULT_AFTER_LOGIN;
  }
  return path;
}
