import LoginForm from "@/app/login/LoginForm";
import { safeNextPath } from "@/lib/auth/redirect";

export const dynamic = "force-dynamic";

const ERROR_MESSAGES: Record<string, string> = {
  auth_failed: "Sign-in did not complete. Try again.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string; signed_out?: string }>;
}) {
  const { next, error, signed_out: signedOut } = await searchParams;

  return (
    <LoginForm
      next={safeNextPath(next)}
      initialError={error ? ERROR_MESSAGES[error] ?? ERROR_MESSAGES.auth_failed : null}
      signedOut={signedOut === "1"}
    />
  );
}
