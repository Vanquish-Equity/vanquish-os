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
        LP fundraising isn&apos;t available. Check that you have access to it,
        or ask an admin.
      </div>
    );
  return <LpFundraising data={data} />;
}
