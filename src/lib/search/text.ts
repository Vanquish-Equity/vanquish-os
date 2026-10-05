// Escapes the LIKE wildcards in user input so "50%" matches literally.
export function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

// What the search box sends to the database: trimmed, inner whitespace
// collapsed, capped so a pasted paragraph doesn't become a slow query.
export function normalizeSearchQuery(value: string) {
  return value.trim().replace(/\s+/g, " ").slice(0, 80);
}

export const SEARCH_MIN_LENGTH = 2;
