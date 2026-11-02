import { cache } from "react";
import { headers } from "next/headers";
import { PerfCollector, type PerfKind } from "./collector";
import { PERF_PROXY_HEADER, PERF_REQUEST_HEADER, perfEnvEnabled } from "./config";
import { parseProxyRelay } from "./proxy";

// One collector per request (React cache is scoped to the render). Nothing
// here runs unless VQ_PERF_PANEL=1 and the proxy marked the request (?perf=1).
const requestCollector = cache(() => new PerfCollector());

/** True only when the flag is on and the proxy marked this request. */
export async function perfRequested(): Promise<boolean> {
  if (!perfEnvEnabled()) return false;
  try {
    return (await headers()).get(PERF_REQUEST_HEADER) === "1";
  } catch {
    // Outside a request (scripts, tests): not measured.
    return false;
  }
}

/** The collector for this request, or null when measuring is not requested. */
export async function perfCollector(): Promise<PerfCollector | null> {
  if (!(await perfRequested())) return null;
  const collector = requestCollector();
  if (!collector.isActive) return null;
  if (!collector.proxy) {
    try {
      collector.proxy = parseProxyRelay((await headers()).get(PERF_PROXY_HEADER));
    } catch {
      /* keep going without proxy timings */
    }
  }
  return collector;
}

/** Times an async phase. A plain pass-through unless measuring was requested. */
export function timed<T>(kind: PerfKind, label: string, run: () => Promise<T>): Promise<T> {
  if (!perfEnvEnabled()) return run();
  return perfCollector().then((collector) => {
    if (!collector) return run();
    const end = collector.begin(kind, label);
    return run().then(
      (value) => {
        end();
        return value;
      },
      (error) => {
        end("error");
        throw error;
      },
    );
  });
}
