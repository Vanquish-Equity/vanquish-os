// Session cookie flags shared by the browser, server and proxy clients.
// Secure in production builds (Vercel Production and Preview are HTTPS);
// left off for `next dev` so http://localhost keeps working. Not httpOnly:
// the browser client needs the PKCE verifier during OAuth sign-in.
export const supabaseCookieOptions = {
  path: "/",
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
};
