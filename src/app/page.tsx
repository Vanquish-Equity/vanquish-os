import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requireMember } from "@/lib/auth/access";
import { landingCookieName, landingDestination, landingPage } from "@/lib/settings/preferences";

export default async function Home() {
  const member = await requireMember();
  const saved = (await cookies()).get(landingCookieName(member.email))?.value;
  redirect(landingDestination(landingPage(saved)));
}
