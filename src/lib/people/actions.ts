"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type PersonActionResult =
  | { ok: true; personId?: string }
  | { ok: false; message: string };

function cleanText(value: string | null | undefined) {
  return (value ?? "").trim();
}

function revalidatePeoplePaths(companyId?: string | null) {
  revalidatePath("/people");
  if (companyId) revalidatePath(`/companies/${companyId}`);
}

export type CreatePersonInput = {
  name: string;
  title: string;
  companyId: string | null;
  linkedinUrl: string;
  email: string;
};

export async function createPersonAction(
  input: CreatePersonInput
): Promise<PersonActionResult> {
  const name = cleanText(input.name);
  if (!name) return { ok: false, message: "Name is required." };

  const supabase = await createClient();

  const { data: person, error } = await supabase
    .from("people")
    .insert({
      name,
      title: cleanText(input.title) || null,
      primary_organization_id: input.companyId || null,
      linkedin_url: cleanText(input.linkedinUrl) || null,
    })
    .select("id")
    .single();

  if (error) return { ok: false, message: error.message };
  if (!person) return { ok: false, message: "Person could not be created." };

  const email = cleanText(input.email);
  if (email) {
    const { error: emailError } = await supabase.from("person_emails").insert({
      person_id: person.id,
      email,
      is_primary: true,
    });
    // Non-fatal: the person record already exists; a duplicate email is the
    // most likely failure (unique constraint) and shouldn't block creation.
    if (emailError) {
      return {
        ok: true,
        personId: person.id,
      };
    }
  }

  revalidatePeoplePaths(input.companyId);
  return { ok: true, personId: person.id };
}

export type UpdatePersonFieldInput = {
  personId: string;
  companyId: string | null;
  field: "name" | "title" | "linkedin_url" | "primary_organization_id";
  value: string | null;
};

export async function updatePersonFieldAction(
  input: UpdatePersonFieldInput
): Promise<PersonActionResult> {
  const personId = cleanText(input.personId);
  if (!personId) return { ok: false, message: "Missing person." };

  if (input.field === "name" && !cleanText(input.value)) {
    return { ok: false, message: "Name is required." };
  }

  const supabase = await createClient();
  const update: Record<string, string | null> = {
    [input.field]:
      input.field === "name" ? cleanText(input.value) : cleanText(input.value) || null,
  };

  const { count, error } = await supabase
    .from("people")
    .update(update, { count: "exact" })
    .eq("id", personId);

  if (error) return { ok: false, message: error.message };
  if (count === 0) {
    return {
      ok: false,
      message:
        "Update was blocked by database write policy. Apply the latest migration and try again.",
    };
  }

  revalidatePeoplePaths(input.companyId);
  return { ok: true };
}
