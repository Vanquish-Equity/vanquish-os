import type { PerfCollector } from "./collector";
import { methodOf, type PerfLabel } from "./labels";

/**
 * Wraps a fetch so each call is timed (until the response headers arrive).
 * Transparent: the same arguments reach the base fetch in the same order and
 * the same Response (or the same error) reaches the caller. Only the label
 * function sees the request, and it returns a generic name.
 */
export function instrumentFetch(
  collector: PerfCollector,
  labeler: (input: unknown, method: string) => PerfLabel,
  base?: typeof fetch,
): typeof fetch {
  return function perfFetch(input, init) {
    const run = base ?? globalThis.fetch;
    let label: PerfLabel;
    try {
      label = labeler(input, methodOf(input, init));
    } catch {
      label = { kind: "other", label: "other" };
    }
    const end = collector.begin(label.kind, label.label);
    let promise: Promise<Response>;
    try {
      promise = run(input, init);
    } catch (error) {
      end("error");
      throw error;
    }
    return promise.then(
      (response) => {
        end(response.status);
        return response;
      },
      (error) => {
        end("error");
        throw error;
      },
    );
  };
}
