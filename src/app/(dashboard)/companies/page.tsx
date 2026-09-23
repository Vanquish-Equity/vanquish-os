import { createClient } from "@/lib/supabase/server";
import Link from "next/link";

export const dynamic = "force-dynamic";

type Company = {
  id: string;
  name: string;
  industry: { name: string } | null;
  updated_at: string;
  deals: { id: string }[];
};

export default async function CompaniesPage() {
  const supabase = await createClient();
  const { data: companies } = (await supabase
    .from("companies")
    .select("id,name,updated_at,industry:industries(name),deals(id)")
    .is("deleted_at", null)
    .order("name")) as unknown as { data: Company[] };

  return (
    <div className="flex flex-col gap-4 px-7 py-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-[23px] font-semibold tracking-tight text-ink">
            Companies
          </h1>
          <p className="mt-1 text-[13px] text-neutral-500">
            Persistent company records, independent from individual investment
            rounds.
          </p>
        </div>
        <Link
          href="/companies/trash"
          className="flex-shrink-0 rounded-full border border-neutral-200 px-3 py-1.5 text-[11.5px] font-semibold text-neutral-500 transition hover:border-neutral-300 hover:text-neutral-700"
        >
          Trash
        </Link>
      </header>

      <div className="overflow-hidden rounded-[14px] border border-neutral-100 bg-white">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="border-b border-neutral-100 text-left text-[10.5px] uppercase tracking-wide text-neutral-400">
              <th className="px-4 py-3 font-semibold">Company</th>
              <th className="px-4 py-3 font-semibold">Industry</th>
              <th className="px-4 py-3 font-semibold">Deals</th>
              <th className="px-4 py-3 font-semibold">Last updated</th>
            </tr>
          </thead>
          <tbody>
            {(companies ?? []).map((c) => (
              <tr key={c.id} className="border-b border-neutral-50 last:border-0">
                <td className="px-4 py-3">
                  <Link
                    href={`/companies/${c.id}`}
                    className="font-semibold text-ink hover:text-cyan-700"
                  >
                    {c.name}
                  </Link>
                </td>
                <td className="px-4 py-3 text-neutral-600">
                  {c.industry?.name ?? "—"}
                </td>
                <td className="px-4 py-3 text-neutral-600">
                  {c.deals?.length ?? 0}
                </td>
                <td className="px-4 py-3 text-neutral-600">
                  {new Date(c.updated_at).toLocaleDateString()}
                </td>
              </tr>
            ))}
            {(!companies || companies.length === 0) && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-neutral-400">
                  No companies yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
