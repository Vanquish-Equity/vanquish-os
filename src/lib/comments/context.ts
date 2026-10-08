export type ContextScope = { page: string | null; companyId: string | null; dealId: string | null };

// Explicit route allowlist: restricted areas never create or display pins.
export function contextScope(pathname: string): ContextScope | null {
  const page = pathname.match(/^\/(home|overview|pipeline|tasks|people|review|companies|documents|inbox)\/?$/);
  if (page) return { page: page[1], companyId: null, dealId: null };
  // Boards share one flat page scope across the list and every board's
  // detail page, the same way "pipeline" covers every deal without a
  // per-deal partition — individual cards get their own anchor (target_key)
  // for pin placement, not a separate access scope.
  const board = pathname.match(/^\/boards(?:\/[0-9a-f-]{36})?\/?$/i);
  if (board) return { page: "boards", companyId: null, dealId: null };
  const deal = pathname.match(/^\/companies\/([0-9a-f-]{36})\/deals\/([0-9a-f-]{36})\/?$/i);
  if (deal) return { page: null, companyId: deal[1], dealId: deal[2] };
  const company = pathname.match(/^\/companies\/([0-9a-f-]{36})\/?$/i);
  if (company) return { page: null, companyId: company[1], dealId: null };
  return null;
}

export function contextHref(scope: ContextScope, id: string, targetKey?: string | null) {
  if (scope.page === "boards") {
    // "boards" has no per-board scope column (see contextScope above), so
    // the board id travels in the comment's own target_key instead —
    // encoded there as `board:<id>:...` when the comment was posted.
    const boardId = targetKey?.match(/^board:([0-9a-f-]{36}):/i)?.[1];
    return `${boardId ? `/boards/${boardId}` : "/boards"}#comment-${id}`;
  }
  const base = scope.page ? `/${scope.page}` : scope.dealId
    ? `/companies/${scope.companyId}/deals/${scope.dealId}`
    : `/companies/${scope.companyId}`;
  return `${base}#comment-${id}`;
}

export function safeTargetKey(value: string) {
  return /^[a-zA-Z0-9:_-]{1,140}$/.test(value);
}
