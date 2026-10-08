import type { StoredInteraction } from "./summary";

export type WarmPath = { member: string; personId: string; days: number; lastAt: string; strength: "strong" | "recent" | "historical" };
// Rank evidence, not inferred friendship. Distinct days prevent duplicate
// email+meeting rows from inflating a relationship's apparent strength.
export function warmPaths(rows: StoredInteraction[], now = new Date()): WarmPath[] {
  const paths = new Map<string,{member:string;personId:string;days:Set<string>;lastAt:string}>();
  for (const row of rows) {
    if (!Number.isFinite(Date.parse(row.last_at))) continue;
    const key = `${row.person_id}:${row.member_email}`;
    const path = paths.get(key) ?? {member:row.member_email,personId:row.person_id,days:new Set<string>(),lastAt:row.last_at};
    path.days.add(row.last_at.slice(0,10));
    if (row.last_at>path.lastAt) path.lastAt=row.last_at;
    paths.set(key,path);
  }
  return [...paths.values()].map(path => {
    const recent = now.getTime()-Date.parse(path.lastAt) <= 90*86400000;
    return {member:path.member,personId:path.personId,days:path.days.size,lastAt:path.lastAt,strength: recent && path.days.size>=5 ? "strong" as const : recent ? "recent" as const : "historical" as const};
  }).sort((a,b) => b.lastAt.localeCompare(a.lastAt) || b.days-a.days || a.member.localeCompare(b.member));
}
