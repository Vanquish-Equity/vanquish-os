"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { logActivity } from "@/lib/activity/log";
import { normalizeCompanyName } from "@/lib/companies/matching";
import { applyDealTemplateAction } from "@/lib/requirements/actions";
import { createClient } from "@/lib/supabase/server";
import { TAXONOMY_TAGS } from "@/lib/taxonomies";

type FieldErrors = Partial<
  Record<
    | "companyName"
    | "industryId"
    | "newIndustryName"
    | "dealName"
    | "stageId"
    | "priorityId"
    | "owner"
    | "potentialInvestment"
    | "raiseAmount"
    | "companyId"
    | "round"
    | "dealId",
    string
  >
>;

export type DealActionResult =
  | { ok: true; companyId?: string; dealId?: string }
  | { ok: false; message: string; fieldErrors?: FieldErrors };

// "existing" links the deal to companyId; "new" explicitly creates the
// company named companyName together with its first deal.
export type CreateDealInput = {
  companyMode: "existing" | "new";
  companyId: string;
  companyName: string;
  industryId: string;
  newIndustryName: string;
  dealName: string;
  round: string;
  stageId: string;
  priorityId: string;
  owner: string;
  potentialInvestment: string;
};

export type UpdateDealStageInput = {
  dealId: string;
  stageId: string;
};

export type UpdateDealFieldInput = {
  dealId: string;
  companyId: string;
  field:
    | "stage_id"
    | "priority_id"
    | "owner"
    | "potential_investment"
    | "outcome_id"
    | "relationship_state_id"
    | "name"
    | "round"
    | "raise_amount"
    | "source"
    | "notes";
  value: string | null;
};

export type ArchiveDealInput = {
  dealId: string;
  companyId: string;
};

export type RestoreDealInput = ArchiveDealInput;

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

type DealStageResult =
  | { ok: true; companyId: string | null }
  | { ok: false; message: string };

const NEW_CATEGORY_VALUE = "__new_category__";

function cleanText(value: string | null | undefined) {
  return (value ?? "").trim();
}

function parseOptionalInvestment(value: string | null | undefined) {
  const trimmed = cleanText(value);
  if (!trimmed) return { ok: true as const, value: null };

  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return {
      ok: false as const,
      message: "Enter a valid non-negative amount.",
    };
  }

  return { ok: true as const, value: parsed };
}

function revalidateDealPaths(companyId?: string | null, dealId?: string | null) {
  revalidatePath("/overview");
  revalidatePath("/pipeline");
  revalidatePath("/companies");
  revalidatePath("/tasks");

  if (companyId) {
    revalidatePath(`/companies/${companyId}`);
    if (dealId) revalidatePath(`/companies/${companyId}/deals/${dealId}`);
  }
}

// Rounds are picked from the deal_rounds taxonomy; an empty value means the
// deal has no known round.
async function resolveRound(
  supabase: SupabaseClient,
  value: string | null | undefined
): Promise<{ ok: true; value: string | null } | { ok: false; message: string }> {
  const round = cleanText(value);
  if (!round) return { ok: true, value: null };

  const { data, error } = (await supabase
    .from("deal_rounds")
    .select("name")
    .eq("name", round)
    .maybeSingle()) as unknown as {
    data: { name: string } | null;
    error: { message: string } | null;
  };

  if (error) {
    return {
      ok: false,
      message: "The round list is unavailable. Apply migration 0014 and try again.",
    };
  }
  if (!data) return { ok: false, message: "Choose a round from the list." };
  return { ok: true, value: data.name };
}

async function maybeApplyDueDiligenceTemplate(input: {
  dealId: string;
  companyId: string;
  stageId: string;
}) {
  const supabase = await createClient();
  const { data: stage } = (await supabase
    .from("pipeline_stages")
    .select("name")
    .eq("id", input.stageId)
    .maybeSingle()) as unknown as {
    data: { name: string } | null;
  };

  if (stage?.name === "Due Diligence") {
    await applyDealTemplateAction({
      createdAutomatically: true,
      dealId: input.dealId,
      companyId: input.companyId,
      templateCode: "GENERIC_DD",
    });
  }
}

async function persistDealStage(
  supabase: SupabaseClient,
  dealId: string,
  stageId: string
): Promise<DealStageResult> {
  const cleanDealId = cleanText(dealId);
  const cleanStageId = cleanText(stageId);

  if (!cleanDealId || !cleanStageId) {
    return { ok: false, message: "Deal and stage are required." };
  }

  const { data: existingDeal, error: lookupError } = (await supabase
    .from("deals")
    .select("company_id,archived_at")
    .eq("id", cleanDealId)
    .maybeSingle()) as unknown as {
    data: { company_id: string | null; archived_at: string | null } | null;
    error: { message: string } | null;
  };

  if (lookupError) {
    return { ok: false, message: lookupError.message };
  }

  if (!existingDeal) {
    return { ok: false, message: "Deal not found." };
  }

  if (existingDeal.archived_at) {
    return { ok: false, message: "Archived deals cannot change stage." };
  }

  const { count, error } = (await supabase
    .from("deals")
    .update({ stage_id: cleanStageId }, { count: "exact" })
    .eq("id", cleanDealId)
    .is("archived_at", null)) as unknown as {
    count: number | null;
    error: { message: string } | null;
  };

  if (error) {
    return { ok: false, message: error.message };
  }

  if (count === 0) {
    return {
      ok: false,
      message:
        "Deal update was blocked by database write policy. Apply migration 0003 and try again.",
    };
  }

  return { ok: true, companyId: existingDeal.company_id };
}

async function resolveIndustryId(
  supabase: SupabaseClient,
  industryId: string,
  newIndustryName: string
) {
  if (!newIndustryName) {
    return { ok: true as const, created: false, industryId };
  }

  const { data: industries, error: lookupError } = (await supabase
    .from("industries")
    .select("id,name")) as unknown as {
    data: { id: string; name: string }[] | null;
    error: { message: string } | null;
  };

  if (lookupError) {
    return { ok: false as const, message: lookupError.message };
  }

  const normalizedName = newIndustryName.toLocaleLowerCase();
  const existingIndustry = (industries ?? []).find(
    (industry) => industry.name.trim().toLocaleLowerCase() === normalizedName
  );

  if (existingIndustry) {
    return { ok: true as const, created: false, industryId: existingIndustry.id };
  }

  const { data: createdIndustry, error: createError } = (await supabase
    .from("industries")
    .insert({ name: newIndustryName })
    .select("id")
    .single()) as unknown as {
    data: { id: string } | null;
    error: { message: string } | null;
  };

  if (createError) {
    return { ok: false as const, message: createError.message };
  }

  if (!createdIndustry) {
    return { ok: false as const, message: "Category could not be created." };
  }

  return { ok: true as const, created: true, industryId: createdIndustry.id };
}

export async function createDealAction(
  input: CreateDealInput
): Promise<DealActionResult> {
  const creatingCompany = input.companyMode === "new";
  const selectedCompanyId = cleanText(input.companyId);
  const newCompanyName = cleanText(input.companyName);
  const rawIndustryId = cleanText(input.industryId);
  const newIndustryName = cleanText(input.newIndustryName);
  const industryId = rawIndustryId === NEW_CATEGORY_VALUE ? "" : rawIndustryId;
  const stageId = cleanText(input.stageId);
  const priorityId = cleanText(input.priorityId);
  const owner = cleanText(input.owner);
  const potentialInvestment = parseOptionalInvestment(input.potentialInvestment);
  const fieldErrors: FieldErrors = {};

  if (creatingCompany) {
    if (!newCompanyName) fieldErrors.companyName = "Company name is required.";
    if (!industryId && !newIndustryName) {
      fieldErrors.industryId = "Choose or create a category.";
    }
    if (rawIndustryId === NEW_CATEGORY_VALUE && !newIndustryName) {
      fieldErrors.newIndustryName = "New category name is required.";
    }
  } else if (!selectedCompanyId) {
    fieldErrors.companyId = "Choose a company.";
  }
  if (!stageId) fieldErrors.stageId = "Choose a stage.";
  if (!priorityId) fieldErrors.priorityId = "Choose a priority.";
  if (!owner) fieldErrors.owner = "Owner is required.";
  if (!potentialInvestment.ok) {
    fieldErrors.potentialInvestment = potentialInvestment.message;
  }

  if (Object.keys(fieldErrors).length > 0 || !potentialInvestment.ok) {
    return {
      ok: false,
      message: "Check the highlighted fields and try again.",
      fieldErrors,
    };
  }

  const supabase = await createClient();
  const resolvedRound = await resolveRound(supabase, input.round);
  if (!resolvedRound.ok) {
    return {
      ok: false,
      message: resolvedRound.message,
      fieldErrors: { round: resolvedRound.message },
    };
  }
  const round = resolvedRound.value;
  let companyId: string;
  let companyName: string;

  if (creatingCompany) {
    // The user chose "create new" after seeing similar companies; an exact
    // match (ignoring case, punctuation and legal suffixes) is still refused.
    const { data: companies, error: companyLookupError } = (await supabase
      .from("companies")
      .select("id,name")
      .is("deleted_at", null)) as unknown as {
      data: { id: string; name: string }[] | null;
      error: { message: string } | null;
    };

    if (companyLookupError) {
      return { ok: false, message: companyLookupError.message };
    }

    const normalizedName = normalizeCompanyName(newCompanyName);
    const duplicate = (companies ?? []).find(
      (company) => normalizeCompanyName(company.name) === normalizedName
    );
    if (duplicate) {
      const message = `${duplicate.name} already exists. Select it instead of creating a new company.`;
      return { ok: false, message, fieldErrors: { companyName: message } };
    }

    const resolvedIndustry = await resolveIndustryId(
      supabase,
      industryId,
      newIndustryName
    );

    if (!resolvedIndustry.ok) {
      return { ok: false, message: resolvedIndustry.message };
    }
    if (resolvedIndustry.created) {
      revalidateTag(TAXONOMY_TAGS.industries, "max");
    }

    const { data: createdCompany, error: createCompanyError } = (await supabase
      .from("companies")
      .insert({ name: newCompanyName, industry_id: resolvedIndustry.industryId })
      .select("id")
      .single()) as unknown as {
      data: { id: string } | null;
      error: { message: string } | null;
    };

    if (createCompanyError) {
      return { ok: false, message: createCompanyError.message };
    }

    if (!createdCompany) {
      return { ok: false, message: "Company could not be created." };
    }

    companyId = createdCompany.id;
    companyName = newCompanyName;

    await logActivity(
      {
        eventType: "COMPANY_CREATED",
        targetType: "company",
        targetId: companyId,
        payload: { name: companyName },
        actor: "anonymous",
      },
      supabase
    );
  } else {
    const { data: company, error: companyError } = (await supabase
      .from("companies")
      .select("id,name,deleted_at")
      .eq("id", selectedCompanyId)
      .maybeSingle()) as unknown as {
      data: { id: string; name: string; deleted_at: string | null } | null;
      error: { message: string } | null;
    };

    if (companyError) return { ok: false, message: companyError.message };
    if (!company || company.deleted_at) {
      const message = "Choose an active company.";
      return { ok: false, message, fieldErrors: { companyId: message } };
    }

    companyId = company.id;
    companyName = company.name;
  }

  const dealName = cleanText(input.dealName) || companyName;

  const { data: createdDeal, error: createDealError } = (await supabase
    .from("deals")
    .insert({
      company_id: companyId,
      name: dealName,
      round,
      stage_id: stageId,
      priority_id: priorityId,
      owner,
      potential_investment: potentialInvestment.value,
    })
    .select("id")
    .single()) as unknown as {
    data: { id: string } | null;
    error: { message: string } | null;
  };

  if (createDealError) {
    return { ok: false, message: createDealError.message };
  }

  if (!createdDeal) {
    return { ok: false, message: "Deal could not be created." };
  }

  revalidateDealPaths(companyId, createdDeal.id);

  await logActivity(
    {
      eventType: "DEAL_CREATED",
      targetType: "deal",
      targetId: createdDeal.id,
      payload: { name: dealName, round, companyId, stageId, priorityId },
      actor: "anonymous",
    },
    supabase
  );

  return { ok: true, companyId, dealId: createdDeal.id };
}

export async function updateDealStageAction(
  input: UpdateDealStageInput
): Promise<DealActionResult> {
  const supabase = await createClient();
  const result = await persistDealStage(supabase, input.dealId, input.stageId);

  if (!result.ok) {
    return { ok: false, message: result.message };
  }

  revalidateDealPaths(result.companyId, input.dealId);
  if (result.companyId) {
    await maybeApplyDueDiligenceTemplate({
      dealId: input.dealId,
      companyId: result.companyId,
      stageId: input.stageId,
    });
  }

  return { ok: true, companyId: result.companyId ?? undefined, dealId: input.dealId };
}

export async function updateDealFieldAction(
  input: UpdateDealFieldInput
): Promise<DealActionResult> {
  const dealId = cleanText(input.dealId);
  const companyId = cleanText(input.companyId);

  if (!dealId || !companyId) {
    return {
      ok: false,
      message: "Deal and company are required.",
      fieldErrors: { dealId: "Deal is required." },
    };
  }

  const supabase = await createClient();

  if (input.field === "stage_id") {
    const result = await persistDealStage(supabase, dealId, cleanText(input.value));

    if (!result.ok) {
      return { ok: false, message: result.message };
    }

    revalidateDealPaths(result.companyId ?? companyId, dealId);
    await maybeApplyDueDiligenceTemplate({
      dealId,
      companyId: result.companyId ?? companyId,
      stageId: cleanText(input.value),
    });
    return { ok: true, companyId: result.companyId ?? companyId, dealId };
  }

  const update: {
    priority_id?: string | null;
    owner?: string | null;
    potential_investment?: number | null;
    outcome_id?: string | null;
    relationship_state_id?: string | null;
    name?: string;
    round?: string | null;
    raise_amount?: number | null;
    source?: string | null;
    notes?: string | null;
  } = {};

  const { data: before } = (await supabase
    .from("deals")
    .select(`${input.field},company_id,archived_at`)
    .eq("id", dealId)
    .maybeSingle()) as unknown as {
    data: Record<string, string | number | null> | null;
  };

  if (!before || before.company_id !== companyId) {
    return { ok: false, message: "Deal not found for this company." };
  }

  if (before.archived_at) {
    return { ok: false, message: "Archived deals cannot be edited." };
  }

  if (input.field === "priority_id") {
    update.priority_id = cleanText(input.value) || null;
  }

  if (input.field === "owner") {
    update.owner = cleanText(input.value) || null;
  }

  if (input.field === "potential_investment") {
    const parsed = parseOptionalInvestment(input.value);

    if (!parsed.ok) {
      return {
        ok: false,
        message: parsed.message,
        fieldErrors: { potentialInvestment: parsed.message },
      };
    }

    update.potential_investment = parsed.value;
  }

  if (input.field === "outcome_id") {
    update.outcome_id = cleanText(input.value) || null;
  }

  if (input.field === "relationship_state_id") {
    update.relationship_state_id = cleanText(input.value) || null;
  }

  if (input.field === "name") {
    const name = cleanText(input.value);
    if (!name) {
      return {
        ok: false,
        message: "Deal name is required.",
        fieldErrors: { dealName: "Deal name is required." },
      };
    }
    update.name = name;
  }

  if (input.field === "round") {
    const resolvedRound = await resolveRound(supabase, input.value);
    if (!resolvedRound.ok) {
      return {
        ok: false,
        message: resolvedRound.message,
        fieldErrors: { round: resolvedRound.message },
      };
    }
    update.round = resolvedRound.value;
  }
  if (input.field === "source") update.source = cleanText(input.value) || null;
  if (input.field === "notes") update.notes = cleanText(input.value) || null;

  if (input.field === "raise_amount") {
    const parsed = parseOptionalInvestment(input.value);

    if (!parsed.ok) {
      return {
        ok: false,
        message: parsed.message,
        fieldErrors: { raiseAmount: parsed.message },
      };
    }

    update.raise_amount = parsed.value;
  }

  const { count, error } = (await supabase
    .from("deals")
    .update(update, { count: "exact" })
    .eq("id", dealId)
    .is("archived_at", null)) as unknown as {
    count: number | null;
    error: { message: string } | null;
  };

  if (error) {
    return { ok: false, message: error.message };
  }

  if (count === 0) {
    return {
      ok: false,
      message:
        "Deal update was blocked by database write policy. Apply migration 0003 and try again.",
    };
  }

  revalidateDealPaths(companyId, dealId);

  await logActivity(
    {
      eventType:
        input.field === "outcome_id" ? "DEAL_OUTCOME_CHANGED" : "DEAL_FIELD_CHANGED",
      targetType: "deal",
      targetId: dealId,
      payload: {
        field: input.field,
        from: before?.[input.field] ?? null,
        to: update[input.field as keyof typeof update] ?? null,
      },
      actor: "anonymous",
    },
    supabase
  );

  return { ok: true, companyId, dealId };
}

export async function snoozeDealAttentionAction(input: {
  dealId: string;
  companyId?: string | null;
  days?: number;
}): Promise<DealActionResult> {
  const dealId = cleanText(input.dealId);
  if (!dealId) {
    return {
      ok: false,
      message: "Deal is required.",
      fieldErrors: { dealId: "Deal is required." },
    };
  }

  const days = input.days && input.days > 0 ? input.days : 30;
  const snoozedUntil = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
  const supabase = await createClient();

  const { data: before, error: lookupError } = (await supabase
    .from("deals")
    .select("company_id,attention_snoozed_until")
    .eq("id", dealId)
    .maybeSingle()) as unknown as {
    data: { attention_snoozed_until: string | null; company_id: string | null } | null;
    error: { message: string } | null;
  };

  if (lookupError) return { ok: false, message: lookupError.message };
  if (!before) return { ok: false, message: "Deal not found." };

  const companyId = input.companyId ?? before.company_id;
  const { error } = await supabase
    .from("deals")
    .update({ attention_snoozed_until: snoozedUntil })
    .eq("id", dealId);

  if (error) return { ok: false, message: error.message };

  await logActivity(
    {
      actor: "anonymous",
      eventType: "DEAL_FIELD_CHANGED",
      payload: {
        field: "attention_snoozed_until",
        from: before.attention_snoozed_until,
        reason: "snoozed from Needs attention",
        to: snoozedUntil,
      },
      targetId: dealId,
      targetType: "deal",
    },
    supabase
  );

  revalidateDealPaths(companyId, dealId);
  return { ok: true, companyId: companyId ?? undefined, dealId };
}

// Archives one opportunity only. The company, its other deals and the
// records linked to this deal stay untouched; archived deals drop out of
// Pipeline, Overview and the active lists because they filter archived_at.
export async function archiveDealAction(
  input: ArchiveDealInput
): Promise<DealActionResult> {
  const dealId = cleanText(input.dealId);
  const companyId = cleanText(input.companyId);

  if (!dealId || !companyId) {
    return {
      ok: false,
      message: "Deal and company are required.",
      fieldErrors: { dealId: "Deal is required." },
    };
  }

  const supabase = await createClient();
  const { data: deal, error: lookupError } = (await supabase
    .from("deals")
    .select("name,company_id,archived_at")
    .eq("id", dealId)
    .maybeSingle()) as unknown as {
    data: { name: string; company_id: string; archived_at: string | null } | null;
    error: { message: string } | null;
  };

  if (lookupError) return { ok: false, message: lookupError.message };
  if (!deal || deal.company_id !== companyId) {
    return { ok: false, message: "Deal not found for this company." };
  }
  if (deal.archived_at) return { ok: false, message: "This deal is already archived." };

  const { count, error } = (await supabase
    .from("deals")
    .update({ archived_at: new Date().toISOString() }, { count: "exact" })
    .eq("id", dealId)
    .eq("company_id", companyId)
    .is("archived_at", null)) as unknown as {
    count: number | null;
    error: { message: string } | null;
  };

  if (error) return { ok: false, message: error.message };
  if (count === 0) {
    return {
      ok: false,
      message:
        "Archive was blocked by database write policy. Apply the latest migration and try again.",
    };
  }

  await logActivity(
    {
      eventType: "DEAL_ARCHIVED",
      targetType: "deal",
      targetId: dealId,
      payload: { companyId, dealId, name: deal.name, reason: "manual" },
      actor: "anonymous",
    },
    supabase
  );

  revalidateDealPaths(companyId, dealId);
  return { ok: true, companyId, dealId };
}

// Brings one archived deal back to the active lists. Other deals of the same
// company are untouched and the stage history is kept as it was.
export async function restoreDealAction(
  input: RestoreDealInput
): Promise<DealActionResult> {
  const dealId = cleanText(input.dealId);
  const companyId = cleanText(input.companyId);

  if (!dealId || !companyId) {
    return {
      ok: false,
      message: "Deal and company are required.",
      fieldErrors: { dealId: "Deal is required." },
    };
  }

  const supabase = await createClient();
  const { data: deal, error: lookupError } = (await supabase
    .from("deals")
    .select("name,company_id,archived_at")
    .eq("id", dealId)
    .maybeSingle()) as unknown as {
    data: { name: string; company_id: string; archived_at: string | null } | null;
    error: { message: string } | null;
  };

  if (lookupError) return { ok: false, message: lookupError.message };
  if (!deal || deal.company_id !== companyId) {
    return { ok: false, message: "Deal not found for this company." };
  }
  if (!deal.archived_at) return { ok: false, message: "This deal is not archived." };

  const { count, error } = (await supabase
    .from("deals")
    .update({ archived_at: null }, { count: "exact" })
    .eq("id", dealId)
    .eq("company_id", companyId)
    .not("archived_at", "is", null)) as unknown as {
    count: number | null;
    error: { message: string } | null;
  };

  if (error) return { ok: false, message: error.message };
  if (count === 0) {
    return {
      ok: false,
      message:
        "Restore was blocked by database write policy. Apply the latest migration and try again.",
    };
  }

  await logActivity(
    {
      eventType: "DEAL_RESTORED",
      targetType: "deal",
      targetId: dealId,
      payload: { companyId, dealId, name: deal.name, archivedAt: deal.archived_at },
      actor: "anonymous",
    },
    supabase
  );

  revalidateDealPaths(companyId, dealId);
  return { ok: true, companyId, dealId };
}
