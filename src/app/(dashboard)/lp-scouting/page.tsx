import { notFound } from "next/navigation";
import { requireMember } from "@/lib/auth/access";
import { createClient } from "@/lib/supabase/server";
import LpScouting, {
  type LpSettings,
  type LpSuggestion,
} from "@/components/LpScouting";
export const dynamic = "force-dynamic";
export default async function Page() {
  const access = await requireMember(),
    db = await createClient();
  const permission = await db
    .from("member_permissions")
    .select("permission")
    .eq("email", access.email)
    .eq("permission", "lp_scouting")
    .maybeSingle();
  if (!permission.data) notFound();
  const results = await Promise.all([
    db
      .from("lp_scouting_settings")
      .select(
        "enabled,contact_mode,share_metadata,window_days,message_cap,last_scanned_at",
      )
      .eq("member_email", access.email)
      .maybeSingle(),
    db
      .from("lp_suggestions")
      .select(
        "id,email,name,confidence,signal_count,last_seen_at,evidence,status",
      )
      .eq("status", "open")
      .order("last_seen_at", { ascending: false })
      .order("id")
      .limit(100),
    db
      .from("lp_contact_requests")
      .select("id,name,email")
      .eq("status", "pending")
      .order("id")
      .limit(100),
    db
      .from("companies")
      .select("id,name")
      .is("deleted_at", null)
      .order("name")
      .limit(500),
    db
      .from("lp_scout_keywords")
      .select("phrase,kind,strong,enabled")
      .order("phrase")
      .limit(200),
    db
      .from("lp_scout_jobs")
      .select("id,service,status,error_code")
      .order("created_at", { ascending: false })
      .limit(20),
  ]);
  if (results.some((r) => r.error))
    return (
      <div className="p-7">
        LP scouting is unavailable. Check the phase 2 schema and your current
        permission.
      </div>
    );
  return (
    <LpScouting
      settings={
        (results[0].data ?? {
          enabled: false,
          contact_mode: "request",
          share_metadata: false,
          window_days: 30,
          message_cap: 100,
          last_scanned_at: null,
        }) as LpSettings
      }
      suggestions={(results[1].data ?? []) as LpSuggestion[]}
      contacts={results[2].data ?? []}
      companies={results[3].data ?? []}
      keywords={results[4].data ?? []}
      jobs={results[5].data ?? []}
      admin={access.permissions.has("admin")}
    />
  );
}
