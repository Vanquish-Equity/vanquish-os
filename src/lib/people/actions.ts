"use server";

import { revalidatePath } from "next/cache";
import { logActivity } from "@/lib/activity/log";
import { actionAccessError } from "@/lib/auth/access";
import { isValidEmail, normalizeEmail } from "@/lib/communications/import";
import { createClient } from "@/lib/supabase/server";

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

export type PersonActionResult =
  // `warning`: the person was created but a follow-up step (the group) failed.
  | { ok: true; personId?: string; warning?: string }
  | { ok: false; message: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function cleanText(value: string | null | undefined) {
  return (value ?? "").trim();
}

function revalidatePeoplePaths(companyId?: string | null) {
  revalidatePath("/people");
  revalidatePath("/communications", "layout");
  if (companyId) revalidatePath(`/companies/${companyId}`);
}

// LIKE wildcards are literal characters in an email address.
function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

// Another person already using this email (compared case-insensitively).
async function emailOwner(supabase: SupabaseClient, email: string) {
  const { data } = await supabase
    .from("person_emails")
    .select("id,person_id")
    .ilike("email", escapeLike(email))
    .limit(1)
    .maybeSingle();
  return data as { id: string; person_id: string } | null;
}

// Messages never repeat the address: they can end up in logs and toasts.
const EMAIL_IN_USE = "Another person in People already uses this email.";
const EMAIL_INVALID = "Enter one valid email address.";

export type CreatePersonInput = {
  name: string;
  title: string;
  companyId: string | null;
  organizationName?: string;
  linkedinUrl: string;
  email: string;
  isPotentialLp?: boolean;
  // A custom group the new person joins (the starter Potential LPs group
  // follows isPotentialLp and is refused here).
  groupId?: string | null;
};

export async function createPersonAction(
  input: CreatePersonInput
): Promise<PersonActionResult> {
  const accessError = await actionAccessError();
  if (accessError) return { ok: false, message: accessError };

  const name = cleanText(input.name);
  if (!name) return { ok: false, message: "Name is required." };
  const email = normalizeEmail(input.email ?? "");
  if (email && !isValidEmail(email)) return { ok: false, message: EMAIL_INVALID };
  if (input.isPotentialLp && !email) {
    return { ok: false, message: "A potential LP needs an email." };
  }

  const supabase = await createClient();

  const organization = cleanText(input.organizationName);
  if (organization.length > 160 || (organization && input.companyId)) return { ok: false, message: "Choose a company or enter an organization name (up to 160 characters)." };

  // Checked before anything is created, so a bad group leaves no half-made person.
  const groupId = input.groupId ? String(input.groupId) : null;
  if (groupId) {
    if (!UUID.test(groupId)) return { ok: false, message: "Invalid group selection." };
    const { data: group } = await supabase.from("person_groups").select("id,kind").eq("id", groupId).maybeSingle();
    if (!group) return { ok: false, message: "That group no longer exists. Reload People and try again." };
    if (group.kind !== "custom") return { ok: false, message: "Use Potential LP to add someone to that group." };
  }

  // One person per email: an existing contact is reused, never duplicated.
  if (email && (await emailOwner(supabase, email))) {
    return { ok: false, message: EMAIL_IN_USE };
  }

  const { data: person, error } = await supabase
    .from("people")
    .insert({
      name,
      title: cleanText(input.title) || null,
      primary_organization_id: input.companyId || null,
      ...(organization ? { organization_name: organization } : {}),
      linkedin_url: cleanText(input.linkedinUrl) || null,
      is_potential_lp: Boolean(input.isPotentialLp),
      potential_lp_since: input.isPotentialLp ? new Date().toISOString() : null,
    })
    .select("id")
    .single();

  if (organization && (error?.code === "42703" || error?.code === "PGRST204")) {
    return { ok: false, message: "Saving an organization name requires the database update." };
  }
  if (error || !person) return { ok: false, message: "Person could not be created." };

  if (email) {
    const { error: emailError } = await supabase.from("person_emails").insert({
      person_id: person.id,
      email,
      is_primary: true,
    });
    if (emailError) {
      // Keep People free of half-created contacts (e.g. a concurrent insert
      // took the same email).
      await supabase.from("people").update({ archived_at: new Date().toISOString() }).eq("id", person.id);
      return { ok: false, message: EMAIL_IN_USE };
    }
  }

  await logActivity(
    {
      eventType: "PERSON_CREATED",
      targetType: "person",
      targetId: person.id,
      payload: { name, companyId: input.companyId, potentialLp: Boolean(input.isPotentialLp) },
      actor: "anonymous",
    },
    supabase
  );

  if (groupId) {
    const { error: memberError } = await supabase
      .from("person_group_members")
      .upsert({ group_id: groupId, person_id: person.id }, { onConflict: "group_id,person_id", ignoreDuplicates: true });
    if (memberError) {
      revalidatePeoplePaths(input.companyId);
      return {
        ok: true,
        personId: person.id,
        warning: "The person was created but could not be added to the group. Add them from the row menu in People.",
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
  const { data: before } = (await supabase
    .from("people")
    .select(input.field)
    .eq("id", personId)
    .maybeSingle()) as unknown as {
    data: Record<string, string | null> | null;
  };
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

  await logActivity(
    {
      eventType: "PERSON_UPDATED",
      targetType: "person",
      targetId: personId,
      payload: {
        field: input.field,
        from: before?.[input.field] ?? null,
        to: update[input.field] ?? null,
      },
      actor: "anonymous",
    },
    supabase
  );

  revalidatePeoplePaths(input.companyId);
  return { ok: true };
}

export type UpdateContactInput = {
  personId: string;
  name: string;
  // Empty removes the contact's primary email.
  email: string;
};

// Edits a contact's name and primary email. The person_emails row is updated
// in place, so drafts that selected it can tell the email changed.
export async function updateContactAction(
  input: UpdateContactInput
): Promise<PersonActionResult> {
  const accessError = await actionAccessError();
  if (accessError) return { ok: false, message: accessError };

  const personId = cleanText(input.personId);
  const name = cleanText(input.name);
  const email = normalizeEmail(input.email ?? "");
  if (!personId) return { ok: false, message: "Missing person." };
  if (!name) return { ok: false, message: "Name is required." };
  if (email && !isValidEmail(email)) return { ok: false, message: EMAIL_INVALID };

  const supabase = await createClient();
  const { data: person } = (await supabase
    .from("people")
    .select("id,name,is_potential_lp,primary_organization_id,person_emails(id,email,is_primary)")
    .eq("id", personId)
    .maybeSingle()) as unknown as {
    data: {
      id: string;
      name: string;
      is_potential_lp: boolean;
      primary_organization_id: string | null;
      person_emails: { id: string; email: string; is_primary: boolean }[];
    } | null;
  };
  if (!person) return { ok: false, message: "Person not found." };
  if (!email && person.is_potential_lp) {
    return { ok: false, message: "A potential LP needs an email. Unmark them first to remove it." };
  }

  const emails = [...(person.person_emails ?? [])].sort(
    (a, b) => Number(b.is_primary) - Number(a.is_primary) || a.email.localeCompare(b.email)
  );
  const primary = emails[0] ?? null;
  const changed: string[] = [];

  if (name !== person.name) {
    const { error } = await supabase.from("people").update({ name, updated_at: new Date().toISOString() }).eq("id", personId);
    if (error) return { ok: false, message: "Name could not be saved." };
    changed.push("name");
  }

  if (email !== (primary?.email ?? "").toLowerCase()) {
    if (email) {
      const owner = await emailOwner(supabase, email);
      if (owner && owner.person_id !== personId) return { ok: false, message: EMAIL_IN_USE };
      if (owner && owner.person_id === personId) {
        // The address is already one of this person's emails: make it primary.
        await supabase.from("person_emails").update({ is_primary: false }).eq("person_id", personId).neq("id", owner.id);
        const { error } = await supabase.from("person_emails").update({ is_primary: true }).eq("id", owner.id);
        if (error) return { ok: false, message: "Email could not be saved." };
      } else if (primary) {
        const { error } = await supabase.from("person_emails").update({ email, is_primary: true }).eq("id", primary.id);
        if (error) return { ok: false, message: EMAIL_IN_USE };
      } else {
        const { error } = await supabase.from("person_emails").insert({ person_id: personId, email, is_primary: true });
        if (error) return { ok: false, message: EMAIL_IN_USE };
      }
    } else if (primary) {
      const { error } = await supabase.from("person_emails").delete().eq("id", primary.id);
      if (error) return { ok: false, message: "Email could not be removed." };
    }
    changed.push("email");
  }

  if (changed.length > 0) {
    // Field names only: email addresses are not written to the activity log.
    await logActivity(
      {
        eventType: "PERSON_UPDATED",
        targetType: "person",
        targetId: personId,
        payload: { fields: changed, name },
      },
      supabase
    );
  }

  revalidatePeoplePaths(person.primary_organization_id);
  return { ok: true, personId };
}

export async function setPotentialLpAction(input: {
  personId: string;
  value: boolean;
}): Promise<PersonActionResult> {
  const accessError = await actionAccessError();
  if (accessError) return { ok: false, message: accessError };

  const personId = cleanText(input.personId);
  if (!personId) return { ok: false, message: "Missing person." };

  const supabase = await createClient();
  if (input.value) {
    const { count } = await supabase
      .from("person_emails")
      .select("id", { count: "exact", head: true })
      .eq("person_id", personId);
    if (!count) return { ok: false, message: "Add an email before marking this person as a potential LP." };
  }

  const { data: updated, error } = await supabase
    .from("people")
    .update({
      is_potential_lp: input.value,
      potential_lp_since: input.value ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", personId)
    .select("id,name,primary_organization_id")
    .maybeSingle();
  if (error || !updated) return { ok: false, message: "Person could not be updated." };

  await logActivity(
    {
      eventType: input.value ? "PERSON_MARKED_POTENTIAL_LP" : "PERSON_UNMARKED_POTENTIAL_LP",
      targetType: "person",
      targetId: personId,
      payload: { name: updated.name },
    },
    supabase
  );

  revalidatePeoplePaths(updated.primary_organization_id);
  return { ok: true, personId };
}

export async function savePersonOrganization(input: {
  personId: string; companyId: string; organizationName: string;
}): Promise<PersonActionResult> {
  const denied = await actionAccessError();
  if (denied) return { ok: false, message: denied };
  const companyId = cleanText(input.companyId) || null;
  const name = cleanText(input.organizationName) || null;
  if (!UUID.test(input.personId) || (companyId && !UUID.test(companyId)) ||
      (name && (name.length > 160 || companyId))) {
    return { ok: false, message: "Choose a company or enter an organization name (up to 160 characters)." };
  }
  const db = await createClient();
  if (companyId) {
    const { data } = await db.from("companies").select("id").eq("id", companyId).is("deleted_at", null).maybeSingle();
    if (!data) return { ok: false, message: "That company is no longer available." };
  }
  const { data: before } = await db.from("people").select("primary_organization_id").eq("id", input.personId).is("archived_at", null).maybeSingle();
  if (!before) return { ok: false, message: "Contact is no longer available." };
  const { count, error } = await db.from("people")
    .update({ primary_organization_id: companyId, organization_name: name, updated_at: new Date().toISOString() }, { count: "exact" })
    .eq("id", input.personId).is("archived_at", null);
  if (error || count !== 1) return { ok: false, message: "Organization could not be saved." };
  revalidatePeoplePaths(before.primary_organization_id);
  if (companyId !== before.primary_organization_id) revalidatePeoplePaths(companyId);
  revalidatePath(`/people/${input.personId}`);
  return { ok: true };
}

export async function addSecondaryContactEmail(input: { personId: string; email: string }): Promise<PersonActionResult> {
  const accessError = await actionAccessError();
  if (accessError) return { ok: false, message: accessError };
  const email = normalizeEmail(input.email);
  if (!UUID.test(input.personId) || !isValidEmail(email)) return { ok: false, message: EMAIL_INVALID };
  const db = await createClient();
  const { data: person, error: lookupError } = await db.from("people").select("id,primary_organization_id")
    .eq("id", input.personId).is("archived_at", null).maybeSingle();
  if (lookupError || !person) return { ok: false, message: "That person is unavailable." };
  const owner = await emailOwner(db, email);
  if (owner?.person_id === person.id) return { ok: true, personId: person.id };
  if (owner) return { ok: false, message: EMAIL_IN_USE };
  const { error } = await db.from("person_emails").insert({ person_id: person.id, email, is_primary: false });
  if (error) return { ok: false, message: error.code === "23505" ? EMAIL_IN_USE : "Could not add the email." };
  revalidatePeoplePaths(person.primary_organization_id);
  revalidatePath(`/people/${person.id}`);
  return { ok: true, personId: person.id };
}

export async function createDiscoveredPerson(input: CreatePersonInput): Promise<PersonActionResult> {
  if (input.companyId) {
    const accessError = await actionAccessError();
    if (accessError) return { ok: false, message: accessError };
    if (!UUID.test(input.companyId)) return { ok: false, message: "Choose an existing company." };
    const db = await createClient();
    const { data } = await db.from("companies").select("id").eq("id", input.companyId).is("deleted_at", null).maybeSingle();
    if (!data) return { ok: false, message: "That company is unavailable." };
  }
  return createPersonAction(input);
}
