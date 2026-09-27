export type ContextScope = { page: string | null; companyId: string | null; dealId: string | null };

// Explicit route allowlist: restricted areas never create or display pins.
export function contextScope(pathname: string): ContextScope | null {
  const page = pathname.match(/^\/(home|overview|pipeline|tasks|people|review|companies)\/?$/);
  if (page) return { page: page[1], companyId: null, dealId: null };
  const deal = pathname.match(/^\/companies\/([0-9a-f-]{36})\/deals\/([0-9a-f-]{36})\/?$/i);
  if (deal) return { page: null, companyId: deal[1], dealId: deal[2] };
  const company = pathname.match(/^\/companies\/([0-9a-f-]{36})\/?$/i);
  if (company) return { page: null, companyId: company[1], dealId: null };
  return null;
}

export function contextHref(scope: ContextScope, id: string) {
  const base = scope.page ? `/${scope.page}` : scope.dealId
    ? `/companies/${scope.companyId}/deals/${scope.dealId}`
    : `/companies/${scope.companyId}`;
  return `${base}#comment-${id}`;
}

export function safeTargetKey(value: string) {
  return /^[a-zA-Z0-9:_-]{1,140}$/.test(value);
}
