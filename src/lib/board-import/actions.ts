"use server";

import { revalidatePath } from "next/cache";
import { actionAccessError } from "@/lib/auth/access";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/validation/uuid";

export type ImportEntry = { id: string; name: string; detail: string };
export type ImportGroup = { id: string; name: string; kind: string; personIds: string[] };
export type ImportOptions = { people: ImportEntry[]; companies: ImportEntry[]; groups: ImportGroup[] };
type OptionsResult = { ok: true; options: ImportOptions } | { ok: false; message: string };

export async function loadBoardImportOptions(): Promise<OptionsResult> {
  const access = await actionAccessError();
  if (access) return { ok: false, message: access };
  const db = await createClient();
  const people: ImportEntry[] = [];
  const companies: ImportEntry[] = [];
  const members: { group_id: string; person_id: string }[] = [];
  // PostgREST commonly caps a response at 1,000 rows. Page explicitly so
  // selecting a group never silently omits later members.
  for (let offset = 0; offset <= 10000; offset += 1000) {
    const [p, c, m] = await Promise.all([
      db.from("people").select("id,name,person_emails(email,is_primary)").is("archived_at", null).order("name").order("id").range(offset,offset+999),
      db.from("companies").select("id,name").is("deleted_at", null).order("name").order("id").range(offset,offset+999),
      db.from("person_group_members").select("group_id,person_id").order("group_id").order("person_id").range(offset,offset+999),
    ]);
    if (p.error || c.error || m.error) return { ok: false, message: "Could not load the CRM directory." };
    if (offset === 10000 && (p.data?.length || c.data?.length || m.data?.length)) return { ok: false, message: "The CRM directory exceeds the import picker limit. Narrow the dataset before importing." };
    people.push(...(p.data ?? []).map((item) => ({ id: item.id, name: item.name, detail: item.person_emails?.find((e) => e.is_primary)?.email ?? item.person_emails?.[0]?.email ?? "" })));
    companies.push(...(c.data ?? []).map((item) => ({ id: item.id, name: item.name, detail: "Company" })));
    members.push(...(m.data ?? []));
    if ((p.data?.length ?? 0) < 1000 && (c.data?.length ?? 0) < 1000 && (m.data?.length ?? 0) < 1000) break;
  }
  const groups = await db.from("person_groups").select("id,name,kind").order("name");
  if (groups.error) return { ok: false, message: "Could not load People groups." };
  return { ok: true, options: {
    people, companies,
    groups: (groups.data ?? []).map((g) => ({ id: g.id, name: g.name, kind: g.kind, personIds: members.filter((m) => m.group_id === g.id).map((m) => m.person_id) })),
  } };
}

export async function importDirectoryToBoard(input: { boardId: string; columnId: string; kind: "person" | "company"; ids: string[]; privateBoard: boolean }): Promise<{ ok: true; added: number } | { ok: false; message: string }> {
  const access = await actionAccessError();
  if (access) return { ok: false, message: access };
  if (!isUuid(input.boardId) || !isUuid(input.columnId) || !["person", "company"].includes(input.kind) || typeof input.privateBoard !== "boolean" || !Array.isArray(input.ids) || input.ids.length < 1 || input.ids.length > 500 || input.ids.some((id) => !isUuid(id)) || new Set(input.ids).size !== input.ids.length) return { ok: false, message: "Choose up to 500 distinct CRM records." };
  const db = await createClient();
  const { data, error } = await db.rpc("import_directory_to_board", { p_board: input.boardId, p_column: input.columnId, p_kind: input.kind, p_ids: input.ids, p_private: input.privateBoard });
  if (error) return { ok: false, message: "Import failed. Review the selected records and board access." };
  revalidatePath(input.privateBoard ? "/lp-board" : `/boards/${input.boardId}`);
  return { ok: true, added: data as number };
}
