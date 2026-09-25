import { redirect } from "next/navigation";
import { getAccess } from "@/lib/auth/access";

export const dynamic = "force-dynamic";

// Signed-in accounts that are not active members land here.
export default async function AccessDeniedPage() {
  const access = await getAccess();
  if (access.status === "anonymous") redirect("/login");
  if (access.status === "member") redirect("/overview");

  return (
    <div className="flex min-h-screen items-center justify-center bg-white px-4">
      <div className="vq-card-static w-full max-w-md rounded-[14px] bg-white p-7">
        <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-neutral-400">
          Vanquish OS
        </div>
        <h1 className="mb-2 font-[family-name:var(--font-display)] text-xl font-semibold text-ink">
          This account is not authorized
        </h1>
        <p className="text-[13px] text-neutral-600">
          You are signed in as{" "}
          <strong className="text-ink">{access.email ?? "an account without an email"}</strong>, but it
          is not on the list of Vanquish OS members. Ask an administrator to add it, or sign out
          and use your authorized account.
        </p>
        <form action="/auth/signout" method="post" className="mt-5">
          <button
            type="submit"
            className="rounded-full bg-ink px-4 py-2.5 text-[12.5px] font-semibold text-white transition hover:bg-neutral-800"
          >
            Sign out
          </button>
        </form>
      </div>
    </div>
  );
}
