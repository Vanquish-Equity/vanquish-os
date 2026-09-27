import { cookies } from "next/headers";
import { requireMember } from "@/lib/auth/access";
import { can } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { introCookieName } from "@/lib/ui/entrance";
import { landingCookieName, landingPage, noticeMask, notificationCookieName, pipelineCookieName, pipelineDefault } from "@/lib/settings/preferences";
import SettingsPanel from "@/components/SettingsPanel";
import AdminSettings from "@/components/AdminSettings";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const access = await requireMember();
  const supabase = await createClient();
  const { data: profile, error } = await supabase.from("app_members")
    .select("display_name,avatar_path").eq("email", access.email).maybeSingle();
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
      />
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
    </div>
  );
}
