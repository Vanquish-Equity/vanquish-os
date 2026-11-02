// Awaits an access check together with the queries that were started beside
// it, so a page does not wait for membership before it starts its data.
//
// Promise.all would reject with whichever promise fails first in time. A
// non-member's queries can fail (or time out) before the membership lookup
// finishes, which would turn the redirect to /login or /access-denied into a
// generic error page. Here every promise is settled first and the access
// result is looked at first: its rejection (the redirect) always wins, and
// only then the first failed query is rethrown, in the order given.
export async function accessFirst<A, T extends readonly unknown[] | []>(
  access: PromiseLike<A>,
  rest: T,
): Promise<[A, ...{ -readonly [P in keyof T]: Awaited<T[P]> }]> {
  const [first, ...others] = await Promise.allSettled([access, ...rest]);
  if (first.status === "rejected") throw first.reason;
  const failed = others.find((result): result is PromiseRejectedResult => result.status === "rejected");
  if (failed) throw failed.reason;
  return [
    (first as PromiseFulfilledResult<A>).value,
    ...others.map((result) => (result as PromiseFulfilledResult<unknown>).value),
  ] as unknown as [A, ...{ -readonly [P in keyof T]: Awaited<T[P]> }];
}
