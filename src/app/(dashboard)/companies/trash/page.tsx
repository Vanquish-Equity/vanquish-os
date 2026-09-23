import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import TrashRow from "@/components/TrashRow";

export const dynamic = "force-dynamic";

type TrashedCompany = {
  id: string;
  name: string;
  deleted_at: string;
  industry: { name: string } | null;
};

export default async function CompaniesTrashPage() {
  const supabase = await createClient();
  const { data: companies } = (await supabase
    .from("companies")
    .select("id,name,deleted_at,industry:industries(name)")
    .not("deleted_at", "is", null)
    .order("deleted_at", { ascending: false })) as unknown as {
    data: TrashedCompany[];
  };

  return (
    <div className="flex flex-col gap-4 px-7 py-6">
      <header>
        <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-neutral-400">
          <Link href="/companies" className="hover:text-cyan-700">
            Companies
          </Link>{" "}
          / Trash
        </div>
        <h1 className="font-[family-name:var(--font-display)] text-[23px] font-semibold tracking-tight text-ink">
          Trash
        </h1>
        <p className="mt-1 text-[13px] text-neutral-500">
          Deleted companies stay here until restored or removed for good.
        </p>
      </header>

      <div className="overflow-hidden rounded-[14px] border border-neutral-100 bg-white">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="border-b border-neutral-100 text-left text-[10.5px] uppercase tracking-wide text-neutral-400">
              <th className="px-4 py-3 font-semibold">Company</th>
              <th className="px-4 py-3 font-semibold">Industry</th>
              <th className="px-4 py-3 font-semibold">Deleted</th>
              <th className="px-4 py-3 font-semibold" />
            </tr>
          </thead>
          <tbody>
            {(companies ?? []).map((c) => (
              <TrashRow
                key={c.id}
                companyId={c.id}
                companyName={c.name}
                industryName={c.industry?.name ?? "—"}
                deletedAt={c.deleted_at}
              />
            ))}
            {(!companies || companies.length === 0) && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-neutral-400">
                  Trash is empty.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
