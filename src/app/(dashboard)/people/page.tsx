import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import NewPersonModal from "@/components/NewPersonModal";
import { startDevPageTimer } from "@/lib/performance";

export const dynamic = "force-dynamic";

type Option = { id: string; name: string };

type PersonRow = {
  id: string;
  name: string;
  title: string | null;
  linkedin_url: string | null;
  primary_organization_id: string | null;
  organization: { id: string; name: string } | null;
  person_emails: { email: string; is_primary: boolean }[];
};

function primaryEmail(emails: { email: string; is_primary: boolean }[]) {
  return emails.find((e) => e.is_primary)?.email ?? emails[0]?.email ?? null;
}

function initials(name: string) {
  return name
    .split(" ")
    .map((n) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export default async function PeoplePage() {
  const supabase = await createClient();
  const endTimer = startDevPageTimer("page:data:people");

  const [{ data: people }, { data: companies }] = await Promise.all([
    supabase
      .from("people")
      .select(
        "id,name,title,linkedin_url,primary_organization_id,organization:companies(id,name),person_emails(email,is_primary)"
      )
      .is("archived_at", null)
      .order("name") as unknown as Promise<{ data: PersonRow[] | null }>,
    supabase
      .from("companies")
      .select("id,name")
      .is("deleted_at", null)
      .order("name") as unknown as Promise<{ data: Option[] }>,
  ]);
    endTimer();

  return (
    <div className="flex flex-col gap-4 px-7 py-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-[23px] font-semibold tracking-tight text-ink">
            People
          </h1>
          <p className="mt-1 text-[13px] text-neutral-500">
            Founders, executives, LPs and advisors across every company.
          </p>
        </div>
        <NewPersonModal companies={companies ?? []} />
      </header>

      <div className="overflow-hidden rounded-[14px] border border-neutral-100 bg-white">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="border-b border-neutral-100 text-left text-[10.5px] uppercase tracking-wide text-neutral-400">
              <th className="px-4 py-3 font-semibold">Name</th>
              <th className="px-4 py-3 font-semibold">Company</th>
              <th className="px-4 py-3 font-semibold">Email</th>
              <th className="px-4 py-3 font-semibold">LinkedIn</th>
            </tr>
          </thead>
          <tbody>
            {(people ?? []).map((p) => (
              <tr key={p.id} className="border-b border-neutral-50 last:border-0">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-[#f0fafb] text-[10.5px] font-semibold text-cyan-800">
                      {initials(p.name)}
                    </div>
                    <div>
                      <div className="font-semibold text-ink">{p.name}</div>
                      {p.title && (
                        <div className="text-[11px] text-neutral-500">{p.title}</div>
                      )}
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 text-neutral-600">
                  {p.organization ? (
                    <Link
                      href={`/companies/${p.organization.id}`}
                      className="hover:text-cyan-700"
                    >
                      {p.organization.name}
                    </Link>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-4 py-3 text-neutral-600">
                  {primaryEmail(p.person_emails ?? []) ?? "—"}
                </td>
                <td className="px-4 py-3">
                  {p.linkedin_url ? (
                    <a
                      href={p.linkedin_url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-cyan-700 hover:underline"
                    >
                      Profile
                    </a>
                  ) : (
                    <span className="text-neutral-400">—</span>
                  )}
                </td>
              </tr>
            ))}
            {(!people || people.length === 0) && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-neutral-400">
                  No people yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
