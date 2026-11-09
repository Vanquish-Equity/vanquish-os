import Link from "next/link";
import CompanyWebsiteImporter from "@/components/CompanyWebsiteImporter";
import { requireMember } from "@/lib/auth/access";

export default async function ImportCompanyWebsitesPage() {
  await requireMember();
  return (
    <div className="flex min-w-0 flex-col gap-4 px-4 py-6 sm:px-7">
      <header>
        <Link href="/companies" className="text-xs font-semibold text-neutral-500 hover:text-cyan-800">
          Back to Companies
        </Link>
        <h1 className="mt-1 font-[family-name:var(--font-display)] text-[23px] font-semibold tracking-tight text-ink">
          Import websites
        </h1>
        <p className="mt-1 max-w-2xl text-[13px] text-neutral-500">
          Fill blank websites on existing companies. Review the matches before saving anything.
        </p>
      </header>
      <CompanyWebsiteImporter />
    </div>
  );
}
