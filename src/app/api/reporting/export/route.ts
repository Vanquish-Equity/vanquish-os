import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import {
  collectExport,
  exportCsv,
  type ExportResource,
  type ExportRow,
} from "@/lib/reporting/csv";
export const runtime = "nodejs";
export async function GET(request: Request) {
  const resource = new URL(request.url).searchParams.get("resource");
  if (!resource || !["deals", "funds", "documents"].includes(resource))
    return new Response("Unsupported export", { status: 400 });
  const client = await createClient();
  const id = randomUUID();
  try {
    const result = await collectExport(async (after) => {
      const { data, error } = await client.rpc("reporting_export_batch", {
        p_id: id,
        p_resource: resource,
        p_after: after,
      });
      if (error || !Array.isArray(data)) throw Error("Export unavailable");
      return data as ExportRow[];
    });
    // Buffer bounded output: a later denial cannot leave a successful partial download.
    return new Response(
      exportCsv(resource as ExportResource, result.rows, result.capped),
      {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="crm-${resource}.csv"`,
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
        },
      },
    );
  } catch {
    return new Response(
      "Export unavailable: check current access, activation and quota.",
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }
}
