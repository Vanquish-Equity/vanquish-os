"use server";
import { getAccess } from "@/lib/auth/access";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
export async function saveLpRecord(
  kind: string,
  data: Record<string, unknown>,
) {
  const access = await getAccess();
  if (access.status !== "member" || !access.permissions.has("portfolio"))
    return { ok: false, message: "Portfolio permission required." };
  if (
    ![
      "fund",
      "investor",
      "pipeline",
      "commitment",
      "flow",
      "preferences",
      "task",
      "board_link",
    ].includes(kind) ||
    !data ||
    typeof data !== "object" ||
    JSON.stringify(data).length > 10000
  )
    return { ok: false, message: "Invalid record." };
  for (const key of [
    "id",
    "investorId",
    "fundId",
    "personId",
    "companyId",
    "cardId",
    "legalEntityId",
  ]) {
    const value = data[key];
    if (
      value &&
      (!(typeof value === "string") ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          value,
        ))
    )
      return { ok: false, message: "Invalid record reference." };
  }
  for (const key of ["amount", "target"]) {
    const value = data[key];
    if (
      value &&
      (!(typeof value === "string") || !/^\d{1,16}(\.\d{1,2})?$/.test(value))
    )
      return {
        ok: false,
        message: "Enter a decimal amount with at most two decimal places.",
      };
  }
  if (
    data.date &&
    (!(typeof data.date === "string") || !/^\d{4}-\d{2}-\d{2}$/.test(data.date))
  )
    return { ok: false, message: "Choose a valid date." };
  const { data: id, error } = await (
    await createClient()
  ).rpc("save_lp_record", { p_kind: kind, p_data: data });
  if (!error) {
    revalidatePath("/portfolio/fundraising");
    revalidatePath("/portfolio/fundraising/[id]", "page");
    revalidatePath("/portfolio");
    revalidatePath("/people");
    revalidatePath("/lp-board");
  }
  return {
    ok: !error,
    id: !error && typeof id === "string" ? id : undefined,
    message: error
      ? "Could not save. Refresh if the stage changed; verify unique names, references, dates and current permissions."
      : "Saved. No email was sent and no Google data was changed.",
  };
}
