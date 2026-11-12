// Baseline response headers for every route. Vercel already adds HSTS.
//
// The CSP is deliberately limited to directives that cannot break the app:
// no script-src/img-src/style-src (the sandboxed mail iframes use srcDoc and
// inherit the parent's CSP, so a strict img-src would silently break "Load
// remote images"). A nonce-based script policy needs its own change and test.
export const SECURITY_HEADERS: { key: string; value: string }[] = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Legacy equivalent of frame-ancestors for old browsers. Nothing embeds this app.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'" },
];
