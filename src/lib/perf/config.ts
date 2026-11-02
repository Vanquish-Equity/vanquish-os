// Performance panel switches. Everything here is inert unless the server
// environment variable VQ_PERF_PANEL is exactly "1" (never NEXT_PUBLIC).
export const PERF_ENV = "VQ_PERF_PANEL";
// Request header set by the proxy (and only by the proxy) when the flag is on
// and the URL carries ?perf=1. The proxy overwrites any client-sent copy.
export const PERF_REQUEST_HEADER = "x-vq-perf";
// Proxy-to-render relay: "claims=12.3;total=14.1" (milliseconds only).
export const PERF_PROXY_HEADER = "x-vq-perf-proxy";
export const PERF_QUERY = "perf";
export const PERF_SCRIPT_ID = "vq-perf-server";

export function perfEnvEnabled() {
  return process.env[PERF_ENV] === "1";
}
