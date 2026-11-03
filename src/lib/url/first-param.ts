// A search param can arrive as a string, a repeated parameter (`?q=a&q=b`,
// which Next gives as an array) or nothing. Server pages that call string
// methods on it (trim, compare, filter) must normalize it first, otherwise a
// hand-edited URL crashes the page with a 500.
export function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
