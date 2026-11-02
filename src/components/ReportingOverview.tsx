import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
export default async function ReportingOverview() {
  const end = new Date(),
    start = new Date(end.getTime() - 29 * 86400000);
  const { data, error } = await (
    await createClient()
  ).rpc("reporting_overview", {
    p_from: start.toISOString().slice(0, 10),
    p_to: end.toISOString().slice(0, 10),
  });
  const count = Array.isArray(data)
    ? data.reduce((n, r) => n + Number(r.deal_count), 0)
    : null;
  return (
    <section className="vq-card-static rounded-xl bg-white p-4">
      <Link
        className="inline-flex min-h-11 items-center font-semibold underline"
        href="/reporting"
      >
        CRM reporting
      </Link>
      <p className="text-sm text-neutral-600">
        Deals you can see that were created in the last 30 days:{" "}
        {error || count === null ? "not available right now" : count}.
        Deals you do not have access to are not counted.
      </p>
    </section>
  );
}
