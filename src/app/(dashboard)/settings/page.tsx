import { cookies } from "next/headers";
import { requireMember } from "@/lib/auth/access";
import { can } from "@/lib/auth/permissions";
import { loadMailboxConnection } from "@/lib/connections/queries";
import { createClient } from "@/lib/supabase/server";
import { introCookieName } from "@/lib/ui/entrance";
import { landingCookieName, landingPage, noticeMask, notificationCookieName, pipelineCookieName, pipelineDefault } from "@/lib/settings/preferences";
import SettingsPanel from "@/components/SettingsPanel";
import AdminSettings from "@/components/AdminSettings";
import RelationshipSyncSettings from "@/components/RelationshipSyncSettings";
import StageRulesSettings, { type StageRule } from "@/components/StageRulesSettings";
import StageRequirementsSettings from "@/components/StageRequirementsSettings";
import { getPipelineStages } from "@/lib/taxonomies";

export const dynamic = "force-dynamic";

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ connect?: string }> }) {
  const { connect } = await searchParams;
  const access = await requireMember();
  const supabase = await createClient();
  const [{ data: profile, error }, mailbox, { data: relationshipSync, error: relationshipError }] = await Promise.all([
    supabase.from("app_members").select("display_name,avatar_path").eq("email", access.email).maybeSingle(),
    loadMailboxConnection(supabase),
    supabase.from("relationship_sync").select("enabled,last_synced_at").eq("member_email", access.email).maybeSingle(),
  ]);
  const avatarUrl = profile?.avatar_path
    ? (await supabase.storage.from("member-avatars").createSignedUrl(profile.avatar_path, 3600)).data?.signedUrl ?? null
    : null;
  const cookieStore = await cookies();
  const introEnabled = cookieStore.get(introCookieName(access.email))?.value !== "0";
  const noticePreference = noticeMask(cookieStore.get(notificationCookieName(access.email))?.value);
  const landing = landingPage(cookieStore.get(landingCookieName(access.email))?.value);
  const pipeline = pipelineDefault(cookieStore.get(pipelineCookieName(access.email))?.value);
  const isAdmin = can(access, "admin");
  const [membersResult, permissionsResult, domainsResult] = isAdmin
    ? await Promise.all([
        supabase.from("app_members").select("email,display_name,is_active").order("email"),
        supabase.from("member_permissions").select("email,permission"),
        supabase.from("ignored_email_domains").select("domain,reason").order("domain"),
      ])
    : [{ data: null, error: null }, { data: null, error: null }, { data: null, error: null }];
  const [rulesResult, stages, requirementsResult] = isAdmin
    ? await Promise.all([
        supabase
          .from("stage_task_rules")
          .select("id,stage_id,title,due_in_days,assignee_email,is_active")
          .order("is_active", { ascending: false })
          .order("created_at") as unknown as Promise<{ data: StageRule[] | null; error: unknown }>,
        getPipelineStages(),
        supabase.from("stage_requirements").select("stage_id,requirement").eq("is_active", true) as unknown as Promise<{
          data: { stage_id: string; requirement: string }[] | null;
          error: unknown;
        }>,
      ])
    : [{ data: null, error: null }, [], { data: null, error: null }];

  return (
    <div className="mx-auto flex w-full max-w-[990px] flex-col gap-5 px-4 py-6 sm:px-7">
      <header>
        <h1 className="font-[family-name:var(--font-display)] text-[23px] font-semibold tracking-tight text-ink">Settings</h1>
        <p className="mt-1 text-[13px] text-neutral-500">Your profile, experience and connected accounts.</p>
      </header>
      <SettingsPanel
        email={access.email}
        displayName={profile?.display_name ?? access.displayName ?? ""}
        avatarUrl={avatarUrl}
        profileAvailable={!error}
        introCookie={introCookieName(access.email)}
        initialIntroEnabled={introEnabled}
        initialNoticeMask={noticePreference}
        initialLanding={landing}
        initialPipeline={pipeline}
        mailbox={mailbox}
        connectStatus={connect ?? null}
      />
      {!relationshipError && (
        <RelationshipSyncSettings
          enabled={Boolean(relationshipSync?.enabled)}
          lastSyncedAt={relationshipSync?.last_synced_at ?? null}
          googleConnected={mailbox.connected}
        />
      )}
      {isAdmin && !membersResult.error && !permissionsResult.error && !domainsResult.error && (
        <AdminSettings
          me={access.email}
          members={(membersResult.data ?? []).map((member) => ({
            email: member.email,
            name: member.display_name,
            active: member.is_active,
            permissions: (permissionsResult.data ?? []).filter((item) => item.email === member.email).map((item) => item.permission),
          }))}
          domains={domainsResult.data ?? []}
        />
      )}
      {isAdmin && !rulesResult.error && !membersResult.error && (
        <StageRulesSettings
          stages={stages.map((stage) => ({ id: stage.id, name: stage.name }))}
          members={(membersResult.data ?? [])
            .filter((member) => member.is_active)
            .map((member) => ({ email: member.email, name: member.display_name }))}
          rules={rulesResult.data ?? []}
        />
      )}
      {isAdmin && !requirementsResult.error && (
        <StageRequirementsSettings
          stages={stages.map((stage) => ({ id: stage.id, name: stage.name }))}
          active={(requirementsResult.data ?? []).map((row) => `${row.stage_id}:${row.requirement}`)}
        />
      )}
    </div>
  );
}
