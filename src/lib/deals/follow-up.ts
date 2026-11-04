export const CONTACT_TYPES = ["email", "meeting", "call"];

export function followUpReasons({
  task, contact, now,
}: {
  task: { due_at: string | null } | null | undefined;
  contact: boolean | undefined;
  now: number;
}) {
  const reasons: string[] = [];
  if (task === null) reasons.push("No next step");
  if (task?.due_at && Date.parse(task.due_at) < (/^\d{4}-\d{2}-\d{2}$/.test(task.due_at) ? Math.floor(now / 86400000) * 86400000 : now)) reasons.push("Task overdue");
  if (contact === false) reasons.push("No deal contact logged in 30 days");
  return reasons;
}
