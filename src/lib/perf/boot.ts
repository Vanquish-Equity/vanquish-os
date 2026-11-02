import { PERF_READY_EVENT, PERF_SCRIPT_ID } from "./config";

// Client-side entry for the performance panel. It lives in a module that is
// already part of the page's JavaScript (called from NavigationProgress) so
// that, with the panel off, nothing new is downloaded: the panel itself is a
// separate chunk that is imported only when the server wrote the timeline.


let hydratedAt: number | undefined;
/** performance.now() when the dashboard shell hydrated. Just a number; no mark is made. */
export const getHydratedAt = () => hydratedAt;

export function watchForPerfPanel() {
  hydratedAt = performance.now();
  let started = false;
  const start = () => {
    if (started || !document.getElementById(PERF_SCRIPT_ID)) return;
    started = true;
    void import("@/components/perf/mountPerfPanel").then((m) => m.mountPerfPanel());
  };
  // The timeline arrives at the end of the stream, usually after hydration.
  document.addEventListener(PERF_READY_EVENT, start);
  start();
  return () => document.removeEventListener(PERF_READY_EVENT, start);
}
