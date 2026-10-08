import PortfolioScorecard,{type PortfolioSignal} from "@/components/PortfolioScorecard";
import type {WatchRule} from "@/lib/portfolio/monitoring";
import Link from "next/link";
import PortfolioMonitoring, {type Observation} from "@/components/PortfolioMonitoring";
import { requireMember } from "@/lib/auth/access";
import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";

export const dynamic="force-dynamic";
export default async function MonitoringPage() {
  const access=await requireMember();
  if (!access.permissions.has("portfolio")) notFound();
  const db=await createClient();
  const [investments,observations,rules,signals]=await Promise.all([
    db.from("investments").select("id,external_ref,round_label,company:companies(name)").is("archived_at",null).order("created_at"),
    db.from("portfolio_observations").select("*").order("observed_on",{ascending:false}).limit(1000),
    db.from("portfolio_watch_rules").select("*").order("metric"),
    db.from("portfolio_signals").select("*").order("observed_on",{ascending:false}).limit(200),
  ]);
  const targets=(investments.data??[]).map(row=>({id:row.id,label:[(row.company as unknown as {name:string}|null)?.name??row.external_ref,row.round_label].filter(Boolean).join(" · ")}));
  return <div className="px-4 py-6 sm:px-7"><Link href="/portfolio" className="text-[12px] text-cyan-800">← Portfolio</Link><h1 className="mt-3 text-[23px] font-semibold text-ink">Portfolio monitoring</h1><p className="mb-5 mt-1 text-[13px] text-neutral-500">Dated KPIs and evidence for post-investment monitoring. Export the latest 1,000 observations for reporting.</p><div className="flex flex-col gap-5"><PortfolioScorecard investments={targets} observations={(observations.data??[]) as Observation[]} rules={(rules.data??[]) as WatchRule[]} signals={(signals.data??[]) as PortfolioSignal[]} now={new Date().toISOString()}/><PortfolioMonitoring investments={targets} observations={(observations.data??[]) as Observation[]} available={!observations.error}/></div></div>;
}
