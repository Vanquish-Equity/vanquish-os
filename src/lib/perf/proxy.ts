import type { NextRequest } from "next/server";
import { PERF_PROXY_HEADER, PERF_QUERY, PERF_REQUEST_HEADER, perfEnvEnabled } from "./config";

// Proxy-side half of the performance panel. startProxyPerf returns null
// unless VQ_PERF_PANEL=1, so with the flag off the proxy does no extra work.
export type ProxyPerf = {
  /** Times the session check. */
  claims<T>(run: () => Promise<T>): Promise<T>;
  /** Hands the proxy timings to the render. Returns true when a header was set. */
  relay(request: NextRequest): boolean;
  /** Adds the standard Server-Timing header to the response. */
  finish<R extends Response>(response: R): R;
};

const ms = (n: number) => Math.round(n * 10) / 10;

export function startProxyPerf(request: NextRequest): ProxyPerf | null {
  if (!perfEnvEnabled()) return null;
  const started = performance.now();
  let claimsMs: number | undefined;
  // Only the proxy decides whether this request is measured; a header sent
  // by the browser is always discarded.
  // Exactly one perf parameter with the value "1": ?perf=true, ?perf=2, an
  // empty value or a repeated parameter do not count.
  const values = request.nextUrl.searchParams.getAll(PERF_QUERY);
  const requested = values.length === 1 && values[0] === "1";
  request.headers.delete(PERF_PROXY_HEADER);
  if (requested) request.headers.set(PERF_REQUEST_HEADER, "1");
  else request.headers.delete(PERF_REQUEST_HEADER);

  return {
    async claims(run) {
      const at = performance.now();
      try {
        return await run();
      } finally {
        claimsMs = performance.now() - at;
      }
    },
    relay(req) {
      if (!requested) return false;
      req.headers.set(PERF_PROXY_HEADER, `claims=${ms(claimsMs ?? 0)};total=${ms(performance.now() - started)}`);
      return true;
    },
    finish(response) {
      const parts: string[] = [];
      if (claimsMs !== undefined) parts.push(`session;dur=${ms(claimsMs)};desc="proxy session check"`);
      parts.push(`proxy;dur=${ms(performance.now() - started)};desc="proxy total"`);
      response.headers.append("Server-Timing", parts.join(", "));
      return response;
    },
  };
}

/** Parses the relay header; anything that is not exactly the expected numbers is ignored. */
export function parseProxyRelay(value: string | null | undefined): { claims?: number; total?: number } | undefined {
  const match = /^claims=(\d{1,6}(?:\.\d)?);total=(\d{1,6}(?:\.\d)?)$/.exec(value ?? "");
  return match ? { claims: Number(match[1]), total: Number(match[2]) } : undefined;
}
