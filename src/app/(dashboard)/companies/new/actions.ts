"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAccess } from "@/lib/auth/access";
import { logActivity } from "@/lib/activity/log";
import { createClient } from "@/lib/supabase/server";

export async function createStandaloneCompany(_previous: string | null, form: FormData): Promise<string | null> {
  const access = await getAccess();
  if (access.status !== "member") return "Access denied.";

  const name = String(form.get("name") ?? "").trim();
  const websiteInput = String(form.get("website") ?? "").trim();
  if (!name || name.length > 200) return "Enter a company name of up to 200 characters.";

  let website: string | null = null;
  if (websiteInput) {
    try {
      if (websiteInput.length > 500) return "Enter a website of up to 500 characters.";
      const url = new URL(/^[a-z][a-z\d+.-]*:/i.test(websiteInput) ? websiteInput : `https://${websiteInput}`);
      if (!["https:", "http:"].includes(url.protocol) || !url.hostname.includes(".") || url.username || url.password) {
        return "Enter a valid company website.";
      }
      website = url.href;
    } catch {
      return "Enter a valid company website.";
    }
  }

  const supabase = await createClient();
  const { data: company, error } = await supabase.from("companies").insert({ name, website }).select("id").single();
  if (error?.code === "23505") return "This company already exists.";
  if (error || !company) return "Couldn't create the company. Please try again.";

  await logActivity({ eventType: "COMPANY_CREATED", targetType: "company", targetId: company.id,
    payload: { name }, actor: access.email }, supabase);
  revalidatePath("/companies");
  redirect(`/companies/${company.id}`);
}
