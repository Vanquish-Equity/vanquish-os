// Task reads that include the member assignee (migration 0017) when the
// database has it, and fall back to the columns without it otherwise, so
// pages keep working while 0017 is pending.

type QueryResult<T> = { data: T[] | null; error: { code?: string } | null };

export async function selectTasksWithAssignee<T>(
  baseColumns: string,
  run: (columns: string) => PromiseLike<QueryResult<T>>
): Promise<{ data: T[]; assignmentAvailable: boolean }> {
  const withAssignee = await run(`${baseColumns},assignee_email,assigned_by,assigned_at`);
  if (!withAssignee.error) return { data: withAssignee.data ?? [], assignmentAvailable: true };
  const fallback = await run(baseColumns);
  return { data: fallback.data ?? [], assignmentAvailable: false };
}
