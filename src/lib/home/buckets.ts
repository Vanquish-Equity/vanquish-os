// Task due dates are calendar dates (YYYY-MM-DD). Buckets are computed in the
// viewer's local date, in the browser.

export function localToday(now = new Date()) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function addDays(isoDate: string, days: number) {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export function bucketTasks<T extends { dueAt: string | null }>(tasks: T[], today: string) {
  const weekEnd = addDays(today, 7);
  return {
    overdue: tasks.filter((t) => t.dueAt !== null && t.dueAt < today),
    today: tasks.filter((t) => t.dueAt === today),
    upcoming: tasks.filter((t) => t.dueAt !== null && t.dueAt > today && t.dueAt <= weekEnd),
    later: tasks.filter((t) => t.dueAt === null || t.dueAt > weekEnd),
  };
}
