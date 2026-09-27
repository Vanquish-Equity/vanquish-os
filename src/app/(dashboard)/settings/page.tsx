import { cookies } from "next/headers";
import { requireMember } from "@/lib/auth/access";
import { createClient } from "@/lib/supabase/server";
import { introCookieName } from "@/lib/ui/entrance";
import SettingsPanel from "@/components/SettingsPanel";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const access = await requireMember();
  const supabase = await createClient();
  const { data: profile, error } = await supabase.from("app_members")
    .select("display_name,avatar_path").eq("email", access.email).maybeSingle();
  const avatarUrl = profile?.avatar_path
    ? (await supabase.storage.from("member-avatars").createSignedUrl(profile.avatar_path, 3600)).data?.signedUrl ?? null
    : null;
  const introEnabled = (await cookies()).get(introCookieName(access.email))?.value !== "0";

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
      />
    </div>
  );
}
