export type ContextScope = { page: string | null; companyId: string | null; dealId: string | null };

// Explicit route allowlist: restricted areas never create or display pins.
export function contextScope(pathname: string): ContextScope | null {
  const page = pathname.match(/^\/(home|pipeline|tasks|people|companies|documents)\/?$/);
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

// `/review` and `/inbox` are not listed on purpose: they redirect to tabs of
// Tasks, which has one scope (see TASKS_PAGE_KEYS).

// Home has three tabs but one comment scope, `home`. Comments pinned on the
// former Overview page were stored with the page key `overview`; they are read
// together with `home` (see HOME_PAGE_KEYS) and shown on the Dashboard tab,
// where their anchors live.
export const HOME_PAGE_KEYS = ["home", "overview"] as const;

// Anchors that only exist on the Dashboard tab (the former Overview page).
const DASHBOARD_ANCHOR = /^(stat:\d+|pipeline-by-stage|pipeline-analytics|pipeline-trends|recent-activity)$/;

// Tasks has four tabs but one comment scope, `tasks`. Pins made on the former
// Review page were stored with the page key `review`, and pins made on the
// former Action center with `inbox`. They are read together with `tasks`
// (see TASKS_PAGE_KEYS) and shown on the To review and Activity tabs, where
// their anchors live. New comments are stored as `tasks`; a reply uses its
// root's key (see replyPageKey), because the database compares them.
export const TASKS_PAGE_KEYS = ["tasks", "review", "inbox"] as const;

// Every page key a scope reads. Only `home` and `tasks` absorbed other pages.
export function pageKeysFor(page: string): string[] {
  if (page === "home") return [...HOME_PAGE_KEYS];
  if (page === "tasks") return [...TASKS_PAGE_KEYS];
  return [page];
}

// The page key a reply must carry: its root comment's key when that is a
// legacy key of the same scope, otherwise the scope's own page.
export function replyPageKey(page: string | null, parentPageKey: string | null | undefined) {
  if (page && parentPageKey && parentPageKey !== page && pageKeysFor(page).includes(parentPageKey)) return parentPageKey;
  return page;
}

// Tab hint for a Home comment link, so the link opens the tab that holds the
// anchor. Anything else (Today anchors, the generic "page" anchor, the
// Reports tab, which has no anchors of its own) opens Today.
function homeTabHint(page: string, targetKey?: string | null) {
  if (targetKey && DASHBOARD_ANCHOR.test(targetKey)) return "?tab=dashboard";
  // Any other legacy Overview comment opens the Dashboard, except the old
  // Needs attention card, which moved to Today.
  if (page === "overview" && targetKey !== "needs-attention") return "?tab=dashboard";
  return "";
}

// Anchors that only exist on one tab of Tasks.
const REVIEW_ANCHOR = /^(review|proposal|suggestion|contact-request):/;
const ACTIVITY_ANCHOR = /^(interaction|document):/;

// Tab hint for a Tasks comment link. Legacy `review` and `inbox` comments open
// the tab that replaced their page. A `tasks` comment opens the tab holding
// its anchor: a task row lives in All (Mine would hide other people's tasks);
// anything else opens the default tab.
function tasksTabHint(page: string, targetKey?: string | null) {
  if (page === "review" || (targetKey && REVIEW_ANCHOR.test(targetKey))) return "?tab=review";
  if (page === "inbox" || (targetKey && ACTIVITY_ANCHOR.test(targetKey))) return "?tab=activity";
  if (targetKey?.startsWith("task:")) return "?tab=all";
  return "";
}

export function contextHref(scope: ContextScope, id: string, targetKey?: string | null) {
  if (scope.page === "boards") {
    // "boards" has no per-board scope column (see contextScope above), so
    // the board id travels in the comment's own target_key instead —
    // encoded there as `board:<id>:...` when the comment was posted.
    const boardId = targetKey?.match(/^board:([0-9a-f-]{36}):/i)?.[1];
    return `${boardId ? `/boards/${boardId}` : "/boards"}#comment-${id}`;
  }
  if (scope.page === "home" || scope.page === "overview") {
    return `/home${homeTabHint(scope.page, targetKey)}#comment-${id}`;
  }
  if (scope.page === "tasks" || scope.page === "review" || scope.page === "inbox") {
    return `/tasks${tasksTabHint(scope.page, targetKey)}#comment-${id}`;
  }
  const base = scope.page ? `/${scope.page}` : scope.dealId
    ? `/companies/${scope.companyId}/deals/${scope.dealId}`
    : `/companies/${scope.companyId}`;
  return `${base}#comment-${id}`;
}

export function safeTargetKey(value: string) {
  return /^[a-zA-Z0-9:_-]{1,140}$/.test(value);
}

// A link like /tasks#comment-<id> (built by the database for chat shares, which
// cannot know about tabs) may open a tab that does not hold the comment's
// anchor. Given the page's comments, this returns where the comment's anchor
// lives, or null to stay: the comment is not readable here (not in the list),
// or its link would not leave the current page and query (which also makes a
// redirect loop impossible: the target tab is the one that holds the anchor).
export function hashRedirectHref(
  scope: ContextScope,
  comments: { id: string; target_key: string | null }[],
  commentId: string,
  current: { pathname: string; search: string },
): string | null {
  const comment = comments.find((item) => item.id === commentId);
  if (!comment?.target_key) return null;
  const href = contextHref(scope, commentId, comment.target_key);
  const target = href.split("#")[0];
  // A link without a tab hint opens the default tab: nothing better to offer.
  if (!target.includes("?")) return null;
  return target === `${current.pathname}${current.search}` ? null : href;
}
