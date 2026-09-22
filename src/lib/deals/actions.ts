"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

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
    | "dealId",
    string
  >
>;

export type DealActionResult =
  | { ok: true; companyId?: string; dealId?: string }
  | { ok: false; message: string; fieldErrors?: FieldErrors };

export type CreateDealInput = {
  companyName: string;
  industryId: string;
  newIndustryName: string;
  dealName: string;
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
  field: "stage_id" | "priority_id" | "owner" | "potential_investment";
  value: string | null;
};

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

function revalidateDealPaths(companyId?: string | null) {
  revalidatePath("/pipeline");
  revalidatePath("/companies");

  if (companyId) {
    revalidatePath(`/companies/${companyId}`);
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
    .select("company_id")
    .eq("id", cleanDealId)
    .maybeSingle()) as unknown as {
    data: { company_id: string | null } | null;
    error: { message: string } | null;
  };

  if (lookupError) {
    return { ok: false, message: lookupError.message };
  }

  if (!existingDeal) {
    return { ok: false, message: "Deal not found." };
  }

  const { count, error } = (await supabase
    .from("deals")
    .update({ stage_id: cleanStageId }, { count: "exact" })
    .eq("id", cleanDealId)) as unknown as {
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
    return { ok: true as const, industryId };
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
    return { ok: true as const, industryId: existingIndustry.id };
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

  return { ok: true as const, industryId: createdIndustry.id };
}

export async function createDealAction(
  input: CreateDealInput
): Promise<DealActionResult> {
  const companyName = cleanText(input.companyName);
  const rawIndustryId = cleanText(input.industryId);
  const newIndustryName = cleanText(input.newIndustryName);
  const industryId = rawIndustryId === NEW_CATEGORY_VALUE ? "" : rawIndustryId;
  const fallbackDealName = companyName ? `${companyName} — new deal` : "";
  const dealName = cleanText(input.dealName) || fallbackDealName;
  const stageId = cleanText(input.stageId);
  const priorityId = cleanText(input.priorityId);
  const owner = cleanText(input.owner);
  const potentialInvestment = parseOptionalInvestment(input.potentialInvestment);
  const fieldErrors: FieldErrors = {};

  if (!companyName) fieldErrors.companyName = "Company name is required.";
  if (!industryId && !newIndustryName) {
    fieldErrors.industryId = "Choose or create a category.";
  }
  if (rawIndustryId === NEW_CATEGORY_VALUE && !newIndustryName) {
    fieldErrors.newIndustryName = "New category name is required.";
  }
  if (!dealName) fieldErrors.dealName = "Deal name is required.";
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
  const resolvedIndustry = await resolveIndustryId(
    supabase,
    industryId,
    newIndustryName
  );

  if (!resolvedIndustry.ok) {
    return { ok: false, message: resolvedIndustry.message };
  }

  const { data: companies, error: companyLookupError } = (await supabase
    .from("companies")
    .select("id,name")) as unknown as {
    data: { id: string; name: string }[] | null;
    error: { message: string } | null;
  };

  if (companyLookupError) {
    return { ok: false, message: companyLookupError.message };
  }

  const normalizedCompanyName = companyName.toLocaleLowerCase();
  const existingCompany = (companies ?? []).find(
    (company) => company.name.trim().toLocaleLowerCase() === normalizedCompanyName
  );

  let companyId = existingCompany?.id ?? null;

  if (!companyId) {
    const { data: createdCompany, error: createCompanyError } = (await supabase
      .from("companies")
      .insert({ name: companyName, industry_id: resolvedIndustry.industryId })
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
  }

  const { data: createdDeal, error: createDealError } = (await supabase
    .from("deals")
    .insert({
      company_id: companyId,
      name: dealName,
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

  revalidateDealPaths(companyId);

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

  revalidateDealPaths(result.companyId);

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

    revalidateDealPaths(result.companyId ?? companyId);
    return { ok: true, companyId: result.companyId ?? companyId, dealId };
  }

  const update: {
    priority_id?: string | null;
    owner?: string | null;
    potential_investment?: number | null;
  } = {};

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

  const { count, error } = (await supabase
    .from("deals")
    .update(update, { count: "exact" })
    .eq("id", dealId)) as unknown as {
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

  revalidateDealPaths(companyId);

  return { ok: true, companyId, dealId };
}
