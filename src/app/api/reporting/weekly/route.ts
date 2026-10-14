import { createClient } from "@/lib/supabase/server";
import { csvRows } from "@/lib/reporting/csv";
export const runtime = "nodejs";
export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id || !/^[0-9a-f-]{36}$/i.test(id))
    return new Response("Invalid reference", { status: 400 });
  const { data, error } = await (
    await createClient()
  ).rpc("generate_weekly_report", { p_id: id });
  if (error || !data || !Array.isArray(data.stages))
    return new Response(
      "Report unavailable: verify subscription, access and activation.",
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  return new Response(
    csvRows([
      [
        "week_start",
        data.week_start,
        "timezone",
        "UTC",
        "currency",
        "N/A (counts only)",
      ],
      [
        "generated_at",
        new Date().toISOString(),
        "consistency",
        "Current authorized data; not an accounting snapshot",
        "delivery",
        "disabled",
      ],
      ["stage_id", "deal_count"],
      ...data.stages.map((r: { stage_id: string; deal_count: number }) => [
        r.stage_id,
        r.deal_count,
      ]),
    ]),
    {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="crm-weekly.csv"',
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}
