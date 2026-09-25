// Sign-in providers offered on /login. Each maps to a Supabase Auth OAuth
// provider that must also be enabled in Supabase. Signing in only proves
// identity; access still requires an active row in app_members.
//
// Microsoft (Supabase provider "azure") is prepared for Outlook users:
// enable it in Supabase, then set enabled: true here.
export type SignInProvider = {
  id: "google" | "azure";
  label: string;
  enabled: boolean;
  scopes?: string;
  queryParams?: Record<string, string>;
};

export const SIGN_IN_PROVIDERS: SignInProvider[] = [
  {
    id: "google",
    label: "Continue with Google",
    enabled: true,
    // Lets people pick the right Google account instead of silently reusing
    // a personal one.
    queryParams: { prompt: "select_account" },
  },
  {
    id: "azure",
    label: "Continue with Microsoft",
    enabled: false,
    scopes: "email",
  },
];

export function callbackUrl(origin: string, next: string) {
  const url = new URL("/auth/callback", origin);
  url.searchParams.set("next", next);
  return url.toString();
}
