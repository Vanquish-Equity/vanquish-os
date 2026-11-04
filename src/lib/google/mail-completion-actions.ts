"use server";
import { randomBytes, randomUUID } from "node:crypto";
import { mailOpenDigest, mailOpenOrigin } from "./mail-open-signal";
import { createClient } from "@/lib/supabase/server";
import { getAccess } from "@/lib/auth/access";
import {
  googleClient,
  GoogleError,
  requireScope,
  resourceId,
  type GoogleResult,
} from "./client";
import {
  boundedMailJson,
  verifiedMailAliases,
  buildMailMutation,
  sanitizeForwardHtml,
} from "./mail-completion-content";
import {
  beginMailUpload,
  appendMailChunk,
  releaseMailUpload,
} from "./mail-attachment-staging";
import { formatMessage } from "./mail-format";
import { plainTextToHtml } from "@/lib/communications/rich-text";
import {
  MAIL_CHUNK_LIMIT,
  type MailCompletionOperation,
  type MailReview,
  type MailReviewRow,
} from "./mail-completion-types";
import type { GmailMessage } from "./mail-types";
async function context() {
  const { data, error } = await (
    await createClient()
  ).rpc("mail_completion_context");
  if (
    error ||
    !data ||
    typeof data.owner !== "string" ||
    typeof data.connectionRevision !== "string"
  )
    throw new GoogleError(
      "permission",
      "Mail completion is paused, access changed, or Google needs reconnecting in Settings.",
    );
  return data as { owner: string; connectionRevision: string };
}
function failure(error: unknown): { ok: false; code: string; message: string } {
  return {
    ok: false,
    code: error instanceof GoogleError ? error.code : "invalid",
    message:
      error instanceof GoogleError
        ? error.message
        : "Review unavailable: content, attachment, alias, connection or draft revision changed. Reopen and review again.",
  };
}
export async function mailCompletionState() {
  try {
    const { data, error } = await (
      await createClient()
    ).rpc("mail_completion_state");
    return !error && data === true;
  } catch {
    return false;
  }
}
export async function mailOpenSignalAvailable() {
  if (!mailOpenOrigin()) return false;
  try {
    const { error } = await (await createClient()).rpc("my_mail_open_signals");
    return !error;
  } catch { return false; }
}
export async function mailCompletionAliases() {
  try {
    await context();
    return {
      ok: true as const,
      data: await verifiedMailAliases(await googleClient()),
    };
  } catch (e) {
    return failure(e);
  }
}
export async function startMailUpload(
  files: { name: string; type: string; size: number }[],
) {
  try {
    const ctx = await context();
    return {
      ok: true as const,
      data: { id: beginMailUpload(ctx.owner, ctx.connectionRevision, files) },
    };
  } catch (e) {
    return failure(e);
  }
}
export async function uploadMailChunk(
  id: string,
  index: number,
  offset: number,
  bytes: Uint8Array,
) {
  try {
    if (!(bytes instanceof Uint8Array) || bytes.byteLength > MAIL_CHUNK_LIMIT)
      throw Error("Invalid chunk");
    const ctx = await context();
    appendMailChunk(
      ctx.owner,
      ctx.connectionRevision,
      id,
      index,
      offset,
      bytes,
    );
    return { ok: true as const, data: true };
  } catch (e) {
    return failure(e);
  }
}
export async function removeMailUpload(id: string) {
  const access = await getAccess();
  if (access.status !== "member") return { ok: false as const };
  releaseMailUpload(access.email, id);
  return { ok: true as const };
}
export async function reviewMailMutation(
  operation: MailCompletionOperation,
  form: FormData,
): Promise<GoogleResult<MailReview>> {
  try {
    if (!["save", "send", "discard"].includes(operation))
      throw Error("Invalid operation");
    const ctx = await context(),
      client = await googleClient();
    if (operation === "send" && form.get("openSignal") === "1" && !(await mailOpenSignalAvailable()))
      throw new GoogleError("unavailable", "Open tracking is unavailable. Uncheck it and review again.");
    const prepared = await buildMailMutation(client, ctx, operation, form),
      id = randomUUID();
    const { error } = await (
      await createClient()
    ).rpc("create_mail_review", {
      p_id: id,
      p_operation: operation,
      p_revision: prepared.revision,
      p_connection: ctx.connectionRevision,
      p_draft: prepared.draftId,
    });
    if (error) throw Error("Review rejected");
    return {
      ok: true,
      data: {
        id,
        operation,
        ...prepared.summary,
        expiresAt: new Date(Date.now() + 10 * 60000).toISOString(),
      },
    };
  } catch (e) {
    return failure(e);
  }
}
export async function executeMailMutation(
  id: string,
  operation: MailCompletionOperation,
  form: FormData,
  confirmed: boolean,
): Promise<GoogleResult<{ id: string; operation: MailCompletionOperation }>> {
  let attempted = false,
    claimed = false;
  const db = await createClient();
  try {
    if (
      confirmed !== true ||
      !/^\w{8}-[\w-]{27}$/.test(id) ||
      !["save", "send", "discard"].includes(operation)
    )
      throw Error("Explicit confirmation required");
    const wantsPixel = operation === "send" && form.get("openSignal") === "1";
    const origin = wantsPixel ? mailOpenOrigin() : null;
    if (wantsPixel && !origin) throw new GoogleError("unavailable", "Open tracking is unavailable. Uncheck it and review again.");
    const pixel = origin ? { origin, token: randomBytes(32).toString("hex") } : undefined;
    const ctx = await context(),
      prepared = await buildMailMutation(
        await googleClient(),
        ctx,
        operation,
        form,
        pixel,
      );
    const claim = await db.rpc("advance_mail_review", {
      p_id: id,
      p_event: "claim",
      p_revision: prepared.revision,
    });
    if (claim.error) throw Error("Review unavailable");
    claimed = true;
    // Refresh caller-scoped credentials/scopes after all content reads, immediately before fence/POST.
    const client = await googleClient();
    requireScope(
      client,
      ...(operation === "send"
        ? ["gmail.send", "gmail.modify", "gmail.compose"]
        : ["gmail.modify", "gmail.compose"]),
    );
    if (pixel) {
      const registered = await db.rpc("register_mail_open_signal", { p_review: id, p_revision: prepared.revision, p_digest: mailOpenDigest(pixel.token) });
      if (registered.error) throw Error("Tracking registration failed");
    }
    const fence = await db.rpc("advance_mail_review", {
      p_id: id,
      p_event: "dispatch",
      p_revision: prepared.revision,
    });
    if (fence.error) throw Error("Cancelled or revoked");
    attempted = true;
    // Exactly ONE provider mutation, no loops, retries, fallback sends or automatic deletion.
    const result: { id?: string } | undefined =
      operation === "discard"
        ? await client.request("gmail", prepared.path, prepared.init)
        : await boundedMailJson<{ id?: string }>(
            client,
            prepared.path,
            prepared.init,
            64 * 1024,
          );
    if (operation !== "discard" && (!result || typeof result.id !== "string"))
      throw Error("Provider outcome unknown");
    const settled = await db.rpc("advance_mail_review", {
      p_id: id,
      p_event: "completed",
    });
    if (settled.error || settled.data !== "completed")
      throw Error("Outcome ledger unavailable");
    const upload = String(form.get("uploadId") ?? "");
    if (upload) releaseMailUpload(ctx.owner, upload);
    return {
      ok: true,
      data: { id: result?.id ?? prepared.draftId!, operation },
    };
  } catch (e) {
    if (attempted) {
      await db
        .rpc("advance_mail_review", { p_id: id, p_event: "uncertain" })
        .then(
          () => {},
          () => {},
        );
      return {
        ok: false,
        code: "uncertain",
        message:
          "Google's result is uncertain. Do not retry. Review Gmail and this operation with the owner; the source draft may still exist.",
      };
    }
    if (claimed)
      await db.rpc("advance_mail_review", { p_id: id, p_event: "cancel" }).then(
        () => {},
        () => {},
      );
    return failure(e);
  }
}
export async function cancelMailReview(id: string) {
  const { data, error } = await (
    await createClient()
  ).rpc("advance_mail_review", { p_id: id, p_event: "cancel" });
  return error
    ? {
        ok: false as const,
        message: "Could not confirm cancellation; refresh review history.",
      }
    : { ok: true as const, data: String(data) };
}
export async function listMailReviews(): Promise<
  GoogleResult<MailReviewRow[]>
> {
  const db = await createClient();
  const { data, error } = await db.rpc("list_mail_reviews");
  if (error) return failure(null);
  const { data: signals } = mailOpenOrigin() ? await db.rpc("my_mail_open_signals") : { data: null };
  const byReview = new Map<string, string | null>((signals ?? []).map((s: { review_id: string; first_seen: string | null }) => [s.review_id, s.first_seen]));
  return { ok: true, data: ((data ?? []) as MailReviewRow[]).slice(0, 25).map((row) => ({
    ...row, ...(byReview.has(row.id) ? { open_signal: byReview.get(row.id) } : {}),
  })) };
}
export async function prepareCompleteForward(messageId: string) {
  try {
    await context();
    const client = await googleClient();
    requireScope(client, "gmail.readonly", "gmail.modify");
    const original = await boundedMailJson<GmailMessage>(
      client,
      `/messages/${resourceId(messageId)}?format=full`,
    );
    // Bound traversal before decoding; formatMessage itself is also used by the legacy reader.
    let count = 0;
    const stack = [original.payload];
    while (stack.length) {
      const part = stack.pop();
      if (!part) continue;
      if (++count > 100) throw Error("Too many parts");
      if (part.parts) stack.push(...part.parts);
    }
    const m = formatMessage(original);
    if (
      m.attachments.length > 10 ||
      m.attachments.reduce((n, a) => n + a.size, 0) > 2 * 1024 * 1024 ||
      m.html.length + m.text.length > 200000
    )
      throw Error("Forward exceeds budget");
    return {
      ok: true as const,
      data: {
        to: "",
        cc: "",
        bcc: "",
        subject: `Fwd: ${m.subject}`.slice(0, 500),
        html: `<p>Forwarded message from ${plainTextToHtml(m.from)}</p>${sanitizeForwardHtml(m.html || plainTextToHtml(m.text))}`,
        attachments: m.attachments,
        forwardSource: {
          messageId: original.id,
          partIds: m.attachments.map((a) => a.partId),
        },
      },
    };
  } catch (e) {
    return failure(e);
  }
}
