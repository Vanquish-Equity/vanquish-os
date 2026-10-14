import { notFound } from "next/navigation";
import { requireMember } from "@/lib/auth/access";
import { loadLpData } from "@/lib/lp-management/queries";
import LpFundraising from "@/components/LpFundraising";
export const dynamic = "force-dynamic";
export default async function Page() {
  const access = await requireMember();
  if (!access.permissions.has("portfolio")) notFound();
  const data = await loadLpData(access.email);
  if (!data)
    return (
      <div className="p-7">
        LP fundraising is unavailable. Check the phase 2 schema and current
        permissions.
      </div>
    );
  return <LpFundraising data={data} />;
}
