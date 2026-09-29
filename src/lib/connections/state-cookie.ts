// Shared between the two OAuth route handlers. Not colocated in either
// route.ts: Next.js route files may only export HTTP method handlers and
// the recognized route-segment config, not arbitrary constants.
export const GOOGLE_OAUTH_STATE_COOKIE = "vq_google_oauth_state";
