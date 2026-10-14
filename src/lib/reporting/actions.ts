"use server";
import { getAccess } from "@/lib/auth/access";
import { createClient } from "@/lib/supabase/server";
import { fundMetrics, type MetricInput, type Metrics } from "./metrics";
export async function setWeeklySubscription(enabled: boolean) {
  const access = await getAccess();
  if (access.status !== "member" || typeof enabled !== "boolean")
    return { ok: false };
  const { error } = await (
    await createClient()
  )
    .from("weekly_report_subscriptions")
    .upsert({
      member_email: access.email,
      enabled,
      updated_at: new Date().toISOString(),
    });
  return { ok: !error };
}
export async function requestWeekly(week: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(week)) return { ok: false };
  const { data, error } = await (
    await createClient()
  ).rpc("request_weekly_report", { p_week: week });
  return {
    ok: !error,
    id: !error && typeof data === "string" ? data : undefined,
  };
}
export async function loadFundMetrics(
  fund: string,
  asOf: string,
  basis: string,
): Promise<Metrics> {
  const access = await getAccess();
  const denied: Metrics = {
    status: "unavailable",
    reason: "Portfolio access, activation and reconciled inputs required.",
    asOf,
    basis,
  };
  if (
    access.status !== "member" ||
    !access.permissions.has("portfolio") ||
    !/^[0-9a-f-]{36}$/i.test(fund) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(asOf) ||
    !["gross", "net"].includes(basis)
  )
    return denied;
  const { data, error } = await (
    await createClient()
  ).rpc("reporting_fund_inputs", {
    p_fund: fund,
    p_as_of: asOf,
    p_basis: basis,
  });
  return error || !data ? denied : fundMetrics(data as MetricInput, true);
}
